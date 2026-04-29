import os
import unittest
from types import SimpleNamespace
from unittest import mock

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.utils import metrics


class PagingQuery:
    def __init__(self, pages_by_start: dict[int, list[dict]]) -> None:
        self.pages_by_start = pages_by_start
        self.current_start = 0
        self.range_calls: list[tuple[int, int]] = []

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def range(self, start: int, end: int):
        self.current_start = start
        self.range_calls.append((start, end))
        return self

    def execute(self):
        return SimpleNamespace(data=self.pages_by_start.get(self.current_start, []))


class UpsertQuery:
    def __init__(self) -> None:
        self.upsert_payloads: list[dict] = []
        self.conflict_columns: list[str] = []

    def upsert(self, payload: dict, on_conflict: str):
        self.upsert_payloads.append(payload)
        self.conflict_columns.append(on_conflict)
        return self

    def execute(self):
        return SimpleNamespace(data=[])


class InsertQuery:
    def __init__(self) -> None:
        self.insert_payloads: list[dict] = []

    def insert(self, payload: dict):
        self.insert_payloads.append(payload)
        return self

    def execute(self):
        return SimpleNamespace(data=[])


class LatestQuery:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows
        self.order_calls: list[tuple[str, bool]] = []
        self.limit_calls: list[int] = []

    def select(self, *_args, **_kwargs):
        return self

    def order(self, column: str, desc: bool = False):
        self.order_calls.append((column, desc))
        return self

    def limit(self, count: int):
        self.limit_calls.append(count)
        return self

    def execute(self):
        return SimpleNamespace(data=self.rows)


class FakeSupabase:
    def __init__(self, tables: dict[str, object]) -> None:
        self.tables = tables

    def table(self, name: str):
        return self.tables[name]

#Added tests for...   
class ParseEndTimeTests(unittest.TestCase):
    def test_parse_end_time_accepts_zulu_timestamp(self) -> None:
        parsed = metrics.parse_end_time("2024-06-10T11:12:13Z")

        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.hour, 11)

    def test_parse_end_time_accepts_iso_timezone_offset(self) -> None:
        parsed = metrics.parse_end_time("2024-06-10T11:12:13+00:00")

        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.hour, 11)

    def test_parse_end_time_accepts_iso_timezone_offset_with_fractional_seconds(self) -> None:
        parsed = metrics.parse_end_time("2024-06-10T11:12:13.123+00:00")

        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.hour, 11)

    def test_parse_end_time_returns_none_for_invalid_value(self) -> None:
        self.assertIsNone(metrics.parse_end_time("not-a-date"))


class ComputeMetricsTests(unittest.TestCase):
    def test_compute_metrics_returns_expected_rollups(self) -> None:
        rows = [
            {"ms_played": 1000, "track_name": "Song A", "artist_name": "Artist X"},
            {"ms_played": 3000, "track_name": "Song A", "artist_name": "Artist X"},
            {"ms_played": 2000, "track_name": "Song B", "artist_name": "Artist Y"},
            {"ms_played": None, "track_name": None, "artist_name": None},
        ]

        summary = metrics.compute_metrics(rows, user_id="u1", snapshot_id="s1")

        self.assertEqual(summary["snapshot_id"], "s1")
        self.assertEqual(summary["user_id"], "u1")
        self.assertEqual(summary["total_streams"], 4)
        self.assertEqual(summary["total_ms_played"], 6000)
        self.assertEqual(summary["unique_tracks"], 2)
        self.assertEqual(summary["unique_artists"], 2)
        self.assertEqual(summary["top_track"], "Song A")
        self.assertEqual(summary["top_artist"], "Artist X")

    def test_compute_metrics_splits_day_night_and_weekday_weekend(self) -> None:
        rows = [
            {
                "ms_played": 1000,
                "track_name": "Weekday Day",
                "artist_name": "Artist A",
                "played_at": "2024-06-10T11:00:00+00:00",
            },
            {
                "ms_played": 2000,
                "track_name": "Weekday Night",
                "artist_name": "Artist B",
                "played_at": "2024-06-10T21:00:00+00:00",
            },
            {
                "ms_played": 3000,
                "track_name": "Weekend Day",
                "artist_name": "Artist C",
                "played_at": "2024-06-15T12:00:00+00:00",
            },
            {
                "ms_played": 4000,
                "track_name": "Weekend Night",
                "artist_name": "Artist D",
                "played_at": "2024-06-16T02:00:00+00:00",
            },
        ]

        summary = metrics.compute_metrics(rows, user_id="u1", snapshot_id="s1")

        self.assertEqual(summary["day_ms"], 4000)
        self.assertEqual(summary["night_ms"], 6000)
        self.assertEqual(summary["weekday_ms"], 3000)
        self.assertEqual(summary["weekend_ms"], 7000)


