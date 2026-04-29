import unittest
from pathlib import Path


class UT07SnapshotStateLoadTests(unittest.TestCase):
    def test_snapshots_load_into_local_state(self) -> None:
        dashboard_path = (
            Path(__file__).resolve().parents[1] / "app" / "dashboard" / "page.tsx"
        )
        source = dashboard_path.read_text(encoding="utf-8")

        self.assertIn("const [snapshots, setSnapshots] = useState<Snapshot[]>([]);", source)
        self.assertIn("setSnapshots(snapshotList);", source)
        self.assertIn("setSnapshotDrafts(draftMap);", source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
