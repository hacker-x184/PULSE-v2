import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAutonomousProjectManagerWorkflow,
  computePlanHash,
  executeApprovedWorkflowPlan,
  safeExtractAndParseJson,
  AutonomousProjectPlan,
  DbAdapter
} from '../src/ai/pulseAgent.ts';

test('Autonomous PM: Complete journey from idea to interview, plan, edit, approval, and verified DB execution', async () => {
  const tasksStore: any[] = [];
  const projectsStore: any[] = [{ id: 'p-existing', name: 'Existing Project', key_prefix: 'EXT', current_sprint: 'Sprint 1' }];
  const subtasksStore: any[] = [];
  const acceptanceStore: any[] = [];
  const auditLogsStore: any[] = [];
  const teamMembers = [
    { id: 'm-elena', name: 'Elena Rostova', role: 'Lead Architect', skills: 'TypeScript, Architecture', capacity_hours: 40 },
    { id: 'm-alex', name: 'Alex Rivera', role: 'Fullstack Engineer', skills: 'React, Node.js', capacity_hours: 35 }
  ];

  const inMemoryDb: DbAdapter = {
    queryAll: <T = any>(sql: string, params: any[] = []): T[] => {
      if (sql.includes('FROM team_members')) return teamMembers as unknown as T[];
      if (sql.includes('FROM projects')) return projectsStore as unknown as T[];
      if (sql.includes('FROM tasks WHERE project_id = ?')) {
        return tasksStore.filter(t => t.project_id === params[0]) as unknown as T[];
      }
      if (sql.includes('FROM tasks')) return tasksStore as unknown as T[];
      if (sql.includes('FROM document_chunks')) return [] as T[];
      return [] as T[];
    },
    queryOne: (sql: string, params: any[] = []) => {
      if (sql.includes('SELECT * FROM projects WHERE id = ?')) {
        return projectsStore.find(p => p.id === params[0]) || null;
      }
      if (sql.includes('SELECT id, name FROM projects WHERE id = ?')) {
        return projectsStore.find(p => p.id === params[0]) || null;
      }
      if (sql.includes('SELECT id FROM team_members WHERE id = ?')) {
        return teamMembers.find(m => m.id === params[0]) || null;
      }
      if (sql.includes('SELECT id, issue_key FROM tasks WHERE')) {
        return tasksStore.find(t => t.project_id === params[0] && t.title.toLowerCase() === (params[1] || '').toLowerCase()) || null;
      }
      if (sql.includes('SELECT COUNT(*) as cnt FROM tasks')) {
        return { cnt: tasksStore.length };
      }
      return null;
    },
    execute: (sql: string, params: any[] = []) => {
      if (sql.includes('INSERT INTO projects')) {
        projectsStore.push({
          id: params[0],
          name: params[1],
          description: params[2],
          key_prefix: params[6],
          current_sprint: 'Sprint 1 (Active)'
        });
      }
      if (sql.includes('INSERT INTO tasks')) {
        tasksStore.push({
          id: params[0],
          project_id: params[1],
          issue_key: params[2],
          title: params[3],
          priority: params[5],
          assignee_id: params[7],
          status: 'To Do'
        });
      }
      if (sql.includes('INSERT INTO task_subtasks')) {
        subtasksStore.push({ id: params[0], task_id: params[1], title: params[2] });
      }
      if (sql.includes('INSERT INTO task_acceptance_criteria')) {
        acceptanceStore.push({ id: params[0], task_id: params[1], criterion: params[2] });
      }
      if (sql.includes('INSERT INTO audit_logs')) {
        auditLogsStore.push({ id: params[0], project_id: params[1], action: params[3] });
      }
    }
  };

  const workflow = createAutonomousProjectManagerWorkflow(inMemoryDb);
  const workflowId = 'wf-apm-test-1';
  const threadId = 'th-apm-test-1';

  // 1. Initial idea input: short description
  const turn1 = await workflow.invoke({
    workflowId,
    threadId,
    userId: 'u-zaid',
    projectId: 'p-existing',
    initialInput: 'Build an automated WhatsApp alert engine for overdue payments'
  }, { configurable: { thread_id: threadId } });

  // Must start with conversational discovery / questions
  assert.ok(turn1.status === 'AWAITING_ANSWERS' || turn1.status === 'PLAN_READY', 'Must initialize into discovery or plan ready');
  assert.ok(turn1.pendingQuestions.length > 0 || turn1.plan, 'Must formulate high-value questions or plan');
  if (turn1.pendingQuestions.length > 0) {
    assert.ok(turn1.pendingQuestions.length <= 3, 'Must ask small number (1-3) of high-value questions at a time');
    assert.ok(turn1.pendingQuestions[0].proposedDefault, 'Must propose a sensible default for questions');
  }

  // 2. Submit clarification answers and request plan generation
  const turn2 = await workflow.invoke({
    workflowId,
    threadId,
    userId: 'u-zaid',
    projectId: 'p-existing',
    initialInput: 'Build an automated WhatsApp alert engine for overdue payments',
    clarificationHistory: [
      { questionId: 'q_tech', question: 'Preferred stack?', answer: 'React + Node.js with SQLite' },
      { questionId: 'q_timeline', question: 'Target launch?', defaultProposed: '2-week sprint MVP', confirmed: true }
    ],
    status: 'PLAN_READY'
  }, { configurable: { thread_id: threadId } });

  // Must transition to WAITING_APPROVAL with plan and tamper-proof hash
  assert.equal(turn2.status, 'WAITING_APPROVAL', 'Workflow must pause for human review and explicit approval');
  assert.ok(turn2.plan, 'Plan must be generated');
  assert.ok(turn2.plan.tasks.length > 0, 'Plan must contain structured tasks');
  assert.ok(turn2.planHash, 'Plan hash must be computed');

  // Verify plan properties
  const originalPlan: AutonomousProjectPlan = turn2.plan;
  assert.ok(originalPlan.objectives.length > 0, 'Objectives must be populated');
  assert.ok(originalPlan.recommendedTechStack.length > 0, 'Tech stack must be specified');
  assert.ok(originalPlan.tasks[0].acceptance_criteria.length > 0, 'Acceptance criteria must be present');

  // 3. User edits a deliverable: plan hash must change and invalidate old approval
  const editedPlan: AutonomousProjectPlan = {
    ...originalPlan,
    version: 2,
    projectName: 'WhatsApp Payment Alerts Pro',
    tasks: originalPlan.tasks.map((t, idx) => idx === 0 ? { ...t, estimated_hours: 16, title: 'Custom Architecture Setup' } : t)
  };
  const newHash = computePlanHash(editedPlan);
  assert.notEqual(newHash, turn2.planHash, 'Editing plan must produce a different tamper-proof hash');

  // 4. Consequential execution rejects tampered or mismatched hash
  assert.throws(() => {
    executeApprovedWorkflowPlan(
      inMemoryDb,
      {
        id: workflowId,
        project_id: 'p-existing',
        workflow_type: 'autonomous_pm',
        plan_json: JSON.stringify(editedPlan),
        plan_hash: turn2.planHash, // Old hash!
        status: 'WAITING_APPROVAL'
      },
      'u-zaid',
      'Zaid Lead'
    );
  }, /Plan integrity verification failed/, 'Must reject tampered plan with mismatched hash');

  // 5. Approved execution with matching hash creates verified SQLite database records
  const execResult = executeApprovedWorkflowPlan(
    inMemoryDb,
    {
      id: workflowId,
      project_id: 'p-existing',
      workflow_type: 'autonomous_pm',
      plan_json: JSON.stringify(editedPlan),
      plan_hash: newHash, // Matching hash!
      status: 'WAITING_APPROVAL'
    },
    'u-zaid',
    'Zaid Lead'
  );

  assert.equal(execResult.success, true, 'Execution must succeed');
  assert.ok(execResult.created_task_ids.length > 0, 'Must create tasks in SQLite');
  assert.equal(tasksStore.length, editedPlan.tasks.length, 'All planned deliverables must be stored in database');
  assert.ok(auditLogsStore.length > 0, 'Audit trail must be created');

  // 6. Idempotent Retry: Retrying execution must NOT duplicate existing tasks
  const retryResult = executeApprovedWorkflowPlan(
    inMemoryDb,
    {
      id: workflowId,
      project_id: 'p-existing',
      workflow_type: 'autonomous_pm',
      plan_json: JSON.stringify(editedPlan),
      plan_hash: newHash,
      status: 'WAITING_APPROVAL'
    },
    'u-zaid',
    'Zaid Lead'
  );

  assert.equal(retryResult.success, true);
  assert.equal(tasksStore.length, editedPlan.tasks.length, 'Idempotent execution must not duplicate records');
});

