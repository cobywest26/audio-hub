"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { uploadSpotifyData } from "@/lib/api/client";

export default function UploadPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadUser() {
      const supabase = getSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      setUserId(user.id);
    }

    loadUser();
  }, [router]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    if (!file) {
      setError("Please select a file.");
      return;
    }

    try {
      setUploading(true);

      const supabase = getSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("No active session found.");
      }

      const result = await uploadSpotifyData(file, session.access_token);
      console.log("Upload success:", result);

      router.push("/dashboard");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong.";

      console.error("UPLOAD FAILED:", err);
      setError(message);
      setUploading(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-100 px-6 py-10 text-zinc-900">
      <div className="mx-auto max-w-2xl rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold">Upload your Spotify data</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Upload your Spotify extended streaming history file to generate your
          profile.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          <input
            type="file"
            accept=".json,.zip"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="rounded-xl border border-zinc-300 px-4 py-3"
          />

          {file && (
            <p className="text-sm text-zinc-600">Selected: {file.name}</p>
          )}

          <button
            type="submit"
            disabled={uploading}
            className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-60"
          >
            {uploading ? "Processing..." : "Upload and Process"}
          </button>
        </form>

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}
      </div>
    </main>
  );
}