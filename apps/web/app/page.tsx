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

  return <main className="audiohub-home-loading">Loading AudioHub...</main>;
}