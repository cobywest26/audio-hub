import unittest
from pathlib import Path


class UT05LogoutRoutingTests(unittest.TestCase):
    def test_logout_routes_user_to_login_page(self) -> None:
        dashboard_path = (
            Path(__file__).resolve().parents[1] / "app" / "dashboard" / "page.tsx"
        )
        source = dashboard_path.read_text(encoding="utf-8")

        self.assertIn("await signOutUser();", source)
        self.assertIn('router.push("/login");', source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
