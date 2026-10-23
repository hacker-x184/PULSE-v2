/**
 * Team Member Contribution Analysis Logic
 * 
 * Transparent, evidence-based metrics calculated from concrete database records.
 * We explicitly do NOT claim completion rate alone represents overall contribution.
 * Missing integrations (e.g. GitHub) are marked as unavailable rather than zero.
 */

export interface TaskRecord {
  id: string;
  projectId: string;
  title: string;
  priority: 'Low' | 'Medium' | 'High';
  status: 'To Do' | 'In Progress' | 'In Review' | 'Done' | 'Not Started' | 'Completed';
  dueDate: string;
  assigneeId?: string | null;
  estimatedHours?: number;
}

export function isTaskCompleted(status: string): boolean {
  return status === 'Completed' || status === 'Done';
}

export interface MemberContributionMetrics {
  memberId: string;
  memberName: string;
  totalAssigned: number;
  completedTasks: number;
  pendingTasks: number;
  overdueTasks: number;
  completionRate: number; // 0 - 100 percentage
  highPriorityCompleted: number;
  mediumPriorityCompleted: number;
  lowPriorityCompleted: number;
  // Weighted contribution score based on task difficulty/priority
  // Low = 1pt, Medium = 2pts, High = 3pts
  totalAssignedWeight: number;
  completedWeight: number;
  weightedScore: number; // 0 - 100 percentage
  // Explicit status of external indicators
  githubActivityStatus: 'connected' | 'not_configured' | 'error';
  githubCommitsCount: number | null;
  githubPRsCount: number | null;
  workloadStatus: 'Low' | 'Balanced' | 'High' | 'Overloaded';
  calculationNotes: string[];
}

export function isTaskOverdue(task: { status: string; dueDate?: string | null }, referenceDate: Date = new Date()): boolean {
  if (isTaskCompleted(task.status)) return false;
  if (!task.dueDate) return false;
  // Compare end of the due date day with referenceDate
  const due = new Date(task.dueDate);
  // Normalize comparison to end of day
  due.setHours(23, 59, 59, 999);
  return due.getTime() < referenceDate.getTime();
}

export function calculateMemberContribution(
  member: { id: string; name: string; githubUsername?: string | null },
  tasks: TaskRecord[],
  githubData?: { commits: number; prs: number } | null,
  referenceDate: Date = new Date()
): MemberContributionMetrics {
  const memberTasks = tasks.filter(t => t.assigneeId === member.id);
  const totalAssigned = memberTasks.length;
  
  const completed = memberTasks.filter(t => isTaskCompleted(t.status));
  const completedTasks = completed.length;
  
  const pendingTasks = memberTasks.filter(t => !isTaskCompleted(t.status)).length;
  
  const overdueTasks = memberTasks.filter(t => isTaskOverdue(t, referenceDate)).length;
  
  const completionRate = totalAssigned > 0 
    ? Math.round((completedTasks / totalAssigned) * 100) 
    : 0;

  let highPriorityCompleted = 0;
  let mediumPriorityCompleted = 0;
  let lowPriorityCompleted = 0;

  let totalAssignedWeight = 0;
  let completedWeight = 0;

  const priorityWeights: Record<string, number> = {
    Low: 1,
    Medium: 2,
    High: 3,
  };

  for (const t of memberTasks) {
    const weight = priorityWeights[t.priority] || 1;
    totalAssignedWeight += weight;
    if (isTaskCompleted(t.status)) {
      completedWeight += weight;
      if (t.priority === 'High') highPriorityCompleted++;
      else if (t.priority === 'Medium') mediumPriorityCompleted++;
      else lowPriorityCompleted++;
    }
  }

  const weightedScore = totalAssignedWeight > 0
    ? Math.round((completedWeight / totalAssignedWeight) * 100)
    : 0;

  // Workload categorization based on active (non-done) tasks
  let workloadStatus: 'Low' | 'Balanced' | 'High' | 'Overloaded' = 'Balanced';
  if (pendingTasks === 0) workloadStatus = 'Low';
  else if (pendingTasks <= 3) workloadStatus = 'Balanced';
  else if (pendingTasks <= 6) workloadStatus = 'High';
  else workloadStatus = 'Overloaded';

  const notes: string[] = [];
  if (totalAssigned === 0) {
    notes.push('No tasks currently assigned to this member.');
  } else {
    notes.push(`Weighted score factors in task priorities (High: 3x, Medium: 2x, Low: 1x).`);
    if (overdueTasks > 0) {
      notes.push(`${overdueTasks} active task${overdueTasks > 1 ? 's are' : ' is'} overdue.`);
    }
  }

  let githubActivityStatus: 'connected' | 'not_configured' | 'error' = 'not_configured';
  let githubCommitsCount: number | null = null;
  let githubPRsCount: number | null = null;

  if (githubData) {
    githubActivityStatus = 'connected';
    githubCommitsCount = githubData.commits;
    githubPRsCount = githubData.prs;
  } else if (!member.githubUsername) {
    githubActivityStatus = 'not_configured';
  }

  return {
    memberId: member.id,
    memberName: member.name,
    totalAssigned,
    completedTasks,
    pendingTasks,
    overdueTasks,
    completionRate,
    highPriorityCompleted,
    mediumPriorityCompleted,
    lowPriorityCompleted,
    totalAssignedWeight,
    completedWeight,
    weightedScore,
    githubActivityStatus,
    githubCommitsCount,
    githubPRsCount,
    workloadStatus,
    calculationNotes: notes,
  };
}
