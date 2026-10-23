/**
 * Rule-Based Project Risk Analysis Engine
 * 
 * Evaluates projects deterministically without black-box ML claims.
 * Identifies:
 *  1. Overdue high-priority tasks (Major risk factor)
 *  2. Tasks approaching deadlines within 3 days that are not completed
 *  3. Low completion percentage (< 50%) when project deadline is approaching (<= 7 days)
 *  4. High volume of blocked / unassigned high priority tasks
 */

import { TaskRecord, isTaskOverdue, isTaskCompleted } from './contribution.ts';

export interface ProjectRecord {
  id: string;
  name: string;
  description?: string;
  startDate?: string;
  deadline?: string;
  status: 'Planning' | 'Active' | 'In Review' | 'Completed' | 'On Hold';
}

export type RiskLevel = 'Low' | 'Medium' | 'High';

export interface RiskFactor {
  id: string;
  code: 'OVERDUE_HIGH_PRIORITY' | 'OVERDUE_TASKS' | 'DEADLINE_IMMINENT_LOW_PROGRESS' | 'APPROACHING_DEADLINE_TASKS' | 'UNASSIGNED_HIGH_PRIORITY';
  severity: RiskLevel;
  title: string;
  description: string;
  affectedTaskIds: string[];
  affectedTaskTitles: string[];
  suggestedAction: string;
}

export interface ProjectRiskAnalysis {
  projectId: string;
  projectName: string;
  riskLevel: RiskLevel;
  riskScore: number; // 0 - 100
  factors: RiskFactor[];
  totalTasks: number;
  completedTasks: number;
  completionPercentage: number;
  daysUntilProjectDeadline: number | null;
  summaryRecommendation: string;
  lastEvaluatedAt: string;
}

