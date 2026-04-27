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
  getSnapshotMetrics,
  resetForNewSnapshot,
  renameSnapshot,
  searchProfiles,
} from "@/lib/api/client";
import { AppShell } from "@/components/layout/app-shell";
import { t, type AppLanguage, type TranslationKey } from "@/lib/i18n";

// Snapshot record returned by the API for saved listening-history versions.
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

// Main listening metrics model used by dashboard charts and summary cards.
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

type ModalType = "artists" | "tracks" | "reset" | "snapshots" | "compare" | null;

// Shared dashboard chart color palette.
const CHART_COLORS = ["#C64B8C", "#FD3DB5", "#DE73FF", "#B65FCF"];

// Formats milliseconds into whole listening hours for display.
function formatHours(ms: number) {
  return Math.max(1, Math.round(ms / 1000 / 60 / 60));
}

function msToHours(ms: number) {
  return Math.max(0, Math.round(ms / 1000 / 60 / 60));
}

// Builds top artist chart data from current snapshot metrics.
// AI-assisted note: fallback supports older backend fields during schema transition.
function buildArtistChartData(metrics: Metrics) {
  if (metrics.top_artists && metrics.top_artists.length > 0) {
    return metrics.top_artists.slice(0, 5).map((artist) => ({
      name: artist.name,
      streams: artist.streams,
      hours: msToHours(artist.total_ms_played),
    }));
  }
  return [];
}

// Builds top track chart data for dashboard visualizations.
function buildTrackChartData(metrics: Metrics) {
  if (metrics.top_tracks && metrics.top_tracks.length > 0) {
    return [...metrics.top_tracks]
      .sort((a, b) => b.streams - a.streams)
      .slice(0, 5)
      .map((track) => ({
        name: track.name,
        streams: track.streams,
        hours: msToHours(track.total_ms_played),
      }));
  }
  return [];
}

// Builds expanded artist list data for modal views.
function buildArtistModalData(metrics: Metrics) {
  if (metrics.top_artists && metrics.top_artists.length > 0) {
    return metrics.top_artists.slice(0, 15).map((artist) => ({
      name: artist.name,
      streams: artist.streams,
      hours: msToHours(artist.total_ms_played),
    }));
  }
  return [];
}

function buildTrackModalData(metrics: Metrics) {
  if (metrics.top_tracks && metrics.top_tracks.length > 0) {
    return [...metrics.top_tracks]
      .sort((a, b) => b.streams - a.streams)
      .slice(0, 15)
      .map((track) => ({
        name: track.name,
        streams: track.streams,
        hours: msToHours(track.total_ms_played),
      }));
  }
  return [];
}

// Builds day/night listening split data for charts.
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

// Builds week/weekend listening split data for charts.
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
    return [...metrics.top_tracks]
      .sort((a, b) => b.streams - a.streams)
      .slice(0, 5)
      .map((track) => ({
        name: track.name,
        value: track.streams,
      }));
  }
  return [];
}

function hoursFromMs(ms: number) {
  return Math.max(1, Math.round(ms / 1000 / 60 / 60));
}

// Converts total listening hours into a simple listener category.
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
// Reusable modal wrapper for dashboard popups.
function Modal({
  title,
  children,
  onClose,
  closeLabel,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  closeLabel: string;
}) {
  return (
    <div className="audiohub-overlay">
      <div className="audiohub-modal">
        <div className="audiohub-modal-header">
          <span>{title}</span>
          <button type="button" className="audiohub-modal-close" onClick={onClose}>
              {closeLabel}
          </button>
        </div>
        <div className="audiohub-modal-body">{children}</div>
      </div>
    </div>
  );
}

