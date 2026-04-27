"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getSupabaseBrowserClient, signOutUser } from "@/lib/supabase/client";
import {
  getRecommendations,
  type RecommenderResponse,
  getRecommenderDebug,
} from "@/lib/api/client";
import { t, type AppLanguage, type TranslationKey } from "@/lib/i18n";

type TopArtist = {
  name: string;
  score: number;
};

function buildTopRecommendedArtists(
  recommendations: RecommenderResponse["recommendations"]
): TopArtist[] {
  const artistScores = new Map<string, number>();

  for (const rec of recommendations) {
    if (!rec.artists) continue;

    const artists = rec.artists
      .split(/[;,]/)
      .map((name) => name.trim())
      .filter(Boolean);

    for (const artist of artists) {
      artistScores.set(artist, (artistScores.get(artist) ?? 0) + rec.score);
    }
  }

  return Array.from(artistScores.entries())
    .map(([name, score]) => ({ name, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

export default function RecommenderPage() {
  const router = useRouter();
  const [username, setUsername] = useState("Spotify Username");
  const [signingOut, setSigningOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [recommendationData, setRecommendationData] =
    useState<RecommenderResponse | null>(null);
  const [language, setLanguage] = useState<AppLanguage>("ENG");

  const translate = (
    key: TranslationKey,
    vars?: Record<string, string | number>
  ) => t(language, key, vars);

  useEffect(() => {
    async function loadPage() {
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

      console.log("TOKEN:", session?.access_token);

      const data = await getRecommendations(session.access_token, 20);

      try {
        const data = await getRecommendations(session.access_token, 20);
        setRecommendationData(data);
      } catch (error) {
        console.error("Failed to load recommender data:", error);
      } finally {
        setLoading(false);
      }

      const debugData = await getRecommenderDebug(session.access_token);
      console.log("RECOMMENDER DEBUG:", debugData);
    }

    loadPage();
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

  const topArtists = useMemo(
    () =>
      recommendationData?.recommendations
        ? buildTopRecommendedArtists(recommendationData.recommendations)
        : [],
    [recommendationData]
  );

  const topTracks = useMemo(
    () => recommendationData?.recommendations?.slice(0, 10) ?? [],
    [recommendationData]
  );

  if (loading) {
    return <main className="audiohub-home-loading">Loading recommendations...</main>;
  }

  if (!recommendationData?.has_data) {
    return (
      <main className="audiohub-home-loading">
        No recommendation data yet. Upload Spotify history first.
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
          Recommended For You
        </div>

        <div className="audiohub-viz-row audiohub-viz-row--double">
          <section className="audiohub-card">
            <div className="audiohub-list-box">
              <div className="audiohub-card-title">Top 3 Recommended Artists</div>
              {topArtists.length > 0 ? (
                topArtists.map((artist, index) => (
                  <div key={`${artist.name}-${index}`} className="audiohub-list-row">
                    <div className="audiohub-list-num">{index + 1}.</div>
                    <div className="audiohub-list-text">
                      {artist.name} ({artist.score.toFixed(2)})
                    </div>
                  </div>
                ))
              ) : (
                <div className="audiohub-list-row">
                  <div className="audiohub-list-text">
                    No artist recommendations available yet.
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="audiohub-card">
            <div className="audiohub-list-box">
              <div className="audiohub-card-title">Recommended Tracks</div>
              {topTracks.length > 0 ? (
                topTracks.map((track, index) => (
                  <div key={`${track.track_id}-${index}`} className="audiohub-list-row">
                    <div className="audiohub-list-num">{index + 1}.</div>
                    <div className="audiohub-list-text">
                      {track.track_name ?? "Unknown Track"} by{" "}
                      {track.artists ?? "Unknown Artist"}
                    </div>
                  </div>
                ))
              ) : (
                <div className="audiohub-list-row">
                  <div className="audiohub-list-text">
                    No track recommendations available yet.
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </section>
    </AppShell>
  );
}