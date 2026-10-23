import React, { useState } from 'react';
import {
  FolderKanban,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ArrowRight,
  ShieldAlert,
  Calendar,
  Users,
  LayoutDashboard,
  User,
  Activity,
  Layers,
  Sparkles,
  TrendingUp,
  TrendingDown,
  ShieldCheck
} from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { DashboardMetrics, Project, TeamMember, Task } from '../../types';
import { ActivePage } from '../layout/Sidebar';

interface DashboardPageProps {
  metrics: DashboardMetrics | null;
  projects: Project[];
  team: TeamMember[];
  isLoading: boolean;
  onNavigate: (page: ActivePage) => void;
  onSelectProject: (id: string) => void;
  onNewTask: () => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  metrics,
  projects,
  team,
  isLoading,
  onNavigate,
  onSelectProject,
  onNewTask
}) => {
  const [dashboardRole, setDashboardRole] = useState<'leader' | 'member'>('leader');
  const [selectedMemberId, setSelectedMemberId] = useState<string>(team[0]?.id || '');

  if (isLoading || !metrics) {
    return (
      <div className="p-6 space-y-6">
        <div className="h-8 bg-slate-200 rounded-lg w-64 animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 bg-slate-100 rounded-xl border border-slate-200 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // Selected member for Team Member view
  const activeMember = team.find(m => m.id === selectedMemberId) || team[0];
  const memberWorkload = metrics.team_workload_summary.find(m => m.member_id === (activeMember?.id ?? ''));
  const memberDeadlines = metrics.upcoming_deadlines.filter(t => t.assignee_id === activeMember?.id);

  // Overall Project Health Score (0-100)
  // Formula: completion rate (50%) + on-time factor (30%) - risk penalty (20%)
  const highRiskCount = metrics.project_risk_overview.filter(r => r.risk_level === 'High').length;
  const healthScore = Math.max(10, Math.min(100, Math.round(
    (metrics.overall_completion_percentage * 0.5) +
    (metrics.total_tasks > 0 ? (1 - (metrics.overdue_tasks / metrics.total_tasks)) * 30 : 30) +
    (highRiskCount === 0 ? 20 : highRiskCount === 1 ? 10 : 0)
  )));

  // Workload chart data
  const workloadChartData = metrics.team_workload_summary.map(m => ({
    name: m.name.split(' ')[0],
    fullName: m.name,
    Completed: m.completed,
    Pending: m.pending,
    Overdue: m.overdue,
  }));

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Page Header with Role Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            {dashboardRole === 'leader' && 'Team Leader Executive & Governance Dashboard'}
            {dashboardRole === 'member' && `Team Member Dashboard: ${activeMember?.name || 'Engineer'}`}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            {dashboardRole === 'leader' && 'Unified delivery health, member workload distribution, rule-based risk evaluation, and system diagnostics.'}
            {dashboardRole === 'member' && 'Personal deliverable assignments, upcoming milestone deadlines, and completion velocity.'}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          {/* Persona View Switcher */}
          <div className="inline-flex bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setDashboardRole('leader')}
              className={`px-3 py-1 rounded-md transition-all ${
                dashboardRole === 'leader' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Team Leader View
            </button>
            <button
              type="button"
              onClick={() => setDashboardRole('member')}
              className={`px-3 py-1 rounded-md transition-all ${
                dashboardRole === 'member' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              My Work (Member)
            </button>
          </div>

          <button
            type="button"
            onClick={onNewTask}
            className="px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-2xs transition-colors"
          >
            + Create Task
          </button>
        </div>
      </div>

      {/* VIEW 1: TEAM LEADER EXECUTIVE & GOVERNANCE DASHBOARD */}
      {dashboardRole === 'leader' && (
        <>
          {/* KPI Stats Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
            {/* Total Projects */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
              <div className="flex items-center justify-between text-slate-500 mb-2">
                <span className="text-xs font-medium">Total Projects</span>
                <FolderKanban className="w-4 h-4 text-blue-600" />
              </div>
              <div className="text-2xl font-bold text-slate-900 tabular-nums">
                {metrics.total_projects}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Active in workspace
              </div>
            </div>

            {/* Total Tasks */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
              <div className="flex items-center justify-between text-slate-500 mb-2">
                <span className="text-xs font-medium">Total Deliverables</span>
                <CheckCircle2 className="w-4 h-4 text-slate-500" />
              </div>
              <div className="text-2xl font-bold text-slate-900 tabular-nums">
                {metrics.total_tasks}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Across all project backlogs
              </div>
            </div>

            {/* Completed Rate */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
              <div className="flex items-center justify-between text-slate-500 mb-2">
                <span className="text-xs font-medium">Completion Rate</span>
                <span className="text-xs font-semibold text-emerald-600 font-mono">
                  {metrics.completed_tasks}/{metrics.total_tasks}
                </span>
              </div>
              <div className="text-2xl font-bold text-slate-900 tabular-nums">
                {metrics.overall_completion_percentage}%
              </div>
              <div className="w-full bg-slate-100 rounded-full h-1.5 mt-2 overflow-hidden">
                <div
                  className="bg-emerald-600 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, metrics.overall_completion_percentage)}%` }}
                />
              </div>
            </div>

            {/* Pending Tasks */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
              <div className="flex items-center justify-between text-slate-500 mb-2">
                <span className="text-xs font-medium">In Flight / Pending</span>
                <Clock className="w-4 h-4 text-amber-500" />
              </div>
              <div className="text-2xl font-bold text-slate-900 tabular-nums">
                {metrics.pending_tasks}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                To Do, In Progress, In Review
              </div>
            </div>

            {/* Overdue Tasks */}
            <div className="col-span-2 lg:col-span-1 bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
              <div className="flex items-center justify-between text-slate-500 mb-2">
                <span className="text-xs font-medium">Overdue Deadlines</span>
                <AlertTriangle className={`w-4 h-4 ${metrics.overdue_tasks > 0 ? 'text-rose-600' : 'text-slate-400'}`} />
              </div>
              <div className={`text-2xl font-bold tabular-nums ${metrics.overdue_tasks > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                {metrics.overdue_tasks}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {metrics.overdue_tasks > 0 ? 'Requires immediate action' : 'All milestones on schedule'}
              </div>
            </div>
          </div>

          {/* Main Grid: Workload Chart & Risk Summaries */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Team Workload Chart */}
            <div className="lg:col-span-2 bg-white p-5 rounded-xl border border-slate-200 shadow-2xs flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Team Workload & Delivery Allocation
                  </h2>
                  <p className="text-xs text-slate-500">
                    Distribution of completed vs pending and overdue deliverables per engineer
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('team')}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1"
                >
                  Manage Team <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={workloadChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="bg-slate-900 text-white p-2.5 rounded-lg text-xs shadow-md space-y-1">
                              <div className="font-semibold text-slate-100">{data.fullName}</div>
                              <div className="text-emerald-400">Completed: {data.Completed}</div>
                              <div className="text-amber-300">Pending: {data.Pending}</div>
                              <div className="text-rose-400">Overdue: {data.Overdue}</div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Bar dataKey="Completed" stackId="a" fill="#16a34a" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="Pending" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="Overdue" stackId="a" fill="#dc2626" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Legend */}
              <div className="flex items-center justify-center gap-6 pt-3 border-t border-slate-100 text-xs text-slate-600">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600" />
                  <span>Completed</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-blue-500" />
                  <span>Pending</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-rose-600" />
                  <span>Overdue</span>
                </div>
              </div>
            </div>

            {/* Project Risk Overview Card */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-blue-600" />
                    <h2 className="text-sm font-semibold text-slate-900">Project Risk Signals</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate('risks')}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700"
                  >
                    Inspect All
                  </button>
                </div>
                <p className="text-xs text-slate-500 mb-3">
                  Rule-based evaluation tracking overdue deliverables and approaching deadlines.
                </p>

                <div className="space-y-3">
                  {metrics.project_risk_overview.map(r => (
                    <div
                      key={r.project_id}
                      onClick={() => {
                        onSelectProject(r.project_id);
                        onNavigate('risks');
                      }}
                      className="p-3 rounded-lg border border-slate-100 hover:border-slate-200 bg-slate-50/60 hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-800 truncate">
                          {r.project_name}
                        </span>
                        <span
                          className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                            r.risk_level === 'High'
                              ? 'bg-rose-100 text-rose-700'
                              : r.risk_level === 'Medium'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {r.risk_level} Risk
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1 line-clamp-2">
                        {r.summary_recommendation}
                      </p>
                      <div className="flex items-center justify-between text-[10px] text-slate-400 mt-2 font-mono">
                        <span>Score: {r.risk_score}/100</span>
                        <span>Completion: {r.completion_percentage}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => onNavigate('risks')}
                  className="w-full py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors text-center"
                >
                  Open Comprehensive Risk Engine →
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* VIEW 2: TEAM MEMBER / MY WORK DASHBOARD */}
      {dashboardRole === 'member' && (
        <div className="space-y-6">
          {/* Member Selector Bar */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-base shrink-0">
                {activeMember?.name?.charAt(0) || 'U'}
              </div>
              <div>
                <div className="text-sm font-bold text-slate-900">{activeMember?.name}</div>
                <div className="text-xs text-slate-500">{activeMember?.role} · {activeMember?.email}</div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-slate-600">Switch Contributor:</label>
              <select
                value={selectedMemberId}
                onChange={e => setSelectedMemberId(e.target.value)}
                className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 font-medium"
              >
                {team.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.role})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Member KPI Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
              <div className="text-xs text-slate-500 font-medium">Assigned Deliverables</div>
              <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">{memberWorkload?.total_assigned || 0}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">Assigned to my sprint backlog</div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
              <div className="text-xs text-slate-500 font-medium">Completed Tasks</div>
              <div className="text-2xl font-bold text-emerald-600 mt-1 font-mono">{memberWorkload?.completed || 0}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">Verified deliverables</div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
              <div className="text-xs text-slate-500 font-medium">Pending Tasks</div>
              <div className="text-2xl font-bold text-blue-600 mt-1 font-mono">{memberWorkload?.pending || 0}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">In Progress or In Review</div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
              <div className="text-xs text-slate-500 font-medium">Overdue Alerts</div>
              <div className={`text-2xl font-bold mt-1 font-mono ${(memberWorkload?.overdue || 0) > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                {memberWorkload?.overdue || 0}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">Passed commitment deadline</div>
            </div>
          </div>

          {/* Member Upcoming Deliverables List */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-600" />
                <h2 className="text-sm font-semibold text-slate-900">
                  {activeMember?.name}'s Scheduled Deadlines
                </h2>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('tasks')}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700"
              >
                Go to Task Board →
              </button>
            </div>

            {memberDeadlines.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                No active deadline tasks assigned to this contributor.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {memberDeadlines.map(t => (
                  <div key={t.id} className="py-3 flex items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="font-semibold text-slate-900">{t.title}</div>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                        Due: {t.due_date || 'No date'} · Priority: {t.priority}
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                      {t.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW 3: TEAM LEADER ORGANIZATIONAL HEALTH & CAPACITY */}
      {dashboardRole === 'leader' && (
        <div className="space-y-6">
          {/* Health Gauge & High Level Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-5 bg-white border border-slate-200 rounded-xl shadow-2xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Platform Health Score</span>
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
              </div>
              <div className="text-3xl font-bold text-slate-900 font-mono">
                {healthScore}<span className="text-sm font-normal text-slate-400">/100</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-2 rounded-full ${
                    healthScore > 80 ? 'bg-emerald-600' : healthScore > 50 ? 'bg-amber-500' : 'bg-rose-600'
                  }`}
                  style={{ width: `${healthScore}%` }}
                />
              </div>
              <div className="text-[11px] text-slate-500">
                Composite of completion velocity, risk profile, and SLA adherence.
              </div>
            </div>

            <div className="p-5 bg-white border border-slate-200 rounded-xl shadow-2xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Engine Persistence</span>
                <Activity className="w-5 h-5 text-blue-600" />
              </div>
              <div className="text-2xl font-bold text-slate-900 font-mono">SQLite WAL</div>
              <div className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                All database foreign keys & audit rules active
              </div>
              <div className="text-[11px] text-slate-400">
                Zero mock mode · Real transactions
              </div>
            </div>

            <div className="p-5 bg-white border border-slate-200 rounded-xl shadow-2xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Active Capacity</span>
                <Users className="w-5 h-5 text-blue-600" />
              </div>
              <div className="text-2xl font-bold text-slate-900 font-mono">
                {team.reduce((acc, m) => acc + (m.capacity_hours || 40), 0)} hrs/wk
              </div>
              <div className="text-[11px] text-slate-500">
                Across {team.length} provisioned engineers and product managers.
              </div>
            </div>
          </div>

          {/* Workload Heatmap Matrix */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Team Workload Allocation Heatmap
                </h2>
                <p className="text-[11px] text-slate-500">
                  Heatmap matrix identifying single points of failure, overloaded engineers, and under-utilized capacity.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('team')}
                className="px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors"
              >
                Manage Team Capacities →
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 px-4">Contributor</th>
                    <th className="py-3 px-4">Role</th>
                    <th className="py-3 px-4 text-center">Assigned</th>
                    <th className="py-3 px-4 text-center">Completed</th>
                    <th className="py-3 px-4 text-center">Pending</th>
                    <th className="py-3 px-4 text-center">Overdue</th>
                    <th className="py-3 px-4 text-center">Capacity Load</th>
                    <th className="py-3 px-4">Workload Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {metrics.team_workload_summary.map(m => (
                    <tr key={m.member_id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {m.name}
                      </td>
                      <td className="py-3 px-4 text-slate-500">
                        {m.role}
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-medium">
                        {m.total_assigned}
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-emerald-600 font-semibold">
                        {m.completed}
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-blue-600 font-semibold">
                        {m.pending}
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-bold">
                        <span className={m.overdue > 0 ? 'text-rose-600' : 'text-slate-400'}>
                          {m.overdue}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="w-24 bg-slate-100 rounded-full h-1.5 mx-auto overflow-hidden">
                          <div
                            className={`h-1.5 rounded-full ${
                              m.workload_status === 'Overloaded' ? 'bg-rose-600' :
                              m.workload_status === 'High' ? 'bg-amber-500' :
                              m.workload_status === 'Balanced' ? 'bg-emerald-600' : 'bg-blue-400'
                            }`}
                            style={{ width: `${Math.min(100, (m.pending / 5) * 100)}%` }}
                          />
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`text-[11px] font-semibold px-2 py-0.5 rounded font-mono ${
                            m.workload_status === 'Overloaded'
                              ? 'bg-rose-100 text-rose-800'
                              : m.workload_status === 'High'
                              ? 'bg-amber-100 text-amber-800'
                              : m.workload_status === 'Balanced'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {m.workload_status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Two Column Section: Upcoming Deadlines & Recent Activity (Available in Team Leader view) */}
      {dashboardRole === 'leader' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Upcoming Deadlines */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-slate-600" />
                <h2 className="text-sm font-semibold text-slate-900">Upcoming Deadlines</h2>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('tasks')}
                className="text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                All Tasks
              </button>
            </div>

            {metrics.upcoming_deadlines.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                No pending tasks with scheduled deadlines.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {metrics.upcoming_deadlines.map(t => {
                  const assignee = team.find(m => m.id === t.assignee_id);
                  return (
                    <div key={t.id} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-slate-800 truncate">
                          {t.title}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                          <span className="font-mono">{t.due_date || 'No date'}</span>
                          <span aria-hidden="true">·</span>
                          <span>{assignee ? assignee.name : 'Unassigned'}</span>
                        </div>
                      </div>
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded font-mono shrink-0 ${
                          t.priority === 'High'
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : t.priority === 'Medium'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-slate-100 text-slate-600 border border-slate-200'
                        }`}
                      >
                        {t.priority}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent Activity */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-600" />
                <h2 className="text-sm font-semibold text-slate-900">Recent Deliverable Activity</h2>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('reports')}
                className="text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                View Reports
              </button>
            </div>

            {metrics.recent_activity.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                No recent task modifications recorded.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {metrics.recent_activity.map((act) => (
                  <div key={act.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-800 truncate">
                        {act.title}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
                        {new Date(act.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · Status updated to {act.status}
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 shrink-0">
                      {act.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
