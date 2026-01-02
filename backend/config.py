from pathlib import Path
from dotenv import load_dotenv
import os

# Load .env from project root if present
env_path = Path(__file__).parent / '.env'
if env_path.exists():
    load_dotenv(env_path)

JWT_SECRET = os.getenv('JWT_SECRET', 'change-me')
ALGORITHM = os.getenv('ALGORITHM', 'HS256')
# Access token expiry in minutes (e.g. 30)
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv('ACCESS_TOKEN_EXPIRE_MINUTES', '30'))
# Refresh token expiry in days
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv('REFRESH_TOKEN_EXPIRE_DAYS', '7'))
