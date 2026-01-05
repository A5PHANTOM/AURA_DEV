import json
import os
import threading
import time
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, List, Tuple

import requests
from fastapi import FastAPI, UploadFile, File, HTTPException, Depends, Form, Body, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from .database import engine, Base, SessionLocal
from .auth import routes as auth_routes
from . import models
from .auth.utils import get_password_hash
from .face_recognition import detect_faces, compute_embeddings_for_detections, parse_embedding
from .telegram_notifications import send_telegram_message, send_telegram_photo
from .llava_client import (
    analyze_image_with_llava,
    analyze_text_with_llava,
    LLaVAError,
    LLaVAServerUnavailable,
)
from .config import LLAVA_MODEL_NAME, TELEGRAM_BOT_TOKEN, LLAVA_BASE_URL, ESP32_ROVER_API


app = FastAPI(title="Auth Backend")

# Distance threshold for deciding if a detected face matches a known person.
# Smaller values = stricter matching (more likely to mark as Unknown).
MATCH_DISTANCE_THRESHOLD = 0.5

# Minimum match-score (0.0–1.0) required to treat a detection
# as this user. Anything below is returned as Unknown, but we still
# expose the score so the frontend can display e.g. 20% confidence.
MIN_MATCH_SCORE = 0.2  # 20%

# Simple media storage for reference face images
BASE_DIR = Path(__file__).parent
MEDIA_ROOT = BASE_DIR / "media"
PEOPLE_MEDIA_ROOT = MEDIA_ROOT / "people"
# Store event snapshots (e.g. unknown face frames) here
EVENT_MEDIA_ROOT = MEDIA_ROOT / "events"
PATROL_MEDIA_ROOT = MEDIA_ROOT / "patrol"

# Main on-disk log file (append-only, JSON-per-line)
MAIN_LOG_FILE = BASE_DIR / "aura_main.log"

app.add_middleware(
    CORSMiddleware,
    # For development, allow all origins so that
    # mobile devices on the LAN (e.g. http://192.168.x.x:5173)
    # can call the API.
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve reference images under /media
MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
PEOPLE_MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
EVENT_MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
PATROL_MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=str(MEDIA_ROOT)), name="media")


@app.on_event("startup")
def on_startup():
    # create DB tables
    Base.metadata.create_all(bind=engine)

    # ensure a test admin exists for easy testing
    db = SessionLocal()
    try:
        # allow login using username 'admin' by storing it in phone_number
        existing = db.query(models.User).filter((models.User.email == 'admin') | (models.User.phone_number == 'admin')).first()
        if not existing:
            hashed = get_password_hash('admin')
            admin_user = models.User(email='admin@example.com', phone_number='admin', hashed_password=hashed)
            db.add(admin_user)
            db.commit()
            db.refresh(admin_user)
    finally:
        db.close()

    # Start Telegram polling bot in the background so that commands
    # like /last_ai are handled within this FastAPI process.
    thread = threading.Thread(target=_telegram_polling_loop, daemon=True)
    thread.start()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _append_main_log(entry: dict) -> None:
    """Append a single log entry to the main log file.

    Best-effort only: any filesystem errors are ignored so that
    logging never breaks main flows.
    """
    try:
        MAIN_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with MAIN_LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        # Do not propagate logging failures
        pass


def add_system_log(db: Session, level: str, source: str, category: str, message: str, data=None):
    """Persist a system log entry to DB and main log file.

    Logging must never break main flows, so errors are ignored.
    """
    level = str(level or "info")
    source = str(source or "") or None
    category = str(category or "") or None
    message = str(message or "")

    if not message:
        return

    # Write to DB
    try:
        log = models.SystemLog(
            level=level,
            source=source,
            category=category,
            message=message,
            data=json.dumps(data) if data is not None else None,
        )
        db.add(log)
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass

    # Also append to main log file
    entry = {
        "ts": datetime.utcnow().isoformat() + "Z",
        "level": level,
        "source": source,
        "category": category,
        "message": message,
        "data": data,
    }
    _append_main_log(entry)


def _build_ai_short_alert(text: str, max_chars: int = 240) -> str:
    """Derive a compact 1–2 line alert from a longer AI summary.

    Prefer the first paragraph or sentence, truncated to max_chars.
    """

    if not text:
        return ""

    snippet = text.strip().split("\n\n", 1)[0].strip()
    if len(snippet) <= max_chars:
        return snippet
    return snippet[: max_chars - 1].rstrip() + "…"


def _send_latest_ai_event_to_telegram(db: Session) -> Tuple[Optional[models.Event], bool]:
    """Internal helper to send the latest AI-enhanced event to Telegram.

    Returns (event, sent). If no event is found, (None, False) is returned.
    """

    event = (
        db.query(models.Event)
        .filter(models.Event.ai_summary_long.isnot(None))
        .order_by(models.Event.created_at.desc())
        .first()
    )

    if not event:
        return None, False

    created_iso = event.created_at.isoformat() if event.created_at else ""
    header = "🤖 AURA AI Analysis\n"
    meta_line = f"Type: {event.event_type} | Time: {created_iso}\n\n"
    body = event.ai_summary_short or event.ai_summary_long or "(no AI summary available)"
    caption = header + meta_line + body

    image_bytes = None
    if event.image_path:
        try:
            abs_path = MEDIA_ROOT / event.image_path
            with abs_path.open("rb") as f:
                image_bytes = f.read()
        except Exception:
            image_bytes = None

    if image_bytes:
        sent = send_telegram_photo(image_bytes, caption)
    else:
        sent = send_telegram_message(caption)

    if sent:
        add_system_log(
            db,
            level="info",
            source="backend",
            category="telegram",
            message="Sent latest AI event to Telegram",
            data={"event_id": event.id},
        )

    return event, sent


def _analyze_latest_event_image(db: Session) -> Tuple[Optional[models.Event], bool, str]:
    """Run LLaVA analysis on the latest event that has an image.

    Returns (event, succeeded, message). If no suitable event exists,
    succeeded is False and message contains a human-readable reason.
    """

    event = (
        db.query(models.Event)
        .filter(models.Event.image_path.isnot(None))
        .order_by(models.Event.created_at.desc())
        .first()
    )

    if not event:
        return None, False, "No events with images are available for analysis."

    if event.ai_status == "succeeded" and event.ai_summary_long:
        return event, False, "Latest image event already has AI analysis."

    try:
        abs_path = MEDIA_ROOT / (event.image_path or "")
        with abs_path.open("rb") as f:
            image_bytes = f.read()
    except Exception:
        return event, False, "Could not load image for the latest event."

    ai_prompt = (
        "Analyze this image like a security surveillance system. "
        "Describe the scene, number of people, and any security-" \
        "relevant activities in 3–6 concise lines."
    )

    try:
        ai_result = analyze_image_with_llava(image_bytes, prompt=ai_prompt)
    except LLaVAServerUnavailable as exc:
        event.ai_status = "unavailable"
        try:
            db.commit()
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass

        add_system_log(
            db,
            level="warning",
            source="backend",
            category="ai_llava",
            message="LLaVA server unavailable for manual analyze_latest_event",
            data={"event_id": getattr(event, "id", None), "error": str(exc)},
        )
        return event, False, "AI analysis server is currently unavailable."
    except LLaVAError as exc:
        event.ai_status = "failed"
        try:
            db.commit()
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass

        add_system_log(
            db,
            level="error",
            source="backend",
            category="ai_llava",
            message="LLaVA analysis failed for manual analyze_latest_event",
            data={"event_id": getattr(event, "id", None), "error": str(exc)},
        )
        return event, False, "AI analysis failed. Please try again later."

    content = ai_result.get("content") or ""
    short = _build_ai_short_alert(content)

    event.ai_status = "succeeded"
    event.ai_summary_short = short
    event.ai_summary_long = content
    try:
        event.ai_raw = json.dumps(ai_result.get("raw"))
    except Exception:
        event.ai_raw = None
    event.ai_latency_ms = ai_result.get("latency_ms")
    event.ai_model = LLAVA_MODEL_NAME

    try:
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass

    add_system_log(
        db,
        level="info",
        source="backend",
        category="ai_llava",
        message="LLaVA manual analysis for latest image event succeeded",
        data={"event_id": event.id, "latency_ms": event.ai_latency_ms},
    )

    return event, True, "OK"


