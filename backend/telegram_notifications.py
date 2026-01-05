import logging
from typing import Optional

import requests

from . import config

logger = logging.getLogger(__name__)


def _get_telegram_config() -> Optional[tuple[str, str]]:
    """Return (bot_token, chat_id) if configured, else None.

    Values are read from environment via backend.config.
    """
    bot_token = config.TELEGRAM_BOT_TOKEN
    chat_id = config.TELEGRAM_CHAT_ID

    if not bot_token or not chat_id:
        logger.warning("Telegram bot token or chat id not configured; skipping alert send")
        return None
    return bot_token, chat_id


def send_telegram_message(text: str) -> bool:
    """Send a plain-text Telegram message using the configured bot.

    Returns True on success, False on failure. Fails silently (logs only)
    so that notifications never break main application flows.
    """
    cfg = _get_telegram_config()
    if cfg is None:
        return False

    bot_token, chat_id = cfg
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = {"chat_id": chat_id, "text": text}

    try:
        resp = requests.post(url, json=payload, timeout=5)
        if resp.status_code != 200:
            logger.warning(
                "Telegram sendMessage failed", extra={"status": resp.status_code, "body": resp.text}
            )
            return False
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("Error sending Telegram message", exc_info=exc)
        return False


def send_telegram_photo(photo_bytes: bytes, caption: str) -> bool:
    """Send a photo with caption to the configured Telegram chat.

    The photo is uploaded directly from bytes, so it does not need to be
    publicly accessible via URL. Returns True on success, False on failure.
    """

    cfg = _get_telegram_config()
    if cfg is None:
        return False

    bot_token, chat_id = cfg
    url = f"https://api.telegram.org/bot{bot_token}/sendPhoto"

    files = {"photo": ("event.jpg", photo_bytes)}
    data = {"chat_id": chat_id, "caption": caption}

    try:
        resp = requests.post(url, data=data, files=files, timeout=10)
        if resp.status_code != 200:
            logger.warning(
                "Telegram sendPhoto failed",
                extra={"status": resp.status_code, "body": resp.text},
            )
            return False
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("Error sending Telegram photo", exc_info=exc)
        return False
