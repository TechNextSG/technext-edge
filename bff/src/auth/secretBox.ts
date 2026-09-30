// AES-256-GCM for the API keys an admin saves in the dashboard.
//
// The KV holds only ciphertext; the key that opens it is the env var `SETTINGS_ENCRYPTION_KEY` (32 bytes,
// base64), which lives in Vercel and never in KV. So a leaked KV dump is not a leaked provider key, and a
// wrong or rotated `SETTINGS_ENCRYPTION_KEY` makes saved keys unreadable — reported as such, with the
// environment's own key used instead (see `settingsStore.resolve`) — never as a silent empty string.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedSecret {
  v: 1;
  iv: string;
  tag: string;
  ct: string;
  /** The last four characters, kept in the clear so the dashboard can show "••••abcd". Never enough to use. */
  last4: string;
}

export class SecretDecryptError extends Error {
  constructor() {
    super("could not decrypt the saved key — SETTINGS_ENCRYPTION_KEY is missing or is not the key it was saved with");
    this.name = "SecretDecryptError";
  }
}

/** The 32-byte key from `SETTINGS_ENCRYPTION_KEY`, or null when it is unset or not a base64 32-byte value. */
export function encryptionKeyFromEnv(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const raw = env.SETTINGS_ENCRYPTION_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

export function encryptSecret(plain: string, key: Buffer): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ct: ct.toString("base64"),
    last4: plain.slice(-4),
  };
}

export function decryptSecret(secret: EncryptedSecret, key: Buffer | null): string {
  if (!key) throw new SecretDecryptError();
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(secret.iv, "base64"));
    decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(secret.ct, "base64")), decipher.final()]).toString("utf8");
  } catch {
    // GCM's tag check fails on a wrong key and on tampering alike; the caller does not need to tell them apart.
    throw new SecretDecryptError();
  }
}

/** What the dashboard may show of a key: dots and the last four characters. */
export function maskSecret(last4: string): string {
  return `••••${last4}`;
}
