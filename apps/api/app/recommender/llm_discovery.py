# The OpenAI integration for the recommender system. TLDR, once the system has generated its initial
# 10 recommended songs based on the user's tastes/history and the dataset it then sends information
# to the OpenAI API to source new songs not found in the dataset to replace the bottom 4 songs that were
# initially recommended.

import json
import logging
import os
from collections import Counter, defaultdict
from pathlib import Path
from urllib.request import Request, urlopen

from dotenv import load_dotenv

from app.recommender.catalog import NUMERIC_FEATURE_COLUMNS
from app.recommender.data import Interaction
from app.recommender.fallback import canonical_song_key
from app.recommender.spotify_search import get_spotify_access_token, search_spotify_track


OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
DEFAULT_DISCOVERY_MODEL = "gpt-4o-mini"
DEFAULT_OPENAI_TIMEOUT_SECONDS = 10
DEFAULT_SPOTIFY_VERIFICATION_BUFFER = 1
DEFAULT_OPENAI_SUGGESTION_MULTIPLIER = 4
DEFAULT_MIN_OPENAI_SUGGESTIONS = 12
DEFAULT_SPOTIFY_VERIFICATION_MULTIPLIER = 4
DEFAULT_OPENAI_DISCOVERY_ATTEMPTS = 3


logger = logging.getLogger(__name__)
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"

load_dotenv(ENV_FILE)


EXTERNAL_DISCOVERY_SCHEMA = {
    "type": "object",
    "properties": {
        "external_suggestions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "track_name": {"type": "string"},
                    "artist_name": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["track_name", "artist_name", "reason"],
                "additionalProperties": False,
            },
        },
        "playlist_summary": {"type": "string"},
    },
    "required": ["external_suggestions", "playlist_summary"],
    "additionalProperties": False,
}


def openai_discovery_configured() -> bool:
    return bool(os.getenv("OPENAI_API_KEY"))


def build_taste_summary(
    rows: list[dict],
    interactions: list[Interaction],
    user_id: str,
    profile: dict[str, float],
) -> dict:
    track_counts: Counter[tuple[str, str]] = Counter()
    artist_counts: Counter[str] = Counter()
    track_ms: dict[tuple[str, str], int] = defaultdict(int)

    for row in rows:
        if str(row.get("user_id")) != user_id:
            continue

        track_name = (row.get("track_name") or "").strip()
        artist_name = (row.get("artist_name") or "").strip()
        key = (track_name, artist_name)

        if track_name:
            track_counts[key] += 1
            track_ms[key] += int(row.get("ms_played") or 0)

        if artist_name:
            artist_counts[artist_name] += 1

    top_tracks = [
        {
            "track_name": track_name,
            "artist_name": artist_name,
            "play_count": count,
            "total_ms_played": track_ms[(track_name, artist_name)],
        }
        for (track_name, artist_name), count in track_counts.most_common(12)
    ]
    top_artists = [
        {"artist_name": artist_name, "play_count": count}
        for artist_name, count in artist_counts.most_common(8)
    ]
    strongest_features = sorted(
        (
            (column, profile.get(column, 0))
            for column in NUMERIC_FEATURE_COLUMNS
            if column != "popularity"
        ),
        key=lambda item: item[1],
        reverse=True,
    )[:6]

    return {
        "top_tracks": top_tracks,
        "top_artists": top_artists,
        "taste_vector": {
            column: round(value, 3)
            for column, value in strongest_features
        },
        "matched_interaction_count": len(
            [
                interaction
                for interaction in interactions
                if interaction.user_id == user_id
            ]
        ),
    }


