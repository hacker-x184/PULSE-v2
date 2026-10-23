import React, { useState, useEffect } from 'react';
import {
  CheckSquare,
  Bookmark,
  Bug,
  Zap,
  Copy,
  Check,
  Calendar,
  Clock,
  User as UserIcon,
  GitCommit,
  GitBranch,
  GitPullRequest,
  ExternalLink,
  ChevronDown,
  Trash2,
  AlertCircle,
  Github,
  Save,
  Tag,
  Paperclip,
  File,
  Plus
} from 'lucide-react';
import { Task, TaskPriority, TaskStatus, IssueType, Project, TeamMember, LinkedCommit } from '../../types';
import { api } from '../../api/client';
import { Avatar } from '../common/Avatar';

interface JiraIssueDetailModalProps {
  task: Task | null;
  isOpen: boolean;
  onClose: () => void;
  project: Project | null;
  team: TeamMember[];
  onUpdateTask: (id: string, data: Partial<Task>) => Promise<void>;
  onDeleteTask: (id: string) => Promise<void>;
  onOpenGitHubModal?: () => void;
}

export const JiraIssueDetailModal: React.FC<JiraIssueDetailModalProps> = ({
  task,
  isOpen,
  onClose,
  project,
  team,
  onUpdateTask,
  onDeleteTask,
  onOpenGitHubModal
}) => {
  const [title, setTitle] = useState(task?.title || '');
  const [description, setDescription] = useState(task?.description || '');
  const [status, setStatus] = useState<TaskStatus>(task?.status || 'To Do');
  const [priority, setPriority] = useState<TaskPriority>(task?.priority || 'Medium');
  const [issueType, setIssueType] = useState<IssueType>(task?.issue_type || 'Story');
  const [storyPoints, setStoryPoints] = useState<number>(task?.story_points || 3);
  const [sprint, setSprint] = useState<string>(task?.sprint || project?.current_sprint || 'Sprint 1 (Active)');
  const [assigneeId, setAssigneeId] = useState<string>(task?.assignee_id || '');
  const [dueDate, setDueDate] = useState<string>(task?.due_date || '');
  const [estimatedHours, setEstimatedHours] = useState<number>(task?.estimated_hours || 0);

  const [linkedCommits, setLinkedCommits] = useState<LinkedCommit[]>([]);
  const [linkedPRs, setLinkedPRs] = useState<any[]>([]);
  const [recentCommits, setRecentCommits] = useState<any[]>([]);
  const [isRepoConnected, setIsRepoConnected] = useState<boolean>(true);
  const [repoName, setRepoName] = useState<string>('');
  const [isLoadingCommits, setIsLoadingCommits] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Attachments State
  const [attachments, setAttachments] = useState<any[]>([]);
  const [newFileName, setNewFileName] = useState('');
  const [isAddingAttachment, setIsAddingAttachment] = useState(false);

  // Sync state when task changes
  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description || '');
    setStatus(task.status);
    setPriority(task.priority);
    setIssueType(task.issue_type || 'Story');
    setStoryPoints(task.story_points || 3);
    setSprint(task.sprint || project?.current_sprint || 'Sprint 1 (Active)');
    setAssigneeId(task.assignee_id || '');
    setDueDate(task.due_date || '');
    setEstimatedHours(task.estimated_hours || 0);

    // Fetch attachments
    api.getTaskAttachments(task.id)
      .then(res => setAttachments(res || []))
      .catch(() => setAttachments([]));

    // Fetch linked commits & PRs for this issue key
    setIsLoadingCommits(true);
    api.getTaskLinkedCommits(task.id)
      .then(res => {
        setIsRepoConnected(Boolean(res.is_repo_connected));
        setLinkedCommits(res.commits || []);
        setLinkedPRs(res.pull_requests || []);
        setRecentCommits(res.recent_repo_commits || []);
        setRepoName(res.repository || '');
      })
      .catch(() => {
        setIsRepoConnected(false);
        setLinkedCommits([]);
        setLinkedPRs([]);
        setRecentCommits([]);
      })
      .finally(() => {
        setIsLoadingCommits(false);
      });
  }, [task]);

  if (!isOpen || !task) return null;

  const handleAddAttachment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName.trim()) return;
    setIsAddingAttachment(true);
    try {
      const res = await api.addTaskAttachment(task.id, {
        file_name: newFileName.trim(),
        file_size: `${(Math.random() * 400 + 50).toFixed(0)} KB`,
        file_type: newFileName.endsWith('.pdf') ? 'application/pdf' : 'text/plain'
      });
      setAttachments([res, ...attachments]);
      setNewFileName('');
    } catch {} finally {
      setIsAddingAttachment(false);
    }
  };

  const handleDeleteAttachment = async (attId: string) => {
    try {
      await api.deleteTaskAttachment(task.id, attId);
      setAttachments(attachments.filter(a => a.id !== attId));
    } catch {}
  };

  const issueKey = task.issue_key || `${project?.key_prefix || 'EQX'}-${task.id.replace('t-', '')}`;

  const copyIssueKey = () => {
    navigator.clipboard.writeText(issueKey);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onUpdateTask(task.id, {
        title: title.trim(),
        description: description.trim() || undefined,
        status,
        priority,
        issue_type: issueType,
        story_points: Number(storyPoints) || 0,
        sprint,
        assignee_id: assigneeId || null,
        due_date: dueDate || undefined,
        estimated_hours: Number(estimatedHours) || 0
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err: any) {
      alert(`Failed to save task: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete ${issueKey}? This cannot be undone.`)) return;
    try {
      await onDeleteTask(task.id);
      onClose();
    } catch (err: any) {
      alert(`Failed to delete: ${err.message}`);
    }
  };

  const currentAssignee = team.find(m => m.id === assigneeId);

  const getIssueTypeBadge = (type: IssueType) => {
    switch (type) {
      case 'Story':
        return { icon: Bookmark, bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' };
      case 'Bug':
        return { icon: Bug, bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' };
      case 'Task':
        return { icon: CheckSquare, bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' };
      case 'Epic':
        return { icon: Zap, bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' };
      default:
        return { icon: CheckSquare, bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200' };
    }
  };

  const typeConfig = getIssueTypeBadge(issueType);
  const TypeIcon = typeConfig.icon;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6">
      <div className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Jira Header Bar */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* Issue Type selector */}
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-semibold ${typeConfig.bg} ${typeConfig.text} ${typeConfig.border}`}>
              <TypeIcon className="w-3.5 h-3.5" />
              <select
                value={issueType}
                onChange={(e) => setIssueType(e.target.value as IssueType)}
                className="bg-transparent font-semibold cursor-pointer focus:outline-hidden"
              >
                <option value="Story">Story</option>
                <option value="Task">Task</option>
                <option value="Bug">Bug</option>
                <option value="Epic">Epic</option>
              </select>
            </div>

            {/* Issue Key with copy button */}
            <button
              type="button"
              onClick={copyIssueKey}
              title="Click to copy Jira issue key"
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono font-bold text-slate-800 bg-white hover:bg-slate-100 border border-slate-300 rounded-md transition-colors"
            >
              <span>{issueKey}</span>
              {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
            </button>

            <span className="hidden sm:inline text-xs text-slate-400">·</span>
            <span className="hidden sm:inline text-xs text-slate-500 font-medium truncate max-w-[200px]">
              {project?.name || 'Project'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-3.5 py-1 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-2xs transition-colors disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save Changes'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Jira 2-Column Body */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
          {/* Main Content (Left 8 cols) */}
          <div className="lg:col-span-8 p-6 space-y-6">
            {/* Title */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Summary / Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full text-base sm:text-lg font-bold text-slate-900 border-b border-transparent hover:border-slate-300 focus:border-blue-600 focus:outline-hidden py-1 transition-colors"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                Description & Acceptance Criteria
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                placeholder="Add acceptance criteria, technical details, or verification steps..."
                className="w-full p-3 text-xs text-slate-800 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 transition-all font-mono leading-relaxed"
              />
            </div>

            {/* Jira Real GitHub / Development Panel */}
            <div className="p-4 bg-slate-900 text-slate-200 rounded-xl space-y-3 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <div className="flex items-center gap-2">
                  <Github className="w-4 h-4 text-white" />
                  <span className="text-xs font-bold text-white tracking-wide">Development · Real GitHub Activity</span>
                </div>

                <div className="flex items-center gap-2">
                  {onOpenGitHubModal && (
                    <button
                      type="button"
                      onClick={onOpenGitHubModal}
                      className="text-[11px] text-blue-400 hover:text-blue-300 hover:underline flex items-center gap-1 font-medium"
                    >
                      <span>Manage GitHub</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {isLoadingCommits ? (
                <div className="text-xs text-slate-400 py-3 text-center">
                  Fetching verified commits & pull requests for {issueKey}...
                </div>
              ) : !isRepoConnected ? (
                <div className="p-4 bg-slate-800/80 border border-slate-700/60 rounded-lg text-center space-y-2">
                  <div className="text-xs text-slate-300 font-medium">
                    No GitHub repository connected for this project.
                  </div>
                  <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
                    Connect a repository to automatically link commits, track pull requests, and enable real task status transitions.
                  </p>
                  {onOpenGitHubModal && (
                    <button
                      type="button"
                      onClick={onOpenGitHubModal}
                      className="mt-1 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg shadow-2xs transition-colors inline-flex items-center gap-1.5"
                    >
                      <Github className="w-3.5 h-3.5" />
                      <span>Connect Repository</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-[11px] text-slate-400 flex items-center justify-between">
                    <span className="flex items-center gap-1 font-mono">
                      <GitBranch className="w-3 h-3 text-blue-400" />
                      <span>{repoName || 'connected repository'}</span>
                    </span>
                    <span>{linkedCommits.length} linked commit(s) · {linkedPRs.length} PR(s)</span>
                  </div>

                  {/* Linked PRs */}
                  {linkedPRs.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                        Linked Pull Requests ({linkedPRs.length})
                      </div>
                      {linkedPRs.map((pr, idx) => (
                        <div key={idx} className="p-2.5 bg-slate-800/80 border border-slate-700/60 rounded-lg flex items-center justify-between gap-3 text-xs">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <GitPullRequest className={`w-4 h-4 shrink-0 ${pr.merged_at ? 'text-purple-400' : pr.state === 'open' ? 'text-emerald-400' : 'text-slate-400'}`} />
                            <div className="min-w-0">
                              <div className="text-slate-100 font-medium truncate flex items-center gap-1.5">
                                <span className="font-mono font-bold text-blue-400">#{pr.number}</span>
                                <span className="truncate">{pr.title}</span>
                              </div>
                              <div className="text-[11px] text-slate-400 font-mono flex items-center gap-2 mt-0.5">
                                <span>@{pr.author_login}</span>
                                <span>·</span>
                                <span className={`px-1.5 py-0.2 rounded text-[10px] font-semibold ${pr.merged_at ? 'bg-purple-900/60 text-purple-300' : pr.state === 'open' ? 'bg-emerald-900/60 text-emerald-300' : 'bg-slate-700 text-slate-300'}`}>
                                  {pr.merged_at ? 'merged' : pr.state}
                                </span>
                              </div>
                            </div>
                          </div>
                          {pr.url && (
                            <a
                              href={pr.url}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors shrink-0"
                              title="Open PR on GitHub"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Linked Commits */}
                  {linkedCommits.length > 0 ? (
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                        Linked Commits ({linkedCommits.length})
                      </div>
                      {linkedCommits.map((c, i) => (
                        <div key={i} className="p-2.5 bg-slate-800/80 border border-slate-700/60 rounded-lg flex items-center justify-between gap-3 text-xs">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <GitCommit className="w-4 h-4 text-emerald-400 shrink-0" />
                            <div className="min-w-0">
                              <div className="text-slate-100 font-medium truncate">
                                {c.message}
                              </div>
                              <div className="text-[11px] text-slate-400 font-mono flex items-center gap-2 mt-0.5">
                                <span className="text-blue-400">@{c.author_login}</span>
                                <span>·</span>
                                <span className="bg-slate-700/60 px-1.5 rounded">{c.sha}</span>
                                {c.branch && <span>on {c.branch}</span>}
                              </div>
                            </div>
                          </div>

                          {c.url && (
                            <a
                              href={c.url}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors shrink-0"
                              title="Open commit on GitHub"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      <div className="py-2 text-center text-xs text-slate-400">
                        No direct commits matching issue key <span className="font-mono text-blue-400">[{issueKey}]</span>.
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Include <code className="text-blue-400 font-mono">[{issueKey}]</code> in commit messages or branch names to link them directly.
                        </div>
                      </div>

                      {/* Fallback: Recent repo commits */}
                      {recentCommits.length > 0 && (
                        <div className="pt-2 border-t border-slate-800 space-y-1.5">
                          <div className="text-[11px] font-semibold text-slate-400 flex items-center justify-between">
                            <span>Recent Repository Commits</span>
                            <span className="text-[10px] text-slate-500">Latest in repo</span>
                          </div>
                          {recentCommits.map((c, i) => (
                            <div key={i} className="p-2 bg-slate-800/50 border border-slate-700/40 rounded-lg flex items-center justify-between gap-2 text-xs">
                              <div className="flex items-center gap-2 min-w-0">
                                <GitCommit className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                <div className="min-w-0">
                                  <div className="text-slate-300 truncate text-[11px]">
                                    {c.message}
                                  </div>
                                  <div className="text-[10px] text-slate-500 font-mono flex items-center gap-1.5">
                                    <span>@{c.author_login}</span>
                                    <span>·</span>
                                    <span>{c.sha}</span>
                                  </div>
                                </div>
                              </div>
                              {c.url && (
                                <a
                                  href={c.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-slate-500 hover:text-slate-300 shrink-0"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Attachments & Files Section */}
            <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-3 shadow-2xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <Paperclip className="w-4 h-4 text-blue-600" />
                  <span className="text-xs font-bold text-slate-900 tracking-wide">
                    Attachments & Deliverable Assets ({attachments.length})
                  </span>
                </div>
              </div>

              {/* Add attachment input */}
              <form onSubmit={handleAddAttachment} className="flex gap-2">
                <input
                  type="text"
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  placeholder="e.g. architecture-spec.pdf, test-cases.csv, wireframe.png"
                  className="flex-1 px-3 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  disabled={isAddingAttachment || !newFileName.trim()}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center gap-1 disabled:opacity-50"
                >
                  <Plus className="w-3 h-3" />
                  <span>Attach</span>
                </button>
              </form>

              {/* Attachments List */}
              <div className="space-y-1.5">
                {attachments.length === 0 ? (
                  <div className="text-center py-3 text-xs text-slate-400">
                    No files or documents attached yet.
                  </div>
                ) : (
                  attachments.map((att) => (
                    <div
                      key={att.id}
                      className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-xs hover:bg-slate-100/60 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <File className="w-4 h-4 text-slate-500 shrink-0" />
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 truncate text-xs">{att.file_name}</div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            {att.file_size} · Uploaded by {att.uploaded_by}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => alert(`Simulated download of ${att.file_name}`)}
                          className="text-xs font-semibold text-blue-600 hover:underline"
                        >
                          Download
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteAttachment(att.id)}
                          className="text-slate-400 hover:text-rose-600"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Jira Meta Details (Right 4 cols) */}
          <div className="lg:col-span-4 p-6 bg-slate-50/50 space-y-5">
            {/* Status Workflow */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Workflow Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
                className="w-full px-3 py-2 text-xs font-bold text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 shadow-2xs"
              >
                <option value="To Do">To Do</option>
                <option value="In Progress">In Progress</option>
                <option value="In Review">In Review</option>
                <option value="Done">Done</option>
              </select>
            </div>

            {/* Story Points */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Story Points (Fibonacci)
              </label>
              <div className="flex items-center gap-1.5 flex-wrap">
                {[1, 2, 3, 5, 8, 13, 21].map((pts) => (
                  <button
                    key={pts}
                    type="button"
                    onClick={() => setStoryPoints(pts)}
                    className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${
                      storyPoints === pts
                        ? 'bg-blue-600 text-white shadow-2xs scale-105'
                        : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {pts}
                  </button>
                ))}
              </div>
            </div>

            {/* Sprint */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Sprint Assignment
              </label>
              <select
                value={sprint}
                onChange={(e) => setSprint(e.target.value)}
                className="w-full px-3 py-2 text-xs text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              >
                <option value="Sprint 1 (Active)">Sprint 1 (Active)</option>
                <option value="Sprint 2 (Planning)">Sprint 2 (Planning)</option>
                <option value="Backlog">Backlog</option>
              </select>
            </div>

            {/* Assignee */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Assignee
              </label>
              <div className="flex items-center gap-2">
                {currentAssignee && (
                  <Avatar
                    name={currentAssignee.name}
                    avatarUrl={currentAssignee.avatar_url}
                    size="sm"
                  />
                )}
                <select
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  className="flex-1 px-3 py-2 text-xs text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Unassigned</option>
                  {team.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.role})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Priority */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="w-full px-3 py-2 text-xs font-semibold text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              >
                <option value="High">High Priority</option>
                <option value="Medium">Medium Priority</option>
                <option value="Low">Low Priority</option>
              </select>
            </div>

            {/* Due Date & Hours */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Due Date
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Est. Hours
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={estimatedHours}
                  onChange={(e) => setEstimatedHours(parseFloat(e.target.value) || 0)}
                  className="w-full px-2.5 py-1.5 text-xs text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="pt-4 border-t border-slate-200">
              <button
                type="button"
                onClick={handleDelete}
                className="w-full py-2 px-3 text-xs font-medium text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Issue</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
