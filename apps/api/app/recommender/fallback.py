import re
from math import sqrt

from app.recommender.catalog import CatalogTrack, NUMERIC_FEATURE_COLUMNS
from app.recommender.data import Interaction


def _dot(left: dict[str, float], right: dict[str, float]) -> float:
    return sum(left.get(key, 0) * right.get(key, 0) for key in NUMERIC_FEATURE_COLUMNS)


def _magnitude(vector: dict[str, float]) -> float:
    return sqrt(sum(vector.get(key, 0) ** 2 for key in NUMERIC_FEATURE_COLUMNS))


def cosine_similarity(left: dict[str, float], right: dict[str, float]) -> float:
    denominator = _magnitude(left) * _magnitude(right)
    if denominator == 0:
        return 0

    return _dot(left, right) / denominator


def build_user_feature_profile(
    interactions: list[Interaction],
    catalog: dict[str, CatalogTrack],
    user_id: str,
) -> dict[str, float]:
    profile = {column: 0.0 for column in NUMERIC_FEATURE_COLUMNS}
    total_weight = 0.0

    user_interactions = [
        interaction
        for interaction in interactions
        if interaction.user_id == user_id and interaction.track_id in catalog
    ]
    user_interactions.sort(key=lambda interaction: interaction.weight, reverse=True)

    for interaction in user_interactions[:50]:
        track = catalog[interaction.track_id]
        total_weight += interaction.weight

        for column in NUMERIC_FEATURE_COLUMNS:
            profile[column] += track.numeric_features.get(column, 0) * interaction.weight

    if total_weight == 0:
        return profile

    return {column: value / total_weight for column, value in profile.items()}


def recommend_content_based(
    interactions: list[Interaction],
    catalog: dict[str, CatalogTrack],
    user_id: str,
    listened_track_ids: set[str],
    limit: int = 20,
    candidate_pool_size: int = 250,
    max_per_artist: int = 2,
) -> list[dict]:
    content_candidates = score_content_candidates(
        interactions=interactions,
        catalog=catalog,
        user_id=user_id,
        listened_track_ids=listened_track_ids,
        candidate_pool_size=candidate_pool_size,
    )

    return finalize_recommendations(
        content_candidates,
        limit=limit,
        max_per_artist=max_per_artist,
    )


def score_content_candidates(
    interactions: list[Interaction],
    catalog: dict[str, CatalogTrack],
    user_id: str,
    listened_track_ids: set[str],
    candidate_pool_size: int = 250,
) -> list[dict]:
    profile = build_user_feature_profile(interactions, catalog, user_id)

    scored: list[tuple[str, float]] = []
    for track_id, track in catalog.items():
        if track_id in listened_track_ids:
            continue

        similarity = cosine_similarity(profile, track.numeric_features)
        popularity_boost = track.popularity / 1000
        scored.append((track_id, similarity + popularity_boost))

    scored.sort(key=lambda item: item[1], reverse=True)

    return dedupe_similar_tracks(
        [
            {
                "track_id": track_id,
                "track_name": catalog[track_id].track_name,
                "artists": catalog[track_id].artists,
                "genre": catalog[track_id].genre,
                "popularity": catalog[track_id].popularity,
                "score": float(score),
                "source": "content_profile",
                "reason": recommendation_reason(profile, catalog[track_id]),
            }
            for track_id, score in scored[:candidate_pool_size]
        ],
    )


def finalize_recommendations(
    recommendations: list[dict],
    limit: int = 15,
    max_per_artist: int = 2,
) -> list[dict]:
    return diversify_recommendations(
        recommendations,
        limit=limit,
        max_per_artist=max_per_artist,
    )


def recommend_content_profile(
    interactions: list[Interaction],
    catalog: dict[str, CatalogTrack],
    user_id: str,
    listened_track_ids: set[str],
    limit: int = 15,
) -> list[dict]:
    return recommend_content_based(
        interactions=interactions,
        catalog=catalog,
        user_id=user_id,
        listened_track_ids=listened_track_ids,
        limit=limit,
    )


def diversify_recommendations(
    recommendations: list[dict],
    limit: int,
    max_per_artist: int = 2,
) -> list[dict]:
    artist_counts: dict[str, int] = {}
    selected: list[dict] = []

    for recommendation in recommendations:
        artist_key = first_artist_key(recommendation.get("artists"))

        if artist_counts.get(artist_key, 0) >= max_per_artist:
            continue

        selected.append({**recommendation, "rank": len(selected) + 1})
        artist_counts[artist_key] = artist_counts.get(artist_key, 0) + 1

        if len(selected) >= limit:
            return selected

    selected_track_ids = {recommendation["track_id"] for recommendation in selected}
    for recommendation in recommendations:
        if recommendation["track_id"] in selected_track_ids:
            continue

        selected.append({**recommendation, "rank": len(selected) + 1})

        if len(selected) >= limit:
            break

    return selected


def dedupe_similar_tracks(recommendations: list[dict]) -> list[dict]:
    seen_keys: set[str] = set()
    deduped: list[dict] = []

    for recommendation in recommendations:
        key = canonical_song_key(
            recommendation.get("track_name"),
            recommendation.get("artists"),
        )

        if key in seen_keys:
            continue

        seen_keys.add(key)
        deduped.append(recommendation)

    return deduped


def canonical_song_key(track_name: str | None, artists: str | None) -> str:
    return f"{normalize_track_name(track_name)}::{first_artist_key(artists)}"


def normalize_track_name(track_name: str | None) -> str:
    if not track_name:
        return "unknown"

    normalized = track_name.lower()
    normalized = re.sub(r"\s*[-(]\s*(with|feat\.?|featuring)\b.*", "", normalized)
    normalized = re.sub(r"\s*-\s*(radio edit|remaster(ed)?|explicit|clean|single version).*", "", normalized)
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized or "unknown"


def first_artist_key(artists: str | None) -> str:
    if not artists:
        return "unknown"

    separator = ";" if ";" in artists else ","
    first_artist = artists.split(separator, maxsplit=1)[0].strip().lower()
    return first_artist or "unknown"


def recommendation_reason(profile: dict[str, float], track: CatalogTrack) -> str:
    strongest_features = sorted(
        (
            (column, profile.get(column, 0))
            for column in NUMERIC_FEATURE_COLUMNS
            if column != "popularity"
        ),
        key=lambda item: item[1],
        reverse=True,
    )[:2]

    readable_features = [
        column.replace("_", " ")
        for column, value in strongest_features
        if value > 0
    ]

    if track.genre and readable_features:
        return f"Matches your {track.genre} listening profile with similar {', '.join(readable_features)}."

    if readable_features:
        return f"Matches your listening profile with similar {', '.join(readable_features)}."

    if track.genre:
        return f"Recommended from the {track.genre} catalog based on your matched listening history."

    return "Recommended from tracks similar to your matched listening history."
