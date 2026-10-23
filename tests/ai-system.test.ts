import test from 'node:test';
import assert from 'node:assert/strict';
import { generateEmbedding, cosineSimilarity, computeBM25Score } from '../src/ai/embeddings.ts';
import {
  getGroqChatModel,
  runGitHubInvestigation,
  createProjectRecoveryWorkflow,
  createMeetingToTasksWorkflow,
  createDocumentPlannerWorkflow,
  computePlanHash,
  executeApprovedWorkflowPlan,
  DbAdapter
} from '../src/ai/pulseAgent.ts';

test('AI System: Groq model uses exactly openai/gpt-oss-120b', () => {
  // Test with environment key
  process.env.GROQ_API_KEY = 'test-key-mock-for-config-validation';
  process.env.GROQ_MODEL = 'openai/gpt-oss-120b';

  const model = getGroqChatModel();
  assert.ok(model, 'ChatGroq model should initialize when GROQ_API_KEY is set');
  const modelName = (model as any).modelName || (model as any).model;
  assert.equal(modelName, 'openai/gpt-oss-120b', 'Model identifier must be exactly openai/gpt-oss-120b');
});

test('AI System: Real embeddings generate 384-dim dense vectors with cosine similarity in [0, 1]', async () => {
  const vec1 = await generateEmbedding('Financial ledger reconciliation engine');
  const vec2 = await generateEmbedding('Settlement transactions balance verification');
  const vec3 = await generateEmbedding('Gardening and outdoor lawn mower repairs');

  assert.ok(vec1, 'Embedding 1 must be generated');
  assert.ok(vec2, 'Embedding 2 must be generated');
  assert.ok(vec3, 'Embedding 3 must be generated');

  assert.equal(vec1.length, 384, 'all-MiniLM-L6-v2 vector dimension must be 384');
  assert.equal(vec2.length, 384);
  assert.equal(vec3.length, 384);

  const simRelated = cosineSimilarity(vec1, vec2);
  const simUnrelated = cosineSimilarity(vec1, vec3);

  assert.ok(simRelated > 0 && simRelated <= 1, 'Cosine similarity must be bounded');
  assert.ok(simUnrelated > 0 && simUnrelated <= 1);
  assert.ok(simRelated > simUnrelated, 'Related financial texts must have higher semantic similarity than unrelated garden texts');
});

test('AI System: BM25 score ranks exact and partial keyword matches correctly', () => {
  const scoreHigh = computeBM25Score(['ledger', 'reconciliation'], 'Core financial ledger reconciliation and settlement');
  const scoreLow = computeBM25Score(['ledger', 'reconciliation'], 'Frontend button styling in CSS');

  assert.ok(scoreHigh > scoreLow, 'BM25 score must be higher for matching document');
  assert.ok(scoreHigh > 0);
  assert.equal(scoreLow, 0);
});

test('AI System: GitHub Investigation strictly differentiates commit authors and reports limitations', () => {
  const inMemoryDb: DbAdapter = {
    queryAll: <T = any>(sql: string, params: any[] = []): T[] => {
      let results: any[] = [];
      if (sql.includes('github_commits')) {
        results = [
          {
            sha: 'abcdef1234567890',
            project_id: 'p-test',
            repo_full_name: 'org/repo',
            message: 'feat(EQX-101): implement ledger engine',
            author_login: 'erostova',
            author_name: 'Elena Rostova',
            date: '2026-10-20',
            issue_key: 'EQX-101',
            url: 'https://github.com/org/repo/commit/abcdef1'
          }
        ];
      } else if (sql.includes('github_pull_requests')) {
        results = [
          {
            id: 'pr-1',
            project_id: 'p-test',
            repo_full_name: 'org/repo',
            number: 42,
            title: 'feat: Core ledger engine',
            state: 'merged',
            author_login: 'erostova',
            issue_key: 'EQX-101',
            url: 'https://github.com/org/repo/pull/42'
          }
        ];
      } else if (sql.includes('team_members')) {
        results = [
          { id: 'm-elena', name: 'Elena Rostova', github_username: 'erostova' }
        ];
      }
      return results as T[];
    },
    queryOne: () => null,
    execute: () => {}
  };

  const report = runGitHubInvestigation(inMemoryDb, {
    project_id: 'p-test',
    question: 'Who committed to EQX-101?'
  });

  assert.equal(report.evidence_found.commits_count, 1);
  assert.equal(report.evidence_found.prs_count, 1);
  assert.equal(report.evidence_found.sample_commits[0].mapped_pulse_member, 'Elena Rostova');
  assert.ok(report.attribution_notes.some(n => n.includes('Commit authors and committers are distinct')));
  assert.ok(report.attribution_notes.some(n => n.includes('Lines of code are not used as an evaluation metric')));
});

