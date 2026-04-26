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

type RankedMetric = {
  name: string;
  streams: number;
  total_ms_played: number;
};

type Metrics = {
  total_streams: number;
  total_ms_played: number;
  unique_tracks: number;
  unique_artists: number;
  top_track: string | null;
  top_artist: string | null;
  top_tracks?: RankedMetric[];
  top_artists?: RankedMetric[];
  day_ms?: number;
  night_ms?: number;
  weekday_ms?: number;
  weekend_ms?: number;
};

type LatestResponse = {
  has_data: boolean;
  snapshot: Snapshot | null;
  metrics: Metrics | null;
};

type ModalType = "artists" | "tracks" | "reset" | "snapshots" | null;

const CHART_COLORS = ["#C64B8C", "#FD3DB5", "#DE73FF", "#B65FCF"];

function formatHours(ms: number) {
  return Math.max(1, Math.round(ms / 1000 / 60 / 60));
}

function msToHours(ms: number) {
  return Math.max(0, Math.round(ms / 1000 / 60 / 60));
}

function buildArtistChartData(metrics: Metrics) {
  if (metrics.top_artists && metrics.top_artists.length > 0) {
    return metrics.top_artists.slice(0, 5).map((artist) => ({
      name: artist.name,
      streams: artist.streams,
      hours: msToHours(artist.total_ms_played),
    }));
  }

  // fallback (OLD backend)
  if (metrics.top_artist) {
    return [
      {
        name: metrics.top_artist,
        streams: metrics.total_streams,
        hours: msToHours(metrics.total_ms_played),
      },
    ];
  }

  return [];
}

function buildTrackChartData(metrics: Metrics) {
  if (metrics.top_tracks && metrics.top_tracks.length > 0) {
    return metrics.top_tracks.slice(0, 5).map((track) => ({
      name: track.name,
      streams: track.streams,
      hours: msToHours(track.total_ms_played),
    }));
  }

  if (metrics.top_track) {
    return [
      {
        name: metrics.top_track,
        streams: metrics.total_streams,
        hours: msToHours(metrics.total_ms_played),
      },
    ];
  }

  return [];
}

function buildArtistModalData(metrics: Metrics) {
  if (metrics.top_artists && metrics.top_artists.length > 0) {
    return metrics.top_artists.slice(0, 15).map((artist) => ({
      name: artist.name,
      streams: artist.streams,
      hours: msToHours(artist.total_ms_played),
    }));
  }

  if (metrics.top_artist) {
    return [
      {
        name: metrics.top_artist,
        streams: metrics.total_streams,
        hours: msToHours(metrics.total_ms_played),
      },
    ];
  }

  return [];
}

function buildTrackModalData(metrics: Metrics) {
  if (metrics.top_tracks && metrics.top_tracks.length > 0) {
    return metrics.top_tracks.slice(0, 15).map((track) => ({
      name: track.name,
      streams: track.streams,
      hours: msToHours(track.total_ms_played),
    }));
  }

  if (metrics.top_track) {
    return [
      {
        name: metrics.top_track,
        streams: metrics.total_streams,
        hours: msToHours(metrics.total_ms_played),
      },
    ];
  }

  return [];
}

function buildDayNightChartData(metrics: Metrics) {
  return [
    {
      name: "Day",
      value: msToHours(metrics.day_ms ?? 0),
    },
    {
      name: "Night",
      value: msToHours(metrics.night_ms ?? 0),
    },
  ];
}

function buildWeekWeekendChartData(metrics: Metrics) {
  return [
    {
      name: "Weekday",
      value: msToHours(metrics.weekday_ms ?? 0),
    },
    {
      name: "Weekend",
      value: msToHours(metrics.weekend_ms ?? 0),
    },
  ];
}