def _check_llava_health() -> str:
    """Quick health check for the LLaVA server for /status.

    Returns a short status string: online / offline / disabled / error(...).
    """

    if not LLAVA_BASE_URL:
        return "disabled"

    try:
        resp = requests.get(LLAVA_BASE_URL.rstrip("/") + "/api/tags", timeout=3)
        if resp.status_code == 200:
            return "online"
        return f"error (HTTP {resp.status_code})"
    except Exception:
        return "offline"


def _check_rover_health() -> str:
    """Quick health check for the ESP32 rover for /status.

    Returns a short status string: online / offline / disabled / error(...).
    """

    if not ESP32_ROVER_API:
        return "disabled"

    try:
        url = ESP32_ROVER_API.rstrip("/") + "/status"
        resp = requests.get(url, timeout=3)
        if resp.status_code == 200:
            return "online"
        return f"error (HTTP {resp.status_code})"
    except Exception:
        return "offline"


def _build_status_report(db: Session) -> str:
    """Build a human-readable status report for the rover and backend."""

    now = datetime.utcnow().isoformat() + "Z"

    people_count = db.query(models.Person).count()

    last_event = (
        db.query(models.Event)
        .order_by(models.Event.created_at.desc())
        .first()
    )
    if last_event and last_event.created_at:
        last_event_line = f"{last_event.event_type} at {last_event.created_at.isoformat()}"
    else:
        last_event_line = "none"

    last_esp32 = (
        db.query(models.SystemLog)
        .filter(models.SystemLog.source == "esp32")
        .order_by(models.SystemLog.created_at.desc())
        .first()
    )

    rover_status = _check_rover_health()
    if rover_status == "online":
        if last_esp32 and last_esp32.created_at:
            rover_line = f"online (HTTP /status OK; last log {last_esp32.created_at.isoformat()})"
        else:
            rover_line = "online (HTTP /status OK; no recent logs)"
    elif rover_status == "disabled":
        if last_esp32 and last_esp32.created_at:
            rover_line = f"unknown (no direct ESP32 check; last log {last_esp32.created_at.isoformat()})"
        else:
            rover_line = "unknown (ESP32_ROVER_API not configured)"
    else:
        # offline or error
        if last_esp32 and last_esp32.created_at:
            rover_line = f"{rover_status} (last seen {last_esp32.created_at.isoformat()})"
        else:
            rover_line = rover_status

    llava_status = _check_llava_health()

    lines = [
        "AURA System Status",
        f"Time (UTC): {now}",
        "Backend: ONLINE",
        f"Rover: {rover_line}",
        f"LLaVA: {llava_status}",
        f"Registered people: {people_count}",
        f"Last event: {last_event_line}",
    ]

    return "\n".join(lines)


def _build_patrol_session_summary(db: Session, session: models.PatrolSession) -> str:
    """Build a text summary of what happened during a patrol session.

    This uses events and system logs in the session's time window rather than
    raw video, which the current ESP32-CAM firmware does not expose as a
    downloadable file. The AI layer can then summarize this text.
    """

    start = session.start_time
    end = session.end_time or datetime.utcnow()

    events = (
        db.query(models.Event)
        .filter(models.Event.created_at >= start, models.Event.created_at <= end)
        .all()
    )
    logs = (
        db.query(models.SystemLog)
        .filter(models.SystemLog.created_at >= start, models.SystemLog.created_at <= end)
        .all()
    )

    lines: list[str] = []
    lines.append(f"Patrol session {session.id} summary")
    lines.append(f"Window (UTC): {start.isoformat()} → {end.isoformat()}")
    if session.patrol_path_name:
        lines.append(f"Path: {session.patrol_path_name}")
    lines.append("")

    if events:
        lines.append(f"Events during patrol: {len(events)}")
        by_type: dict[str, int] = {}
        for e in events:
            by_type[e.event_type] = by_type.get(e.event_type, 0) + 1
        parts = [f"{k}={v}" for k, v in sorted(by_type.items())]
        lines.append("Events by type: " + ", ".join(parts))
    else:
        lines.append("Events during patrol: none")

    if logs:
        lines.append(f"Log entries during patrol: {len(logs)}")
    else:
        lines.append("Log entries during patrol: none")

    flame = sum(1 for l in logs if l.category == "flame")
    gas = sum(1 for l in logs if l.category == "gas")
    edge = sum(1 for l in logs if l.category == "edge")
    ultrasonic = sum(1 for l in logs if l.category == "ultrasonic")

    lines.append(f"Fire alerts: {flame}")
    lines.append(f"Gas alerts: {gas}")
    lines.append(f"Edge detections: {edge}")
    lines.append(f"Obstacle detections: {ultrasonic}")

    return "\n".join(lines)


def _build_analytics_summary(db: Session, start: datetime, end: datetime, label: str) -> str:
    """Summarize events and logs in a time window for analytics commands."""

    events = (
        db.query(models.Event)
        .filter(models.Event.created_at >= start, models.Event.created_at < end)
        .all()
    )

    logs = (
        db.query(models.SystemLog)
        .filter(models.SystemLog.created_at >= start, models.SystemLog.created_at < end)
        .all()
    )

    total_events = len(events)
    type_counts: dict[str, int] = {}
    ai_status_counts: dict[str, int] = {}

    for e in events:
        type_counts[e.event_type] = type_counts.get(e.event_type, 0) + 1
        status = e.ai_status or "none"
        ai_status_counts[status] = ai_status_counts.get(status, 0) + 1

    flame_alerts = sum(1 for l in logs if l.category == "flame")
    gas_alerts = sum(1 for l in logs if l.category == "gas")

    lines = [
        f"AURA {label} Analytics",
        f"Window (UTC): {start.isoformat()} → {end.isoformat()}",
        "",
        f"Total events: {total_events}",
    ]

    if type_counts:
        type_parts = [f"{k}={v}" for k, v in sorted(type_counts.items())]
        lines.append("Events by type: " + ", ".join(type_parts))
    else:
        lines.append("Events by type: none")

    if ai_status_counts:
        ai_parts = [f"{k}={v}" for k, v in sorted(ai_status_counts.items())]
        lines.append("AI analyses: " + ", ".join(ai_parts))
    else:
        lines.append("AI analyses: none")

    lines.append(f"Fire alerts: {flame_alerts}")
    lines.append(f"Gas alerts: {gas_alerts}")

    base_summary = "\n".join(lines)

    # Best-effort AI commentary: this must never break the command.
    try:
        ai_prompt = (
            "You are a security analytics assistant for a small autonomous "
            "rover. Given the following plain-text stats for a "
            f"{label.lower()} window, write 2–4 short bullet points that "
            "highlight security-relevant insights, trends, or anomalies. "
            "Be concise and avoid repeating raw counts verbatim.\n\n"
            "STATS:\n" + base_summary
        )
        ai_result = analyze_text_with_llava(ai_prompt)
        ai_commentary = ai_result.get("content") or ""
        if ai_commentary.strip():
            return base_summary + "\n\nAI insights:\n" + ai_commentary.strip()
    except (LLaVAServerUnavailable, LLaVAError):
        pass

    return base_summary


