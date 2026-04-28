"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getSupabaseBrowserClient, signOutUser } from "@/lib/supabase/client";
import {
  addTracksToSpotifyPlaylist,
  createSpotifyPlaylist,
  generateRecommendations,
  getMyRecommendations,
  RecommendationItem,
  RecommendationResponse,
} from "@/lib/api/client";

function sourceLabel(item: RecommendationItem) {
  if (item.source === "llm_external_spotify_verified") return "External pick";
  if (item.source === "lightfm_rerank") return "LightFM rerank";
  return "Catalog match";
}

function shuffleRecommendations(items: RecommendationItem[]) {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

export default function RecommenderPage() {
  const router = useRouter();
  const [publicProfile, setPublicProfile] = useState(true);
  const [username, setUsername] = useState("Spotify Username");
  const [signingOut, setSigningOut] = useState(false);
  const [recommendationState, setRecommendationState] = useState<RecommendationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [playlistName, setPlaylistName] = useState("AudioHub Mix");
  const [exportSuccessUrl, setExportSuccessUrl] = useState<string | null>(null);

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

      const stored = window.localStorage.getItem("audiohub-public-profile");
      if (stored) setPublicProfile(stored === "true");

      try {
        const recommendations = await getMyRecommendations(session.access_token);
        setRecommendationState(recommendations);
      } catch (error) {
        console.error("Failed to load recommender data:", error);
        setPageError(error instanceof Error ? error.message : "Failed to load recommender data.");
      } finally {
        setLoading(false);
      }
    }

    loadPage();
  }, [router]);

  useEffect(() => {
    window.localStorage.setItem("audiohub-public-profile", String(publicProfile));
  }, [publicProfile]);

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

  async function handleGenerateRecommendations() {
    try {
      setGenerating(true);
      setPageError(null);

      const supabase = getSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        router.push("/login");
        return;
      }

      const response = await generateRecommendations(session.access_token, {
        limit: 10,
        useExternalDiscovery: true,
      });

      setExportSuccessUrl(null);
      setRecommendationState(response);
    } catch (error) {
      console.error("Failed to generate recommendations:", error);
      setPageError(error instanceof Error ? error.message : "Failed to generate recommendations.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleExportPlaylist() {
    try {
      setExporting(true);
      setPageError(null);
      setExportSuccessUrl(null);

      const supabase = getSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        router.push("/login");
        return;
      }

      if (!session.provider_token) {
        await supabase.auth.signInWithOAuth({
          provider: "spotify",
          options: {
            redirectTo: `${window.location.origin}/recommender`,
            scopes: "playlist-modify-private playlist-modify-public",
          },
        });
        return;
      }

      const trackUris = displayedRecommendations
        .map((item) => item.spotify_uri || (item.track_id ? `spotify:track:${item.track_id}` : null))
        .filter((value): value is string => Boolean(value));

      if (trackUris.length === 0) {
        throw new Error("No Spotify track URIs are available to export.");
      }

      const playlist = await createSpotifyPlaylist(session.provider_token, {
        name: playlistName.trim() || "AudioHub Mix",
        description: "Created by AudioHub from your generated recommendations.",
        public: false,
      });

      await addTracksToSpotifyPlaylist(session.provider_token, playlist.id, trackUris);
      setExportSuccessUrl(playlist.external_urls?.spotify || null);
    } catch (error) {
      console.error("Failed to export playlist:", error);
      setPageError(error instanceof Error ? error.message : "Failed to export playlist.");
    } finally {
      setExporting(false);
    }
  }

  const recommendationItems = useMemo(
    () => recommendationState?.recommendations ?? [],
    [recommendationState]
  );
  const displayedRecommendations = useMemo(
    () => shuffleRecommendations(recommendationItems),
    [recommendationItems]
  );

  if (loading) {
    return <main className="audiohub-home-loading">Loading recommendations...</main>;
  }

  const hasRecommendations = recommendationState?.has_recommendations && recommendationItems.length > 0;

  return (
    <AppShell
      username={username}
      //publicProfile={publicProfile}
      //onTogglePublic={() => setPublicProfile((current) => !current)}
      onSnapshots={() => router.push("/dashboard")}
      onReset={() => router.push("/upload")}
      onLogout={handleLogout}
      loggingOut={signingOut}
      onProfile={() => router.push("/dashboard")}
      onRecommender={() => router.push("/recommender")}
      onGlobe={() => router.push("/global-board")}
    >
      <section className="audiohub-section">
        <div className="audiohub-section-title audiohub-gradient-title">
          Playlist Results
        </div>

        <div className="audiohub-card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "16px",
              flexWrap: "wrap",
              marginBottom: "18px",
            }}
          >
            <div className="audiohub-card-title">Recommended Tracks</div>
            <button
              type="button"
              className="audiohub-small-pill"
              onClick={handleGenerateRecommendations}
              disabled={generating}
              style={{
                opacity: generating ? 0.6 : 1,
                cursor: generating ? "progress" : "pointer",
              }}
            >
              {generating ? "Generating..." : hasRecommendations ? "Refresh Mix" : "Generate Mix"}
            </button>
          </div>

          {pageError ? (
            <div
              style={{
                border: "1px solid #8b3d55",
                background: "#1b0f14",
                color: "#ffd6df",
                padding: "12px 14px",
                fontSize: "13px",
                marginBottom: "18px",
              }}
            >
              {pageError}
            </div>
          ) : null}

          {hasRecommendations ? (
            <div style={{ display: "grid", gap: "12px" }}>
              {displayedRecommendations.map((item) => (
                <div
                  key={`${item.track_id}-${item.source}`}
                  style={{
                    border: "1px solid #2c2d31",
                    padding: "14px",
                    display: "grid",
                    gap: "8px",
                    background: "#0c0c0e",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "12px",
                      alignItems: "flex-start",
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "15px", fontWeight: 700 }}>
                        {item.track_name || "Unknown track"}
                      </div>
                      <div style={{ fontSize: "13px", color: "#c5c6ca", marginTop: "4px" }}>
                        {item.artists || "Unknown artist"}
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: "12px",
                        border: "1px solid #4b4c50",
                        padding: "4px 8px",
                        color: item.source === "llm_external_spotify_verified" ? "#ffcf84" : "#d8d9dd",
                      }}
                    >
                      {sourceLabel(item)}
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: "14px",
                      flexWrap: "wrap",
                      fontSize: "12px",
                      color: "#9ea1a8",
                    }}
                  >
                    <span>Genre: {item.genre || "Unknown"}</span>
                    <span>
                      Popularity: {typeof item.popularity === "number" ? item.popularity : "N/A"}
                    </span>
                    <span>
                      Score: {typeof item.score === "number" ? item.score.toFixed(3) : "External"}
                    </span>
                    {item.track_id ? (
                      <a
                        href={item.external_url || `https://open.spotify.com/track/${item.track_id}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "#ffb34d", textDecoration: "none" }}
                      >
                        Open in Spotify
                      </a>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: "13px", color: "#c5c6ca" }}>
              No stored recommendations yet. Generate a mix to create and save one for this user.
            </div>
          )}
        </div>
      </section>

      <section className="audiohub-section">
        <div className="audiohub-section-title audiohub-gradient-title">
          Spotify Export
        </div>

        <div className="audiohub-card">
          <div className="audiohub-card-title" style={{ marginBottom: "18px" }}>
            Export Playlist
          </div>

          <div
            className="audiohub-playlist-row"
            style={{
              gridTemplateColumns: "140px minmax(0, 1fr) auto",
              marginBottom: "12px",
            }}
          >
            <div>Playlist name</div>
            <input
              className="audiohub-small-input"
              value={playlistName}
              onChange={(event) => setPlaylistName(event.target.value)}
              placeholder="AudioHub Mix"
            />
            <button
              type="button"
              className="audiohub-small-pill"
              onClick={handleExportPlaylist}
              disabled={exporting || !hasRecommendations || !playlistName.trim()}
              style={{
                opacity: exporting || !hasRecommendations || !playlistName.trim() ? 0.55 : 1,
                cursor: exporting || !hasRecommendations || !playlistName.trim() ? "not-allowed" : "pointer",
              }}
            >
              {exporting ? "Exporting..." : "Export to Spotify"}
            </button>
          </div>

          {exportSuccessUrl ? (
            <div style={{ fontSize: "13px", color: "#d9f7c8", marginTop: "14px" }}>
              Playlist exported successfully.{" "}
              <a
                href={exportSuccessUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: "#ffb34d", textDecoration: "none" }}
              >
                Open it in Spotify
              </a>
            </div>
          ) : null}
        </div>
      </section>
    </AppShell>
  );
}
