// Loads supabase-js from a CDN only when config.js has been filled in.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

export const isConfigured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let client = null;
let loading = null;

export async function getSupabase() {
  if (!isConfigured()) return null;
  if (client) return client;
  if (!loading) {
    loading = import('https://esm.sh/@supabase/supabase-js@2')
      .then(({ createClient }) => {
        client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true } });
        return client;
      })
      .catch((e) => { console.warn('Could not load Supabase', e); loading = null; return null; });
  }
  return loading;
}
