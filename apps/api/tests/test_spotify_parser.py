import unittest

from app.utils.spotify_parser import parse_spotify_entry, parse_spotify_timestamp


class ParseSpotifyTimestampTests(unittest.TestCase):
    def test_returns_none_for_empty_or_invalid_timestamps(self) -> None:
        self.assertIsNone(parse_spotify_timestamp(None))
        self.assertIsNone(parse_spotify_timestamp(""))
        self.assertIsNone(parse_spotify_timestamp("not-a-timestamp"))

    def test_parses_valid_spotify_timestamp(self) -> None:
        parsed = parse_spotify_timestamp("2019-10-20T09:46:57Z")
        self.assertEqual(parsed, "2019-10-20T09:46:57+00:00")


class ParseSpotifyEntryTests(unittest.TestCase):
    def test_maps_spotify_fields_to_database_shape(self) -> None:
        entry = {
            "ts": "2024-06-10T11:12:13Z",
            "master_metadata_track_name": "Yellow",
            "master_metadata_album_artist_name": "Coldplay",
            "master_metadata_album_album_name": "Parachutes",
            "spotify_track_uri": "spotify:track:abc123",
            "ms_played": 219000,
            "conn_country": "US",
            "platform": "web_player",
        }

        parsed = parse_spotify_entry(
            entry,
            user_id="user-1",
            upload_id="upload-1",
            snapshot_id="snapshot-1",
        )

        self.assertEqual(parsed["user_id"], "user-1")
        self.assertEqual(parsed["upload_id"], "upload-1")
        self.assertEqual(parsed["snapshot_id"], "snapshot-1")
        self.assertEqual(parsed["played_at"], "2024-06-10T11:12:13+00:00")
        self.assertEqual(parsed["track_name"], "Yellow")
        self.assertEqual(parsed["artist_name"], "Coldplay")
        self.assertEqual(parsed["album_name"], "Parachutes")
        self.assertEqual(parsed["spotify_track_uri"], "spotify:track:abc123")
        self.assertEqual(parsed["ms_played"], 219000)
        self.assertEqual(parsed["conn_country"], "US")
        self.assertEqual(parsed["platform"], "web_player")

    def test_defaults_ms_played_to_zero_when_missing_or_null(self) -> None:
        parsed_missing = parse_spotify_entry({}, "u1", "up1", "s1")
        parsed_null = parse_spotify_entry({"ms_played": None}, "u1", "up1", "s1")

        self.assertEqual(parsed_missing["ms_played"], 0)
        self.assertEqual(parsed_null["ms_played"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
