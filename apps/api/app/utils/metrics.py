from collections import Counter

from app.core.supabase_client import supabase

# Calculates basic metrics for uploaded data
def compute_metrics(rows: list[dict], user_id: str, snapshot_id:str) -> dict:
    total_streams = len(rows)
    total_ms_played = sum(row.get("ms_played", 0) or 0 for row in rows)

    track_names = [row.get("track_name") for row in rows if row.get("track_name")]
    artist_names = [row.get("artist_name") for row in rows if row.get("artist_name")]

    unique_tracks = len(set(track_names))
    unique_artists = len(set(artist_names))

    top_track = Counter(track_names).most_common(1)
    top_artist = Counter(artist_names).most_common(1)

    return {
        "snapshot_id": snapshot_id,
        "user_id": user_id,
        "total_streams": total_streams,
        "total_ms_played": total_ms_played,
        "unique_tracks": unique_tracks,
        "unique_artists": unique_artists,
        "top_track": top_track[0][0] if top_track else None,
        "top_artist": top_artist[0][0] if top_artist else None,
    }

def compute_and_save_snapshot_metrics(user_id: str, snapshot_id: str) -> dict:
    rows = (
        supabase.table("listening_history")
        .select("ms_played,track_name,artist_name")
        .eq("user_id", user_id)
        .eq("snapshot_id", snapshot_id)
        .execute()
    ).data or []

    metrics = compute_metrics(rows, user_id, snapshot_id)
    supabase.table("snapshot_metric").upsert(
        metrics,
        on_conflict="snapshot_id"
    ).execute()
    return metrics


# def compute_and_upsert_lifetime_metrics(user_id: str) -> dict:
#     all_rows = _fetch_history_rows_for_user(user_id)
#     metrics = compute_metrics(all_rows, user_id)
#    supabase.table("user_metrics").upsert(metrics, on_conflict="user_id").execute()
#     return metrics





