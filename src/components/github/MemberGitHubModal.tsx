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
  Key,
  User as UserIcon,
  ShieldCheck
} from 'lucide-react';
import { api } from '../../api/client';
import { User, UserGitHubProfile } from '../../types';
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
  const [repos, setRepos] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form fields
  const [patToken, setPatToken] = useState('');
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
        // Load user repos
        try {
          const repoRes = await api.getUserGitHubRepos();
          if (repoRes && repoRes.repos) {
            setRepos(repoRes.repos);
          }
        } catch {
          // Ignore repo load error
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
  }, [isOpen]);

  if (!isOpen) return null;

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patToken.trim() && !ghUsername.trim()) {
      setErrorMessage('Please provide either a GitHub Personal Access Token or your GitHub username.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await api.connectUserGitHub({
        access_token: patToken.trim() || undefined,
        github_username: ghUsername.trim() || undefined,
        selected_repo: selectedRepo.trim() || undefined
      });
      setSuccessMessage(res.message || 'GitHub successfully connected!');
      setPatToken('');
      await loadStatus();
      if (onProfileUpdated) onProfileUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to connect GitHub account.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOAuthConnect = async () => {
    setIsSubmitting(true);
    try {
      const res = await api.getGitHubOAuthUrl();
      if (res.url) {
        window.location.href = res.url;
      }
    } catch (err: any) {
      setErrorMessage(`Failed to initiate GitHub OAuth: ${err.message}`);
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
      setErrorMessage(err.message || 'Failed to set repository.');
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
              <h2 className="text-base font-bold tracking-tight">Personal GitHub Integration</h2>
              <p className="text-xs text-slate-400">
                Each team member connects their own personal GitHub to link real commits & PRs to tasks
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

        {/* Tab switcher */}
        <div className="px-6 pt-3 bg-slate-50 border-b border-slate-200 flex gap-4 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab('my-account')}
            className={`pb-2.5 border-b-2 transition-colors flex items-center gap-1.5 ${
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
            className={`pb-2.5 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'team-directory'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Team Integrations Directory ({teamStatus.filter(t => t.is_connected).length}/{teamStatus.length})</span>
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
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
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

                    {/* Active Repository Picker */}
                    <div className="pt-3 border-t border-slate-200">
                      <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                        <FolderGit2 className="w-3.5 h-3.5 text-blue-600" />
                        <span>Active Repository for Task Linking</span>
                      </label>
                      <div className="flex gap-2">
                        {repos.length > 0 ? (
                          <select
                            value={selectedRepo || status.selected_repo || ''}
                            onChange={(e) => handleRepoSelect(e.target.value)}
                            className="flex-1 px-3 py-1.5 text-xs text-slate-900 border border-slate-200 rounded-lg bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="">Select a repository...</option>
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
                            placeholder="e.g. facebook/react or owner/repo"
                            className="flex-1 px-3 py-1.5 text-xs text-slate-900 border border-slate-200 rounded-lg bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                          />
                        )}
                        {repos.length === 0 && (
                          <button
                            type="button"
                            onClick={() => handleRepoSelect(selectedRepo)}
                            className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                          >
                            Save Repo
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Commits in this repository mentioning Jira issue keys (e.g. [EQX-101]) will be automatically surfaced.
                      </p>
                    </div>

                    <div className="pt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={handleDisconnect}
                        disabled={isSubmitting}
                        className="px-3 py-1.5 text-xs font-medium text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors flex items-center gap-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Disconnect GitHub</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* Connect form */
                <form onSubmit={handleConnect} className="space-y-4">
                  <div className="p-4 bg-blue-50/60 border border-blue-200 rounded-xl text-xs text-blue-900 leading-relaxed">
                    <div className="font-semibold mb-1 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-blue-600" />
                      <span>Member-Authoritative Integration</span>
                    </div>
                    Every member connects their own personal GitHub account. You can connect using your GitHub Personal Access Token (PAT) for private repos & rate-limit immunity, or connect instantly using your public username.
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      GitHub Username
                    </label>
                    <input
                      type="text"
                      value={ghUsername}
                      onChange={(e) => setGhUsername(e.target.value)}
                      placeholder="e.g. torvalds or your-username"
                      className="w-full px-3 py-2 text-xs text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      Your GitHub handle will be mapped to all your assigned tasks and commit signatures.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <Key className="w-3.5 h-3.5 text-slate-400" />
                        <span>Personal Access Token (Recommended)</span>
                      </span>
                      <a
                        href="https://github.com/settings/tokens/new?scopes=repo,read:user"
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-blue-600 hover:underline flex items-center gap-0.5"
                      >
                        <span>Generate Token</span>
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </label>
                    <input
                      type="password"
                      value={patToken}
                      onChange={(e) => setPatToken(e.target.value)}
                      placeholder="ghp_xxxxxxxxxxxxxxxxxxxx (fine-grained or classic token)"
                      className="w-full px-3 py-2 text-xs font-mono text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      Tokens are validated live against api.github.com and stored securely in SQLite for your account.
                    </p>
                  </div>

                  <div className="space-y-2.5 pt-2">
                    <button
                      type="button"
                      onClick={handleOAuthConnect}
                      disabled={isSubmitting}
                      className="w-full py-2.5 px-4 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-xl shadow-2xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <Github className="w-4 h-4 text-slate-900" />
                      <span>Authenticate with GitHub OAuth (1-Click)</span>
                    </button>

                    <div className="flex items-center gap-2 text-[10px] text-slate-400 uppercase tracking-widest my-1">
                      <div className="flex-1 border-t border-slate-200"></div>
                      <span>Or connect via Personal Token / Username</span>
                      <div className="flex-1 border-t border-slate-200"></div>
                    </div>

                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full py-2.5 px-4 text-xs font-semibold text-white bg-slate-900 hover:bg-black rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <Github className="w-4 h-4" />
                      <span>{isSubmitting ? 'Verifying with GitHub...' : 'Connect Personal GitHub'}</span>
                    </button>
                  </div>
                </form>
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
                        <div className="text-xs font-semibold text-slate-900 truncate flex items-center gap-1.5">
                          <span>{m.name}</span>
                          {currentUser?.email === m.email && (
                            <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.2 rounded font-mono">You</span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate font-mono">
                          {m.email} · {m.role}
                        </div>
                        {m.is_connected && (
                          <div className="text-[10px] text-slate-500 flex items-center gap-2 mt-0.5 font-mono">
                            <span>{m.commits_count || 0} commits</span>
                            <span>·</span>
                            <span>{m.prs_count || 0} PRs</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      {m.is_connected ? (
                        <div className="flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded text-[11px] font-medium border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>@{m.github_username}</span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
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
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
            <span>Independent per-member credentials</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
