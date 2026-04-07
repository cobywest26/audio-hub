"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getLatestMetrics } from "@/lib/api/client";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    async function finishLogin() {
      const supabase = getSupabaseBrowserClient();

      // Get user after returning from Spotify
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.access_token) {
        console.error("No authenticated session found:", sessionError);
        router.replace("/login");
        return;
      }

      const latest = await getLatestMetrics(session.access_token);

      if (latest?.has_data) {
        router.replace("/dashboard");
      } else {
        router.replace("/upload");
      }
    }

    finishLogin().catch((error) => {
      console.error("Failed to finish login:", error);
      router.replace("/login");
    });
  }, [router]);

  return (
    <main className="min-h-screen flex items-center justify-center">
      <p className="text-sm text-zinc-600">Signing in...</p>
    </main>
  );
}
