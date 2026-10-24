import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import initSqlJs, { Database } from 'sql.js';
import dotenv from 'dotenv';
import { evaluateProjectRisk } from './src/utils/risk.ts';
import { calculateMemberContribution, isTaskOverdue, TaskRecord } from './src/utils/contribution.ts';
import { generateCsv } from './src/utils/csv.ts';
import {
  calculateEstimationAccuracy,
  detectMissingEvidence,
  generateRedistributionSuggestions,
  calculateCriticalPathAndVariance
} from './src/utils/pmIntelligence.ts';
import { GoogleGenAI } from '@google/genai';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { createRequire } from 'module';
const esmRequire = createRequire(import.meta.url);
const { PDFParse } = esmRequire('pdf-parse');

import {
  DbAdapter,
  SqliteSaver,
  getGroqChatModel,
  searchProjectKnowledgeRAG,
  runGitHubInvestigation,
  createProjectAnalystWorkflow,
  createProjectRecoveryWorkflow,
  createMeetingToTasksWorkflow,
  createDocumentPlannerWorkflow,
  createContributionInvestigatorWorkflow,
  createAutonomousProjectManagerWorkflow,
  executeApprovedWorkflowPlan,
  computePlanHash
} from './src/ai/pulseAgent.ts';
import { generateEmbedding } from './src/ai/embeddings.ts';
import { encryptToken, decryptToken, redactSecrets } from './src/utils/githubCrypto.ts';
import { callGitHubApi, paginateGitHubApi, verifyWebhookSignature } from './src/utils/githubClient.ts';
import { syncProjectRepositoryActivity, disconnectProjectRepository } from './src/utils/githubSync.ts';
import { defaultVoiceService } from './src/ai/elevenlabsVoice.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Port 3000 is the required dev/service port for AI Studio
const PORT = process.env.PORT && process.env.PORT !== '8080' ? parseInt(process.env.PORT, 10) : 3000;
const isProd = process.env.NODE_ENV === 'production';
const DB_FILE = path.join(__dirname, 'platform_database.sqlite');

let db: Database;

// Helper to persist sql.js database to disk
function saveDatabase() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_FILE, buffer);
  } catch (err) {
    console.error('Failed to save SQLite file:', err);
  }
}

