"use client";

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
    <main className="min-h-screen bg-zinc-100 px-6 py-10 text-zinc-900">
      <div className="mx-auto max-w-md rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold">Sign in</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Continue with Spotify to access your AudioHub profile.
        </p>

        <button
          onClick={handleSpotifyLogin}
          className="mt-6 w-full rounded-xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-700"
        >
          Continue with Spotify
        </button>
      </div>
    </main>
  );
}
