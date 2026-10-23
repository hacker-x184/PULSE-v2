import React, { useState } from 'react';
import {
  Users,
  UserPlus,
  Crown,
  Shield,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Mail,
  User as UserIcon,
  Github,
  ChevronDown
} from 'lucide-react';
import { Project, TeamMember, ProjectRole } from '../../types';
import { api } from '../../api/client';
import { Avatar } from '../common/Avatar';

interface ProjectLeaderModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project | null;
  team: TeamMember[];
  currentUserId?: string;
  onProjectUpdated: () => Promise<void>;
}

const AVAILABLE_ROLES: ProjectRole[] = [
  'Team Leader',
  'Tech Lead',
  'Senior Developer',
  'QA Engineer',
  'Product Designer'
];

export const ProjectLeaderModal: React.FC<ProjectLeaderModalProps> = ({
  isOpen,
  onClose,
  project,
  team,
  currentUserId,
  onProjectUpdated
}) => {
  const [selectedExistingMemberId, setSelectedExistingMemberId] = useState('');
  const [selectedRole, setSelectedRole] = useState<ProjectRole>('Senior Developer');
  
  // Invite new teammate state
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteGithub, setInviteGithub] = useState('');
  const [activeMode, setActiveMode] = useState<'existing' | 'new'>('existing');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen || !project) return null;

  const currentMembers = project.members || [];
  const currentMemberIds = currentMembers.map(m => m.member_id);
  const availableTeamMembers = team.filter(tm => !currentMemberIds.includes(tm.id));

  const handleAddExisting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedExistingMemberId) {
      setErrorMessage('Please select a team member.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      await api.addProjectMember(project.id, {
        member_id: selectedExistingMemberId,
        role: selectedRole
      });
      setStatusMessage('Teammate added successfully.');
      setSelectedExistingMemberId('');
      await onProjectUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to add teammate to project.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInviteNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteName.trim() || !inviteEmail.trim()) {
      setErrorMessage('Both name and email are required to invite a teammate.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      await api.addProjectMember(project.id, {
        name: inviteName.trim(),
        email: inviteEmail.trim(),
        role: selectedRole,
        github_username: inviteGithub.trim() || undefined
      });
      setStatusMessage(`Teammate ${inviteName.trim()} invited and added to project.`);
      setInviteName('');
      setInviteEmail('');
      setInviteGithub('');
      await onProjectUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to invite teammate.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTransferLeadership = async (memberId: string, memberName: string) => {
    if (!confirm(`Are you sure you want to transfer project leadership to ${memberName}? They will become the Team Leader for "${project.name}" and receive all associated leadership permissions.`)) {
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await api.transferProjectLeadership(project.id, memberId);
      setStatusMessage(`Project leadership successfully transferred to ${memberName}.`);
      await onProjectUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to transfer project leadership.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRoleChange = async (memberId: string, newRole: string, memberName?: string) => {
    if (newRole === 'Team Leader' || newRole === 'Project Leader') {
      await handleTransferLeadership(memberId, memberName || 'this member');
      return;
    }
    try {
      await api.updateProjectMember(project.id, memberId, newRole);
      setStatusMessage('Member role updated.');
      await onProjectUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to update member role.');
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!confirm('Are you sure you want to remove this teammate from the project? Active tasks assigned to them will be unassigned.')) {
      return;
    }

    try {
      await api.removeProjectMember(project.id, memberId);
      setStatusMessage('Member removed from project.');
      await onProjectUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to remove member.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center ring-1 ring-amber-500/30">
              <Crown className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold tracking-tight">Project Team & Leader Controls</h2>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-blue-400 border border-slate-700">
                  {project.key_prefix || 'EQX'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {project.name} · Leader: <span className="text-white font-medium">{project.leader_name || 'Project Leader'}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {statusMessage && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2 text-xs text-emerald-800">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{statusMessage}</span>
            </div>
          )}

          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-xs text-rose-800">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Current Teammates List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                <Users className="w-4 h-4 text-blue-600" />
                <span>Active Project Teammates ({currentMembers.length})</span>
              </h3>
              <span className="text-[11px] text-slate-500">
                Managed by Project Leader
              </span>
            </div>

            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
              {currentMembers.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  No teammates currently assigned to this project.
                </div>
              ) : (
                currentMembers.map((m) => {
                  const isLeader = m.role === 'Project Leader' || m.member_id === project.leader_id;
                  return (
                    <div key={m.member_id} className="p-3.5 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar
                          name={m.name || 'Team Member'}
                          avatarUrl={m.avatar_url}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-slate-900 truncate">{m.name || 'Team Member'}</span>
                            {isLeader && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200">
                                <Crown className="w-2.5 h-2.5 text-amber-600" />
                                Leader
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono truncate">
                            {m.email} {m.github_username ? `· @${m.github_username}` : ''}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {/* Transfer Leadership Button */}
                        {!isLeader && (
                          <button
                            type="button"
                            disabled={isSubmitting}
                            onClick={() => handleTransferLeadership(m.member_id, m.name || 'this member')}
                            className="px-2 py-1 text-[11px] font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors flex items-center gap-1 shadow-2xs"
                            title="Transfer project leadership to this member"
                          >
                            <Crown className="w-3 h-3 text-amber-600" />
                            <span>Make Team Leader</span>
                          </button>
                        )}

                        {/* Role selector */}
                        <select
                          value={isLeader ? 'Team Leader' : m.role}
                          onChange={(e) => handleRoleChange(m.member_id, e.target.value, m.name)}
                          className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg hover:bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                        >
                          {AVAILABLE_ROLES.map(r => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>

                        {/* Remove button */}
                        {!isLeader && (
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(m.member_id)}
                            title="Remove teammate from project"
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Add / Invite Teammate Section */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <UserPlus className="w-4 h-4 text-blue-600" />
                <span>Add Teammates to Project</span>
              </h3>

              <div className="flex gap-1 text-[11px] font-medium p-0.5 bg-slate-200/60 rounded-lg">
                <button
                  type="button"
                  onClick={() => setActiveMode('existing')}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    activeMode === 'existing'
                      ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Existing Member
                </button>
                <button
                  type="button"
                  onClick={() => setActiveMode('new')}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    activeMode === 'new'
                      ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Invite New
                </button>
              </div>
            </div>

            {activeMode === 'existing' ? (
              <form onSubmit={handleAddExisting} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Select Team Member
                    </label>
                    <select
                      value={selectedExistingMemberId}
                      onChange={(e) => setSelectedExistingMemberId(e.target.value)}
                      className="w-full px-3 py-2 text-xs text-slate-900 border border-slate-200 rounded-lg bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Choose a member...</option>
                      {availableTeamMembers.map((tm) => (
                        <option key={tm.id} value={tm.id}>
                          {tm.name} ({tm.email})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Project Role
                    </label>
                    <select
                      value={selectedRole}
                      onChange={(e) => setSelectedRole(e.target.value as ProjectRole)}
                      className="w-full px-3 py-2 text-xs text-slate-900 border border-slate-200 rounded-lg bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                    >
                      {AVAILABLE_ROLES.map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={isSubmitting || !selectedExistingMemberId}
                    className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-2xs transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>{isSubmitting ? 'Adding...' : 'Add to Project'}</span>
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleInviteNew} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Full Name
                    </label>
                    <input
                      type="text"
                      value={inviteName}
                      onChange={(e) => setInviteName(e.target.value)}
                      placeholder="e.g. Alex Morgan"
                      className="w-full px-3 py-2 text-xs text-slate-900 border border-slate-200 rounded-lg bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Email Address
                    </label>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="alex.morgan@enterprise.internal"
                      className="w-full px-3 py-2 text-xs text-slate-900 border border-slate-200 rounded-lg bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Project Role
                    </label>
                    <select
                      value={selectedRole}
                      onChange={(e) => setSelectedRole(e.target.value as ProjectRole)}
                      className="w-full px-3 py-2 text-xs text-slate-900 border border-slate-200 rounded-lg bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                    >
                      {AVAILABLE_ROLES.map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      GitHub Username (Optional)
                    </label>
                    <input
                      type="text"
                      value={inviteGithub}
                      onChange={(e) => setInviteGithub(e.target.value)}
                      placeholder="e.g. alexmorgan-dev"
                      className="w-full px-3 py-2 text-xs text-slate-900 border border-slate-200 rounded-lg bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={isSubmitting || !inviteName.trim() || !inviteEmail.trim()}
                    className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-2xs transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>{isSubmitting ? 'Inviting...' : 'Invite & Add Teammate'}</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-blue-600" />
            <span>Project Leader Authority Enforced</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
