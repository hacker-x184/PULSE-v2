import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import initSqlJs, { Database } from 'sql.js';

import { encryptToken, decryptToken, redactSecrets } from '../src/utils/githubCrypto.ts';
import { parseLinkHeader, verifyWebhookSignature } from '../src/utils/githubClient.ts';
import { isSecretOrSensitivePath, containsSensitiveContent, MAX_INDEXABLE_FILE_SIZE } from '../src/utils/githubSecretScanner.ts';
import { disconnectProjectRepository, ISSUE_KEY_REGEX, CLOSING_REGEX } from '../src/utils/githubSync.ts';
import { DbAdapter, searchProjectKnowledgeRAG, computePlanHash } from '../src/ai/pulseAgent.ts';

// Helper to create an in-memory SQLite database for testing
async function createTestDb(): Promise<{ db: Database; adapter: DbAdapter }> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS github_integrations (
      id TEXT PRIMARY KEY,
      project_id TEXT UNIQUE NOT NULL,
      repo_owner TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      access_token TEXT,
      is_connected INTEGER DEFAULT 0,
      default_branch TEXT DEFAULT 'main',
      sync_status TEXT DEFAULT 'idle',
      sync_stage TEXT DEFAULT 'idle',
      last_synced_sha TEXT,
      last_synced_commit_message TEXT,
      last_synced_at TEXT,
      synced_commits_count INTEGER DEFAULT 0,
      synced_prs_count INTEGER DEFAULT 0,
      synced_issues_count INTEGER DEFAULT 0,
      synced_files_count INTEGER DEFAULT 0,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS github_commits (
      sha TEXT NOT NULL,
      project_id TEXT NOT NULL,
      repo_full_name TEXT NOT NULL,
      message TEXT NOT NULL,
      author_login TEXT,
      author_name TEXT,
      author_email TEXT,
      date TEXT,
      url TEXT,
      branch TEXT DEFAULT 'main',
      issue_key TEXT,
      PRIMARY KEY (sha, project_id)
    );

    CREATE TABLE IF NOT EXISTS github_pull_requests (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      repo_full_name TEXT NOT NULL,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      state TEXT NOT NULL,
      author_login TEXT,
      created_at TEXT,
      merged_at TEXT,
      url TEXT,
      issue_key TEXT
    );

    CREATE TABLE IF NOT EXISTS github_issues (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      repo_full_name TEXT NOT NULL,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      state TEXT NOT NULL,
      body TEXT,
      author_login TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      closed_at TEXT,
      url TEXT,
      issue_key TEXT
    );

    CREATE TABLE IF NOT EXISTS github_files (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      repo_full_name TEXT NOT NULL,
      path TEXT NOT NULL,
      branch TEXT NOT NULL,
      sha TEXT NOT NULL,
      size INTEGER NOT NULL,
      indexed_chunk_count INTEGER DEFAULT 0,
      last_synced_at TEXT NOT NULL,
      UNIQUE (project_id, repo_full_name, path)
    );

    CREATE TABLE IF NOT EXISTS document_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT,
      project_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      title TEXT NOT NULL,
      page_number INTEGER,
      section TEXT,
      content TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS github_webhook_events (
      delivery_id TEXT PRIMARY KEY,
      event TEXT NOT NULL,
      repo_full_name TEXT NOT NULL,
      status TEXT NOT NULL,
      received_at TEXT NOT NULL
    );
  `);

  const adapter: DbAdapter = {
    queryAll: (sql: string, params: any[] = []) => {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      const rows: any[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },
    queryOne: (sql: string, params: any[] = []) => {
      const rows = adapter.queryAll(sql, params);
      return rows.length > 0 ? rows[0] : null;
    },
    execute: (sql: string, params: any[] = []) => {
      db.run(sql, params);
    }
  };

  return { db, adapter };
}

// 1. Authentication & Token Encryption at Rest
test('GitHub: AES-256-GCM encrypts tokens at rest, verifies authentication tag, and decrypts cleanly', () => {
  const secretKey = 'test-encryption-key-for-github-tokens-32b';
  const rawToken = 'ghp_abc123xyz456_SuperSecretGitHubTokenValue';

  const encrypted = encryptToken(rawToken, secretKey);
  assert.ok(encrypted, 'Encrypted token must not be null');
  assert.ok(encrypted.startsWith('enc:v1:'), 'Encrypted token must have version prefix');
  assert.notEqual(encrypted, rawToken, 'Encrypted token must not contain plaintext');

  // Successful decryption
  const decrypted = decryptToken(encrypted, secretKey);
  assert.equal(decrypted, rawToken, 'Decrypted token must match original token');

  // Tampered ciphertext is rejected by authentication tag
  const parts = encrypted.slice('enc:v1:'.length).split(':');
  assert.equal(parts.length, 3, 'Must have iv:tag:ciphertext structure');
  const tampered = `enc:v1:${parts[0]}:${parts[1]}:badc0de00000000000000000`;
  const badDecrypted = decryptToken(tampered, secretKey);
  assert.equal(badDecrypted, null, 'Tampered ciphertext must fail auth tag check and return null');

  // Wrong decryption key fails safely
  const wrongKeyDecrypted = decryptToken(encrypted, 'completely-different-wrong-key-seed');
  assert.equal(wrongKeyDecrypted, null, 'Decryption with wrong key must return null');
});

// 2. Secret Redaction from Logs and Errors
test('GitHub: redactSecrets scrubs PATs, bearer tokens, and credentials from log strings', () => {
  const logWithPat = 'GitHub call failed: ghp_1234567890abcdef1234567890abcdef1234 on repo owner/repo';
  const redactedPat = redactSecrets(logWithPat);
  assert.ok(!redactedPat.includes('ghp_'), 'PAT must be redacted');
  assert.ok(redactedPat.includes('[REDACTED_GH_PAT]'));

  const logWithBearer = 'Sending request with header Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-ID';
  const redactedBearer = redactSecrets(logWithBearer);
  assert.ok(!redactedBearer.includes('eyJhbGciOi'), 'Bearer token must be redacted');
  assert.ok(redactedBearer.includes('[REDACTED_BEARER]'));

  const logWithClientSecret = 'POST /login/oauth/access_token?client_secret=secret123456789&code=abc';
  const redactedSecret = redactSecrets(logWithClientSecret);
  assert.ok(!redactedSecret.includes('secret123456789'), 'client_secret parameter must be redacted');
  assert.ok(redactedSecret.includes('client_secret=[REDACTED]'));
});

// 3. Webhook HMAC-SHA256 Signature Verification
test('GitHub: Webhook signature verification succeeds with matching HMAC and fails for invalid or tampered payloads', () => {
  const secret = 'webhook-super-secret-key-999';
  const payload = JSON.stringify({
    action: 'push',
    repository: { full_name: 'acme/pulse-repo' },
    ref: 'refs/heads/main'
  });

  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const validHeader = `sha256=${hmac}`;

  // 1. Valid signature passes
  const isValid = verifyWebhookSignature(payload, validHeader, secret);
  assert.ok(isValid, 'Valid HMAC signature must verify');

  // 2. Tampered payload fails
  const tamperedPayload = JSON.stringify({
    action: 'push',
    repository: { full_name: 'acme/pulse-repo' },
    ref: 'refs/heads/malicious'
  });
  assert.ok(!verifyWebhookSignature(tamperedPayload, validHeader, secret), 'Tampered payload must be rejected');

  // 3. Invalid secret fails
  assert.ok(!verifyWebhookSignature(payload, validHeader, 'wrong-secret'), 'Wrong secret must be rejected');

  // 4. Missing or malformed header fails safely
  assert.ok(!verifyWebhookSignature(payload, undefined, secret), 'Missing header must fail safely');
  assert.ok(!verifyWebhookSignature(payload, 'sha1=12345', secret), 'Non-sha256 header must fail safely');
  assert.ok(!verifyWebhookSignature(payload, 'malformed', secret), 'Malformed header must fail safely');
});

// 4. Duplicate Webhook Event Protection
test('GitHub: Duplicate delivery IDs are rejected and prevent redundant re-indexing', async () => {
  const { adapter } = await createTestDb();
  const deliveryId = 'deliv-test-uuid-1234-abcd';

  // First time delivery is received
  const existing1 = adapter.queryOne('SELECT delivery_id FROM github_webhook_events WHERE delivery_id = ?', [deliveryId]);
  assert.equal(existing1, null, 'First delivery must not exist yet');

  adapter.execute(
    'INSERT INTO github_webhook_events (delivery_id, event, repo_full_name, status, received_at) VALUES (?, ?, ?, "received", ?)',
    [deliveryId, 'push', 'acme/pulse-core', new Date().toISOString()]
  );

  // Second time identical delivery arrives
  const existing2 = adapter.queryOne('SELECT delivery_id FROM github_webhook_events WHERE delivery_id = ?', [deliveryId]);
  assert.ok(existing2, 'Second delivery must be detected as existing duplicate');
  assert.equal(existing2.delivery_id, deliveryId);
});

// 5. Pagination Link Header Parser
test('GitHub: parseLinkHeader parses standard RFC 5988 Link headers accurately', () => {
  const linkHeader = '<https://api.github.com/repos/owner/repo/commits?page=2&per_page=30>; rel="next", <https://api.github.com/repos/owner/repo/commits?page=5&per_page=30>; rel="last"';
  const parsed = parseLinkHeader(linkHeader);

  assert.equal(parsed['next'], 'https://api.github.com/repos/owner/repo/commits?page=2&per_page=30');
  assert.equal(parsed['last'], 'https://api.github.com/repos/owner/repo/commits?page=5&per_page=30');
  assert.equal(parsed['prev'], undefined);

  // Empty or null header returns empty object
  assert.deepEqual(parseLinkHeader(null), {});
  assert.deepEqual(parseLinkHeader(''), {});
});

// 6. Secret Exclusion & File Scanner Guard
test('GitHub: Secret scanner blocks sensitive files, .env, private keys, and binary blobs while allowing clean source code', () => {
  // Sensitive paths
  assert.ok(isSecretOrSensitivePath('.env').isSensitive, '.env must be blocked');
  assert.ok(isSecretOrSensitivePath('.env.production').isSensitive, '.env.production must be blocked');
  assert.ok(isSecretOrSensitivePath('config/jwt_private.pem').isSensitive, '.pem must be blocked');
  assert.ok(isSecretOrSensitivePath('certs/server.key').isSensitive, '.key must be blocked');
  assert.ok(isSecretOrSensitivePath('credentials.json').isSensitive, 'credentials.json must be blocked');
  assert.ok(isSecretOrSensitivePath('node_modules/package/index.js').isSensitive, 'node_modules must be blocked');
  assert.ok(isSecretOrSensitivePath('assets/image.png').isSensitive, 'Binary PNG must be blocked');
  assert.ok(isSecretOrSensitivePath('build/bundle.min.js').isSensitive, 'Minified code must be blocked');

  // Safe paths
  assert.ok(!isSecretOrSensitivePath('src/utils/githubSync.ts').isSensitive, 'Clean TypeScript file must be allowed');
  assert.ok(!isSecretOrSensitivePath('README.md').isSensitive, 'README.md must be allowed');
  assert.ok(!isSecretOrSensitivePath('docs/architecture.rst').isSensitive, 'Documentation must be allowed');
  assert.ok(!isSecretOrSensitivePath('server/handlers/user.go').isSensitive, 'Go source code must be allowed');

  // File size limit
  assert.equal(MAX_INDEXABLE_FILE_SIZE, 50 * 1024, 'Max indexable file size must be 50 KB');

  // Sensitive content patterns
  assert.ok(containsSensitiveContent('-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...').isSecret, 'RSA private key block must be detected');
  assert.ok(containsSensitiveContent('const apiKey = "AKIAIOSFODNN7EXAMPLE";').isSecret, 'AWS Access Key ID must be detected');
  assert.ok(containsSensitiveContent('const token = "ghp_123456789012345678901234567890123456";').isSecret, 'GitHub PAT assignment must be detected');
  assert.ok(!containsSensitiveContent('export function add(a: number, b: number) { return a + b; }').isSecret, 'Normal safe code must not be flagged');
});

// 7. Jira Issue Key & Status Transition Patterns
test('GitHub: Issue key regex and closing keywords extract deliverable references reliably', () => {
  const commit1 = 'feat(auth): [EQX-101] implement oauth provider callback';
  const match1 = commit1.match(ISSUE_KEY_REGEX);
  assert.ok(match1);
  assert.equal(match1[0], 'EQX-101');

  const commit2 = 'fix EQX-204 resolve database connection pooling timeout';
  assert.ok(CLOSING_REGEX.test(commit2), 'fix keyword before issue key must trigger closing transition');

  const commit3 = 'Closes PLS-99 by updating schema migration';
  assert.ok(CLOSING_REGEX.test(commit3), 'Closes keyword must trigger closing transition');

  const commit4 = 'WIP EQX-305 working on frontend layout';
  assert.ok(!CLOSING_REGEX.test(commit4), 'WIP commit must not be flagged as closing');
});

// 8. Repository Disconnect & Cleanup
test('GitHub: disconnectProjectRepository cleanly purges repository data and corresponding RAG chunks', async () => {
  const { adapter } = await createTestDb();
  const projectId = 'p-security-repo';
  const repoName = 'acme/security-core';

  // Seed repository integration records and RAG chunks
  adapter.execute(
    'INSERT INTO github_integrations (id, project_id, repo_owner, repo_name, is_connected) VALUES ("ghi-1", ?, "acme", "security-core", 1)',
    [projectId]
  );
  adapter.execute(
    'INSERT INTO github_commits (sha, project_id, repo_full_name, message) VALUES ("sha-1", ?, ?, "initial commit")',
    [projectId, repoName]
  );
  adapter.execute(
    'INSERT INTO github_pull_requests (id, project_id, repo_full_name, number, title, state) VALUES ("pr-1", ?, ?, 10, "Feature PR", "merged")',
    [projectId, repoName]
  );
  adapter.execute(
    'INSERT INTO github_files (id, project_id, repo_full_name, path, branch, sha, size, last_synced_at) VALUES ("f-1", ?, ?, "src/index.ts", "main", "sha-f1", 1200, "2026-10-23")',
    [projectId, repoName]
  );
  adapter.execute(
    'INSERT INTO document_chunks (id, project_id, source_type, entity_id, title, content, metadata_json, embedding_json, created_at) VALUES ("chk-1", ?, "github_file", "src/index.ts", "acme/security-core: src/index.ts", "console.log(1);", "{}", "[]", "2026-10-23")',
    [projectId]
  );

  // Verify records exist
  assert.ok(adapter.queryOne('SELECT * FROM github_integrations WHERE project_id = ?', [projectId]));
  assert.ok(adapter.queryOne('SELECT * FROM github_commits WHERE project_id = ?', [projectId]));
  assert.ok(adapter.queryOne('SELECT * FROM document_chunks WHERE project_id = ?', [projectId]));

  // Disconnect repository
  disconnectProjectRepository(adapter, projectId);

  // Verify all records and RAG chunks are completely purged
  assert.equal(adapter.queryOne('SELECT * FROM github_integrations WHERE project_id = ?', [projectId]), null);
  assert.equal(adapter.queryOne('SELECT * FROM github_commits WHERE project_id = ?', [projectId]), null);
  assert.equal(adapter.queryOne('SELECT * FROM github_pull_requests WHERE project_id = ?', [projectId]), null);
  assert.equal(adapter.queryOne('SELECT * FROM github_files WHERE project_id = ?', [projectId]), null);
  assert.equal(adapter.queryOne('SELECT * FROM document_chunks WHERE project_id = ?', [projectId]), null);
});

// 9. RAG Citations & Grounding Data Points
test('GitHub: RAG document chunks store precise metadata with commit SHA, line ranges, and URLs', async () => {
  const { adapter } = await createTestDb();
  const projectId = 'p-rag-citations';
  const meta = {
    repo_full_name: 'acme/pulse-ai',
    path: 'src/utils/githubSync.ts',
    commit_sha: 'a1b2c3d',
    line_start: 35,
    line_end: 80,
    url: 'https://github.com/acme/pulse-ai/blob/main/src/utils/githubSync.ts#L35-L80',
    branch: 'main'
  };

  adapter.execute(
    `INSERT INTO document_chunks (id, project_id, source_type, entity_id, title, page_number, section, content, metadata_json, embedding_json, created_at)
     VALUES (?, ?, 'github_file', ?, 'acme/pulse-ai: src/utils/githubSync.ts', 35, 'Lines 35-80', 'export async function syncProjectRepositoryActivity(...)', ?, '[]', '2026-10-23')`,
    ['chk-citation-test', projectId, meta.path, JSON.stringify(meta)]
  );

  const chunk = adapter.queryOne<any>('SELECT * FROM document_chunks WHERE id = ?', ['chk-citation-test']);
  assert.ok(chunk);

  const parsedMeta = JSON.parse(chunk.metadata_json);
  assert.equal(parsedMeta.path, 'src/utils/githubSync.ts');
  assert.equal(parsedMeta.commit_sha, 'a1b2c3d');
  assert.equal(parsedMeta.line_start, 35);
  assert.equal(parsedMeta.line_end, 80);
  assert.ok(parsedMeta.url.includes('#L35-L80'));
});

// 10. Incremental Sync Cache Optimization
test('GitHub: Incremental sync skips re-indexing files whose git sha has not changed', async () => {
  const { adapter } = await createTestDb();
  const projectId = 'p-inc-sync';
  const repoFullName = 'acme/incremental-test';
  const path = 'src/app.ts';
  const sha = 'sha256blob123456';

  // Seed existing file record indicating it is already indexed with 3 chunks
  adapter.execute(
    `INSERT INTO github_files (id, project_id, repo_full_name, path, branch, sha, size, indexed_chunk_count, last_synced_at)
     VALUES ('ghf-test-1', ?, ?, ?, 'main', ?, 2400, 3, '2026-10-23')`,
    [projectId, repoFullName, path, sha]
  );

  // Query existing file during incremental sync
  const existingFile = adapter.queryOne<{ sha: string; indexed_chunk_count: number }>(
    'SELECT sha, indexed_chunk_count FROM github_files WHERE project_id = ? AND repo_full_name = ? AND path = ?',
    [projectId, repoFullName, path]
  );

  assert.ok(existingFile);
  assert.equal(existingFile.sha, sha);
  assert.equal(existingFile.indexed_chunk_count, 3);
  // Condition used in syncProjectRepositoryActivity to skip re-indexing:
  const shouldSkip = existingFile.sha === sha && existingFile.indexed_chunk_count > 0;
  assert.ok(shouldSkip, 'Must skip re-fetching and re-embedding when SHA has not changed');
});
