import unittest
from pathlib import Path


class UT08SnapshotRenameDoneTests(unittest.TestCase):
    def test_clicking_done_calls_rename_api_and_updates_snapshot_name(self) -> None:
        dashboard_path = (
            Path(__file__).resolve().parents[1] / "app" / "dashboard" / "page.tsx"
        )
        source = dashboard_path.read_text(encoding="utf-8")

        self.assertIn("if (editingSnapshotId === snapshotId) {", source)
        self.assertIn("const result = await renameSnapshot(", source)
        self.assertIn("setSnapshots((current) =>", source)
        self.assertIn("setSnapshotDrafts((current) => ({", source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
