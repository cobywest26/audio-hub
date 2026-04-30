from collections import Counter, defaultdict
from datetime import datetime

from app.core.supabase_client import supabase


def parse_end_time(value: str | None) -> datetime | None:
    if not value:
        return None

    value = value.strip()

    formats = [
        "%Y-%m-%d %H:%M",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S.%fZ",
    ]

    for fmt in formats:
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    
    #
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def compute_metrics(rows: list[dict], user_id: str, snapshot_id: str | None) -> dict:
    total_streams = len(rows)
    total_ms_played = sum(row.get("ms_played", 0) or 0 for row in rows)

    track_names = [row.get("track_name") for row in rows if row.get("track_name")]
    artist_names = [row.get("artist_name") for row in rows if row.get("artist_name")]

    unique_tracks = len(set(track_names))
    unique_artists = len(set(artist_names))

    top_track = Counter(track_names).most_common(1)
    top_artist = Counter(artist_names).most_common(1)

    artist_stream_counter: Counter[str] = Counter()
    track_stream_counter: Counter[str] = Counter()

    artist_time_counter: dict[str, int] = defaultdict(int)
    track_time_counter: dict[str, int] = defaultdict(int)

    day_ms = 0
    night_ms = 0
    weekday_ms = 0
    weekend_ms = 0

    for row in rows:
        artist_name = (row.get("artist_name") or "").strip()
        track_name = (row.get("track_name") or "").strip()
        ms_played = row.get("ms_played", 0) or 0

        if artist_name:
            artist_stream_counter[artist_name] += 1
            artist_time_counter[artist_name] += ms_played

        if track_name:
            track_stream_counter[track_name] += 1
            track_time_counter[track_name] += ms_played

        end_time = parse_end_time(row.get("played_at"))
        if end_time:
            hour = end_time.hour
            weekday = end_time.weekday()  # 0=Mon ... 6=Sun

            if 8 <= hour < 20:
                day_ms += ms_played
            else:
                night_ms += ms_played

            if weekday < 5:
                weekday_ms += ms_played
            else:
                weekend_ms += ms_played

    top_artists = [
        {
            "name": artist_name,
            "streams": artist_stream_counter[artist_name],
            "total_ms_played": artist_time_counter[artist_name],
        }
        for artist_name, _ in sorted(
            artist_time_counter.items(),
            key=lambda item: item[1],
            reverse=True,
        )[:15]
    ]

    top_tracks = [
        {
            "name": track_name,
            "streams": track_stream_counter[track_name],
            "total_ms_played": track_time_counter[track_name],
        }
        for track_name, _ in sorted(
            track_stream_counter.items(),
            key=lambda item: item[1],
            reverse=True,
        )[:15]
    ]

    return {
        "snapshot_id": snapshot_id,
        "user_id": user_id,
        "total_streams": total_streams,
        "total_ms_played": total_ms_played,
        "unique_tracks": unique_tracks,
        "unique_artists": unique_artists,
        "top_track": top_track[0][0] if top_track else None,
        "top_artist": top_artist[0][0] if top_artist else None,
        "top_artists": top_artists,
        "top_tracks": top_tracks,
        "day_ms": day_ms,
        "night_ms": night_ms,
        "weekday_ms": weekday_ms,
        "weekend_ms": weekend_ms,
    }


def fetch_snapshot_metric_rows(user_id: str, snapshot_id: str, page_size: int = 1000) -> list[dict]:
    rows: list[dict] = []
    start = 0

    while True:
        # Supabase can return large result sets in pages, so fetch until
        # the snapshot's full listening history has been read.
        page = (
            supabase.table("listening_history")
            .select("ms_played,track_name,artist_name,played_at")
            .eq("user_id", user_id)
            .eq("snapshot_id", snapshot_id)
            .range(start, start + page_size - 1)
            .execute()
        ).data or []

        rows.extend(page)

        if len(page) < page_size:
            break

        start += page_size

    return rows


def fetch_user_metric_rows(user_id: str, page_size: int = 1000) -> list[dict]:
    rows: list[dict] = []
    start = 0

    while True:
        page = (
            supabase.table("listening_history")
            .select("ms_played,track_name,artist_name,played_at")
            .eq("user_id", user_id)
            .range(start, start + page_size - 1)
            .execute()
        ).data or []

        rows.extend(page)

        if len(page) < page_size:
            break

        start += page_size

    return rows


def compute_and_save_snapshot_metrics(user_id: str, snapshot_id: str) -> dict:
    # Read every row for the snapshot before computing metrics
    rows = fetch_snapshot_metric_rows(user_id, snapshot_id)
    metrics = compute_metrics(rows, user_id, snapshot_id=snapshot_id)

    supabase.table("snapshot_metric").upsert(
        metrics,
        on_conflict="snapshot_id"
    ).execute()
    return metrics


def save_user_metrics(user_id: str, rows: list[dict]) -> dict:
    metrics = compute_metrics(rows, user_id, snapshot_id=None)
    metrics.pop("snapshot_id", None)

    supabase.table("user_metrics").upsert(
        metrics,
        on_conflict="user_id",
    ).execute()
    return metrics


def compute_and_save_user_metrics(user_id: str) -> dict:
    rows = fetch_user_metric_rows(user_id)
    return save_user_metrics(user_id, rows)


def compute_and_save_user_metrics_from_snapshot(user_id: str, snapshot_id: str) -> dict:
    rows = fetch_snapshot_metric_rows(user_id, snapshot_id)
    return save_user_metrics(user_id, rows)


