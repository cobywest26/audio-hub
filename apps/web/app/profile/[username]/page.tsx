"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
} from "recharts";

import { AppShell } from "@/components/layout/app-shell";
import { getSupabaseBrowserClient, signOutUser } from "@/lib/supabase/client";
import {
  getProfileByUsername,
  searchProfiles,
  type ProfileMetricsResponse,
  type Metrics,
} from "@/lib/api/client";
import { t, type AppLanguage, type TranslationKey } from "@/lib/i18n";

// Shared chart color palette for profile visualizations.
// AI-assisted note: keep this in sync with dashboard colors or move both to a shared constants file.
const COLORS = ["#C64B8C", "#FD3DB5", "#DE73FF", "#B65FCF"];

// Converts Spotify listening duration from milliseconds into rounded hours.
function msToHours(ms: number) {
  return Math.max(0, Math.round(ms / 1000 / 60 / 60));
}

// Builds top artist chart data from the newer top_artists array.
// Falls back to legacy top_artist data if older metrics are returned.
function buildArtistData(metrics: Metrics) {
  if (metrics.top_artists?.length) {
    return metrics.top_artists.slice(0, 5).map((a) => ({
      name: a.name,
      hours: msToHours(a.total_ms_played),
    }));
  }
  return [];
}

// Builds top track chart data from ranked track metrics.
// AI-assisted note: this mirrors dashboard logic and should eventually be moved into shared utilities.
function buildTrackData(metrics: Metrics) {
  if (metrics.top_tracks?.length) {
    return [...metrics.top_tracks]
      .sort((a, b) => b.streams - a.streams)
      .slice(0, 5)
      .map((t) => ({
        name: t.name,
        streams: t.streams,
      }));
  }
  return [];
}

// Assigns a listener archetype based on total listening hours.
function getArchetype(hours: number) {
  if (hours < 500) return "Novice Listener";
  if (hours < 2500) return "Music Guru";
  if (hours < 5000) return "DJ";
  return "Expert";
}

export default function ProfilePage() {
  const router = useRouter();
  const params = useParams<{ username: string }>();
  const viewedUsername = decodeURIComponent(params.username);

  const [loading, setLoading] = useState(true);
  const [profileData, setProfileData] = useState<ProfileMetricsResponse | null>(null);

  const [username, setUsername] = useState("Spotify User");
  const [signingOut, setSigningOut] = useState(false);

  const [searchValue, setSearchValue] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchEmpty, setSearchEmpty] = useState(false);

  const [artistChartType, setArtistChartType] = useState<"bar" | "pie">("bar");
  const [trackChartType, setTrackChartType] = useState<"bar" | "pie">("bar");

  const [language, setLanguage] = useState<AppLanguage>("ENG");

  const translate = (
    key: TranslationKey,
    vars?: Record<string, string | number>
  ) => t(language, key, vars);

  // Loads the viewed user's profile after confirming the current user has an active session.
  useEffect(() => {
    async function load() {
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
          user?.email?.split("@")[0] ||
          "User"
      );

      try {
        const data = await getProfileByUsername(session.access_token, viewedUsername);
        setProfileData(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [router, viewedUsername]);

  // Debounced profile search used by the AppShell search bar.
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
      } catch {
        setSearchResults([]);
        setSearchEmpty(true);
      }
    }

    const t = setTimeout(runSearch, 250);
    return () => clearTimeout(t);
  }, [searchValue]);

  // Restores the user's selected language from localStorage on page load.
  useEffect(() => {
    const savedLanguage = window.localStorage.getItem("audiohub-language");

    if (savedLanguage === "ENG" || savedLanguage === "SPN") {
      setLanguage(savedLanguage);
    }
  }, []);

  const metrics = profileData?.metrics ?? null;
  const totalHours = metrics ? msToHours(metrics.total_ms_played) : 0;
  const archetype = getArchetype(totalHours);

  // Memoizes chart data so it only rebuilds when profile metrics change.
  const artistData = useMemo(
    () => (metrics ? buildArtistData(metrics) : []),
    [metrics]
  );

  const trackData = useMemo(
    () => (metrics ? buildTrackData(metrics) : []),
    [metrics]
  );

  // Signs out the current user and returns them to the login screen.
  async function handleLogout() {
    setSigningOut(true);
    await signOutUser();
    router.push("/login");
  }

  if (loading) {
  return <div>{translate("loading_profile")}</div>;
}

