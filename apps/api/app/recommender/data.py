from collections import defaultdict
from dataclasses import dataclass
from math import log1p


@dataclass(frozen=True)
class Interaction:
    user_id: str
    track_id: str
    play_count: int
    total_ms_played: int
    weight: float


def compute_interaction_weight(play_count: int, total_ms_played: int) -> float:
    seconds_played = total_ms_played / 1000
    return play_count + log1p(seconds_played)


def extract_spotify_track_id(value: str | None) -> str | None:
    """Return the Spotify track ID from a Spotify URI or track URL."""
    if not value:
        return None

    value = value.strip()
    if not value:
        return None

    if value.startswith("spotify:track:"):
        return value.rsplit(":", maxsplit=1)[-1] or None

    marker = "/track/"
    if marker in value:
        track_id = value.split(marker, maxsplit=1)[-1].split("?", maxsplit=1)[0]
        return track_id or None

    return value


def fetch_listening_history_rows(
    user_id: str | None = None,
    page_size: int = 5000,
) -> list[dict]:
    from app.core.supabase_client import supabase

    rows: list[dict] = []
    start = 0

    while True:
        query = (
            supabase.table("listening_history")
            .select("user_id,spotify_track_uri,ms_played,played_at,track_name,artist_name")
            .range(start, start + page_size - 1)
        )

        if user_id:
            query = query.eq("user_id", user_id)

        page = query.execute().data or []
        rows.extend(page)

        if len(page) < page_size:
            break

        start += page_size

    return rows


def fetch_latest_snapshot_top_tracks(
    user_id: str,
    limit: int = 15,
) -> list[dict]:
    from app.core.supabase_client import supabase

    snapshot_result = (
        supabase.table("snapshots")
        .select("id")
        .eq("user_id", user_id)
        .eq("status", "ready")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    if not snapshot_result.data:
        return []

    snapshot_id = snapshot_result.data[0]["id"]
    metric_result = (
        supabase.table("snapshot_metric")
        .select("top_tracks")
        .eq("snapshot_id", snapshot_id)
        .limit(1)
        .execute()
    )

    if not metric_result.data:
        return []

    top_tracks = metric_result.data[0].get("top_tracks") or []
    return [track for track in top_tracks[:limit] if track.get("name")]


def fetch_track_lookup_row(
    user_id: str,
    track_name: str,
) -> dict | None:
    from app.core.supabase_client import supabase

    result = (
        supabase.table("listening_history")
        .select("spotify_track_uri,track_name,artist_name,played_at")
        .eq("user_id", user_id)
        .eq("track_name", track_name)
        .order("played_at", desc=True)
        .limit(1)
        .execute()
    )

    return result.data[0] if result.data else None


def build_seed_interactions_from_top_tracks(
    user_id: str,
    top_tracks: list[dict],
    resolved_rows_by_name: dict[str, dict],
) -> tuple[list[Interaction], list[dict]]:
    grouped: dict[str, dict[str, int]] = defaultdict(
        lambda: {"play_count": 0, "total_ms_played": 0}
    )
    resolved_top_tracks: list[dict] = []

    for top_track in top_tracks:
        track_name = (top_track.get("name") or "").strip()
        if not track_name:
            continue

        lookup_row = resolved_rows_by_name.get(track_name)
        if not lookup_row:
            continue

        track_id = extract_spotify_track_id(lookup_row.get("spotify_track_uri"))
        if not track_id:
            continue

        play_count = int(top_track.get("streams") or 0)
        total_ms_played = int(top_track.get("total_ms_played") or 0)

        grouped[track_id]["play_count"] += max(play_count, 1)
        grouped[track_id]["total_ms_played"] += max(total_ms_played, 0)
        resolved_top_tracks.append(
            {
                "user_id": user_id,
                "spotify_track_uri": lookup_row.get("spotify_track_uri"),
                "track_name": lookup_row.get("track_name") or track_name,
                "artist_name": lookup_row.get("artist_name"),
                "ms_played": total_ms_played,
                "play_count": max(play_count, 1),
            }
        )

    interactions = [
        Interaction(
            user_id=user_id,
            track_id=track_id,
            play_count=totals["play_count"],
            total_ms_played=totals["total_ms_played"],
            weight=compute_interaction_weight(
                totals["play_count"],
                totals["total_ms_played"],
            ),
        )
        for track_id, totals in grouped.items()
    ]

    return interactions, resolved_top_tracks


def fetch_snapshot_seed_interactions(
    user_id: str,
    limit: int = 15,
) -> tuple[list[Interaction], list[dict]]:
    top_tracks = fetch_latest_snapshot_top_tracks(user_id=user_id, limit=limit)
    if not top_tracks:
        return [], []

    resolved_rows_by_name: dict[str, dict] = {}
    for top_track in top_tracks:
        track_name = (top_track.get("name") or "").strip()
        if not track_name or track_name in resolved_rows_by_name:
            continue

        lookup_row = fetch_track_lookup_row(user_id=user_id, track_name=track_name)
        if lookup_row:
            resolved_rows_by_name[track_name] = lookup_row

    return build_seed_interactions_from_top_tracks(
        user_id=user_id,
        top_tracks=top_tracks,
        resolved_rows_by_name=resolved_rows_by_name,
    )


def aggregate_interactions(rows: list[dict]) -> list[Interaction]:
    grouped: dict[tuple[str, str], dict[str, int]] = defaultdict(
        lambda: {"play_count": 0, "total_ms_played": 0}
    )

    for row in rows:
        user_id = row.get("user_id")
        track_id = extract_spotify_track_id(row.get("spotify_track_uri"))

        if not user_id or not track_id:
            continue

        key = (str(user_id), track_id)
        grouped[key]["play_count"] += 1
        grouped[key]["total_ms_played"] += int(row.get("ms_played") or 0)

    interactions: list[Interaction] = []
    for (user_id, track_id), totals in grouped.items():
        interactions.append(
            Interaction(
                user_id=user_id,
                track_id=track_id,
                play_count=totals["play_count"],
                total_ms_played=totals["total_ms_played"],
                weight=compute_interaction_weight(
                    totals["play_count"],
                    totals["total_ms_played"],
                ),
            )
        )

    return interactions


def matched_interactions(
    interactions: list[Interaction],
    catalog_track_ids: set[str],
) -> list[Interaction]:
    return [interaction for interaction in interactions if interaction.track_id in catalog_track_ids]


def coverage_summary(
    interactions: list[Interaction],
    catalog_track_ids: set[str],
    user_id: str | None = None,
) -> dict:
    scoped_interactions = [
        interaction
        for interaction in interactions
        if user_id is None or interaction.user_id == user_id
    ]
    matched = matched_interactions(scoped_interactions, catalog_track_ids)

    total_tracks = len({interaction.track_id for interaction in scoped_interactions})
    matched_tracks = len({interaction.track_id for interaction in matched})

    return {
        "total_interactions": len(scoped_interactions),
        "matched_interactions": len(matched),
        "total_unique_tracks": total_tracks,
        "matched_unique_tracks": matched_tracks,
        "match_rate": (matched_tracks / total_tracks) if total_tracks else 0,
    }
