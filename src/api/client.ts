import {
  Project,
  Task,
  TeamMember,
  DashboardMetrics,
  MemberContribution,
  ProjectRisk,
  ProgressReportItem,
  OverdueReportItem,
  User
} from '../types';

const API_BASE = '/api';
const TOKEN_KEY = 'pulse_auth_token';
const LEGACY_TOKEN_KEY = 'equinox_auth_token';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null) {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(LEGACY_TOKEN_KEY);
    }
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {})
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, { ...options, headers });
  
  if (response.status === 204) {
    return {} as T;
  }

  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.toLowerCase().includes('application/json');

  if (!response.ok) {
    let errorDetail = `HTTP ${response.status}: ${response.statusText || 'Server Error'}`;
    if (isJson) {
      try {
        const errorData = await response.json();
        if (errorData.detail) {
          errorDetail = typeof errorData.detail === 'string' ? errorData.detail : JSON.stringify(errorData.detail);
        } else if (errorData.message) {
          errorDetail = typeof errorData.message === 'string' ? errorData.message : JSON.stringify(errorData.message);
        }
      } catch {
        // Fallback
      }
    } else {
      try {
        const rawText = await response.text();
        if (rawText && !rawText.includes('<!doctype') && !rawText.includes('<html')) {
          errorDetail = rawText.slice(0, 180);
        }
      } catch {
        // Fallback
      }
    }
    throw new Error(errorDetail);
  }

  if (!isJson) {
    const rawText = await response.text();
    console.warn(`[PULSE API] Received non-JSON response from ${endpoint} (${contentType || 'text/html'}):`, rawText.slice(0, 80));
    throw new Error(`API endpoint ${endpoint} returned unexpected non-JSON response (${contentType || 'text/html'})`);
  }

  return response.json();
}

