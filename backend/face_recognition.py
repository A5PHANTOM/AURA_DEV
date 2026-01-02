import os
import json
from functools import lru_cache
from typing import List, Dict, Any, List as _List

import cv2
import numpy as np
from ultralytics import YOLO

from .config import Path


@lru_cache(maxsize=1)
def get_yolo_model() -> YOLO:
    """Load YOLO model once and cache it.

    You can set YOLO_MODEL_PATH in the .env next to config.py.
    Defaults to "yolov8n.pt" which is a general object detector.
    For better face results, point this to a face-trained YOLO weights file.
    """
    model_path = os.getenv("YOLO_MODEL_PATH", "yolov8n.pt")
    # Resolve relative to backend directory if it's a relative path
    model_path = str(Path(__file__).parent / model_path) if not os.path.isabs(model_path) else model_path
    return YOLO(model_path)


def detect_faces(image_bytes: bytes) -> List[Dict[str, Any]]:
    """Run YOLO on the given image bytes and return detected boxes.

    This is "face recognition" in the sense of detecting faces / regions.
    If you use face-specific weights, detections will correspond to faces.
    """
    # Decode image bytes into OpenCV image
    np_arr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

    if img is None:
        raise ValueError("Could not decode image")

    model = get_yolo_model()
    results = model(img)[0]

    detections: List[Dict[str, Any]] = []

    boxes = results.boxes
    if boxes is None:
        return detections

    for box, conf, cls in zip(boxes.xyxy, boxes.conf, boxes.cls):
        x1, y1, x2, y2 = box.tolist()
        class_id = int(cls)
        class_name = model.names.get(class_id, str(class_id)) if hasattr(model, "names") else str(class_id)

        detections.append(
            {
                "bbox": [float(x1), float(y1), float(x2), float(y2)],
                "confidence": float(conf),
                "class_id": class_id,
                "class_name": class_name,
            }
        )

    return detections


def _load_image_from_bytes(image_bytes: bytes) -> np.ndarray:
    np_arr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image")
    return img


def _face_embedding_from_bbox(img: np.ndarray, bbox: _List[float]) -> np.ndarray:
    """Very simple face embedding based on the cropped face pixels.

    This is NOT production-grade but works as a demo for matching
    previously-registered faces versus new frames.
    """
    x1, y1, x2, y2 = [int(v) for v in bbox]
    h, w = img.shape[:2]
    x1 = max(0, min(x1, w - 1))
    x2 = max(0, min(x2, w))
    y1 = max(0, min(y1, h - 1))
    y2 = max(0, min(y2, h))

    if x2 <= x1 or y2 <= y1:
        raise ValueError("Invalid face crop")

    face = img[y1:y2, x1:x2]
    if face.size == 0:
        raise ValueError("Empty face crop")

    face = cv2.resize(face, (64, 64))
    face = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY)
    face = face.astype("float32") / 255.0
    emb = face.flatten()
    # L2-normalize so we can use cosine / euclidean distance stably
    norm = np.linalg.norm(emb) + 1e-8
    return emb / norm


def compute_embeddings_for_detections(image_bytes: bytes, detections: List[Dict[str, Any]]) -> List[_List[float]]:
    """Given raw image bytes and YOLO detections, compute simple embeddings.

    Returns a list of embedding vectors (as Python lists of floats) aligned
    with the detections list.
    """
    if not detections:
        return []

    img = _load_image_from_bytes(image_bytes)
    embeddings: List[_List[float]] = []
    for det in detections:
        bbox = det.get("bbox")
        try:
            emb = _face_embedding_from_bbox(img, bbox)
            embeddings.append(emb.astype(float).tolist())
        except Exception:
            embeddings.append([])

    return embeddings


def parse_embedding(embedding_str: str) -> np.ndarray:
    """Decode a stored JSON string back to a numpy vector."""
    data = json.loads(embedding_str)
    arr = np.array(data, dtype="float32")
    norm = np.linalg.norm(arr) + 1e-8
    return arr / norm
