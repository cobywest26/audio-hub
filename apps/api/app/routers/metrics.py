from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import get_current_user_id
from app.core.supabase_client import supabase
from app.utils.metrics import compute_global_insights, fetch_latest_snapshot_history_rows

router = APIRouter(prefix="/metrics", tags=["metrics"])

# Now computes the latest-snapshot global insights
@router.get("/global")
def get_global_metrics():
    rows = fetch_latest_snapshot_history_rows()

    if not rows:
        raise HTTPException(status_code=404, detail="No data available.")

    return compute_global_insights(rows)


@router.get("/me")
def get_my_metrics(user_id: str = Depends(get_current_user_id)):
    result = supabase.table("user_metrics").select("*").eq("user_id", user_id).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Metrics not found for user.")

    return result.data[0]

# Added user route after /global and /me so that the routing order is safe
@router.get("/{user_id}")
def get_user_metrics(user_id: str):
    result = supabase.table("user_metrics").select("*").eq("user_id", user_id).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Metrics not found for user.")

    return result.data[0]
