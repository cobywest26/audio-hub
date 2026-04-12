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
    page_size: int = 1000,
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
        seconds_played = totals["total_ms_played"] / 1000
        weight = totals["play_count"] + log1p(seconds_played)
        interactions.append(
            Interaction(
                user_id=user_id,
                track_id=track_id,
                play_count=totals["play_count"],
                total_ms_played=totals["total_ms_played"],
                weight=weight,
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