def _answer_rover_question(db: Session, question: str) -> str:
    """Answer a free-text rover question, with local fallbacks if AI is offline.

    For common questions (e.g. last fire or gas alert, capabilities), we
    answer directly from the database or with canned text. For everything
    else, we build a context from status/logs/events and call LLaVA.
    """

    question = (question or "").strip()
    if not question:
        return "Please ask a question about the AURA rover or its logs."

    lower_q = question.lower()

    # 1) Direct, non-AI answers for specific common questions

    # Capabilities / "what can you do" type questions
    if "what can you do" in lower_q or "what can u do" in lower_q:
        return (
            "I'm AURA, an autonomous security rover. I can monitor fire and gas "
            "alerts, detect edges and obstacles, recognize faces, log events, "
            "run AI analysis on images, and summarize patrol activity and "
            "alerts via commands like /status, /last_ai, /last_event, /analytics."
        )

    # Last fire alert
    if ("fire" in lower_q and "last" in lower_q) or "fire alarm" in lower_q:
        last_fire = (
            db.query(models.SystemLog)
            .filter(models.SystemLog.category == "flame")
            .order_by(models.SystemLog.created_at.desc())
            .first()
        )
        if not last_fire:
            return "I have no recorded fire alerts in my logs yet."
        ts = last_fire.created_at.isoformat() if last_fire.created_at else "an unknown time"
        return (
            f"The last recorded FIRE alert was at {ts}. "
            f"Message: {last_fire.message or 'Flame sensor detected FIRE.'}"
        )

    # Last gas alert
    if ("gas" in lower_q and "last" in lower_q) or "gas alarm" in lower_q:
        last_gas = (
            db.query(models.SystemLog)
            .filter(models.SystemLog.category == "gas")
            .order_by(models.SystemLog.created_at.desc())
            .first()
        )
        if not last_gas:
            return "I have no recorded gas alerts in my logs yet."
        ts = last_gas.created_at.isoformat() if last_gas.created_at else "an unknown time"
        return (
            f"The last recorded GAS alert was at {ts}. "
            f"Message: {last_gas.message or 'Gas level HIGH.'}"
        )

    # Last edge detection
    if "edge" in lower_q and ("last" in lower_q or "detection" in lower_q):
        last_edge = (
            db.query(models.SystemLog)
            .filter(models.SystemLog.category == "edge")
            .order_by(models.SystemLog.created_at.desc())
            .first()
        )
        if not last_edge:
            return "I have no recorded edge detections in my logs yet."
        ts = last_edge.created_at.isoformat() if last_edge.created_at else "an unknown time"
        return (
            f"The last recorded EDGE detection was at {ts}. "
            f"Message: {last_edge.message or 'Edge detected by IR sensor.'}"
        )

    # Last obstacle / ultrasonic detection
    if "obstacle" in lower_q or "ultrasonic" in lower_q or "distance" in lower_q:
        last_obs = (
            db.query(models.SystemLog)
            .filter(models.SystemLog.category == "ultrasonic")
            .order_by(models.SystemLog.created_at.desc())
            .first()
        )
        if not last_obs:
            return "I have no recorded obstacle detections in my logs yet."
        ts = last_obs.created_at.isoformat() if last_obs.created_at else "an unknown time"
        return (
            f"The last recorded OBSTACLE detection was at {ts}. "
            f"Message: {last_obs.message or 'Obstacle detected within critical distance.'}"
        )

    # 2) For all other questions, build context and call LLaVA text analysis.

    status_report = _build_status_report(db)

    logs = (
        db.query(models.SystemLog)
        .order_by(models.SystemLog.created_at.desc())
        .limit(40)
        .all()
    )
    events = (
        db.query(models.Event)
        .order_by(models.Event.created_at.desc())
        .limit(20)
        .all()
    )

    log_lines: list[str] = []
    for log in reversed(logs):  # oldest first
        ts = log.created_at.isoformat() if log.created_at else ""
        src = log.source or "backend"
        cat = log.category or "-"
        msg = log.message or ""
        log_lines.append(f"{ts} [{log.level}] {src} ({cat}): {msg}")

    event_lines: list[str] = []
    for e in reversed(events):  # oldest first
        ts = e.created_at.isoformat() if e.created_at else ""
        ai = e.ai_status or "none"
        short = (e.ai_summary_short or "").strip()
        if len(short) > 120:
            short = short[:117].rstrip() + "..."
        event_lines.append(
            f"{ts} type={e.event_type} source={e.source or '-'} ai={ai}: {short}"
        )

    context_parts = [
        "STATUS:",
        status_report,
        "",
        "RECENT_LOGS:",
        *(log_lines or ["(no recent logs)"]),
        "",
        "RECENT_EVENTS:",
        *(event_lines or ["(no recent events)"]),
    ]
    context = "\n".join(context_parts)

    prompt = (
        "You are the AURA security rover assistant. You must answer "
        "ONLY about the rover, its sensors, alerts, patrols, and logs. "
        "Use ONLY the information in the provided CONTEXT. If the "
        "question cannot be answered from this context or is about "
        "unrelated topics (general knowledge, personal advice, etc.), "
        "respond exactly with: 'I don't know based on current rover data.'\n\n"
        "Keep answers concise (2–6 short sentences or bullet points).\n\n"
        f"QUESTION:\n{question}\n\nCONTEXT:\n{context}"
    )

    try:
        ai_result = analyze_text_with_llava(prompt)
    except LLaVAServerUnavailable:
        return "AI analysis server is currently unavailable; basic rover telemetry remains active."
    except LLaVAError:
        return "AI log analysis failed. Please try again later."

    content = (ai_result.get("content") or "").strip()
    if not content:
        return "I don't know based on current rover data."
    return content


def _telegram_get_updates(api_base: str, offset: Optional[int]) -> List[dict]:
    params = {"timeout": 30}
    if offset is not None:
        params["offset"] = offset

    try:
        resp = requests.get(f"{api_base}/getUpdates", params=params, timeout=35)
        resp.raise_for_status()
        data = resp.json()
        return data.get("result", []) or []
    except Exception:
        return []


