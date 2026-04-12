import csv
from dataclasses import dataclass, field
from pathlib import Path

# dataset entry features
NUMERIC_FEATURE_COLUMNS = [
    "danceability",
    "energy",
    "valence",
    "acousticness",
    "instrumentalness",
    "speechiness",
    "liveness",
    "tempo",
    "loudness",
    "popularity",
]


@dataclass
class CatalogTrack:
    track_id: str
    track_name: str | None
    artists: str | None
    popularity: float
    genre: str | None
    numeric_features: dict[str, float] = field(default_factory=dict)
    feature_weights: dict[str, float] = field(default_factory=dict)


def _clean_key(key: str) -> str:
    return key.strip().lower().replace(" ", "_")


def _to_float(value: object, default: float = 0) -> float:
    if value is None or value == "":
        return default

    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _clamp(value: float, low: float = 0, high: float = 1) -> float:
    return max(low, min(high, value))


def normalize_numeric_feature(name: str, value: object) -> float:
    raw = _to_float(value)

    if name == "popularity":
        return _clamp(raw / 100)
    if name == "tempo":
        return _clamp(raw / 250)
    if name == "loudness":
        return _clamp((raw + 60) / 60)

    return _clamp(raw)


def split_artists(value: str | None) -> list[str]:
    if not value:
        return []

    separator = ";" if ";" in value else ","
    return [artist.strip() for artist in value.split(separator) if artist.strip()]


def build_feature_weights(row: dict) -> tuple[dict[str, float], dict[str, float]]:
    numeric_features = {
        column: normalize_numeric_feature(column, row.get(column))
        for column in NUMERIC_FEATURE_COLUMNS
        if column in row
    }

    feature_weights = {
        f"{name}:{value:.3f}": 1.0
        for name, value in numeric_features.items()
    }

    for name, value in numeric_features.items():
        feature_weights[f"numeric:{name}"] = value

    for artist in split_artists(row.get("artists"))[:3]:
        feature_weights[f"artist:{artist.lower()}"] = 1.0

    genre = row.get("track_genre") or row.get("genre")
    if genre:
        feature_weights[f"genre:{str(genre).strip().lower()}"] = 1.0

    key = row.get("key")
    if key not in (None, ""):
        feature_weights[f"key:{key}"] = 1.0

    mode = row.get("mode")
    if mode not in (None, ""):
        feature_weights[f"mode:{mode}"] = 1.0

    return numeric_features, feature_weights


def row_to_catalog_track(row: dict) -> CatalogTrack | None:
    track_id = (row.get("track_id") or "").strip()
    if not track_id:
        return None

    numeric_features, feature_weights = build_feature_weights(row)
    return CatalogTrack(
        track_id=track_id,
        track_name=(row.get("track_name") or "").strip() or None,
        artists=(row.get("artists") or "").strip() or None,
        popularity=_to_float(row.get("popularity")),
        genre=(row.get("track_genre") or row.get("genre") or "").strip() or None,
        numeric_features=numeric_features,
        feature_weights=feature_weights,
    )


def load_catalog(csv_path: str | Path) -> dict[str, CatalogTrack]:
    path = Path(csv_path)
    if not path.exists():
        raise FileNotFoundError(f"Spotify tracks dataset not found: {path}")

    catalog: dict[str, CatalogTrack] = {}

    with path.open("r", encoding="utf-8-sig", newline="") as csv_file:
        reader = csv.DictReader(csv_file)
        for raw_row in reader:
            row = {_clean_key(key): value for key, value in raw_row.items() if key}
            track = row_to_catalog_track(row)

            if not track:
                continue

            existing = catalog.get(track.track_id)
            if existing is None or track.popularity > existing.popularity:
                catalog[track.track_id] = track

    return catalog