class ComputeGlobalMetricsTests(unittest.TestCase):
    def test_compute_global_metrics_splits_day_night_and_weekday_weekend(self) -> None:
        rows = [
            {
                "ms_played": 1000,
                "track_name": "Weekday Day",
                "artist_name": "Artist A",
                "spotify_track_uri": "spotify:track:1",
                "played_at": "2024-06-10T11:00:00+00:00",
            },
            {
                "ms_played": 2000,
                "track_name": "Weekday Night",
                "artist_name": "Artist B",
                "spotify_track_uri": "spotify:track:2",
                "played_at": "2024-06-10T21:00:00+00:00",
            },
            {
                "ms_played": 3000,
                "track_name": "Weekend Day",
                "artist_name": "Artist C",
                "spotify_track_uri": "spotify:track:3",
                "played_at": "2024-06-15T12:00:00+00:00",
            },
            {
                "ms_played": 4000,
                "track_name": "Weekend Night",
                "artist_name": "Artist D",
                "spotify_track_uri": "spotify:track:4",
                "played_at": "2024-06-16T02:00:00+00:00",
            },
        ]

        with (
            mock.patch.object(
                metrics,
                "get_latest_snapshots_per_user",
                return_value=[{"id": "s1", "user_id": "u1"}],
            ),
            mock.patch.object(metrics, "fetch_global_history_rows", return_value=rows),
        ):
            summary = metrics.compute_global_metrics()

        self.assertEqual(summary["day_ms"], 4000)
        self.assertEqual(summary["night_ms"], 6000)
        self.assertEqual(summary["weekday_ms"], 3000)
        self.assertEqual(summary["weekend_ms"], 7000)

    def test_compute_global_metrics_returns_time_weighted_top_lists(self) -> None:
        rows = [
            {
                "ms_played": 1000,
                "track_name": "Short Song",
                "artist_name": "Artist A",
                "spotify_track_uri": "spotify:track:short",
                "played_at": "2024-06-10T11:00:00+00:00",
            },
            {
                "ms_played": 9000,
                "track_name": "Long Song",
                "artist_name": "Artist B",
                "spotify_track_uri": "spotify:track:long",
                "played_at": "2024-06-10T12:00:00+00:00",
            },
            {
                "ms_played": 8000,
                "track_name": "Long Song",
                "artist_name": "Artist B",
                "spotify_track_uri": "spotify:track:long",
                "played_at": "2024-06-10T13:00:00+00:00",
            },
        ]

        with (
            mock.patch.object(
                metrics,
                "get_latest_snapshots_per_user",
                return_value=[{"id": "s1", "user_id": "u1"}],
            ),
            mock.patch.object(metrics, "fetch_global_history_rows", return_value=rows),
        ):
            summary = metrics.compute_global_metrics()

        self.assertEqual(summary["top_tracks"][0]["name"], "Long Song - Artist B")
        self.assertEqual(summary["top_tracks"][0]["streams"], 2)
        self.assertEqual(summary["top_tracks"][0]["total_ms_played"], 17000)
        self.assertEqual(summary["top_artists"][0]["name"], "Artist B")
        self.assertEqual(summary["top_artists"][0]["streams"], 2)
        self.assertEqual(summary["top_artists"][0]["total_ms_played"], 17000)