def _telegram_polling_loop() -> None:
    """Background loop that polls Telegram for bot commands.

    Currently supports the /last_ai command, which triggers sending the
    latest AI-enhanced event to Telegram. Runs in a separate daemon
    thread so it does not block the FastAPI event loop.
    """

    token = TELEGRAM_BOT_TOKEN
    if not token:
        # Bot not configured; nothing to do.
        return

    api_base = f"https://api.telegram.org/bot{token}"
    offset: Optional[int] = None

    while True:
        updates = _telegram_get_updates(api_base, offset)
        for update in updates:
            update_id = update.get("update_id")
            if isinstance(update_id, int):
                offset = update_id + 1

            message = update.get("message") or {}
            text = (message.get("text") or "").strip()
            if not text:
                continue

            # Normalize command: take the first token, strip bot mention,
            # and lowercase so variants like `/analytics_week@BotName` work.
            first_token = text.split()[0]
            cmd = first_token.split("@")[0].lower()

            if cmd == "/last_ai":
                # Use a short-lived DB session for this command.
                db = SessionLocal()
                try:
                    _send_latest_ai_event_to_telegram(db)
                finally:
                    db.close()
            elif cmd == "/last_event":
                db = SessionLocal()
                try:
                    event = (
                        db.query(models.Event)
                        .order_by(models.Event.created_at.desc())
                        .first()
                    )

                    if not event:
                        send_telegram_message("No events have been recorded yet.")
                    else:
                        created_iso = event.created_at.isoformat() if event.created_at else ""
                        header = "AURA Last Event\n"
                        meta_line = f"Type: {event.event_type} | Time: {created_iso}\nAI status: {event.ai_status or 'none'}\n\n"
                        body = event.ai_summary_short or event.ai_summary_long or "(no AI summary; raw event only)"
                        caption = header + meta_line + body

                        image_bytes = None
                        if event.image_path:
                            try:
                                abs_path = MEDIA_ROOT / event.image_path
                                with abs_path.open("rb") as f:
                                    image_bytes = f.read()
                            except Exception:
                                image_bytes = None

                        if image_bytes:
                            send_telegram_photo(image_bytes, caption)
                        else:
                            send_telegram_message(caption)
                finally:
                    db.close()
            elif cmd in ("/analyze", "/what_do_you_see"):
                db = SessionLocal()
                try:
                    event, succeeded, msg = _analyze_latest_event_image(db)
                    if not succeeded:
                        send_telegram_message(f"🤖 AURA AI Analysis\n{msg}")
                    else:
                        _send_latest_ai_event_to_telegram(db)
                finally:
                    db.close()
            elif cmd == "/status":
                db = SessionLocal()
                try:
                    report = _build_status_report(db)
                finally:
                    db.close()
                send_telegram_message(report)
            elif cmd in (
                "/analytics",
                "/analetics",
                "/analytics_week",
                "/analetics_week",
                "/analytics_month",
                "/analetics_month",
                "/analytics_year",
                "/analetics_year",
            ):
                db = SessionLocal()
                try:
                    now = datetime.utcnow()
                    # Default: last 24 hours
                    if cmd.endswith("_week"):
                        start = now - timedelta(days=7)
                        label = "Weekly"
                    elif cmd.endswith("_month"):
                        start = now - timedelta(days=30)
                        label = "Monthly"
                    elif cmd.endswith("_year"):
                        start = now - timedelta(days=365)
                        label = "Yearly"
                    else:
                        start = now - timedelta(days=1)
                        label = "Daily"

                    summary = _build_analytics_summary(db, start, now, label)
                finally:
                    db.close()

                send_telegram_message(summary)

            else:
                # Treat any non-command text as a rover/log question for AI,
                # but ignore unknown slash-commands instead of replying.
                if first_token.startswith("/"):
                    continue

                lowered = text.lower()

                # First handle explicit request for last unknown/stranger
                # person image (be tolerant to minor typos like "unknow").
                if (
                    any(k in lowered for k in ("unknown", "unknow", "stranger", "intruder"))
                    and any(k in lowered for k in ("person", "face"))
                    and any(w in lowered for w in ("image", "photo", "picture", "pic", "snapshot"))
                ):
                    db = SessionLocal()
                    try:
                        event = (
                            db.query(models.Event)
                            .filter(
                                models.Event.event_type == "unknown_face",
                                models.Event.image_path.isnot(None),
                            )
                            .order_by(models.Event.created_at.desc())
                            .first()
                        )
                    finally:
                        db.close()

                    if not event:
                        send_telegram_message(
                            "I don't have any unknown person snapshots recorded yet."
                        )
                        continue

                    created_iso = event.created_at.isoformat() if event.created_at else ""
                    header = "🤖 AURA Last Unknown Person\n"
                    meta = f"Time: {created_iso}\nType: {event.event_type}\nAI status: {event.ai_status or 'none'}\n\n"
                    body = (
                        event.ai_summary_short
                        or event.ai_summary_long
                        or "Snapshot captured when an unknown face was detected."
                    )
                    caption = header + meta + body

                    image_bytes = None
                    if event.image_path:
                        try:
                            abs_path = MEDIA_ROOT / event.image_path
                            with abs_path.open("rb") as f:
                                image_bytes = f.read()
                        except Exception:
                            image_bytes = None

                    if image_bytes:
                        send_telegram_photo(image_bytes, caption)
                    else:
                        send_telegram_message(
                            caption
                            + "\n\n(Note: I couldn't load the stored image file from disk.)"
                        )

                    continue

                # Next handle simple greetings or identity questions with
                # a fast canned response so users get instant feedback
                # without waiting for AI.
                stripped = lowered.replace("!", "").replace(".", "").strip()
                if stripped in {"hi", "hello", "hey", "yo", "hola"} or "who are you" in lowered:
                    send_telegram_message(
                        "Hello, I'm AURA — your autonomous security rover assistant. "
                        "I watch sensors, patrol logs, and AI events. "
                        "Ask me things like 'When was the last fire alarm?' "
                        "or use commands like /status, /last_ai, /last_event, /analytics."
                    )
                    continue

                # For all other plain-text messages, call the rover/log QA
                # AI with a quick 'checking' message first.
                send_telegram_message("Checking rover logs with local AI…")

                db = SessionLocal()
                try:
                    answer = _answer_rover_question(db, text)
                except Exception:
                    answer = (
                        "I couldn't analyze the rover data right now. "
                        "Basic telemetry remains active."
                    )
                finally:
                    db.close()

                send_telegram_message(answer)

        # Avoid a tight loop when there are no updates
        time.sleep(1)


app.include_router(auth_routes.router)


@app.get('/')
def read_root():
    return {"message": "Auth backend is running"}


