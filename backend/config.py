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

# Telegram bot configuration (used for fire / gas alerts)
# IMPORTANT: these read from environment variables TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.
# Put your real values in backend/.env or your shell env; do NOT hardcode them here.
TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
TELEGRAM_CHAT_ID = os.getenv('TELEGRAM_CHAT_ID')

# LLaVA / Ollama configuration
LLAVA_BASE_URL = os.getenv('LLAVA_BASE_URL', 'http://localhost:11434')
LLAVA_MODEL_NAME = os.getenv('LLAVA_MODEL_NAME', 'llava:13b')
LLAVA_TIMEOUT_SECONDS = float(os.getenv('LLAVA_TIMEOUT_SECONDS', '20'))

# ESP32 rover configuration (optional)
# Base URL of the ESP32 rover API, e.g. "http://192.168.216.32".
# If set, the backend /status report will actively ping
# "<ESP32_ROVER_API>/status" to determine rover online/offline.
ESP32_ROVER_API = os.getenv('ESP32_ROVER_API')

