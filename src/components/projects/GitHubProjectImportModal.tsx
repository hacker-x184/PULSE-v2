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
  ArrowRight
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
  const [patToken, setPatToken] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [connectedUsername, setConnectedUsername] = useState<string | null>(null);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Project configuration
  const [customName, setCustomName] = useState('');
  const [customPrefix, setCustomPrefix] = useState('');
  const [customDescription, setCustomDescription] = useState('');

  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isConnectingToken, setIsConnectingToken] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      checkExistingConnection();
    } else {
      resetModal();
    }
  }, [isOpen]);

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

  const handleConnectToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patToken.trim()) return;

    setIsConnectingToken(true);
    setErrorMessage(null);
    try {
      const res = await api.connectUserGitHub({ access_token: patToken.trim() });
      if (res.success) {
        setIsConnected(true);
        setConnectedUsername(res.profile?.github_username || 'connected');
        setPatToken('');
        await loadRepos();
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to validate GitHub token. Please verify permissions.');
    } finally {
      setIsConnectingToken(false);
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
        setErrorMessage(res.message || 'Import failed.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to import GitHub project.');
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
      title="Import Project from GitHub"
      subtitle="Connect a repository, configure native PULSE governance, and synchronize issues & code activity."
      maxWidth="max-w-2xl"
    >
      <div className="space-y-5">
        {errorMessage && (
          <div className="p-3 text-xs bg-rose-50 text-rose-800 border border-rose-200 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="flex-1">{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="p-3 text-xs bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="flex-1">{successMessage}</span>
          </div>
        )}

        {/* Step 1: Account Connection Status */}
        {!isConnected ? (
          <form onSubmit={handleConnectToken} className="p-4 bg-[var(--surface-secondary)] border border-[var(--border-color)] rounded-xl space-y-3">
            <div className="flex items-center gap-2">
              <Github className="w-5 h-5 text-[var(--text-primary)]" />
              <div>
                <h4 className="text-xs font-bold text-[var(--text-primary)]">
                  Connect GitHub Personal Access Token
                </h4>
                <p className="text-[11px] text-[var(--text-secondary)]">
                  Tokens are transmitted securely and never exposed in client logs or URLs.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[11px] font-semibold text-[var(--text-secondary)]">
                Personal Access Token (classic with 'repo' scope or fine-grained)
              </label>
              <div className="flex gap-2">
                <input
                  type="password"
                  required
                  value={patToken}
                  onChange={e => setPatToken(e.target.value)}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  className="flex-1 px-3 py-1.5 text-xs font-mono bg-[var(--surface-primary)] border border-[var(--border-color)] rounded-lg focus:outline-hidden focus:ring-2 focus:ring-[var(--primary-accent)]"
                />
                <button
                  type="submit"
                  disabled={isConnectingToken || !patToken.trim()}
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-[var(--primary-accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-colors disabled:opacity-50 cursor-pointer shrink-0"
                >
                  {isConnectingToken ? 'Validating...' : 'Connect'}
                </button>
              </div>
              <p className="text-[10px] text-[var(--text-muted)]">
                Required permissions: <code className="font-mono">repo</code> (Full control of private repositories) or public repository access.
              </p>
            </div>
          </form>
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
                    <button
                      key={repo.id}
                      type="button"
                      onClick={() => handleSelectRepo(repo)}
                      className={`w-full p-2.5 text-left flex items-start justify-between gap-3 transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-[var(--accent-light)]/80 text-[var(--primary-accent)]'
                          : 'hover:bg-[var(--surface-secondary)] text-[var(--text-primary)]'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {repo.private ? (
                            <Lock className="w-3 h-3 text-amber-500 shrink-0" />
                          ) : (
                            <Globe className="w-3 h-3 text-emerald-500 shrink-0" />
                          )}
                          <span className="font-semibold text-xs truncate">
                            {repo.full_name}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.2 bg-[var(--surface-secondary)] text-[var(--text-muted)] rounded font-mono">
                            {repo.default_branch}
                          </span>
                        </div>
                        {repo.description && (
                          <p className="text-[11px] text-[var(--text-secondary)] line-clamp-1 mt-0.5">
                            {repo.description}
                          </p>
                        )}
                      </div>

                      {isSelected && (
                        <Check className="w-4 h-4 text-[var(--primary-accent)] shrink-0 mt-0.5" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Step 3: Configure Project Metadata */}
        {selectedRepo && (
          <form onSubmit={handleImportSubmit} className="space-y-4 pt-3 border-t border-[var(--border-color)]">
            <div className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[var(--primary-accent)]" />
              <span>Project Configuration</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2 space-y-1">
                <label className="block text-[11px] font-semibold text-[var(--text-secondary)]">
                  PULSE Project Name *
                </label>
                <input
                  type="text"
                  required
                  value={customName}
                  onChange={e => setCustomName(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-[var(--surface-primary)] border border-[var(--border-color)] rounded-lg focus:outline-hidden focus:ring-2 focus:ring-[var(--primary-accent)]"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] font-semibold text-[var(--text-secondary)]">
                  Key Prefix *
                </label>
                <input
                  type="text"
                  required
                  maxLength={6}
                  value={customPrefix}
                  onChange={e => setCustomPrefix(e.target.value.toUpperCase())}
                  className="w-full px-3 py-1.5 text-xs font-mono uppercase bg-[var(--surface-primary)] border border-[var(--border-color)] rounded-lg focus:outline-hidden focus:ring-2 focus:ring-[var(--primary-accent)]"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-semibold text-[var(--text-secondary)]">
                Description & Strategic Goal
              </label>
              <textarea
                rows={2}
                value={customDescription}
                onChange={e => setCustomDescription(e.target.value)}
                className="w-full px-3 py-1.5 text-xs bg-[var(--surface-primary)] border border-[var(--border-color)] rounded-lg focus:outline-hidden focus:ring-2 focus:ring-[var(--primary-accent)]"
              />
            </div>

            <div className="p-3 bg-[var(--accent-light)]/40 border border-[var(--accent-subtle)] rounded-lg text-[11px] text-[var(--text-secondary)] space-y-1">
              <div className="font-semibold text-[var(--text-primary)]">Automated Import Actions:</div>
              <ul className="list-disc list-inside space-y-0.5 text-[10px]">
                <li>Creates a native PULSE project with full sprint, task, and team management capabilities.</li>
                <li>Designates you as the initial Team Leader with transfer authority.</li>
                <li>Imports open GitHub issues as deliverables with story point estimations.</li>
                <li>Connects real commits and pull requests to the contribution ledger.</li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)] rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isImporting || !customName.trim()}
                className="px-5 py-2 text-xs font-semibold text-white bg-[var(--primary-accent)] hover:bg-[var(--accent-hover)] rounded-lg shadow-xs transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
              >
                {isImporting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Importing & Provisioning...</span>
                  </>
                ) : (
                  <>
                    <span>Import Project into PULSE</span>
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