@app.post("/patrol-sessions/start")
def start_patrol_session(
    payload: dict = Body(None),
    db: Session = Depends(get_db),
):
    """Create a new patrol session when patrol mode is started.

    The current firmware does not expose continuous video recording, so this
    session is primarily a time window used to summarize events and logs.
    """

    now = datetime.utcnow()
    patrol_path_id = None
    patrol_path_name = None

    if payload:
        patrol_path_id = payload.get("patrol_path_id")
        if patrol_path_id:
            path = (
                db.query(models.PatrolPath)
                .filter(models.PatrolPath.id == patrol_path_id)
                .first()
            )
            if path is not None:
                patrol_path_name = path.name

    # Mark any existing active sessions as completed to avoid overlaps
    try:
        active_sessions = (
            db.query(models.PatrolSession)
            .filter(models.PatrolSession.status == "active")
            .all()
        )
        for s in active_sessions:
            s.status = "completed"
            if s.end_time is None:
                s.end_time = now
    except Exception:
        pass

    session = models.PatrolSession(
        start_time=now,
        end_time=None,
        patrol_path_id=patrol_path_id,
        patrol_path_name=patrol_path_name,
        status="active",
        ai_status=None,
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    add_system_log(
        db,
        level="info",
        source="backend",
        category="patrol",
        message="Patrol session started",
        data={"session_id": session.id, "patrol_path_id": patrol_path_id},
    )

    return {
        "id": session.id,
        "start_time": session.start_time,
        "status": session.status,
        "patrol_path_id": session.patrol_path_id,
        "patrol_path_name": session.patrol_path_name,
    }


@app.post("/patrol-sessions/stop")
def stop_patrol_session(db: Session = Depends(get_db)):
    """Mark the latest active patrol session as completed when patrol stops."""

    now = datetime.utcnow()
    session = (
        db.query(models.PatrolSession)
        .filter(models.PatrolSession.status == "active")
        .order_by(models.PatrolSession.start_time.desc())
        .first()
    )

    if not session:
        raise HTTPException(status_code=404, detail="No active patrol session found.")

    session.status = "completed"
    session.end_time = now
    db.commit()
    db.refresh(session)

    add_system_log(
        db,
        level="info",
        source="backend",
        category="patrol",
        message="Patrol session stopped",
        data={"session_id": session.id},
    )

    return {
        "id": session.id,
        "start_time": session.start_time,
        "end_time": session.end_time,
        "status": session.status,
    }


@app.post("/rover/patrol/set")
def rover_patrol_set(steps: list = Body(...)):
    """Proxy patrol path to the ESP32 rover to avoid browser CORS issues."""

    if not ESP32_ROVER_API:
        raise HTTPException(status_code=503, detail="ESP32_ROVER_API is not configured on the backend.")

    try:
        url = ESP32_ROVER_API.rstrip("/") + "/patrol/set"
        # Send JSON body; ESP32 firmware should parse this.
        resp = requests.post(url, json=steps, timeout=5)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Rover not reachable for patrol/set: {exc}") from exc

    if not resp.ok:
        raise HTTPException(status_code=502, detail=f"Rover patrol/set failed with HTTP {resp.status_code}.")

    # Best-effort parse of rover response; fall back to generic message.
    try:
        data = resp.json()
    except Exception:
        data = {}

    return {
        "status": "ok",
        "steps": data.get("steps"),
        "raw": data,
    }


@app.post("/rover/patrol/start")
def rover_patrol_start():
    """Proxy patrol/start to the ESP32 rover."""

    if not ESP32_ROVER_API:
        raise HTTPException(status_code=503, detail="ESP32_ROVER_API is not configured on the backend.")

    try:
        url = ESP32_ROVER_API.rstrip("/") + "/patrol/start"
        resp = requests.post(url, timeout=5)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Rover not reachable for patrol/start: {exc}") from exc

    if not resp.ok:
        raise HTTPException(status_code=502, detail=f"Rover patrol/start failed with HTTP {resp.status_code}.")

    try:
        data = resp.json()
    except Exception:
        data = {}

    return {
        "status": "ok",
        "state": data.get("state") or "Patrol started.",
    }


@app.post("/rover/patrol/stop")
def rover_patrol_stop():
    """Proxy patrol/stop to the ESP32 rover."""

    if not ESP32_ROVER_API:
        raise HTTPException(status_code=503, detail="ESP32_ROVER_API is not configured on the backend.")

    try:
        url = ESP32_ROVER_API.rstrip("/") + "/patrol/stop"
        resp = requests.post(url, timeout=5)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Rover not reachable for patrol/stop: {exc}") from exc

    if not resp.ok:
        raise HTTPException(status_code=502, detail=f"Rover patrol/stop failed with HTTP {resp.status_code}.")

    try:
        data = resp.json()
    except Exception:
        data = {}

    return {
        "status": "ok",
        "state": data.get("state") or "Patrol stopped.",
    }


@app.post("/alert/fire")
def fire_alert(db: Session = Depends(get_db)):
    """Trigger a fire alert and send a Telegram notification if configured.

    This endpoint is intended to be called when the flame sensor detects fire.
    """
    sent = send_telegram_message("🔥 FIRE ALERT!\nImmediate action required.")
    add_system_log(
        db,
        level="alert",
        source="backend",
        category="flame",
        message="Fire alert triggered; Telegram notification %s" % ("sent" if sent else "skipped"),
    )
    return {"status": "Fire alert processed", "telegram_sent": sent}


@app.post("/alert/gas")
def gas_alert(db: Session = Depends(get_db)):
    """Trigger a gas alert and send a Telegram notification if configured.

    This endpoint is intended to be called when gas levels exceed the threshold.
    """
    sent = send_telegram_message("☣️ GAS ALERT!\nUnsafe gas levels detected.")
    add_system_log(
        db,
        level="warning",
        source="backend",
        category="gas",
        message="Gas alert triggered; Telegram notification %s" % ("sent" if sent else "skipped"),
    )
    return {"status": "Gas alert processed", "telegram_sent": sent}


@app.post("/ai/analyze-image")
async def ai_analyze_image(
    file: UploadFile = File(...),
    prompt: str = Form("Analyze this image like a security surveillance system."),
    db: Session = Depends(get_db),
):
    """Run LLaVA analysis on an uploaded image.

    This is the main bridge from the Mac backend to the LLaVA server
    running on the ROG laptop. It is intentionally simple for now and
    will later be extended to plug into the event / alert system.
    """

    if file.content_type not in {"image/jpeg", "image/png", "image/jpg"}:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Please upload a JPG or PNG image.",
        )

    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Empty file uploaded.")

    try:
        result = analyze_image_with_llava(image_bytes, prompt=prompt)
    except LLaVAServerUnavailable as exc:
        # Log but do not crash the backend – callers can fall back
        add_system_log(
            db,
            level="warning",
            source="backend",
            category="ai_llava",
            message="LLaVA server unavailable during image analysis",
            data={"error": str(exc)},
        )
        raise HTTPException(
            status_code=503,
            detail="AI analysis server is unavailable. Basic alerts remain active.",
        ) from exc
    except LLaVAError as exc:
        add_system_log(
            db,
            level="error",
            source="backend",
            category="ai_llava",
            message="LLaVA analysis failed",
            data={"error": str(exc)},
        )
        raise HTTPException(
            status_code=500,
            detail="AI analysis failed. Please try again later.",
        ) from exc

    add_system_log(
        db,
        level="info",
        source="backend",
        category="ai_llava",
        message="LLaVA image analysis succeeded",
        data={"latency_ms": result.get("latency_ms")},
    )

    return {
        "prompt": prompt,
        "analysis": result.get("content"),
        "latency_ms": result.get("latency_ms"),
    }


@app.get("/events/latest-ai")
def get_latest_ai_event(db: Session = Depends(get_db)):
    """Return the most recent event that has an AI summary.

    This is a simple read API for the frontend and Telegram bot to
    display the latest AI-enhanced event (image, summaries, metadata).
    """

    event = (
        db.query(models.Event)
        .filter(models.Event.ai_summary_long.isnot(None))
        .order_by(models.Event.created_at.desc())
        .first()
    )

    if not event:
        raise HTTPException(status_code=404, detail="No AI-enhanced events found.")

    image_url = None
    if event.image_path:
        image_url = f"/media/{event.image_path.lstrip('/')}"

    return {
        "id": event.id,
        "created_at": event.created_at,
        "event_type": event.event_type,
        "source": event.source,
        "image_url": image_url,
        "metadata": event.metadata_json,
        "ai_status": event.ai_status,
        "ai_summary_short": event.ai_summary_short,
        "ai_summary_long": event.ai_summary_long,
        "ai_latency_ms": event.ai_latency_ms,
        "ai_model": event.ai_model,
    }


@app.get("/analytics/summary")
def get_analytics_summary(
    window: str = Query(
        "day",
        pattern="^(day|week|month|year)$",
        description="Time window for analytics: day, week, month, year",
    ),
    db: Session = Depends(get_db),
):
    """Return structured analytics for the requested time window.

    This endpoint mirrors the data used by the Telegram /analytics
    commands but returns it as JSON for use by the web dashboard.
    """

    now = datetime.utcnow()
    if window == "week":
        start = now - timedelta(days=7)
        label = "Weekly"
    elif window == "month":
        start = now - timedelta(days=30)
        label = "Monthly"
    elif window == "year":
        start = now - timedelta(days=365)
        label = "Yearly"
    else:
        start = now - timedelta(days=1)
        label = "Daily"

    events = (
        db.query(models.Event)
        .filter(models.Event.created_at >= start, models.Event.created_at < now)
        .all()
    )

    logs = (
        db.query(models.SystemLog)
        .filter(models.SystemLog.created_at >= start, models.SystemLog.created_at < now)
        .all()
    )

    total_events = len(events)
    type_counts: dict[str, int] = {}
    ai_status_counts: dict[str, int] = {}

    for e in events:
        type_counts[e.event_type] = type_counts.get(e.event_type, 0) + 1
        status = e.ai_status or "none"
        ai_status_counts[status] = ai_status_counts.get(status, 0) + 1

    flame_alerts = sum(1 for l in logs if l.category == "flame")
    gas_alerts = sum(1 for l in logs if l.category == "gas")

    payload = {
        "window_label": label,
        "window": window,
        "start_utc": start.isoformat() + "Z",
        "end_utc": now.isoformat() + "Z",
        "total_events": total_events,
        "events_by_type": type_counts,
        "ai_status_counts": ai_status_counts,
        "fire_alerts": flame_alerts,
        "gas_alerts": gas_alerts,
    }

    # Optional AI commentary, best-effort only.
    try:
        base_lines = [
            f"Total events: {total_events}",
            "Events by type: "
            + (", ".join(f"{k}={v}" for k, v in sorted(type_counts.items())) or "none"),
            "AI analyses: "
            + (", ".join(f"{k}={v}" for k, v in sorted(ai_status_counts.items())) or "none"),
            f"Fire alerts: {flame_alerts}",
            f"Gas alerts: {gas_alerts}",
        ]
        stats_text = "\n".join(base_lines)
        ai_prompt = (
            "You are a security analytics assistant for a small autonomous "
            "rover. Given the following stats for a "
            f"{label.lower()} window, write 2–4 short bullet points that "
            "highlight security-relevant insights, trends, or anomalies. "
            "Keep each bullet under 120 characters.\n\nSTATS:\n" + stats_text
        )
        ai_result = analyze_text_with_llava(ai_prompt)
        ai_commentary = (ai_result.get("content") or "").strip()
        if ai_commentary:
            payload["ai_insights"] = ai_commentary
    except (LLaVAServerUnavailable, LLaVAError):
        payload["ai_insights"] = None

    return payload


