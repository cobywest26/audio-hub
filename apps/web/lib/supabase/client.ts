import { createClient } from "@supabase/supabase-js";

export function getSupabaseBrowserClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function signOutUser() {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    throw new Error(error.message || "Failed to sign out.");
  }
}