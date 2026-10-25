-- Migration: Add vibecount_api_key to user_settings for external MCP agent access
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS vibecount_api_key text DEFAULT NULL;

-- Index for fast MCP auth lookup by service role / admin client
CREATE INDEX IF NOT EXISTS user_settings_vibecount_api_key_idx
  ON public.user_settings (vibecount_api_key)
  WHERE vibecount_api_key IS NOT NULL;
