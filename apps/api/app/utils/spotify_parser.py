from datetime import datetime
from typing import Any


def parse_spotify_timestamp(ts: str | None) -> str | None:
    if not ts:
        return None
    try:
        # Handles values like 2019-10-20T09:46:57Z
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).isoformat()
    except Exception:
        return None


def parse_spotify_entry(entry: dict[str, Any], user_id: str, upload_id: str) -> dict[str, Any]:
    return {
        "user_id": user_id,
        "upload_id": upload_id,
        "played_at": parse_spotify_timestamp(entry.get("ts")),
        "track_name": entry.get("master_metadata_track_name"),
        "artist_name": entry.get("master_metadata_album_artist_name"),
        "album_name": entry.get("master_metadata_album_album_name"),
        "spotify_track_uri": entry.get("spotify_track_uri"),
        "ms_played": entry.get("ms_played", 0) or 0,
        "conn_country": entry.get("conn_country"),
        "platform": entry.get("platform"),
    }