export const api = {
  // Projects
  async getProjects(params?: { search?: string; status?: string }): Promise<Project[]> {
    const qs = new URLSearchParams();
    if (params?.search) qs.append('search', params.search);
    if (params?.status) qs.append('status', params.status);
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return request<Project[]>(`/projects${query}`);
  },

  async getProject(id: string): Promise<Project> {
    return request<Project>(`/projects/${id}`);
  },

  async createProject(data: Partial<Project>): Promise<Project> {
    return request<Project>('/projects', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async updateProject(id: string, data: Partial<Project>): Promise<Project> {
    return request<Project>(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  async deleteProject(id: string): Promise<void> {
    return request<void>(`/projects/${id}`, { method: 'DELETE' });
  },

  async addProjectMember(projectId: string, data: { member_id?: string; role: string; name?: string; email?: string; github_username?: string }): Promise<any> {
    return request<any>(`/projects/${projectId}/members`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async updateProjectMember(projectId: string, memberId: string, role: string): Promise<any> {
    return request<any>(`/projects/${projectId}/members/${memberId}`, {
      method: 'PUT',
      body: JSON.stringify({ role })
    });
  },

  async removeProjectMember(projectId: string, memberId: string): Promise<any> {
    return request<any>(`/projects/${projectId}/members/${memberId}`, {
      method: 'DELETE'
    });
  },

  async transferProjectLeadership(projectId: string, newLeaderId: string): Promise<any> {
    return request<any>(`/projects/${projectId}/transfer-leadership`, {
      method: 'POST',
      body: JSON.stringify({ new_leader_id: newLeaderId })
    });
  },

  // Tasks
  async getTasks(params?: {
    project_id?: string;
    status?: string;
    priority?: string;
    assignee_id?: string;
    search?: string;
    sort_by?: string;
    sort_order?: string;
  }): Promise<Task[]> {
    const qs = new URLSearchParams();
    if (params?.project_id) qs.append('project_id', params.project_id);
    if (params?.status) qs.append('status', params.status);
    if (params?.priority) qs.append('priority', params.priority);
    if (params?.assignee_id) qs.append('assignee_id', params.assignee_id);
    if (params?.search) qs.append('search', params.search);
    if (params?.sort_by) qs.append('sort_by', params.sort_by);
    if (params?.sort_order) qs.append('sort_order', params.sort_order);
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return request<Task[]>(`/tasks${query}`);
  },

  async createTask(data: Partial<Task>): Promise<Task> {
    return request<Task>('/tasks', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async updateTask(id: string, data: Partial<Task>): Promise<Task> {
    return request<Task>(`/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  async updateTaskStatus(id: string, status: string): Promise<Task> {
    return request<Task>(`/tasks/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
  },

  async deleteTask(id: string): Promise<void> {
    return request<void>(`/tasks/${id}`, { method: 'DELETE' });
  },

  // Team
  async getTeam(params?: { project_id?: string }): Promise<TeamMember[]> {
    const qs = new URLSearchParams();
    if (params?.project_id) qs.append('project_id', params.project_id);
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return request<TeamMember[]>(`/team${query}`);
  },

  async createTeamMember(data: Partial<TeamMember>): Promise<TeamMember> {
    return request<TeamMember>('/team', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async updateTeamMember(id: string, data: Partial<TeamMember>): Promise<TeamMember> {
    return request<TeamMember>(`/team/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  async deleteTeamMember(id: string): Promise<void> {
    return request<void>(`/team/${id}`, { method: 'DELETE' });
  },

  async getTeamWorkStatus(projectId?: string): Promise<any[]> {
    const query = projectId ? `?project_id=${projectId}` : '';
    return request<any[]>(`/team/work-status${query}`);
  },

  // Analytics & Dashboard
  async getDashboard(projectId?: string): Promise<DashboardMetrics> {
    const query = projectId ? `?project_id=${projectId}` : '';
    return request<DashboardMetrics>(`/dashboard${query}`);
  },

  async getContributions(projectId?: string): Promise<MemberContribution[]> {
    const query = projectId ? `?project_id=${projectId}` : '';
    return request<MemberContribution[]>(`/contributions${query}`);
  },

  async getRisks(projectId?: string): Promise<ProjectRisk[]> {
    const query = projectId ? `?project_id=${projectId}` : '';
    return request<ProjectRisk[]>(`/risks${query}`);
  },

  // Reports
  async getProgressReport(projectId?: string): Promise<ProgressReportItem[]> {
    const query = projectId ? `?project_id=${projectId}` : '';
    return request<ProgressReportItem[]>(`/reports/progress${query}`);
  },

  async getOverdueReport(projectId?: string): Promise<OverdueReportItem[]> {
    const query = projectId ? `?project_id=${projectId}` : '';
    return request<OverdueReportItem[]>(`/reports/overdue-tasks${query}`);
  },

  getExportCsvUrl(reportType: string, projectId?: string): string {
    const qs = new URLSearchParams({ report_type: reportType });
    if (projectId) qs.append('project_id', projectId);
    return `${API_BASE}/reports/export-csv?${qs.toString()}`;
  },

  // GitHub (Project & Per-Member Personal Integration)
  async getGitHubStatus(projectId: string): Promise<any> {
    return request<any>(`/github/status?project_id=${projectId}`);
  },

  async connectGitHub(data: { project_id: string; repo_owner: string; repo_name: string; access_token?: string }): Promise<any> {
    return request<any>('/github/connect', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async syncGitHub(projectId?: string): Promise<{
    success: boolean;
    message: string;
    results: any[];
    auto_updated_tasks: Array<{ issue_key: string; old_status: string; new_status: string; reason: string }>;
  }> {
    return request<any>('/github/sync', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId })
    });
  },

  async disconnectProjectGitHub(projectId: string): Promise<any> {
    return request<any>(`/github/disconnect?project_id=${projectId}`, {
      method: 'DELETE'
    });
  },

  async importGitHubIssues(data: { project_id: string; repo_owner?: string; repo_name?: string }): Promise<{
    success: boolean;
    message: string;
    imported_count: number;
    tasks: any[];
  }> {
    return request<any>('/github/import-issues', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async getGitHubOAuthUrl(): Promise<{ url: string; client_id: string }> {
    return request<{ url: string; client_id: string }>('/auth/github/url');
  },

  async getUserGitHubStatus(): Promise<any> {
    return request<any>('/user/github/status');
  },

  async connectUserGitHub(data: { access_token?: string; github_username?: string; selected_repo?: string }): Promise<any> {
    return request<any>('/user/github/connect', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async disconnectUserGitHub(): Promise<any> {
    return request<any>('/user/github/disconnect', { method: 'DELETE' });
  },

  async getUserGitHubRepos(): Promise<{ repos: any[]; warning?: string; error?: string }> {
    return request<{ repos: any[]; warning?: string; error?: string }>('/user/github/repos');
  },

  async selectUserGitHubRepo(repo_full_name: string, project_id?: string): Promise<any> {
    return request<any>('/user/github/select-repo', {
      method: 'POST',
      body: JSON.stringify({ repo_full_name, project_id })
    });
  },

  async getTeamGitHubStatus(): Promise<any[]> {
    return request<any[]>('/github/team-status');
  },

  async getTaskLinkedCommits(taskId: string): Promise<{
    issue_key: string;
    is_repo_connected: boolean;
    repository: string | null;
    commits: any[];
    pull_requests: any[];
    recent_repo_commits: any[];
  }> {
    return request<any>(`/github/commits-for-task/${taskId}`);
  },

  // AI Assistant (Agentic Groq openai/gpt-oss-120b + Hybrid RAG + LangChain Tools)
  async queryAI(data: { prompt: string; project_id?: string; enable_tools?: boolean }): Promise<any> {
    return request<any>('/ai/query', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // ElevenLabs Voice Services (STT & TTS)
  async getVoiceConfig(): Promise<{
    isConfigured: boolean;
    modelStt: string;
    modelTts: string;
    defaultVoiceId: string;
    supportedLanguages: Array<{ code: string; label: string }>;
  }> {
    return request<any>('/ai/voice/config');
  },

  async transcribeAudio(data: { audio_base64: string; mime_type?: string; language_code?: string }): Promise<{
    text: string;
    language_code?: string;
    duration_secs?: number;
  }> {
    return request<any>('/ai/voice/transcribe', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async synthesizeSpeech(data: { text: string; voice_id?: string }): Promise<{
    audio_base64: string;
    content_type: string;
  }> {
    return request<any>('/ai/voice/synthesize', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // Authentication & Access Management
  async login(credentials: { email: string; password: string }): Promise<{ token: string; user: User }> {
    const res = await request<{ token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials)
    });
    if (res.token) {
      setStoredToken(res.token);
    }
    return res;
  },

  async register(data: { name: string; email: string; password: string; role?: string }): Promise<{ token: string; user: User }> {
    const res = await request<{ token: string; user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data)
    });
    if (res.token) {
      setStoredToken(res.token);
    }
    return res;
  },

  async resetPassword(arg1: string | { email: string; new_password: string }, arg2?: string): Promise<{ success: boolean; message: string }> {
    const payload = typeof arg1 === 'string' ? { email: arg1, new_password: arg2 } : arg1;
    return request<{ success: boolean; message: string }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  async getMe(): Promise<{ user: User | null }> {
    return request<{ user: User | null }>('/auth/me');
  },

  logout(): void {
    setStoredToken(null);
  },

  // Team Invitations & Skills
  async sendTeamInvite(data: { project_id?: string; email: string; role: string }): Promise<{ success: boolean; invite_link: string; message: string }> {
    return request<{ success: boolean; invite_link: string; message: string }>('/team/invite', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // Project Archiving, Templates & Audit Logs
  async archiveProject(projectId: string, is_archived: boolean): Promise<any> {
    return request<any>(`/projects/${projectId}/archive`, {
      method: 'POST',
      body: JSON.stringify({ is_archived })
    });
  },

  async getProjectAuditLogs(projectId: string): Promise<any[]> {
    return request<any[]>(`/projects/${projectId}/audit-logs`);
  },

  async getProjectTemplates(): Promise<any[]> {
    return request<any[]>('/project-templates');
  },

  async createProjectFromTemplate(data: { template_id: string; name: string; leader_id?: string }): Promise<Project> {
    return request<Project>('/projects/from-template', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // Task Subtasks & Acceptance Criteria
  async getTaskSubtasks(taskId: string): Promise<any[]> {
    return request<any[]>(`/tasks/${taskId}/subtasks`);
  },

  async createTaskSubtask(taskId: string, title: string): Promise<any> {
    return request<any>(`/tasks/${taskId}/subtasks`, {
      method: 'POST',
      body: JSON.stringify({ title })
    });
  },

  async toggleTaskSubtask(taskId: string, subtaskId: string, is_completed: boolean): Promise<any> {
    return request<any>(`/tasks/${taskId}/subtasks/${subtaskId}`, {
      method: 'PUT',
      body: JSON.stringify({ is_completed })
    });
  },

  async deleteTaskSubtask(taskId: string, subtaskId: string): Promise<any> {
    return request<any>(`/tasks/${taskId}/subtasks/${subtaskId}`, { method: 'DELETE' });
  },

  async getTaskAcceptanceCriteria(taskId: string): Promise<any[]> {
    return request<any[]>(`/tasks/${taskId}/acceptance-criteria`);
  },

  async createTaskAcceptanceCriterion(taskId: string, criterion: string): Promise<any> {
    return request<any>(`/tasks/${taskId}/acceptance-criteria`, {
      method: 'POST',
      body: JSON.stringify({ criterion })
    });
  },

  async toggleTaskAcceptanceCriterion(taskId: string, critId: string, is_met: boolean): Promise<any> {
    return request<any>(`/tasks/${taskId}/acceptance-criteria/${critId}`, {
      method: 'PUT',
      body: JSON.stringify({ is_met })
    });
  },

  // Task Comments, Blockers & Peer Reviews
  async getTaskComments(taskId: string): Promise<any[]> {
    return request<any[]>(`/tasks/${taskId}/comments`);
  },

  async addTaskComment(taskId: string, content: string): Promise<any> {
    return request<any>(`/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content })
    });
  },

  async toggleTaskBlocker(taskId: string, data: { is_blocked: boolean; blocker_reason?: string; blocker_owner?: string }): Promise<any> {
    return request<any>(`/tasks/${taskId}/blocker`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async submitTaskReview(taskId: string, data: { status: 'Approved' | 'Changes Requested'; feedback?: string }): Promise<any> {
    return request<any>(`/tasks/${taskId}/reviews`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // Meeting Notes & Stand-up Generator
  async getMeetingNotes(projectId?: string): Promise<any[]> {
    const q = projectId ? `?project_id=${projectId}` : '';
    return request<any[]>(`/meeting-notes${q}`);
  },

  async createMeetingNote(data: any): Promise<any> {
    return request<any>('/meeting-notes', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async getStandupSummary(projectId?: string): Promise<{ standup_text: string; completed_yesterday: any[]; working_on_today: any[]; blockers: any[] }> {
    const q = projectId ? `?project_id=${projectId}` : '';
    return request<any>(`/collaboration/standup${q}`);
  },

  // Retrospectives & Estimation Accuracy
  async getRetrospectives(projectId?: string): Promise<any[]> {
    const q = projectId ? `?project_id=${projectId}` : '';
    return request<any[]>(`/retrospectives${q}`);
  },

  async createRetrospective(data: any): Promise<any> {
    return request<any>('/retrospectives', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async getEstimationAccuracy(projectId?: string): Promise<any> {
    const q = projectId ? `?project_id=${projectId}` : '';
    return request<any>(`/analytics/estimation-accuracy${q}`);
  },

  // Simulation & Task Redistribution Suggestions
  async getRedistributionSuggestions(projectId?: string): Promise<any[]> {
    const q = projectId ? `?project_id=${projectId}` : '';
    return request<any[]>(`/simulation/redistribution-suggestions${q}`);
  },

  async runWhatIfSimulation(data: { project_id?: string; deadline_shift_days: number; team_capacity_factor: number }): Promise<any> {
    return request<any>('/simulation/what-if', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // Disputes & Transparent Score Explanations
  async getDisputes(projectId?: string): Promise<any[]> {
    const q = projectId ? `?project_id=${projectId}` : '';
    return request<any[]>(`/contributions/disputes${q}`);
  },

  async submitDispute(data: { project_id: string; member_id: string; member_name: string; reason: string; evidence_url?: string }): Promise<any> {
    return request<any>('/contributions/dispute', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async resolveDispute(id: string, data: { status: 'Approved' | 'Rejected'; resolution_notes?: string }): Promise<any> {
    return request<any>(`/contributions/disputes/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // Notification Center
  async getNotifications(): Promise<any[]> {
    return request<any[]>('/notifications');
  },

  async markNotificationRead(id: string): Promise<any> {
    return request<any>(`/notifications/${id}/read`, { method: 'POST' });
  },

  async clearNotifications(): Promise<any> {
    return request<any>('/notifications/clear', { method: 'POST' });
  },

  // Calendar Export
  getCalendarExportUrl(projectId?: string): string {
    const q = projectId ? `?project_id=${projectId}` : '';
    return `${API_BASE}/calendar/export-ics${q}`;
  },



  async updateProfile(data: { name?: string; avatar_url?: string; github_username?: string; password?: string; role?: string }): Promise<any> {
    return request<any>('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  // Team Invitations
  async getInvitations(projectId?: string): Promise<any[]> {
    const q = projectId ? `?project_id=${projectId}` : '';
    return request<any[]>(`/invitations${q}`);
  },

  async createInvitation(data: { project_id: string; email: string; role: string }): Promise<any> {
    return request<any>('/invitations', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // Discussions
  async getDiscussions(projectId?: string): Promise<any[]> {
    const q = projectId ? `?project_id=${projectId}` : '';
    return request<any[]>(`/discussions${q}`);
  },

  async createDiscussion(data: { project_id: string; title: string; content: string; category?: string }): Promise<any> {
    return request<any>('/discussions', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // Peer Kudos
  async getKudos(projectId?: string): Promise<any[]> {
    const q = projectId ? `?project_id=${projectId}` : '';
    return request<any[]>(`/kudos${q}`);
  },

  async sendKudos(data: { project_id?: string; to_member_id: string; category: string; message: string }): Promise<any> {
    return request<any>('/kudos', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // Task Attachments
  async getTaskAttachments(taskId: string): Promise<any[]> {
    return request<any[]>(`/tasks/${taskId}/attachments`);
  },

  async addTaskAttachment(taskId: string, data: { file_name: string; file_size?: string; file_type?: string }): Promise<any> {
    return request<any>(`/tasks/${taskId}/attachments`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async deleteTaskAttachment(taskId: string, attId: string): Promise<any> {
    return request<any>(`/tasks/${taskId}/attachments/${attId}`, { method: 'DELETE' });
  },

  // Audit Logs
  async getAuditLogs(projectId?: string): Promise<any[]> {
    const q = projectId ? `?project_id=${projectId}` : '';
    return request<any[]>(`/audit-logs${q}`);
  },



  // Redistribution apply
  async applyRedistribution(task_id: string, to_member_id: string): Promise<any> {
    return request<any>('/simulation/redistribute/apply', {
      method: 'POST',
      body: JSON.stringify({ task_id, to_member_id })
    });
  },

  // Database Backup
  getDatabaseBackupUrl(): string {
    return `${API_BASE}/database/backup`;
  },

  // System Weights
  async getCustomWeights(): Promise<any> {
    return request<any>('/settings/weights');
  },

  async saveCustomWeights(weights: any): Promise<any> {
    return request<any>('/settings/weights', {
      method: 'POST',
      body: JSON.stringify(weights)
    });
  },

  // GitHub Project Import & Sync
  async importGitHubProject(data: {
    repo_owner: string;
    repo_name: string;
    access_token?: string;
    name?: string;
    description?: string;
    key_prefix?: string;
  }): Promise<{ success: boolean; message: string; project: Project; imported_issues_count: number }> {
    return request<{ success: boolean; message: string; project: Project; imported_issues_count: number }>(
      '/github/import-project',
      {
        method: 'POST',
        body: JSON.stringify(data)
      }
    );
  },

  // Documents & RAG Ingestion
  async getDocuments(projectId?: string): Promise<any[]> {
    const q = projectId ? `?project_id=${projectId}` : '';
    return request<any[]>(`/documents${q}`);
  },

  async uploadDocument(data: { project_id: string; filename: string; file_type?: string; file_content?: string; file_base64?: string }): Promise<any> {
    return request<any>('/documents/upload', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async deleteDocument(id: string): Promise<any> {
    return request<any>(`/documents/${id}`, { method: 'DELETE' });
  },

  // LangGraph Workflows & Approvals
  async getWorkflows(projectId?: string): Promise<any[]> {
    const q = projectId ? `?project_id=${projectId}` : '';
    return request<any[]>(`/ai/workflows${q}`);
  },

  async startWorkflow(data: { workflow_type: string; project_id: string; input_query?: string; document_id?: string; document_content?: string }): Promise<any> {
    return request<any>('/ai/workflows/start', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async approveWorkflow(id: string): Promise<any> {
    return request<any>(`/ai/workflows/${id}/approve`, { method: 'POST' });
  },

  async rejectWorkflow(id: string): Promise<any> {
    return request<any>(`/ai/workflows/${id}/reject`, { method: 'POST' });
  },

  async investigateGitHub(data: { project_id: string; question: string; author_login?: string; issue_key?: string }): Promise<any> {
    return request<any>('/ai/investigate-github', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // Autonomous AI Project Manager
  async startAutonomousPM(data: { project_id?: string; idea?: string; document_id?: string; document_content?: string; document_filename?: string }): Promise<any> {
    return request<any>('/ai/pm/start', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async clarifyAutonomousPM(workflowId: string, data: { answers?: any[]; additional_requirements?: string; force_generate_plan?: boolean }): Promise<any> {
    return request<any>(`/ai/pm/${workflowId}/clarify`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async generatePlanAutonomousPM(workflowId: string): Promise<any> {
    return request<any>(`/ai/pm/${workflowId}/generate-plan`, {
      method: 'POST'
    });
  },

  async updatePlanAutonomousPM(workflowId: string, plan: any): Promise<any> {
    return request<any>(`/ai/pm/${workflowId}/plan`, {
      method: 'PUT',
      body: JSON.stringify({ plan })
    });
  },

  async approveAutonomousPM(workflowId: string, data?: { plan_hash?: string }): Promise<any> {
    return request<any>(`/ai/pm/${workflowId}/approve`, {
      method: 'POST',
      body: JSON.stringify(data || {})
    });
  },

  async getAutonomousPMStatus(workflowId: string): Promise<any> {
    return request<any>(`/ai/pm/${workflowId}/status`);
  },

  async monitorAutonomousPM(workflowId: string): Promise<any> {
    return request<any>(`/ai/pm/${workflowId}/monitor`);
  },

  // System
  async resetAndSeedData(): Promise<{ success: boolean; message: string }> {
    return request<{ success: boolean; message: string }>('/system/seed', {
      method: 'POST'
    });
  }
};