test('AI System: LangGraph Workflow pauses for human approval and executes idempotently', async () => {
  const tasksStore: any[] = [];
  const auditLogs: any[] = [];

  const inMemoryDb: DbAdapter = {
    queryAll: <T = any>(sql: string): T[] => {
      if (sql.includes('tasks')) return tasksStore as unknown as T[];
      if (sql.includes('team_members')) return [{ id: 'm-elena', name: 'Elena Rostova' }] as unknown as T[];
      return [] as T[];
    },
    queryOne: (sql: string, params: any[] = []) => {
      if (sql.includes('SELECT * FROM projects')) {
        return { id: 'p-test', name: 'Test Project', key_prefix: 'TST', current_sprint: 'Sprint 1' };
      }
      if (sql.includes('SELECT id, issue_key FROM tasks WHERE')) {
        return tasksStore.find(t => t.project_id === params[0] && t.title.toLowerCase() === params[1].toLowerCase()) || null;
      }
      if (sql.includes('SELECT COUNT(*) as cnt FROM tasks')) {
        return { cnt: tasksStore.length };
      }
      return null;
    },
    execute: (sql: string, params: any[] = []) => {
      if (sql.includes('INSERT INTO tasks')) {
        tasksStore.push({
          id: params[0],
          project_id: params[1],
          issue_key: params[2],
          title: params[3],
          priority: params[5],
          status: 'To Do'
        });
      }
      if (sql.includes('INSERT INTO audit_logs')) {
        auditLogs.push({ id: params[0], action: params[3], details: params[5] });
      }
    }
  };

  const meetingWf = createMeetingToTasksWorkflow(inMemoryDb);
  const result = await meetingWf.invoke({
    workflowId: 'wf-test-1',
    workflowType: 'meeting_to_tasks',
    projectId: 'p-test',
    userId: 'u-zaid',
    documentContent: '- [ ] Implement OAuth2 token validation (Due: 2026-11-01, Urgent)\n- [ ] Write integration test harness'
  }, { configurable: { thread_id: 'thread-test-1' } });

  // 1. Must pause for human approval
  assert.equal(result.status, 'WAITING_APPROVAL', 'Workflow must pause for human approval before database write');
  assert.ok(result.planHash, 'Workflow must compute a plan hash');
  assert.equal(result.proposedPlan.proposed_tasks.length, 2);

  // 2. Approve and execute
  const execResult = executeApprovedWorkflowPlan(
    inMemoryDb,
    {
      id: 'wf-test-1',
      project_id: 'p-test',
      workflow_type: 'meeting_to_tasks',
      plan_json: JSON.stringify(result.proposedPlan),
      plan_hash: result.planHash,
      status: 'WAITING_APPROVAL'
    },
    'u-zaid',
    'Zaid Tested'
  );

  assert.equal(execResult.success, true);
  assert.equal(tasksStore.length, 2, 'Two tasks must be created in database upon approval');
  assert.equal(auditLogs.length, 2, 'Audit logs must be written for each created task');

  // 3. Idempotency test: Re-executing same approved plan does not duplicate tasks
  const retryResult = executeApprovedWorkflowPlan(
    inMemoryDb,
    {
      id: 'wf-test-1',
      project_id: 'p-test',
      workflow_type: 'meeting_to_tasks',
      plan_json: JSON.stringify(result.proposedPlan),
      plan_hash: result.planHash,
      status: 'WAITING_APPROVAL'
    },
    'u-zaid',
    'Zaid Tested'
  );

  assert.equal(retryResult.success, true);
  assert.equal(tasksStore.length, 2, 'Retrying approved plan must not create duplicate tasks');
});

import initSqlJs from 'sql.js';
import { SqliteSaver } from '../src/ai/pulseAgent.ts';

