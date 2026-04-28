import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.recommender.catalog import load_catalog
from app.recommender.data import (
    Interaction,
    aggregate_interactions,
    build_seed_interactions_from_top_tracks,
    compute_interaction_weight,
    coverage_summary,
    extract_spotify_track_id,
)
from app.recommender.fallback import (
    dedupe_similar_tracks,
    diversify_recommendations,
    recommend_content_based,
    score_content_candidates,
)
from app.recommender.model import rerank_candidates_with_lightfm
from app.recommender.llm_discovery import (
    generate_verified_external_recommendations,
    parse_response_json,
)
from app.recommender.pipeline import rerank_final_recommendations


class RecommenderDataTests(unittest.TestCase):
    def test_extracts_track_id_from_spotify_uri(self) -> None:
        self.assertEqual(
            extract_spotify_track_id("spotify:track:abc123"),
            "abc123",
        )

    def test_extracts_track_id_from_spotify_url(self) -> None:
        self.assertEqual(
            extract_spotify_track_id("https://open.spotify.com/track/abc123?si=xyz"),
            "abc123",
        )

    def test_aggregates_interactions_by_user_and_track(self) -> None:
        rows = [
            {"user_id": "u1", "spotify_track_uri": "spotify:track:t1", "ms_played": 1000},
            {"user_id": "u1", "spotify_track_uri": "spotify:track:t1", "ms_played": 3000},
            {"user_id": "u1", "spotify_track_uri": "spotify:track:t2", "ms_played": 500},
            {"user_id": "u2", "spotify_track_uri": "spotify:track:t1", "ms_played": 700},
        ]

        interactions = aggregate_interactions(rows)
        by_key = {(item.user_id, item.track_id): item for item in interactions}

        self.assertEqual(by_key[("u1", "t1")].play_count, 2)
        self.assertEqual(by_key[("u1", "t1")].total_ms_played, 4000)
        self.assertEqual(by_key[("u1", "t2")].play_count, 1)
        self.assertEqual(by_key[("u2", "t1")].play_count, 1)

    def test_coverage_summary_counts_exact_track_matches(self) -> None:
        interactions = [
            Interaction("u1", "t1", 2, 1000, 2.0),
            Interaction("u1", "t2", 1, 1000, 1.0),
            Interaction("u2", "t3", 1, 1000, 1.0),
        ]

        summary = coverage_summary(interactions, {"t1"}, user_id="u1")

        self.assertEqual(summary["total_unique_tracks"], 2)
        self.assertEqual(summary["matched_unique_tracks"], 1)
        self.assertEqual(summary["match_rate"], 0.5)

    def test_builds_seed_interactions_from_snapshot_top_tracks(self) -> None:
        top_tracks = [
            {"name": "Song A", "streams": 4, "total_ms_played": 12000},
            {"name": "Song B", "streams": 2, "total_ms_played": 4000},
        ]
        resolved_rows = {
            "Song A": {
                "spotify_track_uri": "spotify:track:t1",
                "track_name": "Song A",
                "artist_name": "Artist A",
            },
            "Song B": {
                "spotify_track_uri": "spotify:track:t2",
                "track_name": "Song B",
                "artist_name": "Artist B",
            },
        }

        interactions, resolved_top_tracks = build_seed_interactions_from_top_tracks(
            user_id="u1",
            top_tracks=top_tracks,
            resolved_rows_by_name=resolved_rows,
        )

        by_track_id = {item.track_id: item for item in interactions}
        self.assertEqual(set(by_track_id), {"t1", "t2"})
        self.assertEqual(by_track_id["t1"].play_count, 4)
        self.assertEqual(by_track_id["t1"].total_ms_played, 12000)
        self.assertEqual(
            by_track_id["t1"].weight,
            compute_interaction_weight(4, 12000),
        )
        self.assertEqual(resolved_top_tracks[0]["artist_name"], "Artist A")

    def test_skips_snapshot_top_tracks_without_resolved_uri(self) -> None:
        interactions, resolved_top_tracks = build_seed_interactions_from_top_tracks(
            user_id="u1",
            top_tracks=[{"name": "Song A", "streams": 4, "total_ms_played": 12000}],
            resolved_rows_by_name={},
        )

        self.assertEqual(interactions, [])
        self.assertEqual(resolved_top_tracks, [])


