import { createClient } from "@supabase/supabase-js";

// Service role client — bypasses RLS. Use only for:
// - MCP auth: looking up a user by their vibecount_api_key
// Never expose this client to browser code.
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
