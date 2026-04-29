import unittest
from pathlib import Path


class UT04ResetRoutingTests(unittest.TestCase):
    def test_reset_flow_routes_user_to_upload_page(self) -> None:
        dashboard_path = (
            Path(__file__).resolve().parents[1] / "app" / "dashboard" / "page.tsx"
        )
        source = dashboard_path.read_text(encoding="utf-8")

        self.assertIn("await resetForNewSnapshot(session.access_token);", source)
        self.assertIn('router.push("/upload");', source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
