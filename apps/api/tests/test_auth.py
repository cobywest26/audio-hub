import os
import unittest
from unittest import mock

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

from app.core import auth


class GetCurrentUserIdTests(unittest.TestCase):
    def test_rejects_missing_credentials(self) -> None:
        with self.assertRaises(HTTPException) as error:
            auth.get_current_user_id(None)

        self.assertEqual(error.exception.status_code, 401)
        self.assertIn("Missing or invalid Authorization header", error.exception.detail)

    def test_rejects_non_bearer_scheme(self) -> None:
        credentials = HTTPAuthorizationCredentials(scheme="Basic", credentials="token")

        with self.assertRaises(HTTPException) as error:
            auth.get_current_user_id(credentials)

        self.assertEqual(error.exception.status_code, 401)

    def test_rejects_when_supabase_get_user_fails(self) -> None:
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="bad-token")

        with mock.patch.object(auth.supabase.auth, "get_user", side_effect=Exception("bad token")):
            with self.assertRaises(HTTPException) as error:
                auth.get_current_user_id(credentials)

        self.assertEqual(error.exception.status_code, 401)
        self.assertIn("Invalid auth token", error.exception.detail)

    def test_rejects_when_user_id_is_missing(self) -> None:
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="token")
        user_response = mock.Mock(user=mock.Mock(id=None))

        with mock.patch.object(auth.supabase.auth, "get_user", return_value=user_response):
            with self.assertRaises(HTTPException) as error:
                auth.get_current_user_id(credentials)

        self.assertEqual(error.exception.status_code, 401)
        self.assertIn("Could not resolve user", error.exception.detail)

    def test_returns_user_id_when_token_is_valid(self) -> None:
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="token")
        user_response = mock.Mock(user=mock.Mock(id=12345))

        with mock.patch.object(auth.supabase.auth, "get_user", return_value=user_response):
            user_id = auth.get_current_user_id(credentials)

        self.assertEqual(user_id, "12345")


if __name__ == "__main__":
    unittest.main(verbosity=2)
