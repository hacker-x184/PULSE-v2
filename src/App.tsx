import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar, ActivePage } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { DashboardPage } from './components/dashboard/DashboardPage';
import { ProjectsPage } from './components/projects/ProjectsPage';
import { TasksPage } from './components/tasks/TasksPage';
import { TeamPage } from './components/team/TeamPage';
import { ContributionsPage } from './components/contributions/ContributionsPage';
import { RisksPage } from './components/risks/RisksPage';
import { ReportsPage } from './components/reports/ReportsPage';
import { SettingsPage } from './components/settings/SettingsPage';
import { AIAssistantDrawer } from './components/ai/AIAssistantDrawer';
import { Modal } from './components/common/Modal';
import { AuthModal } from './components/auth/AuthModal';
import { MemberGitHubModal } from './components/github/MemberGitHubModal';
import { ProjectLeaderModal } from './components/projects/ProjectLeaderModal';
import { UserProfileModal } from './components/auth/UserProfileModal';
import { RolePermissionsModal } from './components/auth/RolePermissionsModal';
import { TeamInvitationsModal } from './components/team/TeamInvitationsModal';
import { CollaborationPage } from './components/collaboration/CollaborationPage';
import { FrontPage } from './components/landing/FrontPage';
import { api } from './api/client';
import {
  Project,
  Task,
  TeamMember,
  DashboardMetrics,
  MemberContribution,
  ProjectRisk,
  TaskPriority,
  TaskStatus,
  User
} from './types';
import { AlertCircle, CheckCircle2, Sparkles } from 'lucide-react';

