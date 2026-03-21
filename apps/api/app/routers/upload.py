import json
import zipfile
from io import BytesIO

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.core.supabase_client import supabase
from app.utils.metrics import compute_metrics
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
    metrics: MetricsResponse

# JSON loading function assited by ChatGPT
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

# API POST for Spotify data uploads
@router.post("/", response_model=UploadResponse)
async def upload_spotify_file(
    file: UploadFile = File(...),
    user_id: str = Form(...)
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

    try:
        file_bytes = await file.read()
        raw_records = load_json_records(file_bytes, filename)

        parsed_rows = [
            parse_spotify_entry(entry, user_id=user_id, upload_id=upload_id)
            for entry in raw_records
            if isinstance(entry, dict)
        ]
        
        # TEMPORARY: limit size for testing
        parsed_rows = parsed_rows[:200]

        print(f"Parsed {len(parsed_rows)} rows")

        parsed_rows = parsed_rows[:1000]

        if parsed_rows:
            batch_size = 100

            for i in range(0, len(parsed_rows), batch_size):
                batch = parsed_rows[i:i + batch_size]
                print(f"Inserting batch {i} to {i + len(batch) - 1}")
                supabase.table("listening_history").insert(batch).execute()

        metrics = compute_metrics(parsed_rows, user_id)

        supabase.table("user_metrics").upsert(metrics).execute()

        supabase.table("uploads").update({
            "status": "processed",
            "records_imported": len(parsed_rows),
            "error_message": None,
        }).eq("id", upload_id).execute()

        return {
            "message": "Upload processed successfully.",
            "upload_id": upload_id,
            "records_imported": len(parsed_rows),
            "metrics": metrics,
        }

    except Exception as e:
        supabase.table("uploads").update({
            "status": "failed",
            "error_message": str(e),
        }).eq("id", upload_id).execute()

        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")