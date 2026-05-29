-- Agent-native settings: BYOK LLM key, external agent API key
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS agent_provider text NOT NULL DEFAULT 'anthropic',
  ADD COLUMN IF NOT EXISTS agent_api_key text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS vibecount_api_key text DEFAULT NULL;

-- Index for fast MCP auth lookup (service role queries by this key)
CREATE INDEX IF NOT EXISTS user_settings_vibecount_api_key_idx
  ON public.user_settings (vibecount_api_key)
  WHERE vibecount_api_key IS NOT NULL;