export default function App() {
  const [activePage, setActivePage] = useState<ActivePage>('dashboard');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isAIOpen, setIsAIOpen] = useState(false);
  const [isQuickCreateTaskOpen, setIsQuickCreateTaskOpen] = useState(false);

  // Per-member GitHub & Project Leader Modals
  const [isGitHubModalOpen, setIsGitHubModalOpen] = useState(false);
  const [isLeaderModalOpen, setIsLeaderModalOpen] = useState(false);

  // User Profile, RBAC & Invitations
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isInvitationsModalOpen, setIsInvitationsModalOpen] = useState(false);
  const [isPermissionsModalOpen, setIsPermissionsModalOpen] = useState(false);

  // Authentication & Guest State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isGuestPreview, setIsGuestPreview] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register'>('login');

  // Precision Minimalism Theme State (persisted via localStorage)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('pulse_theme');
      if (saved === 'dark' || saved === 'light') return saved;
      if (document.documentElement.classList.contains('dark')) return 'dark';
    }
    return 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.setAttribute('data-theme', 'dark');
    } else {
      root.classList.remove('dark');
      root.setAttribute('data-theme', 'light');
    }
    try {
      localStorage.setItem('pulse_theme', theme);
    } catch {}
  }, [theme]);

  const handleToggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  // Application Data States
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [contributions, setContributions] = useState<MemberContribution[]>([]);
  const [risks, setRisks] = useState<ProjectRisk[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isReseeding, setIsReseeding] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [oauthNotice, setOauthNotice] = useState<string | null>(null);

  // Check for GitHub OAuth callback query param
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('github_oauth') === 'connected') {
        setOauthNotice('GitHub account successfully authenticated & synchronized with your user profile!');
        window.history.replaceState({}, '', window.location.pathname);
        setTimeout(() => setOauthNotice(null), 6000);
      }
    } catch {
      // Ignore URL errors
    }
  }, []);

  // Quick Task Modal form fields
  const [quickTitle, setQuickTitle] = useState('');
  const [quickDescription, setQuickDescription] = useState('');
  const [quickProjectId, setQuickProjectId] = useState('');
  const [quickPriority, setQuickPriority] = useState<TaskPriority>('Medium');
  const [quickStatus, setQuickStatus] = useState<TaskStatus>('To Do');
  const [quickDueDate, setQuickDueDate] = useState('');
  const [quickAssigneeId, setQuickAssigneeId] = useState('');

  // Primary data loader
  const loadAllData = useCallback(async () => {
    try {
      setGlobalError(null);
      const [pRes, tRes, tmRes, mRes, cRes, rRes, meRes] = await Promise.all([
        api.getProjects(),
        api.getTasks(),
        api.getTeam(),
        api.getDashboard(selectedProjectId || undefined),
        api.getContributions(selectedProjectId || undefined),
        api.getRisks(selectedProjectId || undefined),
        api.getMe().catch(() => ({ user: null }))
      ]);

      setProjects(pRes);
      setTasks(tRes);
      setTeam(tmRes);
      setMetrics(mRes);
      setContributions(cRes);
      setRisks(rRes);
      if (meRes?.user) {
        setCurrentUser(meRes.user);
      }
    } catch (err: any) {
      console.error('Failed to load application data:', err);
      setGlobalError(err.message || 'Error loading platform records.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // Auth Actions
  const handleAuthSuccess = (user: User) => {
    setCurrentUser(user);
    setIsGuestPreview(false);
    setIsAuthModalOpen(false);
    loadAllData();
  };

  const handleLogout = () => {
    api.logout();
    setCurrentUser(null);
    setIsGuestPreview(false);
    setIsAuthModalOpen(false);
    setAuthModalMode('login');
  };

  const handleOpenAuth = (mode: 'login' | 'register' = 'login') => {
    setAuthModalMode(mode);
    setIsAuthModalOpen(true);
  };

  // Project Actions
  const handleCreateProject = async (data: Partial<Project>) => {
    await api.createProject(data);
    await loadAllData();
  };

  const handleUpdateProject = async (id: string, data: Partial<Project>) => {
    await api.updateProject(id, data);
    await loadAllData();
  };

  const handleDeleteProject = async (id: string) => {
    await api.deleteProject(id);
    if (selectedProjectId === id) {
      setSelectedProjectId('');
    }
    await loadAllData();
  };

  // Task Actions
  const handleCreateTask = async (data: Partial<Task>) => {
    await api.createTask(data);
    await loadAllData();
  };

  const handleUpdateTask = async (id: string, data: Partial<Task>) => {
    await api.updateTask(id, data);
    await loadAllData();
  };

  const handleDeleteTask = async (id: string) => {
    await api.deleteTask(id);
    await loadAllData();
  };

  // Team Actions
  const handleCreateMember = async (data: Partial<TeamMember>) => {
    await api.createTeamMember(data);
    await loadAllData();
  };

  const handleUpdateMember = async (id: string, data: Partial<TeamMember>) => {
    await api.updateTeamMember(id, data);
    await loadAllData();
  };

  const handleDeleteMember = async (id: string) => {
    await api.deleteTeamMember(id);
    await loadAllData();
  };

  // Reseed DB action
  const handleReseedData = async () => {
    setIsReseeding(true);
    try {
      await api.resetAndSeedData();
      await loadAllData();
    } catch (err: any) {
      alert(`Failed to reset database: ${err.message}`);
    } finally {
      setIsReseeding(false);
    }
  };

  // Quick Task Submit
  const handleQuickCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickTitle.trim() || !quickProjectId) return;
    try {
      await api.createTask({
        title: quickTitle.trim(),
        description: quickDescription.trim() || undefined,
        project_id: quickProjectId,
        priority: quickPriority,
        status: quickStatus,
        due_date: quickDueDate || undefined,
        assignee_id: quickAssigneeId || null
      });
      setIsQuickCreateTaskOpen(false);
      setQuickTitle('');
      setQuickDescription('');
      setQuickDueDate('');
      setQuickAssigneeId('');
      await loadAllData();
    } catch (err: any) {
      alert(`Error creating task: ${err.message}`);
    }
  };

  // Show Front / Landing Page when user starts website (if not logged in) or after logging out
  if (!currentUser && !isGuestPreview) {
    return (
      <div className="min-h-screen bg-[var(--bg-main)] text-[var(--text-primary)] font-sans transition-colors duration-200">
        <FrontPage
          onOpenAuth={handleOpenAuth}
          onExploreDemo={async () => {
            try {
              const res = await api.login({ email: 'zaidtested@gmail.com', password: 'password123' });
              setCurrentUser(res.user);
              setIsGuestPreview(false);
              await loadAllData();
            } catch {
              setIsGuestPreview(true);
            }
          }}
          theme={theme}
          onToggleTheme={handleToggleTheme}
        />

        {/* Global Authentication Modal triggered from Front Page buttons */}
        <AuthModal
          isOpen={isAuthModalOpen}
          onClose={() => setIsAuthModalOpen(false)}
          onAuthSuccess={handleAuthSuccess}
          initialMode={authModalMode}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-main)] text-[var(--text-primary)] flex flex-col antialiased transition-colors duration-200">
      {/* Left Sidebar */}
      <Sidebar
        activePage={activePage}
        onNavigate={setActivePage}
        onOpenAI={() => setIsAIOpen(true)}
        onReseedData={handleReseedData}
        isReseeding={isReseeding}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        currentUser={currentUser}
        onOpenAuth={handleOpenAuth}
        onOpenProfile={() => setIsProfileModalOpen(true)}
        onCreateTask={() => {
          setQuickProjectId(selectedProjectId || (projects[0]?.id ?? ''));
          setIsQuickCreateTaskOpen(true);
        }}
        onOpenFrontPage={() => setIsGuestPreview(false)}
      />

      {/* Main Workspace Frame (offset for md sidebar) */}
      <div className="md:pl-64 flex flex-col flex-1 min-w-0">
        {/* Top Header */}
        <TopBar
          projects={projects}
          selectedProjectId={selectedProjectId}
          onSelectProject={setSelectedProjectId}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onOpenAI={() => setIsAIOpen(true)}
          onCreateTask={() => {
            setQuickProjectId(selectedProjectId || (projects[0]?.id ?? ''));
            setIsQuickCreateTaskOpen(true);
          }}
          currentUser={currentUser}
          onOpenAuth={handleOpenAuth}
          onLogout={handleLogout}
          onOpenGitHub={() => setIsGitHubModalOpen(true)}
          onOpenLeaderModal={() => setIsLeaderModalOpen(true)}
          onOpenProfile={() => setIsProfileModalOpen(true)}
          onOpenInvitations={() => setIsInvitationsModalOpen(true)}
          onOpenRolePermissions={() => setIsPermissionsModalOpen(true)}
          onOpenFrontPage={() => setIsGuestPreview(false)}
          isGuestPreview={isGuestPreview}
          theme={theme}
          onToggleTheme={handleToggleTheme}
        />

        {/* Global Error Banner */}
        {globalError && (
          <div className="mx-4 sm:mx-6 mt-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs flex items-center justify-between gap-2 shadow-2xs">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{globalError}</span>
            </div>
            <button
              type="button"
              onClick={() => loadAllData()}
              className="text-xs font-semibold text-rose-700 hover:text-rose-900 underline shrink-0"
            >
              Retry
            </button>
          </div>
        )}

        {/* GitHub OAuth Connection Banner */}
        {oauthNotice && (
          <div className="mx-4 sm:mx-6 mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-xs flex items-center justify-between gap-2 shadow-2xs">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="font-medium">{oauthNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setOauthNotice(null)}
              className="text-xs text-emerald-700 hover:text-emerald-950 font-semibold"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Active Page View Container */}
        <main className="flex-1 pb-12">
          {activePage === 'dashboard' && (
            <DashboardPage
              metrics={metrics}
              projects={projects}
              team={team}
              isLoading={isLoading}
              onNavigate={setActivePage}
              onSelectProject={setSelectedProjectId}
              onNewTask={() => {
                setQuickProjectId(selectedProjectId || (projects[0]?.id ?? ''));
                setIsQuickCreateTaskOpen(true);
              }}
            />
          )}

          {activePage === 'projects' && (
            <ProjectsPage
              projects={projects}
              tasks={tasks}
              team={team}
              onSelectProject={setSelectedProjectId}
              onCreateProject={handleCreateProject}
              onUpdateProject={handleUpdateProject}
              onDeleteProject={handleDeleteProject}
              onNavigateToTasks={(pId) => {
                setSelectedProjectId(pId);
                setActivePage('tasks');
              }}
              onNavigateToMessages={(pId) => {
                setSelectedProjectId(pId);
                setActivePage('collaboration');
              }}
              onRefreshData={loadAllData}
            />
          )}

          {activePage === 'tasks' && (
            <TasksPage
              tasks={tasks}
              projects={projects}
              team={team}
              selectedProjectId={selectedProjectId}
              onSelectProject={setSelectedProjectId}
              onCreateTask={handleCreateTask}
              onUpdateTask={handleUpdateTask}
              onDeleteTask={handleDeleteTask}
              currentUser={currentUser}
              onRefreshData={loadAllData}
            />
          )}

          {activePage === 'team' && (
            <TeamPage
              team={team}
              projects={projects}
              tasks={tasks}
              onCreateMember={handleCreateMember}
              onUpdateMember={handleUpdateMember}
              onDeleteMember={handleDeleteMember}
              onRefreshData={loadAllData}
            />
          )}

          {activePage === 'collaboration' && (
            <CollaborationPage
              projects={projects}
              team={team}
              selectedProjectId={selectedProjectId}
              onSelectProject={setSelectedProjectId}
              currentUser={currentUser}
            />
          )}

          {activePage === 'contributions' && (
            <ContributionsPage
              contributions={contributions}
              projects={projects}
              selectedProjectId={selectedProjectId}
              onSelectProject={setSelectedProjectId}
              isLoading={isLoading}
              onRefreshData={loadAllData}
            />
          )}

          {activePage === 'risks' && (
            <RisksPage
              risks={risks}
              projects={projects}
              selectedProjectId={selectedProjectId}
              onSelectProject={setSelectedProjectId}
              onNavigateToTasks={(pId) => {
                setSelectedProjectId(pId);
                setActivePage('tasks');
              }}
              isLoading={isLoading}
            />
          )}

          {activePage === 'reports' && (
            <ReportsPage
              projects={projects}
              selectedProjectId={selectedProjectId}
              onSelectProject={setSelectedProjectId}
            />
          )}

          {activePage === 'settings' && (
            <SettingsPage
              projects={projects}
              selectedProjectId={selectedProjectId}
              onReseedData={handleReseedData}
              isReseeding={isReseeding}
              onRefreshData={loadAllData}
              currentUser={currentUser}
              theme={theme}
              onToggleTheme={handleToggleTheme}
              onOpenProfileModal={() => setIsProfileModalOpen(true)}
            />
          )}
        </main>
      </div>

      {/* Floating PULSE AI Assistant Action Button (Fixed Bottom-Right) */}
      <div className="fixed bottom-6 right-6 z-40">
        <button
          type="button"
          onClick={() => setIsAIOpen(prev => !prev)}
          title="Open PULSE AI Assistant"
          aria-label="Open PULSE AI Assistant"
          className="group flex items-center gap-2.5 px-4 py-3 bg-[var(--primary-accent)] hover:bg-[var(--accent-hover)] text-white font-semibold text-xs rounded-full shadow-lg hover:shadow-xl transition-all duration-200 transform hover:-translate-y-0.5 cursor-pointer ring-4 ring-white/10"
        >
          <Sparkles className="w-4 h-4 text-white group-hover:rotate-12 transition-transform duration-200" />
          <span className="hidden sm:inline">PULSE AI</span>
        </button>
      </div>

      {/* Grounded AI Assistant Drawer */}
      <AIAssistantDrawer
        isOpen={isAIOpen}
        onClose={() => setIsAIOpen(false)}
        selectedProjectId={selectedProjectId}
        projects={projects.map(p => ({ id: p.id, name: p.name }))}
        onSelectProject={(pId) => setSelectedProjectId(pId === 'all' ? '' : pId)}
      />

      {/* Global Quick Task Creation Modal */}
      <Modal
        isOpen={isQuickCreateTaskOpen}
        onClose={() => setIsQuickCreateTaskOpen(false)}
        title="Quick Deliverable Creation"
        subtitle="Add a task item directly to any project backlog."
      >
        <form onSubmit={handleQuickCreateSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Deliverable Title *
            </label>
            <input
              type="text"
              required
              value={quickTitle}
              onChange={e => setQuickTitle(e.target.value)}
              placeholder="e.g. Audit SQLite schema integrity invariants"
              className="w-full px-3 py-2 text-xs text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Description
            </label>
            <textarea
              rows={2}
              value={quickDescription}
              onChange={e => setQuickDescription(e.target.value)}
              placeholder="Brief details or testing criteria..."
              className="w-full px-3 py-2 text-xs text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Project *
              </label>
              <select
                required
                value={quickProjectId}
                onChange={e => setQuickProjectId(e.target.value)}
                className="w-full px-3 py-1.5 text-xs text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              >
                <option value="" disabled>Select project</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Assignee
              </label>
              <select
                value={quickAssigneeId}
                onChange={e => setQuickAssigneeId(e.target.value)}
                className="w-full px-3 py-1.5 text-xs text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Unassigned</option>
                {team.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.role})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Priority
              </label>
              <select
                value={quickPriority}
                onChange={e => setQuickPriority(e.target.value as TaskPriority)}
                className="w-full px-3 py-1.5 text-xs text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              >
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Status
              </label>
              <select
                value={quickStatus}
                onChange={e => setQuickStatus(e.target.value as TaskStatus)}
                className="w-full px-3 py-1.5 text-xs text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              >
                <option value="To Do">To Do</option>
                <option value="In Progress">In Progress</option>
                <option value="In Review">In Review</option>
                <option value="Done">Done</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Due Date
              </label>
              <input
                type="date"
                value={quickDueDate}
                onChange={e => setQuickDueDate(e.target.value)}
                className="w-full px-3 py-1.5 text-xs text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 font-mono"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsQuickCreateTaskOpen(false)}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              Create Deliverable
            </button>
          </div>
        </form>
      </Modal>

      {/* Enterprise Authentication Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthSuccess={handleAuthSuccess}
        initialMode={authModalMode}
      />

      {/* Per-Member Personal GitHub Integration Modal */}
      <MemberGitHubModal
        isOpen={isGitHubModalOpen}
        onClose={() => setIsGitHubModalOpen(false)}
        currentUser={currentUser}
        onProfileUpdated={loadAllData}
        selectedProjectId={selectedProjectId}
      />

      {/* Project Leader Teammates Management Modal */}
      {isLeaderModalOpen && (
        <ProjectLeaderModal
          isOpen={isLeaderModalOpen}
          onClose={() => setIsLeaderModalOpen(false)}
          project={projects.find(p => p.id === selectedProjectId) || projects[0] || null}
          team={team}
          currentUserId={currentUser?.id}
          onProjectUpdated={loadAllData}
        />
      )}

      {/* User Profile & Password Modal */}
      <UserProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        currentUser={currentUser}
        onProfileUpdated={(updatedUser) => {
          setCurrentUser(updatedUser);
          loadAllData();
        }}
      />

      {/* Team Invitations Modal */}
      <TeamInvitationsModal
        isOpen={isInvitationsModalOpen}
        onClose={() => setIsInvitationsModalOpen(false)}
        projects={projects}
        selectedProjectId={selectedProjectId}
      />

      {/* Role-Based Access Control (RBAC) Permissions Matrix */}
      <RolePermissionsModal
        isOpen={isPermissionsModalOpen}
        onClose={() => setIsPermissionsModalOpen(false)}
      />
    </div>
  );
}
