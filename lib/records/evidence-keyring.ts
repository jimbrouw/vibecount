export type EvidenceKeyring = {
  activeId: string;
  ids: string[];
  key: (id: string) => Buffer;
};
type KeyEnvironment = {
  VIBECOUNT_SOURCE_ENCRYPTION_KEY?: string;
  VIBECOUNT_SOURCE_KEY_ID?: string;
  VIBECOUNT_SOURCE_ENCRYPTION_KEYS?: string;
};
const validId = /^[a-zA-Z0-9_-]{1,40}$/;
function decode(value: unknown) {
  if (typeof value !== "string")
    throw new Error("Invalid evidence key configuration.");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== value)
    throw new Error("Invalid evidence key configuration.");
  return bytes;
}
/** Key IDs are immutable labels. Never fall back to the active key for an unknown ID. */
export function parseEvidenceKeyring(env: KeyEnvironment): EvidenceKeyring {
  const keys = new Map<string, Buffer>();
  const configured = env.VIBECOUNT_SOURCE_ENCRYPTION_KEYS;
  const activeId = env.VIBECOUNT_SOURCE_KEY_ID ?? (configured ? "" : "v1");
  if (!validId.test(activeId))
    throw new Error("Choose a valid active evidence key ID.");
  if (configured !== undefined) {
    if (
      env.VIBECOUNT_SOURCE_ENCRYPTION_KEY !== undefined ||
      configured.length > 8192
    )
      throw new Error(
        "Use one evidence key configuration, with every retained key in the keyring.",
      );
    let entries: unknown;
    try {
      entries = JSON.parse(configured);
    } catch {
      throw new Error("Invalid evidence keyring configuration.");
    }
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > 32)
      throw new Error("Invalid evidence keyring configuration.");
    for (const entry of entries) {
      if (
        !entry ||
        typeof entry !== "object" ||
        Object.keys(entry).some((k) => !["id", "key"].includes(k)) ||
        typeof entry.id !== "string" ||
        !validId.test(entry.id) ||
        keys.has(entry.id)
      )
        throw new Error("Evidence key IDs must be valid and unique.");
      keys.set(entry.id, decode(entry.key));
    }
  } else keys.set(activeId, decode(env.VIBECOUNT_SOURCE_ENCRYPTION_KEY));
  if (!keys.has(activeId))
    throw new Error("The active evidence key is missing from the keyring.");
  return {
    activeId,
    ids: [...keys.keys()],
    key(id) {
      const value = keys.get(id);
      if (!value)
        throw new Error(
          "The recorded evidence key is unavailable. Restore the retained key before retrying.",
        );
      return Buffer.from(value);
    },
  };
}
