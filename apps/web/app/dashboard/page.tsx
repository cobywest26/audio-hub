"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient, signOutUser } from "@/lib/supabase/client";
import {
  getLatestMetrics,
  getSnapshots,
  resetForNewSnapshot,
} from "@/lib/api/client";

type Snapshot = {
  id: string;
  name: string | null;
  created_at: string;
  status: string;
  is_active: boolean;
};

type Metrics = {
  total_streams: number;
  total_ms_played: number;
  unique_tracks: number;
  unique_artists: number;
  top_track: string | null;
  top_artist: string | null;
};

type LatestResponse = {
  has_data: boolean;
  snapshot: Snapshot | null;
  metrics: Metrics | null;
};

function formatListeningTime(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

export default function DashboardPage() {
  const router = useRouter();
  const [latest, setLatest] = useState<LatestResponse | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    async function loadDashboard() {
      const supabase = getSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        router.push("/login");
        return;
      }

      try {
        const [latestData, snapshotList] = await Promise.all([
          getLatestMetrics(session.access_token),
          getSnapshots(session.access_token),
        ]);

        setLatest(latestData);
        setSnapshots(snapshotList);
      } catch (error) {
        console.error("Failed to load dashboard:", error);
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, [router]);

  async function handleLogout() {
  try {
    setSigningOut(true);
    await signOutUser();
    router.push("/login");
  } catch (error) {
    console.error("Failed to sign out:", error);
  } finally {
    setSigningOut(false);
  }
}

  async function handleStartNewSnapshot() {
    try {
      setResetting(true);

      const supabase = getSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        router.push("/login");
        return;
      }

      await resetForNewSnapshot(session.access_token);
      router.push("/upload");
    } catch (error) {
      console.error("Failed to prepare for new snapshot:", error);
    } finally {
      setResetting(false);
    }
  }

  if (loading) {
    return <main className="p-10">Loading dashboard...</main>;
  }

  if (!latest?.has_data || !latest.metrics) {
    return (
      <main className="min-h-screen bg-zinc-100 px-6 py-10 text-zinc-900">
        <div className="mx-auto max-w-3xl rounded-2xl bg-white p-8 shadow-sm">
          <h1 className="text-3xl font-bold">No listening data yet</h1>
          <p className="mt-2 text-zinc-600">
            Upload your Spotify data to build your first snapshot.
          </p>

          <button
            onClick={() => router.push("/upload")}
            className="mt-6 rounded-xl bg-zinc-900 px-5 py-3 text-white"
          >
            Upload Data
          </button>
        </div>
      </main>
    );
  }

  const metrics = latest.metrics;

  return (
    <main className="min-h-screen bg-zinc-100 px-6 py-10 text-zinc-900">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Your Dashboard</h1>
            <p className="mt-2 text-sm text-zinc-600">
              Showing your latest snapshot:{" "}
              {latest.snapshot?.name || "Unnamed snapshot"}
            </p>
          </div>

            <div className="flex gap-3">
                <button
                    onClick={handleStartNewSnapshot}
                    disabled={resetting}
                    className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60"
                >
                    {resetting ? "Preparing..." : "Start New Snapshot"}
                </button>

                <button
                    onClick={handleLogout}
                    disabled={signingOut}
                    className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
                >
                    {signingOut ? "Signing out..." : "Log Out"}
                </button>
            </div>
        </div>

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
          <MetricCard label="Top Track" value={metrics.top_track ?? "N/A"} />
          <MetricCard label="Top Artist" value={metrics.top_artist ?? "N/A"} />
        </div>

        <div className="mt-10 rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Snapshot History</h2>
          <div className="mt-4 space-y-3">
            {snapshots.length === 0 ? (
              <p className="text-sm text-zinc-600">No snapshots found.</p>
            ) : (
              snapshots.map((snapshot) => (
                <div
                  key={snapshot.id}
                  className="flex items-center justify-between rounded-xl border border-zinc-200 px-4 py-3"
                >
                  <div>
                    <p className="font-medium">
                      {snapshot.name || "Unnamed snapshot"}
                    </p>
                    <p className="text-sm text-zinc-500">
                      {new Date(snapshot.created_at).toLocaleString()}
                    </p>
                  </div>
                  <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs uppercase tracking-wide text-zinc-600">
                    {snapshot.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

/*"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { getMyMetrics } from "@/lib/api/client";

type Metrics = {
  total_streams: number;
  total_ms_played: number;
  unique_tracks: number;
  unique_artists: number;
  top_track: string | null;
  top_artist: string | null;
};

function formatListeningTime(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

export default function DashboardPage() {
  const router = useRouter();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = getSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      try {
        // Fetching session state
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.access_token) {
          throw new Error("No active session found.");
        }

        // Calls user metrics with the session token
        const data = await getMyMetrics(session.access_token);
        setMetrics(data);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [router]);

  if (loading) {
    return <main className="p-10">Loading dashboard...</main>;
  }

  return (
    <main className="min-h-screen bg-zinc-100 px-6 py-10 text-zinc-900">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Your Dashboard</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Week 1 skeleton. Real charts come in Week 2.
          </p>
        </div>

        {!metrics ? (
          <div className="rounded-2xl bg-white p-8 shadow-sm">
            No metrics found yet.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard label="Total Streams" value={metrics.total_streams.toLocaleString()} />
            <MetricCard label="Listening Time" value={formatListeningTime(metrics.total_ms_played)} />
            <MetricCard label="Unique Tracks" value={metrics.unique_tracks.toLocaleString()} />
            <MetricCard label="Unique Artists" value={metrics.unique_artists.toLocaleString()} />
            <MetricCard label="Top Track" value={metrics.top_track ?? "N/A"} />
            <MetricCard label="Top Artist" value={metrics.top_artist ?? "N/A"} />
          </div>
        )}
      </div>
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}*/