export function evaluateProjectRisk(
  project: ProjectRecord,
  tasks: TaskRecord[],
  referenceDate: Date = new Date()
): ProjectRiskAnalysis {
  const projectTasks = tasks.filter(t => t.projectId === project.id);
  const totalTasks = projectTasks.length;
  const completedTasks = projectTasks.filter(t => isTaskCompleted(t.status)).length;
  const completionPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  let daysUntilProjectDeadline: number | null = null;
  if (project.deadline) {
    const deadlineDate = new Date(project.deadline);
    const diffMs = deadlineDate.getTime() - referenceDate.getTime();
    daysUntilProjectDeadline = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  }

  const factors: RiskFactor[] = [];
  let riskScore = 10; // baseline low risk

  // 1. Check overdue high priority tasks
  const overdueHighPriority = projectTasks.filter(
    t => t.priority === 'High' && isTaskOverdue(t, referenceDate)
  );

  if (overdueHighPriority.length > 0) {
    riskScore += overdueHighPriority.length * 25;
    factors.push({
      id: `rf-overdue-high-${project.id}`,
      code: 'OVERDUE_HIGH_PRIORITY',
      severity: 'High',
      title: 'Overdue High-Priority Tasks',
      description: `${overdueHighPriority.length} high-priority task${overdueHighPriority.length > 1 ? 's are' : ' is'} past their due date without completion.`,
      affectedTaskIds: overdueHighPriority.map(t => t.id),
      affectedTaskTitles: overdueHighPriority.map(t => t.title),
      suggestedAction: 'Immediately reassign or clear blockers on high-priority overdue deliverables.',
    });
  }

  // 2. Check general overdue tasks (medium / low priority)
  const otherOverdue = projectTasks.filter(
    t => t.priority !== 'High' && isTaskOverdue(t, referenceDate)
  );

  if (otherOverdue.length > 0) {
    riskScore += otherOverdue.length * 10;
    factors.push({
      id: `rf-overdue-other-${project.id}`,
      code: 'OVERDUE_TASKS',
      severity: otherOverdue.length >= 3 ? 'Medium' : 'Low',
      title: 'Overdue Pending Tasks',
      description: `${otherOverdue.length} medium/low priority task${otherOverdue.length > 1 ? 's are' : ' is'} past deadline.`,
      affectedTaskIds: otherOverdue.map(t => t.id),
      affectedTaskTitles: otherOverdue.map(t => t.title),
      suggestedAction: 'Review task estimates and reschedule deadlines or delegate workload.',
    });
  }

  // 3. Imminent project deadline with low completion
  if (
    project.status !== 'Completed' &&
    daysUntilProjectDeadline !== null &&
    daysUntilProjectDeadline <= 7 &&
    daysUntilProjectDeadline >= 0 &&
    completionPercentage < 50
  ) {
    riskScore += 35;
    factors.push({
      id: `rf-deadline-low-comp-${project.id}`,
      code: 'DEADLINE_IMMINENT_LOW_PROGRESS',
      severity: 'High',
      title: 'Critical Timeline Compression',
      description: `Project deadline is in ${daysUntilProjectDeadline} days, but completion is currently only ${completionPercentage}%.`,
      affectedTaskIds: projectTasks.filter(t => !isTaskCompleted(t.status)).map(t => t.id),
      affectedTaskTitles: projectTasks.filter(t => !isTaskCompleted(t.status)).map(t => t.title),
      suggestedAction: 'Trim non-essential backlog scope or allocate additional team members immediately.',
    });
  }

  // 4. Tasks due within 3 days approaching deadline that are not completed
  const approachingTasks = projectTasks.filter(t => {
    if (isTaskCompleted(t.status) || !t.dueDate) return false;
    const due = new Date(t.dueDate);
    const diffDays = Math.ceil((due.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= 3;
  });

  if (approachingTasks.length > 0) {
    riskScore += approachingTasks.length * 5;
    factors.push({
      id: `rf-approaching-${project.id}`,
      code: 'APPROACHING_DEADLINE_TASKS',
      severity: approachingTasks.some(t => t.priority === 'High') ? 'Medium' : 'Low',
      title: 'Tasks Due Within 3 Days',
      description: `${approachingTasks.length} task${approachingTasks.length > 1 ? 's have' : ' has'} deadlines approaching in the next 72 hours.`,
      affectedTaskIds: approachingTasks.map(t => t.id),
      affectedTaskTitles: approachingTasks.map(t => t.title),
      suggestedAction: 'Confirm with assignees that these deliverables are on track for handover.',
    });
  }

  // 5. Unassigned high priority tasks
  const unassignedHigh = projectTasks.filter(
    t => t.priority === 'High' && !t.assigneeId && !isTaskCompleted(t.status)
  );
  if (unassignedHigh.length > 0) {
    riskScore += unassignedHigh.length * 15;
    factors.push({
      id: `rf-unassigned-high-${project.id}`,
      code: 'UNASSIGNED_HIGH_PRIORITY',
      severity: 'Medium',
      title: 'Unassigned Critical Tasks',
      description: `${unassignedHigh.length} high-priority task${unassignedHigh.length > 1 ? 's have' : ' has'} no designated owner.`,
      affectedTaskIds: unassignedHigh.map(t => t.id),
      affectedTaskTitles: unassignedHigh.map(t => t.title),
      suggestedAction: 'Assign owners immediately to avoid delivery vacuum.',
    });
  }

  // Cap risk score at 100
  riskScore = Math.min(100, riskScore);

  // If completed, risk is Low
  if (project.status === 'Completed') {
    riskScore = 0;
  }

  let overallLevel: RiskLevel = 'Low';
  if (riskScore >= 50 || factors.some(f => f.severity === 'High')) {
    overallLevel = 'High';
  } else if (riskScore >= 25 || factors.some(f => f.severity === 'Medium')) {
    overallLevel = 'Medium';
  }

  let summaryRecommendation = 'Project metrics are healthy. Continue normal milestone tracking.';
  if (overallLevel === 'High') {
    summaryRecommendation = 'Urgent intervention needed: address overdue high-priority items and evaluate scope tradeoffs.';
  } else if (overallLevel === 'Medium') {
    summaryRecommendation = 'Moderate attention required: monitor impending deadlines and resolve pending items.';
  }

  return {
    projectId: project.id,
    projectName: project.name,
    riskLevel: overallLevel,
    riskScore,
    factors,
    totalTasks,
    completedTasks,
    completionPercentage,
    daysUntilProjectDeadline,
    summaryRecommendation,
    lastEvaluatedAt: referenceDate.toISOString(),
  };
}
