import json
import os
import unittest
import zipfile
from io import BytesIO

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.routers.upload import deduplicate_rows, delete_old_history, load_json_records


class LoadJsonRecordsTests(unittest.TestCase):
    def test_loads_plain_json_file(self) -> None:
        file_bytes = json.dumps([{"ts": "2024-01-01T00:00:00Z"}]).encode("utf-8")
        records = load_json_records(file_bytes, "StreamingHistory0.json")
        self.assertEqual(records, [{"ts": "2024-01-01T00:00:00Z"}])

    def test_rejects_json_when_root_is_not_list(self) -> None:
        file_bytes = json.dumps({"ts": "2024-01-01T00:00:00Z"}).encode("utf-8")

        with self.assertRaises(ValueError) as error:
            load_json_records(file_bytes, "StreamingHistory0.json")

        self.assertIn("must contain a list", str(error.exception))

    def test_loads_all_json_records_from_zip(self) -> None:
        buffer = BytesIO()
        with zipfile.ZipFile(buffer, mode="w") as archive:
            archive.writestr("history_1.json", json.dumps([{"track": "A"}]))
            archive.writestr("history_2.json", json.dumps([{"track": "B"}]))
            archive.writestr("README.txt", "ignore me")

        records = load_json_records(buffer.getvalue(), "spotify_export.zip")
        self.assertEqual(records, [{"track": "A"}, {"track": "B"}])

    def test_rejects_unsupported_extensions(self) -> None:
        with self.assertRaises(ValueError) as error:
            load_json_records(b"anything", "history.csv")

        self.assertIn("Only .json and .zip files are supported", str(error.exception))


class DeduplicateRowsTests(unittest.TestCase):
    def test_removes_duplicate_rows_using_composite_key(self) -> None:
        row_a = {
            "user_id": "u1",
            "played_at": "2024-01-01T00:00:00+00:00",
            "spotify_track_uri": "spotify:track:1",
            "track_name": "Song A",
            "artist_name": "Artist A",
            "album_name": "Album A",
            "ms_played": 100000,
            "platform": "web",
        }
        row_b = dict(row_a)
        row_c = dict(row_a, spotify_track_uri="spotify:track:2", track_name="Song B")

        deduped, duplicate_count = deduplicate_rows([row_a, row_b, row_c])

        self.assertEqual(duplicate_count, 1)
        self.assertEqual(deduped, [row_a, row_c])


class DeleteOldHistoryTests(unittest.TestCase):
    def test_delete_old_history_executes_delete_query(self) -> None:
        class FakeResponse:
            __hash__ = None

        class FakeQuery:
            def __init__(self) -> None:
                self.calls: list[tuple] = []

            def delete(self):
                self.calls.append(("delete",))
                return self

            def eq(self, column: str, value: str):
                self.calls.append(("eq", column, value))
                return self

            def neq(self, column: str, value: str):
                self.calls.append(("neq", column, value))
                return self

            def execute(self):
                self.calls.append(("execute",))
                return FakeResponse()

        class FakeSupabase:
            def __init__(self) -> None:
                self.query = FakeQuery()

            def table(self, table_name: str):
                self.query.calls.append(("table", table_name))
                return self.query

        import app.routers.upload as upload_module

        original_supabase = upload_module.supabase
        fake_supabase = FakeSupabase()
        upload_module.supabase = fake_supabase
        try:
            delete_old_history("user-1", "snapshot-1")
        finally:
            upload_module.supabase = original_supabase

        self.assertEqual(
            fake_supabase.query.calls,
            [
                ("table", "listening_history"),
                ("delete",),
                ("eq", "user_id", "user-1"),
                ("neq", "snapshot_id", "snapshot-1"),
                ("execute",),
            ],
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
