// General page layout and structure carried over from dashboard, assisted with Codex
"use client";

import { useEffect, useMemo, useState } from "react";
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
import { AppShell } from "@/components/layout/app-shell";
import { getGlobalMetrics } from "@/lib/api/client";
import { getSupabaseBrowserClient, signOutUser } from "@/lib/supabase/client";
import { t, type AppLanguage, type TranslationKey } from "@/lib/i18n";

type RankedGlobalItem = {
  name: string;
  streams: number;
  total_ms_played: number;
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
  day_ms?: number;
  night_ms?: number;
  weekday_ms?: number;
  weekend_ms?: number;
};

const CHART_COLORS = ["#C64B8C", "#FD3DB5", "#DE73FF", "#B65FCF"];

function msToHours(ms: number) {
  return Math.max(0, Math.round(ms / 1000 / 60 / 60));
}

function hoursFromMs(ms: number) {
  return Math.max(1, Math.round(ms / 1000 / 60 / 60));
}

function buildArtistChartData(metrics: GlobalMetrics) {
  return metrics.top_artists.slice(0, 5).map((artist) => ({
    name: artist.name,
    streams: artist.streams,
    hours: msToHours(artist.total_ms_played),
  }));
}

function buildTrackChartData(metrics: GlobalMetrics) {
  return [...metrics.top_tracks]
    .sort((a, b) => b.streams - a.streams)
    .slice(0, 5)
    .map((track) => ({
      name: track.name,
      streams: track.streams,
      hours: msToHours(track.total_ms_played),
    }));
}

function buildDayNightChartData(metrics: GlobalMetrics) {
  return [
    { name: "Day", value: msToHours(metrics.day_ms ?? 0) },
    { name: "Night", value: msToHours(metrics.night_ms ?? 0) },
  ];
}

function buildWeekWeekendChartData(metrics: GlobalMetrics) {
  return [
    { name: "Weekday", value: msToHours(metrics.weekday_ms ?? 0) },
    { name: "Weekend", value: msToHours(metrics.weekend_ms ?? 0) },
  ];
}

