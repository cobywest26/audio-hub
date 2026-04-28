from dataclasses import dataclass

from app.recommender.catalog import CatalogTrack
from app.recommender.data import Interaction


@dataclass
class RecommenderBundle:
    model: object
    dataset: object
    interactions: object
    weights: object
    item_features: object
    catalog: dict[str, CatalogTrack]
    matched_interactions: list[Interaction]


def _load_lightfm():
    try:
        from lightfm import LightFM
        from lightfm.data import Dataset
    except ImportError as exc:
        raise RuntimeError(
            "LightFM is not installed. Run `pip install -r apps/api/requirements.txt` "
            "from the repo root or install the API requirements in your virtualenv."
        ) from exc

    return LightFM, Dataset


def build_feature_name_set(catalog: dict[str, CatalogTrack]) -> set[str]:
    feature_names: set[str] = set()
    for track in catalog.values():
        feature_names.update(track.feature_weights.keys())
    return feature_names


def train_lightfm_model(
    interactions: list[Interaction],
    catalog: dict[str, CatalogTrack],
    epochs: int = 15,
    no_components: int = 30,
    random_state: int = 42,
    item_track_ids: set[str] | None = None,
) -> RecommenderBundle:
    LightFM, Dataset = _load_lightfm()
    model_catalog = (
        {
            track_id: catalog[track_id]
            for track_id in item_track_ids
            if track_id in catalog
        }
        if item_track_ids is not None
        else catalog
    )

    matched = [
        interaction
        for interaction in interactions
        if interaction.track_id in model_catalog
    ]

    if not matched:
        raise ValueError("No listening_history interactions matched the Spotify tracks catalog.")

    dataset = Dataset()
    dataset.fit(
        users=(interaction.user_id for interaction in matched),
        items=model_catalog.keys(),
        item_features=build_feature_name_set(model_catalog),
    )

    interactions_matrix, weights_matrix = dataset.build_interactions(
        (
            (interaction.user_id, interaction.track_id, interaction.weight)
            for interaction in matched
        )
    )

    item_features = dataset.build_item_features(
        (
            (track_id, track.feature_weights)
            for track_id, track in model_catalog.items()
        )
    )

    model = LightFM(
        loss="warp",
        no_components=no_components,
        random_state=random_state,
    )
    model.fit(
        interactions_matrix,
        item_features=item_features,
        sample_weight=weights_matrix,
        epochs=epochs,
        num_threads=1,
    )

    return RecommenderBundle(
        model=model,
        dataset=dataset,
        interactions=interactions_matrix,
        weights=weights_matrix,
        item_features=item_features,
        catalog=model_catalog,
        matched_interactions=matched,
    )


def recommend_with_lightfm(
    bundle: RecommenderBundle,
    user_id: str,
    listened_track_ids: set[str],
    limit: int = 20,
) -> list[dict]:
    user_id_map, _, item_id_map, _ = bundle.dataset.mapping()

    if user_id not in user_id_map:
        return []

    candidate_track_ids = [
        track_id
        for track_id in item_id_map
        if track_id not in listened_track_ids
    ]

    if not candidate_track_ids:
        return []

    user_internal_id = user_id_map[user_id]
    item_internal_ids = [item_id_map[track_id] for track_id in candidate_track_ids]
    scores = bundle.model.predict(
        user_internal_id,
        item_internal_ids,
        item_features=bundle.item_features,
    )

    ranked = sorted(
        zip(candidate_track_ids, scores),
        key=lambda item: item[1],
        reverse=True,
    )[:limit]

    return [
        {
            "track_id": track_id,
            "track_name": bundle.catalog[track_id].track_name,
            "artists": bundle.catalog[track_id].artists,
            "genre": bundle.catalog[track_id].genre,
            "popularity": bundle.catalog[track_id].popularity,
            "score": float(score),
            "source": "lightfm",
        }
        for track_id, score in ranked
    ]


def rerank_candidates_with_lightfm(
    interactions: list[Interaction],
    catalog: dict[str, CatalogTrack],
    user_id: str,
    candidates: list[dict],
    epochs: int = 10,
    no_components: int = 20,
) -> list[dict]:
    if not candidates:
        return []

    candidate_track_ids = {
        candidate["track_id"]
        for candidate in candidates
        if candidate.get("track_id") in catalog
    }
    training_item_ids = candidate_track_ids | {
        interaction.track_id
        for interaction in interactions
        if interaction.track_id in catalog
    }

    bundle = train_lightfm_model(
        interactions=interactions,
        catalog=catalog,
        epochs=epochs,
        no_components=no_components,
        item_track_ids=training_item_ids,
    )
    user_id_map, _, item_id_map, _ = bundle.dataset.mapping()

    if user_id not in user_id_map:
        return []

    scoring_track_ids = [
        candidate["track_id"]
        for candidate in candidates
        if candidate.get("track_id") in item_id_map
    ]

    if not scoring_track_ids:
        return []

    user_internal_id = user_id_map[user_id]
    item_internal_ids = [item_id_map[track_id] for track_id in scoring_track_ids]
    scores = bundle.model.predict(
        user_internal_id,
        item_internal_ids,
        item_features=bundle.item_features,
    )
    lightfm_scores = {
        track_id: float(score)
        for track_id, score in zip(scoring_track_ids, scores)
    }

    reranked = [
        {
            **candidate,
            "content_score": candidate.get("score"),
            "score": lightfm_scores[candidate["track_id"]],
            "source": "lightfm_rerank",
            "reason": "Reranked by LightFM after matching your content-based listening profile.",
        }
        for candidate in candidates
        if candidate.get("track_id") in lightfm_scores
    ]
    reranked.sort(key=lambda candidate: candidate["score"], reverse=True)
    return reranked
