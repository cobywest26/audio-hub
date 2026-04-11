from collections import Counter
from datetime import datetime

from app.core.supabase_client import supabase

# Added compute_metric_summary to hold the shared metric aggregation logic
def compute_metric_summary(rows: list[dict]) -> dict:
    total_streams = len(rows)
    total_ms_played = sum(row.get("ms_played", 0) or 0 for row in rows)

    track_names = [row.get("track_name") for row in rows if row.get("track_name")]
    artist_names = [row.get("artist_name") for row in rows if row.get("artist_name")]

    unique_tracks = len(set(track_names))
    unique_artists = len(set(artist_names))

    top_track = Counter(track_names).most_common(1)
    top_artist = Counter(artist_names).most_common(1)

    return {
        "total_streams": total_streams,
        "total_ms_played": total_ms_played,
        "unique_tracks": unique_tracks,
        "unique_artists": unique_artists,
        "top_track": top_track[0][0] if top_track else None,
        "top_artist": top_artist[0][0] if top_artist else None,
    }

# Reworked to wrap shared summary with user_id
def compute_metrics(rows: list[dict], user_id: str) -> dict:
    return {
        "user_id": user_id,
        **compute_metric_summary(rows),
    }

# Global totals
def compute_global_insights(rows: list[dict]) -> dict:
    summary = compute_metric_summary(rows)

    track_names = [row.get("track_name") for row in rows if row.get("track_name")]
    artist_names = [row.get("artist_name") for row in rows if row.get("artist_name")]

    top_tracks = [
        {"name": name, "streams": count}
        for name, count in Counter(track_names).most_common(10)
    ]
    top_artists = [
        {"name": name, "streams": count}
        for name, count in Counter(artist_names).most_common(10)
    ]

    monthly_counts: Counter[str] = Counter()
    for row in rows:
        played_at = row.get("played_at")
        if not played_at:
            continue

        month = str(played_at)[:7]
        if len(month) == 7 and month[4] == "-":
            monthly_counts[month] += 1

    streams_by_month = [
        {"month": month, "streams": count}
        for month, count in sorted(monthly_counts.items())
    ]

    return {
        **summary,
        "streams_by_month": streams_by_month,
        "top_tracks": top_tracks,
        "top_artists": top_artists,
    }


def _fetch_history_rows(
    columns: str,
    user_id: str | None = None,
    page_size: int = 1000,
) -> list[dict]:
    rows: list[dict] = []
    start = 0

    while True:
        query = supabase.table("listening_history").select(columns)

        if user_id:
            query = query.eq("user_id", user_id)

        result = query.range(start, start + page_size - 1).execute()

        batch = result.data or []
        rows.extend(batch)

        if len(batch) < page_size:
            break

        start += page_size

    return rows


def fetch_history_rows_for_user(user_id: str, page_size: int = 1000) -> list[dict]:
    return _fetch_history_rows(
        "ms_played,track_name,artist_name",
        user_id=user_id,
        page_size=page_size,
    )


def fetch_all_history_rows(page_size: int = 1000) -> list[dict]:
    return _fetch_history_rows(
        "upload_id,ms_played,track_name,artist_name,played_at",
        page_size=page_size,
    )


def _fetch_processed_upload_rows(page_size: int = 1000) -> list[dict]:
    rows: list[dict] = []
    start = 0

    while True:
        result = (
            supabase.table("uploads")
            .select("*")
            .eq("status", "processed")
            .range(start, start + page_size - 1)
            .execute()
        )

        batch = result.data or []
        rows.extend(batch)

        if len(batch) < page_size:
            break

        start += page_size

    return rows


def _parse_upload_timestamp(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None

    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _latest_upload_sort_key(upload: dict) -> tuple[int, datetime, str]:
    for field in ("processed_at", "created_at", "updated_at", "inserted_at"):
        parsed = _parse_upload_timestamp(upload.get(field))
        if parsed:
            return (1, parsed, str(upload.get("id") or ""))

    return (0, datetime.min, str(upload.get("id") or ""))

# Added so global metrics only use each user's latest processed upload
def fetch_latest_snapshot_history_rows() -> list[dict]:
    processed_uploads = _fetch_processed_upload_rows()

    latest_upload_by_user: dict[str, dict] = {}
    for upload in processed_uploads:
        user_id = upload.get("user_id")
        upload_id = upload.get("id")
        if not user_id or not upload_id:
            continue

        current = latest_upload_by_user.get(str(user_id))
        if current is None or _latest_upload_sort_key(upload) > _latest_upload_sort_key(current):
            latest_upload_by_user[str(user_id)] = upload

    latest_upload_ids = {
        str(upload.get("id"))
        for upload in latest_upload_by_user.values()
        if upload.get("id")
    }

    if not latest_upload_ids:
        return []

    all_rows = fetch_all_history_rows()
    return [
        row for row in all_rows
        if str(row.get("upload_id") or "") in latest_upload_ids
    ]

# Updated to use the user-history helper
def compute_and_upsert_lifetime_metrics(user_id: str) -> dict:
    all_rows = fetch_history_rows_for_user(user_id)
    metrics = compute_metrics(all_rows, user_id)
    supabase.table("user_metrics").upsert(metrics, on_conflict="user_id").execute()
    return metrics
