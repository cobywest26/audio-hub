"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getSupabaseBrowserClient, signOutUser } from "@/lib/supabase/client";
import {
  getLatestMetrics,
  getSnapshots,
  resetForNewSnapshot,
  renameSnapshot,
} from "@/lib/api/client";
import { AppShell } from "@/components/layout/app-shell";

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

type ModalType = "artists" | "reset" | "snapshots" | null;

const CHART_COLORS = ["#34a0ff", "#22c55e", "#8ec8ff", "#4ade80", "#60a5fa"];

function formatHours(ms: number) {
  return Math.max(1, Math.round(ms / 1000 / 60 / 60));
}

function buildTopArtistsData(metrics: Metrics) {
  const seed = Math.max(metrics.unique_artists, 5);
  return [
    { name: metrics.top_artist || "Top Artist", plays: Math.round(seed * 1.0) },
    { name: "Artist 2", plays: Math.round(seed * 0.82) },
    { name: "Artist 3", plays: Math.round(seed * 0.7) },
    { name: "Artist 4", plays: Math.round(seed * 0.56) },
    { name: "Artist 5", plays: Math.round(seed * 0.44) },
  ];
}

function buildTopTracksData(metrics: Metrics) {
  const seed = Math.max(Math.round(metrics.total_streams / 18), 5);
  return [
    { name: metrics.top_track || "Top Track", plays: Math.round(seed * 1.0) },
    { name: "Track 2", plays: Math.round(seed * 0.86) },
    { name: "Track 3", plays: Math.round(seed * 0.73) },
    { name: "Track 4", plays: Math.round(seed * 0.58) },
    { name: "Track 5", plays: Math.round(seed * 0.49) },
  ];
}

function buildReplayData(metrics: Metrics) {
  return [
    { name: "Top Replay", value: Math.max(1, Math.round(metrics.total_streams / 7)) },
    { name: "Unique Tracks", value: metrics.unique_tracks },
    { name: "Unique Artists", value: metrics.unique_artists },
  ];
}

function buildDayNightData(totalHours: number) {
  const day = Math.round(totalHours * 0.63);
  const night = Math.max(1, totalHours - day);
  return [
    { name: "Day", value: day },
    { name: "Night", value: night },
  ];
}

function buildWeekWeekendData(totalHours: number) {
  const week = Math.round(totalHours * 0.72);
  const weekend = Math.max(1, totalHours - week);
  return [
    { name: "Week", value: week },
    { name: "Weekend", value: weekend },
  ];
}

function hoursFromMs(ms: number) {
  return Math.max(1, Math.round(ms / 1000 / 60 / 60));
}

function listenerArchetype(hours: number) {
  if (hours < 500) return "Novice Listener";
  if (hours < 2500) return "Music Guru";
  if (hours < 5000) return "DJ";
  return "Expert";
}

function dayNight(hours: number) {
  const day = Math.round(hours * 0.63);
  const night = Math.max(1, hours - day);
  return { day, night };
}

function weekWeekend(hours: number) {
  const week = Math.round(hours * 0.72);
  const weekend = Math.max(1, hours - week);
  return { week, weekend };
}

