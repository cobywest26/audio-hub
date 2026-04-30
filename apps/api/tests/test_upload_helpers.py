import json
import os
import unittest
import zipfile
from io import BytesIO

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.routers.upload import (
    deactivate_old_snapshots,
    deduplicate_rows,
    delete_old_history,
    load_json_records,
)


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
    def test_delete_old_history_deletes_each_old_snapshot_individually(self) -> None:
        class FakeResponse:
            def __init__(self, data=None) -> None:
                self.data = data

        class FakeQuery:
            def __init__(self, table_name: str, calls: list[tuple]) -> None:
                self.table_name = table_name
                self.calls = calls

            def select(self, columns: str):
                self.calls.append(("select", self.table_name, columns))
                return self

            def update(self, payload: dict):
                self.calls.append(("update", self.table_name, payload))
                return self

            def delete(self):
                self.calls.append(("delete", self.table_name))
                return self

            def eq(self, column: str, value: str):
                self.calls.append(("eq", self.table_name, column, value))
                return self

            def neq(self, column: str, value: str):
                self.calls.append(("neq", self.table_name, column, value))
                return self

            def execute(self):
                self.calls.append(("execute", self.table_name))
                if self.table_name == "snapshots":
                    return FakeResponse(
                        data=[{"id": "snapshot-old-1"}, {"id": "snapshot-old-2"}]
                    )
                return FakeResponse()

        class FakeSupabase:
            def __init__(self) -> None:
                self.calls: list[tuple] = []

            def table(self, table_name: str):
                self.calls.append(("table", table_name))
                return FakeQuery(table_name, self.calls)

        import app.routers.upload as upload_module

        original_supabase = upload_module.supabase
        fake_supabase = FakeSupabase()
        upload_module.supabase = fake_supabase
        try:
            deleted_count = delete_old_history("user-1", "snapshot-1")
        finally:
            upload_module.supabase = original_supabase

        self.assertEqual(deleted_count, 2)
        self.assertEqual(
            fake_supabase.calls,
            [
                ("table", "snapshots"),
                ("select", "snapshots", "id"),
                ("eq", "snapshots", "user_id", "user-1"),
                ("neq", "snapshots", "id", "snapshot-1"),
                ("execute", "snapshots"),
                ("table", "listening_history"),
                ("delete", "listening_history"),
                ("eq", "listening_history", "user_id", "user-1"),
                ("eq", "listening_history", "snapshot_id", "snapshot-old-1"),
                ("execute", "listening_history"),
                ("table", "listening_history"),
                ("delete", "listening_history"),
                ("eq", "listening_history", "user_id", "user-1"),
                ("eq", "listening_history", "snapshot_id", "snapshot-old-2"),
                ("execute", "listening_history"),
            ],
        )

    def test_deactivate_old_snapshots_updates_other_snapshots(self) -> None:
        class FakeResponse:
            def __init__(self, data=None) -> None:
                self.data = data

        class FakeQuery:
            def __init__(self, table_name: str, calls: list[tuple]) -> None:
                self.table_name = table_name
                self.calls = calls

            def update(self, payload: dict):
                self.calls.append(("update", self.table_name, payload))
                return self

            def eq(self, column: str, value: str):
                self.calls.append(("eq", self.table_name, column, value))
                return self

            def neq(self, column: str, value: str):
                self.calls.append(("neq", self.table_name, column, value))
                return self

            def execute(self):
                self.calls.append(("execute", self.table_name))
                return FakeResponse()

        class FakeSupabase:
            def __init__(self) -> None:
                self.calls: list[tuple] = []

            def table(self, table_name: str):
                self.calls.append(("table", table_name))
                return FakeQuery(table_name, self.calls)

        import app.routers.upload as upload_module

        original_supabase = upload_module.supabase
        fake_supabase = FakeSupabase()
        upload_module.supabase = fake_supabase
        try:
            deactivate_old_snapshots("user-1", "snapshot-1")
        finally:
            upload_module.supabase = original_supabase

        self.assertEqual(
            fake_supabase.calls,
            [
                ("table", "snapshots"),
                ("update", "snapshots", {"is_active": False}),
                ("eq", "snapshots", "user_id", "user-1"),
                ("neq", "snapshots", "id", "snapshot-1"),
                ("execute", "snapshots"),
            ],
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
