"use client";

import Image from "next/image";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginPage() {
  async function handleSpotifyLogin() {
    const supabase = getSupabaseBrowserClient();

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "spotify",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      console.error(error.message);
      alert(error.message);
    }
  }

  return (
    <main className="audiohub-page">
      <div className="audiohub-stage audiohub-stage--center">
        <div className="audiohub-center-card">
          <Image
            src="/audiohub-logo.png"
            alt="AudioHub"
            width={62}
            height={62}
            className="audiohub-logo-large"
          />
          <h1 className="audiohub-welcome">Welcome to AudioHub!</h1>
          <p className="audiohub-upload-label">Continue with Spotify</p>

          <button
            type="button"
            className="audiohub-upload-button"
            onClick={handleSpotifyLogin}
          >
            ⇢
          </button>
        </div>
      </div>
    </main>
  );
}