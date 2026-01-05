import os
import time
import logging
from typing import Optional

import requests

from . import config

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("telegram_bot")


BACKEND_BASE_URL = os.getenv("AURA_BACKEND_BASE_URL", "http://127.0.0.1:8000")


def _get_bot_token() -> Optional[str]:
    token = config.TELEGRAM_BOT_TOKEN
    if not token:
        logger.error("TELEGRAM_BOT_TOKEN is not configured in backend/.env")
        return None
    return token


def _get_updates(base_url: str, offset: Optional[int]) -> list[dict]:
    params = {"timeout": 30}
    if offset is not None:
        params["offset"] = offset

    try:
        resp = requests.get(f"{base_url}/getUpdates", params=params, timeout=35)
        resp.raise_for_status()
        data = resp.json()
        return data.get("result", [])
    except Exception as exc:  # noqa: BLE001
        logger.warning("Error fetching Telegram updates", exc_info=exc)
        return []


def _handle_last_ai_command(chat_id: int) -> None:
    """Call the backend endpoint that sends the latest AI event to Telegram.

    The backend already knows the chat ID (from TELEGRAM_CHAT_ID), so this
    function only needs to trigger /telegram/last-ai.
    """

    try:
        resp = requests.post(f"{BACKEND_BASE_URL}/telegram/last-ai", timeout=30)
        if resp.status_code != 200:
            logger.warning(
                "Backend /telegram/last-ai returned non-200",
                extra={"status": resp.status_code, "body": resp.text},
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Error calling backend /telegram/last-ai", exc_info=exc)


def run_bot() -> None:
    token = _get_bot_token()
    if not token:
        return

    api_base = f"https://api.telegram.org/bot{token}"
    logger.info("Starting Telegram polling bot for AURA" )

    last_update_id: Optional[int] = None

    while True:
        updates = _get_updates(api_base, last_update_id)
        for update in updates:
            last_update_id = update.get("update_id", last_update_id)

            message = update.get("message") or {}
            text = (message.get("text") or "").strip()
            chat = message.get("chat") or {}
            chat_id = chat.get("id")

            if not text or chat_id is None:
                continue

            if text.startswith("/last_ai"):
                logger.info("Received /last_ai command from chat %s", chat_id)
                _handle_last_ai_command(chat_id)

        # Avoid hot loop when there are no updates
        time.sleep(1)


if __name__ == "__main__":
    run_bot()
