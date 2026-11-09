/**
 * secret-box.ts
 * At-rest encryption for users' own Gemini API keys (users.user_api_key).
 *
 * AES-256-GCM with a random 96-bit nonce per value, stored as
 * "enc:v1:<base64(nonce | tag | ciphertext)>". The username is bound in as
 * additional authenticated data, so a ciphertext copied onto another user's
 * row fails to decrypt instead of lending them the key.
 *
 * The encryption key lives only in the API_KEY_ENCRYPTION_KEY env var (never
 * the database), so a database leak alone no longer exposes usable keys.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "../config.js";

const PREFIX = "enc:v1:";

export class KeyStorageUnavailableError extends Error {
  constructor() {
    super("API_KEY_ENCRYPTION_KEY is not configured");
    this.name = "KeyStorageUnavailableError";
  }
}

/** Encrypt a user's API key for storage. Throws if no encryption key is set:
 *  storing a plaintext key is never the fallback. */
export function sealApiKey(plain: string, username: string): string {
  const key = config.apiKeyEncryptionKey;
  if (!key) throw new KeyStorageUnavailableError();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(username, "utf8"));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([nonce, cipher.getAuthTag(), ct]).toString("base64");
}

/**
 * Decrypt a stored value. Returns null when there is no usable key, so callers
 * fall through to the trial key / "add your key" path rather than erroring.
 * Values without the prefix predate encryption and are returned as-is.
 */
export function openApiKey(stored: string | null | undefined, username: string): string | null {
  if (!stored) return null;
  if (!stored.startsWith(PREFIX)) return stored;
  const key = config.apiKeyEncryptionKey;
  if (!key) {
    console.error("[ERROR] stored API key is encrypted but API_KEY_ENCRYPTION_KEY is unset");
    return null;
  }
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(username, "utf8"));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    console.error(`[ERROR] could not decrypt stored API key for user=${username}`);
    return null;
  }
}
