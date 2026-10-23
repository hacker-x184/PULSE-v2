import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMemberContribution, isTaskOverdue, TaskRecord } from './contribution.ts';

test('isTaskOverdue returns true for past due dates on pending tasks', () => {
  const refDate = new Date('2026-10-22T12:00:00Z');
  
  // Past due date
  assert.equal(
    isTaskOverdue({ status: 'To Do', dueDate: '2026-10-20' }, refDate),
    true
  );
  
  // Future due date
  assert.equal(
    isTaskOverdue({ status: 'To Do', dueDate: '2026-10-25' }, refDate),
    false
  );
  
  // Completed task is never overdue
  assert.equal(
    isTaskOverdue({ status: 'Done', dueDate: '2026-10-20' }, refDate),
    false
  );
});

test('calculateMemberContribution correctly computes completion rates and priority weights', () => {
  const refDate = new Date('2026-10-22T12:00:00Z');
  const member = { id: 'm1', name: 'Alice Zhang', githubUsername: 'alice' };
  
  const tasks: TaskRecord[] = [
    { id: 't1', projectId: 'p1', title: 'Task 1', priority: 'High', status: 'Done', dueDate: '2026-10-20', assigneeId: 'm1' },
    { id: 't2', projectId: 'p1', title: 'Task 2', priority: 'Medium', status: 'Done', dueDate: '2026-10-21', assigneeId: 'm1' },
    { id: 't3', projectId: 'p1', title: 'Task 3', priority: 'Low', status: 'In Progress', dueDate: '2026-10-25', assigneeId: 'm1' },
    { id: 't4', projectId: 'p1', title: 'Task 4', priority: 'High', status: 'To Do', dueDate: '2026-10-19', assigneeId: 'm1' }, // Overdue
    { id: 't5', projectId: 'p1', title: 'Other Task', priority: 'High', status: 'Done', dueDate: '2026-10-20', assigneeId: 'm2' }, // Other member
  ];

  const result = calculateMemberContribution(member, tasks, { commits: 14, prs: 3 }, refDate);

  assert.equal(result.totalAssigned, 4);
  assert.equal(result.completedTasks, 2);
  assert.equal(result.pendingTasks, 2);
  assert.equal(result.overdueTasks, 1);
  assert.equal(result.completionRate, 50); // 2 of 4 = 50%
  
  // Total assigned weights: High(3) + Medium(2) + Low(1) + High(3) = 9
  // Completed weights: High(3) + Medium(2) = 5
  // Weighted score: 5 / 9 * 100 = 55.55 -> 56%
  assert.equal(result.totalAssignedWeight, 9);
  assert.equal(result.completedWeight, 5);
  assert.equal(result.weightedScore, 56);
  assert.equal(result.highPriorityCompleted, 1);
  assert.equal(result.githubActivityStatus, 'connected');
  assert.equal(result.githubCommitsCount, 14);
  assert.equal(result.githubPRsCount, 3);
});

test('calculateMemberContribution handles member with zero tasks without NaN errors', () => {
  const member = { id: 'm-empty', name: 'Empty User' };
  const result = calculateMemberContribution(member, []);
  
  assert.equal(result.totalAssigned, 0);
  assert.equal(result.completedTasks, 0);
  assert.equal(result.completionRate, 0);
  assert.equal(result.weightedScore, 0);
  assert.equal(result.workloadStatus, 'Low');
  assert.equal(result.githubActivityStatus, 'not_configured');
  assert.equal(result.githubCommitsCount, null);
});
