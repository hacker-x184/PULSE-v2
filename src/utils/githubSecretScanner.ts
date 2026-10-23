/**
 * PULSE GitHub Secret Scanner & File Indexing Guard
 * Enforces strict secret exclusion and file eligibility rules for RAG indexing.
 */

const BLOCKED_DIRECTORIES = [
  'node_modules/',
  '.git/',
  '.github/',
  'dist/',
  'build/',
  '.next/',
  'coverage/',
  'vendor/',
  '.turbo/'
];

const BLOCKED_EXTENSIONS = [
  '.exe', '.bin', '.dll', '.so', '.dylib', '.zip', '.tar', '.gz', '.7z', '.rar',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg', '.mp4', '.mp3',
  '.pdf', '.woff', '.woff2', '.ttf', '.eot',
  '.lock', '.pyc', '.class', '.o', '.a'
];

const SENSITIVE_FILENAME_PATTERNS = [
  /^\.env(\..+)?$/i,
  /\.env$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.pkcs12$/i,
  /\.keystore$/i,
  /^id_rsa/i,
  /^id_ecdsa/i,
  /^id_ed25519/i,
  /^id_dsa/i,
  /credentials\.json$/i,
  /service-account.*\.json$/i,
  /secret/i,
  /token/i,
  /package-lock\.json$/i,
  /pnpm-lock\.yaml$/i,
  /yarn\.lock$/i
];

const SUPPORTED_TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.markdown', '.rst',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.cpp', '.c', '.h', '.cs', '.rb', '.php',
  '.json', '.yaml', '.yml', '.toml', '.sql', '.html', '.css'
]);

export const MAX_INDEXABLE_FILE_SIZE = 50 * 1024; // 50 KB max per file

/**
 * Checks if a file path is sensitive, ignored, or disallowed for RAG indexing.
 */
export function isSecretOrSensitivePath(filePath: string): { isSensitive: boolean; reason?: string } {
  if (!filePath || typeof filePath !== 'string') return { isSensitive: true, reason: 'Empty path' };
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const basename = normalized.split('/').pop() || '';

  // Check blocked directory
  for (const dir of BLOCKED_DIRECTORIES) {
    if (normalized.startsWith(dir) || normalized.includes(`/${dir}`)) {
      return { isSensitive: true, reason: `Directory in ignore list (${dir})` };
    }
  }

  // Check blocked extensions
  for (const ext of BLOCKED_EXTENSIONS) {
    if (normalized.endsWith(ext)) {
      return { isSensitive: true, reason: `Binary or archive file extension (${ext})` };
    }
  }

  // Check minified code
  if (normalized.endsWith('.min.js') || normalized.endsWith('.min.css')) {
    return { isSensitive: true, reason: 'Minified file' };
  }

  // Check sensitive filename patterns (.env, keys, credentials)
  for (const pattern of SENSITIVE_FILENAME_PATTERNS) {
    if (pattern.test(basename)) {
      return { isSensitive: true, reason: `Sensitive filename pattern detected (${basename})` };
    }
  }

  // Check if extension is supported
  const ext = normalized.slice(normalized.lastIndexOf('.'));
  if (!SUPPORTED_TEXT_EXTENSIONS.has(ext) && !basename.toLowerCase().startsWith('readme')) {
    return { isSensitive: true, reason: `Unsupported file extension for code indexing (${ext})` };
  }

  return { isSensitive: false };
}

/**
 * Inspects file content for leaked secrets, API keys, private keys, or passwords.
 */
export function containsSensitiveContent(content: string): { isSecret: boolean; reason?: string } {
  if (!content || typeof content !== 'string') return { isSecret: false };

  // 1. Private keys
  if (/-----BEGIN\s+([A-Z0-9_\s]+)?PRIVATE\s+KEY-----/i.test(content)) {
    return { isSecret: true, reason: 'Detected Private Key block' };
  }

  // 2. AWS Access Key IDs
  if (/\b(AKIA|ABIA|ACCA)[0-9A-Z]{16}\b/.test(content)) {
    return { isSecret: true, reason: 'Detected AWS Access Key ID' };
  }

  // 3. GitHub Personal Access Tokens
  if (/ghp_[A-Za-z0-9_]{36}/.test(content) || /github_pat_[A-Za-z0-9_]{50,}/.test(content)) {
    return { isSecret: true, reason: 'Detected GitHub Personal Access Token' };
  }

  // 4. JWT tokens
  if (/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(content)) {
    return { isSecret: true, reason: 'Detected JSON Web Token (JWT)' };
  }

  // 5. Hardcoded API secrets / private credentials in assignment
  if (/(["']?)(api[_-]?key|secret[_-]?key|access[_-]?token|private[_-]?key|client[_-]?secret)\1\s*[:=]\s*["'][A-Za-z0-9_\-\.]{16,}["']/i.test(content)) {
    return { isSecret: true, reason: 'Detected hardcoded secret assignment' };
  }

  return { isSecret: false };
}
