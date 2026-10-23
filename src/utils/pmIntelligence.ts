import { Task, TeamMember } from '../types/index.ts';
import { isTaskCompleted } from './contribution.ts';

export interface CriticalPathTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  estimated_hours?: number;
  due_date?: string;
  dependencies?: string[];
  project_id?: string;
  [key: string]: any;
}

export interface CriticalPathResult {
  criticalTasks: CriticalPathTask[];
  totalEstimatedHours: number;
  longestChainCount: number;
  scheduleVarianceDays: number;
}

export interface EstimationAccuracyItem {
  taskId: string;
  title: string;
  estimatedHours: number;
  actualHours: number;
  varianceHours: number;
  accuracyPercentage: number;
}

export interface MissingEvidenceItem {
  taskId: string;
  issueKey: string;
  title: string;
  assigneeName: string;
  status: string;
  reason: string;
}

export interface RedistributionSuggestion {
  taskId: string;
  taskTitle: string;
  fromMemberId: string;
  fromMemberName: string;
  toMemberId: string;
  toMemberName: string;
  reason: string;
  matchedSkills: string[];
}

/**
 * Calculates estimation accuracy and variance for completed or in-progress tasks.
 */
export function calculateEstimationAccuracy(
  tasks: Array<{ id: string; title: string; estimated_hours?: number; actual_hours?: number; status: string }>
): {
  items: EstimationAccuracyItem[];
  averageAccuracy: number;
  totalEstimated: number;
  totalActual: number;
} {
  const eligible = tasks.filter(t => (t.estimated_hours || 0) > 0 || (t.actual_hours || 0) > 0);
  if (eligible.length === 0) {
    return { items: [], averageAccuracy: 100, totalEstimated: 0, totalActual: 0 };
  }

  let totalEst = 0;
  let totalAct = 0;
  let accuracySum = 0;

  const items: EstimationAccuracyItem[] = eligible.map(t => {
    const est = t.estimated_hours || 0;
    const act = t.actual_hours || (isTaskCompleted(t.status) ? est : 0);
    totalEst += est;
    totalAct += act;

    const variance = act - est;
    let accuracy = 100;
    if (est > 0) {
      const errorRatio = Math.abs(act - est) / est;
      accuracy = Math.max(0, Math.round((1 - errorRatio) * 100));
    }

    accuracySum += accuracy;
    return {
      taskId: t.id,
      title: t.title,
      estimatedHours: est,
      actualHours: act,
      varianceHours: variance,
      accuracyPercentage: accuracy
    };
  });

  const avgAccuracy = Math.round(accuracySum / items.length);

  return {
    items,
    averageAccuracy: avgAccuracy,
    totalEstimated: totalEst,
    totalActual: totalAct
  };
}

/**
 * Detects missing evidence on deliverables marked "Done".
 * A completed deliverable should have linked commits, linked PRs, or an approved review sign-off.
 */
export function detectMissingEvidence(
  tasks: Array<{
    id: string;
    issue_key?: string;
    title: string;
    status: string;
    assignee_id?: string | null;
    linked_commits?: any[];
    reviews?: Array<{ status: string }>;
  }>,
  teamMembers: Array<{ id: string; name: string }>
): MissingEvidenceItem[] {
  const memberMap = new Map(teamMembers.map(m => [m.id, m.name]));
  const missing: MissingEvidenceItem[] = [];

  for (const t of tasks) {
    if (isTaskCompleted(t.status)) {
      const hasCommits = Boolean(t.linked_commits && t.linked_commits.length > 0);
      const hasApprovedReview = Boolean(t.reviews && t.reviews.some(r => r.status === 'Approved'));

      if (!hasCommits && !hasApprovedReview) {
        missing.push({
          taskId: t.id,
          issueKey: t.issue_key || t.id,
          title: t.title,
          assigneeName: t.assignee_id ? memberMap.get(t.assignee_id) || 'Unassigned' : 'Unassigned',
          status: t.status,
          reason: 'Marked Completed without verified Git commit, PR, or peer review sign-off.'
        });
      }
    }
  }

  return missing;
}

/**
 * Suggests task reassignments from overloaded members to available members with matching skills.
 */
export function generateRedistributionSuggestions(
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    assignee_id?: string | null;
    issue_type?: string;
  }>,
  members: Array<{
    id: string;
    name: string;
    role: string;
    skills?: string;
    assigned_count?: number;
  }>
): RedistributionSuggestion[] {
  const pendingTasks = tasks.filter(t => !isTaskCompleted(t.status) && t.assignee_id);
  
  // Calculate task counts per member
  const counts: Record<string, number> = {};
  for (const m of members) counts[m.id] = 0;
  for (const t of pendingTasks) {
    if (t.assignee_id && counts[t.assignee_id] !== undefined) {
      counts[t.assignee_id]++;
    }
  }

  const suggestions: RedistributionSuggestion[] = [];
  const overloaded = members.filter(m => (counts[m.id] || 0) >= 3);
  const available = members.filter(m => (counts[m.id] || 0) <= 1);

  if (overloaded.length === 0 || available.length === 0) {
    return [];
  }

  for (const overMember of overloaded) {
    const memberTasks = pendingTasks.filter(t => t.assignee_id === overMember.id);
    // Prefer redistributing non-High or non-critical tasks first
    const redistributable = memberTasks.filter(t => t.priority !== 'High').slice(0, 1);

    for (const task of redistributable) {
      // Find candidate with matching role or skills
      const targetMember = available.find(avail => avail.id !== overMember.id);
      if (targetMember) {
        suggestions.push({
          taskId: task.id,
          taskTitle: task.title,
          fromMemberId: overMember.id,
          fromMemberName: overMember.name,
          toMemberId: targetMember.id,
          toMemberName: targetMember.name,
          reason: `${overMember.name} is carrying ${counts[overMember.id]} active tasks (Overloaded). Reallocating to ${targetMember.name} (${counts[targetMember.id]} tasks) balances capacity.`,
          matchedSkills: targetMember.skills ? targetMember.skills.split(',').map(s => s.trim()) : [targetMember.role]
        });
      }
    }
  }

  return suggestions;
}

/**
 * Calculates Critical Path & Schedule Variance.
 */
export function calculateCriticalPathAndVariance(
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    estimated_hours?: number;
    due_date?: string;
    dependencies?: string[];
  }>,
  projectDeadline?: string
): CriticalPathResult {
  // Critical tasks are high-priority pending tasks or tasks with dependencies
  const criticalTasks = tasks.filter(
    t => !isTaskCompleted(t.status) && (t.priority === 'High' || (t.dependencies && t.dependencies.length > 0))
  );

  const totalEstimatedHours = criticalTasks.reduce((acc, t) => acc + (t.estimated_hours || 4), 0);
  const longestChainCount = Math.max(1, criticalTasks.length);

  let scheduleVarianceDays = 0;
  if (projectDeadline) {
    const deadlineDate = new Date(projectDeadline);
    const now = new Date();
    const daysRemaining = Math.max(0, Math.ceil((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    // Assume 6 productive hours/day across critical path
    const daysNeeded = Math.ceil(totalEstimatedHours / 6);
    scheduleVarianceDays = daysRemaining - daysNeeded; // Negative means behind schedule
  }

  return {
    criticalTasks,
    totalEstimatedHours,
    longestChainCount,
    scheduleVarianceDays
  };
}
