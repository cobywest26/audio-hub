"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getSupabaseBrowserClient, signOutUser } from "@/lib/supabase/client";
import { getLatestMetrics } from "@/lib/api/client";

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

export function RecommenderPage() {
    const router = useRouter();
    const [publicProfile, setPublicProfile] = useState(true);
    const [username, setUsername] = useState("Spotify Username");
    const [signingOut, setSigningOut] = useState(false);
    const [latest, setLatest] = useState<LatestResponse | null>(null);
    const metrics = latest?.metrics ?? null;
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function loadUser() {
            const supabase = getSupabaseBrowserClient();

            const {
                data: {session},
            } = await supabase.auth.getSession();

            if (!session?.access_token) {
                router.push("/login");
                return;
            }

            const {
                data: {user},
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
              const latestData = await getLatestMetrics(session.access_token);
              setLatest(latestData);
            } catch (error) {
              console.error("Failed to load recommender data:", error);
            } finally {
              setLoading(false);
            }
        }

        loadUser();
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

    if (loading) {
        return <main className="audiohub-home-loading">Loading recommendations...</main>;
    }

    if (!latest?.has_data || !metrics) {
        return (
            <main className="audiohub-home-loading">
                No listening data yet. Upload your Spotify data first.
            </main>
        );
    }

    return (
        <AppShell
            username={username}
            publicProfile={publicProfile}
            onTogglePublic={() => setPublicProfile((current) => !current)}
            onSnapshots={() => router.push("/dashboard")}
            onReset={() => router.push("/upload")}
            onLogout={handleLogout}
            loggingOut={signingOut}
            onProfile={() => router.push("/dashboard")}
            onGlobe={() => alert("Global Insights page not implemented yet.")}
        >
            <section className="audiohub-section">
                <div className="audiohub-section-title audiohub-gradient-title">
                    Recommendations
                </div>

                <div className="audiohub-recommend-grid">
                    <section className="audiohub-section">
                        <div className="audiohub-section-title audiohub-gradient-title">
                            Recommendations
                        </div>
                        <div className="audiohub-recommend-grid">
                            <div className="audiohub-recommend-col">
                                <div className="audiohub-small-title">Artists</div>

                                <div className="audiohub-field-row">
                                    <div>Artist</div>
                                    <div className="audiohub-field-box"/>
                                </div>
                                <div className="audiohub-field-row">
                                    <div>Artist</div>
                                    <div className="audiohub-field-box"/>
                                </div>
                                <div className="audiohub-field-row">
                                    <div>Artist</div>
                                    <div className="audiohub-field-box"/>
                                </div>

                                <div className="audiohub-playlist-row">
                                    <div>Curated Playlist:</div>
                                    <input className="audiohub-small-input" defaultValue="Name your playlist"/>
                                    <button type="button" className="audiohub-small-pill">
                                        Export to Spotify
                                    </button>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            </section>
        </AppShell>
    );
}