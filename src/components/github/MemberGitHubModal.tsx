import React, { useState, useEffect } from 'react';
import {
  Github,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  GitCommit,
  GitPullRequest,
  Users,
  FolderGit2,
  Trash2,
  User as UserIcon,
  ShieldCheck,
  Check,
  Clock,
  Sparkles
} from 'lucide-react';
import { api } from '../../api/client';
import { User } from '../../types';
import { Avatar } from '../common/Avatar';

interface MemberGitHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User | null;
  onProfileUpdated?: () => void;
  selectedProjectId?: string;
}

export const MemberGitHubModal: React.FC<MemberGitHubModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onProfileUpdated,
  selectedProjectId
}) => {
  const [activeTab, setActiveTab] = useState<'my-account' | 'team-directory'>('my-account');
  const [status, setStatus] = useState<any>(null);
  const [teamStatus, setTeamStatus] = useState<any[]>([]);
  const [projectGitHubStatus, setProjectGitHubStatus] = useState<any>(null);
  const [repos, setRepos] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form fields (Zero PAT prompt)
  const [ghUsername, setGhUsername] = useState(currentUser?.github_username || '');
  const [selectedRepo, setSelectedRepo] = useState('');

  const loadStatus = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [userStatusRes, teamStatusRes] = await Promise.all([
        api.getUserGitHubStatus(),
        api.getTeamGitHubStatus()
      ]);
      setStatus(userStatusRes);
      setTeamStatus(teamStatusRes);

      if (userStatusRes.is_connected) {
        if (userStatusRes.github_username) {
          setGhUsername(userStatusRes.github_username);
        }
        if (userStatusRes.selected_repo) {
          setSelectedRepo(userStatusRes.selected_repo);
        }
        try {
          const repoRes = await api.getUserGitHubRepos();
          if (repoRes && repoRes.repos) {
            setRepos(repoRes.repos);
          }
        } catch {
          // Non-fatal
        }
      }

      if (selectedProjectId) {
        try {
          const projStatus = await api.getGitHubStatus(selectedProjectId);
          setProjectGitHubStatus(projStatus);
        } catch {
          // Non-fatal
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load GitHub status.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadStatus();
    }
  }, [isOpen, selectedProjectId]);

  // Listen for OAuth completion from popup window
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setSuccessMessage('GitHub account successfully authenticated!');
        loadStatus();
        if (onProfileUpdated) onProfileUpdated();
      } else if (event.data?.type === 'OAUTH_AUTH_ERROR') {
        setErrorMessage(event.data.message || 'GitHub OAuth failed.');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onProfileUpdated]);

  if (!isOpen) return null;

  const handleOAuthConnect = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await api.getGitHubOAuthUrl();
      if (res.url) {
        const popup = window.open(res.url, 'github_oauth_popup', 'width=600,height=720');
        if (!popup) {
          window.location.href = res.url;
        }
      } else {
        // Fallback: connect using GitHub username via backend credentials
        if (!ghUsername.trim()) {
          setErrorMessage('Please enter your GitHub username to connect your account.');
          setIsSubmitting(false);
          return;
        }
        const connectRes = await api.connectUserGitHub({
          github_username: ghUsername.trim()
        });
        setSuccessMessage(connectRes.message || 'GitHub account linked successfully!');
        await loadStatus();
        if (onProfileUpdated) onProfileUpdated();
      }
    } catch (err: any) {
      setErrorMessage(`Failed to initiate GitHub connect: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUsernameConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ghUsername.trim()) {
      setErrorMessage('Please enter your GitHub username.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await api.connectUserGitHub({
        github_username: ghUsername.trim(),
        selected_repo: selectedRepo.trim() || undefined
      });
      setSuccessMessage(res.message || 'GitHub account connected!');
      await loadStatus();
      if (onProfileUpdated) onProfileUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to connect GitHub account.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect your personal GitHub account?')) return;
    setIsSubmitting(true);
    try {
      await api.disconnectUserGitHub();
      setStatus({ is_connected: false });
      setRepos([]);
      setSelectedRepo('');
      setSuccessMessage('Your GitHub account has been disconnected.');
      await loadStatus();
      if (onProfileUpdated) onProfileUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to disconnect GitHub.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRepoSelect = async (repoName: string) => {
    setSelectedRepo(repoName);
    try {
      await api.selectUserGitHubRepo(repoName, selectedProjectId);
      setSuccessMessage(`Active repository set to ${repoName} & activity synchronized!`);
      await loadStatus();
      if (onProfileUpdated) onProfileUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to select repository.');
    }
  };

  const handleManualSync = async () => {
    if (!selectedProjectId) {
      setErrorMessage('Please select a project to sync.');
      return;
    }
    setIsSyncing(true);
    setErrorMessage(null);
    try {
      const syncRes = await api.syncGitHub(selectedProjectId);
      setSuccessMessage(syncRes.message || 'Repository sync completed successfully!');
      await loadStatus();
    } catch (err: any) {
      setErrorMessage(err.message || 'Sync failed.');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center text-white ring-1 ring-slate-700">
              <Github className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight">GitHub Integration</h2>
              <p className="text-xs text-slate-400">
                Connect your GitHub identity, sync repository activity, and index code into project RAG
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Tab switcher */}
        <div className="px-6 pt-3 bg-slate-50 border-b border-slate-200 flex gap-4 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab('my-account')}
            className={`pb-2.5 border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'my-account'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <UserIcon className="w-3.5 h-3.5" />
            <span>My GitHub Account</span>
            {status?.is_connected && (
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('team-directory')}
            className={`pb-2.5 border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'team-directory'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Team Directory ({teamStatus.filter(t => t.is_connected).length}/{teamStatus.length})</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-xs text-rose-800">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2 text-xs text-emerald-800">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {activeTab === 'my-account' && (
            <>
              {status?.is_connected ? (
                <div className="space-y-4">
                  {/* Connected Profile Card */}
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <img
                          src={status.avatar_url || `https://avatars.githubusercontent.com/${status.github_username}`}
                          alt={status.github_username}
                          className="w-12 h-12 rounded-full ring-2 ring-slate-200 object-cover"
                        />
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-bold text-slate-900">{status.name}</span>
                            <span className="text-xs font-mono text-slate-500">@{status.github_username}</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-medium bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              Connected & Verified
                            </span>
                            <span>· {status.public_repos} public repos</span>
                          </div>
                        </div>
                      </div>

                      <a
                        href={status.html_url}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors flex items-center gap-1"
                      >
                        <span>Profile</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>

                    {/* Repository Picker */}
                    <div className="pt-3 border-t border-slate-200">
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <FolderGit2 className="w-3.5 h-3.5 text-blue-600" />
                          <span>Authorized Repository</span>
                        </span>
                        {repos.length > 0 && (
                          <span className="text-[11px] text-slate-400">{repos.length} available</span>
                        )}
                      </label>

                      <div className="flex gap-2">
                        {repos.length > 0 ? (
                          <select
                            value={selectedRepo || status.selected_repo || ''}
                            onChange={(e) => handleRepoSelect(e.target.value)}
                            className="flex-1 px-3 py-2 text-xs text-slate-900 border border-slate-200 rounded-lg bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="">Select an authorized repository...</option>
                            {repos.map((r: any) => (
                              <option key={r.id} value={r.full_name}>
                                {r.full_name} {r.private ? '(Private)' : ''}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={selectedRepo}
                            onChange={(e) => setSelectedRepo(e.target.value)}
                            placeholder="e.g. owner/repository"
                            className="flex-1 px-3 py-2 text-xs text-slate-900 border border-slate-200 rounded-lg bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                          />
                        )}

                        {repos.length === 0 && (
                          <button
                            type="button"
                            onClick={() => handleRepoSelect(selectedRepo)}
                            className="px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer"
                          >
                            Set Repo
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Commits and pull requests mentioning deliverable keys (e.g. [EQX-101]) will automatically link and update statuses.
                      </p>
                    </div>

                    {/* Sync Status & Last Synced Commit */}
                    {projectGitHubStatus && projectGitHubStatus.is_configured && (
                      <div className="pt-3 border-t border-slate-200 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-slate-700">Repository Sync Status:</span>
                            <span
                              className={`text-[11px] font-semibold px-2 py-0.5 rounded font-mono ${
                                projectGitHubStatus.sync_status === 'completed'
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : projectGitHubStatus.sync_status === 'syncing'
                                  ? 'bg-blue-50 text-blue-700 border border-blue-200 animate-pulse'
                                  : projectGitHubStatus.sync_status === 'failed'
                                  ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                  : 'bg-slate-100 text-slate-600 border border-slate-200'
                              }`}
                            >
                              {projectGitHubStatus.sync_status} {projectGitHubStatus.sync_stage !== 'idle' ? `(${projectGitHubStatus.sync_stage})` : ''}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={handleManualSync}
                            disabled={isSyncing || projectGitHubStatus.sync_status === 'syncing'}
                            className="px-3 py-1 text-xs font-semibold text-blue-700 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
                            <span>{isSyncing ? 'Syncing...' : 'Sync Repository'}</span>
                          </button>
                        </div>

                        {projectGitHubStatus.last_synced_sha && (
                          <div className="p-2.5 bg-white rounded-lg border border-slate-200 text-xs space-y-1">
                            <div className="flex items-center justify-between text-slate-500 text-[11px]">
                              <span className="flex items-center gap-1 font-mono">
                                <GitCommit className="w-3.5 h-3.5 text-slate-400" />
                                <span>Commit: <strong className="text-slate-800 font-semibold">{projectGitHubStatus.last_synced_sha}</strong></span>
                              </span>
                              {projectGitHubStatus.last_synced_at && (
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  <span>{new Date(projectGitHubStatus.last_synced_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                </span>
                              )}
                            </div>
                            {projectGitHubStatus.last_synced_commit_message && (
                              <p className="text-slate-700 text-xs truncate">
                                "{projectGitHubStatus.last_synced_commit_message}"
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="pt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={handleDisconnect}
                        disabled={isSubmitting}
                        className="px-3 py-1.5 text-xs font-medium text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Disconnect GitHub</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* Connect flow (Zero PAT inputs, 1-click connect) */
                <div className="space-y-4">
                  <div className="p-4 bg-blue-50/60 border border-blue-200 rounded-xl text-xs text-blue-900 leading-relaxed">
                    <div className="font-semibold mb-1 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-blue-600" />
                      <span>Secure GitHub Authentication</span>
                    </div>
                    Connect your GitHub account using OAuth or username linking. Minimum read permissions are requested. Tokens are encrypted at rest on the backend and never exposed to the client.
                  </div>

                  <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
                    <button
                      type="button"
                      onClick={handleOAuthConnect}
                      disabled={isSubmitting}
                      className="w-full py-3 px-4 text-xs font-semibold text-white bg-slate-900 hover:bg-black rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      <Github className="w-4 h-4" />
                      <span>{isSubmitting ? 'Connecting...' : 'Connect with GitHub (1-Click)'}</span>
                    </button>

                    <div className="flex items-center gap-2 text-[10px] text-slate-400 uppercase tracking-widest my-2">
                      <div className="flex-1 border-t border-slate-200"></div>
                      <span>Or link by GitHub Username</span>
                      <div className="flex-1 border-t border-slate-200"></div>
                    </div>

                    <form onSubmit={handleUsernameConnect} className="space-y-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          GitHub Username
                        </label>
                        <input
                          type="text"
                          value={ghUsername}
                          onChange={(e) => setGhUsername(e.target.value)}
                          placeholder="e.g. torvalds or your-handle"
                          className="w-full px-3 py-2 text-xs text-slate-900 border border-slate-200 rounded-lg bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                        />
                        <p className="text-[11px] text-slate-400 mt-1">
                          Links public commits and PRs to tasks matching your username.
                        </p>
                      </div>

                      <button
                        type="submit"
                        disabled={isSubmitting || !ghUsername.trim()}
                        className="w-full py-2 px-3 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg shadow-2xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <UserIcon className="w-3.5 h-3.5" />
                        <span>Link Username Profile</span>
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'team-directory' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                View the status of each team member's independent GitHub connection across the workspace:
              </p>

              <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white">
                {teamStatus.map((m) => (
                  <div key={m.member_id} className="p-3.5 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar
                        name={m.name}
                        avatarUrl={m.github_avatar || m.avatar_url}
                        size="md"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-slate-800 truncate">{m.name}</span>
                          <span className="text-[11px] text-slate-400 font-mono">({m.role})</span>
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                          {m.github_username ? (
                            <span className="font-mono text-blue-600 flex items-center gap-1">
                              <Github className="w-3 h-3 text-slate-400" />
                              <span>@{m.github_username}</span>
                            </span>
                          ) : (
                            <span className="text-slate-400 italic">No GitHub handle linked</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      {m.is_connected ? (
                        <div className="text-right">
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                            <Check className="w-3 h-3" />
                            Connected
                          </span>
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                            {m.commits_count || 0} commits · {m.prs_count || 0} PRs
                          </div>
                        </div>
                      ) : (
                        <span className="text-[11px] font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                          Unlinked
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-1 text-slate-400 text-[11px]">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>Read-only GitHub permissions enforced</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
