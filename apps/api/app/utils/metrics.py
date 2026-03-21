from collections import Counter

# Calculates basic metrics for uploaded data
def compute_metrics(rows: list[dict], user_id: str) -> dict:
    total_streams = len(rows)
    total_ms_played = sum(row.get("ms_played", 0) or 0 for row in rows)

    track_names = [row.get("track_name") for row in rows if row.get("track_name")]
    artist_names = [row.get("artist_name") for row in rows if row.get("artist_name")]

    unique_tracks = len(set(track_names))
    unique_artists = len(set(artist_names))

    top_track = Counter(track_names).most_common(1)
    top_artist = Counter(artist_names).most_common(1)

    return {
        "user_id": user_id,
        "total_streams": total_streams,
        "total_ms_played": total_ms_played,
        "unique_tracks": unique_tracks,
        "unique_artists": unique_artists,
        "top_track": top_track[0][0] if top_track else None,
        "top_artist": top_artist[0][0] if top_artist else None,
    }