function buildReplayData(metrics: Metrics) {
  if (metrics.top_tracks && metrics.top_tracks.length > 0) {
    return metrics.top_tracks.slice(0, 5).map((track) => ({
      name: track.name,
      value: track.streams,
    }));
  }

  if (metrics.top_track) {
    return [
      {
        name: metrics.top_track,
        value: metrics.total_streams,
      },
    ];
  }

  return [];
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
  //const [publicProfile, setPublicProfile] = useState(true);
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

      //const stored = window.localStorage.getItem("audiohub-public-profile");
      //if (stored) setPublicProfile(stored === "true");

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

  /*
  useEffect(() => {
    window.localStorage.setItem("audiohub-public-profile", String(publicProfile));
  }, [publicProfile]);
  */

  useEffect(() => {
      if (!editingSnapshotId) return;

      const input = snapshotInputRefs.current[editingSnapshotId];
      if (input) {
        input.focus();
        input.select();
      }
  }, [editingSnapshotId]);

  useEffect(() => {
      const handleScroll = () => {
        const scrollTop = window.scrollY;
        const docHeight = document.body.scrollHeight - window.innerHeight;
        const progress = docHeight > 0 ? Math.min(scrollTop / docHeight, 1) : 0;

        // Dark-hot purple -> brighter purple
        const startColors = [
          [111, 45, 168],  // #6f2da8
          [198, 75, 140],  // #c64b8c
        ];

        // Deep orange -> bright orange
        const endColors = [
          [255, 110, 0],   // #ff6e00
          [255, 166, 0],   // brighter orange
        ];

        const lerp = (a: number, b: number, t: number) =>
          Math.round(a + (b - a) * t);

        const start = startColors[0].map((v, i) =>
          lerp(v, startColors[1][i], progress)
        );
        const end = endColors[0].map((v, i) =>
          lerp(v, endColors[1][i], progress)
        );

        document.documentElement.style.setProperty(
          "--title-start",
          `rgb(${start[0]}, ${start[1]}, ${start[2]})`
        );
        document.documentElement.style.setProperty(
          "--title-end",
          `rgb(${end[0]}, ${end[1]}, ${end[2]})`
        );
      };

      handleScroll();
      window.addEventListener("scroll", handleScroll);
      return () => window.removeEventListener("scroll", handleScroll);
    }, []);

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
  console.log("METRICS:", metrics);
  const totalHours = metrics ? hoursFromMs(metrics.total_ms_played) : 0;
  const artistChartData = useMemo(
    () => (metrics ? buildArtistChartData(metrics) : []),
    [metrics]
  );

  const artistModalData = useMemo(
    () => (metrics ? buildArtistModalData(metrics) : []),
    [metrics]
  );

  const trackChartData = useMemo(
    () => (metrics ? buildTrackChartData(metrics) : []),
    [metrics]
  );

  const trackModalData = useMemo(
    () => (metrics ? buildTrackModalData(metrics) : []),
    [metrics]
  );

  const dayNightChartData = useMemo(
    () => (metrics ? buildDayNightChartData(metrics) : []),
    [metrics]
  );

  const weekWeekendChartData = useMemo(
    () => (metrics ? buildWeekWeekendChartData(metrics) : []),
    [metrics]
  );
  const replayChartData = useMemo(
      () => (metrics ? buildReplayData(metrics) : []),
      [metrics]
  );

  const archetype = listenerArchetype(totalHours);
  const dn = {
    day: msToHours(metrics?.day_ms ?? 0) || dayNight(totalHours).day,
    night: msToHours(metrics?.night_ms ?? 0) || dayNight(totalHours).night,
  };

  const ww = {
    week: msToHours(metrics?.weekday_ms ?? 0) || weekWeekend(totalHours).week,
    weekend: msToHours(metrics?.weekend_ms ?? 0) || weekWeekend(totalHours).weekend,
  };
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
        //publicProfile={publicProfile}
        //onTogglePublic={() => setPublicProfile((current) => !current)}
        onSnapshots={() => setModal("snapshots")}
        onReset={() => setModal("reset")}
        onLogout={handleLogout}
        loggingOut={signingOut}
        onProfile={() => router.push("/dashboard")}
        onRecommender={() => router.push("/recommender")}
        onGlobe={() => router.push("/global-board")}
      >
      <section className="audiohub-section">
          <div className="audiohub-section-title audiohub-gradient-title">
              Your Highlights
          </div>
          <div className="audiohub-viz-rows">
            <div className="audiohub-viz-row audiohub-viz-row--triple">
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
                    {artistChartType === "bar" ? (
                      <BarChart data={artistChartData}>
                        <CartesianGrid stroke="#232428" vertical={false} />
                        <XAxis axisLine={false} tickLine={false} tick={false} />
                        <YAxis tick={{ fill: "#f5f5f5", fontSize: 11 }} />
                            <Tooltip
                              formatter={(value, _name, props) => [`${value} hrs`, props.payload?.name ?? "Artist"]}
                              labelFormatter={() => ""}
                              contentStyle={{
                                background: "#0d0d0f",
                                border: "1px solid #3f4248",
                                color: "#f5f5f5",
                              }}
                              itemStyle={{ color: "#f5f5f5" }}
                            />
                        <Bar
                          dataKey="hours"
                          radius={[4, 4, 0, 0]}
                          isAnimationActive
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
                    ) : (
                      <PieChart>
                        <Pie
                          data={artistChartData}
                          dataKey="hours"
                          nameKey="name"
                          innerRadius={55}
                          outerRadius={90}
                          paddingAngle={3}
                        >
                          {artistChartData.map((entry, index) => (
                            <Cell
                              key={entry.name}
                              fill={CHART_COLORS[index % CHART_COLORS.length]}
                            />
                          ))}
                        </Pie>
                            <Tooltip
                              formatter={(value, _name, props) => [`${value} hrs`, props.payload?.name ?? "Artist"]}
                              labelFormatter={() => ""}
                              contentStyle={{
                                background: "#0d0d0f",
                                border: "1px solid #3f4248",
                                color: "#f5f5f5",
                              }}
                              itemStyle={{ color: "#f5f5f5" }}
                            />
                      </PieChart>
                    )}
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="audiohub-card">
                <div className="audiohub-list-box">
                  <div className="audiohub-card-title">Top Artists</div>
                  {artistChartData.map((artist, index) => (
                    <div key={artist.name} className="audiohub-list-row">
                      <div className="audiohub-list-num">{index + 1}.</div>
                      <div className="audiohub-list-text">{artist.name}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="audiohub-card">
                <div className="audiohub-list-box">
                  <div className="audiohub-card-title">Time Listened</div>
                  {artistChartData.map((artist, index) => (
                    <div key={`${artist.name}-${index}`} className="audiohub-list-row">
                      <div className="audiohub-list-num">{index + 1}.</div>
                      <div className="audiohub-list-text">{artist.hours} hrs</div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="audiohub-viz-row audiohub-viz-row--triple">
              <section className="audiohub-card">
                <div className="audiohub-viz-card-header">
                  <div className="audiohub-card-title">Top Tracks</div>
                  <button
                    type="button"
                    className="audiohub-toggle-chip"
                    onClick={() =>
                      setTrackChartType((current) => (current === "bar" ? "pie" : "bar"))
                    }
                  >
                    {trackChartType === "bar" ? "Bar Chart" : "Pie Chart"}
                  </button>
                </div>

                <div
                  className="audiohub-chart-panel"
                  role="button"
                  onClick={() => setModal("tracks")}
                >
                  <ResponsiveContainer width="100%" height={260}>
                    {trackChartType === "bar" ? (
                      <BarChart data={trackChartData} layout="vertical" margin={{ left: 20 }}>
                        <CartesianGrid stroke="#232428" horizontal vertical={false} />
                        <XAxis type="number" tick={{ fill: "#f5f5f5", fontSize: 11 }} />
                        <YAxis
                          type="category"
                          dataKey="name"
                          tick={false}
                          axisLine={false}
                          tickLine={false}
                          width={20}
                        />
                        <Tooltip
                          formatter={(value, _name, props) => [
                            `${value} replays`,
                            props.payload?.name ?? "Track",
                          ]}
                          labelFormatter={() => ""}
                          contentStyle={{
                            background: "#0d0d0f",
                            border: "1px solid #3f4248",
                            color: "#f5f5f5",
                          }}
                          itemStyle={{ color: "#f5f5f5" }}
                        />
                        <Bar
                          dataKey="streams"
                          radius={[0, 4, 4, 0]}
                          isAnimationActive
                          animationDuration={800}
                          cursor="pointer"
                        >
                          {trackChartData.map((entry, index) => (
                            <Cell
                              key={entry.name}
                              fill={CHART_COLORS[index % CHART_COLORS.length]}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    ) : (
                      <PieChart>
                        <Pie
                          data={trackChartData}
                          dataKey="streams"
                          nameKey="name"
                          innerRadius={55}
                          outerRadius={90}
                          paddingAngle={3}
                        >
                          {trackChartData.map((entry, index) => (
                            <Cell
                              key={entry.name}
                              fill={CHART_COLORS[index % CHART_COLORS.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            background: "#0d0d0f",
                            border: "1px solid #3f4248",
                            color: "#f5f5f5",
                          }}
                          itemStyle={{ color: "#f5f5f5" }}
                        />
                      </PieChart>
                    )}
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="audiohub-card">
                <div className="audiohub-list-box">
                  <div className="audiohub-card-title">Top Tracks</div>
                  {trackChartData.map((track, index) => (
                    <div key={track.name} className="audiohub-list-row">
                      <div className="audiohub-list-num">{index + 1}.</div>
                      <div className="audiohub-list-text">{track.name}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="audiohub-card">
                <div className="audiohub-list-box">
                  <div className="audiohub-card-title">Times Replayed</div>
                  {replayChartData.map((item, index) => (
                    <div key={item.name} className="audiohub-list-row">
                      <div className="audiohub-list-num">{index + 1}.</div>
                      <div className="audiohub-list-text">
                        {item.name}: {item.value}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="audiohub-viz-row audiohub-viz-row--double">
              <section className="audiohub-card">
                <div className="audiohub-viz-card-header">
                  <div className="audiohub-card-title">Day vs. Night Listening</div>
                  <button
                    type="button"
                    className="audiohub-toggle-chip"
                    onClick={() =>
                      setDayNightChartType((current) => (current === "bar" ? "pie" : "bar"))
                    }
                  >
                    {dayNightChartType === "bar" ? "Bar Chart" : "Pie Chart"}
                  </button>
                </div>

                <div className="audiohub-chart-panel">
                  <ResponsiveContainer width="100%" height={240}>
                    {dayNightChartType === "bar" ? (
                      <BarChart data={dayNightChartData}>
                        <CartesianGrid stroke="#232428" vertical={false} />
                        <XAxis dataKey="name" tick={{ fill: "#f5f5f5", fontSize: 11 }} />
                        <YAxis tick={{ fill: "#f5f5f5", fontSize: 11 }} />
                        <Tooltip
                          contentStyle={{
                            background: "#0d0d0f",
                            border: "1px solid #3f4248",
                            color: "#f5f5f5",
                          }}
                          itemStyle={{ color: "#f5f5f5" }}
                        />
                        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                          <Cell fill={CHART_COLORS[0]} />
                          <Cell fill={CHART_COLORS[1]} />
                        </Bar>
                      </BarChart>
                    ) : (
                      <PieChart>
                        <Pie
                          data={dayNightChartData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={55}
                          outerRadius={90}
                          paddingAngle={3}
                        >
                          <Cell fill={CHART_COLORS[0]} />
                          <Cell fill={CHART_COLORS[1]} />
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            background: "#0d0d0f",
                            border: "1px solid #3f4248",
                            color: "#f5f5f5",
                          }}
                          itemStyle={{ color: "#f5f5f5" }}
                        />
                      </PieChart>
                    )}
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="audiohub-card">
                <div className="audiohub-vs-panel">
                <div className="audiohub-vs-row-title"> Day v Night Listening</div>
                  <div className="audiohub-vs-row">
                    <div className="audiohub-vs-box">
                      <div className="audiohub-vs-value">{dn.day} hrs</div>
                    </div>
                    <div className="audiohub-vs-mid">vs</div>
                    <div className="audiohub-vs-box">
                      <div className="audiohub-vs-value">{dn.night} hrs</div>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <div className="audiohub-viz-row audiohub-viz-row--double">
              <section className="audiohub-card">
                <div className="audiohub-viz-card-header">
                  <div className="audiohub-card-title">Weekend vs. Weekday Listening</div>
                  <button
                    type="button"
                    className="audiohub-toggle-chip"
                    onClick={() =>
                      setWeekChartType((current) => (current === "bar" ? "pie" : "bar"))
                    }
                  >
                    {weekChartType === "bar" ? "Bar Chart" : "Pie Chart"}
                  </button>
                </div>

                <div className="audiohub-chart-panel">
                  <ResponsiveContainer width="100%" height={240}>
                    {weekChartType === "bar" ? (
                      <BarChart data={weekWeekendChartData}>
                        <CartesianGrid stroke="#232428" vertical={false} />
                        <XAxis dataKey="name" tick={{ fill: "#f5f5f5", fontSize: 11 }} />
                        <YAxis tick={{ fill: "#f5f5f5", fontSize: 11 }} />
                        <Tooltip
                          contentStyle={{
                            background: "#0d0d0f",
                            border: "1px solid #3f4248",
                            color: "#f5f5f5",
                          }}
                          itemStyle={{ color: "#f5f5f5" }}
                        />
                        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                          <Cell fill={CHART_COLORS[2]} />
                          <Cell fill={CHART_COLORS[3]} />
                        </Bar>
                      </BarChart>
                    ) : (
                      <PieChart>
                        <Pie
                          data={weekWeekendChartData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={55}
                          outerRadius={90}
                          paddingAngle={3}
                        >
                          <Cell fill={CHART_COLORS[2]} />
                          <Cell fill={CHART_COLORS[3]} />
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            background: "#0d0d0f",
                            border: "1px solid #3f4248",
                            color: "#f5f5f5",
                          }}
                          itemStyle={{ color: "#f5f5f5" }}
                        />
                      </PieChart>
                    )}
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="audiohub-card">
                <div className="audiohub-vs-panel">
                <div className="audiohub-vs-row-title"> Weekend v Weekday Listening</div>
                  <div className="audiohub-vs-row">
                    <div className="audiohub-vs-box">
                      <div className="audiohub-vs-value">{ww.weekend} hrs</div>
                    </div>
                    <div className="audiohub-vs-mid">vs</div>
                    <div className="audiohub-vs-box">
                      <div className="audiohub-vs-value">{ww.week} hrs</div>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
      </section>

      <section className="audiohub-section">
          <div className="audiohub-section-title audiohub-gradient-title">
              Listening Report
          </div>
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
          </div>
      </section>

      <section className="audiohub-section">
          <div className="audiohub-section-title audiohub-gradient-title">
              Comparisons
          </div>
          <div className="audiohub-compare-grid">
            <div className="audiohub-compare-block">
              <div className="audiohub-compare-block-title">
                  <div>How do you compare to others? </div>
              </div>
            </div>
            <div className="audiohub-compare-block">
              <div>
                You listen to music more than
                <span className="audiohub-inline-fill-short">{comparePercent}</span>% of others, with
                <span className="audiohub-inline-fill-short">{totalHours.toLocaleString()}</span>
                hours listened!
              </div>
            </div>
            {/*
              <div className="audiohub-compare-block">
                <div>
                  You listen to music more than
                  <span className="audiohub-inline-fill-short">{artistDelta}</span>% of people with
                  <span className="audiohub-inline-fill-short">{metrics.unique_artists}</span>
                  hours listened!
                </div>
              </div>
            */}
            <div className="audiohub-compare-block">
              <div>
                While others were listening to
                <span className="audiohub-inline-fill-short"></span>, you were listening to {metrics.top_track || "your top track"}!
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
                  <BarChart data={artistModalData}>
                    <CartesianGrid stroke="#6F2DA8" vertical={false} />
                    <XAxis axisLine={false} tickLine={false} tick={false} />
                    <YAxis tick={{ fill: "#f5f5f5", fontSize: 11 }} />
                      <Tooltip
                        formatter={(value, _name, props) => [`${value} hrs`, props.payload?.name ?? "Artist"]}
                        labelFormatter={() => ""}
                        contentStyle={{
                          background: "#0d0d0f",
                          border: "1px solid #3f4248",
                          color: "#f5f5f5",
                        }}
                        itemStyle={{ color: "#f5f5f5" }}
                      />
                    <Bar
                      dataKey="hours"
                      radius={[4, 4, 0, 0]}
                      isAnimationActive={true}
                      animationDuration={800}
                      cursor="pointer"
                    >
                      {artistModalData.map((entry, index) => (
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
                  {artistModalData.map((artist, index) => (
                    <div key={artist.name} className="audiohub-list-row">
                      <div className="audiohub-list-num">{index + 1}.</div>
                      <div className="audiohub-list-text">{artist.name}</div>
                    </div>
                  ))}
                </div>

                <div className="audiohub-list-box">
                  <div className="audiohub-card-title">Time Listened</div>
                  {artistModalData.map((artist, index) => (
                    <div key={`${artist.name}-${index}`} className="audiohub-list-row">
                      <div className="audiohub-list-num">{index + 1}.</div>
                      <div className="audiohub-list-text">{artist.hours} hrs</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </div>
      </Modal>
      ) : null}

      {modal === "tracks" ? (
          <Modal title="Top Tracks" onClose={() => setModal(null)}>
            <div className="audiohub-viz-grid">
              <div className="audiohub-viz-left">
                <section className="audiohub-card">
                  <div className="audiohub-card-title">Top Tracks</div>
                  <div className="audiohub-chart-panel">
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={trackModalData} layout="vertical" margin={{ left: 20 }}>
                        <CartesianGrid stroke="#6F2DA8" horizontal vertical={false} />
                        <XAxis type="number" tick={{ fill: "#f5f5f5", fontSize: 11 }} />
                        <YAxis
                          type="category"
                          dataKey="name"
                          tick={false}
                          axisLine={false}
                          tickLine={false}
                          width={20}
                        />
                        <Tooltip
                          formatter={(value, _name, props) => [
                            `${value} replays`,
                            props.payload?.name ?? "Track",
                          ]}
                          labelFormatter={() => ""}
                          contentStyle={{
                            background: "#0d0d0f",
                            border: "1px solid #3f4248",
                            color: "#f5f5f5",
                          }}
                          itemStyle={{
                            color: "#f5f5f5",
                          }}
                        />
                        <Bar
                          dataKey="streams"
                          radius={[0, 4, 4, 0]}
                          isAnimationActive={true}
                          animationDuration={800}
                          cursor="pointer"
                        >
                          {trackModalData.map((entry, index) => (
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
                      <div className="audiohub-card-title">Top Tracks</div>
                      {trackModalData.map((track, index) => (
                        <div key={track.name} className="audiohub-list-row">
                          <div className="audiohub-list-num">{index + 1}.</div>
                          <div className="audiohub-list-text">{track.name}</div>
                        </div>
                      ))}
                    </div>

                    <div className="audiohub-list-box">
                      <div className="audiohub-card-title">Times Replayed</div>
                      {trackModalData.map((track, index) => (
                        <div key={`${track.name}-${index}`} className="audiohub-list-row">
                          <div className="audiohub-list-num">{index + 1}.</div>
                          <div className="audiohub-list-text">{track.streams} replays</div>
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
