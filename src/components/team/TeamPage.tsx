import React, { useState } from 'react';
import {
  Users,
  Plus,
  Mail,
  Folder,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Edit2,
  Trash2,
  ShieldCheck,
  Github,
  AlertCircle
} from 'lucide-react';
import { TeamMember, Project, Task } from '../../types';
import { isTaskOverdue } from '../../utils/contribution';
import { Modal } from '../common/Modal';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { Avatar } from '../common/Avatar';
import { api } from '../../api/client';

interface TeamPageProps {
  team: TeamMember[];
  projects: Project[];
  tasks: Task[];
  onCreateMember: (data: Partial<TeamMember>) => Promise<void>;
  onUpdateMember: (id: string, data: Partial<TeamMember>) => Promise<void>;
  onDeleteMember: (id: string) => Promise<void>;
  onRefreshData?: () => void;
}

export const TeamPage: React.FC<TeamPageProps> = ({
  team,
  projects,
  tasks,
  onCreateMember,
  onUpdateMember,
  onDeleteMember,
  onRefreshData
}) => {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [deletingMember, setDeletingMember] = useState<TeamMember | null>(null);
  const [trackingMember, setTrackingMember] = useState<TeamMember | null>(null);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const handleUpdateTaskStatus = async (taskId: string, newStatus: string) => {
    setUpdatingTaskId(taskId);
    setStatusMessage(null);
    try {
      await api.updateTaskStatus(taskId, newStatus);
      setStatusMessage('Task status updated successfully.');
      onRefreshData?.();
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (err: any) {
      alert(`Failed to update status: ${err.message}`);
    } finally {
      setUpdatingTaskId(null);
    }
  };
  const [blockingError, setBlockingError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('Developer');
  const [githubUsername, setGithubUsername] = useState('');
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);

  const now = new Date();

  const resetForm = () => {
    setName('');
    setEmail('');
    setRole('Senior Backend Engineer');
    setGithubUsername('');
    setSelectedProjectIds([]);
    setFormError(null);
  };

  const handleOpenCreate = () => {
    resetForm();
    setIsCreateOpen(true);
  };

  const handleOpenEdit = (m: TeamMember) => {
    setName(m.name);
    setEmail(m.email);
    setRole(m.role);
    setGithubUsername(m.github_username || '');
    setSelectedProjectIds(m.assigned_project_ids || []);
    setFormError(null);
    setEditingMember(m);
  };

  const handleSaveMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError('Member name is required.');
      return;
    }
    if (!email.trim()) {
      setFormError('Email address is required.');
      return;
    }

    // Check client-side duplicate email
    const duplicate = team.find(
      m => m.email.toLowerCase() === email.trim().toLowerCase() && m.id !== editingMember?.id
    );
    if (duplicate) {
      setFormError(`A team member with email '${email}' already exists.`);
      return;
    }

    setIsSubmitting(true);
    setFormError(null);
    try {
      if (editingMember) {
        await onUpdateMember(editingMember.id, {
          name: name.trim(),
          email: email.trim().toLowerCase(),
          role: role.trim(),
          github_username: githubUsername.trim() || undefined,
          assigned_project_ids: selectedProjectIds
        });
        setEditingMember(null);
      } else {
        await onCreateMember({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          role: role.trim(),
          github_username: githubUsername.trim() || undefined,
          assigned_project_ids: selectedProjectIds
        });
        setIsCreateOpen(false);
      }
      resetForm();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save team member.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAttemptDelete = (m: TeamMember) => {
    // Check if member has active assigned tasks
    const activeTasks = tasks.filter(t => t.assignee_id === m.id && t.status !== 'Done' && (t.status as any) !== 'Completed');
    if (activeTasks.length > 0) {
      setBlockingError(
        `Cannot remove ${m.name}: They are currently assigned to ${activeTasks.length} active deliverable(s). Reassign these tasks or mark them Done before removing the member.`
      );
      return;
    }
    setDeletingMember(m);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingMember) return;
    setIsSubmitting(true);
    try {
      await onDeleteMember(deletingMember.id);
      setDeletingMember(null);
    } catch (err: any) {
      alert(`Error deleting member: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleProjectSelection = (pId: string) => {
    setSelectedProjectIds(prev =>
      prev.includes(pId) ? prev.filter(id => id !== pId) : [...prev, pId]
    );
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Team Roster & Workload Governance
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Maintain team profiles, verify capacity limits, and audit active task assignments.
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenCreate}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-2xs transition-colors self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Add Team Member</span>
        </button>
      </div>

      {/* Blocking Error Alert */}
      {blockingError && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-start justify-between gap-3 shadow-2xs">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-rose-900">Member Removal Prevented</div>
              <div className="mt-0.5 leading-relaxed">{blockingError}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setBlockingError(null)}
            className="text-rose-500 hover:text-rose-800 font-semibold px-2 py-0.5"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Team Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {team.map(m => {
          const mTasks = tasks.filter(t => t.assignee_id === m.id);
          const totalAssigned = mTasks.length;
          const toDo = mTasks.filter(t => t.status === 'To Do' || (t.status as any) === 'Not Started').length;
          const inProgress = mTasks.filter(t => t.status === 'In Progress').length;
          const inReview = mTasks.filter(t => t.status === 'In Review').length;
          const done = mTasks.filter(t => t.status === 'Done' || (t.status as any) === 'Completed').length;
          const progressPct = totalAssigned > 0 ? Math.round((done / totalAssigned) * 100) : 0;
          const pending = toDo + inProgress + inReview;
          const overdue = mTasks.filter(t => isTaskOverdue({ status: t.status, dueDate: t.due_date || '' }, now)).length;

          let workloadStatus: 'Low' | 'Balanced' | 'High' | 'Overloaded' = 'Balanced';
          if (pending === 0) workloadStatus = 'Low';
          else if (pending <= 3) workloadStatus = 'Balanced';
          else if (pending <= 6) workloadStatus = 'High';
          else workloadStatus = 'Overloaded';

          return (
            <div
              key={m.id}
              className="bg-white rounded-xl border border-slate-200 hover:border-slate-300 p-5 shadow-2xs flex flex-col justify-between transition-all"
            >
              <div>
                {/* Header: Avatar, Name, Role, Actions */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={m.name} avatarUrl={m.avatar_url} size="lg" />
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 leading-snug">{m.name}</h3>
                      <p className="text-xs text-slate-500">{m.role}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(m)}
                      aria-label={`Edit ${m.name}`}
                      className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAttemptDelete(m)}
                      aria-label={`Delete ${m.name}`}
                      className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Email & GitHub identity */}
                <div className="space-y-1 text-xs text-slate-600 mb-4">
                  <div className="flex items-center gap-2 text-slate-500">
                    <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{m.email}</span>
                  </div>
                  {m.github_username && (
                    <div className="flex items-center gap-2 text-slate-500">
                      <Github className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="font-mono text-[11px]">@{m.github_username}</span>
                    </div>
                  )}
                </div>

                {/* Deliverables Work Status Grid */}
                <div className="grid grid-cols-4 gap-1.5 bg-slate-50 p-2.5 rounded-lg border border-slate-100 text-center">
                  <div>
                    <div className="text-[10px] text-slate-500 font-semibold uppercase">To Do</div>
                    <div className="text-sm font-bold text-slate-700 tabular-nums">{toDo}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-blue-600 font-semibold uppercase">In Progress</div>
                    <div className="text-sm font-bold text-blue-700 tabular-nums">{inProgress}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-amber-600 font-semibold uppercase">In Review</div>
                    <div className="text-sm font-bold text-amber-700 tabular-nums">{inReview}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-emerald-600 font-semibold uppercase">Done</div>
                    <div className="text-sm font-bold text-emerald-700 tabular-nums">{done}</div>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mt-2.5">
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="text-slate-500 font-medium">Work Completion</span>
                    <span className="font-bold text-slate-800 font-mono">{progressPct}%</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden flex">
                    <div style={{ width: `${totalAssigned > 0 ? (done / totalAssigned) * 100 : 0}%` }} className="bg-emerald-500 h-full" />
                    <div style={{ width: `${totalAssigned > 0 ? (inReview / totalAssigned) * 100 : 0}%` }} className="bg-amber-500 h-full" />
                    <div style={{ width: `${totalAssigned > 0 ? (inProgress / totalAssigned) * 100 : 0}%` }} className="bg-blue-500 h-full" />
                    <div style={{ width: `${totalAssigned > 0 ? (toDo / totalAssigned) * 100 : 0}%` }} className="bg-slate-300 h-full" />
                  </div>
                </div>
              </div>

              {/* Workload Indicator Badge & Tracking Button */}
              <div className="mt-4 pt-3 border-t border-slate-100 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Workload Capacity:</span>
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded font-mono ${
                      workloadStatus === 'Overloaded'
                        ? 'bg-rose-100 text-rose-800'
                        : workloadStatus === 'High'
                        ? 'bg-amber-100 text-amber-800'
                        : workloadStatus === 'Balanced'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {workloadStatus}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setTrackingMember(m)}
                  className="w-full py-1.5 px-3 text-xs font-semibold text-blue-700 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-100 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>Track & Update Work Status ({totalAssigned})</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add / Edit Member Modal */}
      <Modal
        isOpen={isCreateOpen || editingMember !== null}
        onClose={() => {
          setIsCreateOpen(false);
          setEditingMember(null);
          resetForm();
        }}
        title={editingMember ? 'Edit Team Member' : 'Add Team Member'}
        subtitle="Manage member identities, project assignments, and system credentials."
      >
        <form onSubmit={handleSaveMember} className="space-y-4">
          {formError && (
            <div className="p-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Full Name *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Elena Rostova"
              className="w-full px-3 py-2 text-xs text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Work Email Address * (Unique)
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="e.g. elena.rostova@enterprise.internal"
              className="w-full px-3 py-2 text-xs text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Role / Title
              </label>
              <input
                type="text"
                value={role}
                onChange={e => setRole(e.target.value)}
                placeholder="e.g. Lead System Architect"
                className="w-full px-3 py-1.5 text-xs text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                GitHub Username (Optional)
              </label>
              <input
                type="text"
                value={githubUsername}
                onChange={e => setGithubUsername(e.target.value)}
                placeholder="e.g. erostova"
                className="w-full px-3 py-1.5 text-xs text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 font-mono"
              />
            </div>
          </div>

          {/* Project Assignments */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Assigned Projects ({selectedProjectIds.length} selected)
            </label>
            <div className="max-h-36 overflow-y-auto border border-slate-200 rounded-lg p-2 divide-y divide-slate-100 bg-slate-50/50">
              {projects.length === 0 ? (
                <div className="text-xs text-slate-400 p-2 text-center">
                  No projects available. Create a project first.
                </div>
              ) : (
                projects.map(p => {
                  const isChecked = selectedProjectIds.includes(p.id);
                  return (
                    <label
                      key={p.id}
                      className="flex items-center justify-between py-1.5 px-2 hover:bg-slate-100 rounded cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleProjectSelection(p.id)}
                          className="rounded text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-xs font-medium text-slate-800">{p.name}</span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400">{p.status}</span>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => {
                setIsCreateOpen(false);
                setEditingMember(null);
                resetForm();
              }}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Saving...' : editingMember ? 'Update Member' : 'Add Member'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={deletingMember !== null}
        onClose={() => setDeletingMember(null)}
        onConfirm={handleDeleteConfirm}
        title="Remove Team Member"
        message={`Are you sure you want to remove ${deletingMember?.name}? They currently have no active pending tasks, but removing them will unbind historical records.`}
        confirmLabel="Remove Member"
        isDestructive={true}
        isLoading={isSubmitting}
      />

      {/* Team Member Work Status Tracking Modal */}
      {trackingMember && (
        <Modal
          isOpen={trackingMember !== null}
          onClose={() => setTrackingMember(null)}
          title={`Work Status Tracking: ${trackingMember.name}`}
          subtitle={`Monitor assigned deliverables, progress velocity, and update workflow status for ${trackingMember.role}.`}
        >
          <div className="space-y-4">
            {statusMessage && (
              <div className="p-3 text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{statusMessage}</span>
              </div>
            )}

            {/* Member Progress Summary */}
            {(() => {
              const mTasks = tasks.filter(t => t.assignee_id === trackingMember.id);
              const toDo = mTasks.filter(t => t.status === 'To Do' || (t.status as any) === 'Not Started').length;
              const inProgress = mTasks.filter(t => t.status === 'In Progress').length;
              const inReview = mTasks.filter(t => t.status === 'In Review').length;
              const done = mTasks.filter(t => t.status === 'Done' || (t.status as any) === 'Completed').length;
              const total = mTasks.length;
              const pct = total > 0 ? Math.round((done / total) * 100) : 0;

              return (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700">Overall Completion: {pct}%</span>
                    <span className="text-slate-500">{done} of {total} deliverables completed</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden flex">
                    <div style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }} className="bg-emerald-500 h-full" />
                    <div style={{ width: `${total > 0 ? (inReview / total) * 100 : 0}%` }} className="bg-amber-500 h-full" />
                    <div style={{ width: `${total > 0 ? (inProgress / total) * 100 : 0}%` }} className="bg-blue-500 h-full" />
                    <div style={{ width: `${total > 0 ? (toDo / total) * 100 : 0}%` }} className="bg-slate-400 h-full" />
                  </div>
                  <div className="flex items-center gap-3 text-[11px] pt-1 flex-wrap">
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-slate-400 inline-block"></span> To Do ({toDo})</span>
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block"></span> In Progress ({inProgress})</span>
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block"></span> In Review ({inReview})</span>
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></span> Done ({done})</span>
                  </div>
                </div>
              );
            })()}

            {/* Tasks List */}
            <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
              {tasks.filter(t => t.assignee_id === trackingMember.id).length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400">
                  No deliverables currently assigned to this team member.
                </div>
              ) : (
                tasks.filter(t => t.assignee_id === trackingMember.id).map(t => {
                  const normalizedStatus = t.status;
                  return (
                    <div key={t.id} className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-3 shadow-2xs hover:border-slate-300 transition-colors">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                            {t.issue_key || 'TASK'}
                          </span>
                          <span className="text-xs font-semibold text-slate-900 truncate">{t.title}</span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-1">
                          <span>Priority: <span className="font-medium text-slate-600">{t.priority}</span></span>
                          {t.due_date && <span>Due: <span className="font-medium text-slate-600">{t.due_date}</span></span>}
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center gap-2">
                        <select
                          value={normalizedStatus}
                          disabled={updatingTaskId === t.id}
                          onChange={(e) => handleUpdateTaskStatus(t.id, e.target.value)}
                          className={`px-2.5 py-1 text-xs font-semibold rounded-lg border focus:outline-hidden focus:ring-1 focus:ring-blue-500 transition-colors ${
                            normalizedStatus === 'Done'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                              : normalizedStatus === 'In Review'
                              ? 'bg-amber-50 text-amber-800 border-amber-300'
                              : normalizedStatus === 'In Progress'
                              ? 'bg-blue-50 text-blue-800 border-blue-300'
                              : 'bg-slate-50 text-slate-700 border-slate-300'
                          }`}
                        >
                          <option value="To Do">To Do</option>
                          <option value="In Progress">In Progress</option>
                          <option value="In Review">In Review</option>
                          <option value="Done">Done</option>
                        </select>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setTrackingMember(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Close Tracking
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
