import { DbAdapter } from '../ai/pulseAgent.ts';
import { callGitHubApi, paginateGitHubApi } from './githubClient.ts';
import { isSecretOrSensitivePath, containsSensitiveContent, MAX_INDEXABLE_FILE_SIZE } from './githubSecretScanner.ts';
import { generateEmbedding } from '../ai/embeddings.ts';
import { redactSecrets } from './githubCrypto.ts';

export interface SyncResult {
  is_connected: boolean;
  repo_name: string;
  default_branch: string;
  commits_count: number;
  prs_count: number;
  issues_count: number;
  indexed_files_count: number;
  indexed_chunks_count: number;
  last_synced_sha: string | null;
  last_synced_commit_message: string | null;
  auto_updated_tasks: Array<{ issue_key: string; old_status: string; new_status: string; reason: string }>;
  error_message: string | null;
}

export const ISSUE_KEY_REGEX = /\b([A-Z]{2,10}-\d+)\b/g;
export const CLOSING_REGEX = /\b(fix|fixes|fixed|close|closes|closed|resolve|resolves|resolved|done|complete|completed)\s+([A-Z]{2,10}-\d+)/i;

/**
 * Executes a full or incremental repository synchronization, persistence, and RAG indexing.
 */
export async function syncProjectRepositoryActivity(
  db: DbAdapter,
  projectId: string,
  repoOwner: string,
  repoName: string,
  token?: string | null,
  options: { isIncremental?: boolean; maxFilesToIndex?: number } = {}
): Promise<SyncResult> {
  let cleanOwner = (repoOwner || '').trim();
  let cleanRepo = (repoName || '').trim();

  // Normalize if full GitHub URL provided
  const combined = `${cleanOwner}/${cleanRepo}`;
  const ghMatch = combined.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (ghMatch) {
    cleanOwner = ghMatch[1];
    cleanRepo = ghMatch[2].replace(/\.git$/, '');
  } else if (cleanOwner.includes('/')) {
    const parts = cleanOwner.split('/').filter(Boolean);
    cleanOwner = parts[0];
    cleanRepo = parts[1].replace(/\.git$/, '');
  }
  cleanRepo = cleanRepo.replace(/\.git$/, '');

  if (!cleanOwner || !cleanRepo) {
    return {
      is_connected: false,
      repo_name: `${cleanOwner}/${cleanRepo}`,
      default_branch: 'main',
      commits_count: 0,
      prs_count: 0,
      issues_count: 0,
      indexed_files_count: 0,
      indexed_chunks_count: 0,
      last_synced_sha: null,
      last_synced_commit_message: null,
      auto_updated_tasks: [],
      error_message: 'Invalid repository owner or repository name provided.'
    };
  }

  const repoFullName = `${cleanOwner}/${cleanRepo}`;
  const now = new Date().toISOString();

  // 1. Initial Integration Record state: Syncing -> metadata
  db.execute(
    `INSERT INTO github_integrations (id, project_id, repo_owner, repo_name, is_connected, sync_status, sync_stage, last_synced_at)
     VALUES (?, ?, ?, ?, 1, 'syncing', 'metadata', ?)
     ON CONFLICT(project_id) DO UPDATE SET
       repo_owner = excluded.repo_owner,
       repo_name = excluded.repo_name,
       is_connected = 1,
       sync_status = 'syncing',
       sync_stage = 'metadata'`,
    [`gh-${Date.now().toString(36)}`, projectId, cleanOwner, cleanRepo, now]
  );

  let defaultBranch = 'main';
  let latestSha: string | null = null;
  let latestCommitMessage: string | null = null;
  let parsedCommits: any[] = [];
  let parsedPRs: any[] = [];
  let parsedIssues: any[] = [];
  let indexedFilesCount = 0;
  let indexedChunksCount = 0;

  try {
    // Stage: metadata
    const repoMetaRes = await callGitHubApi<any>(`/repos/${cleanOwner}/${cleanRepo}`, { token });
    if (repoMetaRes.data) {
      defaultBranch = repoMetaRes.data.default_branch || 'main';
    }

    // Stage: branches
    db.execute('UPDATE github_integrations SET sync_stage = ? WHERE project_id = ?', ['branches', projectId]);
    try {
      await callGitHubApi<any[]>(`/repos/${cleanOwner}/${cleanRepo}/branches`, { token });
    } catch {
      // Non-fatal if branch list cannot be fetched
    }

    // Stage: commits
    db.execute('UPDATE github_integrations SET sync_stage = ? WHERE project_id = ?', ['commits', projectId]);
    let commitsEndpoint = `/repos/${cleanOwner}/${cleanRepo}/commits?per_page=30`;
    if (options.isIncremental) {
      const lastSync = db.queryOne<{ last_synced_at: string }>(
        'SELECT last_synced_at FROM github_integrations WHERE project_id = ?',
        [projectId]
      );
      if (lastSync?.last_synced_at) {
        commitsEndpoint += `&since=${encodeURIComponent(lastSync.last_synced_at)}`;
      }
    }

    const commitsData = await paginateGitHubApi<any>(commitsEndpoint, token, 2, 30);
    const rawCommits = commitsData.items;

    for (const c of rawCommits) {
      const fullSha = c.sha || '';
      const rawSha = fullSha ? fullSha.substring(0, 7) : '';
      const message = (c.commit?.message || '').split('\n')[0];
      const authorLogin = c.author?.login || null;
      const authorName = c.commit?.author?.name || null;
      const authorEmail = c.commit?.author?.email || null;
      const date = c.commit?.author?.date || now;
      const url = c.html_url || `https://github.com/${cleanOwner}/${cleanRepo}/commit/${fullSha}`;
      const branch = defaultBranch;

      let extractedKey: string | null = null;
      const match = message.match(ISSUE_KEY_REGEX);
      if (match && match.length > 0) {
        extractedKey = match[0].toUpperCase();
      }
      const isClosing = CLOSING_REGEX.test(message);

      if (!latestSha && fullSha) {
        latestSha = rawSha;
        latestCommitMessage = message;
      }

      db.execute(
        `INSERT INTO github_commits (sha, project_id, repo_full_name, message, author_login, author_name, author_email, date, url, branch, issue_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(sha, project_id) DO UPDATE SET
           message = excluded.message,
           author_login = excluded.author_login,
           author_name = excluded.author_name,
           author_email = excluded.author_email,
           date = excluded.date,
           url = excluded.url,
           branch = excluded.branch,
           issue_key = excluded.issue_key`,
        [rawSha, projectId, repoFullName, message, authorLogin, authorName, authorEmail, date, url, branch, extractedKey]
      );

      parsedCommits.push({
        sha: rawSha,
        fullSha,
        message,
        author_login: authorLogin,
        author_name: authorName,
        author_email: authorEmail,
        date,
        url,
        branch,
        issue_key: extractedKey,
        isClosing
      });
    }

    // Stage: pull_requests
    db.execute('UPDATE github_integrations SET sync_stage = ? WHERE project_id = ?', ['pull_requests', projectId]);
    const prsData = await paginateGitHubApi<any>(`/repos/${cleanOwner}/${cleanRepo}/pulls?state=all&per_page=30`, token, 2, 30);
    const rawPRs = prsData.items;

    for (const pr of rawPRs) {
      const prId = String(pr.id);
      const prNumber = pr.number;
      const title = pr.title || '';
      const state = pr.state || 'open';
      const authorLogin = pr.user?.login || null;
      const createdAt = pr.created_at || now;
      const mergedAt = pr.merged_at || null;
      const url = pr.html_url || `https://github.com/${cleanOwner}/${cleanRepo}/pull/${prNumber}`;
      const branch = pr.head?.ref || '';
      const body = pr.body || '';

      let extractedKey: string | null = null;
      const combinedText = `${title} ${body} ${branch}`;
      const match = combinedText.match(ISSUE_KEY_REGEX);
      if (match && match.length > 0) {
        extractedKey = match[0].toUpperCase();
      }

      // Check PR reviews for approval status
      let reviewState: string | null = null;
      try {
        const revRes = await callGitHubApi<any[]>(`/repos/${cleanOwner}/${cleanRepo}/pulls/${prNumber}/reviews`, { token });
        if (revRes.data && Array.isArray(revRes.data) && revRes.data.length > 0) {
          if (revRes.data.some((r: any) => r.state === 'APPROVED')) reviewState = 'APPROVED';
          else if (revRes.data.some((r: any) => r.state === 'CHANGES_REQUESTED')) reviewState = 'CHANGES_REQUESTED';
          else reviewState = 'COMMENTED';
        }
      } catch {}

      db.execute(
        `INSERT INTO github_pull_requests (id, project_id, repo_full_name, number, title, state, author_login, created_at, merged_at, url, issue_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           state = excluded.state,
           author_login = excluded.author_login,
           merged_at = excluded.merged_at,
           url = excluded.url,
           issue_key = excluded.issue_key`,
        [prId, projectId, repoFullName, prNumber, title, state, authorLogin, createdAt, mergedAt, url, extractedKey]
      );

      parsedPRs.push({
        id: prId,
        number: prNumber,
        title,
        state,
        author_login: authorLogin,
        created_at: createdAt,
        merged_at: mergedAt,
        url,
        issue_key: extractedKey,
        review_state: reviewState
      });
    }

    // Stage: issues
    db.execute('UPDATE github_integrations SET sync_stage = ? WHERE project_id = ?', ['issues', projectId]);
    try {
      const issuesData = await paginateGitHubApi<any>(`/repos/${cleanOwner}/${cleanRepo}/issues?state=all&per_page=30`, token, 2, 30);
      const rawIssues = issuesData.items.filter((i: any) => !i.pull_request); // Filter out PRs returned by issues endpoint

      for (const issue of rawIssues) {
        const issueId = String(issue.id);
        const issueNum = issue.number;
        const title = issue.title || '';
        const state = issue.state || 'open';
        const body = (issue.body || '').slice(0, 4000);
        const authorLogin = issue.user?.login || null;
        const createdAt = issue.created_at || now;
        const updatedAt = issue.updated_at || now;
        const closedAt = issue.closed_at || null;
        const url = issue.html_url || `https://github.com/${cleanOwner}/${cleanRepo}/issues/${issueNum}`;

        let extractedKey: string | null = null;
        const match = `${title} ${body}`.match(ISSUE_KEY_REGEX);
        if (match && match.length > 0) extractedKey = match[0].toUpperCase();

        db.execute(
          `INSERT INTO github_issues (id, project_id, repo_full_name, number, title, state, body, author_login, created_at, updated_at, closed_at, url, issue_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title,
             state = excluded.state,
             body = excluded.body,
             updated_at = excluded.updated_at,
             closed_at = excluded.closed_at,
             url = excluded.url,
             issue_key = excluded.issue_key`,
          [issueId, projectId, repoFullName, issueNum, title, state, body, authorLogin, createdAt, updatedAt, closedAt, url, extractedKey]
        );

        parsedIssues.push({ id: issueId, number: issueNum, title, state, url, issue_key: extractedKey });
      }
    } catch {
      // Non-fatal if issues permission unavailable
    }

    // Stage: file_tree & RAG indexing
    db.execute('UPDATE github_integrations SET sync_stage = ? WHERE project_id = ?', ['tree', projectId]);
    const maxFiles = options.maxFilesToIndex || 20;

    let treeRes: any = null;
    try {
      treeRes = await callGitHubApi<any>(`/repos/${cleanOwner}/${cleanRepo}/git/trees/${defaultBranch}?recursive=1`, { token });
    } catch {
      // Non-fatal if recursive tree fails, try root contents
    }

    const eligibleFiles: Array<{ path: string; sha: string; size: number }> = [];

    if (treeRes?.data?.tree && Array.isArray(treeRes.data.tree)) {
      for (const item of treeRes.data.tree) {
        if (item.type !== 'blob') continue;
        if (item.size && item.size > MAX_INDEXABLE_FILE_SIZE) continue;

        const pathCheck = isSecretOrSensitivePath(item.path);
        if (pathCheck.isSensitive) continue;

        eligibleFiles.push({
          path: item.path,
          sha: item.sha,
          size: item.size || 0
        });
      }
    }

    // Prioritize README, documentation, and core project files
    eligibleFiles.sort((a, b) => {
      const aLower = a.path.toLowerCase();
      const bLower = b.path.toLowerCase();
      if (aLower.includes('readme')) return -1;
      if (bLower.includes('readme')) return 1;
      return a.path.localeCompare(b.path);
    });

    const filesToIndex = eligibleFiles.slice(0, maxFiles);

    // Stage: rag_indexing
    db.execute('UPDATE github_integrations SET sync_stage = ? WHERE project_id = ?', ['rag_indexing', projectId]);

    for (const f of filesToIndex) {
      try {
        // Incremental optimization: if file sha is unchanged, skip re-downloading and re-embedding
        if (options.isIncremental) {
          const existingFile = db.queryOne<{ sha: string; indexed_chunk_count: number }>(
            'SELECT sha, indexed_chunk_count FROM github_files WHERE project_id = ? AND repo_full_name = ? AND path = ?',
            [projectId, repoFullName, f.path]
          );
          if (existingFile && existingFile.sha === f.sha && existingFile.indexed_chunk_count > 0) {
            indexedFilesCount++;
            indexedChunksCount += existingFile.indexed_chunk_count;
            continue;
          }
        }

        const fileContentRes = await callGitHubApi<any>(
          `/repos/${cleanOwner}/${cleanRepo}/contents/${encodeURIComponent(f.path)}?ref=${defaultBranch}`,
          { token }
        );

        if (!fileContentRes.data?.content) continue;

        const rawContent = Buffer.from(fileContentRes.data.content, 'base64').toString('utf8');
        const contentCheck = containsSensitiveContent(rawContent);
        if (contentCheck.isSecret) continue;

        // Persist to github_files
        const fileId = `ghf-${projectId}-${f.sha.slice(0, 10)}`;
        db.execute(
          `INSERT INTO github_files (id, project_id, repo_full_name, path, branch, sha, size, indexed_chunk_count, last_synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
           ON CONFLICT(project_id, repo_full_name, path) DO UPDATE SET
             sha = excluded.sha,
             size = excluded.size,
             last_synced_at = excluded.last_synced_at`,
          [fileId, projectId, repoFullName, f.path, defaultBranch, f.sha, f.size, now]
        );

        // Delete previous RAG chunks for this file
        db.execute(
          'DELETE FROM document_chunks WHERE project_id = ? AND entity_id = ?',
          [projectId, f.path]
        );

        // Chunk file into manageable blocks of ~50 lines
        const lines = rawContent.split('\n');
        const chunkSize = 50;
        const overlap = 10;
        let chunkIndex = 0;

        for (let i = 0; i < lines.length; i += (chunkSize - overlap)) {
          const sliceLines = lines.slice(i, i + chunkSize);
          const chunkText = sliceLines.join('\n');
          if (!chunkText.trim()) continue;

          const lineStart = i + 1;
          const lineEnd = Math.min(i + chunkSize, lines.length);
          const chunkId = `chk-gh-${projectId}-${f.sha.slice(0, 7)}-${chunkIndex}`;
          const isReadme = f.path.toLowerCase().includes('readme');
          const sourceType = isReadme ? 'github_readme' : 'github_file';
          const fileUrl = `https://github.com/${cleanOwner}/${cleanRepo}/blob/${defaultBranch}/${f.path}#L${lineStart}-L${lineEnd}`;

          const embedding = await generateEmbedding(chunkText);
          if (!embedding) continue; // Real embedding requirement

          const metaJson = JSON.stringify({
            repo_full_name: repoFullName,
            path: f.path,
            commit_sha: f.sha.slice(0, 7),
            line_start: lineStart,
            line_end: lineEnd,
            url: fileUrl,
            branch: defaultBranch
          });

          db.execute(
            `INSERT INTO document_chunks (id, document_id, project_id, source_type, entity_id, title, page_number, section, content, metadata_json, embedding_json, created_at)
             VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              chunkId,
              projectId,
              sourceType,
              f.path,
              `${repoFullName}: ${f.path}`,
              lineStart,
              `Lines ${lineStart}-${lineEnd}`,
              chunkText,
              metaJson,
              JSON.stringify(embedding),
              now
            ]
          );

          chunkIndex++;
          indexedChunksCount++;
        }

        db.execute('UPDATE github_files SET indexed_chunk_count = ? WHERE id = ?', [chunkIndex, fileId]);
        indexedFilesCount++;
      } catch {
        // Continue indexing next file on individual file failure
      }
    }

  } catch (err: any) {
    const errorMsg = redactSecrets(err.message || 'Synchronization failed');
    db.execute(
      `UPDATE github_integrations SET
         sync_status = 'failed',
         sync_stage = 'idle',
         error_message = ?
       WHERE project_id = ?`,
      [errorMsg, projectId]
    );

    return {
      is_connected: true,
      repo_name: repoFullName,
      default_branch: defaultBranch,
      commits_count: parsedCommits.length,
      prs_count: parsedPRs.length,
      issues_count: parsedIssues.length,
      indexed_files_count: indexedFilesCount,
      indexed_chunks_count: indexedChunksCount,
      last_synced_sha: latestSha,
      last_synced_commit_message: latestCommitMessage,
      auto_updated_tasks: [],
      error_message: errorMsg
    };
  }

  // Auto-update deliverable tasks based on real commits and PRs
  const autoUpdatedTasks: Array<{ issue_key: string; old_status: string; new_status: string; reason: string }> = [];
  const projectTasks = db.queryAll<{ id: string; issue_key: string; status: string }>(
    'SELECT id, issue_key, status FROM tasks WHERE project_id = ?',
    [projectId]
  );

  for (const t of projectTasks) {
    if (!t.issue_key) continue;
    const key = t.issue_key.toUpperCase();

    // Rule 1: Closing commit or merged PR -> Done
    const closingCommit = parsedCommits.find(c => c.issue_key === key && c.isClosing);
    const mergedPR = parsedPRs.find(p => p.issue_key === key && p.merged_at !== null);

    if (closingCommit || mergedPR) {
      if (t.status !== 'Done') {
        const reason = closingCommit
          ? `Closed by commit ${closingCommit.sha}: "${closingCommit.message}"`
          : `Closed by merged pull request #${mergedPR?.number}: "${mergedPR?.title}"`;
        db.execute('UPDATE tasks SET status = "Done", updated_at = ? WHERE id = ?', [now, t.id]);
        autoUpdatedTasks.push({ issue_key: t.issue_key, old_status: t.status, new_status: 'Done', reason });
      }
      continue;
    }

    // Rule 2: Open PR -> In Review
    const openPR = parsedPRs.find(p => p.issue_key === key && p.state === 'open');
    if (openPR) {
      if (t.status === 'To Do' || t.status === 'In Progress') {
        const reason = `Moved to In Review by open pull request #${openPR.number}: "${openPR.title}"`;
        db.execute('UPDATE tasks SET status = "In Review", updated_at = ? WHERE id = ?', [now, t.id]);
        autoUpdatedTasks.push({ issue_key: t.issue_key, old_status: t.status, new_status: 'In Review', reason });
      }
      continue;
    }

    // Rule 3: Active commit -> In Progress
    const activeCommit = parsedCommits.find(c => c.issue_key === key);
    if (activeCommit) {
      if (t.status === 'To Do') {
        const reason = `Moved to In Progress by active commit ${activeCommit.sha}: "${activeCommit.message}"`;
        db.execute('UPDATE tasks SET status = "In Progress", updated_at = ? WHERE id = ?', [now, t.id]);
        autoUpdatedTasks.push({ issue_key: t.issue_key, old_status: t.status, new_status: 'In Progress', reason });
      }
      continue;
    }
  }

  // Update integration record on success
  db.execute(
    `UPDATE github_integrations SET
       is_connected = 1,
       sync_status = 'completed',
       sync_stage = 'idle',
       default_branch = ?,
       last_synced_sha = COALESCE(?, last_synced_sha),
       last_synced_commit_message = COALESCE(?, last_synced_commit_message),
       last_synced_at = ?,
       synced_commits_count = ?,
       synced_prs_count = ?,
       synced_issues_count = ?,
       synced_files_count = ?,
       error_message = NULL
     WHERE project_id = ?`,
    [
      defaultBranch,
      latestSha,
      latestCommitMessage,
      now,
      parsedCommits.length,
      parsedPRs.length,
      parsedIssues.length,
      indexedFilesCount,
      projectId
    ]
  );

  return {
    is_connected: true,
    repo_name: repoFullName,
    default_branch: defaultBranch,
    commits_count: parsedCommits.length,
    prs_count: parsedPRs.length,
    issues_count: parsedIssues.length,
    indexed_files_count: indexedFilesCount,
    indexed_chunks_count: indexedChunksCount,
    last_synced_sha: latestSha,
    last_synced_commit_message: latestCommitMessage,
    auto_updated_tasks: autoUpdatedTasks,
    error_message: null
  };
}

/**
 * Disconnects a repository from a project and securely purges all cached data and RAG chunks.
 */
export function disconnectProjectRepository(db: DbAdapter, projectId: string): void {
  db.execute('DELETE FROM github_integrations WHERE project_id = ?', [projectId]);
  db.execute('DELETE FROM github_commits WHERE project_id = ?', [projectId]);
  db.execute('DELETE FROM github_pull_requests WHERE project_id = ?', [projectId]);
  db.execute('DELETE FROM github_issues WHERE project_id = ?', [projectId]);
  db.execute('DELETE FROM github_files WHERE project_id = ?', [projectId]);
  db.execute(
    "DELETE FROM document_chunks WHERE project_id = ? AND (source_type LIKE 'github_%' OR source_type = 'github_readme' OR source_type = 'github_file')",
    [projectId]
  );
}
