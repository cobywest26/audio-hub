"use client";

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
        const data = await getMyMetrics(user.id);
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
}