@app.post("/telegram/last-ai")
def telegram_last_ai(db: Session = Depends(get_db)):
    """Send the latest AI-enhanced event to Telegram.

    This endpoint looks up the most recent event with an AI summary and
    sends it to the configured Telegram chat as either a photo with
    caption (if an image is available) or a plain-text message.

    You can wire the /last_ai bot command to call this endpoint.
    """

    event, sent = _send_latest_ai_event_to_telegram(db)

    if not event:
        raise HTTPException(status_code=404, detail="No AI-enhanced events found.")

    if not sent:
        raise HTTPException(
            status_code=503,
            detail="Failed to send Telegram message. Check bot token and chat id.",
        )

    return {"status": "ok", "event_id": event.id, "telegram_sent": True}


@app.get("/patrol-sessions")
def list_patrol_sessions(limit: int = 50, db: Session = Depends(get_db)):
    """Return recent patrol sessions with basic AI summary for the UI."""

    safe_limit = max(1, min(limit, 200))
    sessions = (
        db.query(models.PatrolSession)
        .order_by(models.PatrolSession.start_time.desc())
        .limit(safe_limit)
        .all()
    )

    result = []
    for s in sessions:
        result.append(
            {
                "id": s.id,
                "start_time": s.start_time,
                "end_time": s.end_time,
                "status": s.status,
                "patrol_path_id": s.patrol_path_id,
                "patrol_path_name": s.patrol_path_name,
                "ai_status": s.ai_status,
                "ai_summary_short": s.ai_summary_short,
            }
        )

    return result


