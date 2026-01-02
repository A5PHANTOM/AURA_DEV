# FastAPI Auth Backend

Minimal FastAPI backend implementing registration and login with JWT.

Project structure (exact)

backend/
  ├── main.py
  ├── database.py
  ├── models.py
  ├── schemas.py
  ├── auth/
  │    ├── routes.py
  │    ├── utils.py
  │    ├── jwt_handler.py
  ├── config.py
  ├── requirements.txt
  ├── README.md

Setup

1. Create and activate a virtualenv (macOS):

```bash
python3 -m venv .venv
source .venv/bin/activate
```

2. Install requirements:

```bash
pip install -r requirements.txt
```

3. Environment variables

- `JWT_SECRET` (recommended): secret string used to sign JWTs. Defaults to `change-me` if not set.
- `ALGORITHM` (optional): JWT signing algorithm. Defaults to `HS256`.
- `ACCESS_TOKEN_EXPIRE_MINUTES` (optional): expiry for access tokens in minutes. Defaults to `30`.

You can create a `.env` file next to `config.py` with:

```
JWT_SECRET=your_super_secret_jwt_key
ACCESS_TOKEN_EXPIRE_MINUTES=60
ALGORITHM=HS256
```

Run

```bash
# from backend/ directory
uvicorn main:app --reload --port 8000
```

API examples

Register:

```bash
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"secret123"}'
```

Login (OAuth2 password flow expects form data):

```bash
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=user@example.com&password=secret123"
```

Response contains access token:

```json
{"access_token":"<JWT>","token_type":"bearer"}
```

Use the token in requests:

```bash
curl -H "Authorization: Bearer <JWT>" http://localhost:8000/
```

Notes

- Database is SQLite file `app.db` created inside `backend/`.
- For production, change `JWT_SECRET` to a secure value and use HTTPS.