from fastapi import APIRouter, Depends, HTTPException, Query
from app.core.auth import get_current_user_id
from app.core.supabase_client import supabase
from app.utils.metrics import compute_and_save_snapshot_metrics

print("LOADED PROFILES ROUTER")

router = APIRouter(prefix="/profiles", tags=["profiles"])

@router.get("/search")
def search_profiles(
    q: str = Query(min_length=1),
    _: str = Depends(get_current_user_id),
):
    query = q.strip()

    if not query:
        return {"results": []}

    username_result = (
        supabase.table("profiles")
        .select("id,username,display_name,avatar_url")
        .ilike("username", f"%{query}%")
        .limit(8)
        .execute()
    )

    display_name_result = (
        supabase.table("profiles")
        .select("id,username,display_name,avatar_url")
        .ilike("display_name", f"%{query}%")
        .limit(8)
        .execute()
    )

    combined: dict[str, dict] = {}
    for row in (username_result.data or []) + (display_name_result.data or []):
        if row.get("username"):
            combined[row["id"]] = row

    return {"results": list(combined.values())}

@router.get("/{username}")
def get_profile_by_username(
    username: str,
    viewer_user_id: str = Depends(get_current_user_id),
):
    profile_result = (
        supabase.table("profiles")
        .select("id,username,display_name,avatar_url")
        .eq("username", username)
        .limit(1)
        .execute()
    )

    if not profile_result.data:
        raise HTTPException(status_code=404, detail="Profile not found")

    profile = profile_result.data[0]
    profile_user_id = profile["id"]

    metrics_result = (
        supabase.table("snapshot_metric")
        .select("*")
        .eq("user_id", profile_user_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    metrics = metrics_result.data[0] if metrics_result.data else None

    if metrics is None:
        return {
            "has_data": False,
            "profile": profile,
            "snapshot": None,
            "metrics": None,
        }

    snapshot = None
    if metrics.get("snapshot_id"):
        snapshot_result = (
            supabase.table("snapshots")
            .select("id,name,created_at,status,is_active")
            .eq("id", metrics["snapshot_id"])
            .limit(1)
            .execute()
        )
        snapshot = snapshot_result.data[0] if snapshot_result.data else None

    return {
        "has_data": True,
        "profile": profile,
        "snapshot": snapshot,
        "metrics": metrics,
    }