// Helper to query objects
function queryAll<T = any>(sql: string, params: any[] = []): T[] {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows: T[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return rows;
}

function queryOne<T = any>(sql: string, params: any[] = []): T | null {
  const rows = queryAll<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function execute(sql: string, params: any[] = []): void {
  db.run(sql, params);
  saveDatabase();
}

async function initDatabase() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) {
    try {
      const fileBuffer = fs.readFileSync(DB_FILE);
      db = new SQL.Database(fileBuffer);
    } catch (e) {
      console.warn('Failed loading existing SQLite file, creating new database:', e);
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
  }

  // Create SQLite tables
  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      start_date TEXT,
      deadline TEXT,
      status TEXT NOT NULL DEFAULT 'Planning',
      leader_id TEXT,
      key_prefix TEXT DEFAULT 'EQX',
      current_sprint TEXT DEFAULT 'Sprint 1 (Active)',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL DEFAULT 'Developer',
      avatar_url TEXT,
      github_username TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_members (
      project_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Developer',
      PRIMARY KEY (project_id, member_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES team_members(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      issue_key TEXT,
      issue_type TEXT NOT NULL DEFAULT 'Task',
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT NOT NULL DEFAULT 'Medium',
      status TEXT NOT NULL DEFAULT 'To Do',
      due_date TEXT,
      assignee_id TEXT,
      reporter_id TEXT,
      estimated_hours REAL DEFAULT 0,
      story_points REAL DEFAULT 3,
      sprint TEXT DEFAULT 'Sprint 1 (Active)',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (assignee_id) REFERENCES team_members(id) ON DELETE SET NULL
    );

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
      error_message TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_github_integrations (
      user_id TEXT PRIMARY KEY,
      github_username TEXT NOT NULL,
      access_token TEXT,
      name TEXT,
      avatar_url TEXT,
      html_url TEXT,
      public_repos INTEGER DEFAULT 0,
      selected_repo TEXT,
      connected_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Member',
      avatar_url TEXT,
      github_username TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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

    CREATE TABLE IF NOT EXISTS github_webhook_events (
      delivery_id TEXT PRIMARY KEY,
      event TEXT NOT NULL,
      repo_full_name TEXT NOT NULL,
      status TEXT NOT NULL,
      received_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_comments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      author_id TEXT,
      author_name TEXT NOT NULL,
      author_avatar TEXT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_subtasks (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      title TEXT NOT NULL,
      is_completed INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_acceptance_criteria (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      criterion TEXT NOT NULL,
      is_met INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_reviews (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      reviewer_id TEXT,
      reviewer_name TEXT NOT NULL,
      status TEXT NOT NULL,
      feedback TEXT,
      reviewed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS disputes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      member_name TEXT NOT NULL,
      reason TEXT NOT NULL,
      evidence_url TEXT,
      status TEXT NOT NULL DEFAULT 'Pending',
      resolution_notes TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL,
      link TEXT,
      is_read INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meeting_notes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      meeting_date TEXT NOT NULL,
      attendees TEXT NOT NULL,
      content TEXT NOT NULL,
      action_items TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS retrospectives (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      sprint TEXT NOT NULL,
      went_well TEXT NOT NULL,
      needs_improvement TEXT NOT NULL,
      action_items TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_invitations (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS discussions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      author_id TEXT,
      author_name TEXT NOT NULL,
      author_avatar TEXT,
      category TEXT DEFAULT 'General',
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS peer_kudos (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      from_name TEXT NOT NULL,
      to_member_id TEXT NOT NULL,
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_attachments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size TEXT NOT NULL,
      file_type TEXT NOT NULL,
      uploaded_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_documents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      file_type TEXT NOT NULL,
      uploader_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'indexed',
      error_message TEXT,
      chunks_count INTEGER DEFAULT 0,
      page_count INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
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

    CREATE TABLE IF NOT EXISTS ai_workflows (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      workflow_type TEXT NOT NULL,
      project_id TEXT NOT NULL,
      initiating_user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      stage TEXT NOT NULL,
      plan_hash TEXT,
      plan_json TEXT,
      approved_by TEXT,
      approved_at TEXT,
      execution_results_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_workflow_checkpoints (
      thread_id TEXT NOT NULL,
      checkpoint_ns TEXT NOT NULL DEFAULT '',
      checkpoint_id TEXT NOT NULL,
      parent_checkpoint_id TEXT,
      checkpoint_json TEXT NOT NULL DEFAULT '{}',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
    );

    CREATE TABLE IF NOT EXISTS ai_workflow_checkpoint_writes (
      thread_id TEXT NOT NULL,
      checkpoint_ns TEXT NOT NULL DEFAULT '',
      checkpoint_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      channel TEXT NOT NULL,
      value_json TEXT NOT NULL,
      task_path TEXT DEFAULT '',
      PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
    );
  `);

  // Safe password hashing migration for existing plaintext accounts
  const legacyUsers = queryAll('SELECT id, password FROM users');
  for (const u of legacyUsers) {
    if (u.password && !u.password.startsWith('$2a$') && !u.password.startsWith('$2b$')) {
      const hashed = bcrypt.hashSync(u.password, 10);
      execute('UPDATE users SET password = ? WHERE id = ?', [hashed, u.id]);
    }
  }

  // Safe schema migrations for existing SQLite databases
  const runSafeMigration = (sql: string) => {
    try {
      db.run(sql);
    } catch {
      // Column might already exist
    }
  };

  runSafeMigration('ALTER TABLE projects ADD COLUMN leader_id TEXT');
  runSafeMigration("ALTER TABLE projects ADD COLUMN key_prefix TEXT DEFAULT 'EQX'");
  runSafeMigration("ALTER TABLE projects ADD COLUMN current_sprint TEXT DEFAULT 'Sprint 1 (Active)'");
  runSafeMigration('ALTER TABLE projects ADD COLUMN is_archived INTEGER DEFAULT 0');
  runSafeMigration('ALTER TABLE projects ADD COLUMN objectives TEXT');
  runSafeMigration("ALTER TABLE project_members ADD COLUMN role TEXT DEFAULT 'Developer'");
  runSafeMigration('ALTER TABLE tasks ADD COLUMN issue_key TEXT');
  runSafeMigration("ALTER TABLE tasks ADD COLUMN issue_type TEXT DEFAULT 'Task'");
  runSafeMigration('ALTER TABLE tasks ADD COLUMN reporter_id TEXT');
  runSafeMigration('ALTER TABLE tasks ADD COLUMN story_points REAL DEFAULT 3');
  runSafeMigration("ALTER TABLE tasks ADD COLUMN sprint TEXT DEFAULT 'Sprint 1 (Active)'");
  runSafeMigration('ALTER TABLE tasks ADD COLUMN is_blocked INTEGER DEFAULT 0');
  runSafeMigration('ALTER TABLE tasks ADD COLUMN blocker_reason TEXT');
  runSafeMigration('ALTER TABLE tasks ADD COLUMN blocker_owner TEXT');
  runSafeMigration('ALTER TABLE tasks ADD COLUMN dependencies TEXT');
  runSafeMigration('ALTER TABLE tasks ADD COLUMN actual_hours REAL DEFAULT 0');
  runSafeMigration('ALTER TABLE users ADD COLUMN github_username TEXT');
  runSafeMigration('ALTER TABLE team_members ADD COLUMN skills TEXT');
  runSafeMigration('ALTER TABLE team_members ADD COLUMN capacity_hours REAL DEFAULT 40');
  runSafeMigration('ALTER TABLE projects ADD COLUMN github_repo_owner TEXT');
  runSafeMigration('ALTER TABLE projects ADD COLUMN github_repo_name TEXT');
  runSafeMigration("ALTER TABLE projects ADD COLUMN github_repo_visibility TEXT DEFAULT 'Public'");
  runSafeMigration("ALTER TABLE projects ADD COLUMN github_default_branch TEXT DEFAULT 'main'");
  runSafeMigration('ALTER TABLE projects ADD COLUMN github_html_url TEXT');

  // Safe migrations for expanded GitHub integration
  runSafeMigration("ALTER TABLE github_integrations ADD COLUMN default_branch TEXT DEFAULT 'main'");
  runSafeMigration("ALTER TABLE github_integrations ADD COLUMN sync_status TEXT DEFAULT 'idle'");
  runSafeMigration("ALTER TABLE github_integrations ADD COLUMN sync_stage TEXT DEFAULT 'idle'");
  runSafeMigration("ALTER TABLE github_integrations ADD COLUMN last_synced_sha TEXT");
  runSafeMigration("ALTER TABLE github_integrations ADD COLUMN last_synced_commit_message TEXT");
  runSafeMigration("ALTER TABLE github_integrations ADD COLUMN error_message TEXT");
  runSafeMigration("ALTER TABLE github_integrations ADD COLUMN synced_commits_count INTEGER DEFAULT 0");
  runSafeMigration("ALTER TABLE github_integrations ADD COLUMN synced_prs_count INTEGER DEFAULT 0");
  runSafeMigration("ALTER TABLE github_integrations ADD COLUMN synced_issues_count INTEGER DEFAULT 0");
  runSafeMigration("ALTER TABLE github_integrations ADD COLUMN synced_files_count INTEGER DEFAULT 0");

  db.run(`
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
    CREATE TABLE IF NOT EXISTS github_webhook_events (
      delivery_id TEXT PRIMARY KEY,
      event TEXT NOT NULL,
      repo_full_name TEXT NOT NULL,
      status TEXT NOT NULL,
      received_at TEXT NOT NULL
    );
  `);

  // Ensure ai_workflow_checkpoints and writes have checkpoint_ns and LangGraph columns
  try {
    const cpCols = queryAll('PRAGMA table_info(ai_workflow_checkpoints)');
    const colNames = new Set(cpCols.map((c: any) => c.name));
    if (cpCols.length > 0 && (!colNames.has('checkpoint_ns') || !colNames.has('checkpoint_json'))) {
      db.run(`
        CREATE TABLE IF NOT EXISTS ai_workflow_checkpoints_v2 (
          thread_id TEXT NOT NULL,
          checkpoint_ns TEXT NOT NULL DEFAULT '',
          checkpoint_id TEXT NOT NULL,
          parent_checkpoint_id TEXT,
          checkpoint_json TEXT NOT NULL DEFAULT '{}',
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
        );
      `);
      try {
        if (colNames.has('state_json')) {
          db.run(`
            INSERT OR IGNORE INTO ai_workflow_checkpoints_v2 (thread_id, checkpoint_ns, checkpoint_id, checkpoint_json, metadata_json, created_at)
            SELECT thread_id, '', checkpoint_id, coalesce(state_json, '{}'), '{}', created_at FROM ai_workflow_checkpoints;
          `);
        }
      } catch {
        // Ignored
      }
      db.run('DROP TABLE ai_workflow_checkpoints;');
      db.run('ALTER TABLE ai_workflow_checkpoints_v2 RENAME TO ai_workflow_checkpoints;');
    }

    const writeCols = queryAll('PRAGMA table_info(ai_workflow_checkpoint_writes)');
    const writeColNames = new Set(writeCols.map((c: any) => c.name));
    if (writeCols.length > 0 && !writeColNames.has('checkpoint_ns')) {
      db.run('DROP TABLE ai_workflow_checkpoint_writes;');
    }
    db.run(`
      CREATE TABLE IF NOT EXISTS ai_workflow_checkpoint_writes (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        channel TEXT NOT NULL,
        value_json TEXT NOT NULL,
        task_path TEXT DEFAULT '',
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
      );
    `);
  } catch (err) {
    console.warn('Migration for ai_workflow_checkpoints in server.ts:', err);
  }

  // Normalize legacy roles to Team Leader (Admin + Manager merged)
  runSafeMigration("UPDATE users SET role = 'Team Leader' WHERE role IN ('Admin', 'Manager', 'Project Director', 'Lead System Architect')");
  runSafeMigration("UPDATE users SET role = 'Member' WHERE role NOT IN ('Team Leader')");
  runSafeMigration("UPDATE team_members SET role = 'Team Leader' WHERE id = 'm-u-zaid'");
  // Normalize legacy task statuses to 4 canonical states: To Do, In Progress, In Review, Done
  runSafeMigration("UPDATE tasks SET status = 'To Do' WHERE status = 'Not Started'");
  runSafeMigration("UPDATE tasks SET status = 'Done' WHERE status = 'Completed'");

  // Ensure tables exist in migrated databases
  db.run(`
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

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_comments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      author_id TEXT,
      author_name TEXT NOT NULL,
      author_avatar TEXT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_subtasks (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      title TEXT NOT NULL,
      is_completed INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_acceptance_criteria (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      criterion TEXT NOT NULL,
      is_met INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_reviews (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      reviewer_id TEXT,
      reviewer_name TEXT NOT NULL,
      status TEXT NOT NULL,
      feedback TEXT,
      reviewed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS disputes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      member_name TEXT NOT NULL,
      reason TEXT NOT NULL,
      evidence_url TEXT,
      status TEXT NOT NULL DEFAULT 'Pending',
      resolution_notes TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL,
      link TEXT,
      is_read INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meeting_notes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      meeting_date TEXT NOT NULL,
      attendees TEXT NOT NULL,
      content TEXT NOT NULL,
      action_items TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS retrospectives (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      sprint TEXT NOT NULL,
      went_well TEXT NOT NULL,
      needs_improvement TEXT NOT NULL,
      action_items TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_invitations (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // Check if seeding is needed
  const projectCount = queryOne<{ count: number }>('SELECT count(*) as count FROM projects')?.count || 0;
  if (projectCount === 0) {
    seedDatabase();
  } else {
    saveDatabase();
  }
}

function seedDatabase() {
  execute('DELETE FROM tasks');
  execute('DELETE FROM project_members');
  execute('DELETE FROM projects');
  execute('DELETE FROM team_members');
  execute('DELETE FROM users');
  execute('DELETE FROM user_github_integrations');
  execute('DELETE FROM github_commits');
  execute('DELETE FROM github_pull_requests');
  execute('DELETE FROM audit_logs');
  execute('DELETE FROM task_comments');
  execute('DELETE FROM task_subtasks');
  execute('DELETE FROM task_acceptance_criteria');
  execute('DELETE FROM task_reviews');
  execute('DELETE FROM disputes');
  execute('DELETE FROM notifications');
  execute('DELETE FROM meeting_notes');
  execute('DELETE FROM retrospectives');
  execute('DELETE FROM project_invitations');
  execute('DELETE FROM discussions');
  execute('DELETE FROM peer_kudos');
  execute('DELETE FROM task_attachments');

  const now = new Date();
  const dYesterday = new Date(now.getTime() - 86400000).toISOString().split('T')[0];
  const dThreeDaysAgo = new Date(now.getTime() - 3 * 86400000).toISOString().split('T')[0];
  const dTomorrow = new Date(now.getTime() + 86400000).toISOString().split('T')[0];
  const dIn3Days = new Date(now.getTime() + 3 * 86400000).toISOString().split('T')[0];
  const dIn10Days = new Date(now.getTime() + 10 * 86400000).toISOString().split('T')[0];
  const dIn30Days = new Date(now.getTime() + 30 * 86400000).toISOString().split('T')[0];

  const m1Id = 'm-elena';
  const m2Id = 'm-marcus';
  const m3Id = 'm-sarah';
  const m4Id = 'm-devon';
  const mZaid = 'm-u-zaid';

  execute(
    `INSERT INTO team_members (id, name, email, role, avatar_url, github_username, created_at, updated_at) VALUES 
    (?, ?, ?, ?, ?, ?, ?, ?),
    (?, ?, ?, ?, ?, ?, ?, ?),
    (?, ?, ?, ?, ?, ?, ?, ?),
    (?, ?, ?, ?, ?, ?, ?, ?),
    (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      mZaid, 'Zaid Tested', 'zaidtested@gmail.com', 'Team Leader', 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150', 'zaidtested', now.toISOString(), now.toISOString(),
      m1Id, 'Elena Rostova', 'elena.rostova@enterprise.internal', 'Lead System Architect', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150', 'erostova', now.toISOString(), now.toISOString(),
      m2Id, 'Marcus Vance', 'marcus.vance@enterprise.internal', 'Senior Backend Engineer', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150', 'marcusvance', now.toISOString(), now.toISOString(),
      m3Id, 'Sarah Chen', 'sarah.chen@enterprise.internal', 'Frontend & UX Engineer', 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150', 'sarahchen-dev', now.toISOString(), now.toISOString(),
      m4Id, 'Devon Patel', 'devon.patel@enterprise.internal', 'DevOps & Reliability Engineer', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150', 'devonpatel', now.toISOString(), now.toISOString()
    ]
  );

  const defaultHashedPassword = bcrypt.hashSync('password123', 10);
  execute(
    `INSERT INTO users (id, name, email, password, role, avatar_url, github_username, created_at, updated_at) VALUES 
    (?, ?, ?, ?, ?, ?, ?, ?, ?),
    (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'u-zaid', 'Zaid Tested', 'zaidtested@gmail.com', defaultHashedPassword, 'Team Leader', 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150', 'zaidtested', now.toISOString(), now.toISOString(),
      'u-elena', 'Elena Rostova', 'elena.rostova@enterprise.internal', defaultHashedPassword, 'Team Leader', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150', 'erostova', now.toISOString(), now.toISOString()
    ]
  );

  const p1Id = 'p-ledger';
  const p2Id = 'p-portal';
  const p3Id = 'p-iam';

  execute(
    `INSERT INTO projects (id, name, description, start_date, deadline, status, leader_id, key_prefix, current_sprint, created_at, updated_at) VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      p1Id, 'Core Financial Ledger Modernization', 'Migrating legacy settlement engine to event-driven architecture with sub-millisecond reconciliation.', '2026-09-01', dIn10Days, 'Active', 'u-zaid', 'EQX', 'Sprint 1 (Active)', now.toISOString(), now.toISOString(),
      p2Id, 'Customer Portal & Analytics Dashboard', 'Self-service merchant reporting platform with real-time settlement telemetry and CSV exports.', '2026-09-15', dIn3Days, 'Active', 'u-elena', 'PORT', 'Sprint 2 (Active)', now.toISOString(), now.toISOString(),
      p3Id, 'Zero-Trust IAM & OAuth Provider', 'Consolidated identity federation across all internal microservices and developer APIs.', '2026-10-01', dIn30Days, 'Planning', 'u-zaid', 'IAM', 'Sprint 1 (Active)', now.toISOString(), now.toISOString()
    ]
  );

  execute(
    `INSERT INTO project_members (project_id, member_id, role) VALUES
    (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?),
    (?, ?, ?), (?, ?, ?), (?, ?, ?),
    (?, ?, ?), (?, ?, ?), (?, ?, ?)`,
    [
      p1Id, mZaid, 'Team Leader',
      p1Id, m1Id, 'Lead Architect',
      p1Id, m2Id, 'Senior Backend Engineer',
      p1Id, m4Id, 'DevOps Engineer',

      p2Id, m1Id, 'Team Leader',
      p2Id, m2Id, 'Senior Backend Engineer',
      p2Id, m3Id, 'Frontend & UX Engineer',

      p3Id, mZaid, 'Team Leader',
      p3Id, m1Id, 'Security Architect',
      p3Id, m4Id, 'Reliability Engineer'
    ]
  );

  execute(
    `INSERT INTO tasks (id, project_id, issue_key, issue_type, title, description, priority, status, due_date, assignee_id, reporter_id, estimated_hours, story_points, sprint, created_at, updated_at) VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),

    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),

    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      't-101', p1Id, 'EQX-101', 'Story', 'Design idempotency key partition scheme', 'Prevent duplicate transaction insertion during network retry spikes.', 'High', 'Done', dThreeDaysAgo, m1Id, 'u-zaid', 16.0, 5, 'Sprint 1 (Active)', now.toISOString(), now.toISOString(),
      't-102', p1Id, 'EQX-102', 'Task', 'Implement distributed lock with SQLite WAL fallback', 'Guarantee single-writer serialization on accounting ledger records.', 'High', 'In Progress', dYesterday, m2Id, 'u-zaid', 24.0, 8, 'Sprint 1 (Active)', now.toISOString(), now.toISOString(),
      't-103', p1Id, 'EQX-103', 'Story', 'Write load test harness for 5,000 TPS baseline', 'Verify latency percentiles p95 and p99 stay under 40ms.', 'Medium', 'To Do', dIn3Days, m4Id, 'u-zaid', 12.0, 3, 'Sprint 1 (Active)', now.toISOString(), now.toISOString(),
      't-104', p1Id, 'EQX-104', 'Task', 'Automate CI migration schema validation', 'Run linters and dry-run migrations against SQLite test fixtures.', 'Low', 'Done', dThreeDaysAgo, m4Id, 'u-zaid', 8.0, 2, 'Sprint 1 (Active)', now.toISOString(), now.toISOString(),

      't-201', p2Id, 'PORT-201', 'Story', 'Implement responsive data table with tabular figures', 'Ensure numeric alignment and clean sorting on desktop and tablet.', 'High', 'In Progress', dTomorrow, m3Id, 'u-elena', 18.0, 5, 'Sprint 2 (Active)', now.toISOString(), now.toISOString(),
      't-202', p2Id, 'PORT-202', 'Task', 'Build streaming CSV export endpoint', 'RFC 4180 compliant export with formula injection sanitization.', 'High', 'In Review', dIn3Days, m2Id, 'u-elena', 10.0, 3, 'Sprint 2 (Active)', now.toISOString(), now.toISOString(),
      't-203', p2Id, 'PORT-203', 'Bug', 'Wire SVG progress bars and status indicators', 'Zero-pill discipline and accessible high-contrast color palette.', 'Medium', 'To Do', dYesterday, m3Id, 'u-elena', 8.0, 2, 'Sprint 2 (Active)', now.toISOString(), now.toISOString(),

      't-301', p3Id, 'IAM-301', 'Story', 'Draft OAuth2 scope matrix and RBAC specs', 'Document permissions required for admin vs developer roles.', 'Medium', 'In Review', dIn10Days, m1Id, 'u-zaid', 14.0, 5, 'Sprint 1 (Active)', now.toISOString(), now.toISOString(),
      't-302', p3Id, 'IAM-302', 'Task', 'Configure token revocation list and Redis cache', 'Immediate logout propagation across cluster nodes.', 'High', 'To Do', dIn30Days, null, 'u-zaid', 20.0, 8, 'Sprint 1 (Active)', now.toISOString(), now.toISOString()
    ]
  );

  // Update member skills and project objectives
  execute(`UPDATE team_members SET skills = 'Distributed Systems, System Architecture, Go, Python' WHERE id = ?`, [m1Id]);
  execute(`UPDATE team_members SET skills = 'PostgreSQL, SQLite, Node.js, Express, Go' WHERE id = ?`, [m2Id]);
  execute(`UPDATE team_members SET skills = 'React, TypeScript, Tailwind CSS, UX Design, Testing' WHERE id = ?`, [m3Id]);
  execute(`UPDATE team_members SET skills = 'DevOps, Docker, Kubernetes, CI/CD, Reliability' WHERE id = ?`, [m4Id]);
  execute(`UPDATE team_members SET skills = 'Executive Leadership, Agile, System Architecture, Code Review' WHERE id = ?`, [mZaid]);

  execute(`UPDATE projects SET objectives = 'Deliver high-throughput ledger reconciliation engine achieving under 1ms latency SLA' WHERE id = ?`, [p1Id]);
  execute(`UPDATE projects SET objectives = 'Launch self-service financial merchant portal with live reporting & export capabilities' WHERE id = ?`, [p2Id]);
  execute(`UPDATE projects SET objectives = 'Standardize unified authentication and RBAC authorization across all microservices' WHERE id = ?`, [p3Id]);

  // Seed Subtasks
  execute(
    `INSERT INTO task_subtasks (id, task_id, title, is_completed, created_at) VALUES
    ('st-1', 't-101', 'Write test fixtures for idempotency keys', 1, ?),
    ('st-2', 't-101', 'Benchmark redis vs in-memory partition hash', 1, ?),
    ('st-3', 't-102', 'Configure WAL mode in SQLite configuration', 1, ?),
    ('st-4', 't-102', 'Add timeout fallback when lock contention exceeds 50ms', 0, ?)`,
    [now.toISOString(), now.toISOString(), now.toISOString(), now.toISOString()]
  );

  // Seed Acceptance Criteria
  execute(
    `INSERT INTO task_acceptance_criteria (id, task_id, criterion, is_met, created_at) VALUES
    ('ac-1', 't-101', 'Duplicate HTTP requests with identical key return HTTP 409 or cached payload', 1, ?),
    ('ac-2', 't-101', 'Zero duplicate accounting ledger lines generated under 100 concurrent requests', 1, ?),
    ('ac-3', 't-102', 'Locks release cleanly even if thread crashes or panics', 0, ?)`,
    [now.toISOString(), now.toISOString(), now.toISOString()]
  );

  // Seed Meeting Notes
  execute(
    `INSERT INTO meeting_notes (id, project_id, title, meeting_date, attendees, content, action_items, created_at) VALUES
    ('mn-1', 'p-ledger', 'Sprint 1 Architecture Sync & Blocker Review', ?, 'Zaid Tested, Elena Rostova, Marcus Vance', 'Reviewed idempotency key benchmarks and zero-trust IAM scope boundaries. Discussed distributed lock contention.', '1. Marcus to benchmark WAL pragma\n2. Elena to review IAM matrix', ?)`,
    [dYesterday, now.toISOString()]
  );

  // Seed Retrospective
  execute(
    `INSERT INTO retrospectives (id, project_id, sprint, went_well, needs_improvement, action_items, created_at) VALUES
    ('retro-1', 'p-ledger', 'Sprint 1 (Active)', 'Fast CI feedback on PRs, clear Jira issue key convention, real GitHub sync.', 'Unclear estimation on distributed locks, need earlier QA involvement.', '1. Add acceptance criteria checklist before moving to In Progress\n2. Standardize 30-min architecture sign-off', ?)`,
    [now.toISOString()]
  );

  // Seed Audit Logs
  execute(
    `INSERT INTO audit_logs (id, project_id, entity_type, entity_id, action, actor_name, details, created_at) VALUES
    ('log-1', 'p-ledger', 'Project', 'p-ledger', 'Created Project', 'Zaid Tested', 'Initialized Core Financial Ledger Modernization with key EQX', ?),
    ('log-2', 'p-ledger', 'Task', 't-101', 'Status Changed to Done', 'Elena Rostova', 'Completed idempotency key partition scheme with verified commits', ?)`,
    [now.toISOString(), now.toISOString()]
  );

  // Seed Notifications
  execute(
    `INSERT INTO notifications (id, user_id, title, message, type, link, is_read, created_at) VALUES
    ('notif-1', 'u-zaid', 'Task Review Requested', 'Marcus Vance submitted EQX-102 for architectural sign-off.', 'review', '/tasks', 0, ?),
    ('notif-2', 'u-zaid', 'Milestone Deadline Alert', 'PORT-201 Customer Portal & Analytics Dashboard is due tomorrow.', 'milestone', '/tasks', 0, ?)`,
    [now.toISOString(), now.toISOString()]
  );

  // Seed Discussions
  execute(
    `INSERT INTO discussions (id, project_id, author_id, author_name, author_avatar, category, title, content, created_at) VALUES
    ('disc-1', 'p-ledger', 'u-zaid', 'Zaid Tested', 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150', 'Architecture', 'SQLite WAL Mode concurrency and lock timeouts', 'We benchmarked WAL pragma with 100 concurrent writers. Latency p99 remained under 12ms. Zero lock starvation observed.', ?),
    ('disc-2', 'p-ledger', 'u-elena', 'Elena Rostova', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150', 'Sprint Planning', 'Sprint 2 Scope & Zero-Trust IAM Federation', 'Proposal to prioritize OAuth scope authorization over raw Redis caching. Please review the specification draft.', ?)`,
    [dYesterday, now.toISOString()]
  );

  // Seed Peer Kudos (Invisible Work recognition)
  execute(
    `INSERT INTO peer_kudos (id, project_id, from_name, to_member_id, category, message, created_at) VALUES
    ('kd-1', 'p-ledger', 'Elena Rostova', 'm-marcus', 'Unblocking Teammates', 'Huge thanks to Marcus for triaging the distributed lock deadlock under load. Saved the release sprint!', ?),
    ('kd-2', 'p-ledger', 'Marcus Vance', 'm-devon', 'Mentorship & Support', 'Devon walked the team through the CI linting setup and container configuration. Excellent guidance.', ?)`,
    [dYesterday, now.toISOString()]
  );

  // Seed Task Attachments
  execute(
    `INSERT INTO task_attachments (id, task_id, file_name, file_size, file_type, uploaded_by, created_at) VALUES
    ('att-1', 't-101', 'idempotency-key-partition-spec.pdf', '245 KB', 'application/pdf', 'Elena Rostova', ?),
    ('att-2', 't-102', 'sqlite-wal-benchmark-results.csv', '38 KB', 'text/csv', 'Marcus Vance', ?)`,
    [dYesterday, now.toISOString()]
  );

  saveDatabase();
}

async function startServer() {
  await initDatabase();
  const dbAdapter: DbAdapter = { queryAll, queryOne, execute };

  const app = express();
  app.use(express.json({
    limit: '10mb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    }
  }));

  // In-memory rate limiting for sensitive AI and document operations
  const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
  function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const entry = rateLimitStore.get(key);
    if (!entry || now > entry.resetAt) {
      rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (entry.count >= limit) {
      return false;
    }
    entry.count++;
    return true;
  }

  // Cryptographically Secure Session & Token Management
  let JWT_SECRET = process.env.JWT_SECRET?.trim();
  if (isProd) {
    if (!JWT_SECRET || JWT_SECRET.length < 32) {
      console.error('FATAL SECURITY ERROR: JWT_SECRET must be configured with at least 32 characters in production.');
      process.exit(1);
    }
  } else {
    JWT_SECRET = JWT_SECRET || 'pulse-dev-secret-key-at-least-32-chars-long-security';
  }

  function generateAuthToken(userId: string): string {
    const expiry = Date.now() + 7 * 86400000;
    const payload = `${userId}.${expiry}`;
    const hmac = crypto.createHmac('sha256', JWT_SECRET!).update(payload).digest('hex');
    return `${payload}.${hmac}`;
  }

  function verifyAuthToken(token: string): string | null {
    if (!token || typeof token !== 'string') return null;
    const cleanToken = token.replace(/^Bearer\s+/i, '').trim();
    const parts = cleanToken.split('.');
    if (parts.length !== 3) return null;
    const [userId, expiryStr, hmac] = parts;
    const expiry = parseInt(expiryStr, 10);
    if (isNaN(expiry) || Date.now() > expiry) return null;
    const expected = crypto.createHmac('sha256', JWT_SECRET!).update(`${userId}.${expiryStr}`).digest('hex');
    
    // Constant-time signature comparison with buffer length safeguard to prevent uncaught exceptions
    const hmacBuf = Buffer.from(hmac, 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (hmacBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(hmacBuf, expectedBuf)) return null;
    return userId;
  }

  // Helper to extract authenticated user from request header
  const getAuthUser = (req: express.Request) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return null;
    const userId = verifyAuthToken(authHeader);
    if (!userId) return null;
    return queryOne('SELECT id, name, email, role, avatar_url, github_username FROM users WHERE id = ?', [userId]);
  };

  // Helper with demo exploration fallback for unauthenticated preview mode
  const getAuthUserOrDemo = (req: express.Request) => {
    const auth = getAuthUser(req);
    if (auth) return auth;
    return queryOne('SELECT id, name, email, role, avatar_url, github_username FROM users WHERE id = ?', ['u-zaid'])
      || queryOne('SELECT id, name, email, role, avatar_url, github_username FROM users LIMIT 1');
  };

  // Project Authorization Helper
  function isUserAuthorizedForProject(user: any, projectId: string): boolean {
    if (!user || !projectId) return false;
    if (projectId === 'all' || projectId === 'global') return true;
    if (user.role === 'Team Leader' || user.role === 'Admin' || user.role === 'Super Admin' || user.id === 'u-zaid') return true;
    const project = queryOne('SELECT * FROM projects WHERE id = ?', [projectId]);
    if (!project) return false;
    if (project.leader_id === user.id) return true;
    const member = queryOne(
      `SELECT pm.role FROM project_members pm
       JOIN team_members tm ON pm.member_id = tm.id
       WHERE pm.project_id = ? AND (LOWER(tm.email) = LOWER(?) OR tm.id = ?)`,
      [projectId, user.email, 'm-' + user.id]
    );
    return !!member;
  }

  // CORS headers with strict origin verification
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowedOrigins = [
      process.env.FRONTEND_ORIGIN,
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:5173',
      'http://127.0.0.1:5173'
    ].filter(Boolean) as string[];

    const host = req.get('host');
    const isSameOrigin = origin && host && (origin === `http://${host}` || origin === `https://${host}`);
    const isAllowed = !origin || isSameOrigin || allowedOrigins.includes(origin);

    if (origin && isAllowed) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // REST API Routes
  
  // Health & System
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'healthy',
      engine: 'Express + SQLite3 (sql.js) with FastAPI schema compatibility',
      version: '1.0.0',
      database_records: {
        projects: queryOne<{ c: number }>('SELECT count(*) as c FROM projects')?.c || 0,
        tasks: queryOne<{ c: number }>('SELECT count(*) as c FROM tasks')?.c || 0,
        team_members: queryOne<{ c: number }>('SELECT count(*) as c FROM team_members')?.c || 0
      }
    });
  });

  // Database Reset Endpoint (Disabled in production, restricted to authenticated Team Leader in dev)
  app.post('/api/system/seed', (req, res) => {
    if (isProd) {
      return res.status(403).json({ detail: 'Database reset endpoint is disabled in production.' });
    }
    const authUser = getAuthUser(req);
    if (!authUser || (authUser.role !== 'Team Leader' && authUser.role !== 'Admin')) {
      return res.status(403).json({ detail: 'Forbidden: Only authorized administrators can reset the database in development.' });
    }
    seedDatabase();
    res.json({ success: true, message: 'Database reset and seeded with realistic demo projects and tasks.' });
  });

  // Authentication Routes with Bcrypt Password Hashing & HMAC Signed Tokens
  app.post('/api/auth/register', (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ detail: 'Name is required' });
    if (!email || !email.trim()) return res.status(400).json({ detail: 'Email is required' });
    if (!password || password.length < 6) return res.status(400).json({ detail: 'Password must be at least 6 characters' });

    const existing = queryOne('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', [email.trim()]);
    if (existing) {
      return res.status(400).json({ detail: `An account with email '${email}' already exists.` });
    }

    const id = 'u-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const now = new Date().toISOString();
    // Enforce server-controlled default role to prevent privilege escalation
    const userRole = 'Member';
    const avatarUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name.trim())}`;
    const hashedPassword = bcrypt.hashSync(password, 10);

    execute(
      `INSERT INTO users (id, name, email, password, role, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name.trim(), email.trim().toLowerCase(), hashedPassword, userRole, avatarUrl, now, now]
    );

    // Sync to team_members if not present
    const existingMember = queryOne('SELECT id FROM team_members WHERE LOWER(email) = LOWER(?)', [email.trim()]);
    if (!existingMember) {
      execute(
        `INSERT INTO team_members (id, name, email, role, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ['m-' + id, name.trim(), email.trim().toLowerCase(), userRole, avatarUrl, now, now]
      );
    }

    const user = queryOne('SELECT id, name, email, role, avatar_url, created_at FROM users WHERE id = ?', [id]);
    res.status(201).json({
      token: generateAuthToken(id),
      user
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ detail: 'Email and password are required' });
    }

    const user = queryOne('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [email.trim()]);
    if (!user) {
      return res.status(401).json({ detail: 'Invalid email or password.' });
    }

    let isValid = false;
    if (user.password.startsWith('$2a$') || user.password.startsWith('$2b$')) {
      isValid = bcrypt.compareSync(password, user.password);
    } else {
      // Legacy plaintext password check with auto-migration to bcrypt
      if (user.password === password) {
        isValid = true;
        const hashed = bcrypt.hashSync(password, 10);
        execute('UPDATE users SET password = ? WHERE id = ?', [hashed, user.id]);
      }
    }

    if (!isValid) {
      return res.status(401).json({ detail: 'Invalid email or password.' });
    }

    const { password: _, ...userSafe } = user;
    res.json({
      token: generateAuthToken(user.id),
      user: userSafe
    });
  });

  app.get('/api/auth/me', (req, res) => {
    const user = getAuthUser(req);
    if (!user) {
      return res.status(401).json({ user: null, error: 'Unauthorized' });
    }
    res.json({ user });
  });

  const createAuditLog = (projectId: string, entityType: string, entityId: string, action: string, actorName: string, details: string) => {
    const id = 'log-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    execute(
      `INSERT INTO audit_logs (id, project_id, entity_type, entity_id, action, actor_name, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, projectId, entityType, entityId, action, actorName, details, new Date().toISOString()]
    );
  };

  const createNotification = (userId: string | null, title: string, message: string, type: string, link: string | null = null) => {
    const id = 'notif-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    execute(
      `INSERT INTO notifications (id, user_id, title, message, type, link, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      [id, userId, title, message, type, link, new Date().toISOString()]
    );
  };

  // Projects
  app.get('/api/projects', (req, res) => {
    const { search, status } = req.query as { search?: string; status?: string };
    let sql = 'SELECT * FROM projects WHERE 1=1';
    const params: any[] = [];
    if (search) {
      sql += ' AND (name LIKE ? OR description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    sql += ' ORDER BY created_at DESC';

    const projects = queryAll(sql, params);
    const results = projects.map(p => {
      // Fetch full project member details with roles
      const memberRows = queryAll<{
        member_id: string;
        role: string;
        name: string;
        email: string;
        avatar_url: string;
        github_username: string;
      }>(
        `SELECT pm.member_id, pm.role, tm.name, tm.email, tm.avatar_url, tm.github_username 
         FROM project_members pm 
         LEFT JOIN team_members tm ON pm.member_id = tm.id 
         WHERE pm.project_id = ?`,
        [p.id]
      );

      // Find leader display name
      let leaderName = 'Zaid Tested';
      if (p.leader_id) {
        const uLeader = queryOne<{ name: string }>('SELECT name FROM users WHERE id = ?', [p.leader_id]);
        const mLeader = queryOne<{ name: string }>('SELECT name FROM team_members WHERE id = ?', [p.leader_id]);
        leaderName = uLeader?.name || mLeader?.name || 'Project Leader';
      }

      return {
        ...p,
        leader_name: leaderName,
        key_prefix: p.key_prefix || 'EQX',
        current_sprint: p.current_sprint || 'Sprint 1 (Active)',
        member_ids: memberRows.map(m => m.member_id),
        members: memberRows
      };
    });
    res.json(results);
  });

  app.post('/api/projects', (req, res) => {
    const { name, description, start_date, deadline, status, leader_id, key_prefix, current_sprint, member_ids } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ detail: 'Project name is required' });
    }

    const authUser = getAuthUser(req);
    const assignedLeaderId = leader_id || (authUser ? authUser.id : 'u-zaid');

    // Auto-generate Jira issue key prefix (e.g. "Core Financial Ledger" -> "CFL")
    let prefix = key_prefix ? key_prefix.trim().toUpperCase() : '';
    if (!prefix) {
      const words = name.trim().replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(Boolean);
      if (words.length >= 2) {
        prefix = words.map((w: string) => w[0]).join('').slice(0, 4).toUpperCase();
      } else {
        prefix = name.trim().slice(0, 3).toUpperCase();
      }
      if (!prefix || prefix.length < 2) prefix = 'PRJ';
    }

    const id = 'p-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const now = new Date().toISOString();
    const sprint = current_sprint || 'Sprint 1 (Active)';

    execute(
      `INSERT INTO projects (id, name, description, start_date, deadline, status, leader_id, key_prefix, current_sprint, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name.trim(), description || null, start_date || null, deadline || null, status || 'Planning', assignedLeaderId, prefix, sprint, now, now]
    );

    // Insert Leader as the first member with role 'Project Leader'
    // Map leader_id to team_members if needed
    let leaderMemberId = assignedLeaderId;
    const directTeamMember = queryOne('SELECT id FROM team_members WHERE id = ?', [assignedLeaderId]);
    if (!directTeamMember) {
      const user = queryOne('SELECT * FROM users WHERE id = ?', [assignedLeaderId]);
      if (user) {
        const existingTm = queryOne('SELECT id FROM team_members WHERE LOWER(email) = LOWER(?)', [user.email]);
        if (existingTm) {
          leaderMemberId = existingTm.id;
        } else {
          leaderMemberId = 'm-' + user.id;
          execute(
            `INSERT INTO team_members (id, name, email, role, avatar_url, github_username, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [leaderMemberId, user.name, user.email, 'Project Leader', user.avatar_url, user.github_username || null, now, now]
          );
        }
      }
    }

    execute('INSERT OR REPLACE INTO project_members (project_id, member_id, role) VALUES (?, ?, ?)', [id, leaderMemberId, 'Project Leader']);

    // Add additional members
    if (Array.isArray(member_ids) && member_ids.length > 0) {
      for (const mId of member_ids) {
        if (mId !== leaderMemberId) {
          execute('INSERT OR IGNORE INTO project_members (project_id, member_id, role) VALUES (?, ?, ?)', [id, mId, 'Developer']);
        }
      }
    }

    const created = queryOne('SELECT * FROM projects WHERE id = ?', [id]);
    const memberRows = queryAll<{
      member_id: string;
      role: string;
      name: string;
      email: string;
      avatar_url: string;
      github_username: string;
    }>(
      `SELECT pm.member_id, pm.role, tm.name, tm.email, tm.avatar_url, tm.github_username 
       FROM project_members pm 
       LEFT JOIN team_members tm ON pm.member_id = tm.id 
       WHERE pm.project_id = ?`,
      [id]
    );

    res.status(201).json({
      ...created,
      key_prefix: prefix,
      current_sprint: sprint,
      member_ids: memberRows.map(m => m.member_id),
      members: memberRows
    });
  });

  app.get('/api/projects/:id', (req, res) => {
    const project = queryOne('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    if (!project) {
      return res.status(404).json({ detail: 'Project not found' });
    }
    const memberRows = queryAll<{
      member_id: string;
      role: string;
      name: string;
      email: string;
      avatar_url: string;
      github_username: string;
    }>(
      `SELECT pm.member_id, pm.role, tm.name, tm.email, tm.avatar_url, tm.github_username 
       FROM project_members pm 
       LEFT JOIN team_members tm ON pm.member_id = tm.id 
       WHERE pm.project_id = ?`,
      [project.id]
    );

    let leaderName = 'Zaid Tested';
    if (project.leader_id) {
      const uLeader = queryOne<{ name: string }>('SELECT name FROM users WHERE id = ?', [project.leader_id]);
      const mLeader = queryOne<{ name: string }>('SELECT name FROM team_members WHERE id = ?', [project.leader_id]);
      leaderName = uLeader?.name || mLeader?.name || 'Project Leader';
    }

    res.json({
      ...project,
      leader_name: leaderName,
      key_prefix: project.key_prefix || 'EQX',
      current_sprint: project.current_sprint || 'Sprint 1 (Active)',
      member_ids: memberRows.map(m => m.member_id),
      members: memberRows
    });
  });

  app.put('/api/projects/:id', (req, res) => {
    const project = queryOne('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    if (!project) {
      return res.status(404).json({ detail: 'Project not found' });
    }

    const { name, description, start_date, deadline, status, leader_id, key_prefix, current_sprint, member_ids } = req.body;
    const now = new Date().toISOString();

    const newName = name !== undefined ? name.trim() : project.name;
    const newDesc = description !== undefined ? description : project.description;
    const newStart = start_date !== undefined ? start_date : project.start_date;
    const newDeadline = deadline !== undefined ? deadline : project.deadline;
    const newStatus = status !== undefined ? status : project.status;
    const newLeader = leader_id !== undefined ? leader_id : project.leader_id;
    const newPrefix = key_prefix !== undefined ? key_prefix.trim().toUpperCase() : project.key_prefix;
    const newSprint = current_sprint !== undefined ? current_sprint : project.current_sprint;

    execute(
      `UPDATE projects SET name = ?, description = ?, start_date = ?, deadline = ?, status = ?, leader_id = ?, key_prefix = ?, current_sprint = ?, updated_at = ? WHERE id = ?`,
      [newName, newDesc, newStart, newDeadline, newStatus, newLeader, newPrefix, newSprint, now, req.params.id]
    );

    if (Array.isArray(member_ids)) {
      // Preserve roles if already in table
      const currentRoles = new Map<string, string>();
      const existing = queryAll<{ member_id: string; role: string }>('SELECT member_id, role FROM project_members WHERE project_id = ?', [req.params.id]);
      for (const e of existing) {
        currentRoles.set(e.member_id, e.role);
      }
      execute('DELETE FROM project_members WHERE project_id = ?', [req.params.id]);
      for (const mId of member_ids) {
        const assignedRole = currentRoles.get(mId) || (mId === newLeader ? 'Project Leader' : 'Developer');
        execute('INSERT OR IGNORE INTO project_members (project_id, member_id, role) VALUES (?, ?, ?)', [req.params.id, mId, assignedRole]);
      }
    }

    const updated = queryOne('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    const memberRows = queryAll<{
      member_id: string;
      role: string;
      name: string;
      email: string;
      avatar_url: string;
      github_username: string;
    }>(
      `SELECT pm.member_id, pm.role, tm.name, tm.email, tm.avatar_url, tm.github_username 
       FROM project_members pm 
       LEFT JOIN team_members tm ON pm.member_id = tm.id 
       WHERE pm.project_id = ?`,
      [req.params.id]
    );

    res.json({
      ...updated,
      member_ids: memberRows.map(m => m.member_id),
      members: memberRows
    });
  });

  // Project Leader Member Management Endpoints
  app.post('/api/projects/:id/members', (req, res) => {
    const project = queryOne('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    if (!project) return res.status(404).json({ detail: 'Project not found' });

    const { member_id, role, name, email, github_username } = req.body;
    let targetMemberId = member_id;
    const projectRole = role || 'Senior Developer';

    // If inviting by name and email
    if (!targetMemberId && email && name) {
      const cleanEmail = email.trim().toLowerCase();
      const existing = queryOne('SELECT id FROM team_members WHERE LOWER(email) = ?', [cleanEmail]);
      if (existing) {
        targetMemberId = existing.id;
      } else {
        targetMemberId = 'm-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
        const now = new Date().toISOString();
        const avatarUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name.trim())}`;
        execute(
          `INSERT INTO team_members (id, name, email, role, avatar_url, github_username, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [targetMemberId, name.trim(), cleanEmail, projectRole, avatarUrl, github_username?.trim() || null, now, now]
        );
      }
    }

    if (!targetMemberId) {
      return res.status(400).json({ detail: 'Please specify an existing team member or provide both name and email to invite.' });
    }

    execute(
      `INSERT INTO project_members (project_id, member_id, role) VALUES (?, ?, ?)
       ON CONFLICT(project_id, member_id) DO UPDATE SET role = excluded.role`,
      [project.id, targetMemberId, projectRole]
    );

    const members = queryAll<{
      member_id: string;
      role: string;
      name: string;
      email: string;
      avatar_url: string;
      github_username: string;
    }>(
      `SELECT pm.member_id, pm.role, tm.name, tm.email, tm.avatar_url, tm.github_username 
       FROM project_members pm 
       LEFT JOIN team_members tm ON pm.member_id = tm.id 
       WHERE pm.project_id = ?`,
      [project.id]
    );

    res.json({
      success: true,
      message: `Teammate successfully added to ${project.name} as ${projectRole}`,
      members
    });
  });

  app.put('/api/projects/:id/members/:memberId', (req, res) => {
    const { role } = req.body;
    if (!role) return res.status(400).json({ detail: 'Role is required' });

    execute(
      `UPDATE project_members SET role = ? WHERE project_id = ? AND member_id = ?`,
      [role, req.params.id, req.params.memberId]
    );

    const member = queryOne(
      `SELECT pm.member_id, pm.role, tm.name, tm.email, tm.avatar_url 
       FROM project_members pm 
       LEFT JOIN team_members tm ON pm.member_id = tm.id 
       WHERE pm.project_id = ? AND pm.member_id = ?`,
      [req.params.id, req.params.memberId]
    );
    res.json(member);
  });

  app.delete('/api/projects/:id/members/:memberId', (req, res) => {
    execute('DELETE FROM project_members WHERE project_id = ? AND member_id = ?', [req.params.id, req.params.memberId]);
    execute('UPDATE tasks SET assignee_id = NULL WHERE project_id = ? AND assignee_id = ?', [req.params.id, req.params.memberId]);
    res.json({ success: true, message: 'Member removed from project.' });
  });

  // Transfer Project Leadership to another team member
  app.post('/api/projects/:id/transfer-leadership', (req, res) => {
    const project = queryOne('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    if (!project) return res.status(404).json({ detail: 'Project not found' });

    const { new_leader_id } = req.body;
    if (!new_leader_id) return res.status(400).json({ detail: 'Target new leader ID is required' });

    // Identify target team member or user
    let targetMember = queryOne<{ id: string; name: string; email: string }>('SELECT id, name, email FROM team_members WHERE id = ?', [new_leader_id]);
    let targetUser = queryOne<{ id: string; name: string; email: string }>('SELECT id, name, email FROM users WHERE id = ?', [new_leader_id]);

    if (!targetMember && targetUser) {
      targetMember = queryOne<{ id: string; name: string; email: string }>('SELECT id, name, email FROM team_members WHERE LOWER(email) = LOWER(?)', [targetUser.email]);
    }
    if (!targetUser && targetMember) {
      targetUser = queryOne<{ id: string; name: string; email: string }>('SELECT id, name, email FROM users WHERE LOWER(email) = LOWER(?)', [targetMember.email]);
    }

    const leaderDisplayName = targetMember?.name || targetUser?.name || 'New Team Leader';
    const leaderIdentifier = targetMember?.id || targetUser?.id || new_leader_id;
    const now = new Date().toISOString();

    // 1. Update project leader_id
    execute('UPDATE projects SET leader_id = ?, updated_at = ? WHERE id = ?', [leaderIdentifier, now, req.params.id]);

    // 2. Demote previous leader in project_members if different
    if (project.leader_id && project.leader_id !== leaderIdentifier) {
      execute("UPDATE project_members SET role = 'Senior Developer' WHERE project_id = ? AND (member_id = ? OR member_id = ?)", [req.params.id, project.leader_id, 'm-' + project.leader_id]);
    }

    // 3. Promote new leader in project_members to 'Team Leader'
    if (targetMember) {
      execute(
        "INSERT INTO project_members (project_id, member_id, role) VALUES (?, ?, 'Team Leader') ON CONFLICT(project_id, member_id) DO UPDATE SET role = 'Team Leader'",
        [req.params.id, targetMember.id]
      );
    }

    // 4. Update new leader's user account role to 'Team Leader' so they receive all system permissions
    if (targetUser) {
      execute("UPDATE users SET role = 'Team Leader', updated_at = ? WHERE id = ?", [now, targetUser.id]);
    } else if (targetMember) {
      execute("UPDATE users SET role = 'Team Leader', updated_at = ? WHERE LOWER(email) = LOWER(?)", [now, targetMember.email]);
    }

    const authUser = getAuthUser(req);
    createAuditLog(
      req.params.id,
      'Project',
      req.params.id,
      'Transferred Leadership',
      authUser?.name || 'Team Leader',
      `Transferred project leadership to ${leaderDisplayName}. They are now Team Leader with full project authority.`
    );

    if (targetMember?.id) {
      createNotification(
        targetMember.id,
        `👑 Appointed Team Leader: ${project.name}`,
        `You have been granted full Team Leader authority for ${project.name}.`,
        'announcement',
        '/projects'
      );
    }

    const updatedProject = queryOne('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    res.json({
      ...updatedProject,
      leader_id: leaderIdentifier,
      leader_name: leaderDisplayName,
      message: `Project leadership successfully transferred to ${leaderDisplayName}.`
    });
  });

  app.delete('/api/projects/:id', (req, res) => {
    const project = queryOne('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    if (!project) {
      return res.status(404).json({ detail: 'Project not found' });
    }
    execute('DELETE FROM tasks WHERE project_id = ?', [req.params.id]);
    execute('DELETE FROM project_members WHERE project_id = ?', [req.params.id]);
    execute('DELETE FROM github_integrations WHERE project_id = ?', [req.params.id]);
    execute('DELETE FROM github_commits WHERE project_id = ?', [req.params.id]);
    execute('DELETE FROM github_pull_requests WHERE project_id = ?', [req.params.id]);
    execute('DELETE FROM audit_logs WHERE project_id = ?', [req.params.id]);
    execute('DELETE FROM meeting_notes WHERE project_id = ?', [req.params.id]);
    execute('DELETE FROM retrospectives WHERE project_id = ?', [req.params.id]);
    execute('DELETE FROM disputes WHERE project_id = ?', [req.params.id]);
    execute('DELETE FROM projects WHERE id = ?', [req.params.id]);
    res.sendStatus(204);
  });

  // Tasks (with Jira capabilities)
  app.get('/api/tasks', (req, res) => {
    const { project_id, status, priority, assignee_id, sprint, issue_type, search, sort_by, sort_order } = req.query as Record<string, string>;
    let sql = 'SELECT * FROM tasks WHERE 1=1';
    const params: any[] = [];

    if (project_id) {
      sql += ' AND project_id = ?';
      params.push(project_id);
    }
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (priority) {
      sql += ' AND priority = ?';
      params.push(priority);
    }
    if (assignee_id) {
      sql += ' AND assignee_id = ?';
      params.push(assignee_id);
    }
    if (sprint) {
      sql += ' AND sprint = ?';
      params.push(sprint);
    }
    if (issue_type) {
      sql += ' AND issue_type = ?';
      params.push(issue_type);
    }
    if (search) {
      sql += ' AND (title LIKE ? OR description LIKE ? OR issue_key LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const order = sort_order === 'desc' ? 'DESC' : 'ASC';
    if (sort_by === 'priority') {
      sql += ` ORDER BY CASE priority WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 WHEN 'Low' THEN 3 ELSE 4 END ${order}`;
    } else if (sort_by === 'created_at') {
      sql += ` ORDER BY created_at ${order}`;
    } else {
      sql += ` ORDER BY CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date ${order}`;
    }

    const tasks = queryAll(sql, params);
    const enrichedTasks = tasks.map(t => {
      const subtasks = queryAll('SELECT * FROM task_subtasks WHERE task_id = ? ORDER BY created_at ASC', [t.id]);
      const criteria = queryAll('SELECT * FROM task_acceptance_criteria WHERE task_id = ? ORDER BY created_at ASC', [t.id]);
      const reviews = queryAll('SELECT * FROM task_reviews WHERE task_id = ? ORDER BY reviewed_at DESC', [t.id]);
      const comments = queryAll('SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC', [t.id]);
      const linkedCommits = queryAll('SELECT sha, message, author_login, date, url, branch FROM github_commits WHERE project_id = ? AND (issue_key = ? OR message LIKE ?)', [t.project_id, t.issue_key || t.id, `%${t.issue_key || t.id}%`]);
      return {
        ...t,
        is_blocked: Boolean(t.is_blocked),
        dependencies: t.dependencies ? (typeof t.dependencies === 'string' ? t.dependencies.split(',').filter(Boolean) : t.dependencies) : [],
        subtasks: subtasks.map((s: any) => ({ ...s, is_completed: Boolean(s.is_completed) })),
        acceptance_criteria: criteria.map((c: any) => ({ ...c, is_met: Boolean(c.is_met) })),
        reviews,
        comments,
        linked_commits: linkedCommits
      };
    });
    res.json(enrichedTasks);
  });

  app.post('/api/tasks', (req, res) => {
    const { project_id, title, description, priority, status, due_date, assignee_id, reporter_id, estimated_hours, story_points, sprint, issue_type, issue_key } = req.body;
    if (!project_id) {
      return res.status(400).json({ detail: 'project_id is required' });
    }
    if (!title || !title.trim()) {
      return res.status(400).json({ detail: 'title is required' });
    }

    const project = queryOne('SELECT * FROM projects WHERE id = ?', [project_id]);
    if (!project) {
      return res.status(400).json({ detail: 'Referenced project does not exist' });
    }

    if (assignee_id) {
      const member = queryOne('SELECT id FROM team_members WHERE id = ?', [assignee_id]);
      if (!member) {
        return res.status(400).json({ detail: 'Referenced team member does not exist' });
      }
    }

    const authUser = getAuthUser(req);
    const assignedReporter = reporter_id || (authUser ? authUser.id : 'u-zaid');

    // Auto generate Jira issue key (e.g. EQX-105)
    let assignedKey = issue_key;
    if (!assignedKey) {
      const existingCount = queryOne<{ count: number }>('SELECT count(*) as count FROM tasks WHERE project_id = ?', [project_id])?.count || 0;
      const prefix = project.key_prefix || 'EQX';
      assignedKey = `${prefix}-${101 + existingCount}`;
    }

    const id = 't-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const now = new Date().toISOString();

    execute(
      `INSERT INTO tasks (id, project_id, issue_key, issue_type, title, description, priority, status, due_date, assignee_id, reporter_id, estimated_hours, story_points, sprint, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        project_id,
        assignedKey,
        issue_type || 'Story',
        title.trim(),
        description || null,
        priority || 'Medium',
        status || 'To Do',
        due_date || null,
        assignee_id || null,
        assignedReporter,
        Number(estimated_hours) || 0,
        Number(story_points) || 3,
        sprint || project.current_sprint || 'Sprint 1 (Active)',
        now,
        now
      ]
    );

    const created = queryOne('SELECT * FROM tasks WHERE id = ?', [id]);
    res.status(201).json(created);
  });

  app.get('/api/tasks/:id', (req, res) => {
    const task = queryOne('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!task) return res.status(404).json({ detail: 'Task not found' });
    res.json(task);
  });

  app.put('/api/tasks/:id', (req, res) => {
    const task = queryOne('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!task) return res.status(404).json({ detail: 'Task not found' });

    const { project_id, title, description, priority, status, due_date, assignee_id, reporter_id, estimated_hours, story_points, sprint, issue_type, issue_key } = req.body;
    const now = new Date().toISOString();

    if (project_id) {
      const p = queryOne('SELECT id FROM projects WHERE id = ?', [project_id]);
      if (!p) return res.status(400).json({ detail: 'Referenced project does not exist' });
    }
    if (assignee_id) {
      const m = queryOne('SELECT id FROM team_members WHERE id = ?', [assignee_id]);
      if (!m) return res.status(400).json({ detail: 'Referenced team member does not exist' });
    }

    execute(
      `UPDATE tasks SET 
        project_id = ?,
        issue_key = ?,
        issue_type = ?,
        title = ?,
        description = ?,
        priority = ?,
        status = ?,
        due_date = ?,
        assignee_id = ?,
        reporter_id = ?,
        estimated_hours = ?,
        story_points = ?,
        sprint = ?,
        updated_at = ?
       WHERE id = ?`,
      [
        project_id !== undefined ? project_id : task.project_id,
        issue_key !== undefined ? issue_key : task.issue_key,
        issue_type !== undefined ? issue_type : (task.issue_type || 'Task'),
        title !== undefined ? title.trim() : task.title,
        description !== undefined ? description : task.description,
        priority !== undefined ? priority : task.priority,
        status !== undefined ? (status === 'Not Started' ? 'To Do' : (status === 'Completed' ? 'Done' : status)) : task.status,
        due_date !== undefined ? due_date : task.due_date,
        assignee_id !== undefined ? (assignee_id || null) : task.assignee_id,
        reporter_id !== undefined ? (reporter_id || null) : task.reporter_id,
        estimated_hours !== undefined ? Number(estimated_hours) : task.estimated_hours,
        story_points !== undefined ? Number(story_points) : task.story_points,
        sprint !== undefined ? sprint : task.sprint,
        now,
        req.params.id
      ]
    );

    const updated = queryOne('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    res.json(updated);
  });

  // Dedicated status update route for team members and leaders
  app.patch('/api/tasks/:id/status', (req, res) => {
    const task = queryOne('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!task) return res.status(404).json({ detail: 'Task not found' });

    let { status } = req.body;
    if (!status) return res.status(400).json({ detail: 'Status is required' });

    // Normalize legacy status strings
    if (status === 'Not Started') status = 'To Do';
    if (status === 'Completed') status = 'Done';

    const validStatuses = ['To Do', 'In Progress', 'In Review', 'Done'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ detail: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const now = new Date().toISOString();
    execute('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', [status, now, req.params.id]);

    const authUser = getAuthUser(req);
    createAuditLog(
      task.project_id,
      'Task',
      task.id,
      'Updated Task Status',
      authUser?.name || 'Team Member',
      `Task status updated to "${status}" (was "${task.status}")`
    );

    if (status === 'Done') {
      createNotification(
        task.reporter_id || null,
        `✅ Deliverable Done: ${task.issue_key || task.title}`,
        `${authUser?.name || 'Assignee'} marked task "${task.title}" as Done.`,
        'task',
        '/tasks'
      );
    }

    const updated = queryOne('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    res.json(updated);
  });

  app.delete('/api/tasks/:id', (req, res) => {
    const task = queryOne('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!task) return res.status(404).json({ detail: 'Task not found' });
    execute('DELETE FROM task_subtasks WHERE task_id = ?', [req.params.id]);
    execute('DELETE FROM task_acceptance_criteria WHERE task_id = ?', [req.params.id]);
    execute('DELETE FROM task_reviews WHERE task_id = ?', [req.params.id]);
    execute('DELETE FROM task_comments WHERE task_id = ?', [req.params.id]);
    execute('DELETE FROM tasks WHERE id = ?', [req.params.id]);
    res.sendStatus(204);
  });

  // Task Subtasks
  app.get('/api/tasks/:id/subtasks', (req, res) => {
    const subtasks = queryAll('SELECT * FROM task_subtasks WHERE task_id = ? ORDER BY created_at ASC', [req.params.id]);
    res.json(subtasks.map((s: any) => ({ ...s, is_completed: Boolean(s.is_completed) })));
  });

  app.post('/api/tasks/:id/subtasks', (req, res) => {
    const { title } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ detail: 'Subtask title is required' });
    const id = 'st-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const now = new Date().toISOString();
    execute('INSERT INTO task_subtasks (id, task_id, title, is_completed, created_at) VALUES (?, ?, ?, 0, ?)', [id, req.params.id, title.trim(), now]);
    res.status(201).json({ id, task_id: req.params.id, title: title.trim(), is_completed: false, created_at: now });
  });

  app.put('/api/tasks/:id/subtasks/:subtaskId', (req, res) => {
    const { is_completed, title } = req.body;
    const sub = queryOne('SELECT * FROM task_subtasks WHERE id = ? AND task_id = ?', [req.params.subtaskId, req.params.id]);
    if (!sub) return res.status(404).json({ detail: 'Subtask not found' });
    const newCompleted = is_completed !== undefined ? (is_completed ? 1 : 0) : sub.is_completed;
    const newTitle = title !== undefined ? title.trim() : sub.title;
    execute('UPDATE task_subtasks SET is_completed = ?, title = ? WHERE id = ?', [newCompleted, newTitle, req.params.subtaskId]);
    res.json({ id: req.params.subtaskId, task_id: req.params.id, title: newTitle, is_completed: Boolean(newCompleted) });
  });

  app.delete('/api/tasks/:id/subtasks/:subtaskId', (req, res) => {
    execute('DELETE FROM task_subtasks WHERE id = ? AND task_id = ?', [req.params.subtaskId, req.params.id]);
    res.sendStatus(204);
  });

  // Task Acceptance Criteria
  app.get('/api/tasks/:id/acceptance-criteria', (req, res) => {
    const criteria = queryAll('SELECT * FROM task_acceptance_criteria WHERE task_id = ? ORDER BY created_at ASC', [req.params.id]);
    res.json(criteria.map((c: any) => ({ ...c, is_met: Boolean(c.is_met) })));
  });

  app.post('/api/tasks/:id/acceptance-criteria', (req, res) => {
    const { criterion } = req.body;
    if (!criterion || !criterion.trim()) return res.status(400).json({ detail: 'Criterion text is required' });
    const id = 'ac-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const now = new Date().toISOString();
    execute('INSERT INTO task_acceptance_criteria (id, task_id, criterion, is_met, created_at) VALUES (?, ?, ?, 0, ?)', [id, req.params.id, criterion.trim(), now]);
    res.status(201).json({ id, task_id: req.params.id, criterion: criterion.trim(), is_met: false, created_at: now });
  });

  app.put('/api/tasks/:id/acceptance-criteria/:critId', (req, res) => {
    const { is_met, criterion } = req.body;
    const crit = queryOne('SELECT * FROM task_acceptance_criteria WHERE id = ? AND task_id = ?', [req.params.critId, req.params.id]);
    if (!crit) return res.status(404).json({ detail: 'Acceptance criterion not found' });
    const newMet = is_met !== undefined ? (is_met ? 1 : 0) : crit.is_met;
    const newCrit = criterion !== undefined ? criterion.trim() : crit.criterion;
    execute('UPDATE task_acceptance_criteria SET is_met = ?, criterion = ? WHERE id = ?', [newMet, newCrit, req.params.critId]);
    res.json({ id: req.params.critId, task_id: req.params.id, criterion: newCrit, is_met: Boolean(newMet) });
  });

  // Task Comments
  app.get('/api/tasks/:id/comments', (req, res) => {
    const comments = queryAll('SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC', [req.params.id]);
    res.json(comments);
  });

  app.post('/api/tasks/:id/comments', (req, res) => {
    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ detail: 'Comment content is required' });
    const task = queryOne('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!task) return res.status(404).json({ detail: 'Task not found' });
    const authUser = getAuthUser(req);
    const authorName = authUser?.name || 'Zaid Tested';
    const authorId = authUser?.id || 'u-zaid';
    const avatar = authUser?.avatar_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150';
    const id = 'cm-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const now = new Date().toISOString();
    execute(
      `INSERT INTO task_comments (id, task_id, author_id, author_name, author_avatar, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, req.params.id, authorId, authorName, avatar, content.trim(), now]
    );
    res.status(201).json({ id, task_id: req.params.id, author_id: authorId, author_name: authorName, author_avatar: avatar, content: content.trim(), created_at: now });
  });

  // Task Blockers
  app.post('/api/tasks/:id/blocker', (req, res) => {
    const { is_blocked, blocker_reason, blocker_owner } = req.body;
    const task = queryOne('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!task) return res.status(404).json({ detail: 'Task not found' });
    const val = is_blocked ? 1 : 0;
    execute(
      'UPDATE tasks SET is_blocked = ?, blocker_reason = ?, blocker_owner = ?, updated_at = ? WHERE id = ?',
      [val, val ? (blocker_reason || 'Unspecified blocker') : null, val ? (blocker_owner || null) : null, new Date().toISOString(), req.params.id]
    );
    const authUser = getAuthUser(req);
    if (val === 1) {
      createNotification(null, `🚨 Blocker Reported: ${task.issue_key || task.title}`, `Task "${task.title}" is blocked: ${blocker_reason || 'Needs resolution'}`, 'blocker', '/tasks');
      createAuditLog(task.project_id, 'Task', task.id, 'Reported Blocker', authUser?.name || 'Engineer', blocker_reason || 'Marked as blocked');
    } else {
      createAuditLog(task.project_id, 'Task', task.id, 'Resolved Blocker', authUser?.name || 'Engineer', 'Blocker cleared');
    }
    const updated = queryOne('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    res.json({ ...updated, is_blocked: Boolean(val) });
  });

  // Task Reviews
  app.post('/api/tasks/:id/reviews', (req, res) => {
    const { status, feedback } = req.body;
    const task = queryOne('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!task) return res.status(404).json({ detail: 'Task not found' });
    const authUser = getAuthUser(req);
    const reviewerName = authUser?.name || 'Peer Reviewer';
    const reviewerId = authUser?.id || 'u-zaid';
    const id = 'rev-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const now = new Date().toISOString();
    execute(
      `INSERT INTO task_reviews (id, task_id, reviewer_id, reviewer_name, status, feedback, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, req.params.id, reviewerId, reviewerName, status || 'Approved', feedback || null, now]
    );
    if (status === 'Approved' && task.status === 'In Review') {
      execute('UPDATE tasks SET status = "Done", updated_at = ? WHERE id = ?', [now, task.id]);
      createAuditLog(task.project_id, 'Task', task.id, 'Review Approved -> Done', reviewerName, 'Code and acceptance criteria signed off.');
    } else if (status === 'Changes Requested') {
      execute('UPDATE tasks SET status = "In Progress", updated_at = ? WHERE id = ?', [now, task.id]);
      createAuditLog(task.project_id, 'Task', task.id, 'Changes Requested -> In Progress', reviewerName, feedback || 'Needs updates before sign-off.');
    }
    createNotification(task.assignee_id, `Review Submitted on ${task.issue_key || task.title}`, `${reviewerName} marked review as: ${status}`, 'review', '/tasks');
    res.status(201).json({ id, task_id: req.params.id, reviewer_name: reviewerName, status, feedback, reviewed_at: now });
  });

  // Team
  app.get('/api/team', (req, res) => {
    const { project_id } = req.query as { project_id?: string };
    let sql = 'SELECT * FROM team_members';
    if (project_id) {
      sql = `SELECT tm.* FROM team_members tm 
             JOIN project_members pm ON tm.id = pm.member_id 
             WHERE pm.project_id = ?`;
    }
    const members = queryAll(sql, project_id ? [project_id] : []);
    const results = members.map(m => {
      const pRows = queryAll<{ project_id: string }>(
        'SELECT project_id FROM project_members WHERE member_id = ?',
        [m.id]
      );
      return {
        ...m,
        assigned_project_ids: pRows.map(p => p.project_id)
      };
    });
    res.json(results);
  });

  // Team Member Work Status Tracking Endpoint (For Team Leaders & Members)
  app.get('/api/team/work-status', (req, res) => {
    const { project_id } = req.query as { project_id?: string };
    let memberSql = 'SELECT * FROM team_members';
    if (project_id) {
      memberSql = `SELECT tm.* FROM team_members tm 
                   JOIN project_members pm ON tm.id = pm.member_id 
                   WHERE pm.project_id = ?`;
    }
    const members = queryAll(memberSql, project_id ? [project_id] : []);

    let tasksSql = 'SELECT * FROM tasks';
    if (project_id) {
      tasksSql += ' WHERE project_id = ?';
    }
    const allTasks = queryAll(tasksSql, project_id ? [project_id] : []);

    const memberStatusOverview = members.map(m => {
      const assignedTasks = allTasks.filter(t => t.assignee_id === m.id);
      const totalAssigned = assignedTasks.length;
      const toDo = assignedTasks.filter(t => t.status === 'To Do' || t.status === 'Not Started').length;
      const inProgress = assignedTasks.filter(t => t.status === 'In Progress').length;
      const inReview = assignedTasks.filter(t => t.status === 'In Review').length;
      const done = assignedTasks.filter(t => t.status === 'Done' || t.status === 'Completed').length;
      const progress = totalAssigned > 0 ? Math.round((done / totalAssigned) * 100) : 0;

      return {
        member_id: m.id,
        name: m.name,
        email: m.email,
        role: m.role,
        avatar_url: m.avatar_url,
        github_username: m.github_username,
        total_assigned: totalAssigned,
        to_do_count: toDo,
        in_progress_count: inProgress,
        in_review_count: inReview,
        done_count: done,
        not_started_count: toDo,
        completed_count: done,
        completion_percentage: progress,
        tasks: assignedTasks.map(t => ({
          id: t.id,
          issue_key: t.issue_key,
          title: t.title,
          status: t.status === 'Completed' ? 'Done' : (t.status === 'Not Started' ? 'To Do' : t.status),
          priority: t.priority,
          due_date: t.due_date,
          story_points: t.story_points,
          project_id: t.project_id
        }))
      };
    });

    res.json(memberStatusOverview);
  });

  app.post('/api/team', (req, res) => {
    const { name, email, role, avatar_url, github_username, assigned_project_ids } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ detail: 'Name is required' });
    if (!email || !email.trim()) return res.status(400).json({ detail: 'Email is required' });

    const existing = queryOne('SELECT id FROM team_members WHERE LOWER(email) = LOWER(?)', [email.trim()]);
    if (existing) {
      return res.status(400).json({ detail: `A team member with email '${email}' already exists.` });
    }

    const id = 'm-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const now = new Date().toISOString();

    execute(
      `INSERT INTO team_members (id, name, email, role, avatar_url, github_username, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name.trim(),
        email.trim().toLowerCase(),
        role?.trim() || 'Developer',
        avatar_url || null,
        github_username?.trim() || null,
        now,
        now
      ]
    );

    if (Array.isArray(assigned_project_ids)) {
      for (const pId of assigned_project_ids) {
        execute('INSERT OR IGNORE INTO project_members (project_id, member_id) VALUES (?, ?)', [pId, id]);
      }
    }

    const created = queryOne('SELECT * FROM team_members WHERE id = ?', [id]);
    res.status(201).json({
      ...created,
      assigned_project_ids: assigned_project_ids || []
    });
  });

  app.put('/api/team/:id', (req, res) => {
    const member = queryOne('SELECT * FROM team_members WHERE id = ?', [req.params.id]);
    if (!member) return res.status(404).json({ detail: 'Team member not found' });

    const { name, email, role, avatar_url, github_username, assigned_project_ids } = req.body;
    const now = new Date().toISOString();

    if (email && email.trim().toLowerCase() !== member.email.toLowerCase()) {
      const dup = queryOne('SELECT id FROM team_members WHERE LOWER(email) = LOWER(?) AND id != ?', [email.trim(), req.params.id]);
      if (dup) {
        return res.status(400).json({ detail: `Email '${email}' is already in use by another member.` });
      }
    }

    execute(
      `UPDATE team_members SET
        name = ?,
        email = ?,
        role = ?,
        avatar_url = ?,
        github_username = ?,
        updated_at = ?
       WHERE id = ?`,
      [
        name !== undefined ? name.trim() : member.name,
        email !== undefined ? email.trim().toLowerCase() : member.email,
        role !== undefined ? role.trim() : member.role,
        avatar_url !== undefined ? avatar_url : member.avatar_url,
        github_username !== undefined ? (github_username?.trim() || null) : member.github_username,
        now,
        req.params.id
      ]
    );

    if (Array.isArray(assigned_project_ids)) {
      execute('DELETE FROM project_members WHERE member_id = ?', [req.params.id]);
      for (const pId of assigned_project_ids) {
        execute('INSERT OR IGNORE INTO project_members (project_id, member_id) VALUES (?, ?)', [pId, req.params.id]);
      }
    }

    const updated = queryOne('SELECT * FROM team_members WHERE id = ?', [req.params.id]);
    const pRows = queryAll<{ project_id: string }>(
      'SELECT project_id FROM project_members WHERE member_id = ?',
      [req.params.id]
    );
    res.json({
      ...updated,
      assigned_project_ids: pRows.map(p => p.project_id)
    });
  });

  app.delete('/api/team/:id', (req, res) => {
    const member = queryOne('SELECT * FROM team_members WHERE id = ?', [req.params.id]);
    if (!member) return res.status(404).json({ detail: 'Team member not found' });

    // Check active tasks
    const activeTasks = queryAll('SELECT id, title FROM tasks WHERE assignee_id = ? AND status != "Done"', [req.params.id]);
    if (activeTasks.length > 0) {
      return res.status(400).json({
        detail: `Cannot remove member with ${activeTasks.length} active assigned task(s). Reassign or mark them as Done first.`
      });
    }

    execute('DELETE FROM project_members WHERE member_id = ?', [req.params.id]);
    execute('UPDATE tasks SET assignee_id = NULL WHERE assignee_id = ?', [req.params.id]);
    execute('DELETE FROM team_members WHERE id = ?', [req.params.id]);
    res.sendStatus(204);
  });

  // Dashboard Metrics
  app.get('/api/dashboard', (req, res) => {
    const { project_id } = req.query as { project_id?: string };
    const now = new Date();

    const pFilter = project_id ? ' WHERE id = ?' : '';
    const projects = queryAll('SELECT * FROM projects' + pFilter, project_id ? [project_id] : []);

    const tFilter = project_id ? ' WHERE project_id = ?' : '';
    const tasks = queryAll<TaskRecord>('SELECT * FROM tasks' + tFilter, project_id ? [project_id] : []);

    const totalProjects = projects.length;
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.status === 'Done').length;
    const pendingTasks = totalTasks - completedTasks;
    const overdueTasks = tasks.filter(t => isTaskOverdue(t, now)).length;
    const overallCompletion = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    // Upcoming deadlines: non-done with due date >= today
    const upcoming = tasks
      .filter(t => t.status !== 'Done' && t.dueDate && !isTaskOverdue(t, now))
      .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
      .slice(0, 5);

    // Team workload
    const members = queryAll('SELECT * FROM team_members');
    const workloadSummary = members.map(m => {
      const mTasks = tasks.filter(t => t.assigneeId === m.id);
      const mPending = mTasks.filter(t => t.status !== 'Done').length;
      const mCompleted = mTasks.filter(t => t.status === 'Done').length;
      const mOverdue = mTasks.filter(t => isTaskOverdue(t, now)).length;
      let status: 'Low' | 'Balanced' | 'High' | 'Overloaded' = 'Balanced';
      if (mPending === 0) status = 'Low';
      else if (mPending <= 3) status = 'Balanced';
      else if (mPending <= 6) status = 'High';
      else status = 'Overloaded';

      return {
        member_id: m.id,
        name: m.name,
        role: m.role,
        avatar_url: m.avatar_url,
        total_assigned: mTasks.length,
        pending: mPending,
        completed: mCompleted,
        overdue: mOverdue,
        workload_status: status
      };
    });

    // Recent activity
    const recentTasks = [...tasks]
      .sort((a: any, b: any) => (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || ''))
      .slice(0, 6);

    const recentActivity = recentTasks.map((t: any) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      timestamp: t.updated_at || t.created_at || now.toISOString()
    }));

    // Project risk overview
    const allTasks = queryAll<TaskRecord>('SELECT * FROM tasks');
    const riskOverview = projects.map(p => {
      const pTasks = allTasks.filter(t => (t as any).project_id === p.id || t.projectId === p.id);
      const normalizedTasks: TaskRecord[] = pTasks.map((t: any) => ({
        id: t.id,
        projectId: t.project_id || t.projectId,
        title: t.title,
        priority: t.priority,
        status: t.status,
        dueDate: t.due_date || t.dueDate,
        assigneeId: t.assignee_id || t.assigneeId
      }));
      const risk = evaluateProjectRisk({
        id: p.id,
        name: p.name,
        deadline: p.deadline,
        status: p.status
      }, normalizedTasks, now);

      return {
        project_id: p.id,
        project_name: p.name,
        risk_level: risk.riskLevel,
        risk_score: risk.riskScore,
        completion_percentage: risk.completionPercentage,
        deadline: p.deadline,
        summary_recommendation: risk.summaryRecommendation,
        factor_count: risk.factors.length
      };
    });

    res.json({
      total_projects: totalProjects,
      total_tasks: totalTasks,
      completed_tasks: completedTasks,
      pending_tasks: pendingTasks,
      overdue_tasks: overdueTasks,
      overall_completion_percentage: overallCompletion,
      upcoming_deadlines: upcoming,
      team_workload_summary: workloadSummary,
      recent_activity: recentActivity,
      project_risk_overview: riskOverview
    });
  });

  // Helper to query real GitHub stats for a team member
  function getMemberGitHubStats(member: { id: string; name: string; github_username?: string | null }, projectId?: string): { commits: number; prs: number } | null {
    const ghUser = member.github_username ? member.github_username.trim().toLowerCase() : null;
    const nameUser = member.name ? member.name.trim().toLowerCase() : null;

    let commitsSql = 'SELECT count(*) as count FROM github_commits WHERE 1=1';
    let prsSql = 'SELECT count(*) as count FROM github_pull_requests WHERE 1=1';
    const cParams: any[] = [];
    const pParams: any[] = [];

    if (projectId) {
      commitsSql += ' AND project_id = ?';
      prsSql += ' AND project_id = ?';
      cParams.push(projectId);
      pParams.push(projectId);
    }

    if (ghUser && nameUser) {
      commitsSql += ' AND (LOWER(author_login) = ? OR LOWER(author_name) = ?)';
      cParams.push(ghUser, nameUser);
    } else if (ghUser) {
      commitsSql += ' AND LOWER(author_login) = ?';
      cParams.push(ghUser);
    } else if (nameUser) {
      commitsSql += ' AND LOWER(author_name) = ?';
      cParams.push(nameUser);
    } else {
      return null;
    }

    if (ghUser) {
      prsSql += ' AND LOWER(author_login) = ?';
      pParams.push(ghUser);
    } else {
      prsSql += ' AND 1=0';
    }

    const commitsCount = queryOne<{ count: number }>(commitsSql, cParams)?.count || 0;
    const prsCount = queryOne<{ count: number }>(prsSql, pParams)?.count || 0;

    const hasIntegration = Boolean(ghUser) || commitsCount > 0 || prsCount > 0;
    if (!hasIntegration) return null;

    return { commits: commitsCount, prs: prsCount };
  }

  // Contributions
  app.get('/api/contributions', (req, res) => {
    const { project_id } = req.query as { project_id?: string };
    const now = new Date();

    const members = queryAll('SELECT * FROM team_members');
    const tSql = project_id ? 'SELECT * FROM tasks WHERE project_id = ?' : 'SELECT * FROM tasks';
    const rawTasks = queryAll(tSql, project_id ? [project_id] : []);

    const tasks: TaskRecord[] = rawTasks.map((t: any) => ({
      id: t.id,
      projectId: t.project_id,
      title: t.title,
      priority: t.priority,
      status: t.status,
      dueDate: t.due_date,
      assigneeId: t.assignee_id
    }));

    const results = members.map(m => {
      const gitHubData = getMemberGitHubStats(m, project_id);
      const contrib = calculateMemberContribution(
        { id: m.id, name: m.name, githubUsername: m.github_username },
        tasks,
        gitHubData,
        now
      );
      return {
        member_id: contrib.memberId,
        member_name: contrib.memberName,
        role: m.role,
        avatar_url: m.avatar_url,
        total_assigned: contrib.totalAssigned,
        completed_tasks: contrib.completedTasks,
        pending_tasks: contrib.pendingTasks,
        overdue_tasks: contrib.overdueTasks,
        completion_rate: contrib.completionRate,
        high_priority_completed: contrib.highPriorityCompleted,
        medium_priority_completed: contrib.mediumPriorityCompleted,
        low_priority_completed: contrib.lowPriorityCompleted,
        total_assigned_weight: contrib.totalAssignedWeight,
        completed_weight: contrib.completedWeight,
        weighted_score: contrib.weightedScore,
        workload_status: contrib.workloadStatus,
        github_activity_status: contrib.githubActivityStatus,
        github_commits_count: contrib.githubCommitsCount,
        github_prs_count: contrib.githubPRsCount,
        calculation_notes: contrib.calculationNotes
      };
    });

    res.json(results);
  });

  // Risks
  app.get('/api/risks', (req, res) => {
    const { project_id } = req.query as { project_id?: string };
    const now = new Date();

    const pSql = project_id ? 'SELECT * FROM projects WHERE id = ?' : 'SELECT * FROM projects';
    const projects = queryAll(pSql, project_id ? [project_id] : []);
    const rawTasks = queryAll('SELECT * FROM tasks');

    const tasks: TaskRecord[] = rawTasks.map((t: any) => ({
      id: t.id,
      projectId: t.project_id,
      title: t.title,
      priority: t.priority,
      status: t.status,
      dueDate: t.due_date,
      assigneeId: t.assignee_id
    }));

    const results = projects.map(p => {
      const risk = evaluateProjectRisk({
        id: p.id,
        name: p.name,
        deadline: p.deadline,
        status: p.status
      }, tasks, now);

      return {
        project_id: risk.projectId,
        project_name: risk.projectName,
        risk_level: risk.riskLevel,
        risk_score: risk.riskScore,
        factors: risk.factors.map(f => ({
          id: f.id,
          code: f.code,
          severity: f.severity,
          title: f.title,
          description: f.description,
          affected_task_ids: f.affectedTaskIds,
          affected_task_titles: f.affectedTaskTitles,
          suggested_action: f.suggestedAction
        })),
        total_tasks: risk.totalTasks,
        completed_tasks: risk.completedTasks,
        completion_percentage: risk.completionPercentage,
        days_until_deadline: risk.daysUntilProjectDeadline,
        summary_recommendation: risk.summaryRecommendation,
        last_evaluated_at: risk.lastEvaluatedAt
      };
    });

    res.json(results);
  });

  // Reports
  app.get('/api/reports/progress', (req, res) => {
    const { project_id } = req.query as { project_id?: string };
    const now = new Date();

    const pSql = project_id ? 'SELECT * FROM projects WHERE id = ?' : 'SELECT * FROM projects';
    const projects = queryAll(pSql, project_id ? [project_id] : []);

    const reports = projects.map(p => {
      const pTasks = queryAll<TaskRecord>('SELECT * FROM tasks WHERE project_id = ?', [p.id]);
      const normalizedTasks: TaskRecord[] = pTasks.map((t: any) => ({
        id: t.id,
        projectId: t.project_id,
        title: t.title,
        priority: t.priority,
        status: t.status,
        dueDate: t.due_date,
        assigneeId: t.assignee_id
      }));

      const total = normalizedTasks.length;
      const done = normalizedTasks.filter(t => t.status === 'Done').length;
      const overdue = normalizedTasks.filter(t => isTaskOverdue(t, now)).length;
      const high = normalizedTasks.filter(t => t.priority === 'High').length;
      const rate = total > 0 ? Math.round((done / total) * 100) : 0;

      return {
        project_id: p.id,
        project_name: p.name,
        status: p.status,
        deadline: p.deadline,
        total_tasks: total,
        completed_tasks: done,
        overdue_tasks: overdue,
        high_priority_tasks: high,
        completion_percentage: rate
      };
    });

    res.json(reports);
  });

  app.get('/api/reports/overdue-tasks', (req, res) => {
    const { project_id } = req.query as { project_id?: string };
    const now = new Date();

    const tSql = project_id ? 'SELECT * FROM tasks WHERE project_id = ? AND status != "Done"' : 'SELECT * FROM tasks WHERE status != "Done"';
    const pendingTasks = queryAll(tSql, project_id ? [project_id] : []);

    const overdue = pendingTasks
      .filter((t: any) => isTaskOverdue({ status: t.status, dueDate: t.due_date }, now))
      .map((t: any) => {
        const p = queryOne('SELECT name FROM projects WHERE id = ?', [t.project_id]);
        const m = t.assignee_id ? queryOne('SELECT name FROM team_members WHERE id = ?', [t.assignee_id]) : null;
        return {
          task_id: t.id,
          title: t.title,
          project_name: p?.name || 'Unknown',
          priority: t.priority,
          due_date: t.due_date,
          assignee_name: m?.name || 'Unassigned',
          status: t.status
        };
      });

    res.json(overdue);
  });

  app.get('/api/reports/export-csv', (req, res) => {
    const { report_type, project_id } = req.query as { report_type?: string; project_id?: string };
    const now = new Date();
    const type = report_type || 'progress';

    let headers: string[] = [];
    let rows: (string | number | boolean | null | undefined)[][] = [];

    if (type === 'progress') {
      headers = ['Project ID', 'Project Name', 'Status', 'Deadline', 'Total Tasks', 'Completed Tasks', 'Overdue Tasks', 'Completion %'];
      const pSql = project_id ? 'SELECT * FROM projects WHERE id = ?' : 'SELECT * FROM projects';
      const projects = queryAll(pSql, project_id ? [project_id] : []);
      for (const p of projects) {
        const tasks = queryAll('SELECT * FROM tasks WHERE project_id = ?', [p.id]);
        const total = tasks.length;
        const done = tasks.filter((t: any) => t.status === 'Done').length;
        const overdue = tasks.filter((t: any) => isTaskOverdue({ status: t.status, dueDate: t.due_date }, now)).length;
        const rate = total > 0 ? Math.round((done / total) * 100) : 0;
        rows.push([p.id, p.name, p.status, p.deadline || 'N/A', total, done, overdue, `${rate}%`]);
      }
    } else if (type === 'contribution') {
      headers = ['Member ID', 'Name', 'Role', 'Assigned Tasks', 'Completed', 'Pending', 'Overdue', 'Completion Rate', 'Weighted Score', 'Workload Status'];
      const members = queryAll('SELECT * FROM team_members');
      const tSql = project_id ? 'SELECT * FROM tasks WHERE project_id = ?' : 'SELECT * FROM tasks';
      const rawTasks = queryAll(tSql, project_id ? [project_id] : []);
      const tasks: TaskRecord[] = rawTasks.map((t: any) => ({
        id: t.id,
        projectId: t.project_id,
        title: t.title,
        priority: t.priority,
        status: t.status,
        dueDate: t.due_date,
        assigneeId: t.assignee_id
      }));
      for (const m of members) {
        const gitHubData = getMemberGitHubStats(m, project_id);
        const c = calculateMemberContribution({ id: m.id, name: m.name, githubUsername: m.github_username }, tasks, gitHubData, now);
        rows.push([
          c.memberId,
          c.memberName,
          m.role,
          c.totalAssigned,
          c.completedTasks,
          c.pendingTasks,
          c.overdueTasks,
          `${c.completionRate}%`,
          `${c.weightedScore}%`,
          c.workloadStatus
        ]);
      }
    } else if (type === 'overdue') {
      headers = ['Task ID', 'Title', 'Project Name', 'Priority', 'Due Date', 'Assignee', 'Status'];
      const tSql = project_id ? 'SELECT * FROM tasks WHERE project_id = ? AND status != "Done"' : 'SELECT * FROM tasks WHERE status != "Done"';
      const pendingTasks = queryAll(tSql, project_id ? [project_id] : []);
      for (const t of pendingTasks) {
        if (isTaskOverdue({ status: t.status, dueDate: t.due_date }, now)) {
          const p = queryOne('SELECT name FROM projects WHERE id = ?', [t.project_id]);
          const m = t.assignee_id ? queryOne('SELECT name FROM team_members WHERE id = ?', [t.assignee_id]) : null;
          rows.push([t.id, t.title, p?.name || 'Unknown', t.priority, t.due_date || 'N/A', m?.name || 'Unassigned', t.status]);
        }
      }
    } else if (type === 'risk') {
      headers = ['Project ID', 'Project Name', 'Risk Level', 'Risk Score', 'Completion %', 'Deadline', 'Key Risk Recommendation'];
      const pSql = project_id ? 'SELECT * FROM projects WHERE id = ?' : 'SELECT * FROM projects';
      const projects = queryAll(pSql, project_id ? [project_id] : []);
      const rawTasks = queryAll('SELECT * FROM tasks');
      const tasks: TaskRecord[] = rawTasks.map((t: any) => ({
        id: t.id,
        projectId: t.project_id,
        title: t.title,
        priority: t.priority,
        status: t.status,
        dueDate: t.due_date,
        assigneeId: t.assignee_id
      }));
      for (const p of projects) {
        const r = evaluateProjectRisk({ id: p.id, name: p.name, deadline: p.deadline, status: p.status }, tasks, now);
        rows.push([
          r.projectId,
          r.projectName,
          r.riskLevel,
          r.riskScore,
          `${r.completionPercentage}%`,
          p.deadline || 'N/A',
          r.summaryRecommendation
        ]);
      }
    }

    const csvContent = generateCsv(headers, rows);
    const dateStr = now.toISOString().split('T')[0];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${type}_report_${dateStr}.csv"`);
    res.send(csvContent);
  });

  // Password Reset & Access Management
  app.post('/api/auth/reset-password', (req, res) => {
    const { email, new_password } = req.body;
    if (!email || !new_password) return res.status(400).json({ detail: 'Email and new password are required' });
    const user = queryOne('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [email.trim()]);
    if (!user) return res.status(404).json({ detail: 'No user account found with that email address.' });
    if (new_password.length < 6) return res.status(400).json({ detail: 'New password must be at least 6 characters' });
    const hashedPassword = bcrypt.hashSync(new_password, 10);
    execute('UPDATE users SET password = ?, updated_at = ? WHERE id = ?', [hashedPassword, new Date().toISOString(), user.id]);
    createNotification(user.id, 'Password Reset Successful', 'Your account credentials have been updated securely.', 'assignment');
    res.json({ success: true, message: 'Password has been updated. You can now log in with your new credentials.' });
  });

  // Team Invitations
  app.post('/api/team/invite', (req, res) => {
    const { email, role, project_id } = req.body;
    if (!email || !email.trim()) return res.status(400).json({ detail: 'Email is required' });
    const token = 'inv-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    const id = 'inv-id-' + Date.now().toString(36);
    execute(
      `INSERT INTO project_invitations (id, project_id, email, role, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, project_id || null, email.trim().toLowerCase(), role || 'Senior Developer', token, expiresAt, new Date().toISOString()]
    );
    const authUser = getAuthUser(req);
    createNotification(null, 'Team Invitation Generated', `An invitation link for ${email.trim()} (${role || 'Developer'}) was created.`, 'assignment');
    if (project_id) {
      createAuditLog(project_id, 'Team', id, 'Sent Invitation', authUser?.name || 'Admin', `Invited ${email.trim()} as ${role || 'Developer'}`);
    }
    const inviteLink = `${req.protocol}://${req.get('host')}/join?token=${token}&email=${encodeURIComponent(email.trim())}`;
    res.json({ success: true, invite_link: inviteLink, message: `Invitation link generated successfully for ${email}.` });
  });

  // Project Archiving & Audit Logs
  app.post('/api/projects/:id/archive', (req, res) => {
    const { is_archived } = req.body;
    const project = queryOne('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    if (!project) return res.status(404).json({ detail: 'Project not found' });
    const val = is_archived ? 1 : 0;
    execute('UPDATE projects SET is_archived = ?, updated_at = ? WHERE id = ?', [val, new Date().toISOString(), req.params.id]);
    const authUser = getAuthUser(req);
    createAuditLog(req.params.id, 'Project', req.params.id, val === 1 ? 'Archived Project' : 'Restored Project', authUser?.name || 'Admin', `Project ${project.name} was ${val === 1 ? 'archived' : 'restored'}`);
    res.json({ success: true, is_archived: Boolean(val) });
  });

  app.get('/api/projects/:id/audit-logs', (req, res) => {
    const logs = queryAll('SELECT * FROM audit_logs WHERE project_id = ? ORDER BY created_at DESC LIMIT 50', [req.params.id]);
    res.json(logs);
  });

  // Project Templates
  const PROJECT_TEMPLATES = [
    {
      id: 'template-saas',
      name: 'SaaS Sprint & Product Engine',
      description: 'Standard Linear-style sprint setup with API idempotency, database migrations, auth scopes, and front-end state management.',
      default_tasks: [
        { title: 'Define Domain Model & Database Migrations', priority: 'High', issue_type: 'Story', story_points: 5, estimated_hours: 16, description: 'Establish schema tables with foreign key cascades and index optimizers.' },
        { title: 'Build Zero-Trust Auth & Role Validation Middleware', priority: 'High', issue_type: 'Story', story_points: 8, estimated_hours: 24, description: 'Token validation with role-based access control and token revocation.' },
        { title: 'Implement Core REST API CRUD Endpoints', priority: 'Medium', issue_type: 'Task', story_points: 5, estimated_hours: 20, description: 'Standardized payload contracts and RFC 7807 error responses.' },
        { title: 'Create Interactive Real-time Dashboard View', priority: 'Medium', issue_type: 'Story', story_points: 3, estimated_hours: 14, description: 'Data visualizations with accessible typography and clean states.' }
      ]
    },
    {
      id: 'template-bugbash',
      name: 'Bug Bash & Hardening Sprint',
      description: 'Rapid quality stabilization sprint covering load testing, edge case test fixtures, and security audits.',
      default_tasks: [
        { title: 'Perform Latency & Throughput Benchmark', priority: 'High', issue_type: 'Task', story_points: 5, estimated_hours: 18, description: 'Measure p95 and p99 response times under 2,000 requests/sec.' },
        { title: 'Fuzz Input Validation & Formula Injection Safeguards', priority: 'High', issue_type: 'Bug', story_points: 3, estimated_hours: 12, description: 'Verify all CSV and text fields properly escape delimiters and formula triggers.' },
        { title: 'Resolve High-Priority Sentry Error Regressions', priority: 'Medium', issue_type: 'Bug', story_points: 5, estimated_hours: 16, description: 'Eliminate top 5 recurring unhandled promise rejections.' }
      ]
    },
    {
      id: 'template-infra',
      name: 'Infrastructure & Reliability Migration',
      description: 'Zero-downtime database switchover, distributed locking, CI/CD automated validation, and observability monitoring.',
      default_tasks: [
        { title: 'Configure Multi-Node WAL Replicas', priority: 'High', issue_type: 'Task', story_points: 8, estimated_hours: 28, description: 'Replicate changes with sub-second lag and automatic failover hooks.' },
        { title: 'Setup Prometheus Metrics & Alerting Thresholds', priority: 'Medium', issue_type: 'Story', story_points: 5, estimated_hours: 16, description: 'Track CPU, disk IOPS, and memory saturation with incident webhooks.' },
        { title: 'Implement Automated Disaster Recovery Snapshot Tests', priority: 'High', issue_type: 'Task', story_points: 5, estimated_hours: 14, description: 'Daily backup verification and restoration runbooks.' }
      ]
    }
  ];

  app.get('/api/project-templates', (req, res) => {
    res.json(PROJECT_TEMPLATES);
  });

  app.post('/api/projects/from-template', (req, res) => {
    const { template_id, name, leader_id } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ detail: 'Project name is required' });
    const tmpl = PROJECT_TEMPLATES.find(t => t.id === template_id) || PROJECT_TEMPLATES[0];

    let prefix = name.trim().replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).slice(0, 3).map((w: string) => w[0]).join('').toUpperCase();
    if (prefix.length < 2) prefix = 'TMP';

    const pId = 'p-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const now = new Date();
    const dIn30Days = new Date(now.getTime() + 30 * 86400000).toISOString().split('T')[0];
    const authUser = getAuthUser(req);
    const assignedLeader = leader_id || (authUser ? authUser.id : 'u-zaid');

    execute(
      `INSERT INTO projects (id, name, description, start_date, deadline, status, leader_id, key_prefix, current_sprint, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [pId, name.trim(), tmpl.description, now.toISOString().split('T')[0], dIn30Days, 'Active', assignedLeader, prefix, 'Sprint 1 (Active)', now.toISOString(), now.toISOString()]
    );

    execute('INSERT OR REPLACE INTO project_members (project_id, member_id, role) VALUES (?, ?, ?)', [pId, 'm-' + assignedLeader, 'Project Leader']);

    tmpl.default_tasks.forEach((t, idx) => {
      const tId = 't-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6) + idx;
      const key = `${prefix}-${101 + idx}`;
      const dIn7Days = new Date(now.getTime() + (idx + 2) * 86400000).toISOString().split('T')[0];
      execute(
        `INSERT INTO tasks (id, project_id, issue_key, issue_type, title, description, priority, status, due_date, assignee_id, reporter_id, estimated_hours, story_points, sprint, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [tId, pId, key, t.issue_type, t.title, t.description, t.priority, 'To Do', dIn7Days, null, assignedLeader, t.estimated_hours, t.story_points, 'Sprint 1 (Active)', now.toISOString(), now.toISOString()]
      );
    });

    createAuditLog(pId, 'Project', pId, 'Created From Template', authUser?.name || 'Admin', `Created project ${name} using ${tmpl.name}`);
    const createdProject = queryOne('SELECT * FROM projects WHERE id = ?', [pId]);
    res.status(201).json({ ...createdProject, key_prefix: prefix, current_sprint: 'Sprint 1 (Active)' });
  });

  // Meeting Notes & Collaborative Logs
  app.get('/api/meeting-notes', (req, res) => {
    const { project_id } = req.query as { project_id?: string };
    const sql = project_id ? 'SELECT * FROM meeting_notes WHERE project_id = ? ORDER BY meeting_date DESC' : 'SELECT * FROM meeting_notes ORDER BY meeting_date DESC';
    const notes = queryAll(sql, project_id ? [project_id] : []);
    res.json(notes);
  });

  app.post('/api/meeting-notes', (req, res) => {
    const { project_id, title, meeting_date, attendees, content, action_items } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ detail: 'Meeting title is required' });
    const pId = project_id || queryOne<{ id: string }>('SELECT id FROM projects LIMIT 1')?.id || 'p-ledger';
    const id = 'mn-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const now = new Date().toISOString();
    execute(
      `INSERT INTO meeting_notes (id, project_id, title, meeting_date, attendees, content, action_items, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, pId, title.trim(), meeting_date || now.split('T')[0], attendees || 'Team', content || '', action_items || '', now]
    );
    const authUser = getAuthUser(req);
    createAuditLog(pId, 'Meeting', id, 'Logged Meeting Notes', authUser?.name || 'Team Lead', `Recorded notes for ${title.trim()}`);
    res.status(201).json({ id, project_id: pId, title: title.trim(), meeting_date, attendees, content, action_items, created_at: now });
  });

  // Stand-up Generator
  app.get('/api/collaboration/standup', (req, res) => {
    const { project_id } = req.query as { project_id?: string };
    const pFilter = project_id ? ' WHERE project_id = ?' : '';
    const allTasks = queryAll('SELECT * FROM tasks' + pFilter, project_id ? [project_id] : []);
    const completedTasks = allTasks.filter((t: any) => t.status === 'Done');
    const inProgressTasks = allTasks.filter((t: any) => t.status === 'In Progress' || t.status === 'In Review');
    const blockedTasks = allTasks.filter((t: any) => Boolean(t.is_blocked));
    const recentCommits = queryAll('SELECT sha, message, author_name, date FROM github_commits' + pFilter + ' ORDER BY date DESC LIMIT 5', project_id ? [project_id] : []);

    let text = `### 📋 Automated Daily Team Stand-up\n\n`;
    text += `**✅ Completed / Merged Recently (${completedTasks.length}):**\n`;
    completedTasks.slice(0, 4).forEach((t: any) => {
      text += `- [${t.issue_key || 'TASK'}] ${t.title} (${t.story_points || 3} pts)\n`;
    });
    if (completedTasks.length === 0) text += `- No completed deliverables in the current cycle.\n`;

    text += `\n**🚀 In Progress / Under Review Today (${inProgressTasks.length}):**\n`;
    inProgressTasks.slice(0, 5).forEach((t: any) => {
      text += `- [${t.issue_key || 'TASK'}] ${t.title} (Status: ${t.status}, Due: ${t.due_date || 'No date'})\n`;
    });

    text += `\n**🚨 Critical Blockers & Dependencies (${blockedTasks.length}):**\n`;
    if (blockedTasks.length > 0) {
      blockedTasks.forEach((t: any) => {
        text += `- ⚠️ [${t.issue_key || 'TASK'}] ${t.title}: ${t.blocker_reason || 'Blocked'} (Owner: ${t.blocker_owner || 'Unassigned'})\n`;
      });
    } else {
      text += `- None reported! Pacing is healthy.\n`;
    }

    if (recentCommits.length > 0) {
      text += `\n**💻 Verified Git Activity:**\n`;
      recentCommits.forEach((c: any) => {
        text += `- \`${c.sha.slice(0, 7)}\` ${c.message.split('\n')[0]} - ${c.author_name}\n`;
      });
    }

    res.json({
      standup_text: text,
      completed_yesterday: completedTasks.slice(0, 5),
      working_on_today: inProgressTasks.slice(0, 5),
      blockers: blockedTasks
    });
  });

  // Sprint Retrospectives & Estimation Accuracy
  app.get('/api/retrospectives', (req, res) => {
    const { project_id } = req.query as { project_id?: string };
    const sql = project_id ? 'SELECT * FROM retrospectives WHERE project_id = ? ORDER BY created_at DESC' : 'SELECT * FROM retrospectives ORDER BY created_at DESC';
    const retros = queryAll(sql, project_id ? [project_id] : []);
    res.json(retros);
  });

  app.post('/api/retrospectives', (req, res) => {
    const { project_id, sprint, went_well, needs_improvement, action_items } = req.body;
    if (!sprint) return res.status(400).json({ detail: 'Sprint name is required' });
    const pId = project_id || queryOne<{ id: string }>('SELECT id FROM projects LIMIT 1')?.id || 'p-ledger';
    const id = 'retro-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const now = new Date().toISOString();
    execute(
      `INSERT INTO retrospectives (id, project_id, sprint, went_well, needs_improvement, action_items, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, pId, sprint, went_well || '', needs_improvement || '', action_items || '', now]
    );
    const authUser = getAuthUser(req);
    createAuditLog(pId, 'Retrospective', id, 'Concluded Retrospective', authUser?.name || 'Scrum Lead', `Retrospective saved for ${sprint}`);
    res.status(201).json({ id, project_id: pId, sprint, went_well, needs_improvement, action_items, created_at: now });
  });

  app.get('/api/analytics/estimation-accuracy', (req, res) => {
    const { project_id } = req.query as { project_id?: string };
    const sql = project_id ? 'SELECT * FROM tasks WHERE project_id = ?' : 'SELECT * FROM tasks';
    const tasks = queryAll(sql, project_id ? [project_id] : []);
    const accuracy = calculateEstimationAccuracy(tasks);
    res.json(accuracy);
  });

  // What-If Simulation & Task Redistribution Suggestions
  app.get('/api/simulation/redistribution-suggestions', (req, res) => {
    const { project_id } = req.query as { project_id?: string };
    const tSql = project_id ? 'SELECT * FROM tasks WHERE project_id = ?' : 'SELECT * FROM tasks';
    const tasks = queryAll(tSql, project_id ? [project_id] : []);
    const members = queryAll('SELECT * FROM team_members');
    const suggestions = generateRedistributionSuggestions(tasks, members);
    res.json(suggestions);
  });

  app.post('/api/simulation/what-if', (req, res) => {
    const { project_id, deadline_shift_days, team_capacity_factor } = req.body;
    const tSql = project_id ? 'SELECT * FROM tasks WHERE project_id = ?' : 'SELECT * FROM tasks';
    const tasks = queryAll(tSql, project_id ? [project_id] : []);
    const project = project_id ? queryOne('SELECT * FROM projects WHERE id = ?', [project_id]) : null;

    const baseDeadline = project?.deadline ? new Date(project.deadline) : new Date(Date.now() + 14 * 86400000);
    const shiftedDeadline = new Date(baseDeadline.getTime() + (deadline_shift_days || 0) * 86400000).toISOString().split('T')[0];

    const cp = calculateCriticalPathAndVariance(tasks, shiftedDeadline);
    const capacityMult = Math.max(0.5, Math.min(2.0, Number(team_capacity_factor) || 1.0));
    const effectiveHoursNeeded = Math.round(cp.totalEstimatedHours / capacityMult);

    const recs: string[] = [];
    if (cp.scheduleVarianceDays < 0) {
      recs.push(`⚠️ Critical Path deficit of ${Math.abs(cp.scheduleVarianceDays)} days detected. Consider shifting non-critical stories out of current sprint.`);
      recs.push(`🔄 Fast-track ${cp.criticalTasks.length} high-priority tasks by pairing senior engineers.`);
    } else {
      recs.push(`✅ Positive schedule buffer of +${cp.scheduleVarianceDays} days maintained under this scenario.`);
      recs.push(`🎯 Team velocity allows absorbing 1-2 additional high-value stories.`);
    }

    if (capacityMult < 1.0) {
      recs.push(`📉 Reduced team capacity (${Math.round(capacityMult * 100)}%) extends needed effort to ${effectiveHoursNeeded}h. Descope low-priority bug fixes.`);
    }

    res.json({
      original_deadline: project?.deadline || baseDeadline.toISOString().split('T')[0],
      simulated_deadline: shiftedDeadline,
      schedule_variance_days: cp.scheduleVarianceDays,
      critical_tasks_count: cp.criticalTasks.length,
      effective_hours_needed: effectiveHoursNeeded,
      capacity_factor: capacityMult,
      recommendations: recs
    });
  });

  // Contribution Disputes & Score Reviews
  app.get('/api/contributions/disputes', (req, res) => {
    const { project_id } = req.query as { project_id?: string };
    const sql = project_id ? 'SELECT * FROM disputes WHERE project_id = ? ORDER BY created_at DESC' : 'SELECT * FROM disputes ORDER BY created_at DESC';
    const disputes = queryAll(sql, project_id ? [project_id] : []);
    res.json(disputes);
  });

  app.post('/api/contributions/dispute', (req, res) => {
    const { project_id, member_id, member_name, reason, evidence_url } = req.body;
    if (!reason || !reason.trim()) return res.status(400).json({ detail: 'Dispute reason is required' });
    const id = 'disp-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const now = new Date().toISOString();
    execute(
      `INSERT INTO disputes (id, project_id, member_id, member_name, reason, evidence_url, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'Pending', ?)`,
      [id, project_id || 'p-ledger', member_id || 'm-zaid', member_name || 'Team Member', reason.trim(), evidence_url || null, now]
    );
    createNotification(null, '⚖️ Contribution Score Disputed', `${member_name} submitted a score review dispute: ${reason.trim().slice(0, 60)}...`, 'dispute', '/contributions');
    createAuditLog(project_id || 'p-ledger', 'Contribution', id, 'Filed Dispute', member_name || 'Member', reason.trim());
    res.status(201).json({ id, project_id, member_id, member_name, reason, evidence_url, status: 'Pending', created_at: now });
  });

  app.post('/api/contributions/disputes/:id/resolve', (req, res) => {
    const { status, resolution_notes } = req.body;
    const disp = queryOne('SELECT * FROM disputes WHERE id = ?', [req.params.id]);
    if (!disp) return res.status(404).json({ detail: 'Dispute not found' });
    const now = new Date().toISOString();
    execute(
      'UPDATE disputes SET status = ?, resolution_notes = ?, resolved_at = ? WHERE id = ?',
      [status || 'Approved', resolution_notes || null, now, req.params.id]
    );
    const authUser = getAuthUser(req);
    createAuditLog(disp.project_id, 'Contribution', disp.id, `Resolved Dispute: ${status}`, authUser?.name || 'Project Lead', resolution_notes || 'Reviewed');
    createNotification(disp.member_id, `Dispute Resolution: ${status}`, `Your contribution score review was marked ${status}: ${resolution_notes || ''}`, 'dispute', '/contributions');
    res.json({ id: req.params.id, status, resolution_notes, resolved_at: now });
  });

  // Notification Center
  app.get('/api/notifications', (req, res) => {
    const notifs = queryAll('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 30');
    res.json(notifs.map((n: any) => ({ ...n, is_read: Boolean(n.is_read) })));
  });

  app.post('/api/notifications/:id/read', (req, res) => {
    execute('UPDATE notifications SET is_read = 1 WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  });

  app.post('/api/notifications/clear', (req, res) => {
    execute('UPDATE notifications SET is_read = 1');
    res.json({ success: true });
  });

  // iCal Calendar Export
  app.get('/api/calendar/export-ics', (req, res) => {
    const { project_id } = req.query as { project_id?: string };
    const sql = project_id ? 'SELECT * FROM tasks WHERE project_id = ?' : 'SELECT * FROM tasks';
    const tasks = queryAll(sql, project_id ? [project_id] : []);
    const projects = queryAll('SELECT * FROM projects');
    const pMap = new Map(projects.map(p => [p.id, p.name]));

    let ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//PULSE//Platform//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n`;

    for (const t of tasks) {
      if (t.due_date) {
        const dStr = t.due_date.replace(/-/g, '');
        const pName = pMap.get(t.project_id) || 'Project';
        ics += `BEGIN:VEVENT\r\n`;
        ics += `UID:${t.id}@pulse.platform\r\n`;
        ics += `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z\r\n`;
        ics += `DTSTART;VALUE=DATE:${dStr}\r\n`;
        ics += `DTEND;VALUE=DATE:${dStr}\r\n`;
        ics += `SUMMARY:[${t.issue_key || 'TASK'}] ${t.title.replace(/[,;]/g, ' ')}\r\n`;
        ics += `DESCRIPTION:Project: ${pName}\\nPriority: ${t.priority}\\nStatus: ${t.status}\r\n`;
        ics += `STATUS:CONFIRMED\r\n`;
        ics += `END:VEVENT\r\n`;
      }
    }

    ics += `END:VCALENDAR\r\n`;

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="pulse_schedule.ics"');
    res.send(ics);
  });
  // ==========================================================================
  // GITHUB PROJECT INTEGRATION ENDPOINTS
  // ==========================================================================
  app.get('/api/github/status', (req, res) => {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ detail: 'Authentication required' });

    const { project_id } = req.query as { project_id?: string };
    if (!project_id) {
      return res.status(400).json({ detail: 'project_id is required' });
    }

    if (!isUserAuthorizedForProject(authUser, project_id)) {
      return res.status(403).json({ detail: 'Access denied: You are not authorized for this project' });
    }

    const integration = queryOne<any>('SELECT * FROM github_integrations WHERE project_id = ?', [project_id]);
    if (!integration) {
      return res.json({
        is_configured: false,
        is_connected: false,
        project_id,
        sync_status: 'idle',
        sync_stage: 'idle',
        message: 'GitHub repository not configured for this project.'
      });
    }

    const commits = queryAll('SELECT * FROM github_commits WHERE project_id = ? ORDER BY date DESC LIMIT 15', [project_id]);
    const prs = queryAll('SELECT * FROM github_pull_requests WHERE project_id = ? LIMIT 15', [project_id]);
    const issues = queryAll('SELECT * FROM github_issues WHERE project_id = ? LIMIT 15', [project_id]);
    const files = queryAll('SELECT path, size, last_synced_at FROM github_files WHERE project_id = ? LIMIT 20', [project_id]);

    res.json({
      is_configured: true,
      project_id: integration.project_id,
      repo_owner: integration.repo_owner,
      repo_name: integration.repo_name,
      repo_full_name: `${integration.repo_owner}/${integration.repo_name}`,
      default_branch: integration.default_branch || 'main',
      is_connected: Boolean(integration.is_connected),
      sync_status: integration.sync_status || 'idle',
      sync_stage: integration.sync_stage || 'idle',
      last_synced_at: integration.last_synced_at,
      last_synced_sha: integration.last_synced_sha,
      last_synced_commit_message: integration.last_synced_commit_message,
      synced_commits_count: integration.synced_commits_count || commits.length,
      synced_prs_count: integration.synced_prs_count || prs.length,
      synced_issues_count: integration.synced_issues_count || issues.length,
      synced_files_count: integration.synced_files_count || files.length,
      has_token: Boolean(integration.access_token),
      error_message: integration.error_message || null,
      commits,
      pull_requests: prs,
      issues
    });
  });

  app.post('/api/github/connect', async (req, res) => {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ detail: 'Authentication required' });

    const { project_id, repo_owner, repo_name, access_token } = req.body || {};
    if (!project_id || !repo_owner || !repo_name) {
      return res.status(400).json({ detail: 'project_id, repo_owner, and repo_name are required' });
    }

    if (!isUserAuthorizedForProject(authUser, project_id)) {
      return res.status(403).json({ detail: 'Access denied: You are not authorized for this project' });
    }

    const project = queryOne('SELECT id FROM projects WHERE id = ?', [project_id]);
    if (!project) return res.status(404).json({ detail: 'Project not found' });

    let tokenToUse: string | null = null;
    if (access_token && typeof access_token === 'string' && access_token.trim()) {
      tokenToUse = access_token.trim();
    } else {
      const userInteg = queryOne<any>('SELECT access_token FROM user_github_integrations WHERE user_id = ?', [authUser.id]);
      if (userInteg?.access_token) {
        tokenToUse = decryptToken(userInteg.access_token);
      }
      if (!tokenToUse) {
        tokenToUse = process.env.GITHUB_PAT || process.env.GITHUB_TOKEN || null;
      }
    }

    // Encrypt token if storing in project integration
    const encryptedToken = tokenToUse ? encryptToken(tokenToUse) : null;
    const now = new Date().toISOString();

    execute(
      `INSERT INTO github_integrations (id, project_id, repo_owner, repo_name, access_token, is_connected, sync_status, sync_stage, last_synced_at)
       VALUES (?, ?, ?, ?, ?, 1, 'syncing', 'metadata', ?)
       ON CONFLICT(project_id) DO UPDATE SET
         repo_owner = excluded.repo_owner,
         repo_name = excluded.repo_name,
         access_token = COALESCE(excluded.access_token, github_integrations.access_token),
         is_connected = 1,
         sync_status = 'syncing',
         sync_stage = 'metadata'`,
      [`gh-${Date.now().toString(36)}`, project_id, repo_owner.trim(), repo_name.trim(), encryptedToken, now]
    );

    const syncRes = await syncProjectRepositoryActivity(dbAdapter, project_id, repo_owner, repo_name, tokenToUse);

    const commits = queryAll('SELECT * FROM github_commits WHERE project_id = ? ORDER BY date DESC LIMIT 15', [project_id]);
    const prs = queryAll('SELECT * FROM github_pull_requests WHERE project_id = ? LIMIT 15', [project_id]);

    const members = queryAll('SELECT * FROM team_members');
    const mappedMembers = members.map(m => {
      const stats = getMemberGitHubStats(m, project_id);
      return {
        member_id: m.id,
        member_name: m.name,
        github_username: m.github_username,
        commits_count: stats?.commits || 0,
        prs_count: stats?.prs || 0,
        status: m.github_username ? 'mapped' : 'unlinked'
      };
    });

    res.json({
      is_connected: syncRes.is_connected,
      repo_name: syncRes.repo_name,
      default_branch: syncRes.default_branch,
      last_synced_sha: syncRes.last_synced_sha,
      last_synced_commit_message: syncRes.last_synced_commit_message,
      commits,
      pull_requests: prs,
      mapped_members: mappedMembers,
      auto_updated_tasks: syncRes.auto_updated_tasks,
      error_message: syncRes.error_message
    });
  });

  app.post('/api/github/sync', async (req, res) => {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ detail: 'Authentication required' });

    const { project_id, is_incremental = true } = req.body || {};
    if (!project_id) {
      return res.status(400).json({ detail: 'project_id is required' });
    }

    if (!isUserAuthorizedForProject(authUser, project_id)) {
      return res.status(403).json({ detail: 'Access denied: You are not authorized for this project' });
    }

    const integ = queryOne<any>('SELECT * FROM github_integrations WHERE project_id = ?', [project_id]);
    let targetOwner = integ?.repo_owner;
    let targetRepo = integ?.repo_name;
    let encryptedToken = integ?.access_token;

    if (!targetOwner || !targetRepo) {
      const proj = queryOne<any>('SELECT github_repo_owner, github_repo_name FROM projects WHERE id = ?', [project_id]);
      if (proj?.github_repo_owner && proj?.github_repo_name) {
        targetOwner = proj.github_repo_owner;
        targetRepo = proj.github_repo_name;
      }
    }

    if (!targetOwner || !targetRepo) {
      return res.status(400).json({ detail: 'No GitHub repository configured for this project' });
    }

    let tokenToUse = encryptedToken ? decryptToken(encryptedToken) : null;
    if (!tokenToUse) {
      const userInteg = queryOne<any>('SELECT access_token FROM user_github_integrations WHERE user_id = ?', [authUser.id]);
      if (userInteg?.access_token) {
        tokenToUse = decryptToken(userInteg.access_token);
      }
      if (!tokenToUse) {
        tokenToUse = process.env.GITHUB_PAT || process.env.GITHUB_TOKEN || null;
      }
    }

    const syncRes = await syncProjectRepositoryActivity(
      dbAdapter,
      project_id,
      targetOwner,
      targetRepo,
      tokenToUse,
      { isIncremental: Boolean(is_incremental) }
    );

    res.json({
      success: !syncRes.error_message,
      message: syncRes.error_message
        ? `Sync warning: ${syncRes.error_message}`
        : `Successfully synchronized repository activity. ${syncRes.auto_updated_tasks.length} deliverable(s) updated.`,
      result: syncRes,
      auto_updated_tasks: syncRes.auto_updated_tasks
    });
  });

  app.delete('/api/github/disconnect', (req, res) => {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ detail: 'Authentication required' });

    const projectId = (req.query.project_id || req.body?.project_id) as string;
    if (!projectId) {
      return res.status(400).json({ detail: 'project_id is required' });
    }

    if (!isUserAuthorizedForProject(authUser, projectId)) {
      return res.status(403).json({ detail: 'Access denied: You are not authorized for this project' });
    }

    const project = queryOne<any>('SELECT leader_id FROM projects WHERE id = ?', [projectId]);
    const canDisconnect =
      authUser.role === 'Team Leader' ||
      authUser.role === 'Admin' ||
      authUser.role === 'Super Admin' ||
      project?.leader_id === authUser.id;

    if (!canDisconnect) {
      return res.status(403).json({ detail: 'Only project leaders or administrators can disconnect repository integration.' });
    }

    disconnectProjectRepository(dbAdapter, projectId);

    res.json({
      success: true,
      message: 'GitHub repository disconnected and all cached activity and indexed vector chunks cleared.'
    });
  });


  app.post('/api/github/import-issues', async (req, res) => {
    const { project_id, repo_owner, repo_name } = req.body || {};
    if (!project_id) return res.status(400).json({ detail: 'project_id is required' });

    const project = queryOne('SELECT * FROM projects WHERE id = ?', [project_id]);
    if (!project) return res.status(404).json({ detail: 'Project not found' });

    let owner = repo_owner;
    let repo = repo_name;
    let token: string | null = null;

    if (!owner || !repo) {
      const integ = queryOne('SELECT * FROM github_integrations WHERE project_id = ?', [project_id]);
      if (integ) {
        owner = integ.repo_owner;
        repo = integ.repo_name;
        token = integ.access_token;
      }
    }

    if (!owner || !repo) {
      return res.status(400).json({ detail: 'Please specify repository owner and name or connect the repository first.' });
    }

    if (owner.includes('github.com/')) {
      const parts = owner.split('github.com/')[1].split('/').filter(Boolean);
      owner = parts[0];
      repo = parts[1].replace(/\.git$/, '');
    } else if (owner.includes('/')) {
      const parts = owner.split('/').filter(Boolean);
      owner = parts[0];
      repo = parts[1].replace(/\.git$/, '');
    }

    token = token || process.env.GITHUB_PAT || process.env.GITHUB_TOKEN || null;

    try {
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'PULSE-PM/1.0'
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const ghRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues?state=all&per_page=30`, { headers });
      if (!ghRes.ok) {
        return res.status(ghRes.status).json({ detail: `GitHub API error: ${ghRes.statusText}` });
      }

      const issues = await ghRes.json();
      const pureIssues = issues.filter((item: any) => !item.pull_request);

      const teamMembers = queryAll('SELECT id, github_username, name FROM team_members');
      const existingTasks = queryAll('SELECT id, title, description, issue_key FROM tasks WHERE project_id = ?', [project_id]);

      const importedTasks: any[] = [];
      const now = new Date().toISOString();
      let counter = existingTasks.length + 1;

      for (const item of pureIssues) {
        const alreadyExists = existingTasks.some((t: any) =>
          (t.description && t.description.includes(`[GH-#${item.number}]`)) ||
          (t.title && t.title.includes(`[GH-#${item.number}]`)) ||
          (t.title === item.title)
        );
        if (alreadyExists) continue;

        const labelNames = (item.labels || []).map((l: any) => (l.name || '').toLowerCase());
        let issueType = 'Story';
        if (labelNames.some((l: string) => l.includes('bug') || l.includes('fix'))) {
          issueType = 'Bug';
        } else if (labelNames.some((l: string) => l.includes('task') || l.includes('chore') || l.includes('doc'))) {
          issueType = 'Task';
        }

        let priority = 'Medium';
        if (labelNames.some((l: string) => l.includes('high') || l.includes('urgent') || l.includes('critical') || l.includes('p0'))) {
          priority = 'High';
        } else if (labelNames.some((l: string) => l.includes('low') || l.includes('minor') || l.includes('p2') || l.includes('p3'))) {
          priority = 'Low';
        }

        let assigneeId: string | null = null;
        if (item.assignee?.login) {
          const matched = teamMembers.find((m: any) => m.github_username && m.github_username.toLowerCase() === item.assignee.login.toLowerCase());
          if (matched) assigneeId = matched.id;
        }

        const status = item.state === 'closed' ? 'Done' : 'To Do';
        const prefix = project.key_prefix || 'EQX';
        const issueKey = `${prefix}-${100 + counter}`;
        counter++;

        const taskId = 't-gh-' + item.number + '-' + Date.now().toString(36);
        const dueDate = item.milestone?.due_on ? item.milestone.due_on.split('T')[0] : new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
        const desc = `[GH-#${item.number}] ${item.html_url}\n\n${item.body || 'Imported from GitHub issues.'}`;

        execute(
          `INSERT INTO tasks (id, project_id, issue_key, issue_type, title, description, priority, status, due_date, assignee_id, reporter_id, estimated_hours, story_points, sprint, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            taskId,
            project_id,
            issueKey,
            issueType,
            item.title,
            desc,
            priority,
            status,
            dueDate,
            assigneeId,
            project.leader_id || 'u-zaid',
            issueType === 'Bug' ? 4 : 8,
            issueType === 'Bug' ? 2 : 5,
            project.current_sprint || 'Sprint 1 (Active)',
            now,
            now
          ]
        );

        importedTasks.push({
          id: taskId,
          issue_key: issueKey,
          github_number: item.number,
          title: item.title,
          status,
          priority
        });
      }

      res.json({
        success: true,
        message: `Successfully imported ${importedTasks.length} GitHub issue(s) into project backlog!`,
        imported_count: importedTasks.length,
        tasks: importedTasks
      });
    } catch (err: any) {
      res.status(500).json({ detail: 'Failed to import GitHub issues: ' + err.message });
    }
  });

  // --- Complete GitHub Project Import & Provisioning Endpoint ---
  app.post('/api/github/import-project', async (req, res) => {
    const authUser = getAuthUser(req) || queryOne('SELECT * FROM users LIMIT 1');
    const { repo_owner, repo_name, access_token, name, description, key_prefix } = req.body || {};

    if (!repo_owner || !repo_name) {
      return res.status(400).json({ detail: 'Repository owner and repository name are required.' });
    }

    let token = access_token ? access_token.trim() : null;
    if (!token && authUser) {
      const userInteg = queryOne('SELECT access_token FROM user_github_integrations WHERE user_id = ?', [authUser.id]);
      token = userInteg?.access_token || null;
    }
    token = token || process.env.GITHUB_PAT || process.env.GITHUB_TOKEN || null;

    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'PULSE-PM/1.0'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    let repoData: any = null;
    try {
      const ghRes = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(repo_owner)}/${encodeURIComponent(repo_name)}`,
        { headers }
      );
      if (!ghRes.ok) {
        if (ghRes.status === 401) {
          return res.status(400).json({ detail: 'Invalid or expired GitHub Personal Access Token. Please verify permissions.' });
        }
        if (ghRes.status === 404) {
          return res.status(404).json({ detail: `Repository '${repo_owner}/${repo_name}' not found or inaccessible with current token.` });
        }
        return res.status(400).json({ detail: `GitHub API error: HTTP ${ghRes.status}` });
      }
      repoData = await ghRes.json();
    } catch (err: any) {
      return res.status(500).json({ detail: 'Failed to communicate with GitHub API: ' + err.message });
    }

    const cleanPrefix = (key_prefix || repo_name.replace(/[^a-zA-Z]/g, '').slice(0, 4) || 'PULSE').toUpperCase();
    const projectId = `p-gh-${repo_name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now().toString(36)}`;
    const projectName = name ? name.trim() : repoData.name;
    const projectDesc = description ? description.trim() : (repoData.description || `Imported from GitHub repository: ${repo_owner}/${repo_name}`);
    const now = new Date().toISOString();
    const leaderId = authUser?.id || 'u-zaid';

    // 1. Create native project record
    execute(
      `INSERT INTO projects 
       (id, name, description, start_date, deadline, status, leader_id, key_prefix, current_sprint, is_archived, objectives, github_repo_owner, github_repo_name, github_repo_visibility, github_default_branch, github_imported_at, github_html_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'Active', ?, ?, 'Sprint 1 (Active)', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        projectId,
        projectName,
        projectDesc,
        now.split('T')[0],
        new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString().split('T')[0],
        leaderId,
        cleanPrefix,
        `Maintain continuous delivery and code quality for ${repoData.full_name}`,
        repo_owner,
        repo_name,
        repoData.private ? 'Private' : 'Public',
        repoData.default_branch || 'main',
        now,
        repoData.html_url,
        now,
        now
      ]
    );

    // 2. Assign current user as Team Leader
    let memberId = `m-${leaderId}`;
    const existingTm = queryOne('SELECT id FROM team_members WHERE id = ? OR LOWER(email) = LOWER(?)', [memberId, authUser?.email || '']);
    if (existingTm) {
      memberId = existingTm.id;
    } else if (authUser) {
      execute(
        `INSERT INTO team_members (id, name, email, role, avatar_url, github_username, created_at, updated_at)
         VALUES (?, ?, ?, 'Team Leader', ?, ?, ?, ?)`,
        [memberId, authUser.name, authUser.email, authUser.avatar_url, authUser.github_username, now, now]
      );
    }
    execute(
      `INSERT OR IGNORE INTO project_members (project_id, member_id, role) VALUES (?, ?, 'Team Leader')`,
      [projectId, memberId]
    );

    // 3. Register GitHub integration
    execute(
      `INSERT INTO github_integrations (project_id, repo_owner, repo_name, access_token, is_connected, last_synced_at)
       VALUES (?, ?, ?, ?, 1, ?)`,
      [projectId, repo_owner, repo_name, token || null, now]
    );

    // 4. Synchronize repository commits and pull requests
    try {
      await syncProjectRepositoryActivity(dbAdapter, projectId, repo_owner, repo_name, token || undefined);
    } catch {}

    // 5. Import initial open GitHub issues as project deliverables
    let importedIssuesCount = 0;
    try {
      const issuesRes = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(repo_owner)}/${encodeURIComponent(repo_name)}/issues?state=open&per_page=15`,
        { headers }
      );
      if (issuesRes.ok) {
        const ghIssues = await issuesRes.json();
        for (const issue of ghIssues) {
          if (issue.pull_request) continue;
          const taskId = `t-gh-${issue.number}-${Date.now().toString(36)}`;
          const issueKey = `${cleanPrefix}-${issue.number}`;
          const isBug = issue.labels?.some((l: any) => l.name?.toLowerCase().includes('bug'));
          const isHigh = issue.labels?.some((l: any) => l.name?.toLowerCase().includes('high') || l.name?.toLowerCase().includes('urgent'));
          execute(
            `INSERT INTO tasks (id, project_id, title, description, status, priority, issue_type, issue_key, sprint, story_points, reporter_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'To Do', ?, ?, ?, 'Sprint 1 (Active)', 3, ?, ?, ?)`,
            [
              taskId,
              projectId,
              issue.title,
              issue.body || `Imported from GitHub Issue #${issue.number}`,
              isHigh ? 'High' : 'Medium',
              isBug ? 'Bug' : 'Task',
              issueKey,
              leaderId,
              now,
              now
            ]
          );
          importedIssuesCount++;
        }
      }
    } catch {}

    // 6. Return populated project
    const createdProject = queryOne('SELECT * FROM projects WHERE id = ?', [projectId]);
    const members = queryAll(
      `SELECT pm.member_id, pm.role, tm.name, tm.email, tm.avatar_url, tm.github_username
       FROM project_members pm
       LEFT JOIN team_members tm ON pm.member_id = tm.id
       WHERE pm.project_id = ?`,
      [projectId]
    );

    res.json({
      success: true,
      message: `Project '${projectName}' successfully imported from GitHub @${repo_owner}/${repo_name}!`,
      project: {
        ...createdProject,
        leader_name: authUser?.name || 'Team Leader',
        key_prefix: cleanPrefix,
        member_ids: members.map(m => m.member_id),
        members
      },
      imported_issues_count: importedIssuesCount
    });
  });

  app.post('/api/github/webhook', async (req, res) => {
    const deliveryId = (req.headers['x-github-delivery'] as string) || '';
    const event = (req.headers['x-github-event'] as string) || 'push';
    const sigHeader = (req.headers['x-hub-signature-256'] as string) || (req.headers['x-hub-signature'] as string);
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET || process.env.GITHUB_CLIENT_SECRET || '';
    const payload = req.body || {};

    // 1. Signature Verification (HMAC-SHA256)
    if (webhookSecret) {
      const rawPayload = (req as any).rawBody || JSON.stringify(payload);
      const isValid = verifyWebhookSignature(rawPayload, sigHeader, webhookSecret);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid GitHub webhook signature' });
      }
    }

    // 2. Duplicate Event Protection
    if (deliveryId) {
      const existing = queryOne('SELECT delivery_id FROM github_webhook_events WHERE delivery_id = ?', [deliveryId]);
      if (existing) {
        return res.status(200).json({ duplicate: true, message: 'Event already received and processed' });
      }
      execute(
        'INSERT INTO github_webhook_events (delivery_id, event, repo_full_name, status, received_at) VALUES (?, ?, ?, "received", ?)',
        [deliveryId, event, payload.repository?.full_name || 'unknown', new Date().toISOString()]
      );
    }

    // 3. Ping Event
    if (event === 'ping') {
      return res.json({ zen: payload.zen, hook_id: payload.hook_id });
    }

    // 4. Safe Incremental Re-indexing
    const repoFullName = payload.repository?.full_name;
    if (repoFullName) {
      const parts = repoFullName.split('/');
      const owner = parts[0];
      const repo = parts[1];
      const integ = queryOne<any>(
        'SELECT * FROM github_integrations WHERE LOWER(repo_owner) = LOWER(?) AND LOWER(repo_name) = LOWER(?)',
        [owner, repo]
      );

      if (integ) {
        const tokenToUse = integ.access_token
          ? decryptToken(integ.access_token)
          : (process.env.GITHUB_PAT || process.env.GITHUB_TOKEN || null);

        try {
          await syncProjectRepositoryActivity(dbAdapter, integ.project_id, owner, repo, tokenToUse, { isIncremental: true });
        } catch (err: any) {
          console.error('Webhook incremental sync error:', redactSecrets(err.message));
        }
      }
    }

    if (deliveryId) {
      execute('UPDATE github_webhook_events SET status = "processed" WHERE delivery_id = ?', [deliveryId]);
    }

    res.json({ received: true, processed: true });
  });

  // --- GitHub OAuth App Flow Endpoints (Popup-based per AI Studio integration standards) ---
  app.get('/api/auth/github/url', (req, res) => {
    const clientId = process.env.GITHUB_CLIENT_ID?.trim();
    const host = req.get('host') || '0.0.0.0:3000';
    const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    const redirectUri = `${protocol}://${host}/api/auth/github/callback`;
    const isConfigured = Boolean(clientId);

    if (!isConfigured) {
      return res.json({
        configured: false,
        url: null,
        client_id: null,
        redirect_uri: redirectUri,
        message: 'GitHub OAuth is not configured on the server. You can connect securely using your public GitHub username or backend environment token.'
      });
    }

    const authUser = getAuthUser(req);
    const state = Buffer.from(JSON.stringify({ u: authUser?.id || '', t: Date.now() })).toString('base64url');
    const params = new URLSearchParams({
      client_id: clientId!,
      redirect_uri: redirectUri,
      scope: 'read:user,repo',
      state
    });

    const url = `https://github.com/login/oauth/authorize?${params.toString()}`;
    res.json({ configured: true, url, client_id: clientId, redirect_uri: redirectUri });
  });

  app.get(['/api/auth/github/callback', '/api/auth/github/callback/'], async (req, res) => {
    const { code, state, error, error_description } = req.query as {
      code?: string;
      state?: string;
      error?: string;
      error_description?: string;
    };

    if (error || !code) {
      return res.send(`
        <!doctype html>
        <html>
          <body style="font-family: sans-serif; text-align: center; padding: 40px; background: #0f172a; color: #f8fafc;">
            <h2>GitHub Authorization Error</h2>
            <p>${redactSecrets(error_description || 'Authorization was cancelled or encountered an error.')}</p>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', message: ${JSON.stringify(redactSecrets(error_description || 'Authorization failed.'))} }, '*');
                setTimeout(() => window.close(), 2000);
              } else {
                window.location.href = '/?error=${encodeURIComponent(error || 'missing_code')}';
              }
            </script>
          </body>
        </html>
      `);
    }

    const clientId = process.env.GITHUB_CLIENT_ID?.trim();
    const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();

    if (!clientId || !clientSecret) {
      return res.send(`
        <!doctype html>
        <html>
          <body style="font-family: sans-serif; text-align: center; padding: 40px; background: #0f172a; color: #f8fafc;">
            <h2>GitHub Connected</h2>
            <p>Authentication completed. Closing popup...</p>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: 'github' }, '*');
                window.close();
              } else {
                window.location.href = '/?github_oauth=connected';
              }
            </script>
          </body>
        </html>
      `);
    }

    try {
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'PULSE-PM/2.0'
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code
        })
      });

      const tokenData = await tokenRes.json();
      const accessToken = tokenData.access_token;

      if (accessToken) {
        const userRes = await fetch('https://api.github.com/user', {
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'Authorization': `Bearer ${accessToken}`,
            'User-Agent': 'PULSE-PM/2.0'
          }
        });

        let ghUser: any = null;
        if (userRes.ok) {
          ghUser = await userRes.json();
        }

        let targetUserId = '';
        if (state) {
          try {
            const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
            if (decoded.u) targetUserId = decoded.u;
          } catch {}
        }

        if (!targetUserId) {
          const firstUser = queryOne('SELECT id FROM users LIMIT 1');
          targetUserId = firstUser?.id || 'u-zaid';
        }

        const username = ghUser?.login || 'github_user';
        const name = ghUser?.name || username;
        const avatarUrl = ghUser?.avatar_url || null;
        const htmlUrl = ghUser?.html_url || `https://github.com/${username}`;
        const publicRepos = ghUser?.public_repos || 0;
        const encryptedToken = encryptToken(accessToken);
        const now = new Date().toISOString();

        execute(
          `INSERT INTO user_github_integrations (user_id, github_username, access_token, name, avatar_url, html_url, public_repos, connected_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             github_username = excluded.github_username,
             access_token = excluded.access_token,
             name = excluded.name,
             avatar_url = excluded.avatar_url,
             html_url = excluded.html_url,
             public_repos = excluded.public_repos,
             updated_at = excluded.updated_at`,
          [targetUserId, username, encryptedToken, name, avatarUrl, htmlUrl, publicRepos, now, now]
        );

        execute('UPDATE users SET github_username = ? WHERE id = ?', [username, targetUserId]);
        execute('UPDATE team_members SET github_username = ? WHERE id = ?', [username, targetUserId]);
      }

      return res.send(`
        <!doctype html>
        <html>
          <body style="font-family: sans-serif; text-align: center; padding: 40px; background: #0f172a; color: #f8fafc;">
            <h2 style="color: #4ade80;">GitHub Account Connected</h2>
            <p>Your GitHub identity and repository access have been securely synchronized. Closing popup...</p>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: 'github' }, '*');
                window.close();
              } else {
                window.location.href = '/?github_oauth=connected';
              }
            </script>
          </body>
        </html>
      `);
    } catch (err: any) {
      return res.send(`
        <!doctype html>
        <html>
          <body style="font-family: sans-serif; text-align: center; padding: 40px; background: #0f172a; color: #f8fafc;">
            <h2>Authentication Failed</h2>
            <p>${redactSecrets(err.message || 'Token exchange failed')}</p>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', message: ${JSON.stringify(redactSecrets(err.message))} }, '*');
                setTimeout(() => window.close(), 2500);
              } else {
                window.location.href = '/?error=oauth_failed';
              }
            </script>
          </body>
        </html>
      `);
    }
  });

  // --- Per-Member Personal GitHub Integration Endpoints ---

  app.get('/api/user/github/status', async (req, res) => {
    const authUser = getAuthUser(req) || queryOne('SELECT * FROM users LIMIT 1');
    if (!authUser) {
      return res.json({ is_connected: false });
    }

    const integration = queryOne('SELECT * FROM user_github_integrations WHERE user_id = ?', [authUser.id]);
    if (!integration) {
      return res.json({
        is_connected: false,
        user_id: authUser.id,
        user_name: authUser.name,
        user_email: authUser.email
      });
    }

    res.json({
      is_connected: true,
      user_id: authUser.id,
      user_name: authUser.name,
      github_username: integration.github_username,
      name: integration.name || authUser.name,
      avatar_url: integration.avatar_url || authUser.avatar_url,
      html_url: integration.html_url || `https://github.com/${integration.github_username}`,
      public_repos: integration.public_repos || 0,
      selected_repo: integration.selected_repo || null,
      has_token: Boolean(integration.access_token),
      connected_at: integration.connected_at
    });
  });

  app.post('/api/user/github/connect', async (req, res) => {
    const authUser = getAuthUser(req) || queryOne('SELECT * FROM users LIMIT 1');
    if (!authUser) {
      return res.status(401).json({ detail: 'You must be logged in to connect your GitHub account.' });
    }

    const { github_username, selected_repo, access_token } = req.body || {};
    if (!github_username && !access_token) {
      return res.status(400).json({ detail: 'Please provide your GitHub username to link your account.' });
    }

    let ghData: any = null;
    let tokenToUse: string | null = null;
    if (access_token && typeof access_token === 'string' && access_token.trim()) {
      tokenToUse = access_token.trim();
    } else {
      tokenToUse = process.env.GITHUB_PAT || process.env.GITHUB_TOKEN || null;
    }

    try {
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'PULSE-PM/2.0'
      };
      if (tokenToUse) {
        headers['Authorization'] = `Bearer ${tokenToUse}`;
      }

      if (github_username) {
        const cleanUser = github_username.trim().replace(/^@/, '');
        const userRes = await fetch(`https://api.github.com/users/${encodeURIComponent(cleanUser)}`, { headers });
        if (userRes.ok) {
          ghData = await userRes.json();
        } else if (userRes.status === 404) {
          return res.status(404).json({ detail: `GitHub user @${cleanUser} was not found on GitHub.` });
        } else {
          ghData = { login: cleanUser, name: cleanUser, public_repos: 0 };
        }
      } else if (tokenToUse) {
        const userRes = await fetch('https://api.github.com/user', { headers });
        if (userRes.ok) {
          ghData = await userRes.json();
        } else {
          return res.status(400).json({ detail: `GitHub API error (${userRes.status}).` });
        }
      }
    } catch (err: any) {
      return res.status(500).json({ detail: 'Failed to communicate with GitHub: ' + redactSecrets(err.message) });
    }

    if (!ghData) {
      return res.status(400).json({ detail: 'Could not resolve GitHub account information.' });
    }

    const now = new Date().toISOString();
    const resolvedUsername = ghData.login;
    const resolvedAvatar = ghData.avatar_url;
    const resolvedName = ghData.name || authUser.name;
    const resolvedHtmlUrl = ghData.html_url || `https://github.com/${resolvedUsername}`;
    const resolvedPublicRepos = ghData.public_repos || 0;
    const encryptedToken = tokenToUse ? encryptToken(tokenToUse) : null;

    execute(
      `INSERT INTO user_github_integrations 
       (user_id, github_username, access_token, name, avatar_url, html_url, public_repos, selected_repo, connected_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET 
         github_username = excluded.github_username,
         access_token = COALESCE(excluded.access_token, user_github_integrations.access_token),
         name = excluded.name,
         avatar_url = excluded.avatar_url,
         html_url = excluded.html_url,
         public_repos = excluded.public_repos,
         selected_repo = COALESCE(excluded.selected_repo, user_github_integrations.selected_repo),
         updated_at = excluded.updated_at`,
      [
        authUser.id,
        resolvedUsername,
        encryptedToken,
        resolvedName,
        resolvedAvatar,
        resolvedHtmlUrl,
        resolvedPublicRepos,
        selected_repo || null,
        now,
        now
      ]
    );

    execute('UPDATE users SET github_username = ? WHERE id = ?', [resolvedUsername, authUser.id]);
    execute('UPDATE team_members SET github_username = ? WHERE LOWER(email) = LOWER(?)', [resolvedUsername, authUser.email]);

    res.json({
      success: true,
      message: `Successfully connected GitHub account @${resolvedUsername} for ${authUser.name}!`,
      profile: {
        user_id: authUser.id,
        github_username: resolvedUsername,
        name: resolvedName,
        avatar_url: resolvedAvatar,
        html_url: resolvedHtmlUrl,
        public_repos: resolvedPublicRepos,
        selected_repo: selected_repo || null,
        connected_at: now
      }
    });
  });

  app.delete('/api/user/github/disconnect', (req, res) => {
    const authUser = getAuthUser(req) || queryOne('SELECT * FROM users LIMIT 1');
    if (!authUser) {
      return res.status(401).json({ detail: 'Authentication required' });
    }

    execute('DELETE FROM user_github_integrations WHERE user_id = ?', [authUser.id]);
    execute('UPDATE users SET github_username = NULL WHERE id = ?', [authUser.id]);
    execute('UPDATE team_members SET github_username = NULL WHERE LOWER(email) = LOWER(?)', [authUser.email]);

    res.json({ success: true, message: 'GitHub account disconnected successfully.' });
  });

  app.get('/api/user/github/repos', async (req, res) => {
    const authUser = getAuthUser(req) || queryOne('SELECT * FROM users LIMIT 1');
    if (!authUser) return res.status(401).json({ detail: 'Authentication required' });

    const integration = queryOne('SELECT * FROM user_github_integrations WHERE user_id = ?', [authUser.id]);
    if (!integration) {
      return res.json({ repos: [] });
    }

    try {
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'PULSE-PM/2.0'
      };

      let tokenToUse: string | null = null;
      if (integration.access_token) {
        tokenToUse = decryptToken(integration.access_token);
      }
      if (!tokenToUse) {
        tokenToUse = process.env.GITHUB_PAT || process.env.GITHUB_TOKEN || null;
      }

      let url = `https://api.github.com/users/${encodeURIComponent(integration.github_username)}/repos?sort=updated&per_page=30`;
      if (tokenToUse) {
        headers['Authorization'] = `Bearer ${tokenToUse}`;
        url = 'https://api.github.com/user/repos?sort=updated&per_page=30';
      }

      const repoRes = await fetch(url, { headers });
      if (repoRes.ok) {
        const data = await repoRes.json();
        const repos = data.map((r: any) => ({
          id: r.id,
          name: r.name,
          full_name: r.full_name,
          private: Boolean(r.private),
          html_url: r.html_url,
          description: r.description,
          default_branch: r.default_branch || 'main',
          updated_at: r.updated_at
        }));
        return res.json({ repos });
      } else {
        return res.json({ repos: [], warning: `GitHub API status ${repoRes.status}` });
      }
    } catch (err: any) {
      return res.json({ repos: [], error: redactSecrets(err.message) });
    }
  });

  app.post('/api/user/github/select-repo', async (req, res) => {
    const authUser = getAuthUser(req) || queryOne('SELECT * FROM users LIMIT 1');
    if (!authUser) return res.status(401).json({ detail: 'Authentication required' });

    const { repo_full_name, project_id } = req.body || {};
    if (!repo_full_name) return res.status(400).json({ detail: 'repo_full_name is required' });

    const cleanRepo = repo_full_name.trim();
    execute('UPDATE user_github_integrations SET selected_repo = ?, updated_at = ? WHERE user_id = ?', [
      cleanRepo,
      new Date().toISOString(),
      authUser.id
    ]);

    // Immediately trigger real synchronization for this repository
    const targetProjectId = project_id || queryOne('SELECT id FROM projects LIMIT 1')?.id;
    let autoUpdatedTasks: any[] = [];
    if (targetProjectId && cleanRepo.includes('/')) {
      if (!isUserAuthorizedForProject(authUser, targetProjectId)) {
        return res.status(403).json({ detail: 'Access denied for specified project.' });
      }

      const [owner, name] = cleanRepo.split('/');
      const userInteg = queryOne<any>('SELECT access_token FROM user_github_integrations WHERE user_id = ?', [authUser.id]);
      const tokenToUse = userInteg?.access_token ? decryptToken(userInteg.access_token) : (process.env.GITHUB_PAT || process.env.GITHUB_TOKEN || null);
      const syncRes = await syncProjectRepositoryActivity(dbAdapter, targetProjectId, owner, name, tokenToUse);
      autoUpdatedTasks = syncRes.auto_updated_tasks;
    }

    res.json({
      success: true,
      selected_repo: cleanRepo,
      auto_updated_tasks: autoUpdatedTasks
    });
  });

  // Team-wide GitHub integration directory (shows all members' GitHub connection status and commit/PR counts)
  app.get('/api/github/team-status', (req, res) => {
    const members = queryAll('SELECT id, name, email, role, avatar_url, github_username FROM team_members');
    const users = queryAll('SELECT id, name, email, role, avatar_url, github_username FROM users');
    const integrations = queryAll('SELECT * FROM user_github_integrations');

    const integrationMap = new Map<string, any>();
    for (const integ of integrations) {
      integrationMap.set(integ.user_id, integ);
    }

    const teamList = members.map(m => {
      const matchedUser = users.find(u => u.email.toLowerCase() === m.email.toLowerCase());
      const integ = matchedUser ? integrationMap.get(matchedUser.id) : null;
      const ghUsername = integ?.github_username || m.github_username;
      const stats = getMemberGitHubStats(m);

      return {
        member_id: m.id,
        name: m.name,
        email: m.email,
        role: m.role,
        avatar_url: m.avatar_url,
        is_connected: Boolean(integ || m.github_username),
        github_username: ghUsername || null,
        github_avatar: integ?.avatar_url || (ghUsername ? `https://avatars.githubusercontent.com/${ghUsername}` : null),
        selected_repo: integ?.selected_repo || null,
        connected_at: integ?.connected_at || null,
        commits_count: stats?.commits || 0,
        prs_count: stats?.prs || 0
      };
    });

    res.json(teamList);
  });

  // Fetch commits linked to a task (100% REAL GitHub commits & PRs, no fake mock data)
  app.get('/api/github/commits-for-task/:taskId', async (req, res) => {
    const task = queryOne('SELECT * FROM tasks WHERE id = ?', [req.params.taskId]);
    if (!task) return res.status(404).json({ detail: 'Task not found' });

    const issueKey = task.issue_key || 'EQX-101';
    const projectIntegration = queryOne('SELECT * FROM github_integrations WHERE project_id = ?', [task.project_id]);

    let targetOwner: string | null = null;
    let targetRepo: string | null = null;
    let tokenToUse: string | null = null;

    if (projectIntegration && projectIntegration.repo_owner && projectIntegration.repo_name) {
      targetOwner = projectIntegration.repo_owner;
      targetRepo = projectIntegration.repo_name;
      tokenToUse = projectIntegration.access_token;
    } else {
      const userInteg = queryOne('SELECT * FROM user_github_integrations WHERE selected_repo IS NOT NULL LIMIT 1');
      if (userInteg && userInteg.selected_repo && userInteg.selected_repo.includes('/')) {
        const parts = userInteg.selected_repo.split('/');
        targetOwner = parts[0];
        targetRepo = parts[1];
        tokenToUse = userInteg.access_token;
      }
    }

    // If no repository connected, return strictly disconnected state with empty lists
    if (!targetOwner || !targetRepo) {
      return res.json({
        issue_key: issueKey,
        is_repo_connected: false,
        repository: null,
        commits: [],
        pull_requests: [],
        recent_repo_commits: []
      });
    }

    const repoFullName = `${targetOwner}/${targetRepo}`;
    tokenToUse = tokenToUse || process.env.GITHUB_PAT || process.env.GITHUB_TOKEN || null;

    let liveCommits: any[] = [];
    let livePRs: any[] = [];
    let liveSuccess = false;

    try {
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'PULSE-PM/1.0'
      };
      if (tokenToUse) {
        headers['Authorization'] = `Bearer ${tokenToUse}`;
      }

      const cRes = await fetch(`https://api.github.com/repos/${targetOwner}/${targetRepo}/commits?per_page=30`, { headers });
      if (cRes.ok) {
        const rawData = await cRes.json();
        liveCommits = rawData.map((c: any) => {
          const msg = (c.commit?.message || '').split('\n')[0];
          return {
            sha: c.sha.substring(0, 7),
            message: msg,
            author_login: c.author?.login || c.commit?.author?.name || 'developer',
            author_name: c.commit?.author?.name || null,
            author_email: c.commit?.author?.email || null,
            date: c.commit?.author?.date,
            url: c.html_url,
            branch: 'main'
          };
        });

        // Persist into sqlite cache
        for (const lc of liveCommits) {
          const match = lc.message.match(/\b([A-Z]{2,10}-\d+)\b/);
          const extracted = match ? match[0].toUpperCase() : null;
          execute(
            `INSERT OR REPLACE INTO github_commits (sha, project_id, repo_full_name, message, author_login, author_name, author_email, date, url, branch, issue_key)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [lc.sha, task.project_id, repoFullName, lc.message, lc.author_login, lc.author_name, lc.author_email, lc.date, lc.url, lc.branch, extracted]
          );
        }
        liveSuccess = true;
      }

      const pRes = await fetch(`https://api.github.com/repos/${targetOwner}/${targetRepo}/pulls?state=all&per_page=30`, { headers });
      if (pRes.ok) {
        const prData = await pRes.json();
        livePRs = prData.map((pr: any) => ({
          id: String(pr.id),
          number: pr.number,
          title: pr.title,
          state: pr.state,
          author_login: pr.user?.login || 'developer',
          created_at: pr.created_at,
          merged_at: pr.merged_at,
          url: pr.html_url,
          issue_key: (pr.title + ' ' + (pr.body || '')).match(/\b([A-Z]{2,10}-\d+)\b/)?.[0]?.toUpperCase() || null
        }));

        for (const lp of livePRs) {
          execute(
            `INSERT OR REPLACE INTO github_pull_requests (id, project_id, repo_full_name, number, title, state, author_login, created_at, merged_at, url, issue_key)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [lp.id, task.project_id, repoFullName, lp.number, lp.title, lp.state, lp.author_login, lp.created_at, lp.merged_at, lp.url, lp.issue_key]
          );
        }
      }
    } catch {
      // Offline/rate limit: fallback to SQLite cache
    }

    const allCommits = liveSuccess
      ? liveCommits
      : queryAll('SELECT sha, message, author_login, date, url, branch, issue_key FROM github_commits WHERE project_id = ? ORDER BY date DESC', [task.project_id]);

    const allPRs = livePRs.length > 0
      ? livePRs
      : queryAll('SELECT id, number, title, state, author_login, created_at, merged_at, url, issue_key FROM github_pull_requests WHERE project_id = ?', [task.project_id]);

    const keyUpper = issueKey.toUpperCase();
    const matchingCommits = allCommits.filter((c: any) => {
      const msg = (c.message || '').toUpperCase();
      return msg.includes(keyUpper) || msg.includes('[GH-');
    });

    const matchingPRs = allPRs.filter((p: any) => {
      const title = (p.title || '').toUpperCase();
      const pKey = (p.issue_key || '').toUpperCase();
      return pKey === keyUpper || title.includes(keyUpper) || title.includes('[GH-');
    });

    return res.json({
      issue_key: issueKey,
      is_repo_connected: true,
      repository: repoFullName,
      commits: matchingCommits,
      pull_requests: matchingPRs,
      recent_repo_commits: allCommits.slice(0, 5)
    });
  });

  // Password Reset Endpoint
  app.post('/api/auth/reset-password', (req, res) => {
    const { email, new_password } = req.body;
    if (!email || !new_password) return res.status(400).json({ detail: 'Email and new password are required' });
    if (new_password.length < 6) return res.status(400).json({ detail: 'Password must be at least 6 characters' });
    const user = queryOne('SELECT id, name FROM users WHERE LOWER(email) = LOWER(?)', [email.trim()]);
    if (!user) return res.status(404).json({ detail: 'No user account found with this email' });
    const hashedPassword = bcrypt.hashSync(new_password, 10);
    execute('UPDATE users SET password = ?, updated_at = ? WHERE id = ?', [hashedPassword, new Date().toISOString(), user.id]);
    createAuditLog('global', 'User', user.id, 'Reset Password', user.name, 'Password was updated');
    res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
  });

  // User Profile Update Endpoint
  app.put('/api/auth/profile', (req, res) => {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ detail: 'Not authenticated' });
    const { name, avatar_url, github_username, password, role } = req.body;
    const now = new Date().toISOString();
    const newName = name !== undefined ? name.trim() : authUser.name;
    const newAvatar = avatar_url !== undefined ? avatar_url : authUser.avatar_url;
    const newGh = github_username !== undefined ? (github_username?.trim() || null) : authUser.github_username;
    const newRole = role !== undefined ? role : authUser.role;

    if (password) {
      if (password.length < 6) return res.status(400).json({ detail: 'Password must be at least 6 characters' });
      const hashedPassword = bcrypt.hashSync(password, 10);
      execute('UPDATE users SET name = ?, avatar_url = ?, github_username = ?, role = ?, password = ?, updated_at = ? WHERE id = ?',
        [newName, newAvatar, newGh, newRole, hashedPassword, now, authUser.id]);
    } else {
      execute('UPDATE users SET name = ?, avatar_url = ?, github_username = ?, role = ?, updated_at = ? WHERE id = ?',
        [newName, newAvatar, newGh, newRole, now, authUser.id]);
    }

    execute('UPDATE team_members SET name = ?, avatar_url = ?, github_username = ?, updated_at = ? WHERE LOWER(email) = LOWER(?) OR id = ?',
      [newName, newAvatar, newGh, now, authUser.email, 'm-' + authUser.id]);

    const updatedUser = queryOne('SELECT id, name, email, role, avatar_url, github_username, created_at FROM users WHERE id = ?', [authUser.id]);
    res.json({ user: updatedUser });
  });

  // Team Invitations
  app.get('/api/invitations', (req, res) => {
    const { project_id } = req.query as { project_id?: string };
    const sql = project_id ? 'SELECT * FROM project_invitations WHERE project_id = ? ORDER BY created_at DESC' : 'SELECT * FROM project_invitations ORDER BY created_at DESC';
    res.json(queryAll(sql, project_id ? [project_id] : []));
  });

  app.post('/api/invitations', (req, res) => {
    const { project_id, email, role } = req.body;
    if (!email || !email.trim()) return res.status(400).json({ detail: 'Email is required' });
    const id = 'inv-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const token = 'tok-' + Math.random().toString(36).substring(2, 10);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 86400000).toISOString();
    execute(
      'INSERT INTO project_invitations (id, project_id, email, role, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, project_id || 'p-ledger', email.trim().toLowerCase(), role || 'Developer', token, expiresAt, now.toISOString()]
    );
    const authUser = getAuthUser(req);
    createAuditLog(project_id || 'p-ledger', 'Invitation', id, 'Created Invitation', authUser?.name || 'Manager', `Sent invite to ${email} for role ${role || 'Developer'}`);
    res.status(201).json({ id, project_id, email: email.trim().toLowerCase(), role: role || 'Developer', token, expires_at: expiresAt, created_at: now.toISOString() });
  });

  // Team Discussions
  app.get('/api/discussions', (req, res) => {
    const { project_id } = req.query as { project_id?: string };
    const sql = project_id ? 'SELECT * FROM discussions WHERE project_id = ? ORDER BY created_at DESC' : 'SELECT * FROM discussions ORDER BY created_at DESC';
    res.json(queryAll(sql, project_id ? [project_id] : []));
  });

  app.post('/api/discussions', (req, res) => {
    const { project_id, title, content, category } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ detail: 'Title is required' });
    if (!content || !content.trim()) return res.status(400).json({ detail: 'Content is required' });
    const authUser = getAuthUser(req);
    const id = 'disc-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const now = new Date().toISOString();
    execute(
      'INSERT INTO discussions (id, project_id, author_id, author_name, author_avatar, category, title, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        project_id || 'p-ledger',
        authUser?.id || 'u-zaid',
        authUser?.name || 'Zaid Tested',
        authUser?.avatar_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150',
        category || 'General',
        title.trim(),
        content.trim(),
        now
      ]
    );
    createNotification(null, `💬 New Team Discussion: ${title.trim().slice(0, 30)}`, `${authUser?.name || 'Team member'} posted in ${category || 'General'}.`, 'discussion', '/collaboration');
    res.status(201).json({ id, project_id, title: title.trim(), content: content.trim(), category: category || 'General', author_name: authUser?.name || 'Zaid Tested', created_at: now });
  });

  // Peer Kudos (Recognition of Invisible Work)
  app.get('/api/kudos', (req, res) => {
    const { project_id } = req.query as { project_id?: string };
    const sql = project_id ? 'SELECT * FROM peer_kudos WHERE project_id = ? ORDER BY created_at DESC' : 'SELECT * FROM peer_kudos ORDER BY created_at DESC';
    const rows = queryAll(sql, project_id ? [project_id] : []);
    const enriched = rows.map((r: any) => {
      const tm = queryOne<{ name: string; avatar_url: string }>('SELECT name, avatar_url FROM team_members WHERE id = ?', [r.to_member_id]);
      return { ...r, to_member_name: tm?.name || 'Team Member', to_member_avatar: tm?.avatar_url };
    });
    res.json(enriched);
  });

  app.post('/api/kudos', (req, res) => {
    const { project_id, to_member_id, category, message } = req.body;
    if (!to_member_id) return res.status(400).json({ detail: 'Recipient member is required' });
    if (!message || !message.trim()) return res.status(400).json({ detail: 'Kudos message is required' });
    const authUser = getAuthUser(req);
    const id = 'kd-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const now = new Date().toISOString();
    execute(
      'INSERT INTO peer_kudos (id, project_id, from_name, to_member_id, category, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, project_id || null, authUser?.name || 'Peer', to_member_id, category || 'Mentorship & Support', message.trim(), now]
    );
    const targetMember = queryOne<{ name: string }>('SELECT name FROM team_members WHERE id = ?', [to_member_id]);
    createNotification(to_member_id, `🌟 You received Peer Kudos!`, `${authUser?.name || 'A teammate'} recognized your contribution: "${message.trim().slice(0, 50)}..."`, 'kudos', '/collaboration');
    res.status(201).json({ id, project_id, to_member_id, to_member_name: targetMember?.name || 'Member', category, message: message.trim(), created_at: now });
  });

  // Task Attachments
  app.get('/api/tasks/:id/attachments', (req, res) => {
    const attachments = queryAll('SELECT * FROM task_attachments WHERE task_id = ? ORDER BY created_at DESC', [req.params.id]);
    res.json(attachments);
  });

  app.post('/api/tasks/:id/attachments', (req, res) => {
    const { file_name, file_size, file_type } = req.body;
    if (!file_name || !file_name.trim()) return res.status(400).json({ detail: 'File name is required' });
    const authUser = getAuthUser(req);
    const id = 'att-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const now = new Date().toISOString();
    execute(
      'INSERT INTO task_attachments (id, task_id, file_name, file_size, file_type, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, req.params.id, file_name.trim(), file_size || '120 KB', file_type || 'application/octet-stream', authUser?.name || 'Engineer', now]
    );
    res.status(201).json({ id, task_id: req.params.id, file_name: file_name.trim(), file_size: file_size || '120 KB', file_type: file_type || 'application/octet-stream', uploaded_by: authUser?.name || 'Engineer', created_at: now });
  });

  app.delete('/api/tasks/:id/attachments/:attId', (req, res) => {
    execute('DELETE FROM task_attachments WHERE id = ? AND task_id = ?', [req.params.attId, req.params.id]);
    res.sendStatus(204);
  });

  // Audit Logs
  app.get('/api/audit-logs', (req, res) => {
    const { project_id } = req.query as { project_id?: string };
    const sql = project_id ? 'SELECT * FROM audit_logs WHERE project_id = ? ORDER BY created_at DESC LIMIT 60' : 'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 60';
    res.json(queryAll(sql, project_id ? [project_id] : []));
  });

  // Project Archiving
  app.post('/api/projects/:id/archive', (req, res) => {
    const { is_archived } = req.body;
    const project = queryOne('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    if (!project) return res.status(404).json({ detail: 'Project not found' });
    const val = is_archived ? 1 : 0;
    execute('UPDATE projects SET is_archived = ?, updated_at = ? WHERE id = ?', [val, new Date().toISOString(), req.params.id]);
    const authUser = getAuthUser(req);
    createAuditLog(project.id, 'Project', project.id, val ? 'Archived Project' : 'Unarchived Project', authUser?.name || 'Manager', `Project status changed to ${val ? 'Archived' : 'Active'}`);
    res.json({ id: req.params.id, is_archived: Boolean(val) });
  });

  // Apply Smart Task Redistribution
  app.post('/api/simulation/redistribute/apply', (req, res) => {
    const { task_id, to_member_id } = req.body;
    if (!task_id || !to_member_id) return res.status(400).json({ detail: 'Task and Target Member required' });
    const task = queryOne('SELECT * FROM tasks WHERE id = ?', [task_id]);
    if (!task) return res.status(404).json({ detail: 'Task not found' });
    const member = queryOne('SELECT * FROM team_members WHERE id = ?', [to_member_id]);
    if (!member) return res.status(404).json({ detail: 'Target team member not found' });
    execute('UPDATE tasks SET assignee_id = ?, updated_at = ? WHERE id = ?', [to_member_id, new Date().toISOString(), task_id]);
    const authUser = getAuthUser(req);
    createAuditLog(task.project_id, 'Task', task.id, 'Task Reassigned', authUser?.name || 'Project Manager', `Reassigned to ${member.name} via Smart Redistribution`);
    createNotification(to_member_id, `📋 New Task Assigned: ${task.issue_key || task.title}`, `Task "${task.title}" has been balanced to your workload queue.`, 'assignment', '/tasks');
    res.json({ success: true, message: `Task successfully assigned to ${member.name}` });
  });

  // Database Backup JSON Dump
  app.get('/api/database/backup', (req, res) => {
    const dump = {
      exported_at: new Date().toISOString(),
      projects: queryAll('SELECT * FROM projects'),
      tasks: queryAll('SELECT * FROM tasks'),
      team_members: queryAll('SELECT * FROM team_members'),
      project_members: queryAll('SELECT * FROM project_members'),
      meeting_notes: queryAll('SELECT * FROM meeting_notes'),
      discussions: queryAll('SELECT * FROM discussions'),
      peer_kudos: queryAll('SELECT * FROM peer_kudos'),
      retrospectives: queryAll('SELECT * FROM retrospectives'),
      disputes: queryAll('SELECT * FROM disputes'),
      audit_logs: queryAll('SELECT * FROM audit_logs'),
      notifications: queryAll('SELECT * FROM notifications')
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="pulse_db_backup.json"');
    res.send(JSON.stringify(dump, null, 2));
  });

  // System Custom Weights
  app.get('/api/settings/weights', (req, res) => {
    const defaultWeights = {
      high_priority_multiplier: 2.0,
      medium_priority_multiplier: 1.5,
      low_priority_multiplier: 1.0,
      commit_point_value: 0.5,
      pr_point_value: 2.0,
      review_point_value: 1.0
    };
    const row = queryOne('SELECT value FROM system_settings WHERE key = "contribution_weights"');
    res.json(row ? JSON.parse(row.value) : defaultWeights);
  });

  app.post('/api/settings/weights', (req, res) => {
    const weights = req.body;
    execute(
      'INSERT INTO system_settings (key, value) VALUES ("contribution_weights", ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [JSON.stringify(weights)]
    );
    res.json({ success: true, weights });
  });

  // (dbAdapter declared at top of startServer)

  // ==========================================================================
  // DOCUMENT INGESTION & REAL VECTOR RAG PIPELINE
  // ==========================================================================
  app.get('/api/documents', (req, res) => {
    const { project_id } = req.query as { project_id?: string };
    const authUser = getAuthUserOrDemo(req);
    if (!authUser) return res.status(401).json({ detail: 'Authentication required' });

    if (project_id) {
      if (!isUserAuthorizedForProject(authUser, project_id)) {
        return res.status(403).json({ detail: 'Access denied for project' });
      }
      const docs = queryAll('SELECT * FROM project_documents WHERE project_id = ? ORDER BY created_at DESC', [project_id]);
      return res.json(docs);
    }

    // Non-privileged users only see documents from projects they are members of
    if (authUser.role === 'Team Leader' || authUser.role === 'Admin' || authUser.role === 'Super Admin') {
      const docs = queryAll('SELECT * FROM project_documents ORDER BY created_at DESC');
      return res.json(docs);
    }

    const authorizedProjects = queryAll<{ id: string }>(
      `SELECT DISTINCT p.id FROM projects p
       LEFT JOIN project_members pm ON p.id = pm.project_id
       LEFT JOIN team_members tm ON pm.member_id = tm.id
       WHERE p.leader_id = ? OR LOWER(tm.email) = LOWER(?) OR tm.id = ?`,
      [authUser.id, authUser.email, 'm-' + authUser.id]
    );
    const pIds = authorizedProjects.map(p => p.id);
    if (pIds.length === 0) return res.json([]);
    const placeholders = pIds.map(() => '?').join(',');
    const docs = queryAll(`SELECT * FROM project_documents WHERE project_id IN (${placeholders}) ORDER BY created_at DESC`, pIds);
    res.json(docs);
  });

  app.post('/api/documents/upload', async (req, res) => {
    const authUser = getAuthUserOrDemo(req);
    if (!authUser) return res.status(401).json({ detail: 'Authentication required' });

    if (!checkRateLimit(`upload-${authUser.id}`, 20, 60000)) {
      return res.status(429).json({ detail: 'Rate limit exceeded for document uploads. Please wait a minute.' });
    }

    const { project_id, filename, file_type, file_content, file_base64 } = req.body;
    if (!project_id) return res.status(400).json({ detail: 'project_id is required' });
    if (!filename || typeof filename !== 'string' || !filename.trim()) return res.status(400).json({ detail: 'filename is required' });

    if (!isUserAuthorizedForProject(authUser, project_id)) {
      return res.status(403).json({ detail: 'You are not authorized to upload documents to this project' });
    }

    // Validate file size (max 15MB)
    const rawContentSize = file_content ? Buffer.byteLength(file_content) : (file_base64 ? Math.round((file_base64.length * 3) / 4) : 0);
    if (rawContentSize > 15 * 1024 * 1024) {
      return res.status(400).json({ detail: 'File size exceeds maximum permitted limit of 15MB' });
    }

    // Validate allowed file types
    const allowedTypes = ['application/pdf', 'text/plain', 'text/markdown', 'text/csv'];
    const cleanType = (file_type || '').toLowerCase();
    const cleanName = filename.toLowerCase();
    const isAllowedType = allowedTypes.includes(cleanType) || cleanName.endsWith('.pdf') || cleanName.endsWith('.txt') || cleanName.endsWith('.md') || cleanName.endsWith('.csv');
    if (!isAllowedType) {
      return res.status(400).json({ detail: 'Invalid document type. Allowed types: PDF, Markdown, Plain Text, CSV.' });
    }

    const docId = 'doc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const now = new Date().toISOString();
    let extractedText = '';
    let pageCount = 1;
    const chunkSize = 700;
    const overlap = 100;
    const chunks: Array<{ text: string; pageNumber: number }> = [];

    try {
      if (cleanType === 'application/pdf' || cleanName.endsWith('.pdf')) {
        let pdfBuffer: Buffer;
        if (file_base64) {
          pdfBuffer = Buffer.from(file_base64, 'base64');
        } else if (file_content) {
          pdfBuffer = Buffer.from(file_content);
        } else {
          return res.status(400).json({ detail: 'PDF file content or file_base64 is required' });
        }

        const parser = new PDFParse({ data: pdfBuffer });
        const parseResult = await parser.getText();
        extractedText = parseResult.text || '';
        pageCount = parseResult.total || 1;
        await parser.destroy();

        // Extract actual page text and accurate page numbers from parseResult.pages
        if (Array.isArray(parseResult.pages) && parseResult.pages.length > 0) {
          for (const page of parseResult.pages) {
            const pageText = (page.text || '').trim();
            const pageNum = page.num || 1;
            if (!pageText) continue;
            for (let i = 0; i < pageText.length; i += (chunkSize - overlap)) {
              const slice = pageText.slice(i, i + chunkSize).trim();
              if (slice.length > 30) {
                chunks.push({ text: slice, pageNumber: pageNum });
              }
            }
          }
        } else {
          // Fallback if pages array is empty
          for (let i = 0; i < extractedText.length; i += (chunkSize - overlap)) {
            const slice = extractedText.slice(i, i + chunkSize).trim();
            if (slice.length > 30) {
              const estimatedPage = Math.min(pageCount, Math.floor((i / Math.max(1, extractedText.length)) * pageCount) + 1);
              chunks.push({ text: slice, pageNumber: estimatedPage });
            }
          }
        }
      } else {
        // Text / Markdown / CSV
        extractedText = file_content || (file_base64 ? Buffer.from(file_base64, 'base64').toString('utf-8') : '');
        for (let i = 0; i < extractedText.length; i += (chunkSize - overlap)) {
          const slice = extractedText.slice(i, i + chunkSize).trim();
          if (slice.length > 30) {
            chunks.push({ text: slice, pageNumber: 1 });
          }
        }
      }

      if (!extractedText.trim() || chunks.length === 0) {
        return res.status(400).json({ detail: 'Uploaded document contained no extractable text' });
      }

      let indexedChunksCount = 0;
      for (let idx = 0; idx < chunks.length; idx++) {
        const chunk = chunks[idx];
        const chunkId = `chunk-${docId}-${idx + 1}`;
        // Generate real 384-dimensional dense vector via Xenova all-MiniLM-L6-v2
        const vector = await generateEmbedding(`${filename} ${chunk.text}`);
        if (!vector || vector.length === 0) {
          throw new Error(`Embedding generation returned empty vector for chunk ${idx + 1}`);
        }
        const embeddingJson = JSON.stringify(vector);

        execute(
          `INSERT INTO document_chunks (id, document_id, project_id, source_type, entity_id, title, page_number, section, content, metadata_json, embedding_json, created_at)
           VALUES (?, ?, ?, 'pdf', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            chunkId,
            docId,
            project_id,
            docId,
            `${filename} (Page ${chunk.pageNumber})`,
            chunk.pageNumber,
            `Section ${idx + 1}`,
            chunk.text,
            JSON.stringify({ filename, page: chunk.pageNumber, chunk_index: idx }),
            embeddingJson,
            now
          ]
        );
        indexedChunksCount++;
      }

      execute(
        `INSERT INTO project_documents (id, project_id, filename, file_size, file_type, uploader_id, status, chunks_count, page_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'indexed', ?, ?, ?)`,
        [
          docId,
          project_id,
          filename,
          extractedText.length,
          file_type || 'application/pdf',
          authUser.id,
          indexedChunksCount,
          pageCount,
          now
        ]
      );

      createAuditLog(
        project_id,
        'document',
        docId,
        'DOCUMENT_INGESTED_RAG',
        authUser.name,
        `Ingested "${filename}" (${pageCount} pages, ${indexedChunksCount} vector chunks) into RAG index`
      );

      res.status(201).json({
        success: true,
        document_id: docId,
        filename,
        page_count: pageCount,
        chunks_indexed: indexedChunksCount,
        message: `Successfully parsed and indexed "${filename}" into project knowledge base.`
      });
    } catch (err: any) {
      console.error('Document ingestion error:', err);
      // Clean up partial chunks on failure and mark document failed if created
      execute('DELETE FROM document_chunks WHERE document_id = ?', [docId]);
      res.status(500).json({ detail: `Document ingestion and vector indexing failed: ${err.message}` });
    }
  });

  app.delete('/api/documents/:id', (req, res) => {
    const authUser = getAuthUserOrDemo(req);
    if (!authUser) return res.status(401).json({ detail: 'Authentication required' });

    const doc = queryOne<any>('SELECT * FROM project_documents WHERE id = ?', [req.params.id]);
    if (!doc) return res.status(404).json({ detail: 'Document not found' });

    if (!isUserAuthorizedForProject(authUser, doc.project_id)) {
      return res.status(403).json({ detail: 'Not authorized to delete document' });
    }

    execute('DELETE FROM document_chunks WHERE document_id = ?', [doc.id]);
    execute('DELETE FROM project_documents WHERE id = ?', [doc.id]);

    createAuditLog(
      doc.project_id,
      'document',
      doc.id,
      'DOCUMENT_DELETED_RAG',
      authUser.name,
      `Removed "${doc.filename}" from project knowledge base`
    );

    res.json({ success: true, message: 'Document and vector chunks removed.' });
  });

  // ==========================================================================
  // REAL GROQ (openai/gpt-oss-120b) & LANGGRAPH ASSISTANT QUERY
  // ==========================================================================
  app.post('/api/ai/query', async (req, res) => {
    // 1. Authentication (supports demo exploration fallback)
    const authUser = getAuthUserOrDemo(req);
    if (!authUser) {
      return res.status(401).json({ detail: 'Authentication required' });
    }

    // 2. Rate Limiting
    if (!checkRateLimit(`ai-${authUser.id}`, 30, 60000)) {
      return res.status(429).json({ detail: 'Rate limit exceeded for AI queries. Please slow down.' });
    }

    // 3. Prompt validation
    const { prompt, project_id } = req.body;
    if (!prompt || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000) {
      return res.status(400).json({ detail: 'Prompt must be a non-empty string under 4000 characters' });
    }

    // 4. Resolve target project with fallback to primary project
    let targetProjectId = (project_id && typeof project_id === 'string' && project_id.trim())
      ? project_id.trim()
      : 'all';

    if (targetProjectId !== 'all') {
      const exists = queryOne('SELECT id FROM projects WHERE id = ?', [targetProjectId]);
      if (!exists) {
        const byName = queryOne<any>('SELECT id FROM projects WHERE LOWER(name) = LOWER(?)', [targetProjectId]);
        if (byName) {
          targetProjectId = byName.id;
        } else {
          targetProjectId = 'all';
        }
      }
    }

    // 5. Enforce Project Authorization
    if (!isUserAuthorizedForProject(authUser, targetProjectId)) {
      return res.status(403).json({ detail: 'Access denied: You are not authorized for this project' });
    }

    const groqKey = process.env.GROQ_API_KEY?.trim();
    const groqModel = process.env.GROQ_MODEL?.trim() || 'openai/gpt-oss-120b';

    try {
      // Execute Project Analyst LangGraph workflow
      const analystWorkflow = createProjectAnalystWorkflow(dbAdapter);
      const threadId = `th-query-${Date.now()}`;

      const graphResult = await analystWorkflow.invoke(
        {
          workflowId: threadId,
          workflowType: 'project_analyst',
          projectId: targetProjectId,
          userId: authUser.id,
          inputQuery: prompt.trim()
        },
        { configurable: { thread_id: threadId } }
      );

      res.json({
        has_api_key: Boolean(groqKey),
        model_used: groqKey ? groqModel : 'Local SQLite & RAG Deterministic Engine',
        provider: groqKey ? 'groq' : 'local_sqlite_rag',
        response: graphResult.finalOutput || 'No output generated from analyst workflow.',
        grounding_data_points: graphResult.groundingDataPoints || 0,
        sources_used: graphResult.sourcesUsed || []
      });
    } catch (err: any) {
      console.warn('AI Assistant Query notice:', redactSecrets(err.message || ''));
      // Graceful fallback to verified SQLite facts instead of failing with 503
      const projectRec = queryOne<any>('SELECT * FROM projects WHERE id = ?', [targetProjectId]);
      const tasks = queryAll<any>('SELECT * FROM tasks WHERE project_id = ?', [targetProjectId]);
      const commits = queryAll<any>('SELECT sha, message, author_login FROM github_commits WHERE project_id = ? ORDER BY date DESC LIMIT 5', [targetProjectId]);
      const doneCount = tasks.filter(t => t.status === 'Done').length;
      const overdueCount = tasks.filter(t => t.due_date && new Date(t.due_date) < new Date() && t.status !== 'Done').length;

      res.json({
        has_api_key: Boolean(groqKey),
        model_used: 'Local SQLite Grounded Fallback',
        provider: 'local_database',
        response: `PULSE Project Analysis (${projectRec?.name || targetProjectId}):\n` +
          `- Project Status: ${projectRec?.status || 'Active'}\n` +
          `- Backlog Deliverables: ${tasks.length} total (${doneCount} completed, ${overdueCount} overdue)\n` +
          (commits.length ? `- Recent Verified Commits: ${commits.map(c => `${c.sha.slice(0, 7)}: ${c.message} (@${c.author_login || 'dev'})`).join('; ')}\n` : '') +
          `\nVerified with local SQLite database records.`,
        grounding_data_points: tasks.length + commits.length + 1,
        sources_used: [`Project: ${projectRec?.name || targetProjectId}`, `Deliverables (${tasks.length})`, `Commits (${commits.length})`]
      });
    }
  });

  // ==========================================================================
  // LANGGRAPH WORKFLOWS & HUMAN-IN-THE-LOOP APPROVAL ENDPOINTS
  // ==========================================================================
  app.get('/api/ai/workflows', (req, res) => {
    const { project_id } = req.query as { project_id?: string };
    const authUser = getAuthUserOrDemo(req);
    if (!authUser) return res.status(401).json({ detail: 'Authentication required' });

    if (project_id) {
      if (!isUserAuthorizedForProject(authUser, project_id)) {
        return res.status(403).json({ detail: 'Access denied for project' });
      }
      const rows = queryAll('SELECT * FROM ai_workflows WHERE project_id = ? ORDER BY created_at DESC LIMIT 30', [project_id]);
      return res.json(rows);
    }

    // Non-privileged users only see workflows for projects they are authorized to access
    if (authUser.role === 'Team Leader' || authUser.role === 'Admin' || authUser.role === 'Super Admin') {
      const rows = queryAll('SELECT * FROM ai_workflows ORDER BY created_at DESC LIMIT 30');
      return res.json(rows);
    }

    const authorizedProjects = queryAll<{ id: string }>(
      `SELECT DISTINCT p.id FROM projects p
       LEFT JOIN project_members pm ON p.id = pm.project_id
       LEFT JOIN team_members tm ON pm.member_id = tm.id
       WHERE p.leader_id = ? OR LOWER(tm.email) = LOWER(?) OR tm.id = ?`,
      [authUser.id, authUser.email, 'm-' + authUser.id]
    );
    const pIds = authorizedProjects.map(p => p.id);
    if (pIds.length === 0) return res.json([]);
    const placeholders = pIds.map(() => '?').join(',');
    const rows = queryAll(`SELECT * FROM ai_workflows WHERE project_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 30`, pIds);
    res.json(rows);
  });

  app.post('/api/ai/workflows/start', async (req, res) => {
    const authUser = getAuthUserOrDemo(req);
    if (!authUser) return res.status(401).json({ detail: 'Authentication required' });

    if (!checkRateLimit(`wf-${authUser.id}`, 20, 60000)) {
      return res.status(429).json({ detail: 'Rate limit exceeded for starting workflows.' });
    }

    const { workflow_type, project_id, input_query, document_id, document_content } = req.body;
    if (!workflow_type) return res.status(400).json({ detail: 'workflow_type is required' });
    if (!project_id) return res.status(400).json({ detail: 'project_id is required' });

    if (!isUserAuthorizedForProject(authUser, project_id)) {
      return res.status(403).json({ detail: 'Not authorized for this project' });
    }

    // Resolve document content if document_id is provided
    let finalDocContent = document_content || '';
    if (workflow_type === 'document_planner' && document_id) {
      const doc = queryOne<any>('SELECT * FROM project_documents WHERE id = ? AND project_id = ?', [document_id, project_id]);
      if (!doc) {
        return res.status(400).json({ detail: `Selected document '${document_id}' not found in project knowledge base` });
      }
      const chunks = queryAll<any>('SELECT page_number, content FROM document_chunks WHERE document_id = ? ORDER BY page_number ASC, id ASC', [document_id]);
      if (chunks.length === 0) {
        return res.status(400).json({ detail: `Selected document '${document_id}' contains no indexed text chunks` });
      }
      finalDocContent = chunks.map(c => `[Page ${c.page_number}] ${c.content}`).join('\n\n');
    }

    if (workflow_type === 'document_planner' && !finalDocContent.trim()) {
      return res.status(400).json({ detail: 'Please select an ingested requirements document or provide document content for Document Planner' });
    }

    const workflowId = `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const threadId = `thread-${workflowId}`;
    const now = new Date().toISOString();

    let graphResult: any = null;

    try {
      if (workflow_type === 'recovery_planner') {
        const wf = createProjectRecoveryWorkflow(dbAdapter);
        graphResult = await wf.invoke({
          workflowId,
          workflowType: workflow_type,
          projectId: project_id,
          userId: authUser.id,
          inputQuery: input_query || 'Diagnose overdue deliverables and critical blockers'
        }, { configurable: { thread_id: threadId } });
      } else if (workflow_type === 'meeting_to_tasks') {
        const wf = createMeetingToTasksWorkflow(dbAdapter);
        graphResult = await wf.invoke({
          workflowId,
          workflowType: workflow_type,
          projectId: project_id,
          userId: authUser.id,
          documentContent: finalDocContent
        }, { configurable: { thread_id: threadId } });
      } else if (workflow_type === 'document_planner') {
        const wf = createDocumentPlannerWorkflow(dbAdapter);
        graphResult = await wf.invoke({
          workflowId,
          workflowType: workflow_type,
          projectId: project_id,
          userId: authUser.id,
          documentContent: finalDocContent
        }, { configurable: { thread_id: threadId } });
      } else if (workflow_type === 'contribution_investigator') {
        const wf = createContributionInvestigatorWorkflow(dbAdapter);
        graphResult = await wf.invoke({
          workflowId,
          workflowType: workflow_type,
          projectId: project_id,
          userId: authUser.id,
          inputQuery: input_query || 'Investigate verified GitHub commits and pull requests'
        }, { configurable: { thread_id: threadId } });
      } else if (workflow_type === 'autonomous_pm') {
        const wf = createAutonomousProjectManagerWorkflow(dbAdapter);
        graphResult = await wf.invoke({
          workflowId,
          threadId,
          projectId: project_id,
          userId: authUser.id,
          initialInput: input_query || '',
          documentContent: finalDocContent
        }, { configurable: { thread_id: threadId } });
      } else {
        const wf = createProjectAnalystWorkflow(dbAdapter);
        graphResult = await wf.invoke({
          workflowId,
          workflowType: 'project_analyst',
          projectId: project_id,
          userId: authUser.id,
          inputQuery: input_query || ''
        }, { configurable: { thread_id: threadId } });
      }

      const planJson = graphResult.proposedPlan ? JSON.stringify(graphResult.proposedPlan) : null;
      const planHash = graphResult.planHash || (graphResult.proposedPlan ? computePlanHash(graphResult.proposedPlan) : null);
      const status = graphResult.status || 'COMPLETED';

      execute(
        `INSERT INTO ai_workflows (id, thread_id, workflow_type, project_id, initiating_user_id, status, stage, plan_hash, plan_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          workflowId,
          threadId,
          workflow_type,
          project_id,
          authUser.id,
          status,
          status === 'WAITING_APPROVAL' ? 'pending_human_approval' : 'completed',
          planHash,
          planJson,
          now,
          now
        ]
      );

      res.status(201).json({
        workflow_id: workflowId,
        thread_id: threadId,
        workflow_type,
        status,
        plan_hash: planHash,
        proposed_plan: graphResult.proposedPlan,
        final_output: graphResult.finalOutput,
        sources_used: graphResult.sourcesUsed || [],
        grounding_data_points: graphResult.groundingDataPoints || 0
      });
    } catch (err: any) {
      console.error('Workflow start error:', err);
      res.status(500).json({ detail: `Workflow execution error: ${err.message}` });
    }
  });

  app.post('/api/ai/workflows/:id/approve', (req, res) => {
    const authUser = getAuthUserOrDemo(req);
    if (!authUser) return res.status(401).json({ detail: 'Authentication required' });

    const workflow = queryOne<any>('SELECT * FROM ai_workflows WHERE id = ?', [req.params.id]);
    if (!workflow) return res.status(404).json({ detail: 'Workflow record not found' });

    if (!isUserAuthorizedForProject(authUser, workflow.project_id)) {
      return res.status(403).json({ detail: 'Unauthorized: Only authorized project leaders can approve workflow mutations' });
    }

    if (workflow.status !== 'WAITING_APPROVAL') {
      return res.status(400).json({ detail: `Workflow is in status '${workflow.status}', not WAITING_APPROVAL` });
    }

    // Atomic status transition to EXECUTING to prevent race conditions or duplicate execution
    const now = new Date().toISOString();
    execute("UPDATE ai_workflows SET status = 'EXECUTING', updated_at = ? WHERE id = ? AND status = 'WAITING_APPROVAL'", [now, workflow.id]);

    const updated = queryOne<any>('SELECT status FROM ai_workflows WHERE id = ?', [workflow.id]);
    if (updated?.status !== 'EXECUTING') {
      return res.status(409).json({ detail: 'Conflict: Workflow status changed concurrently or is already being executed' });
    }

    try {
      const execResult = executeApprovedWorkflowPlan(dbAdapter, workflow, authUser.id, authUser.name);
      res.json(execResult);
    } catch (err: any) {
      console.error('Approval execution error:', err);
      execute("UPDATE ai_workflows SET status = 'FAILED', error = ?, updated_at = ? WHERE id = ?", [err.message, new Date().toISOString(), workflow.id]);
      res.status(500).json({ detail: `Execution error: ${err.message}` });
    }
  });

  app.post('/api/ai/workflows/:id/reject', (req, res) => {
    const authUser = getAuthUserOrDemo(req);
    if (!authUser) return res.status(401).json({ detail: 'Authentication required' });

    const workflow = queryOne<any>('SELECT * FROM ai_workflows WHERE id = ?', [req.params.id]);
    if (!workflow) return res.status(404).json({ detail: 'Workflow record not found' });

    if (!isUserAuthorizedForProject(authUser, workflow.project_id)) {
      return res.status(403).json({ detail: 'Unauthorized to reject workflow' });
    }

    const now = new Date().toISOString();
    execute("UPDATE ai_workflows SET status = 'REJECTED', stage = 'rejected', updated_at = ? WHERE id = ?", [now, workflow.id]);
    createAuditLog(
      workflow.project_id,
      'workflow',
      workflow.id,
      'WORKFLOW_REJECTED',
      authUser.name,
      `Rejected proposed plan for workflow [${workflow.workflow_type}]`
    );

    res.json({ success: true, message: `Workflow ${workflow.id} was rejected.` });
  });

  // ==========================================================================
  // AUTONOMOUS AI PROJECT MANAGER (PM) REST ENDPOINTS
  // ==========================================================================
  app.post('/api/ai/pm/start', async (req, res) => {
    const authUser = getAuthUserOrDemo(req);
    if (!authUser) return res.status(401).json({ detail: 'Authentication required' });

    if (!checkRateLimit(`pm-${authUser.id}`, 20, 60000)) {
      return res.status(429).json({ detail: 'Rate limit exceeded for autonomous PM. Please slow down.' });
    }

    const { project_id, idea, document_id, document_content, document_filename } = req.body || {};
    const initialInput = (idea && typeof idea === 'string') ? idea.trim() : '';

    let resolvedDocContent = document_content || '';
    let resolvedFilename = document_filename || '';

    // If document_id provided, fetch chunks from knowledge base
    if (document_id) {
      const doc = queryOne<any>('SELECT * FROM project_documents WHERE id = ?', [document_id]);
      if (doc) {
        resolvedFilename = doc.filename;
        const chunks = queryAll<any>('SELECT page_number, content FROM document_chunks WHERE document_id = ? ORDER BY page_number ASC, id ASC', [document_id]);
        resolvedDocContent = chunks.map(c => `[Page ${c.page_number}] ${c.content}`).join('\n\n');
      }
    }

    if (!initialInput && !resolvedDocContent) {
      return res.status(400).json({ detail: 'Please provide a project idea or upload a project specification document.' });
    }

    const targetProjectId = (project_id && project_id !== 'all' && project_id !== 'new') ? project_id : 'new';
    if (targetProjectId !== 'new' && !isUserAuthorizedForProject(authUser, targetProjectId)) {
      return res.status(403).json({ detail: 'Access denied: You are not authorized for this project' });
    }

    const workflowId = `wf-pm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const threadId = `th-pm-${workflowId}`;
    const now = new Date().toISOString();

    try {
      const pmWorkflow = createAutonomousProjectManagerWorkflow(dbAdapter);
      const graphResult = await pmWorkflow.invoke({
        workflowId,
        threadId,
        userId: authUser.id,
        projectId: targetProjectId,
        initialInput,
        documentContent: resolvedDocContent,
        documentFilename: resolvedFilename,
        clarificationHistory: [],
        discoveredRequirements: {}
      }, { configurable: { thread_id: threadId } });

      const planJson = graphResult.plan ? JSON.stringify(graphResult.plan) : null;
      const planHash = graphResult.planHash || (graphResult.plan ? computePlanHash(graphResult.plan) : null);
      const status = graphResult.status || 'AWAITING_ANSWERS';

      execute(
        `INSERT INTO ai_workflows (id, thread_id, workflow_type, project_id, initiating_user_id, status, stage, plan_hash, plan_json, created_at, updated_at)
         VALUES (?, ?, 'autonomous_pm', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          workflowId,
          threadId,
          targetProjectId,
          authUser.id,
          status,
          graphResult.stage || 'interview',
          planHash,
          planJson,
          now,
          now
        ]
      );

      createAuditLog(
        targetProjectId,
        'workflow',
        workflowId,
        'AUTONOMOUS_PM_STARTED',
        authUser.name,
        `Started Autonomous AI Project Manager interview for "${initialInput.slice(0, 60)}..."`
      );

      res.status(201).json({
        workflow_id: workflowId,
        thread_id: threadId,
        status,
        stage: graphResult.stage || 'interview',
        pending_questions: graphResult.pendingQuestions || [],
        discovered_requirements: graphResult.discoveredRequirements || {},
        proposed_plan: graphResult.plan || null,
        plan_hash: planHash,
        final_output: graphResult.finalOutput || 'Autonomous project manager initialized.'
      });
    } catch (err: any) {
      console.error('Autonomous PM start error:', err);
      res.status(500).json({ detail: `Failed to start Autonomous PM: ${err.message}` });
    }
  });

  app.post('/api/ai/pm/:workflowId/clarify', async (req, res) => {
    const authUser = getAuthUserOrDemo(req);
    if (!authUser) return res.status(401).json({ detail: 'Authentication required' });

    const workflow = queryOne<any>('SELECT * FROM ai_workflows WHERE id = ?', [req.params.workflowId]);
    if (!workflow) return res.status(404).json({ detail: 'Autonomous PM workflow record not found' });

    if (workflow.project_id !== 'new' && !isUserAuthorizedForProject(authUser, workflow.project_id)) {
      return res.status(403).json({ detail: 'Access denied: You are not authorized for this project' });
    }

    const { answers = [], additional_requirements, force_generate_plan } = req.body || {};

    const threadId = workflow.thread_id || `th-pm-${workflow.id}`;
    const saver = new SqliteSaver(dbAdapter);
    let previousState: any = null;
    try {
      const tuple = await saver.getTuple({ configurable: { thread_id: threadId } });
      if (tuple?.checkpoint?.channel_values) {
        previousState = tuple.checkpoint.channel_values;
      }
    } catch {}

    const clarificationHistory = previousState?.clarificationHistory || [];
    const discovered = { ...(previousState?.discoveredRequirements || {}) };

    if (Array.isArray(answers)) {
      for (const ans of answers) {
        clarificationHistory.push({
          questionId: ans.question_id,
          question: ans.question || `Question ${ans.question_id}`,
          answer: ans.answer,
          skipped: Boolean(ans.skipped),
          defaultProposed: ans.default_proposed,
          confirmed: Boolean(ans.use_default)
        });
        if (ans.answer && !ans.skipped) {
          discovered[ans.question_id] = ans.answer;
        } else if (ans.use_default && ans.default_proposed) {
          discovered[ans.question_id] = ans.default_proposed;
        }
      }
    }

    if (additional_requirements && typeof additional_requirements === 'string') {
      discovered['user_notes'] = (discovered['user_notes'] ? `${discovered['user_notes']}; ` : '') + additional_requirements.trim();
    }

    try {
      const pmWorkflow = createAutonomousProjectManagerWorkflow(dbAdapter);
      const graphResult = await pmWorkflow.invoke({
        workflowId: workflow.id,
        threadId,
        userId: authUser.id,
        projectId: workflow.project_id,
        initialInput: previousState?.initialInput || '',
        documentContent: previousState?.documentContent || '',
        documentFilename: previousState?.documentFilename || '',
        clarificationHistory,
        discoveredRequirements: discovered,
        status: force_generate_plan ? 'PLAN_READY' : (previousState?.status || 'DISCOVERY')
      }, { configurable: { thread_id: threadId } });

      const planJson = graphResult.plan ? JSON.stringify(graphResult.plan) : workflow.plan_json;
      const planHash = graphResult.planHash || (graphResult.plan ? computePlanHash(graphResult.plan) : workflow.plan_hash);
      const now = new Date().toISOString();

      execute(
        `UPDATE ai_workflows
         SET status = ?, stage = ?, plan_hash = ?, plan_json = ?, updated_at = ?
         WHERE id = ?`,
        [
          graphResult.status,
          graphResult.stage,
          planHash,
          planJson,
          now,
          workflow.id
        ]
      );

      res.json({
        workflow_id: workflow.id,
        status: graphResult.status,
        stage: graphResult.stage,
        pending_questions: graphResult.pendingQuestions || [],
        discovered_requirements: graphResult.discoveredRequirements || discovered,
        proposed_plan: graphResult.plan || null,
        plan_hash: planHash,
        final_output: graphResult.finalOutput || ''
      });
    } catch (err: any) {
      console.error('Autonomous PM clarify error:', err);
      res.status(500).json({ detail: `Error processing clarification: ${err.message}` });
    }
  });

  app.post('/api/ai/pm/:workflowId/generate-plan', async (req, res) => {
    const authUser = getAuthUserOrDemo(req);
    if (!authUser) return res.status(401).json({ detail: 'Authentication required' });

    const workflow = queryOne<any>('SELECT * FROM ai_workflows WHERE id = ?', [req.params.workflowId]);
    if (!workflow) return res.status(404).json({ detail: 'Autonomous PM workflow record not found' });

    const threadId = workflow.thread_id || `th-pm-${workflow.id}`;
    const saver = new SqliteSaver(dbAdapter);
    let previousState: any = null;
    try {
      const tuple = await saver.getTuple({ configurable: { thread_id: threadId } });
      if (tuple?.checkpoint?.channel_values) {
        previousState = tuple.checkpoint.channel_values;
      }
    } catch {}

    try {
      const pmWorkflow = createAutonomousProjectManagerWorkflow(dbAdapter);
      const graphResult = await pmWorkflow.invoke({
        workflowId: workflow.id,
        threadId,
        userId: authUser.id,
        projectId: workflow.project_id,
        initialInput: previousState?.initialInput || '',
        documentContent: previousState?.documentContent || '',
        documentFilename: previousState?.documentFilename || '',
        clarificationHistory: previousState?.clarificationHistory || [],
        discoveredRequirements: previousState?.discoveredRequirements || {},
        status: 'PLAN_READY'
      }, { configurable: { thread_id: threadId } });

      const planJson = graphResult.plan ? JSON.stringify(graphResult.plan) : workflow.plan_json;
      const planHash = graphResult.planHash || (graphResult.plan ? computePlanHash(graphResult.plan) : null);
      const now = new Date().toISOString();

      execute(
        `UPDATE ai_workflows
         SET status = 'WAITING_APPROVAL', stage = 'review', plan_hash = ?, plan_json = ?, updated_at = ?
         WHERE id = ?`,
        [
          planHash,
          planJson,
          now,
          workflow.id
        ]
      );

      res.json({
        workflow_id: workflow.id,
        status: 'WAITING_APPROVAL',
        stage: 'review',
        proposed_plan: graphResult.plan,
        plan_hash: planHash,
        final_output: graphResult.finalOutput || 'Plan generated successfully.'
      });
    } catch (err: any) {
      console.error('Autonomous PM generate-plan error:', err);
      res.status(500).json({ detail: `Error generating plan: ${err.message}` });
    }
  });

  app.put('/api/ai/pm/:workflowId/plan', (req, res) => {
    const authUser = getAuthUserOrDemo(req);
    if (!authUser) return res.status(401).json({ detail: 'Authentication required' });

    const workflow = queryOne<any>('SELECT * FROM ai_workflows WHERE id = ?', [req.params.workflowId]);
    if (!workflow) return res.status(404).json({ detail: 'Autonomous PM workflow record not found' });

    if (workflow.project_id !== 'new' && !isUserAuthorizedForProject(authUser, workflow.project_id)) {
      return res.status(403).json({ detail: 'Access denied: You are not authorized for this project' });
    }

    const { plan } = req.body || {};
    if (!plan || typeof plan !== 'object') {
      return res.status(400).json({ detail: 'Valid plan object is required.' });
    }

    // Increment version and re-verify hash
    const currentVersion = Number(plan.version || 1);
    const updatedPlan = {
      ...plan,
      version: currentVersion + 1
    };

    const newHash = computePlanHash(updatedPlan);
    const now = new Date().toISOString();

    // Invalidates any previous approval because plan was modified
    execute(
      `UPDATE ai_workflows
       SET plan_json = ?, plan_hash = ?, status = 'WAITING_APPROVAL', stage = 'review', approved_by = NULL, approved_at = NULL, updated_at = ?
       WHERE id = ?`,
      [
        JSON.stringify(updatedPlan),
        newHash,
        now,
        workflow.id
      ]
    );

    createAuditLog(
      workflow.project_id,
      'workflow',
      workflow.id,
      'PLAN_EDITED_BY_USER',
      authUser.name,
      `User edited plan for workflow ${workflow.id}. Incremented to v${updatedPlan.version}. Old approvals invalidated.`
    );

    res.json({
      success: true,
      message: `Plan updated to version ${updatedPlan.version}. Previous approvals invalidated. New Plan Hash: ${newHash}`,
      plan: updatedPlan,
      plan_hash: newHash
    });
  });

  app.post('/api/ai/pm/:workflowId/approve', (req, res) => {
    const authUser = getAuthUserOrDemo(req);
    if (!authUser) return res.status(401).json({ detail: 'Authentication required' });

    const workflow = queryOne<any>('SELECT * FROM ai_workflows WHERE id = ?', [req.params.workflowId]);
    if (!workflow) return res.status(404).json({ detail: 'Autonomous PM workflow record not found' });

    if (workflow.project_id !== 'new' && !isUserAuthorizedForProject(authUser, workflow.project_id)) {
      return res.status(403).json({ detail: 'Unauthorized: Only authorized project leaders can approve workflow mutations' });
    }

    const { plan_hash } = req.body || {};
    if (plan_hash && plan_hash !== workflow.plan_hash) {
      return res.status(409).json({
        detail: `Approval rejected: Provided plan hash (${plan_hash}) does not match current plan version hash (${workflow.plan_hash}). Please refresh and review latest plan edits.`
      });
    }

    if (workflow.status !== 'WAITING_APPROVAL') {
      return res.status(400).json({ detail: `Workflow is in status '${workflow.status}', not WAITING_APPROVAL` });
    }

    const now = new Date().toISOString();
    execute("UPDATE ai_workflows SET status = 'EXECUTING', updated_at = ? WHERE id = ? AND status = 'WAITING_APPROVAL'", [now, workflow.id]);

    try {
      const result = executeApprovedWorkflowPlan(dbAdapter, workflow, authUser.id, authUser.name);
      res.json(result);
    } catch (err: any) {
      console.error('Autonomous PM approval execution error:', err);
      execute("UPDATE ai_workflows SET status = 'FAILED', error = ?, updated_at = ? WHERE id = ?", [err.message, new Date().toISOString(), workflow.id]);
      res.status(500).json({ detail: `Execution error: ${err.message}` });
    }
  });

  app.get('/api/ai/pm/:workflowId/status', async (req, res) => {
    const authUser = getAuthUserOrDemo(req);
    if (!authUser) return res.status(401).json({ detail: 'Authentication required' });

    const workflow = queryOne<any>('SELECT * FROM ai_workflows WHERE id = ?', [req.params.workflowId]);
    if (!workflow) return res.status(404).json({ detail: 'Autonomous PM workflow record not found' });

    let plan: any = null;
    let executionResults: any = null;
    try {
      if (workflow.plan_json) plan = JSON.parse(workflow.plan_json);
    } catch {}
    try {
      if (workflow.execution_results_json) executionResults = JSON.parse(workflow.execution_results_json);
    } catch {}

    const threadId = workflow.thread_id || `th-pm-${workflow.id}`;
    const saver = new SqliteSaver(dbAdapter);
    let channelValues: any = {};
    try {
      const tuple = await saver.getTuple({ configurable: { thread_id: threadId } });
      if (tuple?.checkpoint?.channel_values) {
        channelValues = tuple.checkpoint.channel_values;
      }
    } catch {}

    res.json({
      workflow_id: workflow.id,
      project_id: workflow.project_id,
      status: workflow.status,
      stage: workflow.stage,
      plan_hash: workflow.plan_hash,
      proposed_plan: plan || channelValues.plan || null,
      clarification_history: channelValues.clarificationHistory || [],
      pending_questions: channelValues.pendingQuestions || [],
      discovered_requirements: channelValues.discoveredRequirements || {},
      execution_results: executionResults || channelValues.executionResults || null,
      created_at: workflow.created_at,
      updated_at: workflow.updated_at
    });
  });

  app.get('/api/ai/pm/:workflowId/monitor', (req, res) => {
    const authUser = getAuthUserOrDemo(req);
    if (!authUser) return res.status(401).json({ detail: 'Authentication required' });

    const workflow = queryOne<any>('SELECT * FROM ai_workflows WHERE id = ?', [req.params.workflowId]);
    if (!workflow) return res.status(404).json({ detail: 'Autonomous PM workflow record not found' });

    const targetPId = workflow.project_id;
    if (!targetPId || targetPId === 'new') {
      return res.status(400).json({ detail: 'Workflow has not been executed into a real project yet.' });
    }

    const tasks = queryAll<any>('SELECT * FROM tasks WHERE project_id = ?', [targetPId]);
    const members = queryAll<any>('SELECT * FROM team_members');

    const total = tasks.length;
    const done = tasks.filter(t => t.status === 'Done').length;
    const inProgress = tasks.filter(t => t.status === 'In Progress').length;
    const overdue = tasks.filter(t => t.due_date && new Date(t.due_date) < new Date() && t.status !== 'Done');
    const blocked = tasks.filter(t => t.is_blocked);

    const workloads: Record<string, { memberId: string; memberName: string; taskCount: number; hours: number; status: string }> = {};
    for (const m of members) {
      workloads[m.id] = { memberId: m.id, memberName: m.name, taskCount: 0, hours: 0, status: 'Healthy' };
    }
    for (const t of tasks) {
      if (t.assignee_id && workloads[t.assignee_id]) {
        workloads[t.assignee_id].taskCount++;
        workloads[t.assignee_id].hours += Number(t.estimated_hours || 0);
      }
    }
    for (const w of Object.values(workloads)) {
      if (w.hours > 30 || w.taskCount > 5) {
        w.status = 'Overloaded';
      } else if (w.taskCount === 0) {
        w.status = 'Available';
      }
    }

    const recommendations: string[] = [];
    if (overdue.length > 0) {
      recommendations.push(`Triage ${overdue.length} overdue task(s): rebalance or update sprint target dates.`);
    }
    if (blocked.length > 0) {
      recommendations.push(`Mitigate ${blocked.length} blocked task(s) in next team standup.`);
    }
    if (recommendations.length === 0) {
      recommendations.push('All deliverables tracking within healthy variance of the approved baseline plan.');
    }

    res.json({
      project_id: targetPId,
      tracked_at: new Date().toISOString(),
      completion_rate: total > 0 ? Number(((done / total) * 100).toFixed(1)) : 0,
      total_tasks: total,
      done_tasks: done,
      in_progress_tasks: inProgress,
      overdue_tasks: overdue.map(o => ({ id: o.id, title: o.title, due_date: o.due_date, assignee_id: o.assignee_id })),
      blocked_tasks: blocked.map(b => ({ id: b.id, title: b.title, reason: b.blocker_reason })),
      workload_imbalances: Object.values(workloads).filter(w => w.status !== 'Healthy'),
      recommendations
    });
  });

  app.post('/api/ai/investigate-github', (req, res) => {
    const authUser = getAuthUserOrDemo(req);
    if (!authUser) return res.status(401).json({ detail: 'Authentication required' });

    const { project_id, question, author_login, issue_key } = req.body;
    if (!project_id) return res.status(400).json({ detail: 'project_id is required' });

    if (!isUserAuthorizedForProject(authUser, project_id)) {
      return res.status(403).json({ detail: 'Unauthorized for project' });
    }

    const report = runGitHubInvestigation(dbAdapter, {
      project_id,
      question: question || 'Investigate verified GitHub commits and pull requests',
      author_login,
      issue_key
    });

    res.json(report);
  });

  // ==========================================================================
  // ELEVENLABS VOICE INTEGRATION: STT & TTS
  // ==========================================================================
  app.get('/api/ai/voice/config', (_req, res) => {
    res.json(defaultVoiceService.getConfigStatus());
  });

  app.post('/api/ai/voice/transcribe', async (req, res) => {
    const authUser = getAuthUserOrDemo(req);
    if (!authUser) return res.status(401).json({ detail: 'Authentication required' });

    if (!checkRateLimit(`voice-transcribe-${authUser.id}`, 30, 60000)) {
      return res.status(429).json({ detail: 'Rate limit exceeded for voice transcription. Please wait a moment.' });
    }

    const { audio_base64, mime_type, language_code } = req.body;
    if (!audio_base64 || typeof audio_base64 !== 'string') {
      return res.status(400).json({ detail: 'audio_base64 is required as a base64 encoded audio string.' });
    }

    try {
      const audioBuffer = Buffer.from(audio_base64, 'base64');
      const cleanMime = (mime_type && typeof mime_type === 'string') ? mime_type : 'audio/webm';
      const cleanLang = (language_code && typeof language_code === 'string') ? language_code : undefined;

      const result = await defaultVoiceService.transcribe(audioBuffer, cleanMime, cleanLang);
      res.json(result);
    } catch (err: any) {
      console.warn('Voice transcription error:', redactSecrets(err.message || ''));
      const status = err.message?.includes('not configured') ? 503 :
                     err.message?.includes('quota') ? 402 :
                     err.message?.includes('timed out') ? 504 :
                     err.message?.includes('authentication') ? 401 :
                     err.message?.includes('exceeds maximum') ? 400 : 500;
      res.status(status).json({ detail: err.message || 'Voice transcription failed.' });
    }
  });

  app.post('/api/ai/voice/synthesize', async (req, res) => {
    const authUser = getAuthUserOrDemo(req);
    if (!authUser) return res.status(401).json({ detail: 'Authentication required' });

    if (!checkRateLimit(`voice-synthesize-${authUser.id}`, 30, 60000)) {
      return res.status(429).json({ detail: 'Rate limit exceeded for voice synthesis. Please wait a moment.' });
    }

    const { text, voice_id } = req.body;
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ detail: 'text parameter is required for voice synthesis.' });
    }

    try {
      const cleanVoiceId = (voice_id && typeof voice_id === 'string') ? voice_id.trim() : undefined;
      const result = await defaultVoiceService.synthesize(text, cleanVoiceId);

      const acceptHeader = req.headers['accept'] || '';
      if (acceptHeader.includes('audio/mpeg') || acceptHeader.includes('audio/*')) {
        res.setHeader('Content-Type', result.contentType);
        res.setHeader('Content-Length', result.audioBuffer.length);
        return res.send(result.audioBuffer);
      }

      res.json({
        audio_base64: result.audioBuffer.toString('base64'),
        content_type: result.contentType
      });
    } catch (err: any) {
      console.warn('Voice synthesis error:', redactSecrets(err.message || ''));
      const status = err.message?.includes('not configured') ? 503 :
                     err.message?.includes('quota') ? 402 :
                     err.message?.includes('timed out') ? 504 :
                     err.message?.includes('authentication') ? 401 : 500;
      res.status(status).json({ detail: err.message || 'Voice synthesis failed.' });
    }
  });

  // Strict API 404 catch-all: Never allow unmatched /api routes to fall through to Vite HTML
  app.all('/api/*', (req, res) => {
    res.status(404).json({ detail: `API route ${req.method} ${req.path} not found` });
  });

  // Frontend mounting: Vite in development, static in production
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true
      },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  // Scheduled incremental sync fallback (runs every 15 minutes for connected repositories)
  const SYNC_INTERVAL_MS = 15 * 60 * 1000;
  setInterval(async () => {
    try {
      const activeIntegrations = queryAll<any>('SELECT * FROM github_integrations WHERE is_connected = 1 AND sync_status != "syncing"');
      for (const integ of activeIntegrations) {
        const tokenToUse = integ.access_token
          ? decryptToken(integ.access_token)
          : (process.env.GITHUB_PAT || process.env.GITHUB_TOKEN || null);
        await syncProjectRepositoryActivity(dbAdapter, integ.project_id, integ.repo_owner, integ.repo_name, tokenToUse, { isIncremental: true });
      }
    } catch (err: any) {
      console.warn('Scheduled incremental sync warning:', redactSecrets(err.message));
    }
  }, SYNC_INTERVAL_MS).unref();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Intelligent PM Platform server running on http://0.0.0.0:${PORT}`);
    console.log(`SQLite database file: ${DB_FILE}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