class CatalogTests(unittest.TestCase):
    def test_load_catalog_dedupes_by_highest_popularity(self) -> None:
        csv_text = (
            "track_id,track_name,artists,popularity,danceability,energy,track_genre\n"
            "t1,Low Pop,Artist A,10,0.1,0.2,rock\n"
            "t1,High Pop,Artist A,90,0.3,0.4,rock\n"
            "t2,Other,Artist B,50,0.5,0.6,pop\n"
        )

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "spotify_tracks.csv"
            path.write_text(csv_text, encoding="utf-8")

            catalog = load_catalog(path)

        self.assertEqual(len(catalog), 2)
        self.assertEqual(catalog["t1"].track_name, "High Pop")
        self.assertIn("artist:artist a", catalog["t1"].feature_weights)
        self.assertIn("genre:rock", catalog["t1"].feature_weights)


class ContentFallbackTests(unittest.TestCase):
    def test_content_fallback_excludes_already_listened_tracks(self) -> None:
        csv_text = (
            "track_id,track_name,artists,popularity,danceability,energy,valence\n"
            "t1,Listened,Artist A,90,0.9,0.9,0.8\n"
            "t2,Similar,Artist B,80,0.88,0.87,0.78\n"
            "t3,Different,Artist C,70,0.1,0.2,0.1\n"
        )

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "spotify_tracks.csv"
            path.write_text(csv_text, encoding="utf-8")
            catalog = load_catalog(path)

        interactions = [Interaction("u1", "t1", 4, 10000, 5.0)]

        recommendations = recommend_content_based(
            interactions,
            catalog,
            user_id="u1",
            listened_track_ids={"t1"},
            limit=2,
        )

        self.assertEqual([item["track_id"] for item in recommendations], ["t2", "t3"])

    def test_content_recommender_adds_rank_reason_and_content_source(self) -> None:
        csv_text = (
            "track_id,track_name,artists,popularity,danceability,energy,valence,track_genre\n"
            "t1,Listened,Artist A,90,0.9,0.9,0.8,pop\n"
            "t2,Similar,Artist B,80,0.88,0.87,0.78,pop\n"
        )

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "spotify_tracks.csv"
            path.write_text(csv_text, encoding="utf-8")
            catalog = load_catalog(path)

        recommendations = recommend_content_based(
            [Interaction("u1", "t1", 4, 10000, 5.0)],
            catalog,
            user_id="u1",
            listened_track_ids={"t1"},
            limit=1,
        )

        self.assertEqual(recommendations[0]["rank"], 1)
        self.assertEqual(recommendations[0]["source"], "content_profile")
        self.assertIn("reason", recommendations[0])

    def test_diversity_limits_artist_repetition_when_pool_allows(self) -> None:
        recommendations = [
            {
                "track_id": "a1",
                "artists": "Artist A",
                "genre": "pop",
                "score": 1.0,
            },
            {
                "track_id": "a2",
                "artists": "Artist A",
                "genre": "pop",
                "score": 0.9,
            },
            {
                "track_id": "b1",
                "artists": "Artist B",
                "genre": "rock",
                "score": 0.8,
            },
        ]

        diversified = diversify_recommendations(
            recommendations,
            limit=2,
            max_per_artist=1,
        )

        self.assertEqual([item["track_id"] for item in diversified], ["a1", "b1"])

    def test_dedupes_same_song_with_different_track_ids(self) -> None:
        recommendations = [
            {
                "track_id": "5HCyWlXZPP0y6Gqq8TgA20",
                "track_name": "STAY (with Justin Bieber)",
                "artists": "The Kid LAROI;Justin Bieber",
            },
            {
                "track_id": "5PjdY0CKGZdEuoNab3yDmX",
                "track_name": "STAY (with Justin Bieber)",
                "artists": "The Kid LAROI;Justin Bieber",
            },
            {
                "track_id": "6I3mqTwhRpn34SLVafSH7G",
                "track_name": "Ghost",
                "artists": "Justin Bieber",
            },
        ]

        deduped = dedupe_similar_tracks(recommendations)

        self.assertEqual(
            [item["track_id"] for item in deduped],
            ["5HCyWlXZPP0y6Gqq8TgA20", "6I3mqTwhRpn34SLVafSH7G"],
        )

    def test_content_candidate_generation_returns_larger_unranked_pool(self) -> None:
        csv_text = (
            "track_id,track_name,artists,popularity,danceability,energy,valence\n"
            "t1,Listened,Artist A,90,0.9,0.9,0.8\n"
            "t2,Similar One,Artist B,80,0.88,0.87,0.78\n"
            "t3,Similar Two,Artist C,70,0.86,0.85,0.76\n"
        )

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "spotify_tracks.csv"
            path.write_text(csv_text, encoding="utf-8")
            catalog = load_catalog(path)

        candidates = score_content_candidates(
            [Interaction("u1", "t1", 4, 10000, 5.0)],
            catalog,
            user_id="u1",
            listened_track_ids={"t1"},
            candidate_pool_size=10,
        )

        self.assertEqual(len(candidates), 2)
        self.assertNotIn("rank", candidates[0])


