import React, { useState, useRef, useEffect } from 'react';
import {
  Menu,
  Sparkles,
  Folder,
  ChevronDown,
  User as UserIcon,
  LogIn,
  UserPlus,
  LogOut,
  ShieldCheck,
  Github,
  Crown,
  Bell,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  FileCode,
  Check,
  X,
  ExternalLink,
  Sun,
  Moon
} from 'lucide-react';
import { Avatar } from '../common/Avatar';
import { Project, User, AppNotification } from '../../types';
import { api } from '../../api/client';

interface TopBarProps {
  projects: Project[];
  selectedProjectId: string;
  onSelectProject: (id: string) => void;
  onOpenMobileMenu: () => void;
  onOpenAI: () => void;
  onCreateTask: () => void;
  currentUser: User | null;
  onOpenAuth: (mode?: 'login' | 'register') => void;
  onLogout: () => void;
  onOpenGitHub?: () => void;
  onOpenLeaderModal?: () => void;
  onOpenProfile?: () => void;
  onOpenInvitations?: () => void;
  onOpenRolePermissions?: () => void;
  onOpenFrontPage?: () => void;
  isGuestPreview?: boolean;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  projects,
  selectedProjectId,
  onSelectProject,
  onOpenMobileMenu,
  onOpenAI,
  onCreateTask,
  currentUser,
  onOpenAuth,
  onLogout,
  onOpenGitHub,
  onOpenLeaderModal,
  onOpenProfile,
  onOpenInvitations,
  onOpenRolePermissions,
  onOpenFrontPage,
  isGuestPreview,
  theme,
  onToggleTheme
}) => {
  const [internalTheme, setInternalTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('pulse_theme');
      if (saved === 'dark' || saved === 'light') return saved;
      if (document.documentElement.classList.contains('dark')) return 'dark';
    }
    return 'light';
  });

  const activeTheme = theme || internalTheme;

  const handleToggleTheme = () => {
    if (onToggleTheme) {
      onToggleTheme();
    } else {
      const next = activeTheme === 'dark' ? 'light' : 'dark';
      setInternalTheme(next);
      if (next === 'dark') {
        document.documentElement.classList.add('dark');
        document.documentElement.setAttribute('data-theme', 'dark');
      } else {
        document.documentElement.classList.remove('dark');
        document.documentElement.setAttribute('data-theme', 'light');
      }
      localStorage.setItem('pulse_theme', next);
    }
  };

  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const notifMenuRef = useRef<HTMLDivElement>(null);

  const currentProject = projects.find(p => p.id === selectedProjectId);

  // Load in-app notifications
  useEffect(() => {
    api.getNotifications()
      .then(res => setNotifications(res))
      .catch(() => {});
  }, [selectedProjectId]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
      if (notifMenuRef.current && !notifMenuRef.current.contains(event.target as Node)) {
        setIsNotifOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMarkNotifRead = async (id: string) => {
    try {
      await api.markNotificationRead(id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    } catch {}
  };

  const handleClearAllNotifs = async () => {
    try {
      await api.clearNotifications();
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    } catch {}
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const displayName = currentUser?.name || (isGuestPreview ? 'Guest Reviewer' : 'Zaid Tested');
  const displayEmail = currentUser?.email || (isGuestPreview ? 'guest@pulse.dev' : 'zaidtested@gmail.com');
  const displayRole = currentUser?.role || (isGuestPreview ? 'Guest Access' : 'Team Leader');
  const initials = displayName
    .split(' ')
    .map(n => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

  const handleExportCalendar = () => {
    const url = api.getCalendarExportUrl(selectedProjectId || undefined);
    window.location.href = url;
  };

  return (
    <header className="sticky top-0 z-30 h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4">
      {/* Zone 1: Mobile toggle & Breadcrumb/Project Selector */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Open mobile navigation"
          className="p-2 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 md:hidden"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Project Context Selector */}
        <div className="flex items-center gap-2">
          {onOpenFrontPage && (
            <button
              type="button"
              onClick={onOpenFrontPage}
              className="hidden sm:flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors cursor-pointer mr-1"
              title="Return to PULSE Home"
            >
              <span>PULSE</span>
              <span aria-hidden="true" className="text-slate-300">/</span>
            </button>
          )}

          <div className="relative inline-flex items-center">
            <Folder className="w-4 h-4 text-blue-600 absolute left-2.5 pointer-events-none" />
            <select
              value={selectedProjectId}
              onChange={(e) => onSelectProject(e.target.value)}
              aria-label="Filter active project"
              className="text-xs font-semibold text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg pl-8 pr-7 py-1.5 focus:outline-hidden focus:ring-2 focus:ring-blue-500 cursor-pointer transition-colors max-w-[140px] sm:max-w-[280px] truncate"
            >
              <option value="">All Projects ({projects.length})</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.key_prefix || 'EQX'}) {p.is_archived ? '[Archived]' : ''}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 pointer-events-none" />
          </div>

          {currentProject?.key_prefix && (
            <span className="hidden lg:inline-flex text-[11px] font-mono text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 font-bold">
              {currentProject.key_prefix}
            </span>
          )}
        </div>
      </div>

      {/* Zone 2 & 3: Fast Actions & User Profile */}
      <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
        {/* Export iCal Schedule */}
        <button
          type="button"
          onClick={handleExportCalendar}
          title="Export project deadlines and tasks to iCalendar (.ics)"
          className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors whitespace-nowrap"
        >
          <Calendar className="w-3.5 h-3.5 text-slate-600" />
          <span>Export iCal</span>
        </button>

        {/* Personal GitHub Integration button */}
        {onOpenGitHub && (
          <button
            type="button"
            onClick={onOpenGitHub}
            title="Connect your personal GitHub account"
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors whitespace-nowrap"
          >
            <Github className="w-3.5 h-3.5 text-slate-900" />
            <span className="hidden md:inline">GitHub Dev</span>
            <span className="md:hidden">GitHub</span>
          </button>
        )}

        {/* Project Leader Quick Access Button */}
        {onOpenLeaderModal && currentProject && (
          <button
            type="button"
            onClick={onOpenLeaderModal}
            title="Manage project team and leader settings"
            className="hidden sm:flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors whitespace-nowrap"
          >
            <Crown className="w-3.5 h-3.5 text-amber-600" />
            <span>Leader</span>
          </button>
        )}

        {/* In-app Notification Bell */}
        <div className="relative" ref={notifMenuRef}>
          <button
            type="button"
            onClick={() => setIsNotifOpen(!isNotifOpen)}
            className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            title="Notification Center (Blockers, Reviews, Disputes)"
            aria-label="Notification Center"
          >
            <Bell className="w-4 h-4 text-slate-700" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-rose-600 rounded-full ring-2 ring-white animate-pulse" />
            )}
          </button>

          {isNotifOpen && (
            <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-2 divide-y divide-slate-100 animate-in fade-in duration-150">
              <div className="px-4 py-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Bell className="w-4 h-4 text-blue-600" />
                  <span className="text-xs font-bold text-slate-900">Notifications & Alerts</span>
                  {unreadCount > 0 && (
                    <span className="px-1.5 py-0.2 bg-rose-100 text-rose-700 text-[10px] font-semibold rounded-full">
                      {unreadCount} new
                    </span>
                  )}
                </div>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAllNotifs}
                    className="text-[11px] text-blue-600 hover:text-blue-800 font-semibold cursor-pointer"
                  >
                    Mark all read
                  </button>
                )}
              </div>

              <div className="max-h-72 overflow-y-auto divide-y divide-slate-50">
                {notifications.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-400">
                    No active notifications
                  </div>
                ) : (
                  notifications.map(n => (
                    <div
                      key={n.id}
                      onClick={() => handleMarkNotifRead(n.id)}
                      className={`p-3 text-left transition-colors cursor-pointer ${
                        n.is_read ? 'bg-white opacity-70 hover:bg-slate-50' : 'bg-blue-50/50 hover:bg-blue-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-semibold text-xs text-slate-900 flex items-center gap-1.5">
                          {n.type === 'blocker' && <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />}
                          {n.type === 'review' && <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                          {n.type === 'dispute' && <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />}
                          <span>{n.title}</span>
                        </div>
                        <span className="text-[10px] text-slate-400 whitespace-nowrap">
                          {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-1 leading-snug">{n.message}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Guest Authentication Quick Actions */}
        {!currentUser && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onOpenAuth('login')}
              className="px-2.5 py-1 text-xs font-semibold text-slate-700 hover:text-slate-900 transition-colors whitespace-nowrap cursor-pointer"
            >
              Log In
            </button>
            <button
              type="button"
              onClick={() => onOpenAuth('register')}
              className="px-3 py-1 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-2xs transition-colors whitespace-nowrap cursor-pointer"
            >
              Register
            </button>
          </div>
        )}

        {/* Primary Action Button */}
        <button
          type="button"
          onClick={onCreateTask}
          className="flex items-center gap-1 px-2.5 sm:px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs transition-colors whitespace-nowrap cursor-pointer"
        >
          <span className="hidden sm:inline">+ New Issue</span>
          <span className="sm:hidden">+ Issue</span>
        </button>

        {/* Light / Dark Mode Precision Theme Toggle */}
        <button
          type="button"
          onClick={handleToggleTheme}
          title={activeTheme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          aria-label={activeTheme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer shrink-0"
        >
          {activeTheme === 'dark' ? (
            <Sun className="w-4 h-4 text-amber-400 hover:text-amber-300 transition-transform duration-200 rotate-0 hover:rotate-45" />
          ) : (
            <Moon className="w-4 h-4 text-slate-700 hover:text-indigo-600 transition-transform duration-200" />
          )}
        </button>

        {/* Interactive User Profile & Authentication Dropdown */}
        <div className="relative" ref={userMenuRef}>
          <button
            type="button"
            onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
            className="flex items-center gap-2 pl-2 sm:pl-3 border-l border-slate-200 hover:opacity-90 transition-opacity cursor-pointer group"
            title="User Profile and Authentication Menu"
          >
            <Avatar name={displayName} avatarUrl={currentUser?.avatar_url} size="sm" />
            <div className="hidden xl:block text-left">
              <div className="text-xs font-semibold text-slate-900 leading-tight flex items-center gap-1">
                <span>{displayName}</span>
                <ChevronDown className="w-3 h-3 text-slate-400 group-hover:text-slate-600" />
              </div>
              <div className="text-[10px] text-slate-500 font-mono truncate max-w-[140px]">
                {displayEmail}
              </div>
            </div>
          </button>

          {/* User Profile Dropdown Menu */}
          {isUserMenuOpen && (
            <div className="absolute right-0 mt-2 w-64 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-2 divide-y divide-slate-100 animate-in fade-in slide-in-from-top-2 duration-150">
              {/* Account Overview */}
              <div className="px-4 py-2.5">
                <div className="flex items-center gap-2 mb-1">
                  <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
                  <span className="text-xs font-bold text-slate-900">Signed In</span>
                </div>
                <div className="text-xs font-semibold text-slate-800">{displayName}</div>
                <div className="text-[11px] text-slate-500 font-mono truncate">{displayEmail}</div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded border ${
                    displayRole === 'Team Leader' || displayRole === 'Admin' || displayRole === 'Manager' || displayRole === 'Project Director'
                      ? 'text-amber-800 bg-amber-50 border-amber-200'
                      : 'text-slate-700 bg-slate-50 border-slate-200'
                  }`}>
                    {displayRole === 'Team Leader' || displayRole === 'Admin' || displayRole === 'Manager' || displayRole === 'Project Director' ? 'Team Leader Access' : 'Team Member'}
                  </span>
                </div>
              </div>

              {/* Profile & Identity Settings */}
              <div className="px-2 py-1.5 space-y-0.5">
                {onOpenProfile && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      onOpenProfile();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 hover:text-slate-900 rounded-lg transition-colors text-left"
                  >
                    <UserIcon className="w-3.5 h-3.5 text-blue-600" />
                    <span>My Profile & Credentials</span>
                  </button>
                )}

                {onOpenInvitations && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      onOpenInvitations();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 hover:text-slate-900 rounded-lg transition-colors text-left"
                  >
                    <UserPlus className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Team Invitations & Access</span>
                  </button>
                )}

                {onOpenRolePermissions && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      onOpenRolePermissions();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 hover:text-slate-900 rounded-lg transition-colors text-left"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Role Permissions (RBAC)</span>
                  </button>
                )}
              </div>

              {/* Personal GitHub Integration shortcut */}
              {onOpenGitHub && (
                <div className="px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      onOpenGitHub();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 hover:text-slate-900 rounded-lg transition-colors text-left"
                  >
                    <Github className="w-3.5 h-3.5 text-slate-800" />
                    <span>My Personal GitHub Account</span>
                  </button>
                </div>
              )}

              {/* Account Actions */}
              <div className="px-2 py-1.5 space-y-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setIsUserMenuOpen(false);
                    onOpenAuth('login');
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 hover:text-slate-900 rounded-lg transition-colors text-left"
                >
                  <LogIn className="w-3.5 h-3.5 text-blue-600" />
                  <span>Switch Account / Sign In</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsUserMenuOpen(false);
                    onOpenAuth('register');
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 hover:text-slate-900 rounded-lg transition-colors text-left"
                >
                  <UserPlus className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Register New User</span>
                </button>
              </div>

              {/* Return to Front Page */}
              {onOpenFrontPage && (
                <div className="px-2 py-1">
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      onOpenFrontPage();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 hover:text-slate-900 rounded-lg transition-colors text-left cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
                    <span>View Front Page</span>
                  </button>
                </div>
              )}

              {/* Logout */}
              <div className="px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setIsUserMenuOpen(false);
                    onLogout();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-rose-600 hover:bg-rose-50 rounded-lg transition-colors text-left cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5 text-rose-600" />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

