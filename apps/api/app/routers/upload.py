import json
import zipfile
from io import BytesIO

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from app.core.auth import get_current_user_id
from app.core.supabase_client import LISTENING_HISTORY_CONFLICT_COLUMNS, supabase
from app.utils.metrics import compute_and_save_snapshot_metrics
from app.utils.spotify_parser import parse_spotify_entry

router = APIRouter(prefix="/upload", tags=["upload"])

# Defined response class structures
class MetricsResponse(BaseModel):
    user_id: str
    total_streams: int
    total_ms_played: int
    unique_tracks: int
    unique_artists: int
    top_track: str | None
    top_artist: str | None

class UploadResponse(BaseModel):
    message: str
    upload_id: str
    records_imported: int
    duplicate_records_ignored: int
    metrics: MetricsResponse

# JSON loading function assisted by ChatGPT
def load_json_records(file_bytes: bytes, filename: str) -> list[dict]:
    if filename.endswith(".json"):
        try:
            data = json.loads(file_bytes.decode("utf-8"))
            if not isinstance(data, list):
                raise ValueError("JSON file must contain a list of Spotify records.")
            return data
        except Exception as e:
            raise ValueError(f"Invalid JSON file: {e}")

    if filename.endswith(".zip"):
        all_records = []
        try:
            with zipfile.ZipFile(BytesIO(file_bytes)) as zf:
                for name in zf.namelist():
                    if name.endswith(".json"):
                        with zf.open(name) as f:
                            data = json.loads(f.read().decode("utf-8"))
                            if isinstance(data, list):
                                all_records.extend(data)
            return all_records
        except Exception as e:
            raise ValueError(f"Invalid ZIP file: {e}")

    raise ValueError("Only .json and .zip files are supported.")


def _row_dedup_key(row: dict) -> tuple:
    return (
        row.get("user_id"),
        row.get("played_at"),
        row.get("spotify_track_uri"),
        row.get("track_name"),
        row.get("artist_name"),
        row.get("album_name"),
        row.get("ms_played"),
        row.get("platform"),
    )


def deduplicate_rows(rows: list[dict]) -> tuple[list[dict], int]:
    deduped_rows: list[dict] = []
    seen: set[tuple] = set()
    duplicate_count = 0

    for row in rows:
        key = _row_dedup_key(row)
        if key in seen:
            duplicate_count += 1
            continue

        seen.add(key)
        deduped_rows.append(row)

    return deduped_rows, duplicate_count


def insert_history_batch(rows: list[dict]) -> None:
    if LISTENING_HISTORY_CONFLICT_COLUMNS:
        (
            supabase.table("listening_history")
            .upsert(
                rows,
                on_conflict=LISTENING_HISTORY_CONFLICT_COLUMNS,
                ignore_duplicates=True,
            )
            .execute()
        )
        return

    supabase.table("listening_history").insert(rows).execute()

# API POST for Spotify data uploads
@router.post("/", response_model=UploadResponse)
async def upload_spotify_file(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
    filename = file.filename or "unknown"

    if not (filename.endswith(".json") or filename.endswith(".zip")):
        raise HTTPException(status_code=400, detail="Only .json and .zip files are allowed.")

    upload_insert = supabase.table("uploads").insert({
        "user_id": user_id,
        "filename": filename,
        "upload_type": "zip" if filename.endswith(".zip") else "json",
        "status": "pending",
    }).execute()

    if not upload_insert.data:
        raise HTTPException(status_code=500, detail="Failed to create upload record.")

    upload_id = upload_insert.data[0]["id"]

    snapshot_insert = supabase.table("snapshots").insert({
        "user_id": user_id,
        "upload_id": upload_id,
        "name": filename,
        "status": "processing",
        "is_active": True,
    }).execute()

    if not snapshot_insert.data:
        raise HTTPException(status_code=500, detail="Failed to create snapshot record.")

    snapshot_id = snapshot_insert.data[0]["id"]

    try:
        file_bytes = await file.read()
        raw_records = load_json_records(file_bytes, filename)

        parsed_rows = [
            parse_spotify_entry(entry, user_id=user_id, upload_id=upload_id, snapshot_id=snapshot_id)
            for entry in raw_records
            if isinstance(entry, dict)
        ]
        parsed_rows, duplicates_ignored = deduplicate_rows(parsed_rows)

        if parsed_rows:
            batch_size = 100

            for i in range(0, len(parsed_rows), batch_size):
                batch = parsed_rows[i:i + batch_size]
                insert_history_batch(batch)

        metrics = compute_and_save_snapshot_metrics(user_id, snapshot_id)

        supabase.table("uploads").update({
            "status": "processed",
            "records_imported": len(parsed_rows),
            "error_message": None,
        }).eq("id", upload_id).execute()

        supabase.table("snapshots").update({
            "status": "ready",
        }).eq("id", snapshot_id).execute()

        return {
            "message": "Upload processed successfully.",
            "upload_id": upload_id,
            "snapshot_id": snapshot_id,
            "records_imported": len(parsed_rows),
            "duplicate_records_ignored": duplicates_ignored,
            "metrics": metrics,
        }

    except Exception as e:
        supabase.table("uploads").update({
            "status": "failed",
            "error_message": str(e),
        }).eq("id", upload_id).execute()

        supabase.table("snapshots").update({
            "status": "failed",
        }).eq("id", snapshot_id).execute()

        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")
