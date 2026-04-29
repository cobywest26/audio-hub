import unittest
from pathlib import Path


class UT01AuthRedirectTests(unittest.TestCase):
    def test_protected_page_redirects_to_login_when_no_session_token(self) -> None:
        dashboard_path = (
            Path(__file__).resolve().parents[1] / "app" / "dashboard" / "page.tsx"
        )
        source = dashboard_path.read_text(encoding="utf-8")

        self.assertIn('if (!session?.access_token) {', source)
        self.assertIn('router.push("/login");', source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
