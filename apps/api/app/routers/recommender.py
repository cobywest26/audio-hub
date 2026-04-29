from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.auth import get_current_user_id
from app.recommender.pipeline import (
    generate_and_store_recommendations,
    get_latest_stored_recommendations,
)

router = APIRouter(prefix="/recommender", tags=["recommender"])


@router.get("/me")
def get_my_recommendations(
    user_id: str = Depends(get_current_user_id),
):
    try:
        return get_latest_stored_recommendations(user_id=user_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/generate")
def generate_my_recommendations(
    user_id: str = Depends(get_current_user_id),
    limit: int = Query(default=15, ge=1, le=50),
    use_lightfm_rerank: bool = Query(default=False),
    use_external_discovery: bool = Query(default=True),
):
    try:
        return generate_and_store_recommendations(
            user_id=user_id,
            limit=limit,
            use_lightfm_rerank=use_lightfm_rerank,
            use_external_discovery=use_external_discovery,
        )
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=500,
            detail=(
                f"{exc}. Set SPOTIFY_TRACKS_CSV_PATH to the Kaggle Spotify tracks CSV "
                "or place it at apps/api/data/spotify_tracks.csv."
            ),
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
