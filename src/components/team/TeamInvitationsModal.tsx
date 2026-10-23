import React, { useState, useEffect } from 'react';
import { Mail, Plus, Copy, Check, Clock, ShieldCheck, AlertCircle, CheckCircle2, Trash2 } from 'lucide-react';
import { Modal } from '../common/Modal';
import { api } from '../../api/client';
import { Project, ProjectInvitation } from '../../types';

interface TeamInvitationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: Project[];
  selectedProjectId?: string;
}

export const TeamInvitationsModal: React.FC<TeamInvitationsModalProps> = ({
  isOpen,
  onClose,
  projects,
  selectedProjectId
}) => {
  const [invitations, setInvitations] = useState<ProjectInvitation[]>([]);
  const [projectId, setProjectId] = useState(selectedProjectId || (projects[0]?.id || ''));
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('Senior Developer');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadInvitations();
    }
  }, [isOpen, projectId]);

  const loadInvitations = async () => {
    setIsLoading(true);
    try {
      const res = await api.getInvitations(projectId || undefined);
      setInvitations(res);
    } catch {
      // Ignored
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await api.createInvitation({
        project_id: projectId || projects[0]?.id || 'p-ledger',
        email: email.trim(),
        role
      });
      setSuccessMsg(`Invitation dispatched to ${email}!`);
      setEmail('');
      loadInvitations();
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to dispatch invitation');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyInviteLink = (inv: ProjectInvitation) => {
    const inviteLink = `${window.location.origin}?invite_token=${inv.token}&email=${encodeURIComponent(inv.email)}`;
    navigator.clipboard.writeText(inviteLink);
    setCopiedToken(inv.token);
    setTimeout(() => setCopiedToken(null), 3000);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Team Invitations & Access Control"
      subtitle="Invite developers, architects, or managers to collaborate on workspace projects."
    >
      <div className="space-y-5">
        {/* Send Invitation Form */}
        <form onSubmit={handleCreateInvite} className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
          <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
            <Mail className="w-3.5 h-3.5 text-blue-600" />
            <span>Dispatch New Invitation</span>
          </div>

          {errorMsg && (
            <div className="p-2.5 text-xs bg-rose-50 border border-rose-200 text-rose-800 rounded-lg flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-2.5 text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Target Project
              </label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-800"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Project Role
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-800"
              >
                <option value="Senior Developer">Senior Developer</option>
                <option value="Lead Architect">Lead Architect</option>
                <option value="QA Engineer">QA Engineer</option>
                <option value="DevOps Specialist">DevOps Specialist</option>
                <option value="Product Designer">Product Designer</option>
                <option value="Project Leader">Project Leader</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Member Email Address *
            </label>
            <div className="flex gap-2">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@enterprise.internal"
                className="flex-1 px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-2xs transition-colors flex items-center gap-1.5 disabled:opacity-50 shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{isSubmitting ? 'Sending...' : 'Send Invite'}</span>
              </button>
            </div>
          </div>
        </form>

        {/* Existing Invitations List */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-slate-900">
            <span>Pending & Active Invitations ({invitations.length})</span>
            {isLoading && <span className="text-[10px] text-slate-400 font-normal">Loading...</span>}
          </div>

          {invitations.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-xl">
              No pending invitations for this project workspace.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white max-h-56 overflow-y-auto">
              {invitations.map((inv) => {
                const isCopied = copiedToken === inv.token;
                return (
                  <div key={inv.id} className="p-3 flex items-center justify-between gap-3 text-xs hover:bg-slate-50/70">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 truncate">{inv.email}</div>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                        <span className="font-mono text-blue-600 bg-blue-50 px-1.5 py-0.2 rounded font-semibold text-[10px]">
                          {inv.role}
                        </span>
                        <span className="flex items-center gap-1 text-[10px] text-slate-400">
                          <Clock className="w-3 h-3" />
                          <span>Expires {inv.expires_at ? new Date(inv.expires_at).toLocaleDateString() : 'in 7 days'}</span>
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleCopyInviteLink(inv)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition-colors shrink-0 ${
                        isCopied
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                          : 'bg-white text-slate-700 hover:bg-slate-100 border-slate-200'
                      }`}
                      title="Copy registration token invite link"
                    >
                      {isCopied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                      <span>{isCopied ? 'Link Copied!' : 'Copy Link'}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="pt-3 border-t border-slate-100 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
};