@app.post("/patrol-sessions/{session_id}/analyze")
def analyze_patrol_session(session_id: int, db: Session = Depends(get_db)):
    """Run AI analysis over events/logs in a patrol session time window."""

    session = db.query(models.PatrolSession).filter(models.PatrolSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Patrol session not found.")

    if not session.end_time:
        session.end_time = datetime.utcnow()

    base_summary = _build_patrol_session_summary(db, session)

    try:
        ai_prompt = (
            "You are a security patrol analyst for an autonomous rover. "
            "Given the following patrol window summary (events and logs), "
            "write 3–6 short lines that describe what happened during this "
            "patrol, highlighting any alerts, anomalies, or important "
            "observations. Be concise and avoid repeating raw counts.\n\n"
            "PATROL STATS:\n" + base_summary
        )
        ai_result = analyze_text_with_llava(ai_prompt)
        content = (ai_result.get("content") or "").strip()
    except LLaVAServerUnavailable as exc:
        session.ai_status = "unavailable"
        db.commit()
        add_system_log(
            db,
            level="warning",
            source="backend",
            category="ai_llava",
            message="LLaVA unavailable for patrol session analysis",
            data={"session_id": session.id, "error": str(exc)},
        )
        raise HTTPException(
            status_code=503,
            detail="AI analysis server is unavailable; patrol stats are still recorded.",
        )
    except LLaVAError as exc:
        session.ai_status = "failed"
        db.commit()
        add_system_log(
            db,
            level="error",
            source="backend",
            category="ai_llava",
            message="LLaVA patrol session analysis failed",
            data={"session_id": session.id, "error": str(exc)},
        )
        raise HTTPException(
            status_code=500,
            detail="AI analysis failed for this patrol session.",
        )

    if not content:
        session.ai_status = "failed"
        db.commit()
        raise HTTPException(status_code=500, detail="Empty AI response for patrol session.")

    short = _build_ai_short_alert(content)

    session.ai_status = "succeeded"
    session.ai_summary_short = short
    session.ai_summary_long = content
    session.ai_model = LLAVA_MODEL_NAME
    # latency is not tracked precisely here; leave as None
    try:
        session.ai_raw = json.dumps({"base_summary": base_summary, "ai": content})
    except Exception:
        session.ai_raw = None

    db.commit()

    add_system_log(
        db,
        level="info",
        source="backend",
        category="ai_llava",
        message="Patrol session analysis succeeded",
        data={"session_id": session.id},
    )

    return {
        "id": session.id,
        "start_time": session.start_time,
        "end_time": session.end_time,
        "status": session.status,
        "ai_status": session.ai_status,
        "ai_summary_short": session.ai_summary_short,
        "ai_summary_long": session.ai_summary_long,
    }


@app.post("/face-recognition")
async def face_recognition_endpoint(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Accept an uploaded image and run YOLO-based face recognition.

    Detects faces using YOLO, computes a simple embedding for each face,
    and compares against stored embeddings of known people to find the
    closest match per detected face.
    """
    if file.content_type not in {"image/jpeg", "image/png", "image/jpg"}:
        raise HTTPException(status_code=400, detail="Unsupported file type. Please upload a JPG or PNG image.")

    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Empty file uploaded.")

    try:
        detections = detect_faces(image_bytes)
        embeddings = compute_embeddings_for_detections(image_bytes, detections)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        raise HTTPException(status_code=500, detail="Error running face recognition model.")

    # Load known people and their embeddings
    known = (
        db.query(models.FaceEmbedding, models.Person)
        .join(models.Person, models.FaceEmbedding.person_id == models.Person.id)
        .all()
    )

    import numpy as np

    # Group embeddings by person and compute a single representative vector per person
    person_vectors = {}
    for emb_row, person in known:
        try:
            vec = parse_embedding(emb_row.embedding)
        except Exception:
            continue
        if person.name not in person_vectors:
            person_vectors[person.name] = []
        person_vectors[person.name].append(vec)

    # If no known people, mark everything as unknown
    if not person_vectors:
        for det in detections:
            det["person_name"] = "Unknown"
            det["distance"] = None
            det["match_score"] = 0.0

        # log the detection attempt
        add_system_log(
            db,
            level="info",
            source="backend",
            category="face_recognition",
            message="Face recognition called with no known people registered",
            data={"count": len(detections)},
        )
        return {"count": len(detections), "detections": detections}

    person_names = list(person_vectors.keys())
    person_mean_vectors = []
    for name in person_names:
        vecs = person_vectors[name]
        mean_vec = np.mean(np.stack(vecs, axis=0), axis=0)
        norm = np.linalg.norm(mean_vec) + 1e-8
        person_mean_vectors.append(mean_vec / norm)

    # Prepare query vectors for detections
    query_vectors = []
    valid_indices = []
    for idx, emb_list in enumerate(embeddings):
        if not emb_list:
            query_vectors.append(None)
            continue
        q = np.array(emb_list, dtype="float32")
        norm = np.linalg.norm(q) + 1e-8
        query_vectors.append(q / norm)
        valid_indices.append(idx)

    # Initialize defaults
    for det in detections:
        det["person_name"] = "Unknown"
        det["distance"] = None
        det["match_score"] = 0.0

    # If no valid embeddings for detections, return all unknown
    if not valid_indices:
        return {"count": len(detections), "detections": detections}

    # Build distance matrix (detections x persons)
    distances = np.full((len(detections), len(person_names)), np.inf, dtype="float32")
    for i, q in enumerate(query_vectors):
        if q is None:
            continue
        for j, p_vec in enumerate(person_mean_vectors):
            distances[i, j] = float(np.linalg.norm(q - p_vec))

    # Greedy one-to-one assignment: each detection and each person used at most once
    assigned_dets = set()
    assigned_persons = set()

    while True:
        best_i = None
        best_j = None
        best_dist = float("inf")

        for i in range(len(detections)):
            if i in assigned_dets or query_vectors[i] is None:
                continue
            for j in range(len(person_names)):
                if j in assigned_persons:
                    continue
                d = float(distances[i, j])
                if d < best_dist:
                    best_dist = d
                    best_i = i
                    best_j = j

        if best_i is None or best_j is None:
            break

        # If closest distance is still too large, stop assigning more (remaining are intruders)
        if best_dist > MATCH_DISTANCE_THRESHOLD:
            break

        name = person_names[best_j]
        match_score = max(0.0, 1.0 - (best_dist / MATCH_DISTANCE_THRESHOLD))

        # Always expose distance and match_score for the best candidate,
        # even if we ultimately treat it as Unknown below the confidence
        # threshold. This lets the frontend show e.g. 30% confidence.
        detections[best_i]["distance"] = best_dist
        detections[best_i]["match_score"] = match_score

        # Only assign a concrete person_name if confidence is high enough;
        # otherwise we leave it as "Unknown" but still record the score.
        if match_score >= MIN_MATCH_SCORE:
            detections[best_i]["person_name"] = name

        assigned_dets.add(best_i)
        assigned_persons.add(best_j)

    # log summary of this recognition call
    try:
        summary = {
            "total_detections": len(detections),
            "assigned": [
                {
                    "name": d.get("person_name"),
                    "score": d.get("match_score"),
                }
                for d in detections
            ],
        }
    except Exception:
        summary = {"total_detections": len(detections)}

    add_system_log(
        db,
        level="info",
        source="backend",
        category="face_recognition",
        message="Face recognition processed image",
        data=summary,
    )
    # If any detected face is Unknown, create an Event and attempt AI analysis.
    try:
        has_unknown = any(d.get("person_name") == "Unknown" for d in detections)
    except Exception:
        has_unknown = False

    if has_unknown:
        # Persist the snapshot under media/events for later inspection and UI/Telegram use.
        ts = datetime.utcnow().strftime("%Y%m%dT%H%M%S%fZ")
        _, ext = os.path.splitext(file.filename or "")
        if not ext:
            ext = ".jpg"
        filename = f"{ts}_unknown_face{ext}"
        rel_path = f"events/{filename}"
        abs_path = EVENT_MEDIA_ROOT / filename

        try:
            abs_path.parent.mkdir(parents=True, exist_ok=True)
            with abs_path.open("wb") as f_out:
                f_out.write(image_bytes)
        except Exception:
            # Snapshot storage is best-effort; do not break the main API.
            rel_path = None

        # Create the Event record
        try:
            event_metadata = {
                "total_detections": len(detections),
                "assigned": [
                    {
                        "name": d.get("person_name"),
                        "score": d.get("match_score"),
                    }
                    for d in detections
                ],
            }
        except Exception:
            event_metadata = {"total_detections": len(detections)}

        event = models.Event(
            event_type="unknown_face",
            source="backend",
            image_path=rel_path,
            metadata_json=json.dumps(event_metadata),
            ai_status="processing",
        )
        try:
            db.add(event)
            db.commit()
            db.refresh(event)
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass
            event = None

        # Best-effort inline AI analysis using LLaVA. Any failure should
        # not affect the main face recognition response.
        if event is not None:
            try:
                ai_prompt = (
                    "Analyze this image like a security surveillance system. "
                    "Focus on whether the detected faces might be known or "
                    "unknown persons and describe any security-relevant context."
                )
                ai_result = analyze_image_with_llava(image_bytes, prompt=ai_prompt)
                content = ai_result.get("content") or ""
                short = _build_ai_short_alert(content)

                event.ai_status = "succeeded"
                event.ai_summary_short = short
                event.ai_summary_long = content
                try:
                    event.ai_raw = json.dumps(ai_result.get("raw"))
                except Exception:
                    event.ai_raw = None
                event.ai_latency_ms = ai_result.get("latency_ms")
                event.ai_model = LLAVA_MODEL_NAME
                db.commit()

                add_system_log(
                    db,
                    level="info",
                    source="backend",
                    category="ai_llava",
                    message="LLaVA analysis for unknown_face event succeeded",
                    data={
                        "event_id": event.id,
                        "latency_ms": event.ai_latency_ms,
                    },
                )
            except LLaVAServerUnavailable as exc:
                try:
                    event.ai_status = "unavailable"
                    db.commit()
                except Exception:
                    try:
                        db.rollback()
                    except Exception:
                        pass

                add_system_log(
                    db,
                    level="warning",
                    source="backend",
                    category="ai_llava",
                    message="LLaVA server unavailable for unknown_face event",
                    data={"event_id": getattr(event, "id", None), "error": str(exc)},
                )
            except LLaVAError as exc:
                try:
                    event.ai_status = "failed"
                    db.commit()
                except Exception:
                    try:
                        db.rollback()
                    except Exception:
                        pass

                add_system_log(
                    db,
                    level="error",
                    source="backend",
                    category="ai_llava",
                    message="LLaVA analysis failed for unknown_face event",
                    data={"event_id": getattr(event, "id", None), "error": str(exc)},
                )

            # After AI processing (or failure), best-effort Telegram alert
            # with the snapshot of the unknown person.
            try:
                created_iso = event.created_at.isoformat() if event.created_at else ""
                header = "🤖 AURA Unknown Face Detected\n"
                meta = f"Time: {created_iso}\n\n"
                body = (
                    event.ai_summary_short
                    or event.ai_summary_long
                    or "An unknown face was detected by the rover."
                )
                caption = header + meta + body

                image_bytes_for_telegram = None
                if event.image_path:
                    try:
                        abs_path = MEDIA_ROOT / event.image_path
                        with abs_path.open("rb") as f_img:
                            image_bytes_for_telegram = f_img.read()
                    except Exception:
                        image_bytes_for_telegram = None

                # Fallback to the just-processed upload bytes
                if image_bytes_for_telegram is None:
                    image_bytes_for_telegram = image_bytes

                if image_bytes_for_telegram:
                    send_telegram_photo(image_bytes_for_telegram, caption)
                else:
                    send_telegram_message(caption)
            except Exception:
                # Never let Telegram errors break the main flow
                pass

    return {"count": len(detections), "detections": detections}


@app.post("/people")
async def register_person(
    name: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Register a new person with an example face image.

    Uses YOLO + simple embedding to store a reference vector for later
    recognition.
    """
    if file.content_type not in {"image/jpeg", "image/png", "image/jpg"}:
        raise HTTPException(status_code=400, detail="Unsupported file type. Please upload a JPG or PNG image.")

    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Empty file uploaded.")

    try:
        detections = detect_faces(image_bytes)
        if not detections:
            raise HTTPException(status_code=400, detail="No face detected in the image.")
        embeddings = compute_embeddings_for_detections(image_bytes, detections)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Error processing face image.")

    # Use the first valid embedding
    emb_vec = None
    for emb in embeddings:
        if emb:
            emb_vec = emb
            break

    if emb_vec is None:
        raise HTTPException(status_code=400, detail="Could not compute a face embedding.")

    # Create or get person
    person = db.query(models.Person).filter(models.Person.name == name).first()
    if person is None:
        person = models.Person(name=name)
        db.add(person)
        db.commit()
        db.refresh(person)

    emb_row = models.FaceEmbedding(person_id=person.id, embedding=json.dumps(emb_vec))
    db.add(emb_row)
    db.commit()
    db.refresh(emb_row)

    # Save a reference image for this person (overwrite if it already exists)
    ext_map = {"image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png"}
    ext = ext_map.get(file.content_type, ".jpg")
    # Remove old files with other extensions
    for old_ext in (".jpg", ".jpeg", ".png"):
        old_path = PEOPLE_MEDIA_ROOT / f"{person.id}{old_ext}"
        if old_path.exists():
            try:
                old_path.unlink()
            except OSError:
                pass
    image_path = PEOPLE_MEDIA_ROOT / f"{person.id}{ext}"
    try:
        with open(image_path, "wb") as f:
            f.write(image_bytes)
    except OSError:
        # If saving fails, continue without image
        image_path = None

    image_url = None
    if image_path is not None and image_path.exists():
        image_url = f"/media/people/{person.id}{image_path.suffix}"

    return {"id": person.id, "name": person.name, "image_url": image_url}


@app.get("/people")
def list_people(db: Session = Depends(get_db)):
    people = db.query(models.Person).all()

    result = []
    for p in people:
        image_url = None
        for ext in (".jpg", ".jpeg", ".png"):
            candidate = PEOPLE_MEDIA_ROOT / f"{p.id}{ext}"
            if candidate.exists():
                image_url = f"/media/people/{p.id}{ext}"
                break
        result.append({"id": p.id, "name": p.name, "image_url": image_url})

    return result


@app.get("/patrol-paths")
def list_patrol_paths(db: Session = Depends(get_db)):
    paths = db.query(models.PatrolPath).order_by(models.PatrolPath.created_at.desc()).all()
    result = []
    for p in paths:
        # Decode steps
        try:
            steps = json.loads(p.steps)
        except Exception:
            steps = []

        # Interpret schedule_from as JSON list of times when present;
        # fall back to splitting on commas for older data.
        slots: list[str] = []
        raw = p.schedule_from
        if raw:
            try:
                maybe_list = json.loads(raw)
                if isinstance(maybe_list, list):
                    slots = [str(x) for x in maybe_list]
                else:
                    slots = [s.strip() for s in str(raw).split(",") if s.strip()]
            except Exception:
                slots = [s.strip() for s in str(raw).split(",") if s.strip()]

        result.append(
            {
                "id": p.id,
                "name": p.name,
                "steps": steps,
                "schedule_slots": slots,
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }
        )

    return result


@app.post("/patrol-paths")
def create_patrol_path(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
):
    name = (payload.get("name") or "").strip()
    steps = payload.get("steps") or []
    # schedule is optional; can be configured later via a separate endpoint
    schedule_from = None
    schedule_to = None

    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    if not isinstance(steps, list) or not steps:
        raise HTTPException(status_code=400, detail="At least one step is required")

    # Ensure unique name
    existing = db.query(models.PatrolPath).filter(models.PatrolPath.name == name).first()
    if existing is not None:
        raise HTTPException(status_code=400, detail="A patrol path with this name already exists")

    try:
        steps_json = json.dumps(steps)
    except TypeError:
        raise HTTPException(status_code=400, detail="Steps must be JSON-serializable")

    path = models.PatrolPath(
        name=name,
        steps=steps_json,
        schedule_from=schedule_from,
        schedule_to=schedule_to,
    )
    db.add(path)
    db.commit()
    db.refresh(path)

    return {
        "id": path.id,
        "name": path.name,
        "steps": steps,
        "schedule_from": path.schedule_from,
        "schedule_to": path.schedule_to,
        "created_at": path.created_at.isoformat() if path.created_at else None,
    }


@app.delete("/patrol-paths/{path_id}")
def delete_patrol_path(path_id: int, db: Session = Depends(get_db)):
    path = db.query(models.PatrolPath).filter(models.PatrolPath.id == path_id).first()
    if path is None:
        raise HTTPException(status_code=404, detail="Patrol path not found")

    db.delete(path)
    db.commit()

    return {"status": "deleted", "id": path_id}


@app.patch("/patrol-paths/{path_id}/schedule")
def update_patrol_path_schedule(
    path_id: int,
    payload: dict = Body(...),
    db: Session = Depends(get_db),
):
    path = db.query(models.PatrolPath).filter(models.PatrolPath.id == path_id).first()
    if path is None:
        raise HTTPException(status_code=404, detail="Patrol path not found")

    slots = payload.get("slots") or []
    if not isinstance(slots, list):
        raise HTTPException(status_code=400, detail="slots must be a list of time strings")

    # Store as JSON in schedule_from; schedule_to unused in this mode
    path.schedule_from = json.dumps([str(s) for s in slots]) if slots else None
    path.schedule_to = None
    db.commit()
    db.refresh(path)

    return {
        "id": path.id,
        "name": path.name,
        "steps": json.loads(path.steps),
        "schedule_slots": slots,
        "created_at": path.created_at.isoformat() if path.created_at else None,
    }


@app.delete("/people/{person_id}")
def delete_person(person_id: int, db: Session = Depends(get_db)):
    person = db.query(models.Person).filter(models.Person.id == person_id).first()
    if person is None:
        raise HTTPException(status_code=404, detail="Person not found")

    # Delete embeddings first
    db.query(models.FaceEmbedding).filter(models.FaceEmbedding.person_id == person.id).delete(synchronize_session=False)
    db.delete(person)
    db.commit()

    # Remove stored reference image(s)
    for ext in (".jpg", ".jpeg", ".png"):
        path = PEOPLE_MEDIA_ROOT / f"{person_id}{ext}"
        if path.exists():
            try:
                path.unlink()
            except OSError:
                pass

    return {"status": "deleted", "id": person_id}


@app.post("/logs")
def create_log(payload: dict = Body(...), db: Session = Depends(get_db)):
    """Create a system log entry.

    Used by frontend analytics and backend components to persist events.
    """
    level = str(payload.get("level") or "info")
    source = str(payload.get("source") or "") or None
    category = str(payload.get("category") or "") or None
    message = str(payload.get("message") or "").strip()
    data = payload.get("data")

    if not message:
        raise HTTPException(status_code=400, detail="message is required")

    log = models.SystemLog(
        level=level,
        source=source,
        category=category,
        message=message,
        data=json.dumps(data) if data is not None else None,
    )
    db.add(log)
    db.commit()
    db.refresh(log)

    # also mirror into the main log file
    _append_main_log(
        {
            "ts": (log.created_at.isoformat() if log.created_at else datetime.utcnow().isoformat() + "Z"),
            "level": log.level,
            "source": log.source,
            "category": log.category,
            "message": log.message,
            "data": data,
        }
    )

    return {
        "id": log.id,
        "created_at": log.created_at.isoformat() if log.created_at else None,
        "level": log.level,
        "source": log.source,
        "category": log.category,
        "message": log.message,
    }


@app.get("/logs")
def list_logs(limit: int = 100, db: Session = Depends(get_db)):
    """Return recent system logs (most recent first)."""
    safe_limit = max(1, min(limit, 1000))
    logs = (
        db.query(models.SystemLog)
        .order_by(models.SystemLog.created_at.desc())
        .limit(safe_limit)
        .all()
    )
    result = []
    for log in logs:
        result.append(
            {
                "id": log.id,
                "created_at": log.created_at.isoformat() if log.created_at else None,
                "level": log.level,
                "source": log.source,
                "category": log.category,
                "message": log.message,
            }
        )
    return result


@app.get("/logs/export", response_class=PlainTextResponse)
def export_logs(limit: int = 1000, db: Session = Depends(get_db)):
    """Export recent logs as a simple CSV for download."""
    safe_limit = max(1, min(limit, 5000))
    logs = (
        db.query(models.SystemLog)
        .order_by(models.SystemLog.created_at.desc())
        .limit(safe_limit)
        .all()
    )

    lines = ["id,timestamp,level,source,category,message"]
    for log in logs:
        ts = log.created_at.isoformat() if log.created_at else ""
        def esc(value):
            if value is None:
                return ""
            return str(value).replace('"', '""')

        line = ",".join(
            [
                str(log.id),
                f'"{esc(ts)}"',
                f'"{esc(log.level)}"',
                f'"{esc(log.source)}"',
                f'"{esc(log.category)}"',
                f'"{esc(log.message)}"',
            ]
        )
        lines.append(line)

    return "\n".join(lines)
