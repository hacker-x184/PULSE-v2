import React from 'react';
import {
  LayoutDashboard,
  FolderKanban,
  CheckSquare,
  Users,
  BarChart3,
  ShieldAlert,
  FileText,
  Settings,
  Database,
  RefreshCw,
  Sparkles,
  ShieldCheck,
  Plus,
  LogIn,
  Activity,
  FileCode,
  ExternalLink,
  MessageSquare
} from 'lucide-react';
import { User } from '../../types';
import { Avatar } from '../common/Avatar';

export type ActivePage =
  | 'dashboard'
  | 'projects'
  | 'tasks'
  | 'team'
  | 'collaboration'
  | 'contributions'
  | 'risks'
  | 'reports'
  | 'settings';

interface SidebarProps {
  activePage: ActivePage;
  onNavigate: (page: ActivePage) => void;
  onOpenAI: () => void;
  onReseedData: () => void;
  isReseeding: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  currentUser: User | null;
  onOpenAuth: (mode?: 'login' | 'register') => void;
  onOpenProfile?: () => void;
  onCreateTask: () => void;
  onCreateProject?: () => void;
  onOpenFrontPage?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activePage,
  onNavigate,
  onOpenAI,
  onReseedData,
  isReseeding,
  mobileOpen,
  onCloseMobile,
  currentUser,
  onOpenAuth,
  onOpenProfile,
  onCreateTask,
  onCreateProject,
  onOpenFrontPage
}) => {
  const navItems = [
    { id: 'dashboard' as ActivePage, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'projects' as ActivePage, label: 'Projects', icon: FolderKanban },
    { id: 'tasks' as ActivePage, label: 'Task Management', icon: CheckSquare },
    { id: 'team' as ActivePage, label: 'Team Directory', icon: Users },
    { id: 'collaboration' as ActivePage, label: 'Collaboration & Comms', icon: MessageSquare },
    { id: 'contributions' as ActivePage, label: 'Contribution Analysis', icon: BarChart3 },
    { id: 'risks' as ActivePage, label: 'Risk Analysis', icon: ShieldAlert },
    { id: 'reports' as ActivePage, label: 'Reports & Export', icon: FileText },
    { id: 'settings' as ActivePage, label: 'Settings', icon: Settings },
  ];

  const handleNavClick = (id: ActivePage) => {
    onNavigate(id);
    onCloseMobile();
  };

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/50 md:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed top-0 bottom-0 left-0 z-40 w-64 bg-[var(--bg-sidebar)] text-[var(--text-secondary)] flex flex-col border-r border-[var(--border-color)] transition-all duration-200 ease-in-out md:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Clean Static Brand Header */}
        <div className="h-16 flex items-center px-4 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[var(--primary-accent)] flex items-center justify-center text-white font-bold text-sm tracking-wider shadow-xs shrink-0">
              P
            </div>
            <div className="min-w-0">
              <span className="text-base font-bold tracking-tight text-[var(--text-primary)]">
                PULSE
              </span>
              <div className="text-[11px] text-[var(--text-secondary)] font-medium">
                Engineering Workspace
              </div>
            </div>
          </div>
        </div>

        {/* Navigation list */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Main Navigation">
          <div className="px-3 pb-2 text-[11px] font-semibold text-[var(--text-muted)] tracking-wider">
            WORKSPACE
          </div>
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-[var(--primary-accent)] text-white shadow-xs font-semibold'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-sidebar-hover)]'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-[var(--text-secondary)]'}`} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Bottom actions & User status */}
        <div className="p-3 border-t border-[var(--border-color)] space-y-2">
          {/* Active user preview in sidebar footer */}
          <div
            onClick={() => {
              if (currentUser && onOpenProfile) {
                onOpenProfile();
              } else {
                onOpenAuth('login');
              }
            }}
            className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[var(--surface-primary)] border border-[var(--border-color)] cursor-pointer hover:bg-[var(--bg-sidebar-hover)] transition-colors shadow-2xs"
            title={currentUser ? "Click to edit your user profile" : "Click to sign in"}
          >
            <div className="flex items-center gap-2 truncate">
              <Avatar
                name={currentUser?.name || 'Zaid Tested'}
                avatarUrl={currentUser?.avatar_url}
                size="sm"
              />
              <div className="truncate">
                <div className="text-xs font-medium text-[var(--text-primary)] truncate">
                  {currentUser?.name || 'Zaid Tested'}
                </div>
                <div className="text-[9px] text-[var(--text-secondary)] truncate">
                  {currentUser?.role || 'Team Leader'}
                </div>
              </div>
            </div>
            <span className="text-[9px] font-mono text-[var(--primary-accent)]">Profile</span>
          </div>

          {/* Quick Reseed DB action */}
          <button
            type="button"
            onClick={onReseedData}
            disabled={isReseeding}
            title="Reset database to realistic test baseline"
            className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-sidebar-hover)] rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <RefreshCw className={`w-3.5 h-3.5 ${isReseeding ? 'animate-spin text-[var(--primary-accent)]' : ''}`} />
              <span>{isReseeding ? 'Resetting...' : 'Reset Demo DB'}</span>
            </div>
            <Database className="w-3 h-3 text-[var(--text-muted)]" />
          </button>
        </div>
      </aside>
    </>
  );
};
