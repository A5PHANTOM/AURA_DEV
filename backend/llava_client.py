import base64
import time
from typing import Any, Dict

import requests

from .config import LLAVA_BASE_URL, LLAVA_MODEL_NAME, LLAVA_TIMEOUT_SECONDS


class LLaVAError(Exception):
    """Base error for LLaVA-related failures."""


class LLaVAServerUnavailable(LLaVAError):
    """Raised when the LLaVA server cannot be reached or is unhealthy."""


def _build_chat_payload(
    prompt: str,
    image_b64: str | None = None,
) -> Dict[str, Any]:
    """Build the payload for Ollama's /api/chat endpoint.

    If ``image_b64`` is provided, it is attached as an image for
    multimodal analysis; otherwise this is treated as a text-only
    conversation.
    """

    message: Dict[str, Any] = {
        "role": "user",
        "content": prompt,
    }
    if image_b64 is not None:
        message["images"] = [image_b64]

    return {
        "model": LLAVA_MODEL_NAME,
        "messages": [message],
        # We want a single JSON response, not a stream
        "stream": False,
    }


def analyze_image_with_llava(image_bytes: bytes, prompt: str) -> Dict[str, Any]:
    """Send an image to the LLaVA server for analysis.

    Returns a dict with keys:
      - content: the main textual content from the model
      - raw: the full JSON response from Ollama
      - latency_ms: round-trip latency in milliseconds

    Raises LLaVAServerUnavailable when the server cannot be reached, and
    LLaVAError for other protocol/format issues.
    """

    if not LLAVA_BASE_URL:
        raise LLaVAServerUnavailable("LLAVA_BASE_URL is not configured.")

    image_b64 = base64.b64encode(image_bytes).decode("utf-8")
    payload = _build_chat_payload(prompt=prompt, image_b64=image_b64)

    url = LLAVA_BASE_URL.rstrip("/") + "/api/chat"

    start = time.time()
    try:
        response = requests.post(url, json=payload, timeout=LLAVA_TIMEOUT_SECONDS)
    except requests.exceptions.RequestException as exc:  # network / timeout / DNS, etc.
        raise LLaVAServerUnavailable(f"Error reaching LLaVA server: {exc}") from exc

    latency_ms = int((time.time() - start) * 1000)

    # Treat 5xx as server unavailability so callers can fall back gracefully
    if response.status_code >= 500:
        raise LLaVAServerUnavailable(
            f"LLaVA server error: HTTP {response.status_code}"
        )

    try:
        data = response.json()
    except ValueError as exc:
        raise LLaVAError("LLaVA response was not valid JSON.") from exc

    message = data.get("message") or {}
    content = message.get("content") or ""

    return {
        "content": content,
        "raw": data,
        "latency_ms": latency_ms,
    }


def analyze_text_with_llava(prompt: str) -> Dict[str, Any]:
    """Send a text-only prompt to the LLaVA server for analysis.

    Returns a dict with keys similar to ``analyze_image_with_llava``.
    """

    if not LLAVA_BASE_URL:
        raise LLaVAServerUnavailable("LLAVA_BASE_URL is not configured.")

    payload = _build_chat_payload(prompt=prompt, image_b64=None)
    url = LLAVA_BASE_URL.rstrip("/") + "/api/chat"

    start = time.time()
    try:
        response = requests.post(url, json=payload, timeout=LLAVA_TIMEOUT_SECONDS)
    except requests.exceptions.RequestException as exc:
        raise LLaVAServerUnavailable(f"Error reaching LLaVA server: {exc}") from exc

    latency_ms = int((time.time() - start) * 1000)

    if response.status_code >= 500:
        raise LLaVAServerUnavailable(
            f"LLaVA server error: HTTP {response.status_code}"
        )

    try:
        data = response.json()
    except ValueError as exc:
        raise LLaVAError("LLaVA response was not valid JSON.") from exc

    message = data.get("message") or {}
    content = message.get("content") or ""

    return {
        "content": content,
        "raw": data,
        "latency_ms": latency_ms,
    }
