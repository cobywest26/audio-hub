import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import Client, create_client

# Load the API env file explicitly so uvicorn works no matter which directory it starts from.
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"
load_dotenv(ENV_FILE)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

LISTENING_HISTORY_CONFLICT_COLUMNS = os.getenv("LISTENING_HISTORY_CONFLICT_COLUMNS", "")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise ValueError(
        f"Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY in {ENV_FILE}. "
        "The API must use the Supabase service role key so backend uploads and "
        "metric refreshes can keep working after RLS is enabled."
    )

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
