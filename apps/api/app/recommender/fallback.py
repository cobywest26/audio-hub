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

    return [
        {
            "track_id": track_id,
            "track_name": catalog[track_id].track_name,
            "artists": catalog[track_id].artists,
            "genre": catalog[track_id].genre,
            "popularity": catalog[track_id].popularity,
            "score": float(score),
            "source": "content_fallback",
        }
        for track_id, score in scored[:limit]
    ]