# Send the initial data to OpenAI and prompt it with specific instructions for
# the songs to recommended
def request_external_suggestions(
    taste_summary: dict,
    content_recommendations: list[dict],
    excluded_dataset_track_ids: set[str] | None = None,
    blocked_song_keys: set[str] | None = None,
    target_count: int = 5,
) -> dict:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return {"external_suggestions": [], "playlist_summary": ""}

    model = os.getenv("OPENAI_DISCOVERY_MODEL", DEFAULT_DISCOVERY_MODEL)
    prompt_payload = {
        "target_external_suggestions": target_count,
        "taste_summary": taste_summary,
        "current_dataset_recommendations": [
            {
                "track_name": recommendation.get("track_name"),
                "artists": recommendation.get("artists"),
                "genre": recommendation.get("genre"),
                "score": recommendation.get("score"),
            }
            for recommendation in content_recommendations[:20]
        ],
        "rules": [
            "Suggest songs outside the current dataset recommendation list.",
            "Prefer songs that are not already present in the existing dataset catalog.",
            "Do not repeat the user's top tracks or current recommendations.",
            "Avoid obvious chart staples if they are likely to already be in the dataset.",
            "Prefer tracks likely to exist on Spotify.",
            "Return artist and title only; do not invent Spotify IDs.",
        ],
    }
    if excluded_dataset_track_ids:
        prompt_payload["excluded_dataset_track_ids_sample"] = sorted(
            list(excluded_dataset_track_ids)
        )[:200]
    if blocked_song_keys:
        prompt_payload["avoid_song_keys"] = sorted(list(blocked_song_keys))[:40]

    request_body = {
        "model": model,
        "input": [
            {
                "role": "system",
                "content": (
                    "You are a music discovery curator for AudioHub. "
                    "Return JSON only through the provided schema."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(prompt_payload),
            },
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "external_music_discovery",
                "strict": True,
                "schema": EXTERNAL_DISCOVERY_SCHEMA,
            }
        },
    }
    request = Request(
        OPENAI_RESPONSES_URL,
        data=json.dumps(request_body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    timeout_seconds = float(
        os.getenv("OPENAI_DISCOVERY_TIMEOUT_SECONDS", DEFAULT_OPENAI_TIMEOUT_SECONDS)
    )

    logger.info(
        "Requesting external recommendations from OpenAI",
        extra={
            "model": model,
            "target_count": target_count,
            "timeout_seconds": timeout_seconds,
        },
    )

    with urlopen(request, timeout=timeout_seconds) as response:
        response_data = json.loads(response.read().decode("utf-8"))

    return parse_response_json(response_data)


def parse_response_json(response_data: dict) -> dict:
    if response_data.get("output_text"):
        return json.loads(response_data["output_text"])

    for output in response_data.get("output", []):
        for content in output.get("content", []):
            if content.get("type") in ("output_text", "text") and content.get("text"):
                return json.loads(content["text"])

    return {"external_suggestions": [], "playlist_summary": ""}


def generate_verified_external_recommendations(
    rows: list[dict],
    interactions: list[Interaction],
    user_id: str,
    profile: dict[str, float],
    content_recommendations: list[dict],
    listened_track_ids: set[str],
    dataset_track_ids: set[str],
    target_count: int = 3,
) -> list[dict]:
    if not openai_discovery_configured():
        logger.info("Skipping external discovery because OPENAI_API_KEY is not configured.")
        return []

    taste_summary = build_taste_summary(rows, interactions, user_id, profile)
    suggestion_target_count = max(
        target_count * DEFAULT_OPENAI_SUGGESTION_MULTIPLIER,
        DEFAULT_MIN_OPENAI_SUGGESTIONS,
    )

    spotify_token = get_spotify_access_token()
    if not spotify_token:
        logger.warning("Spotify verification skipped because no access token was available.")
        return []

    blocked_track_ids = set(listened_track_ids)
    blocked_keys = {
        canonical_song_key(recommendation.get("track_name"), recommendation.get("artists"))
        for recommendation in content_recommendations
    }
    verified: list[dict] = []
    verification_attempts = int(
        os.getenv(
            "SPOTIFY_VERIFICATION_ATTEMPTS",
            max(
                target_count * DEFAULT_SPOTIFY_VERIFICATION_MULTIPLIER,
                target_count + DEFAULT_SPOTIFY_VERIFICATION_BUFFER,
            ),
        )
    )
    discovery_attempts = int(
        os.getenv("OPENAI_DISCOVERY_ATTEMPTS", DEFAULT_OPENAI_DISCOVERY_ATTEMPTS)
    )

    for discovery_attempt in range(1, discovery_attempts + 1):
        try:
            suggestions = request_external_suggestions(
                taste_summary=taste_summary,
                content_recommendations=content_recommendations,
                excluded_dataset_track_ids=dataset_track_ids,
                blocked_song_keys=blocked_keys,
                target_count=suggestion_target_count,
            ).get("external_suggestions", [])
        except Exception:
            logger.exception("External discovery failed during the OpenAI recommendation step.")
            break

        if not suggestions:
            logger.info(
                "OpenAI returned no external song suggestions.",
                extra={"discovery_attempt": discovery_attempt},
            )
            continue

        max_verification_attempts = min(
            len(suggestions),
            max(target_count, verification_attempts),
        )

        logger.info(
            "Verifying external recommendations against Spotify",
            extra={
                "discovery_attempt": discovery_attempt,
                "requested_target_count": target_count,
                "openai_suggestion_count": len(suggestions),
                "max_verification_attempts": max_verification_attempts,
            },
        )

        for attempt_number, suggestion in enumerate(
            suggestions[:max_verification_attempts],
            start=1,
        ):
            track_name = (suggestion.get("track_name") or "").strip()
            artist_name = (suggestion.get("artist_name") or "").strip()

            if not track_name or not artist_name:
                logger.info(
                    "Skipping malformed external suggestion",
                    extra={
                        "discovery_attempt": discovery_attempt,
                        "attempt_number": attempt_number,
                    },
                )
                continue

            result = search_spotify_track(track_name, artist_name, access_token=spotify_token)
            if not result or not result.get("track_id"):
                logger.info(
                    "Spotify could not verify external suggestion",
                    extra={
                        "discovery_attempt": discovery_attempt,
                        "attempt_number": attempt_number,
                        "track_name": track_name,
                        "artist_name": artist_name,
                    },
                )
                continue

            if result["track_id"] in dataset_track_ids:
                logger.info(
                    "Skipping external suggestion because it already exists in the dataset catalog",
                    extra={
                        "discovery_attempt": discovery_attempt,
                        "attempt_number": attempt_number,
                        "track_id": result["track_id"],
                    },
                )
                continue

            key = canonical_song_key(result.get("track_name"), result.get("artists"))
            if result["track_id"] in blocked_track_ids or key in blocked_keys:
                logger.info(
                    "Skipping duplicate external suggestion after Spotify verification",
                    extra={
                        "discovery_attempt": discovery_attempt,
                        "attempt_number": attempt_number,
                        "track_id": result["track_id"],
                    },
                )
                continue

            blocked_track_ids.add(result["track_id"])
            blocked_keys.add(key)
            verified.append(
                {
                    "track_id": result["track_id"],
                    "track_name": result.get("track_name"),
                    "artists": result.get("artists"),
                    "genre": "external",
                    "popularity": result.get("popularity"),
                    "score": None,
                    "source": "llm_external_spotify_verified",
                    "reason": suggestion.get("reason") or "Suggested by external discovery and verified on Spotify.",
                    "spotify_uri": result.get("spotify_uri"),
                    "external_url": result.get("external_url"),
                }
            )

            if len(verified) >= target_count:
                break

        if len(verified) >= target_count:
            break

    logger.info(
        "Finished Spotify verification for external recommendations",
        extra={"verified_count": len(verified)},
    )
    return verified
