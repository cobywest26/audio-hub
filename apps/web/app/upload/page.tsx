"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { uploadSpotifyData } from "@/lib/api/client";

// Upload page for Spotify export data.
// User selects a JSON or ZIP file, then the app sends it to the API for processing.
export default function UploadPage() {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");

  // Starts upload immediately after a file is selected.
  // AI-assisted note: this is a streamlined UX pattern, but future retry/progress handling would improve reliability.
  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    if (!selected) return;

    setFileName(selected.name);
    setError("");

    try {
      setUploading(true);

      // Sends the user to a processing screen while ingestion runs.
      router.push("/processing");

      const supabase = getSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("No active session found.");
      }

      // Uploads the selected Spotify export using the authenticated user's access token.
      await uploadSpotifyData(selected, session.access_token);
      router.push("/dashboard");
    } catch (err) {
      console.error("UPLOAD FAILED:", err);
      setUploading(false);
      router.push("/upload");
      setError(err instanceof Error ? err.message : "Upload failed.");
    }
  }

  return (
    <main className="audiohub-page">
      <div className="audiohub-stage audiohub-stage--center">
        <div className="audiohub-center-card">
          <Image
            src="/audiohub-logo.png"
            alt="AudioHub"
            width={62}
            height={62}
            className="audiohub-logo-large"
          />
          <h1 className="audiohub-welcome">Welcome to AudioHub!</h1>
          <p className="audiohub-upload-label">Upload Streaming Data</p>

          <label className="audiohub-upload-button">
            ↑
            <input
              className="audiohub-hidden-input"
              type="file"
              accept=".json,.zip"
              onChange={handleFileChange}
              disabled={uploading}
            />
          </label>

          {fileName ? (
            <p className="audiohub-helper">Selected: {fileName}</p>
          ) : null}

          {error ? <p className="audiohub-helper">{error}</p> : null}
        </div>
      </div>
    </main>
  );
}