class SavedGlobalMetricsTests(unittest.TestCase):
    def test_get_latest_global_metrics_reads_newest_saved_row(self) -> None:
        latest_query = LatestQuery([{"total_streams": 42, "top_tracks": []}])
        fake_supabase = FakeSupabase({"global_metrics": latest_query})

        with mock.patch.object(metrics, "supabase", fake_supabase):
            result = metrics.get_latest_global_metrics()

        self.assertEqual(result["total_streams"], 42)
        self.assertEqual(latest_query.order_calls, [("created_at", True)])
        self.assertEqual(latest_query.limit_calls, [1])

    def test_get_latest_global_metrics_returns_empty_metrics_when_table_is_empty(self) -> None:
        latest_query = LatestQuery([])
        fake_supabase = FakeSupabase({"global_metrics": latest_query})

        with mock.patch.object(metrics, "supabase", fake_supabase):
            result = metrics.get_latest_global_metrics()

        self.assertEqual(result, metrics.empty_global_metrics())

    def test_compute_and_save_global_metrics_inserts_computed_metrics(self) -> None:
        insert_query = InsertQuery()
        fake_supabase = FakeSupabase({"global_metrics": insert_query})
        computed = {
            "total_streams": 7,
            "total_ms_played": 123,
            "unique_tracks": 3,
            "unique_artists": 2,
            "top_track": "Song",
            "top_artist": "Artist",
            "total_active_users": 1,
            "top_tracks": [],
            "top_artists": [],
            "day_ms": 100,
            "night_ms": 23,
            "weekday_ms": 123,
            "weekend_ms": 0,
        }

        with (
            mock.patch.object(metrics, "supabase", fake_supabase),
            mock.patch.object(metrics, "compute_global_metrics", return_value=computed),
        ):
            result = metrics.compute_and_save_global_metrics()

        self.assertEqual(result, computed)
        self.assertEqual(insert_query.insert_payloads, [computed])


class FetchMetricRowsTests(unittest.TestCase):
    def test_fetch_snapshot_metric_rows_reads_all_pages(self) -> None:
        listening_history = PagingQuery(
            {
                0: [{"track_name": "A"}, {"track_name": "B"}],
                2: [{"track_name": "C"}],
            }
        )

        fake_supabase = FakeSupabase({"listening_history": listening_history})

        with mock.patch.object(metrics, "supabase", fake_supabase):
            rows = metrics.fetch_snapshot_metric_rows("u1", "s1", page_size=2)

        self.assertEqual(rows, [{"track_name": "A"}, {"track_name": "B"}, {"track_name": "C"}])
        self.assertEqual(listening_history.range_calls, [(0, 1), (2, 3)])

    def test_fetch_user_metric_rows_reads_all_pages(self) -> None:
        listening_history = PagingQuery(
            {
                0: [{"track_name": "A"}],
            }
        )

        fake_supabase = FakeSupabase({"listening_history": listening_history})

        with mock.patch.object(metrics, "supabase", fake_supabase):
            rows = metrics.fetch_user_metric_rows("u1", page_size=2)

        self.assertEqual(rows, [{"track_name": "A"}])
        self.assertEqual(listening_history.range_calls, [(0, 1)])


class SaveMetricsTests(unittest.TestCase):
    def test_compute_and_save_snapshot_metrics_upserts_snapshot_metric(self) -> None:
        upsert_query = UpsertQuery()
        fake_supabase = FakeSupabase({"snapshot_metric": upsert_query})
        rows = [{"ms_played": 1000, "track_name": "Song A", "artist_name": "Artist A"}]

        with (
            mock.patch.object(metrics, "supabase", fake_supabase),
            mock.patch.object(metrics, "fetch_snapshot_metric_rows", return_value=rows),
        ):
            result = metrics.compute_and_save_snapshot_metrics("u1", "s1")

        self.assertEqual(result["snapshot_id"], "s1")
        self.assertEqual(upsert_query.conflict_columns, ["snapshot_id"])
        self.assertEqual(upsert_query.upsert_payloads[0]["user_id"], "u1")

    def test_compute_and_save_user_metrics_upserts_user_metric_without_snapshot_id(self) -> None:
        upsert_query = UpsertQuery()
        fake_supabase = FakeSupabase({"user_metrics": upsert_query})
        rows = [{"ms_played": 1000, "track_name": "Song A", "artist_name": "Artist A"}]

        with (
            mock.patch.object(metrics, "supabase", fake_supabase),
            mock.patch.object(metrics, "fetch_user_metric_rows", return_value=rows),
        ):
            result = metrics.compute_and_save_user_metrics("u1")

        self.assertNotIn("snapshot_id", result)
        self.assertEqual(upsert_query.conflict_columns, ["user_id"])
        self.assertNotIn("snapshot_id", upsert_query.upsert_payloads[0])


if __name__ == "__main__":
    unittest.main(verbosity=2)