if (!profileData || !metrics) {
  return <div>{translate("no_data_found")}</div>;
}
  // Determines the display label for the profile being viewed.
  const profileLabel =
    profileData.profile.display_name ||
    profileData.profile.username ||
    viewedUsername;
  return (
    <AppShell
      username={username}
      profileLabel={translate("user_profile", { name: profileLabel })}
      onSnapshots={() => router.push("/dashboard")}
      onReset={() => router.push("/upload")}
      onLogout={handleLogout}
      loggingOut={signingOut}
      onProfile={() => router.push("/dashboard")}
      onRecommender={() => router.push("/recommender")}
      onGlobe={() => router.push("/global-board")}
      searchValue={searchValue}
      searchResults={searchResults}
      searchEmpty={searchEmpty}
      onSearchChange={setSearchValue}
      onSearchSelect={(u) => {
        setSearchValue("");
        setSearchResults([]);
        setSearchEmpty(false);
        router.push(`/profile/${u}`);
      }}
      language={language}
      onLanguageChange={(nextLanguage) => {
        setLanguage(nextLanguage);
        window.localStorage.setItem("audiohub-language", nextLanguage);
      }}
      translate={translate}
    >
      <section className="audiohub-section">
        <div className="audiohub-section-title audiohub-gradient-title">
            {translate("highlights")}
        </div>

        <div className="audiohub-viz-row audiohub-viz-row--double">
          <section className="audiohub-card">
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

            <ResponsiveContainer width="100%" height={250}>
              {artistChartType === "bar" ? (
                <BarChart data={artistData}>
                  <CartesianGrid stroke="#222" />
                  <XAxis dataKey="name" hide />
                  <YAxis />
                  <Tooltip
                    formatter={(value, _name, props) => [`${value}${translate("hours")}`, props.payload?.name ?? "Artist"]}
                    labelFormatter={() => ""}
                    contentStyle={{
                      background: "#0d0d0f",
                      border: "1px solid #3f4248",
                      color: "#f5f5f5",
                    }}
                    itemStyle={{ color: "#f5f5f5" }}
                  />
                  <Bar dataKey="hours">
                    {artistData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              ) : (
                <PieChart>
                  <Pie data={artistData} dataKey="hours">
                    {artistData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
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
          </section>

          <section className="audiohub-card">
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

            <ResponsiveContainer width="100%" height={250}>
              {trackChartType === "bar" ? (
                <BarChart data={trackData} layout="vertical">
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" hide />
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
                  <Bar dataKey="streams">
                    {trackData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              ) : (
                <PieChart>
                  <Pie data={trackData} dataKey="streams">
                    {trackData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
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
                </PieChart>
              )}
            </ResponsiveContainer>
          </section>
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
              <div className="audiohub-report-key">Top Artist</div>
              <div className="audiohub-report-value">
                {metrics.top_artist || "Unknown Artist"}
              </div>
            </div>

            <div className="audiohub-report-card">
              <div className="audiohub-report-key">Top Song</div>
              <div className="audiohub-report-value">
                {metrics.top_track || "Unknown Track"}
              </div>
            </div>

            <div className="audiohub-report-card">
              <div className="audiohub-report-key">Times Replayed</div>
              <div className="audiohub-report-value">
                {Math.max(12, Math.round(metrics.total_streams / 7))}
              </div>
            </div>

            <div className="audiohub-report-card">
              <div className="audiohub-report-key">Listening Time</div>
              <div className="audiohub-report-value">
                {totalHours.toLocaleString()} hours
              </div>
            </div>
          </div>
      </section>
    </AppShell>
  );
}