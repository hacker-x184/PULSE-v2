import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateEstimationAccuracy,
  detectMissingEvidence,
  generateRedistributionSuggestions,
  calculateCriticalPathAndVariance
} from './pmIntelligence.ts';

test('calculateEstimationAccuracy computes variance and accuracy score correctly', () => {
  const sampleTasks = [
    { id: 't1', title: 'Task 1', estimated_hours: 10, actual_hours: 10, status: 'Done' },
    { id: 't2', title: 'Task 2', estimated_hours: 10, actual_hours: 15, status: 'Done' },
    { id: 't3', title: 'Task 3', estimated_hours: 20, actual_hours: 10, status: 'Done' }
  ];

  const result = calculateEstimationAccuracy(sampleTasks);
  assert.equal(result.items.length, 3);
  assert.equal(result.totalEstimated, 40);
  assert.equal(result.totalActual, 35);
  // t1: 100%, t2: 50%, t3: 50% -> avg 67%
  assert.equal(result.items[0].accuracyPercentage, 100);
  assert.equal(result.items[1].varianceHours, 5);
  assert.equal(result.items[2].varianceHours, -10);
  assert.equal(result.averageAccuracy, 67);
});

test('detectMissingEvidence flags Done tasks without commits or approved reviews', () => {
  const members = [{ id: 'm1', name: 'Alice' }];
  const tasks = [
    { id: 't1', title: 'Clean Done Task', status: 'Done', assignee_id: 'm1', linked_commits: [{ sha: 'abc' }] },
    { id: 't2', title: 'Reviewed Done Task', status: 'Done', assignee_id: 'm1', reviews: [{ status: 'Approved' }] },
    { id: 't3', title: 'Suspicious Done Task', status: 'Done', assignee_id: 'm1' }, // No evidence!
    { id: 't4', title: 'Pending Task', status: 'In Progress', assignee_id: 'm1' }
  ];

  const missing = detectMissingEvidence(tasks, members);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].taskId, 't3');
  assert.equal(missing[0].assigneeName, 'Alice');
});

test('generateRedistributionSuggestions recommends balancing tasks from overloaded members', () => {
  const members = [
    { id: 'm-overloaded', name: 'Overloaded Devon', role: 'DevOps', skills: 'Docker, Kubernetes' },
    { id: 'm-available', name: 'Available Sarah', role: 'Developer', skills: 'Docker, React' }
  ];

  const tasks = [
    { id: 't1', title: 'Task 1', status: 'In Progress', priority: 'High', assignee_id: 'm-overloaded' },
    { id: 't2', title: 'Task 2', status: 'In Progress', priority: 'Medium', assignee_id: 'm-overloaded' },
    { id: 't3', title: 'Task 3', status: 'In Progress', priority: 'Low', assignee_id: 'm-overloaded' }
  ];

  const suggestions = generateRedistributionSuggestions(tasks, members);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].fromMemberId, 'm-overloaded');
  assert.equal(suggestions[0].toMemberId, 'm-available');
  assert.equal(suggestions[0].taskId, 't2');
});

test('calculateCriticalPathAndVariance accurately computes hours and days variance', () => {
  const tasks = [
    { id: 't1', title: 'High Priority Task', status: 'To Do', priority: 'High', estimated_hours: 12 },
    { id: 't2', title: 'Low Priority Done', status: 'Done', priority: 'Low', estimated_hours: 8 },
    { id: 't3', title: 'Dependent Task', status: 'In Progress', priority: 'Medium', estimated_hours: 6, dependencies: ['t1'] }
  ];

  // Deadline 10 days out
  const future = new Date(Date.now() + 10 * 86400000).toISOString();
  const res = calculateCriticalPathAndVariance(tasks, future);

  assert.equal(res.criticalTasks.length, 2); // t1 and t3
  assert.equal(res.totalEstimatedHours, 18);
  // 18 hrs / 6 = 3 days needed; 10 days remaining -> variance = +7 days
  assert.equal(res.scheduleVarianceDays, 7);
});
