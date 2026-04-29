import unittest
from pathlib import Path


class UT02UploadPostFormDataTests(unittest.TestCase):
    def test_upload_uses_post_upload_endpoint_and_formdata(self) -> None:
        client_path = Path(__file__).resolve().parents[1] / "lib" / "api" / "client.ts"
        source = client_path.read_text(encoding="utf-8")

        self.assertIn("const formData = new FormData();", source)
        self.assertIn('formData.append("file", file);', source)
        self.assertIn('fetch(`${API_BASE_URL}/upload/`', source)
        self.assertIn('method: "POST"', source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
