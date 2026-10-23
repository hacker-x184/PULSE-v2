export type ProjectStatus = 'Planning' | 'Active' | 'In Review' | 'Completed' | 'On Hold';
export type TaskStatus = 'To Do' | 'In Progress' | 'In Review' | 'Done';
export type TaskPriority = 'Low' | 'Medium' | 'High';
export type RiskLevel = 'Low' | 'Medium' | 'High';
export type IssueType = 'Story' | 'Bug' | 'Task' | 'Epic';
export type ProjectRole = 'Team Leader' | 'Project Leader' | 'Tech Lead' | 'Senior Developer' | 'QA Engineer' | 'Product Designer';
export type SystemRole = 'Team Leader' | 'Member';

export interface ProjectMemberDetail {
  member_id: string;
  role: ProjectRole | string;
  name?: string;
  email?: string;
  avatar_url?: string;
  github_username?: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  objectives?: string;
  start_date?: string;
  deadline?: string;
  status: ProjectStatus;
  leader_id?: string;
  leader_name?: string;
  key_prefix?: string;
  current_sprint?: string;
  is_archived?: boolean;
  member_ids?: string[];
  members?: ProjectMemberDetail[];
  created_at?: string;
  updated_at?: string;
  github_repo_owner?: string;
  github_repo_name?: string;
  github_repo_visibility?: string;
  github_default_branch?: string;
  github_imported_at?: string;
  github_html_url?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: SystemRole | string;
  avatar_url?: string;
  created_at?: string;
  github_username?: string;
}

export interface LinkedCommit {
  sha: string;
  message: string;
  author_login: string;
  date?: string;
  url?: string;
  branch?: string;
}

export interface Subtask {
  id: string;
  task_id: string;
  title: string;
  is_completed: boolean;
  created_at?: string;
}

export interface AcceptanceCriterion {
  id: string;
  task_id: string;
  criterion: string;
  is_met: boolean;
  created_at?: string;
}

export interface TaskReview {
  id: string;
  task_id: string;
  reviewer_id: string;
  reviewer_name: string;
  status: 'Approved' | 'Changes Requested' | 'Pending';
  feedback?: string;
  reviewed_at?: string;
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_id: string;
  author_name: string;
  author_avatar?: string;
  content: string;
  created_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  issue_key?: string;
  issue_type?: IssueType;
  title: string;
  description?: string;
  priority: TaskPriority;
  status: TaskStatus;
  due_date?: string;
  assignee_id?: string | null;
  reporter_id?: string | null;
  estimated_hours?: number;
  actual_hours?: number;
  story_points?: number;
  sprint?: string;
  is_blocked?: boolean;
  blocker_reason?: string;
  blocker_owner?: string;
  dependencies?: string[];
  linked_commits?: LinkedCommit[];
  subtasks?: Subtask[];
  acceptance_criteria?: AcceptanceCriterion[];
  reviews?: TaskReview[];
  comments?: TaskComment[];
  created_at?: string;
  updated_at?: string;
  github_repo_owner?: string;
  github_repo_name?: string;
  github_repo_visibility?: string;
  github_default_branch?: string;
  github_imported_at?: string;
  github_html_url?: string;
}

export interface UserGitHubProfile {
  user_id: string;
  github_username: string;
  name?: string;
  avatar_url?: string;
  html_url?: string;
  public_repos?: number;
  selected_repo?: string;
  connected_at: string;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar_url?: string;
  github_username?: string;
  skills?: string;
  capacity_hours?: number;
  assigned_project_ids?: string[];
  created_at?: string;
  updated_at?: string;
  github_repo_owner?: string;
  github_repo_name?: string;
  github_repo_visibility?: string;
  github_default_branch?: string;
  github_imported_at?: string;
  github_html_url?: string;
}

