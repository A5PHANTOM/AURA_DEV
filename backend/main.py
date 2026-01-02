import json
import os
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, HTTPException, Depends, Form, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from .database import engine, Base, SessionLocal
from .auth import routes as auth_routes
from . import models
from .auth.utils import get_password_hash
from .face_recognition import detect_faces, compute_embeddings_for_detections, parse_embedding


app = FastAPI(title="Auth Backend")

# Distance threshold for deciding if a detected face matches a known person.
# Smaller values = stricter matching (more likely to mark as Unknown).
MATCH_DISTANCE_THRESHOLD = 0.5

# Simple media storage for reference face images
BASE_DIR = Path(__file__).parent
MEDIA_ROOT = BASE_DIR / "media"
PEOPLE_MEDIA_ROOT = MEDIA_ROOT / "people"

# CORS for React frontend (include Vite dev server origins)
origins = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve reference images under /media
MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
PEOPLE_MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
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


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


app.include_router(auth_routes.router)


@app.get('/')
def read_root():
    return {"message": "Auth backend is running"}


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

        detections[best_i]["person_name"] = name
        detections[best_i]["distance"] = best_dist
        detections[best_i]["match_score"] = match_score

        assigned_dets.add(best_i)
        assigned_persons.add(best_j)

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
    return [
        {
            "id": p.id,
            "name": p.name,
            "steps": json.loads(p.steps),
            "schedule_from": p.schedule_from,
            "schedule_to": p.schedule_to,
            "created_at": p.created_at.isoformat() if p.created_at else None,
        }
        for p in paths
    ]


@app.post("/patrol-paths")
def create_patrol_path(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
):
    name = (payload.get("name") or "").strip()
    steps = payload.get("steps") or []
    schedule_from = (payload.get("schedule_from") or None) or None
    schedule_to = (payload.get("schedule_to") or None) or None

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
