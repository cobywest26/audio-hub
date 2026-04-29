import logging
import os
from pathlib import Path

from dotenv import load_dotenv

from app.recommender.catalog import load_catalog
from app.recommender.data import (
    aggregate_interactions,
    coverage_summary,
    fetch_listening_history_rows,
    fetch_snapshot_seed_interactions,
)
from app.recommender.fallback import (
    build_user_feature_profile,
    finalize_recommendations,
    recommend_content_based,
    score_content_candidates,
)
from app.recommender.llm_discovery import generate_verified_external_recommendations
from app.recommender.model import (
    RecommenderBundle,
    recommend_with_lightfm,
    rerank_candidates_with_lightfm,
    train_lightfm_model,
)
from app.recommender.storage import fetch_latest_recommendation_batch, store_recommendation_batch


DEFAULT_CATALOG_PATH = Path(__file__).resolve().parents[2] / "data" / "spotify_tracks.csv"
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"
MIN_MATCHED_TRACKS_FOR_LIGHTFM = 5
MIN_MATCH_RATE_FOR_LIGHTFM = 0.05
CONTENT_CANDIDATE_POOL_SIZE = 150


logger = logging.getLogger(__name__)

load_dotenv(ENV_FILE)


def get_catalog_path(csv_path: str | None = None) -> Path:
    configured_path = csv_path or os.getenv("SPOTIFY_TRACKS_CSV_PATH")
    return Path(configured_path).expanduser() if configured_path else DEFAULT_CATALOG_PATH


def build_content_recommendations(
    user_id: str,
    csv_path: str | None = None,
    limit: int = 15,
    use_lightfm_rerank: bool = False,
    use_external_discovery: bool = True,
) -> dict:
    catalog = load_catalog(get_catalog_path(csv_path))
    if use_lightfm_rerank:
        rows = fetch_listening_history_rows()
        interactions = aggregate_interactions(rows)
        source_rows = rows
    else:
        interactions, source_rows = fetch_snapshot_seed_interactions(user_id=user_id)
        if not interactions:
            source_rows = fetch_listening_history_rows(user_id=user_id)
            interactions = aggregate_interactions(source_rows)

    listened_track_ids = {
        interaction.track_id
        for interaction in interactions
        if interaction.user_id == user_id
    }
    coverage = coverage_summary(interactions, set(catalog.keys()), user_id=user_id)
    content_candidates = score_content_candidates(
        interactions=interactions,
        catalog=catalog,
        user_id=user_id,
        listened_track_ids=listened_track_ids,
        candidate_pool_size=CONTENT_CANDIDATE_POOL_SIZE,
    )

    strategy = "content_profile"
    ranked_candidates = content_candidates

    if use_lightfm_rerank and has_enough_lightfm_coverage(coverage):
        try:
            lightfm_candidates = rerank_candidates_with_lightfm(
                interactions=interactions,
                catalog=catalog,
                user_id=user_id,
                candidates=content_candidates,
            )

            if lightfm_candidates:
                ranked_candidates = lightfm_candidates
                strategy = "content_profile_lightfm_rerank"
        except (RuntimeError, ValueError):
            ranked_candidates = content_candidates

    recommendations = finalize_recommendations(ranked_candidates, limit=limit)
    external_recommendations = []

    if use_external_discovery:
        profile = build_user_feature_profile(interactions, catalog, user_id)
        target_external_count = min(3, max(1, limit // 5))
        try:
            external_recommendations = generate_verified_external_recommendations(
                rows=source_rows,
                interactions=interactions,
                user_id=user_id,
                profile=profile,
                content_recommendations=recommendations,
                listened_track_ids=listened_track_ids,
                dataset_track_ids=set(catalog.keys()),
                target_count=target_external_count,
            )
        except Exception:
            logger.exception("External discovery failed; falling back to content-based recommendations.")
            external_recommendations = []

    if external_recommendations:
        keep_count = max(0, limit - len(external_recommendations))
        recommendations = rerank_final_recommendations(
            recommendations[:keep_count] + external_recommendations
        )
        strategy = f"{strategy}_external_discovery"

    return {
        "strategy": strategy,
        "coverage": coverage,
        "recommendations": recommendations,
    }


def rerank_final_recommendations(recommendations: list[dict]) -> list[dict]:
    return [
        {**recommendation, "rank": rank}
        for rank, recommendation in enumerate(recommendations, start=1)
    ]


def has_enough_lightfm_coverage(coverage: dict) -> bool:
    return (
        coverage["matched_unique_tracks"] >= MIN_MATCHED_TRACKS_FOR_LIGHTFM
        and coverage["match_rate"] >= MIN_MATCH_RATE_FOR_LIGHTFM
    )


def generate_and_store_recommendations(
    user_id: str,
    csv_path: str | None = None,
    limit: int = 15,
    use_lightfm_rerank: bool = False,
    use_external_discovery: bool = True,
) -> dict:
    result = build_content_recommendations(
        user_id=user_id,
        csv_path=csv_path,
        limit=limit,
        use_lightfm_rerank=use_lightfm_rerank,
        use_external_discovery=use_external_discovery,
    )

    stored = store_recommendation_batch(
        user_id=user_id,
        strategy=result["strategy"],
        coverage=result["coverage"],
        recommendations=result["recommendations"],
    )

    return {
        **stored,
        "strategy": result["strategy"],
        "coverage": result["coverage"],
    }


def get_latest_stored_recommendations(user_id: str) -> dict:
    return fetch_latest_recommendation_batch(user_id)


def train_from_history(
    csv_path: str | None = None,
    user_id: str | None = None,
    epochs: int = 15,
    no_components: int = 30,
) -> tuple[RecommenderBundle, dict]:
    catalog = load_catalog(get_catalog_path(csv_path))
    rows = fetch_listening_history_rows(user_id=user_id)
    interactions = aggregate_interactions(rows)
    coverage = coverage_summary(interactions, set(catalog.keys()), user_id=user_id)
    bundle = train_lightfm_model(
        interactions,
        catalog,
        epochs=epochs,
        no_components=no_components,
    )
    return bundle, coverage


def recommend_for_user(
    user_id: str,
    csv_path: str | None = None,
    limit: int = 20,
    epochs: int = 15,
    no_components: int = 30,
) -> dict:
    catalog = load_catalog(get_catalog_path(csv_path))
    rows = fetch_listening_history_rows()
    interactions = aggregate_interactions(rows)
    listened_track_ids = {
        interaction.track_id
        for interaction in interactions
        if interaction.user_id == user_id
    }
    coverage = coverage_summary(interactions, set(catalog.keys()), user_id=user_id)

    if (
        coverage["matched_unique_tracks"] < MIN_MATCHED_TRACKS_FOR_LIGHTFM
        or coverage["match_rate"] < MIN_MATCH_RATE_FOR_LIGHTFM
    ):
        return {
            "strategy": "content_profile",
            "coverage": coverage,
            "recommendations": recommend_content_based(
                interactions,
                catalog,
                user_id,
                listened_track_ids,
                limit=limit,
            ),
        }

    bundle = train_lightfm_model(
        interactions,
        catalog,
        epochs=epochs,
        no_components=no_components,
    )
    recommendations = recommend_with_lightfm(
        bundle,
        user_id,
        listened_track_ids,
        limit=limit,
    )

    return {
        "strategy": "lightfm" if recommendations else "content_profile",
        "coverage": coverage,
        "recommendations": recommendations
        or recommend_content_based(
            interactions,
            catalog,
            user_id,
            listened_track_ids,
            limit=limit,
        ),
    }