from fastapi import APIRouter, Depends, HTTPException
from app.core.auth import get_current_user_id
from app.core.supabase_client import supabase

router = APIRouter(prefix="/metrics", tags=["metrics"])

# Fetching basic metrics from the Supabase DB for simple metric display
@router.get("/me")
def get_user_metrics(user_id: str = Depends(get_current_user_id)):
    result = supabase.table("user_metrics").select("*").eq("user_id", user_id).limit(1).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Metrics not found for user.")

    return result.data[0]
