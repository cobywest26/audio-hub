from fastapi import APIRouter, Depends
from app.core.auth import get_current_user_id
from app.core.supabase_client import supabase

router = APIRouter(prefix="/metrics", tags=["metrics"])

print("LOADED NEW METRICS ROUTER")

@router.get("/me")
def get_user_metrics(user_id: str = Depends(get_current_user_id)):
    result = (
        supabase.table("user_metric")
        .select("*")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )

    if not result.data:
        return {
            "total_streams": 0,
            "total_ms_played": 0,
            "unique_tracks": 0,
            "unique_artists": 0,
            "top_track": None,
            "top_artist": None,
        }

    return result.data[0]


@router.get("/latest")
def get_latest_snapshot_metrics(user_id: str = Depends(get_current_user_id)):
    snapshot_result = (
        supabase.table("snapshots")
        .select("id,name,created_at,status,is_active")
        .eq("user_id", user_id)
        .eq("status", "ready")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    if not snapshot_result.data:
        return {
            "has_data": False,
            "snapshot": None,
            "metrics": None,
        }

    snapshot = snapshot_result.data[0]

    metrics_result = (
        supabase.table("snapshot_metric")
        .select("*")
        .eq("snapshot_id", snapshot["id"])
        .limit(1)
        .execute()
    )

    return {
        "has_data": True,
        "snapshot": snapshot,
        "metrics": metrics_result.data[0] if metrics_result.data else None,
    }


@router.get("/snapshots")
def list_snapshots(user_id: str = Depends(get_current_user_id)):
    result = (
        supabase.table("snapshots")
        .select("id,name,created_at,status,is_active")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []


@router.post("/reset")
def reset_for_new_snapshot(user_id: str = Depends(get_current_user_id)):
    return {
        "message": "Ready for a new upload. Previous snapshots remain available for comparison."
    }