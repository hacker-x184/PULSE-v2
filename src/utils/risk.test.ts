import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProjectRisk, ProjectRecord } from './risk.ts';
import { TaskRecord } from './contribution.ts';

test('evaluateProjectRisk detects high risk on overdue high priority tasks', () => {
  const refDate = new Date('2026-10-22T12:00:00Z');
  const project: ProjectRecord = {
    id: 'p1',
    name: 'Cloud Migration',
    status: 'Active',
    deadline: '2026-11-15',
  };

  const tasks: TaskRecord[] = [
    {
      id: 't-crit',
      projectId: 'p1',
      title: 'Database Schema Migration',
      priority: 'High',
      status: 'In Progress',
      dueDate: '2026-10-18', // Overdue high priority
      assigneeId: 'm1',
    },
    {
      id: 't-normal',
      projectId: 'p1',
      title: 'Update Documentation',
      priority: 'Low',
      status: 'Done',
      dueDate: '2026-10-20',
      assigneeId: 'm2',
    },
  ];

  const analysis = evaluateProjectRisk(project, tasks, refDate);

  assert.equal(analysis.riskLevel, 'High');
  assert.equal(analysis.factors.length >= 1, true);
  const highFactor = analysis.factors.find(f => f.code === 'OVERDUE_HIGH_PRIORITY');
  assert.ok(highFactor);
  assert.equal(highFactor.affectedTaskIds.includes('t-crit'), true);
});

test('evaluateProjectRisk flags imminent deadline when completion is under 50%', () => {
  const refDate = new Date('2026-10-22T12:00:00Z');
  const project: ProjectRecord = {
    id: 'p2',
    name: 'Mobile App Beta Launch',
    status: 'Active',
    deadline: '2026-10-25', // 3 days away!
  };

  const tasks: TaskRecord[] = [
    { id: 't1', projectId: 'p2', title: 'Task 1', priority: 'Medium', status: 'To Do', dueDate: '2026-10-24' },
    { id: 't2', projectId: 'p2', title: 'Task 2', priority: 'Medium', status: 'To Do', dueDate: '2026-10-25' },
    { id: 't3', projectId: 'p2', title: 'Task 3', priority: 'Low', status: 'Done', dueDate: '2026-10-20' },
  ]; // 1 of 3 = 33% completion, deadline in 3 days

  const analysis = evaluateProjectRisk(project, tasks, refDate);

  assert.equal(analysis.riskLevel, 'High');
  const compressionFactor = analysis.factors.find(f => f.code === 'DEADLINE_IMMINENT_LOW_PROGRESS');
  assert.ok(compressionFactor);
});

test('evaluateProjectRisk returns Low risk for completed project', () => {
  const refDate = new Date('2026-10-22T12:00:00Z');
  const project: ProjectRecord = {
    id: 'p3',
    name: 'Completed Milestone',
    status: 'Completed',
    deadline: '2026-10-15',
  };

  const tasks: TaskRecord[] = [
    { id: 't1', projectId: 'p3', title: 'Task 1', priority: 'High', status: 'Done', dueDate: '2026-10-14' },
  ];

  const analysis = evaluateProjectRisk(project, tasks, refDate);
  assert.equal(analysis.riskLevel, 'Low');
  assert.equal(analysis.riskScore, 0);
});