test('Resilient JSON parser: handles missing commas, trailing commas, markdown, and malformed Groq outputs', () => {
  // 1. Missing comma between array elements (the exact trigger error: Expected ',' or ']' after array element in JSON)
  const missingCommaBetweenObjects = `
  {
    "projectName": "Pulse Pro",
    "tasks": [
      {
        "id": "t1",
        "title": "Setup Architecture"
      }
      {
        "id": "t2",
        "title": "Database Migrations"
      }
    ]
  }`;
  const parsed1 = safeExtractAndParseJson<any>(missingCommaBetweenObjects);
  assert.ok(parsed1, 'Must parse missing comma JSON');
  assert.equal(parsed1.projectName, 'Pulse Pro');
  assert.equal(parsed1.tasks.length, 2);
  assert.equal(parsed1.tasks[1].title, 'Database Migrations');

  // 2. Trailing commas before closing brackets
  const trailingCommas = `
  {
    "projectName": "Trailing Comma Project",
    "tasks": [
      { "id": "t1", "title": "First task", },
    ],
    "tags": ["tag1", "tag2", ],
  }`;
  const parsed2 = safeExtractAndParseJson<any>(trailingCommas);
  assert.ok(parsed2, 'Must parse trailing commas');
  assert.equal(parsed2.tasks.length, 1);
  assert.equal(parsed2.tags.length, 2);

  // 3. Output wrapped in markdown codeblock and conversational commentary
  const markdownWrapped = `
  Sure! Here is the requested structured plan for your project:
  \`\`\`json
  {
    "projectName": "Markdown Plan",
    "tasks": [
      { "id": "t1", "title": "Build UI" }
    ]
  }
  \`\`\`
  Let me know if you would like me to adjust any tasks!`;
  const parsed3 = safeExtractAndParseJson<any>(markdownWrapped);
  assert.ok(parsed3, 'Must parse markdown wrapped JSON');
  assert.equal(parsed3.projectName, 'Markdown Plan');
  assert.equal(parsed3.tasks.length, 1);

  // 4. Handles echoed TypeScript union syntax
  const tsUnion = `
  {
    "projectName": "TS Union Plan",
    "tasks": [
      { "id": "t1", "title": "Security Audit", "priority": "High" | "Medium" | "Low" }
    ]
  }`;
  const parsed4 = safeExtractAndParseJson<any>(tsUnion);
  assert.ok(parsed4, 'Must parse echoed TS union');
  assert.equal(parsed4.projectName, 'TS Union Plan');
  assert.equal(parsed4.tasks.length, 1);
});
