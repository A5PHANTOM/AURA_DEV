from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text
from sqlalchemy.sql import func
from .database import Base


class User(Base):
    __tablename__ = 'users'

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    phone_number = Column(String, unique=True, index=True, nullable=True)
    hashed_password = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Person(Base):
    __tablename__ = 'people'

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class FaceEmbedding(Base):
    __tablename__ = 'face_embeddings'

    id = Column(Integer, primary_key=True, index=True)
    person_id = Column(Integer, ForeignKey('people.id', ondelete='CASCADE'), nullable=False)
    # Stored as JSON-encoded list of floats
    embedding = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class PatrolPath(Base):
    __tablename__ = 'patrol_paths'

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    # JSON-encoded list of steps: [{"action": "forward", "time": 1000}, ...]
    steps = Column(Text, nullable=False)
    # Optional schedule fields stored as simple strings (e.g. "22:00", "06:00")
    schedule_from = Column(String, nullable=True)
    schedule_to = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class SystemLog(Base):
    __tablename__ = 'system_logs'

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    level = Column(String, nullable=False)  # e.g. info, warning, error, alert
    source = Column(String, nullable=True)  # e.g. backend, esp32, face-recognition
    category = Column(String, nullable=True)  # e.g. flame, gas, ultrasonic, face
    message = Column(Text, nullable=False)
    data = Column(Text, nullable=True)  # optional JSON payload


class Event(Base):
    """High-level security or system event.

    Examples: fire alert, gas alert, unknown face detected, manual AI analysis, etc.
    This will be the main record that ties together raw sensor data, images,
    and optional AI-generated summaries.
    """

    __tablename__ = 'events'

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # e.g. "fire", "gas", "unknown_face", "manual_ai_request"
    event_type = Column(String, nullable=False)

    # optional source identifier, e.g. "backend", "esp32-cam-1"
    source = Column(String, nullable=True)

    # Path to the associated image relative to the backend media root,
    # e.g. "events/20260104T120000Z_face.jpg". Can be null for text-only events.
    image_path = Column(String, nullable=True)

    # Optional JSON-encoded metadata payload (sensor readings, detection summary, etc.)
    # Use the underlying column name "metadata" but avoid the reserved
    # SQLAlchemy attribute name on declarative models by using
    # the attribute name "metadata_json" instead.
    metadata_json = Column("metadata", Text, nullable=True)

    # --- AI-related fields (LLaVA, etc.) ---
    # simple status indicator: pending / processing / succeeded / failed / unavailable / skipped
    ai_status = Column(String, nullable=True)

    # Short, 1–2 line alert text suitable for notifications
    ai_summary_short = Column(Text, nullable=True)

    # Longer 3–6 line human-readable summary
    ai_summary_long = Column(Text, nullable=True)

    # Raw model output (JSON/text) for debugging/auditing
    ai_raw = Column(Text, nullable=True)

    # Latency in milliseconds for the AI call, if any
    ai_latency_ms = Column(Integer, nullable=True)

    # Model identifier used for the analysis, e.g. "llava:13b"
    ai_model = Column(String, nullable=True)


class PatrolSession(Base):
    """Represents a single patrol run of the rover.

    A session has a start/end time, an optional associated patrol path,
    and optional AI summaries describing what happened during the run.
    """

    __tablename__ = "patrol_sessions"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # When the patrol actually started and ended (UTC)
    start_time = Column(DateTime(timezone=True), nullable=False)
    end_time = Column(DateTime(timezone=True), nullable=True)

    # Optional link to a saved patrol path
    patrol_path_id = Column(Integer, ForeignKey("patrol_paths.id", ondelete="SET NULL"), nullable=True)
    patrol_path_name = Column(String, nullable=True)

    # Simple lifecycle: active / completed / cancelled
    status = Column(String, nullable=False)

    # --- AI-related fields for patrol-level summary ---
    ai_status = Column(String, nullable=True)
    ai_summary_short = Column(Text, nullable=True)
    ai_summary_long = Column(Text, nullable=True)
    ai_raw = Column(Text, nullable=True)
    ai_latency_ms = Column(Integer, nullable=True)
    ai_model = Column(String, nullable=True)