def get_latest_snapshots_per_user(page_size: int = 1000) -> list[dict]:
    rows: list[dict] = []
    start = 0

    while True:
        page = (
            supabase.table("snapshots")
            .select("id,user_id,created_at")
            .eq("status", "ready")
            .order("created_at", desc=True)
            .range(start, start + page_size - 1)
            .execute()
        ).data or []

        rows.extend(page)

        if len(page) < page_size:
            break

        start += page_size

    latest_by_user: dict[str, dict] = {}
    for row in rows:
        user_id = row.get("user_id")
        if user_id not in latest_by_user:
            latest_by_user[user_id] = row

    return list(latest_by_user.values())


def fetch_global_history_rows(snapshot_ids: list[str], page_size: int = 1000) -> list[dict]:
    rows: list[dict] = []
    start = 0

    while True:
        page = (
            supabase.table("listening_history")
            .select("ms_played,track_name,artist_name,spotify_track_uri,played_at")
            .in_("snapshot_id", snapshot_ids)
            .range(start, start + page_size - 1)
            .execute()
        ).data or []

        rows.extend(page)

        if len(page) < page_size:
            break

        start += page_size

    return rows


def empty_global_metrics() -> dict:
    return {
        "total_streams": 0,
        "total_ms_played": 0,
        "unique_tracks": 0,
        "unique_artists": 0,
        "top_track": None,
        "top_artist": None,
        "total_active_users": 0,
        "top_tracks": [],
        "top_artists": [],
        "day_ms": 0,
        "night_ms": 0,
        "weekday_ms": 0,
        "weekend_ms": 0,
    }


def get_latest_global_metrics() -> dict:
    result = (
        supabase.table("global_metrics")
        .select("*")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    if not result.data:
        return empty_global_metrics()

    return result.data[0]


def compute_global_metrics() -> dict:
    latest_snapshots = get_latest_snapshots_per_user()

    if not latest_snapshots:
        return empty_global_metrics()

    snapshot_ids = [row["id"] for row in latest_snapshots if row.get("id")]

    if not snapshot_ids:
        return empty_global_metrics()

    rows = fetch_global_history_rows(snapshot_ids)

    if not rows:
        empty_metrics = empty_global_metrics()
        empty_metrics["total_active_users"] = len(
            {row["user_id"] for row in latest_snapshots if row.get("user_id")}
        )
        return empty_metrics

    total_streams = len(rows)
    total_ms_played = sum(row.get("ms_played", 0) or 0 for row in rows)
    total_active_users = len(
        {row["user_id"] for row in latest_snapshots if row.get("user_id")}
    )

    unique_track_keys: set[str] = set()
    unique_artists: set[str] = set()

    track_counter: Counter[str] = Counter()
    artist_counter: Counter[str] = Counter()
    track_time_counter: dict[str, int] = defaultdict(int)
    artist_time_counter: dict[str, int] = defaultdict(int)

    track_labels: dict[str, str] = {}
    
    day_ms = 0
    night_ms = 0
    weekday_ms = 0
    weekend_ms = 0

    for row in rows:
        track_name = (row.get("track_name") or "").strip()
        artist_name = (row.get("artist_name") or "").strip()
        track_uri = (row.get("spotify_track_uri") or "").strip()
        ms_played = row.get("ms_played", 0) or 0

        if artist_name:
            unique_artists.add(artist_name)
            artist_counter[artist_name] += 1
            artist_time_counter[artist_name] += ms_played

        # Prefer Spotify URI for identity; fall back to name+artist if URI is missing.
        track_key = track_uri or f"{track_name}::{artist_name}"

        if track_name or artist_name:
            unique_track_keys.add(track_key)
            track_counter[track_key] += 1
            track_time_counter[track_key] += ms_played

            if track_key not in track_labels:
                if track_name and artist_name:
                    track_labels[track_key] = f"{track_name} - {artist_name}"
                elif track_name:
                    track_labels[track_key] = track_name
                else:
                    track_labels[track_key] = "Unknown Track"
        #
        end_time = parse_end_time(row.get("played_at"))
        if end_time:
            hour = end_time.hour
            weekday = end_time.weekday()

            if 8 <= hour < 20:
                day_ms += ms_played
            else:
                night_ms += ms_played

            if weekday < 5:
                weekday_ms += ms_played
            else:
                weekend_ms += ms_played

    top_track_key = track_counter.most_common(1)[0][0] if track_counter else None
    top_artist_name = artist_counter.most_common(1)[0][0] if artist_counter else None

    top_tracks = [
        {
            "name": track_labels.get(track_key, track_key),
            "streams": track_counter[track_key],
            "total_ms_played": total_ms_played,
        }
        for track_key, total_ms_played in sorted(
            track_time_counter.items(),
            key=lambda item: item[1],
            reverse=True,
        )[:10]
    ]

    top_artists = [
        {
            "name": artist_name,
            "streams": artist_counter[artist_name],
            "total_ms_played": total_ms_played,
        }
        for artist_name, total_ms_played in sorted(
            artist_time_counter.items(),
            key=lambda item: item[1],
            reverse=True,
        )[:10]
    ]
    #Added fields for tracking daytime, nighttime, weekday, and weekend listening time
    return {
        "total_streams": total_streams,
        "total_ms_played": total_ms_played,
        "unique_tracks": len(unique_track_keys),
        "unique_artists": len(unique_artists),
        "top_track": track_labels.get(top_track_key) if top_track_key else None,
        "top_artist": top_artist_name,
        "total_active_users": total_active_users,
        "top_tracks": top_tracks,
        "top_artists": top_artists,
        "day_ms": day_ms,
        "night_ms": night_ms,
        "weekday_ms": weekday_ms,
        "weekend_ms": weekend_ms,
    }


def compute_and_save_global_metrics() -> dict:
    metrics = compute_global_metrics()
    supabase.table("global_metrics").insert(metrics).execute()
    return metrics
