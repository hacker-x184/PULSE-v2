import React, { useState, useEffect } from 'react';
import {
  Settings,
  Github,
  Sliders,
  ShieldCheck,
  Database,
  History,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Save,
  Check,
  X,
  Info,
  Layers,
  Terminal,
  Copy,
  User,
  Mail,
  Lock,
  Moon,
  Sun,
  Monitor,
  Bell,
  Briefcase,
  FolderGit2,
  ExternalLink,
  Shield
} from 'lucide-react';
import { Project, User as UserType } from '../../types';
import { api } from '../../api/client';
import { Avatar } from '../common/Avatar';

export interface SettingsPageProps {
  projects: Project[];
  selectedProjectId: string;
  onReseedData: () => void;
  isReseeding: boolean;
  onRefreshData?: () => void;
  currentUser?: UserType | null;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
  onOpenProfileModal?: () => void;
}

export type SettingsTab =
  | 'account'
  | 'workspace'
  | 'github'
  | 'permissions'
  | 'appearance'
  | 'notifications'
  | 'backup';

export const SettingsPage: React.FC<SettingsPageProps> = ({
  projects,
  selectedProjectId,
  onReseedData,
  isReseeding,
  onRefreshData,
  currentUser,
  theme = 'light',
  onToggleTheme,
  onOpenProfileModal
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('account');

  // Account Preferences State
  const [displayName, setDisplayName] = useState(currentUser?.name || 'Lead Architect');
  const [githubHandle, setGithubHandle] = useState(currentUser?.github_username || 'hacker-x184');
  const [accountMsg, setAccountMsg] = useState<string | null>(null);

  // Workspace Preferences State
  const [workspaceName, setWorkspaceName] = useState('PULSE Engineering Workspace');
  const [defaultView, setDefaultView] = useState<'kanban' | 'table' | 'calendar'>('kanban');
  const [issueKeyPrefix, setIssueKeyPrefix] = useState('PULSE');
  const [timezone, setTimezone] = useState('UTC (Universal Coordinated Time)');
  const [workspaceMsg, setWorkspaceMsg] = useState<string | null>(null);

  // Notification Preferences State
  const [notifyTaskAssigned, setNotifyTaskAssigned] = useState(true);
  const [notifyDisputeResolved, setNotifyDisputeResolved] = useState(true);
  const [notifyGithubSync, setNotifyGithubSync] = useState(false);
  const [notifyOverdueAlerts, setNotifyOverdueAlerts] = useState(true);
  const [notifyMsg, setNotifyMsg] = useState<string | null>(null);

  // GitHub Integration State
  const [ghProjectId, setGhProjectId] = useState(selectedProjectId || (projects[0]?.id ?? ''));
  const [repoOwner, setRepoOwner] = useState('');
  const [repoName, setRepoName] = useState('');
  const [patToken, setPatToken] = useState('');
  const [ghStatus, setGhStatus] = useState<any>(null);
  const [isConnectingGh, setIsConnectingGh] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [ghMessage, setGhMessage] = useState<string | null>(null);
  const [autoUpdatedTasks, setAutoUpdatedTasks] = useState<any[]>([]);

  // Custom Contribution Weights State
  const [weights, setWeights] = useState({
    high_priority_weight: 3,
    medium_priority_weight: 2,
    low_priority_weight: 1,
    pr_bonus_points: 5,
    commit_bonus_points: 2,
    kudos_bonus_points: 3
  });
  const [weightsSaving, setWeightsSaving] = useState(false);
  const [weightsMsg, setWeightsMsg] = useState<string | null>(null);

  // Audit Logs State
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Copied indicator
  const [copiedCmd, setCopiedCmd] = useState(false);

  // Auto load connection status on mount and project selection
  useEffect(() => {
    if (ghProjectId) {
      api.getGitHubStatus(ghProjectId).then(status => {
        if (status.is_configured && status.is_connected) {
          setRepoOwner(status.repo_owner || '');
          setRepoName(status.repo_name || '');
          setGhStatus({
            is_connected: true,
            repo_name: `${status.repo_owner}/${status.repo_name}`,
            last_synced_at: status.last_synced_at,
            commits: [],
            pull_requests: []
          });
        } else {
          setGhStatus(null);
        }
      }).catch(() => setGhStatus(null));
    }
  }, [ghProjectId]);

  // Load weights or audit logs when relevant tab opens
  useEffect(() => {
    if (activeTab === 'permissions') {
      api.getCustomWeights().then(res => {
        if (res && res.weights) {
          setWeights(res.weights);
        }
      }).catch(() => {});
    } else if (activeTab === 'notifications') {
      setLoadingLogs(true);
      api.getAuditLogs(selectedProjectId || undefined)
        .then(res => setAuditLogs(res))
        .catch(() => {})
        .finally(() => setLoadingLogs(false));
    }
  }, [activeTab, selectedProjectId]);

  const handleOwnerChange = (val: string) => {
    const trimmed = val.trim();
    if (trimmed.includes('github.com/')) {
      const parts = trimmed.split('github.com/')[1].split('/').filter(Boolean);
      if (parts.length >= 2) {
        setRepoOwner(parts[0]);
        setRepoName(parts[1].replace(/\.git$/, ''));
        return;
      }
    } else if (trimmed.includes('/') && !repoName) {
      const parts = trimmed.split('/').filter(Boolean);
      if (parts.length >= 2) {
        setRepoOwner(parts[0]);
        setRepoName(parts[1].replace(/\.git$/, ''));
        return;
      }
    }
    setRepoOwner(val);
  };

  const handleConnectGitHub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ghProjectId || !repoOwner.trim() || !repoName.trim()) {
      setGhMessage('Target Project, Repository Owner, and Repository Name are required.');
      return;
    }

    setIsConnectingGh(true);
    setGhMessage(null);
    setAutoUpdatedTasks([]);
    try {
      const res = await api.connectGitHub({
        project_id: ghProjectId,
        repo_owner: repoOwner.trim(),
        repo_name: repoName.trim(),
        access_token: patToken.trim() || undefined
      });
      setGhStatus(res);
      if (res.auto_updated_tasks && res.auto_updated_tasks.length > 0) {
        setAutoUpdatedTasks(res.auto_updated_tasks);
      }
      if (res.error_message) {
        setGhMessage(`GitHub Notice: ${res.error_message}`);
      } else {
        const cCount = res.commits?.length || 0;
        const pCount = res.pull_requests?.length || 0;
        setGhMessage(`Successfully synchronized ${cCount} commit(s) and ${pCount} pull request(s)!`);
        onRefreshData?.();
      }
    } catch (err: any) {
      setGhMessage(`Error connecting to GitHub: ${err.message}`);
    } finally {
      setIsConnectingGh(false);
    }
  };

  const handleImportIssues = async () => {
    if (!ghProjectId) return;
    setIsImporting(true);
    setGhMessage(null);
    try {
      const res = await api.importGitHubIssues({
        project_id: ghProjectId,
        repo_owner: repoOwner.trim() || undefined,
        repo_name: repoName.trim() || undefined
      });
      setGhMessage(res.message);
      onRefreshData?.();
    } catch (err: any) {
      setGhMessage(`Failed to import issues: ${err.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!ghProjectId) return;
    if (!confirm('Are you sure you want to disconnect this repository and clear cached activity?')) return;
    setIsDisconnecting(true);
    try {
      await api.disconnectProjectGitHub(ghProjectId);
      setGhStatus(null);
      setGhMessage('GitHub repository disconnected and cached records removed.');
      setAutoUpdatedTasks([]);
      onRefreshData?.();
    } catch (err: any) {
      setGhMessage(`Failed to disconnect: ${err.message}`);
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleSaveWeights = async () => {
    setWeightsSaving(true);
    setWeightsMsg(null);
    try {
      await api.saveCustomWeights(weights);
      setWeightsMsg('Custom contribution weights saved to platform settings.');
      onRefreshData?.();
      setTimeout(() => setWeightsMsg(null), 4000);
    } catch (err: any) {
      setWeightsMsg(`Failed to save weights: ${err.message}`);
    } finally {
      setWeightsSaving(false);
    }
  };

  const handleSaveWorkspacePreferences = (e: React.FormEvent) => {
    e.preventDefault();
    setWorkspaceMsg('Workspace preferences saved successfully.');
    setTimeout(() => setWorkspaceMsg(null), 3500);
  };

  const handleSaveNotificationPreferences = (e: React.FormEvent) => {
    e.preventDefault();
    setNotifyMsg('Notification and alert preferences updated.');
    setTimeout(() => setNotifyMsg(null), 3500);
  };

  const copyCommands = () => {
    const text = `npm run build && node server.ts`;
    navigator.clipboard.writeText(text);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  const rbacMatrix = [
    { capability: 'Create & Edit Projects', teamLeader: true, member: false },
    { capability: 'Archive & Delete Projects', teamLeader: true, member: false },
    { capability: 'Import GitHub Projects via PAT', teamLeader: true, member: true },
    { capability: 'Create & Assign Deliverables', teamLeader: true, member: true },
    { capability: 'Change Task Status & Story Points', teamLeader: true, member: true },
    { capability: 'Transfer Project Leadership', teamLeader: true, member: false },
    { capability: 'Monitor Member Work Status & Progress', teamLeader: true, member: false },
    { capability: 'Approve Task Architecture Reviews', teamLeader: true, member: false },
    { capability: 'Manage Team Member Directory & Capacities', teamLeader: true, member: false },
    { capability: 'Resolve Contribution Score Disputes', teamLeader: true, member: false },
    { capability: 'Execute Smart Task Redistribution', teamLeader: true, member: false },
    { capability: 'Configure Custom Contribution Weights', teamLeader: true, member: false },
    { capability: 'Connect GitHub Repositories & Sync Commits', teamLeader: true, member: true },
    { capability: 'Export RFC 4180 CSV & Calendar (.ics)', teamLeader: true, member: true },
    { capability: 'Download Full Database Backup Snapshot', teamLeader: true, member: false },
    { capability: 'Reset Demo Database to Initial Fixtures', teamLeader: true, member: false },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
          PULSE Platform Settings
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
          Manage your account profile, workspace defaults, GitHub version control, role permissions, and data backups.
        </p>
      </div>

      {/* Settings Navigation Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto pb-px">
        <button
          type="button"
          onClick={() => setActiveTab('account')}
          className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'account'
              ? 'border-[var(--primary-accent)] text-[var(--primary-accent)]'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <User className="w-4 h-4" />
          <span>Account & Profile</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('workspace')}
          className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'workspace'
              ? 'border-[var(--primary-accent)] text-[var(--primary-accent)]'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Briefcase className="w-4 h-4" />
          <span>Workspace Preferences</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('github')}
          className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'github'
              ? 'border-[var(--primary-accent)] text-[var(--primary-accent)]'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Github className="w-4 h-4" />
          <span>GitHub Integration</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('permissions')}
          className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'permissions'
              ? 'border-[var(--primary-accent)] text-[var(--primary-accent)]'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>Project & Role Permissions</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('appearance')}
          className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'appearance'
              ? 'border-[var(--primary-accent)] text-[var(--primary-accent)]'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Sun className="w-4 h-4" />
          <span>Appearance & Theme</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('notifications')}
          className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'notifications'
              ? 'border-[var(--primary-accent)] text-[var(--primary-accent)]'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Bell className="w-4 h-4" />
          <span>Notifications & Audit</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('backup')}
          className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'backup'
              ? 'border-[var(--primary-accent)] text-[var(--primary-accent)]'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Database className="w-4 h-4" />
          <span>Data Retention & Backup</span>
        </button>
      </div>

      {/* Tab: Account & Profile */}
      {activeTab === 'account' && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <User className="w-5 h-5 text-[var(--primary-accent)]" />
              <div>
                <h2 className="text-sm font-bold text-slate-900">Personal Profile & Credentials</h2>
                <p className="text-xs text-slate-500">Manage your PULSE contributor profile and authenticated identity.</p>
              </div>
            </div>

            {onOpenProfileModal && (
              <button
                type="button"
                onClick={onOpenProfileModal}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg shadow-2xs transition-colors"
              >
                Open Full Profile Editor
              </button>
            )}
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
            <Avatar
              name={currentUser?.name || displayName}
              avatarUrl={currentUser?.avatar_url}
              size="xl"
            />
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-base font-bold text-slate-900">{currentUser?.name || displayName}</span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                  <Shield className="w-3 h-3 text-blue-600" />
                  {currentUser?.role || 'Team Leader'}
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Session Active
                </span>
              </div>
              <p className="text-xs text-slate-500 font-mono">{currentUser?.email || 'leader@pulse.dev'}</p>
              <p className="text-[11px] text-slate-400">Deterministic initials avatar generated automatically based on PULSE design standards.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-3">
              <h3 className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
                Identity Details
              </h3>
              <div>
                <label className="block text-slate-600 font-medium mb-1">Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-slate-600 font-medium mb-1">Linked GitHub Handle</label>
                <div className="flex items-center">
                  <span className="px-3 py-2 text-xs bg-slate-100 text-slate-500 border border-r-0 border-slate-200 rounded-l-lg font-mono">@</span>
                  <input
                    type="text"
                    value={githubHandle}
                    onChange={e => setGithubHandle(e.target.value)}
                    placeholder="github-username"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-r-lg text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-3">
              <h3 className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
                Security & Authentication
              </h3>
              <div className="space-y-2 text-slate-600">
                <div className="flex justify-between items-center py-1 border-b border-slate-100">
                  <span>Authentication Token:</span>
                  <span className="font-mono text-emerald-600 font-semibold">pulse_auth_token (Active)</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-100">
                  <span>Role Access Level:</span>
                  <span className="font-semibold text-slate-900">{currentUser?.role || 'Team Leader'} (Full Perms)</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span>Password Reset:</span>
                  <span className="text-slate-400">Available from sign-in screen</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Workspace Preferences */}
      {activeTab === 'workspace' && (
        <form onSubmit={handleSaveWorkspacePreferences} className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs space-y-5">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <Briefcase className="w-5 h-5 text-[var(--primary-accent)]" />
              <div>
                <h2 className="text-sm font-bold text-slate-900">Workspace Preferences</h2>
                <p className="text-xs text-slate-500">Configure team workspace defaults, ticket identifiers, and sprint parameters.</p>
              </div>
            </div>

            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-[var(--primary-accent)] hover:bg-[var(--accent-hover)] rounded-lg shadow-2xs transition-colors flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Workspace</span>
            </button>
          </div>

          {workspaceMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{workspaceMsg}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Workspace Organization Title
              </label>
              <input
                type="text"
                value={workspaceName}
                onChange={e => setWorkspaceName(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-[11px] text-slate-400 mt-1">Displayed in top navigation and workspace selector.</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Default Backlog View
              </label>
              <select
                value={defaultView}
                onChange={e => setDefaultView(e.target.value as any)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              >
                <option value="kanban">Kanban Board (Interactive Status Columns)</option>
                <option value="table">Deliverables Table (List & Complexity)</option>
                <option value="calendar">Sprint Calendar View</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Issue Key Prefix Convention
              </label>
              <input
                type="text"
                value={issueKeyPrefix}
                onChange={e => setIssueKeyPrefix(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 font-mono"
              />
              <p className="text-[11px] text-slate-400 mt-1">E.g. PULSE-101, PULSE-102 automatically generated.</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Workspace Timezone
              </label>
              <select
                value={timezone}
                onChange={e => setTimezone(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              >
                <option value="UTC (Universal Coordinated Time)">UTC (Universal Coordinated Time)</option>
                <option value="America/New_York (EST)">America/New_York (EST)</option>
                <option value="Europe/London (GMT)">Europe/London (GMT)</option>
                <option value="Asia/Kolkata (IST)">Asia/Kolkata (IST)</option>
                <option value="Asia/Tokyo (JST)">Asia/Tokyo (JST)</option>
              </select>
            </div>
          </div>
        </form>
      )}

      {/* Tab: GitHub Integration */}
      {activeTab === 'github' && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs space-y-5">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <Github className="w-5 h-5 text-slate-900" />
              <div>
                <h2 className="text-sm font-bold text-slate-900">GitHub Version Control Integration</h2>
                <p className="text-xs text-slate-500">
                  Connect live repositories via Personal Access Token, sync commits, and import issues as PULSE deliverables.
                </p>
              </div>
            </div>

            {ghStatus?.is_connected && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Connected: {ghStatus.repo_name}
              </span>
            )}
          </div>

          {/* Auto Updated Tasks Notification */}
          {autoUpdatedTasks.length > 0 && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-1 text-xs">
              <div className="font-bold text-blue-900 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-blue-600" />
                Auto-Updated {autoUpdatedTasks.length} Deliverable(s) from Git Activity:
              </div>
              <div className="space-y-1 pl-5">
                {autoUpdatedTasks.map((t, idx) => (
                  <div key={idx} className="text-blue-800 font-mono text-[11px]">
                    <span className="font-bold">[{t.issue_key}]</span>: {t.old_status} &rarr; <span className="font-bold">{t.new_status}</span> ({t.reason})
                  </div>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={handleConnectGitHub} className="space-y-4">
            {ghMessage && (
              <div
                className={`p-3 text-xs rounded-lg border flex items-center gap-2 ${
                  ghStatus?.is_connected
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-amber-50 text-amber-800 border-amber-200'
                }`}
              >
                {ghStatus?.is_connected ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                )}
                <span>{ghMessage}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Target Project
                </label>
                <select
                  value={ghProjectId}
                  onChange={e => setGhProjectId(e.target.value)}
                  className="w-full px-3 py-2 text-xs text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                >
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.key_prefix || 'PULSE'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Repository Owner or GitHub URL
                </label>
                <input
                  type="text"
                  value={repoOwner}
                  onChange={e => handleOwnerChange(e.target.value)}
                  placeholder="e.g. hacker-x184 or https://github.com/..."
                  className="w-full px-3 py-2 text-xs text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Repository Name
                </label>
                <input
                  type="text"
                  value={repoName}
                  onChange={e => setRepoName(e.target.value.trim())}
                  placeholder="e.g. PULSE"
                  className="w-full px-3 py-2 text-xs text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Personal Access Token (PAT) (Optional for public repos; required for private or high rate limits)
              </label>
              <input
                type="password"
                value={patToken}
                onChange={e => setPatToken(e.target.value)}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full px-3 py-2 text-xs text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 font-mono"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Tokens are validated securely with GitHub and never logged or exposed.
              </p>
            </div>

            <div className="flex items-center justify-between pt-2 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                {ghStatus?.is_connected && (
                  <>
                    <button
                      type="button"
                      onClick={handleImportIssues}
                      disabled={isImporting}
                      className="px-3.5 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5"
                      title="Import active GitHub issues as deliverables into this project"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isImporting ? 'animate-spin' : ''}`} />
                      <span>{isImporting ? 'Importing Issues...' : 'Import GitHub Issues'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleDisconnect}
                      disabled={isDisconnecting}
                      className="px-3.5 py-2 text-xs font-semibold text-rose-700 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {isDisconnecting ? 'Disconnecting...' : 'Disconnect Repository'}
                    </button>
                  </>
                )}
              </div>

              <button
                type="submit"
                disabled={isConnectingGh}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5 ml-auto"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isConnectingGh ? 'animate-spin' : ''}`} />
                <span>{isConnectingGh ? 'Synchronizing Activity...' : ghStatus?.is_connected ? 'Re-Sync Repository' : 'Connect & Fetch Activity'}</span>
              </button>
            </div>
          </form>

          {ghStatus && ghStatus.is_connected && ghStatus.commits && ghStatus.commits.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Synced Activity for: {ghStatus.repo_name}
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Commits */}
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2">
                  <div className="text-xs font-bold text-slate-800">
                    Recent Synced Commits ({ghStatus.commits.length})
                  </div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {ghStatus.commits.slice(0, 6).map((c: any) => (
                      <div key={c.sha} className="text-[11px] font-mono text-slate-600 truncate flex items-center gap-1.5">
                        <span className="text-blue-600 font-bold">{c.sha}</span>
                        <span className="truncate">{c.message}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* PRs */}
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2">
                  <div className="text-xs font-bold text-slate-800">
                    Pull Requests ({ghStatus.pull_requests.length})
                  </div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {ghStatus.pull_requests.length === 0 ? (
                      <div className="text-[11px] text-slate-400 py-2">No pull requests found.</div>
                    ) : (
                      ghStatus.pull_requests.slice(0, 6).map((pr: any) => (
                        <div key={pr.id || pr.number} className="text-[11px] font-mono text-slate-600 truncate flex items-center gap-1.5">
                          <span className="text-emerald-600 font-bold">#{pr.number}</span>
                          <span className="truncate">{pr.title}</span>
                          <span className="text-slate-400">({pr.state})</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Project & Role Permissions */}
      {activeTab === 'permissions' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Role-Based Access Control (RBAC) Matrix</h2>
                <p className="text-xs text-slate-500">Security enforcement capabilities across platform roles.</p>
              </div>
              <span className="text-[11px] font-mono text-slate-400">PULSE v2.0 Permissions</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 px-4">Platform Capability / Action</th>
                    <th className="py-3 px-4 text-center w-36 text-amber-700">Team Leader</th>
                    <th className="py-3 px-4 text-center w-36 text-slate-600">Team Member</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rbacMatrix.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2.5 px-4 font-medium text-slate-900">
                        {item.capability}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        {item.teamLeader ? (
                          <Check className="w-4 h-4 text-emerald-600 mx-auto" />
                        ) : (
                          <X className="w-4 h-4 text-slate-300 mx-auto" />
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        {item.member ? (
                          <Check className="w-4 h-4 text-emerald-600 mx-auto" />
                        ) : (
                          <X className="w-4 h-4 text-slate-300 mx-auto" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Custom Contribution Weights Configuration */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Sliders className="w-5 h-5 text-blue-600" />
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Custom Contribution Formula Calibration</h2>
                  <p className="text-xs text-slate-500">
                    Calibrate weighting multipliers to reward complex tasks, pull requests, and peer mentoring.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleSaveWeights}
                disabled={weightsSaving}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-2xs transition-colors flex items-center gap-1.5"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{weightsSaving ? 'Saving Weights...' : 'Save Configuration'}</span>
              </button>
            </div>

            {weightsMsg && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>{weightsMsg}</span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-blue-600" />
                  <span>Task Priority Multipliers</span>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1">
                    <span>High Priority Multiplier:</span>
                    <span className="font-mono text-blue-600 font-bold">{weights.high_priority_weight}x</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={6}
                    step={0.5}
                    value={weights.high_priority_weight}
                    onChange={e => setWeights({ ...weights, high_priority_weight: Number(e.target.value) })}
                    className="w-full accent-blue-600"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                    <span>1x (Neutral)</span>
                    <span>6x (Critical Weight)</span>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1">
                    <span>Medium Priority Multiplier:</span>
                    <span className="font-mono text-blue-600 font-bold">{weights.medium_priority_weight}x</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={4}
                    step={0.5}
                    value={weights.medium_priority_weight}
                    onChange={e => setWeights({ ...weights, medium_priority_weight: Number(e.target.value) })}
                    className="w-full accent-blue-600"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1">
                    <span>Low Priority Multiplier:</span>
                    <span className="font-mono text-blue-600 font-bold">{weights.low_priority_weight}x</span>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={2}
                    step={0.5}
                    value={weights.low_priority_weight}
                    onChange={e => setWeights({ ...weights, low_priority_weight: Number(e.target.value) })}
                    className="w-full accent-blue-600"
                  />
                </div>
              </div>

              <div className="space-y-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                  <Github className="w-4 h-4 text-slate-800" />
                  <span>Version Control & Peer Kudos Bonuses</span>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1">
                    <span>Pull Request Merged Bonus (pts):</span>
                    <span className="font-mono text-emerald-600 font-bold">+{weights.pr_bonus_points} pts</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={15}
                    value={weights.pr_bonus_points}
                    onChange={e => setWeights({ ...weights, pr_bonus_points: Number(e.target.value) })}
                    className="w-full accent-emerald-600"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1">
                    <span>Commit Synced Bonus (pts):</span>
                    <span className="font-mono text-emerald-600 font-bold">+{weights.commit_bonus_points} pts</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    value={weights.commit_bonus_points}
                    onChange={e => setWeights({ ...weights, commit_bonus_points: Number(e.target.value) })}
                    className="w-full accent-emerald-600"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1">
                    <span>Peer Kudos Recognition (Invisible Work):</span>
                    <span className="font-mono text-amber-600 font-bold">+{weights.kudos_bonus_points} pts</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={weights.kudos_bonus_points}
                    onChange={e => setWeights({ ...weights, kudos_bonus_points: Number(e.target.value) })}
                    className="w-full accent-amber-600"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Appearance & Theme */}
      {activeTab === 'appearance' && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <Sun className="w-5 h-5 text-amber-500" />
              <div>
                <h2 className="text-sm font-bold text-slate-900">Precision Minimalism Aesthetic</h2>
                <p className="text-xs text-slate-500">Linear-inspired clean interface with neutral surfaces and high-contrast typography.</p>
              </div>
            </div>

            <button
              type="button"
              onClick={onToggleTheme}
              className="px-3.5 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg shadow-2xs transition-colors flex items-center gap-1.5"
            >
              {theme === 'dark' ? <Sun className="w-3.5 h-3.5 text-amber-500" /> : <Moon className="w-3.5 h-3.5 text-indigo-600" />}
              <span>Toggle to {theme === 'dark' ? 'Light' : 'Dark'} Mode</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Light Mode Card */}
            <div
              onClick={() => { if (theme === 'dark') onToggleTheme?.(); }}
              className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                theme === 'light'
                  ? 'border-[var(--primary-accent)] bg-slate-50/60 ring-2 ring-[var(--primary-accent)]/20'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Sun className="w-4 h-4 text-amber-500" />
                  <span className="text-xs font-bold text-slate-900">Precision Light (Active)</span>
                </div>
                {theme === 'light' && <Check className="w-4 h-4 text-emerald-600" />}
              </div>
              <div className="h-20 bg-[#F7F7F8] rounded-lg border border-[#E5E5EA] p-2 flex gap-2">
                <div className="w-12 bg-[#F0F0F2] rounded h-full" />
                <div className="flex-1 space-y-1.5">
                  <div className="w-3/4 h-2 bg-slate-300 rounded" />
                  <div className="w-1/2 h-2 bg-slate-200 rounded" />
                  <div className="w-full h-5 bg-white rounded border border-[#E5E5EA]" />
                </div>
              </div>
              <p className="text-[11px] text-slate-500 mt-2">Surface: #FFFFFF · Background: #F7F7F8 · Accent: #6E63E8</p>
            </div>

            {/* Dark Mode Card */}
            <div
              onClick={() => { if (theme === 'light') onToggleTheme?.(); }}
              className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                theme === 'dark'
                  ? 'border-[var(--primary-accent)] bg-slate-900 ring-2 ring-[var(--primary-accent)]/20 text-white'
                  : 'border-slate-200 bg-slate-900 text-white hover:border-slate-400'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Moon className="w-4 h-4 text-indigo-400" />
                  <span className="text-xs font-bold text-slate-100">Precision Dark</span>
                </div>
                {theme === 'dark' && <Check className="w-4 h-4 text-emerald-400" />}
              </div>
              <div className="h-20 bg-[#0F0F12] rounded-lg border border-[#26262B] p-2 flex gap-2">
                <div className="w-12 bg-[#17171C] rounded h-full" />
                <div className="flex-1 space-y-1.5">
                  <div className="w-3/4 h-2 bg-slate-700 rounded" />
                  <div className="w-1/2 h-2 bg-slate-800 rounded" />
                  <div className="w-full h-5 bg-[#1C1C22] rounded border border-[#26262B]" />
                </div>
              </div>
              <p className="text-[11px] text-slate-400 mt-2">Surface: #17171C · Background: #0F0F12 · Accent: #6E63E8</p>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Notifications & System Audit */}
      {activeTab === 'notifications' && (
        <div className="space-y-6">
          <form onSubmit={handleSaveNotificationPreferences} className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <Bell className="w-5 h-5 text-[var(--primary-accent)]" />
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Activity & Delivery Notifications</h2>
                  <p className="text-xs text-slate-500">Configure which sprint events dispatch real-time badges and notifications.</p>
                </div>
              </div>

              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-semibold text-white bg-[var(--primary-accent)] hover:bg-[var(--accent-hover)] rounded-lg shadow-2xs transition-colors"
              >
                Save Preferences
              </button>
            </div>

            {notifyMsg && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{notifyMsg}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <label className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifyTaskAssigned}
                  onChange={e => setNotifyTaskAssigned(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <div className="font-semibold text-slate-900">Task Assignment Alerts</div>
                  <div className="text-[11px] text-slate-500">Notify when deliverables are assigned or re-allocated to you.</div>
                </div>
              </label>

              <label className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifyDisputeResolved}
                  onChange={e => setNotifyDisputeResolved(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <div className="font-semibold text-slate-900">Dispute & Invisible Work Outcomes</div>
                  <div className="text-[11px] text-slate-500">Alerts when filed mentoring/design claims are reviewed.</div>
                </div>
              </label>

              <label className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifyOverdueAlerts}
                  onChange={e => setNotifyOverdueAlerts(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <div className="font-semibold text-slate-900">Deadline & Overdue Invariant Warnings</div>
                  <div className="text-[11px] text-slate-500">Critical notifications when delivery milestones are breached.</div>
                </div>
              </label>

              <label className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifyGithubSync}
                  onChange={e => setNotifyGithubSync(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <div className="font-semibold text-slate-900">GitHub Webhook & Auto-Transition Sync</div>
                  <div className="text-[11px] text-slate-500">Alert when commits automatically move deliverables to Done.</div>
                </div>
              </label>
            </div>
          </form>

          {/* Immutable Audit Trail */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-blue-600" />
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Immutable System Audit Trail</h2>
                  <p className="text-xs text-slate-500">Every project modification, task state transition, and redistribution event is logged.</p>
                </div>
              </div>
              <span className="text-xs text-slate-400 font-mono">
                {auditLogs.length} audit records
              </span>
            </div>

            {loadingLogs ? (
              <div className="p-8 text-center text-xs text-slate-400 animate-pulse">
                Loading security audit records...
              </div>
            ) : auditLogs.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                No audit records generated in this session.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      <th className="py-2.5 px-4">Timestamp</th>
                      <th className="py-2.5 px-4">Action Event</th>
                      <th className="py-2.5 px-4">Actor</th>
                      <th className="py-2.5 px-4">Entity Type</th>
                      <th className="py-2.5 px-4">Details & Payload</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono">
                    {auditLogs.map((log: any) => (
                      <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-2.5 px-4 text-slate-500 text-[11px] whitespace-nowrap">
                          {log.created_at || log.timestamp || 'Just now'}
                        </td>
                        <td className="py-2.5 px-4">
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                            {log.action}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 font-sans text-slate-900 font-medium">
                          {log.user_name || log.user_id || 'System Engine'}
                        </td>
                        <td className="py-2.5 px-4 text-slate-500 font-sans">
                          {log.entity_type || 'Task'}
                        </td>
                        <td className="py-2.5 px-4 text-slate-700 font-sans text-[11px] truncate max-w-xs">
                          {log.details || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: Data Retention & Backup */}
      {activeTab === 'backup' && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <Database className="w-5 h-5 text-blue-600" />
              <div>
                <h2 className="text-sm font-bold text-slate-900">Database Engine & Persistence Disaster Recovery</h2>
                <p className="text-xs text-slate-500">Persistent SQLite storage with foreign key constraints and point-in-time snapshot exports.</p>
              </div>
            </div>

            <a
              href={api.getDatabaseBackupUrl()}
              download="pulse_database_backup.json"
              className="px-4 py-2 text-xs font-semibold text-slate-800 hover:text-slate-950 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg shadow-2xs transition-colors flex items-center gap-2"
            >
              <Download className="w-3.5 h-3.5 text-blue-600" />
              <span>Download PULSE Database Snapshot</span>
            </a>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
              <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Deterministic Demo Data Seeder</span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Resets the database and populates 3 projects, 4 team members, and realistic deliverable tasks with varying priorities and deadlines to test all risk invariants.
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={onReseedData}
                  disabled={isReseeding}
                  className="px-4 py-2 text-xs font-semibold text-slate-800 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg shadow-2xs transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isReseeding ? 'animate-spin text-blue-600' : ''}`} />
                  <span>{isReseeding ? 'Resetting...' : 'Reset & Seed Demo DB'}</span>
                </button>
              </div>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
              <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <Terminal className="w-4 h-4 text-blue-600" />
                <span>Production Deployment Command</span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Single command builds Vite React bundle and serves the full-stack applet on port 3000.
              </p>
              <div className="flex items-center gap-2 pt-2">
                <code className="text-xs font-mono bg-white px-2.5 py-1.5 rounded border border-slate-200 text-slate-800">
                  npm run build && node server.ts
                </code>
                <button
                  type="button"
                  onClick={copyCommands}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded hover:bg-slate-50 transition-colors flex items-center gap-1"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copiedCmd ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
