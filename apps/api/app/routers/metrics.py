from fastapi import APIRouter, HTTPException
from app.core.supabase_client import supabase

router = APIRouter(prefix="/metrics", tags=["metrics"])

# Fetching basic metrics from the Supabase DB for simple metric display
@router.get("/{user_id}")
def get_user_metrics(user_id: str):
    result = supabase.table("user_metrics").select("*").eq("user_id", user_id).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Metrics not found for user.")

    return result.data[0]