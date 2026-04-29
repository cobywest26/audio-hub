import unittest
from pathlib import Path


class UT03UploadDetailedErrorTests(unittest.TestCase):
    def test_upload_throws_backend_detail_message_on_failure(self) -> None:
        client_path = Path(__file__).resolve().parents[1] / "lib" / "api" / "client.ts"
        source = client_path.read_text(encoding="utf-8")

        self.assertIn('throw new Error(data.detail || "Upload failed.")', source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
