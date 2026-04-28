"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getGlobalMetrics } from "@/lib/api/client";
import { getSupabaseBrowserClient, signOutUser } from "@/lib/supabase/client";
import { t, type AppLanguage, type TranslationKey } from "@/lib/i18n";

type RankedGlobalItem = {
  name: string;
  streams: number;
};

type GlobalMetrics = {
  total_streams: number;
  total_ms_played: number;
  unique_tracks: number;
  unique_artists: number;
  top_track: string | null;
  top_artist: string | null;
  total_active_users: number;
  top_tracks: RankedGlobalItem[];
  top_artists: RankedGlobalItem[];
};

function msToHours(ms: number) {
  return Math.max(0, Math.round(ms / 1000 / 60 / 60));
}

export default function GlobalBoardPage() {
  const router = useRouter();
  const [metrics, setMetrics] = useState<GlobalMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [username, setUsername] = useState("Spotify Username");
  const [language, setLanguage] = useState<AppLanguage>("ENG");

  const translate = (
    key: TranslationKey,
    vars?: Record<string, string | number>
  ) => t(language, key, vars);

  useEffect(() => {
    async function loadGlobalBoard() {
      const supabase = getSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        router.push("/login");
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      setUsername(
        user?.user_metadata?.preferred_username ||
          user?.user_metadata?.user_name ||
          user?.user_metadata?.name ||
          user?.email?.split("@")[0] ||
          "Spotify Username"
      );

      try {
        const data = await getGlobalMetrics(session.access_token);
        setMetrics(data);
      } catch (error) {
        console.error("Failed to load global board:", error);
      } finally {
        setLoading(false);
      }
    }

    loadGlobalBoard();
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

  const totalHours = useMemo(
    () => msToHours(metrics?.total_ms_played ?? 0),
    [metrics]
  );

  if (loading) {
    return <main className="audiohub-home-loading">Loading global board...</main>;
  }

  if (!metrics) {
    return (
      <main className="audiohub-home-loading">
        No global listening data is available yet.
      </main>
    );
  }

  return (
    <AppShell
      username={username}
      onSnapshots={() => router.push("/dashboard")}
      onReset={() => router.push("/upload")}
      onLogout={handleLogout}
      loggingOut={signingOut}
      onProfile={() => router.push("/dashboard")}
      onRecommender={() => router.push("/recommender")}
      onGlobe={() => router.push("/global-board")}
      language={language}
      onLanguageChange={setLanguage}
      translate={translate}
    >
      <section className="audiohub-section">
        <div className="audiohub-section-title audiohub-gradient-title">
          Global Board
        </div>
        <div className="audiohub-report-grid">
          <div className="audiohub-report-row">
            <div className="audiohub-report-key">Active Users:</div>
            <div className="audiohub-report-value">{metrics.total_active_users}</div>
          </div>
          <div className="audiohub-report-row">
            <div className="audiohub-report-key">Total Streams:</div>
            <div className="audiohub-report-value">
              {metrics.total_streams.toLocaleString()}
            </div>
          </div>
          <div className="audiohub-report-row">
            <div className="audiohub-report-key">Listening Time:</div>
            <div className="audiohub-report-value">
              {totalHours.toLocaleString()} hours
            </div>
          </div>
          <div className="audiohub-report-row">
            <div className="audiohub-report-key">Unique Tracks:</div>
            <div className="audiohub-report-value">
              {metrics.unique_tracks.toLocaleString()}
            </div>
          </div>
          <div className="audiohub-report-row">
            <div className="audiohub-report-key">Unique Artists:</div>
            <div className="audiohub-report-value">
              {metrics.unique_artists.toLocaleString()}
            </div>
          </div>
          <div className="audiohub-report-row">
            <div className="audiohub-report-key">Top Track:</div>
            <div className="audiohub-report-value">
              {metrics.top_track || "Unknown Track"}
            </div>
          </div>
          <div className="audiohub-report-row">
            <div className="audiohub-report-key">Top Artist:</div>
            <div className="audiohub-report-value">
              {metrics.top_artist || "Unknown Artist"}
            </div>
          </div>
        </div>
      </section>

      <section className="audiohub-section">
        <div className="audiohub-section-title audiohub-gradient-title">
          Community Leaders
        </div>
        <div className="audiohub-viz-row audiohub-viz-row--double">
          <section className="audiohub-card">
            <div className="audiohub-list-box">
              <div className="audiohub-card-title">Top Tracks</div>
              {metrics.top_tracks.length > 0 ? (
                metrics.top_tracks.map((track, index) => (
                  <div key={`${track.name}-${index}`} className="audiohub-list-row">
                    <div className="audiohub-list-num">{index + 1}.</div>
                    <div className="audiohub-list-text">
                      {track.name} — {track.streams} streams
                    </div>
                  </div>
                ))
              ) : (
                <div className="audiohub-list-row">
                  <div className="audiohub-list-text">No track data yet.</div>
                </div>
              )}
            </div>
          </section>

          <section className="audiohub-card">
            <div className="audiohub-list-box">
              <div className="audiohub-card-title">Top Artists</div>
              {metrics.top_artists.length > 0 ? (
                metrics.top_artists.map((artist, index) => (
                  <div key={`${artist.name}-${index}`} className="audiohub-list-row">
                    <div className="audiohub-list-num">{index + 1}.</div>
                    <div className="audiohub-list-text">
                      {artist.name} — {artist.streams} streams
                    </div>
                  </div>
                ))
              ) : (
                <div className="audiohub-list-row">
                  <div className="audiohub-list-text">No artist data yet.</div>
                </div>
              )}
            </div>
          </section>
        </div>
      </section>
    </AppShell>
  );
}