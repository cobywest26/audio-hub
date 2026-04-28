import base64
import json
import logging
import os
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from dotenv import load_dotenv

from app.recommender.fallback import canonical_song_key


SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
SPOTIFY_SEARCH_URL = "https://api.spotify.com/v1/search"
DEFAULT_SPOTIFY_TIMEOUT_SECONDS = 4


logger = logging.getLogger(__name__)
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"

load_dotenv(ENV_FILE)


def spotify_search_configured() -> bool:
    return bool(os.getenv("SPOTIFY_CLIENT_ID") and os.getenv("SPOTIFY_CLIENT_SECRET"))


def get_spotify_access_token() -> str | None:
    client_id = os.getenv("SPOTIFY_CLIENT_ID")
    client_secret = os.getenv("SPOTIFY_CLIENT_SECRET")

    if not client_id or not client_secret:
        return None

    credentials = base64.b64encode(f"{client_id}:{client_secret}".encode("utf-8")).decode("ascii")
    body = urlencode({"grant_type": "client_credentials"}).encode("utf-8")
    request = Request(
        SPOTIFY_TOKEN_URL,
        data=body,
        headers={
            "Authorization": f"Basic {credentials}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )

    timeout_seconds = float(
        os.getenv("SPOTIFY_SEARCH_TIMEOUT_SECONDS", DEFAULT_SPOTIFY_TIMEOUT_SECONDS)
    )

    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            data = json.loads(response.read().decode("utf-8"))
    except Exception:
        logger.exception("Failed to fetch Spotify access token.")
        return None

    return data.get("access_token")


def search_spotify_track(
    track_name: str,
    artist_name: str,
    access_token: str | None = None,
) -> dict | None:
    token = access_token or get_spotify_access_token()
    if not token:
        return None

    query = f'track:"{track_name}" artist:"{artist_name}"'
    params = urlencode({"q": query, "type": "track", "limit": 5})
    request = Request(
        f"{SPOTIFY_SEARCH_URL}?{params}",
        headers={"Authorization": f"Bearer {token}"},
        method="GET",
    )

    timeout_seconds = float(
        os.getenv("SPOTIFY_SEARCH_TIMEOUT_SECONDS", DEFAULT_SPOTIFY_TIMEOUT_SECONDS)
    )

    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            data = json.loads(response.read().decode("utf-8"))
    except Exception:
        logger.exception(
            "Spotify track search failed.",
            extra={"track_name": track_name, "artist_name": artist_name},
        )
        return None

    items = data.get("tracks", {}).get("items", [])
    if not items:
        return None

    expected_key = canonical_song_key(track_name, artist_name)
    best_item = items[0]

    for item in items:
        artists = ";".join(artist.get("name", "") for artist in item.get("artists", []))
        if canonical_song_key(item.get("name"), artists) == expected_key:
            best_item = item
            break

    artists = ";".join(artist.get("name", "") for artist in best_item.get("artists", []))
    return {
        "track_id": best_item.get("id"),
        "spotify_uri": best_item.get("uri"),
        "track_name": best_item.get("name"),
        "artists": artists,
        "external_url": best_item.get("external_urls", {}).get("spotify"),
        "popularity": best_item.get("popularity"),
    }