// Main dashboard page.
// Handles latest metrics, snapshots, comparisons, search, modals, and chart state.
export default function DashboardPage() {
  const router = useRouter();
  const [latest, setLatest] = useState<LatestResponse | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapshotDrafts, setSnapshotDrafts] = useState<Record<string, string>>({});
  const [editingSnapshotId, setEditingSnapshotId] = useState<string | null>(null);
  const snapshotInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [compareSnapshotId, setCompareSnapshotId] = useState<string | null>(null);
  const [compareData, setCompareData] = useState<{
    current: Metrics | null;
    previous: Metrics | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [language, setLanguage] = useState<AppLanguage>("ENG");
  const translate = (
    key: TranslationKey,
    vars?: Record<string, string | number>
  ) => t(language, key, vars);
  const [resetting, setResetting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [username, setUsername] = useState("Spotify Username");
  const [modal, setModal] = useState<ModalType>(null);
  const [artistChartType, setArtistChartType] = useState<"bar" | "pie">("bar");
  const [trackChartType, setTrackChartType] = useState<"bar" | "pie">("bar");
  const [dayNightChartType, setDayNightChartType] = useState<"bar" | "pie">("pie");
  const [weekChartType, setWeekChartType] = useState<"bar" | "pie">("pie");
  const [searchValue, setSearchValue] = useState("");
  const [searchResults, setSearchResults] = useState<
    { id: string; username: string; display_name: string | null; avatar_url: string | null }[]
  >([]);
  const [searchEmpty, setSearchEmpty] = useState(false);

  useEffect(() => {
    // Loads the authenticated user's dashboard metrics and snapshot history.
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
      async function runSearch() {
        const value = searchValue.trim();

        if (!value) {
          setSearchResults([]);
          setSearchEmpty(false);
          return;
        }

        try {
          const supabase = getSupabaseBrowserClient();
          const {
            data: { session },
          } = await supabase.auth.getSession();

          if (!session?.access_token) return;

          const data = await searchProfiles(session.access_token, value);
          setSearchResults(data.results);
          setSearchEmpty(data.results.length === 0);
        } catch (error) {
          console.error("Profile search failed:", error);
          setSearchResults([]);
          setSearchEmpty(true);
        }
      }

      const timer = setTimeout(runSearch, 250);
      return () => clearTimeout(timer);
  }, [searchValue]);

  // Focuses and selects the snapshot name when rename mode starts.
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

  async function handleCompare(snapshotId: string) {
    try {
      const supabase = getSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token || !metrics) {
        router.push("/login");
        return;
      }

      console.log("COMPARE TOKEN:", session?.access_token);
      console.log("SNAPSHOT ID:", snapshotId);

      const previousResponse = await getSnapshotMetrics(session.access_token, snapshotId);

      setCompareSnapshotId(snapshotId);
      setCompareData({
        current: metrics,
        previous: previousResponse.metrics,
      });
      setModal("compare");
    } catch (error) {
      console.error("Failed to load snapshot comparison:", error);
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
        profileLabel={translate("your_profile")}
        onSnapshots={() => setModal("snapshots")}
        onReset={() => setModal("reset")}
        onLogout={handleLogout}
        loggingOut={signingOut}
        onProfile={() => router.push("/dashboard")}
        onRecommender={() => router.push("/recommender")}
        onGlobe={() => router.push("/global-board")}
        searchValue={searchValue}
        searchResults={searchResults}
        searchEmpty={searchEmpty}
        onSearchChange={setSearchValue}
        onSearchSelect={(username) => {
          setSearchValue("");
          setSearchResults([]);
          setSearchEmpty(false);
          router.push(`/profile/${encodeURIComponent(username)}`);
        }}
        language={language}
        onLanguageChange={setLanguage}
        translate={translate}
      >
      <section className="audiohub-section">
          <div className="audiohub-section-title audiohub-gradient-title">
            {translate("your_highlights")}
          </div>
          <div className="audiohub-viz-rows">
            <div className="audiohub-viz-row audiohub-viz-row--triple">
              <section className="audiohub-card">
                <div className="audiohub-viz-card-header">
                  <div className="audiohub-card-title">{translate("top_artists")}</div>
                  <button
                    type="button"
                    className="audiohub-toggle-chip"
                    onClick={() =>
                      setArtistChartType((current) => (current === "bar" ? "pie" : "bar"))
                    }
                  >
                    {artistChartType === "bar" ? translate("bar_chart") : translate("pie_chart")}
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
                              formatter={(value, _name, props) => [`${value} ${translate("hours")}`, props.payload?.name ?? "Artist"]}
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
                              formatter={(value, _name, props) => [`${value} ${translate("hours")}`, props.payload?.name ?? "Artist"]}
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
                  <div className="audiohub-card-title">{translate("top_artists")}</div>
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
                  <div className="audiohub-card-title">{translate("time_listened")}</div>
                  {artistChartData.map((artist, index) => (
                    <div key={`${artist.name}-${index}`} className="audiohub-list-row">
                      <div className="audiohub-list-num">{index + 1}.</div>
                      <div className="audiohub-list-text">{artist.hours} {translate("hours")}</div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="audiohub-viz-row audiohub-viz-row--triple">
              <section className="audiohub-card">
                <div className="audiohub-viz-card-header">
                  <div className="audiohub-card-title">{translate("top_tracks")}</div>
                  <button
                    type="button"
                    className="audiohub-toggle-chip"
                    onClick={() =>
                      setTrackChartType((current) => (current === "bar" ? "pie" : "bar"))
                    }
                  >
                    {trackChartType === "bar" ? translate("bar_chart") : translate("pie_chart")}
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
                            `${value} ${translate("replays")}`,
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
                  <div className="audiohub-card-title">{translate("top_tracks")}</div>
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
                  <div className="audiohub-card-title">{translate("times_replayed")}</div>
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
                  <div className="audiohub-card-title">{translate("day_night")}</div>
                  <button
                    type="button"
                    className="audiohub-toggle-chip"
                    onClick={() =>
                      setDayNightChartType((current) => (current === "bar" ? "pie" : "bar"))
                    }
                  >
                    {dayNightChartType === "bar" ? translate("bar_chart") : translate("pie_chart")}
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
                <div className="audiohub-vs-row-title"> {translate("day_night")}</div>
                  <div className="audiohub-vs-row">
                    <div className="audiohub-vs-box">
                      <div className="audiohub-vs-value">{dn.day} {translate("hours")}</div>
                    </div>
                    <div className="audiohub-vs-mid">vs</div>
                    <div className="audiohub-vs-box">
                      <div className="audiohub-vs-value">{dn.night} {translate("hours")}</div>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <div className="audiohub-viz-row audiohub-viz-row--double">
              <section className="audiohub-card">
                <div className="audiohub-viz-card-header">
                  <div className="audiohub-card-title">{translate("weekend_week")}</div>
                  <button
                    type="button"
                    className="audiohub-toggle-chip"
                    onClick={() =>
                      setWeekChartType((current) => (current === "bar" ? "pie" : "bar"))
                    }
                  >
                    {weekChartType === "bar" ? translate("bar_chart") : translate("pie_chart")}
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
                <div className="audiohub-vs-row-title"> {translate("weekend_week")}</div>
                  <div className="audiohub-vs-row">
                    <div className="audiohub-vs-box">
                      <div className="audiohub-vs-value">{ww.weekend} {translate("hours")}</div>
                    </div>
                    <div className="audiohub-vs-mid">vs</div>
                    <div className="audiohub-vs-box">
                      <div className="audiohub-vs-value">{ww.week} {translate("hours")}</div>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
      </section>

      <section className="audiohub-section">
          <div className="audiohub-section-title audiohub-gradient-title">
            {translate("listening_report")}
          </div>

          <div className="audiohub-report-grid">
            <div className="audiohub-report-card">
              <div className="audiohub-report-key">{translate("listening_archetype")}</div>
              <div className="audiohub-report-value">{archetype}</div>
            </div>

            <div className="audiohub-report-card">
              <div className="audiohub-report-key">{translate("top_artist")}</div>
              <div className="audiohub-report-value">
                {metrics.top_artist || "Unknown Artist"}
              </div>
            </div>

            <div className="audiohub-report-card">
              <div className="audiohub-report-key">{translate("top_song")}</div>
              <div className="audiohub-report-value">
                {metrics.top_track || "Unknown Track"}
              </div>
            </div>

            <div className="audiohub-report-card">
              <div className="audiohub-report-key">{translate("times_replayed")}</div>
              <div className="audiohub-report-value">
                {Math.max(12, Math.round(metrics.total_streams / 7))}
              </div>
            </div>

            <div className="audiohub-report-card">
              <div className="audiohub-report-key">{translate("time_listened")}</div>
              <div className="audiohub-report-value">
                {totalHours.toLocaleString()} {translate("hours")}
              </div>
            </div>

            <div className="audiohub-report-card">
              <div className="audiohub-report-key">{translate("day_night")}</div>
              <div className="audiohub-report-value">
                {dn.day} vs. {dn.night}
              </div>
            </div>

            <div className="audiohub-report-card">
              <div className="audiohub-report-key">{translate("weekend_week")}</div>
              <div className="audiohub-report-value">
                {ww.week} vs. {ww.weekend}
              </div>
            </div>
          </div>
      </section>

      <section className="audiohub-section">
          <div className="audiohub-section-title audiohub-gradient-title">
            {translate("comparisons")}
          </div>

          <div className="audiohub-compare-grid">
            <div className="audiohub-compare-block">
              <div className="audiohub-compare-block-title">
                <div>{translate("how_compare")}</div>
              </div>
            </div>

            <div className="audiohub-compare-block">
              <div>
                {translate("comparisons_line1_part1")}{" "}
                <span className="audiohub-compare-value">{comparePercent}</span>
                {translate("comparisons_line1_part2")}{" "}
                <span className="audiohub-compare-value">{totalHours.toLocaleString()}</span>{" "}
                {translate("comparisons_line1_part3")}
              </div>
            </div>

            <div className="audiohub-compare-block">
              <div>
                {translate("comparisons_line2_part1")}{" "}
                <span className="audiohub-compare-value">{metrics.top_artist || "your top artist"}</span>{" "}
                {translate("comparisons_line2_part2")}{" "}
                <span className="audiohub-compare-value">{artistDelta}</span>
                {translate("comparisons_line2_part3")}{" "}
                <span className="audiohub-compare-value">
                {artistChartData[0]?.hours ?? 0}
                </span>
                {" "}{translate("comparisons_line2_part4")}
              </div>
            </div>

            <div className="audiohub-compare-block">
              <div>
                {translate("comparisons_line3_part1")}{" "}
                <span className="audiohub-compare-value">
                  {trackChartData[1]?.name || translate("other_top_songs")}
                </span>
                {translate("comparisons_line3_part2")}{" "}
                <span className="audiohub-compare-value">
                  {metrics.top_track || translate("your_top_track")}
                </span>
                !
              </div>
            </div>
          </div>
      </section>
      </AppShell>

      {modal === "artists" ? (
      <Modal title={translate("top_artists")} onClose={() => setModal(null)} closeLabel={translate("exit")}>
        <div className="audiohub-viz-grid">
          <div className="audiohub-viz-left">
            <section className="audiohub-card">
              <div className="audiohub-card-title">{translate("top_artists")}</div>
              <div className="audiohub-chart-panel">
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={artistModalData}>
                    <CartesianGrid stroke="#6F2DA8" vertical={false} />
                    <XAxis axisLine={false} tickLine={false} tick={false} />
                    <YAxis tick={{ fill: "#f5f5f5", fontSize: 11 }} />
                      <Tooltip
                        formatter={(value, _name, props) => [`${value} ${translate("hours")}`, props.payload?.name ?? "Artist"]}
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
                  <div className="audiohub-card-title">{translate("top_artists")}</div>
                  {artistModalData.map((artist, index) => (
                    <div key={artist.name} className="audiohub-list-row">
                      <div className="audiohub-list-num">{index + 1}.</div>
                      <div className="audiohub-list-text">{artist.name}</div>
                    </div>
                  ))}
                </div>

                <div className="audiohub-list-box">
                  <div className="audiohub-card-title">{translate("time_listened")}</div>
                  {artistModalData.map((artist, index) => (
                    <div key={`${artist.name}-${index}`} className="audiohub-list-row">
                      <div className="audiohub-list-num">{index + 1}.</div>
                      <div className="audiohub-list-text">{artist.hours} {translate("hours")}</div>
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
          <Modal title={translate("top_tracks")} onClose={() => setModal(null)} closeLabel={translate("exit")}>
            <div className="audiohub-viz-grid">
              <div className="audiohub-viz-left">
                <section className="audiohub-card">
                  <div className="audiohub-card-title">{translate("top_tracks")}</div>
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
                      <div className="audiohub-card-title">{translate("top_tracks")}</div>
                      {trackModalData.map((track, index) => (
                        <div key={track.name} className="audiohub-list-row">
                          <div className="audiohub-list-num">{index + 1}.</div>
                          <div className="audiohub-list-text">{track.name}</div>
                        </div>
                      ))}
                    </div>

                    <div className="audiohub-list-box">
                      <div className="audiohub-card-title">{translate("times_replayed")}</div>
                      {trackModalData.map((track, index) => (
                        <div key={`${track.name}-${index}`} className="audiohub-list-row">
                          <div className="audiohub-list-num">{index + 1}.</div>
                          <div className="audiohub-list-text">{track.streams} {translate("replays")}</div>
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
        <Modal title={translate("reset_dash")} onClose={() => setModal(null)} closeLabel={translate("exit")}>
          <div style={{ minHeight: 220, display: "grid", placeItems: "center" }}>
            <div style={{ width: "100%", textAlign: "center" }}>
              <div style={{ fontSize: 28, marginBottom: 28 }}>{translate("reset_dash")}?</div>
              <div className="audiohub-modal-actions">
                <button type="button" className="audiohub-action-btn" onClick={handleReset} disabled={resetting}>
                  {resetting ? "Resetting..." : translate("reset")}
                </button>
                <button type="button" className="audiohub-action-btn" onClick={() => setModal(null)}>
                  {translate("exit")}
                </button>
              </div>
            </div>
          </div>
        </Modal>
      ) : null}

      {modal === "snapshots" ? (
        <Modal title={translate("previous_snapshots")} onClose={() => setModal(null)} closeLabel={translate("exit")}>
          <div>
            {snapshots.length === 0 ? (
              <div style={{ fontSize: 14 }}>No snapshots found.</div>
            ) : (
              snapshots.map((snapshot) => (
                <div key={snapshot.id} className="audiohub-snapshot-item">
                  <button
                    type="button"
                    className="audiohub-edit-dot"
                    onClick={() => handleEditSnapshot(snapshot.id)}
                    aria-label={`Rename ${snapshotDrafts[snapshot.id] || "snapshot"}`}
                    title="Rename snapshot"
                  >
                    {editingSnapshotId === snapshot.id ? "✓" : "✎"}
                  </button>

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
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        handleEditSnapshot(snapshot.id);
                      }
                    }}
                    onBlur={() => {
                      if (editingSnapshotId === snapshot.id) {
                        handleEditSnapshot(snapshot.id);
                      }
                    }}
                  />

                  <button
                    type="button"
                    className="audiohub-mini-btn"
                    onClick={() => handleCompare(snapshot.id)}
                  >
                    {translate("compare")}
                  </button>
                </div>
              ))
            )}
          </div>
        </Modal>
      ) : null}

      {modal === "compare" && compareData ? (
        <Modal title={translate("snapshot_comp")} onClose={() => setModal(null)} closeLabel={translate("exit")}>
            <div className="audiohub-compare-modal">
              <div className="audiohub-compare-columns">
                <section className="audiohub-card">
                  <div className="audiohub-card-title">{translate("curr_snapshot")}</div>
                  <div className="audiohub-report-grid audiohub-report-grid--compare">
                    <div className="audiohub-report-card">
                      <div className="audiohub-report-key">{translate("top_artist")}</div>
                      <div className="audiohub-report-value">
                        {compareData.current?.top_artist || "Unknown Artist"}
                      </div>
                    </div>

                    <div className="audiohub-report-card">
                      <div className="audiohub-report-key">{translate("top_track")}</div>
                      <div className="audiohub-report-value">
                        {compareData.current?.top_track || "Unknown Track"}
                      </div>
                    </div>

                    <div className="audiohub-report-card">
                      <div className="audiohub-report-key">{translate("hours")}</div>
                      <div className="audiohub-report-value">
                        {msToHours(compareData.current?.total_ms_played || 0)}
                      </div>
                    </div>

                    <div className="audiohub-report-card">
                      <div className="audiohub-report-key">{translate("streams")}</div>
                      <div className="audiohub-report-value">
                        {compareData.current?.total_streams || 0}
                      </div>
                    </div>

                    <div className="audiohub-report-card">
                      <div className="audiohub-report-key">{translate("artists")}</div>
                      <div className="audiohub-report-value">
                        {compareData.current?.unique_artists || 0}
                      </div>
                    </div>

                    <div className="audiohub-report-card">
                      <div className="audiohub-report-key">{translate("tracks")}</div>
                      <div className="audiohub-report-value">
                        {compareData.current?.unique_tracks || 0}
                      </div>
                    </div>
                  </div>
                </section>

                <section className="audiohub-card">
                  <div className="audiohub-card-title">{translate("selected_snapshot")}</div>
                  <div className="audiohub-report-grid audiohub-report-grid--compare">
                    <div className="audiohub-report-card">
                      <div className="audiohub-report-key">{translate("top_artist")}</div>
                      <div className="audiohub-report-value">
                        {compareData.previous?.top_artist || "Unknown Artist"}
                      </div>
                    </div>

                    <div className="audiohub-report-card">
                      <div className="audiohub-report-key">{translate("top_track")}</div>
                      <div className="audiohub-report-value">
                        {compareData.previous?.top_track || "Unknown Track"}
                      </div>
                    </div>

                    <div className="audiohub-report-card">
                      <div className="audiohub-report-key">{translate("hours")}</div>
                      <div className="audiohub-report-value">
                        {msToHours(compareData.previous?.total_ms_played || 0)}
                      </div>
                    </div>

                    <div className="audiohub-report-card">
                      <div className="audiohub-report-key">{translate("streams")}</div>
                      <div className="audiohub-report-value">
                        {compareData.previous?.total_streams || 0}
                      </div>
                    </div>

                    <div className="audiohub-report-card">
                      <div className="audiohub-report-key">{translate("artists")}</div>
                      <div className="audiohub-report-value">
                        {compareData.previous?.unique_artists || 0}
                      </div>
                    </div>

                    <div className="audiohub-report-card">
                      <div className="audiohub-report-key">{translate("tracks")}</div>
                      <div className="audiohub-report-value">
                        {compareData.previous?.unique_tracks || 0}
                      </div>
                    </div>
                  </div>
                </section>
              </div>

              <section className="audiohub-card" style={{ marginTop: 16 }}>
                <div className="audiohub-card-title">{translate("differences")}</div>
                <div className="audiohub-report-grid audiohub-report-grid--compare">
                  <div className="audiohub-report-card">
                    <div className="audiohub-report-key">{translate("hours")} {translate("differences")}</div>
                    <div className="audiohub-report-value">
                      {msToHours(compareData.current?.total_ms_played || 0) -
                        msToHours(compareData.previous?.total_ms_played || 0)}
                    </div>
                  </div>

                  <div className="audiohub-report-card">
                    <div className="audiohub-report-key">{translate("streams")} {translate("differences")}</div>
                    <div className="audiohub-report-value">
                      {(compareData.current?.total_streams || 0) -
                        (compareData.previous?.total_streams || 0)}
                    </div>
                  </div>

                  <div className="audiohub-report-card">
                    <div className="audiohub-report-key">{translate("artists")} {translate("differences")}</div>
                    <div className="audiohub-report-value">
                      {(compareData.current?.unique_artists || 0) -
                        (compareData.previous?.unique_artists || 0)}
                    </div>
                  </div>

                  <div className="audiohub-report-card">
                    <div className="audiohub-report-key">{translate("tracks")} {translate("differences")}</div>
                    <div className="audiohub-report-value">
                      {(compareData.current?.unique_tracks || 0) -
                        (compareData.previous?.unique_tracks || 0)}
                    </div>
                  </div>

                  <div className="audiohub-report-card">
                    <div className="audiohub-report-key">{translate("top_art_chng")}</div>
                    <div className="audiohub-report-value">
                      {compareData.current?.top_artist === compareData.previous?.top_artist ? "No" : translate("yes")}
                    </div>
                  </div>

                  <div className="audiohub-report-card">
                    <div className="audiohub-report-key">{translate("top_trk_chng")}</div>
                    <div className="audiohub-report-value">
                      {compareData.current?.top_track === compareData.previous?.top_track ? "No" : translate("yes")}
                    </div>
                  </div>
                </div>
              </section>
            </div>
        </Modal>
      ) : null}
    </>
  );
}
