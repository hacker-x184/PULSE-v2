import React, { useState, useEffect } from 'react';
import {
  FileText,
  Download,
  Filter,
  Calendar,
  AlertTriangle,
  FolderKanban,
  CheckCircle2,
  Users
} from 'lucide-react';
import { Project, ProgressReportItem, OverdueReportItem } from '../../types';
import { api } from '../../api/client';

interface ReportsPageProps {
  projects: Project[];
  selectedProjectId: string;
  onSelectProject: (id: string) => void;
}

export const ReportsPage: React.FC<ReportsPageProps> = ({
  projects,
  selectedProjectId,
  onSelectProject
}) => {
  const [reportType, setReportType] = useState<'progress' | 'overdue' | 'contribution' | 'risk'>('progress');
  const [projectIdFilter, setProjectIdFilter] = useState(selectedProjectId || '');
  const [progressData, setProgressData] = useState<ProgressReportItem[]>([]);
  const [overdueData, setOverdueData] = useState<OverdueReportItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    loadReportData();
  }, [reportType, projectIdFilter]);

  const loadReportData = async () => {
    setIsLoading(true);
    try {
      if (reportType === 'progress') {
        const res = await api.getProgressReport(projectIdFilter || undefined);
        setProgressData(res);
      } else if (reportType === 'overdue') {
        const res = await api.getOverdueReport(projectIdFilter || undefined);
        setOverdueData(res);
      }
    } catch (err: any) {
      console.error('Failed to load report data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportCsv = () => {
    const url = api.getExportCsvUrl(reportType, projectIdFilter || undefined);
    window.location.href = url;
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Compliance & Delivery Reports
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Audit project pacing, overdue milestones, and export RFC 4180-compliant CSV datasets.
          </p>
        </div>

        <button
          type="button"
          onClick={handleExportCsv}
          className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-2xs transition-colors self-start sm:self-auto"
        >
          <Download className="w-4 h-4" />
          <span>Export {reportType.toUpperCase()} CSV</span>
        </button>
      </div>

      {/* Report Controls: Tab switch & Project filter */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
        {/* Tab switcher */}
        <div className="flex items-center p-1 bg-slate-100 rounded-lg overflow-x-auto">
          {[
            { id: 'progress', label: 'Progress Report' },
            { id: 'overdue', label: 'Overdue Deliverables' },
            { id: 'contribution', label: 'Team Contribution' },
            { id: 'risk', label: 'Risk Analysis' },
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setReportType(tab.id as any)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                reportType === tab.id
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Project Filter */}
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400 shrink-0" />
          <select
            value={projectIdFilter}
            onChange={e => setProjectIdFilter(e.target.value)}
            aria-label="Filter report by project"
            className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Projects</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Report Content Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-xs text-slate-400 animate-pulse">
            Generating compliance ledger...
          </div>
        ) : reportType === 'progress' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Project Milestone</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Deadline</th>
                  <th className="py-3 px-4 text-center">Total Tasks</th>
                  <th className="py-3 px-4 text-center">Completed</th>
                  <th className="py-3 px-4 text-center">Overdue</th>
                  <th className="py-3 px-4 text-center">High Priority</th>
                  <th className="py-3 px-4">Completion %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {progressData.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-slate-400">
                      No project progress records match the criteria.
                    </td>
                  </tr>
                ) : (
                  progressData.map(p => (
                    <tr key={p.project_id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4 font-semibold text-slate-900">{p.project_name}</td>
                      <td className="py-3 px-4 font-mono text-[11px]">{p.status}</td>
                      <td className="py-3 px-4 font-mono text-slate-600">{p.deadline || 'N/A'}</td>
                      <td className="py-3 px-4 text-center font-mono tabular-nums">{p.total_tasks}</td>
                      <td className="py-3 px-4 text-center font-mono tabular-nums text-emerald-600 font-bold">{p.completed_tasks}</td>
                      <td className="py-3 px-4 text-center font-mono tabular-nums">
                        <span className={p.overdue_tasks > 0 ? 'text-rose-600 font-bold' : 'text-slate-400'}>
                          {p.overdue_tasks}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center font-mono tabular-nums text-slate-700">{p.high_priority_tasks}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-16 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                            <div className="bg-blue-600 h-1.5 rounded-full" style={{ width: `${p.completion_percentage}%` }} />
                          </div>
                          <span className="font-mono font-medium text-slate-800">{p.completion_percentage}%</span>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : reportType === 'overdue' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Overdue Deliverable</th>
                  <th className="py-3 px-4">Project</th>
                  <th className="py-3 px-4">Priority</th>
                  <th className="py-3 px-4">Scheduled Deadline</th>
                  <th className="py-3 px-4">Assigned Member</th>
                  <th className="py-3 px-4">Current Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {overdueData.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                      <div>Zero overdue deliverables. All project milestones are currently on track.</div>
                    </td>
                  </tr>
                ) : (
                  overdueData.map(item => (
                    <tr key={item.task_id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4 font-semibold text-slate-900">{item.title}</td>
                      <td className="py-3 px-4 text-slate-600">{item.project_name}</td>
                      <td className="py-3 px-4 font-mono">
                        <span className="text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                          {item.priority}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-rose-600 font-semibold">{item.due_date}</td>
                      <td className="py-3 px-4 text-slate-700">{item.assignee_name}</td>
                      <td className="py-3 px-4 font-mono text-slate-500">{item.status}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-xs text-slate-600 space-y-2">
            <FileText className="w-8 h-8 text-blue-600 mx-auto" />
            <div className="font-semibold text-slate-800">
              {reportType === 'contribution' ? 'Team Contribution Summary' : 'Project Risk Audit Report'}
            </div>
            <p className="max-w-md mx-auto text-slate-500">
              This report compiles granular records across all active projects. Click below to download the RFC 4180 CSV export file formatted directly for spreadsheet analysis.
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={handleExportCsv}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors inline-flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download {reportType.toUpperCase()} Dataset (.CSV)</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