class LightFMRerankTests(unittest.TestCase):
    def test_lightfm_reranks_content_candidates_when_available(self) -> None:
        catalog = {
            "t1": load_catalog_track("t1", "Liked One", "Artist A", 90, 0.9, 0.9, "pop"),
            "t2": load_catalog_track("t2", "Liked Two", "Artist B", 80, 0.8, 0.8, "pop"),
            "t3": load_catalog_track("t3", "Candidate", "Artist C", 70, 0.7, 0.7, "pop"),
        }
        interactions = [
            Interaction("u1", "t1", 3, 600000, 4.0),
            Interaction("u1", "t2", 2, 300000, 3.0),
            Interaction("u2", "t3", 4, 500000, 5.0),
        ]
        candidates = [
            {
                "track_id": "t3",
                "track_name": "Candidate",
                "artists": "Artist C",
                "genre": "pop",
                "score": 0.95,
                "source": "content_profile",
                "reason": "content reason",
            }
        ]

        try:
            reranked = rerank_candidates_with_lightfm(
                interactions,
                catalog,
                user_id="u1",
                candidates=candidates,
                epochs=1,
                no_components=5,
            )
        except RuntimeError as exc:
            self.skipTest(str(exc))

        self.assertEqual(reranked[0]["track_id"], "t3")
        self.assertEqual(reranked[0]["source"], "lightfm_rerank")
        self.assertEqual(reranked[0]["content_score"], 0.95)


