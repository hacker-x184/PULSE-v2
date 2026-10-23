import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard 96-bit IV for AES-GCM
const PREFIX = 'enc:v1:';

function getDerivedKey(providedKey?: string): Buffer {
  const secret = providedKey || process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'pulse-default-secure-key-seed-32b';
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypts an access token or sensitive secret at rest using AES-256-GCM with authentication tag.
 */
export function encryptToken(token: string | null | undefined, secretKey?: string): string | null {
  if (!token || typeof token !== 'string' || !token.trim()) return null;
  const clean = token.trim();
  if (clean.startsWith(PREFIX)) return clean; // Already encrypted

  const key = getDerivedKey(secretKey);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(clean, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts an AES-256-GCM encrypted token.
 * Safely falls back to plain string if legacy unencrypted token encountered.
 */
export function decryptToken(encryptedString: string | null | undefined, secretKey?: string): string | null {
  if (!encryptedString || typeof encryptedString !== 'string') return null;
  const clean = encryptedString.trim();
  if (!clean.startsWith(PREFIX)) {
    // Unencrypted legacy token
    return clean;
  }

  try {
    const raw = clean.slice(PREFIX.length);
    const parts = raw.split(':');
    if (parts.length !== 3) return null;

    const [ivHex, tagHex, cipherHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const cipherText = Buffer.from(cipherHex, 'hex');

    const key = getDerivedKey(secretKey);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Strips or redacts any secrets or tokens from logs and error messages.
 */
export function redactSecrets(text: string): string {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/ghp_[A-Za-z0-9_]{36,}/g, '[REDACTED_GH_PAT]')
    .replace(/github_pat_[A-Za-z0-9_]{50,}/g, '[REDACTED_GH_TOKEN]')
    .replace(/Bearer\s+[A-Za-z0-9_\-\.]{20,}/gi, 'Bearer [REDACTED_BEARER]')
    .replace(/(client_secret|access_token)=([^&\s]+)/gi, '$1=[REDACTED]');
}
