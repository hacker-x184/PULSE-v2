import React, { useState, useEffect } from 'react';
import {
  Github,
  Search,
  Check,
  AlertCircle,
  CheckCircle2,
  Lock,
  Globe,
  GitBranch,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Layers,
  Sparkles,
  ArrowRight,
  User as UserIcon
} from 'lucide-react';
import { Modal } from '../common/Modal';
import { api } from '../../api/client';
import { Project } from '../../types';

interface GitHubProjectImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectImported: (project: Project) => void;
}

interface Repository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  default_branch: string;
  updated_at: string;
}

export const GitHubProjectImportModal: React.FC<GitHubProjectImportModalProps> = ({
  isOpen,
  onClose,
  onProjectImported
}) => {
  const [isConnected, setIsConnected] = useState(false);
  const [connectedUsername, setConnectedUsername] = useState<string | null>(null);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [ghUsernameInput, setGhUsernameInput] = useState('');

  // Project configuration
  const [customName, setCustomName] = useState('');
  const [customPrefix, setCustomPrefix] = useState('');
  const [customDescription, setCustomDescription] = useState('');

  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      checkExistingConnection();
    } else {
      resetModal();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setSuccessMessage('GitHub account successfully authenticated!');
        checkExistingConnection();
      } else if (event.data?.type === 'OAUTH_AUTH_ERROR') {
        setErrorMessage(event.data.message || 'GitHub OAuth failed.');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const resetModal = () => {
    setSelectedRepo(null);
    setSearchTerm('');
    setCustomName('');
    setCustomPrefix('');
    setCustomDescription('');
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const checkExistingConnection = async () => {
    try {
      setErrorMessage(null);
      const status = await api.getUserGitHubStatus();
      if (status && status.is_connected) {
        setIsConnected(true);
        setConnectedUsername(status.github_username);
        loadRepos();
      } else {
        setIsConnected(false);
        setConnectedUsername(null);
      }
    } catch {
      setIsConnected(false);
    }
  };

  const loadRepos = async () => {
    setIsLoadingRepos(true);
    setErrorMessage(null);
    try {
      const res = await api.getUserGitHubRepos();
      if (res && res.repos) {
        setRepos(res.repos);
      } else {
        setRepos([]);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to fetch repositories.');
    } finally {
      setIsLoadingRepos(false);
    }
  };

  const handleOAuthConnect = async () => {
    setIsConnecting(true);
    setErrorMessage(null);
    try {
      const res = await api.getGitHubOAuthUrl();
      if (res.url) {
        const popup = window.open(res.url, 'github_oauth_popup', 'width=600,height=720');
        if (!popup) {
          window.location.href = res.url;
        }
      } else {
        // Fallback: connect using username
        if (!ghUsernameInput.trim()) {
          setErrorMessage('Please enter your GitHub username to link repositories.');
          setIsConnecting(false);
          return;
        }
        await api.connectUserGitHub({ github_username: ghUsernameInput.trim() });
        setSuccessMessage('Connected GitHub profile successfully!');
        await checkExistingConnection();
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to initiate GitHub connect.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleUsernameConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ghUsernameInput.trim()) return;

    setIsConnecting(true);
    setErrorMessage(null);
    try {
      const res = await api.connectUserGitHub({ github_username: ghUsernameInput.trim() });
      if (res.success) {
        setIsConnected(true);
        setConnectedUsername(res.profile?.github_username || ghUsernameInput.trim());
        setGhUsernameInput('');
        await loadRepos();
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to connect GitHub account.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await api.disconnectUserGitHub();
      setIsConnected(false);
      setConnectedUsername(null);
      setRepos([]);
      setSelectedRepo(null);
      setSuccessMessage('GitHub credentials disconnected.');
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to disconnect.');
    }
  };

  const handleSelectRepo = (repo: Repository) => {
    setSelectedRepo(repo);
    setCustomName(repo.name);
    setCustomDescription(repo.description || `Imported from GitHub: ${repo.full_name}`);
    const prefix = repo.name.replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase() || 'PLS';
    setCustomPrefix(prefix);
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRepo) return;

    const parts = selectedRepo.full_name.split('/');
    const owner = parts[0];
    const name = parts[1];

    setIsImporting(true);
    setErrorMessage(null);
    try {
      const res = await api.importGitHubProject({
        repo_owner: owner,
        repo_name: name,
        name: customName.trim() || selectedRepo.name,
        description: customDescription.trim() || undefined,
        key_prefix: customPrefix.trim() || undefined
      });

      if (res.success && res.project) {
        setSuccessMessage(`Project imported successfully with ${res.imported_issues_count || 0} issues!`);
        setTimeout(() => {
          onProjectImported(res.project);
          onClose();
        }, 1200);
      } else {
        setErrorMessage(res.message || 'Failed to import repository.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Import failed. Check permissions.');
    } finally {
      setIsImporting(false);
    }
  };

  const filteredRepos = repos.filter(r =>
    r.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (r.description && r.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Import Project From GitHub"
      subtitle="Select an authorized repository to bootstrap your agile project, deliverables, and RAG knowledge base."
    >
      <div className="space-y-5">
        {/* Alerts */}
        {errorMessage && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl flex items-center gap-2 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl flex items-center gap-2 text-xs">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span className="flex-1">{successMessage}</span>
          </div>
        )}

        {/* Step 1: Authentication */}
        {!isConnected ? (
          <div className="p-4 bg-[var(--surface-secondary)] border border-[var(--border-color)] rounded-xl space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span className="text-xs font-bold text-[var(--text-primary)]">
                Connect GitHub Account
              </span>
            </div>
            <p className="text-xs text-[var(--text-secondary)]">
              Authenticate via GitHub OAuth. Read-only permissions are used and tokens remain encrypted on the backend.
            </p>

            <button
              type="button"
              onClick={handleOAuthConnect}
              disabled={isConnecting}
              className="w-full py-2.5 px-4 text-xs font-semibold text-white bg-slate-900 hover:bg-black rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Github className="w-4 h-4" />
              <span>{isConnecting ? 'Connecting...' : 'Connect with GitHub (1-Click)'}</span>
            </button>

            <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)] uppercase tracking-widest my-1">
              <div className="flex-1 border-t border-[var(--border-color)]"></div>
              <span>Or link public profile</span>
              <div className="flex-1 border-t border-[var(--border-color)]"></div>
            </div>

            <form onSubmit={handleUsernameConnect} className="flex gap-2">
              <input
                type="text"
                value={ghUsernameInput}
                onChange={e => setGhUsernameInput(e.target.value)}
                placeholder="GitHub username (e.g. torvalds)"
                className="flex-1 px-3 py-1.5 text-xs bg-[var(--surface-primary)] border border-[var(--border-color)] rounded-lg focus:outline-hidden focus:ring-2 focus:ring-[var(--primary-accent)]"
              />
              <button
                type="submit"
                disabled={isConnecting || !ghUsernameInput.trim()}
                className="px-3.5 py-1.5 text-xs font-semibold text-[var(--text-primary)] bg-[var(--surface-primary)] hover:bg-[var(--surface-tertiary)] border border-[var(--border-color)] rounded-lg transition-colors disabled:opacity-50 cursor-pointer shrink-0"
              >
                Link User
              </button>
            </form>
          </div>
        ) : (
          <div className="p-3 bg-[var(--surface-secondary)] border border-[var(--border-color)] rounded-xl flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-full bg-emerald-600/10 text-emerald-600 flex items-center justify-center font-bold">
                <Github className="w-4 h-4" />
              </div>
              <div>
                <div className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                  <span>Connected as @{connectedUsername}</span>
                  <span className="px-1.5 py-0.2 text-[10px] bg-emerald-100 text-emerald-800 rounded font-medium">
                    Authorized
                  </span>
                </div>
                <div className="text-[11px] text-[var(--text-secondary)]">
                  {repos.length} repository/repositories accessible for import
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={loadRepos}
                disabled={isLoadingRepos}
                title="Refresh repository list"
                className="p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-sidebar-hover)] rounded-lg transition-colors cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingRepos ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={handleDisconnect}
                className="px-2 py-1 text-[11px] text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded transition-colors cursor-pointer"
              >
                Disconnect
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Repository Selection */}
        {isConnected && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-[var(--text-primary)]">
                Select Repository to Import
              </label>
              {repos.length > 0 && (
                <span className="text-[11px] text-[var(--text-muted)] font-mono">
                  {filteredRepos.length} matches
                </span>
              )}
            </div>

            {/* Search filter */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Search repository by name or description..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--surface-primary)] border border-[var(--border-color)] rounded-lg focus:outline-hidden focus:ring-2 focus:ring-[var(--primary-accent)]"
              />
            </div>

            {/* Repos list */}
            <div className="max-h-52 overflow-y-auto divide-y divide-[var(--border-color)] border border-[var(--border-color)] rounded-xl bg-[var(--surface-primary)]">
              {isLoadingRepos ? (
                <div className="p-6 text-center text-xs text-[var(--text-muted)] flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-[var(--primary-accent)]" />
                  <span>Loading authorized repositories from GitHub...</span>
                </div>
              ) : filteredRepos.length === 0 ? (
                <div className="p-6 text-center text-xs text-[var(--text-muted)]">
                  {repos.length === 0 ? 'No repositories found for this account.' : 'No repositories match your search.'}
                </div>
              ) : (
                filteredRepos.map(repo => {
                  const isSelected = selectedRepo?.id === repo.id;
                  return (
                    <div
                      key={repo.id}
                      onClick={() => handleSelectRepo(repo)}
                      className={`p-3 transition-colors cursor-pointer flex items-center justify-between gap-3 ${
                        isSelected
                          ? 'bg-[var(--accent-light)] border-l-4 border-[var(--primary-accent)]'
                          : 'hover:bg-[var(--surface-secondary)]'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-xs text-[var(--text-primary)] truncate">
                            {repo.full_name}
                          </span>
                          {repo.private ? (
                            <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.2 bg-amber-50 text-amber-700 border border-amber-200 rounded font-medium">
                              <Lock className="w-2.5 h-2.5" />
                              Private
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.2 bg-blue-50 text-blue-700 border border-blue-200 rounded font-medium">
                              <Globe className="w-2.5 h-2.5" />
                              Public
                            </span>
                          )}
                        </div>

                        {repo.description && (
                          <p className="text-[11px] text-[var(--text-secondary)] truncate mt-0.5">
                            {repo.description}
                          </p>
                        )}

                        <div className="flex items-center gap-3 text-[10px] text-[var(--text-muted)] mt-1 font-mono">
                          <span className="flex items-center gap-1">
                            <GitBranch className="w-3 h-3" />
                            {repo.default_branch}
                          </span>
                          <span>Updated {new Date(repo.updated_at).toLocaleDateString()}</span>
                        </div>
                      </div>

                      <div className="shrink-0">
                        {isSelected ? (
                          <div className="w-5 h-5 rounded-full bg-[var(--primary-accent)] text-white flex items-center justify-center">
                            <Check className="w-3 h-3 stroke-[3]" />
                          </div>
                        ) : (
                          <div className="w-5 h-5 rounded-full border border-[var(--border-color)] flex items-center justify-center text-transparent hover:border-[var(--primary-accent)]">
                            <Check className="w-3 h-3" />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Step 3: Project Configuration */}
        {selectedRepo && (
          <form onSubmit={handleImportSubmit} className="space-y-4 pt-2 border-t border-[var(--border-color)]">
            <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--text-primary)]">
              <Sparkles className="w-4 h-4 text-amber-500" />
              <span>Configure PULSE Project</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                  Project Title *
                </label>
                <input
                  type="text"
                  required
                  value={customName}
                  onChange={e => setCustomName(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-[var(--surface-primary)] border border-[var(--border-color)] rounded-lg focus:outline-hidden focus:ring-2 focus:ring-[var(--primary-accent)]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                  Issue Key Prefix *
                </label>
                <input
                  type="text"
                  required
                  maxLength={5}
                  value={customPrefix}
                  onChange={e => setCustomPrefix(e.target.value.toUpperCase())}
                  placeholder="e.g. CORE"
                  className="w-full px-3 py-1.5 text-xs font-mono uppercase bg-[var(--surface-primary)] border border-[var(--border-color)] rounded-lg focus:outline-hidden focus:ring-2 focus:ring-[var(--primary-accent)]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                Description & Strategic Objectives
              </label>
              <textarea
                rows={2}
                value={customDescription}
                onChange={e => setCustomDescription(e.target.value)}
                className="w-full px-3 py-1.5 text-xs bg-[var(--surface-primary)] border border-[var(--border-color)] rounded-lg focus:outline-hidden focus:ring-2 focus:ring-[var(--primary-accent)] resize-none"
              />
            </div>

            <div className="p-3 bg-[var(--accent-light)] border border-[var(--border-color)] rounded-xl text-xs space-y-1">
              <div className="font-semibold text-[var(--text-primary)] flex items-center gap-1">
                <Layers className="w-3.5 h-3.5 text-[var(--primary-accent)]" />
                <span>What will happen during import:</span>
              </div>
              <ul className="list-disc list-inside text-[11px] text-[var(--text-secondary)] space-y-0.5">
                <li>Active repository branches & default branch will be synchronized.</li>
                <li>Recent commits will be linked to deliverables via issue key patterns.</li>
                <li>Eligible code files and README will be indexed into local RAG embeddings.</li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--surface-secondary)] hover:bg-[var(--surface-tertiary)] rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isImporting || !customName.trim() || !customPrefix.trim()}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-[var(--primary-accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {isImporting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Synchronizing & Provisioning...</span>
                  </>
                ) : (
                  <>
                    <span>Import Project</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
};
