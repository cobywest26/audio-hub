#Compare AudioHub's recommender against Baseline A.

# Baseline: recommends the most popular catalog tracks from artists the user already
# listens to, excluding tracks the user has already heard.

#Run from apps/api:
#    python scripts/evaluate_recommender_baseline.py --user-id YOUR_SUPABASE_USER_ID --limit 15

#Optional:
#    python scripts/evaluate_recommender_baseline.py --user-id YOUR_ID --csv-path /path/to/spotify_tracks.csv

from __future__ import annotations

from collections import Counter

import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))

import argparse
from statistics import mean

from app.recommender.catalog import CatalogTrack, load_catalog
from app.recommender.data import (
    Interaction,
    aggregate_interactions,
    coverage_summary,
    fetch_listening_history_rows,
    fetch_snapshot_seed_interactions,
)
from app.recommender.fallback import (
    build_user_feature_profile,
    cosine_similarity,
    dedupe_similar_tracks,
    finalize_recommendations,
    first_artist_key,
)
from app.recommender.pipeline import build_content_recommendations, get_catalog_path


def load_user_interactions(user_id: str) -> tuple[list[Interaction], list[dict]]:
    """Use the same seed preference source as the app recommender."""
    interactions, source_rows = fetch_snapshot_seed_interactions(user_id=user_id)

    if interactions:
        return interactions, source_rows

    source_rows = fetch_listening_history_rows(user_id=user_id)
    return aggregate_interactions(source_rows), source_rows


def get_listened_track_ids(interactions: list[Interaction], user_id: str) -> set[str]:
    return {
        interaction.track_id
        for interaction in interactions
        if interaction.user_id == user_id
    }


def build_artist_popularity_baseline(
    interactions: list[Interaction],
    catalog: dict[str, CatalogTrack],
    user_id: str,
    listened_track_ids: set[str],
    limit: int,
) -> list[dict]:
    """Baseline: popular unlistened tracks by artists the user already listens to."""
    listened_artist_keys = {
        first_artist_key(catalog[interaction.track_id].artists)
        for interaction in interactions
        if interaction.user_id == user_id and interaction.track_id in catalog
    }

    candidates: list[dict] = []
    for track_id, track in catalog.items():
        if track_id in listened_track_ids:
            continue

        if first_artist_key(track.artists) not in listened_artist_keys:
            continue

        candidates.append(
            {
                "track_id": track_id,
                "track_name": track.track_name,
                "artists": track.artists,
                "genre": track.genre,
                "popularity": track.popularity,
                "score": track.popularity,
                "source": "baseline_artist_popularity",
                "reason": "Popular catalog track by an artist the user already listens to.",
            }
        )

    candidates.sort(key=lambda item: item["popularity"], reverse=True)
    return finalize_recommendations(dedupe_similar_tracks(candidates), limit=limit)


def attach_similarity_scores(
    recommendations: list[dict],
    catalog: dict[str, CatalogTrack],
    profile: dict[str, float],
) -> list[dict]:
    scored: list[dict] = []
    for recommendation in recommendations:
        track = catalog.get(recommendation.get("track_id"))
        similarity = cosine_similarity(profile, track.numeric_features) if track else 0.0
        scored.append({**recommendation, "taste_similarity": similarity})
    return scored


def average_similarity(recommendations: list[dict]) -> float:
    if not recommendations:
        return 0.0
    return mean(item.get("taste_similarity", 0.0) for item in recommendations)


def percent_improvement(main_value: float, baseline_value: float) -> float | None:
    if baseline_value == 0:
        return None
    return ((main_value - baseline_value) / baseline_value) * 100


def print_recommendation_table(title: str, recommendations: list[dict]) -> None:
    print(f"\n{title}")
    print("-" * len(title))
    for item in recommendations:
        print(
            f"{item['rank']:>2}. {item.get('track_name') or 'Unknown'} "
            f"— {item.get('artists') or 'Unknown artist'} "
            f"| similarity={item.get('taste_similarity', 0):.4f} "
            f"| popularity={item.get('popularity', 0):.0f}"
        )

