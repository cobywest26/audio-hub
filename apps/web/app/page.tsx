"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { getLatestMetrics } from "@/lib/api/client";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    async function checkUserData() {
      const supabase = getSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        router.push("/login");
        return;
      }

      try {
        const latest = await getLatestMetrics(session.access_token);

        if (latest?.has_data) {
          router.push("/dashboard");
        } else {
          router.push("/upload");
        }
      } catch (error) {
        console.error("Failed to check latest metrics:", error);
        router.push("/upload");
      }
    }

    checkUserData();
  }, [router]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-zinc-100 text-zinc-900">
      <p className="text-lg">Loading AudioHub...</p>
    </main>
  );
}

/*import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 text-center">
        <p className="mb-3 text-sm uppercase tracking-[0.2em] text-zinc-400">
          AudioHub
        </p>
        <h1 className="text-5xl font-bold tracking-tight">
          What does your Spotify history say about You?
        </h1>
        <p className="mt-4 max-w-2xl text-zinc-300">
          Upload your Spotify listening history and explore your personal stats,
          trends, and community insights.
        </p>

        <div className="mt-8 flex gap-4">
          <Link
            href="/login"
            className="rounded-xl bg-white px-5 py-3 font-medium text-zinc-950"
          >
            Get Started
          </Link>
        </div>
      </div>
    </main>
  );
}*/