class ExternalDiscoveryTests(unittest.TestCase):
    def test_parse_response_json_reads_structured_output_text(self) -> None:
        response = {
            "output": [
                {
                    "content": [
                        {
                            "type": "output_text",
                            "text": (
                                '{"external_suggestions": ['
                                '{"track_name": "Song", "artist_name": "Artist", "reason": "Fits"}'
                                '], "playlist_summary": "Summary"}'
                            ),
                        }
                    ]
                }
            ]
        }

        parsed = parse_response_json(response)

        self.assertEqual(parsed["external_suggestions"][0]["track_name"], "Song")
        self.assertEqual(parsed["playlist_summary"], "Summary")

    def test_rerank_final_recommendations_reassigns_ranks(self) -> None:
        recommendations = [
            {"track_id": "t1", "rank": 10},
            {"track_id": "t2"},
        ]

        reranked = rerank_final_recommendations(recommendations)

        self.assertEqual([item["rank"] for item in reranked], [1, 2])

    def test_external_discovery_skips_tracks_already_in_dataset_catalog(self) -> None:
        with (
            patch(
                "app.recommender.llm_discovery.openai_discovery_configured",
                return_value=True,
            ),
            patch(
                "app.recommender.llm_discovery.request_external_suggestions",
                return_value={
                    "external_suggestions": [
                        {
                            "track_name": "In Catalog",
                            "artist_name": "Artist A",
                            "reason": "Should be skipped",
                        },
                        {
                            "track_name": "Outside Catalog",
                            "artist_name": "Artist B",
                            "reason": "Should be kept",
                        },
                    ],
                },
            ),
            patch(
                "app.recommender.llm_discovery.get_spotify_access_token",
                return_value="token",
            ),
            patch(
                "app.recommender.llm_discovery.search_spotify_track",
                side_effect=[
                    {
                        "track_id": "t1",
                        "track_name": "In Catalog",
                        "artists": "Artist A",
                        "spotify_uri": "spotify:track:t1",
                        "external_url": "https://open.spotify.com/track/t1",
                        "popularity": 70,
                    },
                    {
                        "track_id": "t9",
                        "track_name": "Outside Catalog",
                        "artists": "Artist B",
                        "spotify_uri": "spotify:track:t9",
                        "external_url": "https://open.spotify.com/track/t9",
                        "popularity": 65,
                    },
                ],
            ),
        ):
            recommendations = generate_verified_external_recommendations(
                rows=[],
                interactions=[Interaction("u1", "seed", 1, 1000, 1.0)],
                user_id="u1",
                profile={"energy": 0.8},
                content_recommendations=[],
                listened_track_ids=set(),
                dataset_track_ids={"t1", "t2"},
                target_count=1,
            )

        self.assertEqual(len(recommendations), 1)
        self.assertEqual(recommendations[0]["track_id"], "t9")
        self.assertEqual(recommendations[0]["source"], "llm_external_spotify_verified")

    def test_external_discovery_checks_past_early_rejected_suggestions(self) -> None:
        with (
            patch(
                "app.recommender.llm_discovery.openai_discovery_configured",
                return_value=True,
            ),
            patch(
                "app.recommender.llm_discovery.request_external_suggestions",
                return_value={
                    "external_suggestions": [
                        {"track_name": f"In Catalog {index}", "artist_name": "Artist A", "reason": "skip"}
                        for index in range(1, 6)
                    ]
                    + [
                        {
                            "track_name": "Outside Catalog 1",
                            "artist_name": "Artist B",
                            "reason": "keep",
                        },
                        {
                            "track_name": "Outside Catalog 2",
                            "artist_name": "Artist C",
                            "reason": "keep",
                        },
                    ],
                },
            ),
            patch(
                "app.recommender.llm_discovery.get_spotify_access_token",
                return_value="token",
            ),
            patch(
                "app.recommender.llm_discovery.search_spotify_track",
                side_effect=[
                    {
                        "track_id": f"t{index}",
                        "track_name": f"In Catalog {index}",
                        "artists": "Artist A",
                        "spotify_uri": f"spotify:track:t{index}",
                        "external_url": f"https://open.spotify.com/track/t{index}",
                        "popularity": 60,
                    }
                    for index in range(1, 6)
                ]
                + [
                    {
                        "track_id": "t90",
                        "track_name": "Outside Catalog 1",
                        "artists": "Artist B",
                        "spotify_uri": "spotify:track:t90",
                        "external_url": "https://open.spotify.com/track/t90",
                        "popularity": 65,
                    },
                    {
                        "track_id": "t91",
                        "track_name": "Outside Catalog 2",
                        "artists": "Artist C",
                        "spotify_uri": "spotify:track:t91",
                        "external_url": "https://open.spotify.com/track/t91",
                        "popularity": 66,
                    },
                ],
            ),
        ):
            recommendations = generate_verified_external_recommendations(
                rows=[],
                interactions=[Interaction("u1", "seed", 1, 1000, 1.0)],
                user_id="u1",
                profile={"energy": 0.8},
                content_recommendations=[],
                listened_track_ids=set(),
                dataset_track_ids={"t1", "t2", "t3", "t4", "t5"},
                target_count=2,
            )

        self.assertEqual([item["track_id"] for item in recommendations], ["t90", "t91"])

    def test_external_discovery_retries_openai_when_first_batch_fails(self) -> None:
        with (
            patch(
                "app.recommender.llm_discovery.openai_discovery_configured",
                return_value=True,
            ),
            patch(
                "app.recommender.llm_discovery.request_external_suggestions",
                side_effect=[
                    {
                        "external_suggestions": [
                            {
                                "track_name": "In Catalog",
                                "artist_name": "Artist A",
                                "reason": "skip",
                            }
                        ]
                    },
                    {
                        "external_suggestions": [
                            {
                                "track_name": "Outside Catalog",
                                "artist_name": "Artist B",
                                "reason": "keep",
                            }
                        ]
                    },
                ],
            ) as mocked_request,
            patch(
                "app.recommender.llm_discovery.get_spotify_access_token",
                return_value="token",
            ),
            patch(
                "app.recommender.llm_discovery.search_spotify_track",
                side_effect=[
                    {
                        "track_id": "t1",
                        "track_name": "In Catalog",
                        "artists": "Artist A",
                        "spotify_uri": "spotify:track:t1",
                        "external_url": "https://open.spotify.com/track/t1",
                        "popularity": 60,
                    },
                    {
                        "track_id": "t99",
                        "track_name": "Outside Catalog",
                        "artists": "Artist B",
                        "spotify_uri": "spotify:track:t99",
                        "external_url": "https://open.spotify.com/track/t99",
                        "popularity": 70,
                    },
                ],
            ),
        ):
            recommendations = generate_verified_external_recommendations(
                rows=[],
                interactions=[Interaction("u1", "seed", 1, 1000, 1.0)],
                user_id="u1",
                profile={"energy": 0.8},
                content_recommendations=[],
                listened_track_ids=set(),
                dataset_track_ids={"t1"},
                target_count=1,
            )

        self.assertEqual(mocked_request.call_count, 2)
        self.assertEqual([item["track_id"] for item in recommendations], ["t99"])


def load_catalog_track(
    track_id: str,
    track_name: str,
    artists: str,
    popularity: float,
    danceability: float,
    energy: float,
    genre: str,
):
    from app.recommender.catalog import CatalogTrack

    return CatalogTrack(
        track_id=track_id,
        track_name=track_name,
        artists=artists,
        popularity=popularity,
        genre=genre,
        numeric_features={
            "danceability": danceability,
            "energy": energy,
            "popularity": popularity / 100,
        },
        feature_weights={
            "numeric:danceability": danceability,
            "numeric:energy": energy,
            f"artist:{artists.lower()}": 1.0,
            f"genre:{genre}": 1.0,
        },
    )


if __name__ == "__main__":
    unittest.main(verbosity=2)
