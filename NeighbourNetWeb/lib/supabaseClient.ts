/**
 * NeighbourNet — Supabase browser client.
 *
 * Used for Realtime subscriptions (INSERT / UPDATE on messages table).
 * Requires NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.
 *
 * If the anon key is missing, a stub client is returned so the app
 * still works (data loads from REST; just no push updates).
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function createSupabase(): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    if (typeof window !== 'undefined') {
      // Log once per page load — not on SSR to avoid server noise.
      console.warn(
        '[NeighbourNet] NEXT_PUBLIC_SUPABASE_ANON_KEY is not set.\n' +
        'Realtime push updates disabled — dashboard will still load via REST polling.\n' +
        'Get your anon key from: Supabase Dashboard → Settings → API',
      );
    }
    // Return a valid (but non-functional) client with placeholder values.
    // supabase-js handles connection failures gracefully.
    return createClient(
      supabaseUrl || 'https://placeholder.supabase.co',
      supabaseAnonKey || 'placeholder-anon-key',
      { realtime: { params: { eventsPerSecond: 0 } } },
    );
  }

  return createClient(supabaseUrl, supabaseAnonKey);
}

export const supabase = createSupabase();
