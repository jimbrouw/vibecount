import "server-only";
import { parseEvidenceKeyring } from "./evidence-keyring";
export function loadEvidenceKeyring() {
  return parseEvidenceKeyring({
    VIBECOUNT_SOURCE_ENCRYPTION_KEY:
      process.env.VIBECOUNT_SOURCE_ENCRYPTION_KEY,
    VIBECOUNT_SOURCE_KEY_ID: process.env.VIBECOUNT_SOURCE_KEY_ID,
    VIBECOUNT_SOURCE_ENCRYPTION_KEYS:
      process.env.VIBECOUNT_SOURCE_ENCRYPTION_KEYS,
  });
}
export function loadEvidenceKey(keyId?: string) {
  const keys = loadEvidenceKeyring();
  const id = keyId ?? keys.activeId;
  return { key: keys.key(id), keyId: id };
}
