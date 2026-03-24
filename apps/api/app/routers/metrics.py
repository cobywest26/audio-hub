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

# Computing global listening metrics across all users
@router.get("/global")
def get_global_metrics():
    result = supabase.table("listening_history").select("ms_played, artist_name").execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="No data available.")
    
    rows = result.data

    total_ms = sum(r.get("ms_played", 0) for r in rows)
    total_streams = sum(1 for r in rows if r.get("ms_played", 0) > 0)

    artist_counts = {}
    for r in rows:
        artist = r.get("artist_name")
        if artist:
            artist_counts[artist] = artist_counts.get(artist, 0) + 1

    top_artist = max(artist_counts, key=artist_counts.get) if artist_counts else None

    return {
        "total_streams": total_streams,
        "total ms_played": total_ms,
        "top_artist": top_artist,
    }