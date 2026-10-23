import React, { useState } from 'react';
import {
  FolderKanban,
  Plus,
  Search,
  Filter,
  Calendar,
  Users,
  Edit2,
  Trash2,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Archive,
  History,
  Sparkles,
  Layers,
  Target,
  RotateCcw,
  Clock,
  Github,
  MessageSquare,
  GitBranch,
  RefreshCw,
  Settings
} from 'lucide-react';
import { Project, ProjectStatus, TeamMember, Task } from '../../types';
import { Modal } from '../common/Modal';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { GitHubProjectImportModal } from './GitHubProjectImportModal';
import { api } from '../../api/client';

interface ProjectsPageProps {
  projects: Project[];
  tasks: Task[];
  team: TeamMember[];
  onSelectProject: (id: string) => void;
  onCreateProject: (data: Partial<Project>) => Promise<void>;
  onUpdateProject: (id: string, data: Partial<Project>) => Promise<void>;
  onDeleteProject: (id: string) => Promise<void>;
  onNavigateToTasks: (projectId: string) => void;
  onNavigateToMessages?: (projectId: string) => void;
  onRefreshData?: () => void;
}

export const ProjectsPage: React.FC<ProjectsPageProps> = ({
  projects,
  tasks,
  team,
  onSelectProject,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
  onNavigateToTasks,
  onNavigateToMessages,
  onRefreshData
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [archiveFilter, setArchiveFilter] = useState<'active' | 'archived' | 'all'>('active');

  // Modal states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isImportGitHubOpen, setIsImportGitHubOpen] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('tmpl-scrum');
  const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);
  const [syncingProjectId, setSyncingProjectId] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  // Audit Logs modal
  const [auditLogProject, setAuditLogProject] = useState<Project | null>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);

  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [objectives, setObjectives] = useState('');
  const [startDate, setStartDate] = useState('');
  const [deadline, setDeadline] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('Planning');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);

  const defaultTemplates = [
    {
      id: 'tmpl-scrum',
      name: 'Agile Scrum & Two-Week Sprints',
      description: 'Standard product sprint cadence with backlog grooming, sprint board, user stories, and acceptance criteria.',
      tag: 'Agile'
    },
    {
      id: 'tmpl-api',
      name: 'Microservice API & Cloud Infrastructure',
      description: 'Distributed architecture development with high-concurrency database schemas, rate limiting, and CI/CD validation.',
      tag: 'Backend'
    },
    {
      id: 'tmpl-security',
      name: 'Zero-Trust IAM & Security Compliance',
      description: 'Identity federation, token rotation, audit trails, and role-based permissions matrix hardening.',
      tag: 'Security'
    },
    {
      id: 'tmpl-mobile',
      name: 'Cross-Platform Mobile App Launch',
      description: 'Frontend client UI, offline caching, push notifications, and release telemetry.',
      tag: 'Mobile'
    }
  ];

  const resetForm = () => {
    setName('');
    setDescription('');
    setObjectives('');
    setStartDate('');
    setDeadline('');
    setStatus('Planning');
    setSelectedMemberIds([]);
    setFormError(null);
  };

  const handleOpenCreate = () => {
    resetForm();
    setIsCreateOpen(true);
  };

  const handleOpenEdit = (p: Project) => {
    setName(p.name);
    setDescription(p.description || '');
    setObjectives(p.objectives || '');
    setStartDate(p.start_date || '');
    setDeadline(p.deadline || '');
    setStatus(p.status);
    setSelectedMemberIds(p.member_ids || []);
    setFormError(null);
    setEditingProject(p);
  };

  const handleSaveProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError('Project title is required.');
      return;
    }

    setIsSubmitting(true);
    setFormError(null);
    try {
      if (editingProject) {
        await onUpdateProject(editingProject.id, {
          name: name.trim(),
          description: description.trim() || undefined,
          objectives: objectives.trim() || undefined,
          start_date: startDate || undefined,
          deadline: deadline || undefined,
          status,
          member_ids: selectedMemberIds
        });
        setEditingProject(null);
      } else {
        await onCreateProject({
          name: name.trim(),
          description: description.trim() || undefined,
          objectives: objectives.trim() || undefined,
          start_date: startDate || undefined,
          deadline: deadline || undefined,
          status,
          member_ids: selectedMemberIds
        });
        setIsCreateOpen(false);
      }
      resetForm();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save project.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleArchiveToggle = async (p: Project) => {
    const nextVal = !Boolean(p.is_archived);
    try {
      await api.archiveProject(p.id, nextVal);
      onRefreshData?.();
    } catch (err: any) {
      alert(`Failed to update archive status: ${err.message}`);
    }
  };

  const handleCreateFromTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateName.trim()) return;
    setIsCreatingTemplate(true);
    try {
      await api.createProjectFromTemplate({
        template_id: selectedTemplateId,
        name: templateName.trim()
      });
      setIsTemplateModalOpen(false);
      setTemplateName('');
      onRefreshData?.();
    } catch (err: any) {
      alert(`Error creating from template: ${err.message}`);
    } finally {
      setIsCreatingTemplate(false);
    }
  };

  const handleOpenAuditHistory = async (p: Project) => {
    setAuditLogProject(p);
    setIsLoadingAudit(true);
    try {
      const res = await api.getAuditLogs(p.id);
      setAuditLogs(res);
    } catch {
      setAuditLogs([]);
    } finally {
      setIsLoadingAudit(false);
    }
  };

  const handleSyncProject = async (p: Project) => {
    setSyncingProjectId(p.id);
    setActionFeedback(null);
    try {
      const res = await api.syncGitHub(p.id);
      setActionFeedback(res.message || 'Repository activity successfully synchronized.');
      onRefreshData?.();
    } catch (err: any) {
      setActionFeedback(`Sync error: ${err.message}`);
    } finally {
      setSyncingProjectId(null);
      setTimeout(() => setActionFeedback(null), 5000);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingProjectId) return;
    setIsSubmitting(true);
    try {
      await onDeleteProject(deletingProjectId);
      setDeletingProjectId(null);
    } catch (err: any) {
      alert(`Error deleting project: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleMemberSelection = (memberId: string) => {
    setSelectedMemberIds(prev =>
      prev.includes(memberId) ? prev.filter(id => id !== memberId) : [...prev, memberId]
    );
  };

  // Filtered projects
  const filteredProjects = projects.filter(p => {
    const isArchived = Boolean(p.is_archived);
    if (archiveFilter === 'active' && isArchived) return false;
    if (archiveFilter === 'archived' && !isArchived) return false;

    const matchesSearch =
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.description && p.description.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Projects Portfolio & Initiatives
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Configure strategic objectives, start/end dates, templates, team leaders, and audit history.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          <button
            type="button"
            onClick={() => setIsImportGitHubOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg shadow-2xs transition-colors cursor-pointer"
            title="Import an existing GitHub repository into PULSE"
          >
            <Github className="w-3.5 h-3.5 text-slate-900" />
            <span>Import from GitHub</span>
          </button>

          <button
            type="button"
            onClick={() => setIsTemplateModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg shadow-2xs transition-colors cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-600" />
            <span>New From Template</span>
          </button>

          <button
            type="button"
            onClick={handleOpenCreate}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-2xs transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Custom Project</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search projects by name, description, or objectives..."
            className="w-full pl-9 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Archive Filter Toggle */}
        <div className="flex items-center p-0.5 bg-slate-100 rounded-lg border border-slate-200 shrink-0">
          <button
            type="button"
            onClick={() => setArchiveFilter('active')}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
              archiveFilter === 'active' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Active
          </button>
          <button
            type="button"
            onClick={() => setArchiveFilter('archived')}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
              archiveFilter === 'archived' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Archived
          </button>
          <button
            type="button"
            onClick={() => setArchiveFilter('all')}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
              archiveFilter === 'all' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All
          </button>
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-2 shrink-0">
          <Filter className="w-4 h-4 text-slate-400 shrink-0" />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Statuses</option>
            <option value="Planning">Planning</option>
            <option value="Active">Active</option>
            <option value="In Review">In Review</option>
            <option value="Completed">Completed</option>
            <option value="On Hold">On Hold</option>
          </select>
        </div>
      </div>

      {/* Projects Grid */}
      {filteredProjects.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-2xs">
          <FolderKanban className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-slate-900">No projects found</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            {searchTerm || statusFilter !== 'all' || archiveFilter !== 'active'
              ? 'Try adjusting your search filters or status selection.'
              : 'Create a new project or select from pre-packaged templates to begin.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredProjects.map(p => {
            const pTasks = tasks.filter(t => t.project_id === p.id);
            const totalTasks = pTasks.length;
            const completedTasks = pTasks.filter(t => t.status === 'Done').length;
            const progressPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
            const memberCount = (p.member_ids || []).length;
            const isArchived = Boolean(p.is_archived);

            return (
              <div
                key={p.id}
                className={`bg-white rounded-xl border p-5 shadow-2xs flex flex-col justify-between transition-all ${
                  isArchived ? 'border-dashed border-slate-300 opacity-75' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div>
                  {/* Top line: status badge, archived tag, and actions */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded font-mono ${
                          p.status === 'Active'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : p.status === 'Completed'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : p.status === 'In Review'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-slate-100 text-slate-600 border border-slate-200'
                        }`}
                      >
                        {p.status}
                      </span>
                      {isArchived && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">
                          Archived
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleOpenAuditHistory(p)}
                        title="View Project Activity History & Audit Trail"
                        className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors"
                      >
                        <History className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleArchiveToggle(p)}
                        title={isArchived ? 'Restore / Unarchive Project' : 'Archive Project'}
                        className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors"
                      >
                        {isArchived ? <RotateCcw className="w-3.5 h-3.5 text-blue-600" /> : <Archive className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(p)}
                        className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingProjectId(p.id)}
                        className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Title & Description */}
                  <h3 className="text-sm font-bold text-slate-900 line-clamp-1">{p.name}</h3>
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2 min-h-[32px]">
                    {p.description || 'No description provided.'}
                  </p>

                  {/* GitHub Repository Badge if imported */}
                  {p.github_repo_owner && p.github_repo_name && (
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono bg-slate-100 text-slate-800 px-2 py-0.5 rounded border border-slate-200">
                        <Github className="w-3 h-3 text-slate-800" />
                        <span className="font-semibold">{p.github_repo_owner}/{p.github_repo_name}</span>
                        <span className="text-slate-400">({p.github_repo_visibility || 'Public'})</span>
                      </span>
                      {p.github_default_branch && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-mono text-slate-500">
                          <GitBranch className="w-2.5 h-2.5" />
                          <span>{p.github_default_branch}</span>
                        </span>
                      )}
                    </div>
                  )}

                  {/* Strategic Objective Quote if present */}
                  {p.objectives && (
                    <div className="mt-2.5 p-2 bg-slate-50 border border-slate-200/80 rounded-lg text-[11px] text-slate-700 flex items-start gap-1.5">
                      <Target className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
                      <span className="line-clamp-2 italic">{p.objectives}</span>
                    </div>
                  )}

                  {/* Progress bar */}
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-slate-500">Deliverables</span>
                      <span className="font-semibold text-slate-800 font-mono">
                        {completedTasks}/{totalTasks} ({progressPct}%)
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>

                  {/* Metadata */}
                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                    <div className="flex items-center gap-1.5 font-mono">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      <span>{p.deadline ? `Due ${p.deadline}` : 'No deadline'}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-slate-400" />
                      <span>{memberCount} member{memberCount !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                </div>

                {/* Card Actions: Sprint Board, Manage, Messages, Sync */}
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onSelectProject(p.id);
                      onNavigateToTasks(p.id);
                    }}
                    className="flex-1 py-1.5 px-3 text-xs font-semibold text-blue-700 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span>Sprint Board</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleOpenEdit(p)}
                    title="Manage Project, Members & Scope"
                    className="py-1.5 px-2.5 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg transition-colors flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Settings className="w-3.5 h-3.5 text-slate-600" />
                    <span className="hidden sm:inline">Manage</span>
                  </button>

                  {onNavigateToMessages && (
                    <button
                      type="button"
                      onClick={() => {
                        onSelectProject(p.id);
                        onNavigateToMessages(p.id);
                      }}
                      title="Project Messaging & Discussions"
                      className="py-1.5 px-2.5 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg transition-colors flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-slate-600" />
                      <span className="hidden sm:inline">Messages</span>
                    </button>
                  )}

                  {p.github_repo_owner && p.github_repo_name && (
                    <button
                      type="button"
                      onClick={() => handleSyncProject(p)}
                      disabled={syncingProjectId === p.id}
                      title="Sync GitHub commits & PRs"
                      className="p-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${syncingProjectId === p.id ? 'animate-spin text-blue-600' : ''}`} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Project Templates Modal */}
      <Modal
        isOpen={isTemplateModalOpen}
        onClose={() => setIsTemplateModalOpen(false)}
        title="Instantiate Project From Template"
        subtitle="Select an agile pattern pre-configured with sprint boards, deliverable stories, and acceptance criteria."
      >
        <form onSubmit={handleCreateFromTemplate} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              New Project Title *
            </label>
            <input
              type="text"
              required
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="e.g. NextGen Payment Gateway MVP"
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-700">
              Select Architecture Pattern:
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {defaultTemplates.map((t) => (
                <div
                  key={t.id}
                  onClick={() => setSelectedTemplateId(t.id)}
                  className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                    selectedTemplateId === t.id
                      ? 'border-blue-600 bg-blue-50/60 shadow-xs'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-slate-900">{t.name}</span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-slate-200 text-slate-700">
                      {t.tag}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 line-clamp-2">{t.description}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsTemplateModalOpen(false)}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isCreatingTemplate || !templateName.trim()}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-2xs transition-colors disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{isCreatingTemplate ? 'Instantiating...' : 'Create From Template'}</span>
            </button>
          </div>
        </form>
      </Modal>

      {/* Activity History & Audit Logs Modal */}
      <Modal
        isOpen={Boolean(auditLogProject)}
        onClose={() => setAuditLogProject(null)}
        title={`Audit History · ${auditLogProject?.name || 'Project'}`}
        subtitle="Chronological audit trail of all project modifications, status changes, and task activities."
      >
        <div className="space-y-3">
          {isLoadingAudit ? (
            <div className="text-center py-8 text-xs text-slate-400">Loading audit history...</div>
          ) : auditLogs.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-400 bg-slate-50 rounded-xl border border-slate-200">
              No historical changes logged yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden max-h-72 overflow-y-auto bg-white">
              {auditLogs.map((log) => (
                <div key={log.id} className="p-3 text-xs space-y-1 hover:bg-slate-50">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">{log.action}</span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {new Date(log.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-slate-600 text-[11px]">{log.details}</div>
                  <div className="text-[10px] text-blue-600 font-semibold">Actor: {log.actor_name}</div>
                </div>
              ))}
            </div>
          )}

          <div className="pt-2 border-t border-slate-100 flex justify-end">
            <button
              type="button"
              onClick={() => setAuditLogProject(null)}
              className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Close History
            </button>
          </div>
        </div>
      </Modal>

      {/* Create / Edit Project Modal */}
      <Modal
        isOpen={isCreateOpen || editingProject !== null}
        onClose={() => {
          setIsCreateOpen(false);
          setEditingProject(null);
          resetForm();
        }}
        title={editingProject ? 'Manage Project & Team Members' : 'Create New Project'}
        subtitle={editingProject ? 'Configure strategic objectives, project scope, timelines, and manage assigned team members.' : 'Specify project scope, milestone timelines, strategic objectives, and assign team resources.'}
      >
        <form onSubmit={handleSaveProject} className="space-y-4">
          {formError && (
            <div className="p-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Project Name *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Core Financial Ledger Modernization"
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Description
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Summary of initiative scope and key deliverables..."
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Strategic Objectives (KPI Goals)
            </label>
            <input
              type="text"
              value={objectives}
              onChange={e => setObjectives(e.target.value)}
              placeholder="e.g. Sub-millisecond transaction reconciliation under 5,000 TPS"
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Target Deadline
              </label>
              <input
                type="date"
                value={deadline}
                onChange={e => setDeadline(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Lifecycle Status
            </label>
            <select
              value={status}
              onChange={e => setStatus(e.target.value as ProjectStatus)}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            >
              <option value="Planning">Planning</option>
              <option value="Active">Active</option>
              <option value="In Review">In Review</option>
              <option value="Completed">Completed</option>
              <option value="On Hold">On Hold</option>
            </select>
          </div>

          {/* Member assignment */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Assign Team Resources
            </label>
            <div className="max-h-36 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1.5 bg-slate-50">
              {team.length === 0 ? (
                <div className="text-xs text-slate-400 p-2">No team members available.</div>
              ) : (
                team.map(m => {
                  const isChecked = selectedMemberIds.includes(m.id);
                  return (
                    <label
                      key={m.id}
                      className="flex items-center gap-2 text-xs text-slate-700 hover:bg-slate-100 p-1.5 rounded cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleMemberSelection(m.id)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="font-medium text-slate-900">{m.name}</span>
                      <span className="text-slate-500">({m.role})</span>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => {
                setIsCreateOpen(false);
                setEditingProject(null);
                resetForm();
              }}
              className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-2xs transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Saving...' : editingProject ? 'Save Changes' : 'Create Project'}
            </button>
          </div>
        </form>
      </Modal>

      {/* GitHub Project Import Modal */}
      <GitHubProjectImportModal
        isOpen={isImportGitHubOpen}
        onClose={() => setIsImportGitHubOpen(false)}
        onProjectImported={(importedProject) => {
          onSelectProject(importedProject.id);
          onRefreshData?.();
        }}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={deletingProjectId !== null}
        onClose={() => setDeletingProjectId(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete Project Milestone"
        message="Are you sure you want to delete this project? All associated tasks, milestones, and audit history will be permanently removed from SQLite."
        confirmText="Delete Project"
        isDestructive
        isLoading={isSubmitting}
      />
    </div>
  );
};
