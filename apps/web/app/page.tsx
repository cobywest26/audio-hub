// Placeholder page

/*"use client";

import { ChangeEvent, FormEvent, useState } from "react";

type Metrics = {
  user_id: string;
  total_streams: number;
  total_ms_played: number;
  unique_tracks: number;
  unique_artists: number;
  top_track: string | null;
  top_artist: string | null;
};

type UploadResponse = {
  message: string;
  upload_id: string;
  records_imported: number;
  metrics: Metrics;
};

const API_BASE_URL = "http://127.0.0.1:8000";

function formatListeningTime(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  return `${hours}h ${minutes}m`;
}

export default function Home() {
  const [userId, setUserId] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setStatusMessage("");
    setMetrics(null);

    if (!userId.trim()) {
      setErrorMessage("Please enter a user ID.");
      return;
    }

    if (!selectedFile) {
      setErrorMessage("Please choose a Spotify JSON file.");
      return;
    }

    try {
      setUploading(true);
      setStatusMessage("Uploading file...");

      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("user_id", userId);

      const uploadResponse = await fetch(`${API_BASE_URL}/upload/`, {
        method: "POST",
        body: formData,
      });

      const uploadData: UploadResponse | { detail?: string } =
        await uploadResponse.json();

      if (!uploadResponse.ok) {
        throw new Error(
          "detail" in uploadData && uploadData.detail
            ? uploadData.detail
            : "Upload failed."
        );
      }

      setStatusMessage("Upload successful. Fetching metrics...");

      const metricsResponse = await fetch(`${API_BASE_URL}/metrics/${userId}`);
      const metricsData: Metrics | { detail?: string } =
        await metricsResponse.json();

      if (!metricsResponse.ok) {
        throw new Error(
          "detail" in metricsData && metricsData.detail
            ? metricsData.detail
            : "Failed to fetch metrics."
        );
      }

      setMetrics(metricsData);
      setStatusMessage(
        `Upload complete. Imported ${uploadData.records_imported} records.`
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Something went wrong.";
      setErrorMessage(message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-100 px-6 py-10 text-zinc-900">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <section className="rounded-2xl bg-white p-8 shadow-sm">
          <div className="mb-6">
            <h1 className="text-3xl font-bold tracking-tight">AudioHub</h1>
            <p className="mt-2 text-sm text-zinc-600">
              Upload a Spotify streaming history JSON file and view your first
              dashboard metrics.
            </p>
          </div>

          <form onSubmit={handleUpload} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label htmlFor="userId" className="text-sm font-medium">
                Supabase User ID
              </label>
              <input
                id="userId"
                type="text"
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                placeholder="Enter your Supabase auth user UUID"
                className="rounded-xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="file" className="text-sm font-medium">
                Spotify JSON File
              </label>
              <input
                id="file"
                type="file"
                accept=".json"
                onChange={handleFileChange}
                className="rounded-xl border border-zinc-300 bg-white px-4 py-3"
              />
              {selectedFile && (
                <p className="text-sm text-zinc-600">
                  Selected file: {selectedFile.name}
                </p>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={uploading}
                className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {uploading ? "Uploading..." : "Upload File"}
              </button>
            </div>
          </form>

          {statusMessage && (
            <div className="mt-5 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              {statusMessage}
            </div>
          )}

          {errorMessage && (
            <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {errorMessage}
            </div>
          )}
        </section>

        <section className="rounded-2xl bg-white p-8 shadow-sm">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold">Dashboard Preview</h2>
            <p className="mt-2 text-sm text-zinc-600">
              These are the first saved metrics returned from your backend.
            </p>
          </div>

          {!metrics ? (
            <div className="rounded-xl border border-dashed border-zinc-300 px-6 py-10 text-sm text-zinc-500">
              No metrics loaded yet. Upload a file to see your dashboard stats.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <MetricCard
                label="Total Streams"
                value={metrics.total_streams.toLocaleString()}
              />
              <MetricCard
                label="Listening Time"
                value={formatListeningTime(metrics.total_ms_played)}
              />
              <MetricCard
                label="Unique Tracks"
                value={metrics.unique_tracks.toLocaleString()}
              />
              <MetricCard
                label="Unique Artists"
                value={metrics.unique_artists.toLocaleString()}
              />
              <MetricCard
                label="Top Track"
                value={metrics.top_track ?? "N/A"}
              />
              <MetricCard
                label="Top Artist"
                value={metrics.top_artist ?? "N/A"}
              />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

type MetricCardProps = {
  label: string;
  value: string;
};

function MetricCard({ label, value }: MetricCardProps) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="mt-2 text-xl font-semibold text-zinc-900">{value}</p>
    </div>
  );
}
  */