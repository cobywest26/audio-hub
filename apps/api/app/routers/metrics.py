from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.core.auth import get_current_user_id
from app.core.supabase_client import supabase
from app.utils.metrics import compute_and_save_snapshot_metrics, get_latest_global_metrics

router = APIRouter(prefix="/metrics", tags=["metrics"])

print("LOADED NEW METRICS ROUTER")

@router.get("/me")
def get_user_metrics(user_id: str = Depends(get_current_user_id)):
    empty_metrics = {
        "total_streams": 0,
        "total_ms_played": 0,
        "unique_tracks": 0,
        "unique_artists": 0,
        "top_track": None,
        "top_artist": None,
    }

    try:
        result = (
            supabase.table("user_metrics")
            .select("*")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception:
        return empty_metrics

    if not result.data:
        return empty_metrics

    metrics = result.data[0]

    if not any(
        metrics.get(key)
        for key in ("total_streams", "total_ms_played", "unique_tracks", "unique_artists")
    ):
        return {
            **empty_metrics,
            "user_id": metrics.get("user_id"),
        }

    return metrics


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

    metrics = metrics_result.data[0] if metrics_result.data else None

    if metrics is None:
        metrics = compute_and_save_snapshot_metrics(user_id, snapshot["id"])

    return {
        "has_data": True,
        "snapshot": snapshot,
        "metrics": metrics,
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

@router.get("/snapshot/{snapshot_id}")
def get_snapshot_metrics(snapshot_id: str, user_id: str = Depends(get_current_user_id)):
    result = (
        supabase.table("snapshot_metric")
        .select("*")
        .eq("snapshot_id", snapshot_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )

    if result.data:
        return {"metrics": result.data[0]}

    metrics = compute_and_save_snapshot_metrics(user_id, snapshot_id)

    if not metrics:
        raise HTTPException(status_code=404, detail="Snapshot metrics not found")

    return {"metrics": metrics}

@router.get("/global")
def get_global_metrics(user_id: str = Depends(get_current_user_id)):
    return get_latest_global_metrics()


@router.post("/reset")
def reset_for_new_snapshot(user_id: str = Depends(get_current_user_id)):
    return {
        "message": "Ready for a new upload. Previous snapshots remain available for comparison."
    }

class RenameSnapshotRequest(BaseModel):
    name: str

@router.patch("/snapshots/{snapshot_id}")
def rename_snapshot(
    snapshot_id: str,
    payload: RenameSnapshotRequest,
    user_id: str = Depends(get_current_user_id),
):
    new_name = payload.name.strip()

    if not new_name:
        raise HTTPException(status_code=400, detail="Snapshot name cannot be empty")

    result = (
        supabase.table("snapshots")
        .update({"name": new_name})
        .eq("id", snapshot_id)
        .eq("user_id", user_id)
        .execute()
    )

    return {
        "message": "Snapshot renamed successfully",
        "snapshot": result.data[0] if result.data else None,
    }
