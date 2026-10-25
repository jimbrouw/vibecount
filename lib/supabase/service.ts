import { createAdminClient } from "./admin";

/**
 * Service role client — bypasses RLS.
 * Restricted strictly to:
 * - MCP auth: looking up user ID by their vibecount_api_key
 * Never expose or call in client-side code.
 */
export function createServiceClient() {
  const client = createAdminClient();
  if (!client) {
    throw new Error(
      "Supabase service configuration missing (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)."
    );
  }
  return client;
}