export default function GlobalBoardPage() {
  const router = useRouter();
  const [metrics, setMetrics] = useState<GlobalMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [username, setUsername] = useState("Spotify Username");
  const [language, setLanguage] = useState<AppLanguage>("ENG");
  const [artistChartType, setArtistChartType] = useState<"bar" | "pie">("bar");
  const [trackChartType, setTrackChartType] = useState<"bar" | "pie">("bar");
  const [dayNightChartType, setDayNightChartType] = useState<"bar" | "pie">("pie");
  const [weekChartType, setWeekChartType] = useState<"bar" | "pie">("pie");

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

  const totalHours = metrics ? hoursFromMs(metrics.total_ms_played) : 0;

  const artistChartData = useMemo(
    () => (metrics ? buildArtistChartData(metrics) : []),
    [metrics]
  );
  const trackChartData = useMemo(
    () => (metrics ? buildTrackChartData(metrics) : []),
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

  const dn = {
    day: msToHours(metrics?.day_ms ?? 0),
    night: msToHours(metrics?.night_ms ?? 0),
  };

  const ww = {
    week: msToHours(metrics?.weekday_ms ?? 0),
    weekend: msToHours(metrics?.weekend_ms ?? 0),
  };

  if (loading) {
    return <main className="audiohub-home-loading">Loading global metrics...</main>;
  }

  if (!metrics || metrics.total_streams === 0) {
    return (
      <main className="audiohub-home-loading">
        No global listening data is available yet.
      </main>
    );
  }

  return (
    <AppShell
      username={username}
      profileLabel="Global Board"
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
          Global Highlights
        </div>

        <div className="audiohub-report-grid">
          <div className="audiohub-report-card">
            <div className="audiohub-report-key">Active Users</div>
            <div className="audiohub-report-value">
              {metrics.total_active_users.toLocaleString()}
            </div>
          </div>
          <div className="audiohub-report-card">
            <div className="audiohub-report-key">Total Streams</div>
            <div className="audiohub-report-value">
              {metrics.total_streams.toLocaleString()}
            </div>
          </div>
          <div className="audiohub-report-card">
            <div className="audiohub-report-key">Listening Time</div>
            <div className="audiohub-report-value">
              {totalHours.toLocaleString()} hours
            </div>
          </div>
          <div className="audiohub-report-card">
            <div className="audiohub-report-key">Unique Tracks</div>
            <div className="audiohub-report-value">
              {metrics.unique_tracks.toLocaleString()}
            </div>
          </div>
          <div className="audiohub-report-card">
            <div className="audiohub-report-key">Unique Artists</div>
            <div className="audiohub-report-value">
              {metrics.unique_artists.toLocaleString()}
            </div>
          </div>
          <div className="audiohub-report-card">
            <div className="audiohub-report-key">Top Track</div>
            <div className="audiohub-report-value">
              {metrics.top_track || "Unknown Track"}
            </div>
          </div>
          <div className="audiohub-report-card">
            <div className="audiohub-report-key">Top Artist</div>
            <div className="audiohub-report-value">
              {metrics.top_artist || "Unknown Artist"}
            </div>
          </div>
        </div>
      </section>

      <section className="audiohub-section">
        <div className="audiohub-section-title audiohub-gradient-title">
          Community Listening
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

              <div className="audiohub-chart-panel">
                <ResponsiveContainer width="100%" height={260}>
                  {artistChartType === "bar" ? (
                    <BarChart data={artistChartData}>
                      <CartesianGrid stroke="#232428" vertical={false} />
                      <XAxis axisLine={false} tickLine={false} tick={false} />
                      <YAxis tick={{ fill: "#f5f5f5", fontSize: 11 }} />
                      <Tooltip
                        formatter={(value, _name, props) => [
                          `${value} hours`,
                          props.payload?.name ?? "Artist",
                        ]}
                        labelFormatter={() => ""}
                        contentStyle={{
                          background: "#0d0d0f",
                          border: "1px solid #3f4248",
                          color: "#f5f5f5",
                        }}
                        itemStyle={{ color: "#f5f5f5" }}
                      />
                      <Bar dataKey="hours" radius={[4, 4, 0, 0]}>
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
                        innerRadius={58}
                        outerRadius={96}
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
                        formatter={(value, _name, props) => [
                          `${value} hours`,
                          props.payload?.name ?? "Artist",
                        ]}
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
                    <div className="audiohub-list-text">{artist.hours} hours</div>
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

              <div className="audiohub-chart-panel">
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
                      <Bar dataKey="streams" radius={[0, 4, 4, 0]}>
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
                        innerRadius={58}
                        outerRadius={96}
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
                        formatter={(value, _name, props) => [
                          `${value} replays`,
                          props.payload?.name ?? "Track",
                        ]}
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
                {trackChartData.map((track, index) => (
                  <div key={`${track.name}-${index}`} className="audiohub-list-row">
                    <div className="audiohub-list-num">{index + 1}.</div>
                    <div className="audiohub-list-text">{track.streams} replays</div>
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
                <ResponsiveContainer width="100%" height={260}>
                  {dayNightChartType === "bar" ? (
                    <BarChart data={dayNightChartData}>
                      <CartesianGrid stroke="#232428" vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: "#f5f5f5", fontSize: 11 }} />
                      <YAxis tick={{ fill: "#f5f5f5", fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        {dayNightChartData.map((entry, index) => (
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
                        data={dayNightChartData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={58}
                        outerRadius={96}
                      >
                        {dayNightChartData.map((entry, index) => (
                          <Cell
                            key={entry.name}
                            fill={CHART_COLORS[index % CHART_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  )}
                </ResponsiveContainer>
              </div>
            </section>

            <section className="audiohub-card audiohub-vs-panel">
              <div>
                <div className="audiohub-vs-row-title">Day v Night Listening</div>
                <div className="audiohub-vs-row">
                  <div className="audiohub-vs-box">
                    <div>
                      <div className="audiohub-vs-label">Day</div>
                      <div className="audiohub-vs-value">{dn.day} hrs</div>
                    </div>
                  </div>
                  <div className="audiohub-vs-mid">vs.</div>
                  <div className="audiohub-vs-box">
                    <div>
                      <div className="audiohub-vs-label">Night</div>
                      <div className="audiohub-vs-value">{dn.night} hrs</div>
                    </div>
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
                <ResponsiveContainer width="100%" height={260}>
                  {weekChartType === "bar" ? (
                    <BarChart data={weekWeekendChartData}>
                      <CartesianGrid stroke="#232428" vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: "#f5f5f5", fontSize: 11 }} />
                      <YAxis tick={{ fill: "#f5f5f5", fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        {weekWeekendChartData.map((entry, index) => (
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
                        data={weekWeekendChartData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={58}
                        outerRadius={96}
                      >
                        {weekWeekendChartData.map((entry, index) => (
                          <Cell
                            key={entry.name}
                            fill={CHART_COLORS[index % CHART_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  )}
                </ResponsiveContainer>
              </div>
            </section>

            <section className="audiohub-card audiohub-vs-panel">
              <div>
                <div className="audiohub-vs-row-title">Weekend v Weekday Listening</div>
                <div className="audiohub-vs-row">
                  <div className="audiohub-vs-box">
                    <div>
                      <div className="audiohub-vs-label">Weekday</div>
                      <div className="audiohub-vs-value">{ww.week} hrs</div>
                    </div>
                  </div>
                  <div className="audiohub-vs-mid">vs.</div>
                  <div className="audiohub-vs-box">
                    <div>
                      <div className="audiohub-vs-label">Weekend</div>
                      <div className="audiohub-vs-value">{ww.weekend} hrs</div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