export interface DashboardMetrics {
  total_projects: number;
  total_tasks: number;
  completed_tasks: number;
  pending_tasks: number;
  overdue_tasks: number;
  overall_completion_percentage: number;
  upcoming_deadlines: Task[];
  team_workload_summary: {
    member_id: string;
    name: string;
    role: string;
    avatar_url?: string;
    total_assigned: number;
    pending: number;
    completed: number;
    overdue: number;
    workload_status: 'Low' | 'Balanced' | 'High' | 'Overloaded';
  }[];
  recent_activity: {
    id: string;
    title: string;
    status: string;
    priority: string;
    timestamp: string;
  }[];
  project_risk_overview: {
    project_id: string;
    project_name: string;
    risk_level: RiskLevel;
    risk_score: number;
    completion_percentage: number;
    deadline?: string;
    summary_recommendation: string;
    factor_count: number;
  }[];
}

export interface MemberContribution {
  member_id: string;
  member_name: string;
  role: string;
  avatar_url?: string;
  total_assigned: number;
  completed_tasks: number;
  pending_tasks: number;
  overdue_tasks: number;
  completion_rate: number;
  high_priority_completed: number;
  medium_priority_completed: number;
  low_priority_completed: number;
  total_assigned_weight: number;
  completed_weight: number;
  weighted_score: number;
  workload_status: 'Low' | 'Balanced' | 'High' | 'Overloaded';
  github_activity_status: 'connected' | 'not_configured' | 'error';
  github_commits_count: number | null;
  github_prs_count: number | null;
  calculation_notes: string[];
}

export interface RiskFactor {
  id: string;
  code: string;
  severity: RiskLevel;
  title: string;
  description: string;
  affected_task_ids: string[];
  affected_task_titles: string[];
  suggested_action: string;
}

export interface ProjectRisk {
  project_id: string;
  project_name: string;
  risk_level: RiskLevel;
  risk_score: number;
  factors: RiskFactor[];
  total_tasks: number;
  completed_tasks: number;
  completion_percentage: number;
  days_until_deadline: number | null;
  summary_recommendation: string;
  last_evaluated_at: string;
}

export interface ProgressReportItem {
  project_id: string;
  project_name: string;
  status: ProjectStatus;
  deadline?: string;
  total_tasks: number;
  completed_tasks: number;
  overdue_tasks: number;
  high_priority_tasks: number;
  completion_percentage: number;
}

export interface OverdueReportItem {
  task_id: string;
  title: string;
  project_name: string;
  priority: TaskPriority;
  due_date: string;
  assignee_name: string;
  status: TaskStatus;
}

export interface AuditLog {
  id: string;
  project_id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_name: string;
  details: string;
  created_at: string;
}

export interface Dispute {
  id: string;
  project_id: string;
  member_id: string;
  member_name: string;
  reason: string;
  evidence_url?: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  resolution_notes?: string;
  created_at: string;
  resolved_at?: string;
}

export interface AppNotification {
  id: string;
  user_id?: string;
  title: string;
  message: string;
  type: 'assignment' | 'blocker' | 'review' | 'dispute' | 'milestone';
  link?: string;
  is_read: boolean;
  created_at: string;
}

export interface MeetingNote {
  id: string;
  project_id: string;
  title: string;
  meeting_date: string;
  attendees: string;
  content: string;
  action_items: string;
  created_at: string;
}

export interface Retrospective {
  id: string;
  project_id: string;
  sprint: string;
  went_well: string;
  needs_improvement: string;
  action_items: string;
  created_at: string;
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  default_tasks: Array<{
    title: string;
    priority: TaskPriority;
    issue_type: IssueType;
    story_points: number;
    estimated_hours: number;
    description: string;
  }>;
}

export interface Discussion {
  id: string;
  project_id: string;
  author_id?: string;
  author_name: string;
  author_avatar?: string;
  category: string;
  title: string;
  content: string;
  created_at: string;
}

export interface PeerKudos {
  id: string;
  project_id?: string;
  from_name: string;
  to_member_id: string;
  to_member_name?: string;
  to_member_avatar?: string;
  category: string;
  message: string;
  created_at: string;
}

export interface TaskAttachment {
  id: string;
  task_id: string;
  file_name: string;
  file_size: string;
  file_type: string;
  uploaded_by: string;
  created_at: string;
}

export interface ProjectInvitation {
  id: string;
  project_id?: string;
  email: string;
  role: string;
  token: string;
  expires_at: string;
  created_at: string;
}