def recommendation_artist_key(recommendation: dict) -> str:
    return (
        recommendation.get("artists")
        or recommendation.get("artist_name")
        or "Unknown artist"
    )


def unique_artists(recommendations: list[dict]) -> int:
    return len({recommendation_artist_key(recommendation) for recommendation in recommendations})


def artist_concentration(recommendations: list[dict]) -> float:
    if not recommendations:
        return 0.0

    counts = Counter(
        recommendation_artist_key(recommendation)
        for recommendation in recommendations
    )
    most_common = counts.most_common(1)[0][1]
    return most_common / len(recommendations)

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--user-id", required=True, help="Supabase auth.users.id to evaluate")
    parser.add_argument("--csv-path", default=None, help="Optional path to spotify_tracks.csv")
    parser.add_argument("--limit", type=int, default=15, help="Number of recommendations to compare")
    parser.add_argument(
        "--use-lightfm-rerank",
        action="store_true",
        help="Evaluate the optional LightFM reranker instead of the default content profile output",
    )
    args = parser.parse_args()

    catalog = load_catalog(get_catalog_path(args.csv_path))
    interactions, _ = load_user_interactions(args.user_id)
    listened_track_ids = get_listened_track_ids(interactions, args.user_id)
    coverage = coverage_summary(interactions, set(catalog.keys()), user_id=args.user_id)

    if not interactions:
        raise SystemExit("No listening history or snapshot seed interactions found for this user.")

    profile = build_user_feature_profile(interactions, catalog, args.user_id)

    main_result = build_content_recommendations(
        user_id=args.user_id,
        csv_path=args.csv_path,
        limit=args.limit,
        use_lightfm_rerank=args.use_lightfm_rerank,
        use_external_discovery=False,
    )
    main_recommendations = attach_similarity_scores(
        main_result["recommendations"],
        catalog,
        profile,
    )

    baseline_recommendations = build_artist_popularity_baseline(
        interactions=interactions,
        catalog=catalog,
        user_id=args.user_id,
        listened_track_ids=listened_track_ids,
        limit=args.limit,
    )
    baseline_recommendations = attach_similarity_scores(
        baseline_recommendations,
        catalog,
        profile,
    )

    main_avg = average_similarity(main_recommendations)
    baseline_avg = average_similarity(baseline_recommendations)
    improvement = percent_improvement(main_avg, baseline_avg)

    main_unique = unique_artists(main_recommendations)
    base_unique = unique_artists(baseline_recommendations)

    main_conc = artist_concentration(main_recommendations)
    base_conc = artist_concentration(baseline_recommendations)

    print("\nDiversity Metrics")
    print("-------------------")
    print(f"Main unique artists: {main_unique}")
    print(f"Baseline unique artists: {base_unique}")
    print(f"Main top-artist share: {main_conc:.2%}")
    print(f"Baseline top-artist share: {base_conc:.2%}")

    print("\nAudioHub recommender evaluation")
    print("===============================")
    print(f"User ID: {args.user_id}")
    print(f"Main strategy: {main_result['strategy']}")
    print(f"Limit: {args.limit}")
    print(f"Matched unique tracks: {coverage['matched_unique_tracks']} / {coverage['total_unique_tracks']}")
    print(f"Catalog match rate: {coverage['match_rate']:.2%}")
    print(f"Main average taste similarity: {main_avg:.4f}")
    print(f"Baseline average taste similarity: {baseline_avg:.4f}")

    if improvement is None:
        print("Outcome: Cannot compute percent improvement because baseline similarity is 0.")
    elif improvement >= 0:
        print(
            f"Outcome: Our recommender outperformed the baseline by being "
            f"{improvement:.2f}% closer to the user's taste profile."
        )
    else:
        print(
            f"Outcome: Baseline outperformed our recommender by being "
            f"{abs(improvement):.2f}% closer to the user's taste profile."
        )

    print_recommendation_table("Main recommender", main_recommendations)
    print_recommendation_table("Baseline: artist popularity", baseline_recommendations)


if __name__ == "__main__":
    main()
