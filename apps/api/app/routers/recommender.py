from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.auth import get_current_user_id
from app.recommender.catalog import CatalogTrack, load_catalog
from app.recommender.data import (
    aggregate_interactions,
    coverage_summary,
    fetch_listening_history_rows,
)
from app.recommender.fallback import recommend_content_based

router = APIRouter(prefix="/recommender", tags=["recommender"])


def _candidate_catalog_paths() -> list[Path]:
    """
    Try a few reasonable locations for the Spotify catalog dataset.
    This repo snapshot did not include the dataset file itself, so we
    search common locations instead of hardcoding one brittle path.
    """
    app_dir = Path(__file__).resolve().parents[1]
    api_dir = app_dir.parent
    repo_root = api_dir.parent.parent

    return [
        app_dir / "recommender" / "spotify_tracks.csv",
        app_dir / "recommender" / "data" / "spotify_tracks.csv",
        api_dir / "data" / "spotify_tracks.csv",
        repo_root / "data" / "spotify_tracks.csv",
        repo_root / "supabase" / "spotify_tracks.csv",
    ]


@lru_cache(maxsize=1)
def _get_catalog() -> dict[str, CatalogTrack]:
    last_error: Exception | None = None

    for path in _candidate_catalog_paths():
        try:
            if path.exists():
                return load_catalog(path)
        except Exception as exc:
            last_error = exc

    if last_error:
        raise RuntimeError(f"Catalog load failed: {last_error}")

    raise RuntimeError(
        "Spotify catalog dataset not found. "
        "Place spotify_tracks.csv in one of the expected data locations."
    )


def _build_recommendation_payload(user_id: str, limit: int = 20) -> dict:
    catalog = _get_catalog()
    rows = fetch_listening_history_rows(user_id=user_id)
    interactions = aggregate_interactions(rows)

    if not interactions:
        return {
            "user_id": user_id,
            "has_data": False,
            "coverage": {
                "total_interactions": 0,
                "matched_interactions": 0,
                "total_unique_tracks": 0,
                "matched_unique_tracks": 0,
                "match_rate": 0,
            },
            "recommendations": [],
        }

    catalog_track_ids = set(catalog.keys())
    coverage = coverage_summary(
        interactions=interactions,
        catalog_track_ids=catalog_track_ids,
        user_id=user_id,
    )

    listened_track_ids = {
        interaction.track_id
        for interaction in interactions
        if interaction.user_id == user_id
    }

    recommendations = recommend_content_based(
        interactions=interactions,
        catalog=catalog,
        user_id=user_id,
        listened_track_ids=listened_track_ids,
        limit=limit,
    )

    return {
        "user_id": user_id,
        "has_data": True,
        "coverage": coverage,
        "recommendations": recommendations,
    }

@router.get("/debug")
def debug_recommender(user_id: str = Depends(get_current_user_id)):
    result = {"user_id": user_id}

    # Step 1: catalog
    try:
        catalog = _get_catalog()
        result["catalog_loaded"] = True
        result["catalog_size"] = len(catalog)
    except Exception as exc:
        result["catalog_loaded"] = False
        result["catalog_error"] = repr(exc)
        return result

    # Step 2: rows
    try:
        rows = fetch_listening_history_rows(user_id=user_id)
        result["rows_loaded"] = True
        result["row_count"] = len(rows)
        result["sample_row"] = rows[0] if rows else None
    except Exception as exc:
        result["rows_loaded"] = False
        result["rows_error"] = repr(exc)
        return result

    # Step 3: interactions
    try:
        interactions = aggregate_interactions(rows)
        result["interactions_built"] = True
        result["interaction_count"] = len(interactions)
    except Exception as exc:
        result["interactions_built"] = False
        result["interactions_error"] = repr(exc)
        return result

    # Step 4: listened tracks
    try:
        listened_track_ids = {
            interaction.track_id
            for interaction in interactions
            if interaction.user_id == user_id
        }
        result["listened_track_count"] = len(listened_track_ids)
    except Exception as exc:
        result["listened_track_error"] = repr(exc)
        return result

    # Step 5: recommendations
    try:
        recommendations = recommend_content_based(
            interactions=interactions,
            catalog=catalog,
            user_id=user_id,
            listened_track_ids=listened_track_ids,
            limit=5,
        )
        result["recommendations_built"] = True
        result["recommendation_count"] = len(recommendations)
        result["sample_recommendation"] = recommendations[0] if recommendations else None
        return result
    except Exception as exc:
        result["recommendations_built"] = False
        result["recommendations_error"] = repr(exc)
        return result

@router.get("/health")
def recommender_health() -> dict:
    """
    Light health endpoint so you can tell whether the recommender
    package is reachable without forcing a catalog load.
    """
    return {
        "status": "ok",
        "router": "recommender",
    }


@router.get("/coverage")
def get_recommender_coverage(user_id: str = Depends(get_current_user_id)) -> dict:
    try:
        catalog = _get_catalog()
        rows = fetch_listening_history_rows(user_id=user_id)
        interactions = aggregate_interactions(rows)

        return {
            "user_id": user_id,
            "has_data": len(interactions) > 0,
            "coverage": coverage_summary(
                interactions=interactions,
                catalog_track_ids=set(catalog.keys()),
                user_id=user_id,
            ),
        }
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to compute recommender coverage: {exc}",
        ) from exc


@router.get("/me")
def get_my_recommendations(
    limit: int = Query(default=20, ge=1, le=50),
    user_id: str = Depends(get_current_user_id),
):
    catalog = _get_catalog()
    return {
        "user_id": user_id,
        "has_data": True,
        "catalog_size": len(catalog),
    }