function lineWidths() {
  return ["long", "mid", "short", "long", "mid", "long", "short"] as const;
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="audiohub-overlay">
      <div className="audiohub-modal">
        <div className="audiohub-modal-header">
          <span>{title}</span>
          <button type="button" className="audiohub-modal-close" onClick={onClose}>
            Exit
          </button>
        </div>
        <div className="audiohub-modal-body">{children}</div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [latest, setLatest] = useState<LatestResponse | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapshotDrafts, setSnapshotDrafts] = useState<Record<string, string>>({});
  const [editingSnapshotId, setEditingSnapshotId] = useState<string | null>(null);
  const snapshotInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [publicProfile, setPublicProfile] = useState(true);
  const [username, setUsername] = useState("Spotify Username");
  const [modal, setModal] = useState<ModalType>(null);
  const [artistChartType, setArtistChartType] = useState<"bar" | "pie">("bar");
  const [trackChartType, setTrackChartType] = useState<"bar" | "pie">("bar");
  const [dayNightChartType, setDayNightChartType] = useState<"bar" | "pie">("pie");
  const [weekChartType, setWeekChartType] = useState<"bar" | "pie">("pie");

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

      const stored = window.localStorage.getItem("audiohub-public-profile");
      if (stored) setPublicProfile(stored === "true");

      try {
        const [latestData, snapshotList] = await Promise.all([
          getLatestMetrics(session.access_token),
          getSnapshots(session.access_token),
        ]);

        setLatest(latestData);
        setSnapshots(snapshotList);

        const draftMap: Record<string, string> = {};
        for (const snapshot of snapshotList) {
          draftMap[snapshot.id] = snapshot.name || "Snapshot Name";
        }
        setSnapshotDrafts(draftMap);
      } catch (error) {
        console.error("Failed to load dashboard:", error);
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, [router]);

  useEffect(() => {
    window.localStorage.setItem("audiohub-public-profile", String(publicProfile));
  }, [publicProfile]);

  useEffect(() => {
      if (!editingSnapshotId) return;

      const input = snapshotInputRefs.current[editingSnapshotId];
      if (input) {
        input.focus();
        input.select();
      }
  }, [editingSnapshotId]);

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

  async function handleReset() {
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
      setModal(null);
    }
  }

  async function handleEditSnapshot(snapshotId: string) {
      if (editingSnapshotId === snapshotId) {
        try {
          const supabase = getSupabaseBrowserClient();
          const {
            data: { session },
          } = await supabase.auth.getSession();

          if (!session?.access_token) {
            router.push("/login");
            return;
          }

          const newName = (snapshotDrafts[snapshotId] || "").trim();

          if (!newName) {
            setEditingSnapshotId(null);
            return;
          }

          const result = await renameSnapshot(
            session.access_token,
            snapshotId,
            newName
          );

          setSnapshots((current) =>
            current.map((snapshot) =>
              snapshot.id === snapshotId
                ? { ...snapshot, name: result?.snapshot?.name ?? newName }
                : snapshot
            )
          );

          setSnapshotDrafts((current) => ({
            ...current,
            [snapshotId]: result?.snapshot?.name ?? newName,
          }));
        } catch (error) {
          console.error("Failed to rename snapshot:", error);
        } finally {
          setEditingSnapshotId(null);
        }

        return;
      }

      setEditingSnapshotId(snapshotId);
  }

  const metrics = latest?.metrics ?? null;
  const totalHours = metrics ? hoursFromMs(metrics.total_ms_played) : 0;
  const artistChartData = useMemo(
      () => (metrics ? buildTopArtistsData(metrics) : []),
      [metrics]
  );

  const trackChartData = useMemo(
      () => (metrics ? buildTopTracksData(metrics) : []),
      [metrics]
  );

  const replayChartData = useMemo(
      () => (metrics ? buildReplayData(metrics) : []),
      [metrics]
  );

  const dayNightChartData = useMemo(
      () => buildDayNightData(totalHours),
      [totalHours]
  );

  const weekWeekendChartData = useMemo(
      () => buildWeekWeekendData(totalHours),
      [totalHours]
  );
  const archetype = listenerArchetype(totalHours);
  const dn = dayNight(totalHours);
  const ww = weekWeekend(totalHours);
  const comparePercent = Math.min(98, Math.max(51, Math.round(totalHours / 18)));
  const artistDelta = metrics
    ? Math.min(89, Math.max(12, Math.round(metrics.unique_artists / 2)))
    : 12;

  if (loading) {
    return <main className="audiohub-home-loading">Loading dashboard...</main>;
  }

  if (!latest?.has_data || !metrics) {
    return (
      <main className="audiohub-home-loading">
        No listening data yet. Upload your Spotify data first.
      </main>
    );
  }

  return (
    <>
      <AppShell
        username={username}
        publicProfile={publicProfile}
        onTogglePublic={() => setPublicProfile((current) => !current)}
        onSnapshots={() => setModal("snapshots")}
        onReset={() => setModal("reset")}
        onLogout={handleLogout}
        loggingOut={signingOut}
        onProfile={() => router.push("/dashboard")}
        onGlobe={() => alert("Global Insights page not implemented yet.")}
      >
      <section className="audiohub-section">
          <div className="audiohub-section-title">Data Visualization</div>

          <div className="audiohub-viz-grid">
            <div className="audiohub-viz-left">
              <section className="audiohub-card">
                <div className="audiohub-viz-card-header">
                  <div className="audiohub-card-title">Top Artists</div>
                  <button
                    type="button"
                    className="audiohub-toggle-chip"
                    onClick={() =>
                      setArtistChartType((current) => (current === "bar" ? "pie" : "bar"))
                    }
                  >
                    {artistChartType === "bar" ? "Bar Chart" : "Pie Chart"}
                  </button>
                </div>

                <div
                  className="audiohub-chart-panel"
                  role="button"
                  onClick={() => setModal("artists")}
                >
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={artistChartData}>
                      <CartesianGrid stroke="#232428" vertical={false} />
                      <XAxis axisLine={false} tickLine={false} tick={false} />
                      <YAxis tick={{ fill: "#f5f5f5", fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{
                          background: "#0d0d0f",
                          border: "1px solid #3f4248",
                          color: "#f5f5f5",
                        }}
                      />
                      <Bar
                        dataKey="plays"
                        radius={[4, 4, 0, 0]}
                        isAnimationActive={true}
                        animationDuration={800}
                        cursor="pointer"
                      >
                        {artistChartData.map((entry, index) => (
                          <Cell
                            key={entry.name}
                            fill={CHART_COLORS[index % CHART_COLORS.length]}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="audiohub-card">
                <div className="audiohub-viz-card-header">
                  <div className="audiohub-card-title">Top Tracks</div>
                  <button
                    type="button"
                    className="audiohub-toggle-chip"
                    onClick={() =>
                      setArtistChartType((current) => (current === "bar" ? "pie" : "bar"))
                    }
                  >
                    {artistChartType === "bar" ? "Bar Chart" : "Pie Chart"}
                  </button>
                </div>

                <div className="audiohub-chart-panel">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={trackChartData} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid stroke="#232428" horizontal={true} vertical={false} />
                      <XAxis type="number" tick={{ fill: "#f5f5f5", fontSize: 11 }} />
                      <YAxis
                        dataKey="name"
                        type="category"
                        tick={{ fill: "#f5f5f5", fontSize: 11 }}
                        width={90}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "#0d0d0f",
                          border: "1px solid #3f4248",
                          color: "#f5f5f5",
                        }}
                      />
                      <Bar
                        dataKey="plays"
                        fill="#34a0ff"
                        radius={[0, 4, 4, 0]}
                        isAnimationActive={true}
                        animationDuration={800}
                        cursor="pointer"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="audiohub-card">
                <div className="audiohub-viz-card-header">
                  <div className="audiohub-card-title">Day vs. Night Listening</div>
                    <button
                      type="button"
                      className="audiohub-toggle-chip"
                      onClick={() =>
                        setArtistChartType((current) => (current === "bar" ? "pie" : "bar"))
                      }
                    >
                      {artistChartType === "bar" ? "Bar Chart" : "Pie Chart"}
                    </button>
                </div>

                <div className="audiohub-vs-row">
                  <div className="audiohub-vs-box">
                    <div className="audiohub-vs-label">Day</div>
                    <div className="audiohub-vs-value">{dn.day} hrs</div>
                  </div>
                  <div className="audiohub-vs-mid">vs</div>
                  <div className="audiohub-vs-box">
                    <div className="audiohub-vs-label">Night</div>
                    <div className="audiohub-vs-value">{dn.night} hrs</div>
                  </div>
                </div>
              </section>

              <section className="audiohub-card">
                <div className="audiohub-viz-card-header">
                  <div className="audiohub-card-title">Weekend vs. Weekday Listening</div>
                  <button type="button" className="audiohub-toggle-chip">
                    Pie Chart
                  </button>
                </div>

                <div className="audiohub-vs-row">
                  <div className="audiohub-vs-box">
                    <div className="audiohub-vs-label">Weekend</div>
                    <div className="audiohub-vs-value">{ww.weekend} hrs</div>
                  </div>
                  <div className="audiohub-vs-mid">vs</div>
                  <div className="audiohub-vs-box">
                    <div className="audiohub-vs-label">Weekday</div>
                    <div className="audiohub-vs-value">{ww.week} hrs</div>
                  </div>
                </div>
              </section>
            </div>

            <div className="audiohub-viz-right">
            <section className="audiohub-card">
              <div className="audiohub-metric-split">
                <div className="audiohub-list-box">
                  <div className="audiohub-card-title">Top Artists</div>
                  {artistChartData.map((artist, index) => (
                    <div key={artist.name} className="audiohub-list-row">
                      <div className="audiohub-list-num">{index + 1}.</div>
                      <div className="audiohub-list-text">{artist.name}</div>
                    </div>
                  ))}
                </div>

                <div className="audiohub-list-box">
                  <div className="audiohub-card-title">Time Listened</div>
                  {artistChartData.map((artist, index) => (
                    <div key={`${artist.name}-${index}`} className="audiohub-list-row">
                      <div className="audiohub-list-num">{index + 1}.</div>
                      <div className="audiohub-list-text">{artist.plays} hrs</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

              <section className="audiohub-card">
                <div className="audiohub-metric-split">
                  <div className="audiohub-list-box">
                    <div className="audiohub-card-title">Top Tracks</div>
                    {trackChartData.map((track, index) => (
                      <div key={track.name} className="audiohub-list-row">
                        <div className="audiohub-list-num">{index + 1}.</div>
                        <div className="audiohub-list-text">{track.name}</div>
                      </div>
                    ))}
                  </div>

                  <div className="audiohub-list-box">
                    <div className="audiohub-card-title">Time Listened</div>
                    {trackChartData.map((track, index) => (
                      <div key={`${track.name}-${index}`} className="audiohub-list-row">
                        <div className="audiohub-list-num">{index + 1}.</div>
                        <div className="audiohub-list-text">{track.plays} hrs</div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="audiohub-card">
                <div className="audiohub-card-title">Times Replayed</div>
                <div className="audiohub-card-frame">
                  <div className="audiohub-chart-panel">
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={replayChartData}>
                        <CartesianGrid stroke="#232428" vertical={false} />
                        <XAxis dataKey="name" tick={{ fill: "#f5f5f5", fontSize: 11 }} />
                        <YAxis tick={{ fill: "#f5f5f5", fontSize: 11 }} />
                        <Tooltip
                          contentStyle={{
                            background: "#0d0d0f",
                            border: "1px solid #3f4248",
                            color: "#f5f5f5",
                          }}
                        />
                        <Bar
                          dataKey="value"
                          fill="#22c55e"
                          radius={[4, 4, 0, 0]}
                          isAnimationActive={true}
                          animationDuration={800}
                          cursor="pointer"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </section>
            </div>
          </div>
      </section>

      <section className="audiohub-section">
          <div className="audiohub-section-title">Listening Report</div>
          <div className="audiohub-report-grid">
            <div className="audiohub-report-row">
              <div className="audiohub-report-key">Listening Archetype:</div>
              <div className="audiohub-report-value">{archetype}</div>
            </div>
            <div className="audiohub-report-row">
              <div className="audiohub-report-key">Top Artist:</div>
              <div className="audiohub-report-value">{metrics.top_artist || "Unknown Artist"}</div>
            </div>
            <div className="audiohub-report-row">
              <div className="audiohub-report-key">Top Song:</div>
              <div className="audiohub-report-value">{metrics.top_track || "Unknown Track"}</div>
            </div>
            <div className="audiohub-report-row">
              <div className="audiohub-report-key">Longest Playlist:</div>
              <div className="audiohub-report-value">Late Night Rotation</div>
            </div>
            <div className="audiohub-report-row">
              <div className="audiohub-report-key">Times Replayed:</div>
              <div className="audiohub-report-value">{Math.max(12, Math.round(metrics.total_streams / 7))}</div>
            </div>
            <div className="audiohub-report-row">
              <div className="audiohub-report-key">Listening Time:</div>
              <div className="audiohub-report-value">{totalHours.toLocaleString()} hours</div>
            </div>
            <div className="audiohub-report-row">
              <div className="audiohub-report-key">Day vs. Night:</div>
              <div className="audiohub-report-value">{dn.day} vs. {dn.night}</div>
            </div>
            <div className="audiohub-report-row">
              <div className="audiohub-report-key">Week vs. Weekend:</div>
              <div className="audiohub-report-value">{ww.week} vs. {ww.weekend}</div>
            </div>
            <div className="audiohub-report-row">
              <div className="audiohub-report-key">Best Friend:</div>
              <div className="audiohub-report-value">Message data pending</div>
            </div>
          </div>
      </section>

      <section className="audiohub-section">
          <div className="audiohub-section-title">Comparisons</div>
          <div className="audiohub-compare-grid">
            <div className="audiohub-compare-block">
              <div>How do you compare to others?</div>
            </div>
            <div className="audiohub-compare-block">
              <div>
                You listen to <span className="audiohub-inline-fill">music more</span> than
                <span className="audiohub-inline-fill">{comparePercent}</span>% of others, with
                <span className="audiohub-inline-fill">{totalHours.toLocaleString()}</span>
                hours listened to!
              </div>
            </div>
            <div className="audiohub-compare-block">
              <div>
                You listen to music more than
                <span className="audiohub-inline-fill">{artistDelta}</span>% of people with
                <span className="audiohub-inline-fill">{metrics.unique_artists}</span>
                hours listened to!
              </div>
            </div>
            <div className="audiohub-compare-block">
              <div>
                While others were listening to
                <span className="audiohub-inline-fill">other songs</span>, you were listening to
                <span className="audiohub-inline-fill">{metrics.top_track || "your top track"}</span>!
              </div>
            </div>
          </div>
      </section>

      <section className="audiohub-section">
          <div className="audiohub-section-title">Recommendations</div>
          <div className="audiohub-recommend-grid">
            <div className="audiohub-recommend-col">
              <div className="audiohub-small-title">Artists</div>

              <div className="audiohub-field-row">
                <div>Artist</div>
                <div className="audiohub-field-box" />
              </div>
              <div className="audiohub-field-row">
                <div>Artist</div>
                <div className="audiohub-field-box" />
              </div>
              <div className="audiohub-field-row">
                <div>Artist</div>
                <div className="audiohub-field-box" />
              </div>

              <div className="audiohub-playlist-row">
                <div>Curated Playlist:</div>
                <input className="audiohub-small-input" defaultValue="Name your playlist" />
                <button type="button" className="audiohub-small-pill">
                  Export to Spotify
                </button>
              </div>
            </div>

            <div className="audiohub-recommend-col">
              <div className="audiohub-small-title">Predictions</div>

              <div className="audiohub-field-row">
                <div>Artist</div>
                <div className="audiohub-field-box" />
              </div>
              <div className="audiohub-field-row">
                <div>Artist</div>
                <div className="audiohub-field-box" />
              </div>
              <div className="audiohub-field-row">
                <div>Artist</div>
                <div className="audiohub-field-box" />
              </div>
            </div>
          </div>
      </section>
      </AppShell>

      {modal === "artists" ? (
      <Modal title="Top Artists" onClose={() => setModal(null)}>
        <div className="audiohub-viz-grid">
          <div className="audiohub-viz-left">
            <section className="audiohub-card">
              <div className="audiohub-card-title">Top Artists</div>
              <div className="audiohub-chart-panel">
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={artistChartData}>
                    <CartesianGrid stroke="#232428" vertical={false} />
                    <XAxis axisLine={false} tickLine={false} tick={false} />
                    <YAxis tick={{ fill: "#f5f5f5", fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        background: "#0d0d0f",
                        border: "1px solid #3f4248",
                        color: "#f5f5f5",
                      }}
                    />
                    <Bar
                      dataKey="plays"
                      radius={[4, 4, 0, 0]}
                      isAnimationActive={true}
                      animationDuration={800}
                      cursor="pointer"
                    >
                      {artistChartData.map((entry, index) => (
                        <Cell
                          key={entry.name}
                          fill={CHART_COLORS[index % CHART_COLORS.length]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>

          <div className="audiohub-viz-right">
            <section className="audiohub-card">
              <div className="audiohub-metric-split">
                <div className="audiohub-list-box">
                  <div className="audiohub-card-title">Top Artists</div>
                  {artistChartData.map((artist, index) => (
                    <div key={artist.name} className="audiohub-list-row">
                      <div className="audiohub-list-num">{index + 1}.</div>
                      <div className="audiohub-list-text">{artist.name}</div>
                    </div>
                  ))}
                </div>

                <div className="audiohub-list-box">
                  <div className="audiohub-card-title">Time Listened</div>
                  {artistChartData.map((artist, index) => (
                    <div key={`${artist.name}-${index}`} className="audiohub-list-row">
                      <div className="audiohub-list-num">{index + 1}.</div>
                      <div className="audiohub-list-text">{artist.plays} hrs</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </div>
      </Modal>
    ) : null}

      {modal === "reset" ? (
        <Modal title="Reset Dashboard?" onClose={() => setModal(null)}>
          <div style={{ minHeight: 220, display: "grid", placeItems: "center" }}>
            <div style={{ width: "100%", textAlign: "center" }}>
              <div style={{ fontSize: 28, marginBottom: 28 }}>Reset Dashboard?</div>
              <div className="audiohub-modal-actions">
                <button type="button" className="audiohub-action-btn" onClick={handleReset} disabled={resetting}>
                  {resetting ? "Resetting..." : "Reset"}
                </button>
                <button type="button" className="audiohub-action-btn" onClick={() => setModal(null)}>
                  Exit
                </button>
              </div>
            </div>
          </div>
        </Modal>
      ) : null}

      {modal === "snapshots" ? (
        <Modal title="Previous Snapshots" onClose={() => setModal(null)}>
          <div>
            {snapshots.length === 0 ? (
              <div style={{ fontSize: 14 }}>No snapshots found.</div>
            ) : (
              snapshots.map((snapshot) => (
                <div key={snapshot.id} className="audiohub-snapshot-item">
                  <div className="audiohub-edit-dot">✎</div>
                  <input
                      ref={(element) => {
                        snapshotInputRefs.current[snapshot.id] = element;
                      }}
                      className={`audiohub-snapshot-input ${
                        editingSnapshotId === snapshot.id ? "is-editing" : "is-locked"
                      }`}
                      value={snapshotDrafts[snapshot.id] || ""}
                      readOnly={editingSnapshotId !== snapshot.id}
                      onChange={(event) =>
                        setSnapshotDrafts((current) => ({
                          ...current,
                          [snapshot.id]: event.target.value,
                        }))
                      }
                  />
                  <button
                      type="button"
                      className="audiohub-mini-btn"
                      onClick={() => handleEditSnapshot(snapshot.id)}
                  >
                      {editingSnapshotId === snapshot.id ? "Done" : "Edit"}
                  </button>
                </div>
              ))
            )}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
