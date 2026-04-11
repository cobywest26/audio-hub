import unittest
from pathlib import Path


class UT06LatestMetricsTests(unittest.TestCase):
    def test_get_latest_metrics_calls_correct_endpoint_and_handles_errors(self) -> None:
        client_path = Path(__file__).resolve().parents[1] / "lib" / "api" / "client.ts"
        source = client_path.read_text(encoding="utf-8")

        self.assertIn('fetch(`${API_BASE_URL}/metrics/latest`', source)
        self.assertIn('throw new Error(data.detail || "Failed to fetch latest metrics.")', source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