test('AI System: SqliteSaver persists LangGraph checkpoints into real SQLite tables', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  const sqliteAdapter: DbAdapter = {
    queryAll: <T = any>(sql: string, params: any[] = []): T[] => {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      const rows: T[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
      }
      stmt.free();
      return rows;
    },
    queryOne: <T = any>(sql: string, params: any[] = []): T | null => {
      const rows = sqliteAdapter.queryAll<T>(sql, params);
      return rows.length > 0 ? rows[0] : null;
    },
    execute: (sql: string, params: any[] = []): void => {
      db.run(sql, params);
    }
  };

  const checkpointer = new SqliteSaver(sqliteAdapter);

  // Test put checkpoint
  const config = { configurable: { thread_id: 'thread-checkpoint-test', checkpoint_ns: '' } };
  const checkpoint = { id: 'cp-001', v: 4, ts: new Date().toISOString(), channel_values: { query: 'test' } };
  const metadata = { source: 'test' };

  const res = await checkpointer.put(config, checkpoint, metadata);
  assert.equal(res.configurable.thread_id, 'thread-checkpoint-test');
  assert.equal(res.configurable.checkpoint_id, 'cp-001');

  // Verify stored in SQLite table
  const rows = sqliteAdapter.queryAll('SELECT * FROM ai_workflow_checkpoints WHERE thread_id = "thread-checkpoint-test"');
  assert.equal(rows.length, 1, 'Checkpoint must be saved in ai_workflow_checkpoints table');
  assert.equal(rows[0].checkpoint_id, 'cp-001');

  // Test getTuple
  const tuple = await checkpointer.getTuple({ configurable: { thread_id: 'thread-checkpoint-test', checkpoint_id: 'cp-001' } });
  assert.ok(tuple, 'Saved checkpoint tuple must be retrievable from SQLite');
  assert.equal(tuple.checkpoint.id, 'cp-001');
  assert.equal(tuple.checkpoint.channel_values.query, 'test');
});

test('AI System: SqliteSaver upgrades legacy checkpoint table lacking checkpoint_ns without error', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  // Create old legacy schema without checkpoint_ns
  db.run(`
    CREATE TABLE ai_workflow_checkpoints (
      thread_id TEXT NOT NULL,
      checkpoint_id TEXT NOT NULL,
      workflow_type TEXT NOT NULL,
      node_name TEXT NOT NULL,
      state_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, checkpoint_id)
    );
  `);

  const adapter: DbAdapter = {
    queryAll: <T = any>(sql: string, params: any[] = []): T[] => {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      const rows: T[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
      }
      stmt.free();
      return rows;
    },
    queryOne: <T = any>(sql: string, params: any[] = []): T | null => {
      const rows = adapter.queryAll<T>(sql, params);
      return rows.length > 0 ? rows[0] : null;
    },
    execute: (sql: string, params: any[] = []): void => {
      db.run(sql, params);
    }
  };

  // Instantiating SqliteSaver on this legacy database should auto-migrate without error
  const checkpointer = new SqliteSaver(adapter);
  const info = adapter.queryAll<any>('PRAGMA table_info(ai_workflow_checkpoints)');
  const colNames = info.map(c => c.name);
  assert.ok(colNames.includes('checkpoint_ns'), 'Migrated table must contain checkpoint_ns column');
  assert.ok(colNames.includes('checkpoint_json'), 'Migrated table must contain checkpoint_json column');

  // Verify getTuple and put work seamlessly on migrated table
  const config = { configurable: { thread_id: 'th-legacy-test', checkpoint_ns: '' } };
  await checkpointer.put(config, { id: 'cp-leg-1', test: true }, { source: 'unit-test' });
  const retrieved = await checkpointer.getTuple({ configurable: { thread_id: 'th-legacy-test', checkpoint_id: 'cp-leg-1' } });
  assert.ok(retrieved, 'Should retrieve checkpoint from migrated table');
  assert.equal(retrieved.checkpoint.id, 'cp-leg-1');
});

test('AI System: Document-to-Project Planner extracts deliverables from text requirements', async () => {
  const dbMock: DbAdapter = {
    queryAll: <T = any>(sql: string): T[] => {
      if (sql.includes('team_members')) {
        return [{ id: 'm-elena', name: 'Elena Rostova' }, { id: 'm-marcus', name: 'Marcus Vance' }] as unknown as T[];
      }
      return [] as T[];
    },
    queryOne: () => null,
    execute: () => {}
  };

  const plannerWf = createDocumentPlannerWorkflow(dbMock);
  const sampleRequirements = `
### Core Project Requirements Specification
Objective: Build a resilient distributed accounting ledger with sub-millisecond reconciliation.

1. Implement idempotency key deduplication scheme
2. Design distributed lock with SQLite WAL fallback
3. Automate CI migration schema validation
`;

  const result = await plannerWf.invoke({
    workflowId: 'wf-doc-1',
    workflowType: 'document_planner',
    projectId: 'p-ledger',
    userId: 'u-zaid',
    documentContent: sampleRequirements
  }, { configurable: { thread_id: 'thread-doc-1' } });

  assert.equal(result.status, 'WAITING_APPROVAL', 'Document planner must pause for human approval');
  assert.ok(result.planHash, 'Plan hash must be generated');
  assert.ok(result.proposedPlan.proposed_tasks.length >= 3, 'Must extract at least 3 deliverables');
  assert.equal(result.proposedPlan.proposed_tasks[0].title, 'Implement idempotency key deduplication scheme');
});
