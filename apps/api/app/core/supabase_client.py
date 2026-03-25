import os
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_ANON_KEY")

LISTENING_HISTORY_CONFLICT_COLUMNS = os.getenv("LISTENING_HISTORY_CONFLICT_COLUMNS", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError(
        "Missing SUPABASE_URL and/or key. Set SUPABASE_SERVICE_ROLE_KEY "
        "(or SUPABASE_KEY / SUPABASE_ANON_KEY)."
    )

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
