import React from 'react';
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Layers,
  ArrowRight,
  ExternalLink,
  ShieldCheck,
  Clock
} from 'lucide-react';
import { ProjectRisk, Project } from '../../types';

interface RisksPageProps {
  risks: ProjectRisk[];
  projects: Project[];
  selectedProjectId: string;
  onSelectProject: (id: string) => void;
  onNavigateToTasks: (projectId: string) => void;
  isLoading: boolean;
}

export const RisksPage: React.FC<RisksPageProps> = ({
  risks,
  projects,
  selectedProjectId,
  onSelectProject,
  onNavigateToTasks,
  isLoading
}) => {
  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="h-8 bg-slate-200 rounded w-64 animate-pulse" />
        <div className="h-64 bg-slate-100 rounded-xl border border-slate-200 animate-pulse" />
      </div>
    );
  }

  const highRiskCount = risks.filter(r => r.risk_level === 'High').length;
  const mediumRiskCount = risks.filter(r => r.risk_level === 'Medium').length;
  const lowRiskCount = risks.filter(r => r.risk_level === 'Low').length;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Transparent Project Risk Engine
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Rule-based risk diagnostic analyzing timeline compression, critical overdue bottlenecks, and resource gaps.
          </p>
        </div>
      </div>

      {/* KPI Severity Counters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-rose-200 shadow-2xs">
          <div className="flex items-center justify-between text-rose-600 mb-1">
            <span className="text-xs font-semibold">High Risk Projects</span>
            <AlertTriangle className="w-4 h-4 text-rose-600" />
          </div>
          <div className="text-2xl font-bold text-rose-700 tabular-nums">{highRiskCount}</div>
          <div className="text-[11px] text-slate-500 mt-1">
            Critical overdue blockers or imminent delivery deadline
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-amber-200 shadow-2xs">
          <div className="flex items-center justify-between text-amber-700 mb-1">
            <span className="text-xs font-semibold">Medium Risk Projects</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-bold text-amber-800 tabular-nums">{mediumRiskCount}</div>
          <div className="text-[11px] text-slate-500 mt-1">
            Deliverables due within 72h or unassigned high priority items
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-emerald-200 shadow-2xs">
          <div className="flex items-center justify-between text-emerald-600 mb-1">
            <span className="text-xs font-semibold">Low Risk / Nominal Projects</span>
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold text-emerald-700 tabular-nums">{lowRiskCount}</div>
          <div className="text-[11px] text-slate-500 mt-1">
            On track with healthy milestone pacing
          </div>
        </div>
      </div>

      {/* Detailed Risk Evaluations */}
      <div className="space-y-6">
        {risks.map(r => {
          const isHigh = r.risk_level === 'High';
          const isMedium = r.risk_level === 'Medium';

          return (
            <div
              key={r.project_id}
              className={`bg-white rounded-xl border p-5 shadow-2xs transition-all ${
                isHigh
                  ? 'border-rose-300 ring-1 ring-rose-200'
                  : isMedium
                  ? 'border-amber-300'
                  : 'border-slate-200'
              }`}
            >
              {/* Project Card Header */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold shrink-0 ${
                      isHigh
                        ? 'bg-rose-100 text-rose-700'
                        : isMedium
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    <ShieldAlert className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-slate-900">{r.project_name}</h2>
                    <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                      <span>Completion: <strong className="text-slate-800 font-mono">{r.completion_percentage}%</strong></span>
                      <span aria-hidden="true">·</span>
                      <span>Total Tasks: <strong className="text-slate-800 font-mono">{r.total_tasks}</strong></span>
                      {r.days_until_deadline !== null && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">
                            {r.days_until_deadline >= 0
                              ? `Deadline in ${r.days_until_deadline} day(s)`
                              : `${Math.abs(r.days_until_deadline)} day(s) past deadline`}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-[11px] text-slate-400 font-mono">Calculated Risk Score</div>
                    <div className="text-base font-bold text-slate-900 font-mono tabular-nums">
                      {r.risk_score}/100
                    </div>
                  </div>
                  <span
                    className={`text-xs font-bold px-3 py-1 rounded-md font-mono ${
                      isHigh
                        ? 'bg-rose-600 text-white shadow-xs'
                        : isMedium
                        ? 'bg-amber-500 text-white'
                        : 'bg-emerald-600 text-white'
                    }`}
                  >
                    {r.risk_level.toUpperCase()} RISK
                  </span>
                </div>
              </div>

              {/* Recommendation Strip */}
              <div className="my-4 p-3 bg-slate-50 rounded-lg border border-slate-200/80 flex items-start gap-2.5">
                <ArrowRight className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <div className="text-xs text-slate-800">
                  <span className="font-bold">Suggested Executive Action: </span>
                  {r.summary_recommendation}
                </div>
              </div>

              {/* Factors list */}
              <div>
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5">
                  Triggered Risk Invariants & Affected Deliverables ({r.factors.length})
                </h3>

                {r.factors.length === 0 ? (
                  <div className="py-4 px-3 bg-emerald-50/50 rounded-lg border border-emerald-100 text-xs text-emerald-700 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>No risk factors detected. All deadlines and task allocations meet milestone thresholds.</span>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {r.factors.map(f => (
                      <div
                        key={f.id}
                        className="p-3 bg-white rounded-lg border border-slate-200 shadow-2xs space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`w-2 h-2 rounded-full ${
                                f.severity === 'High'
                                  ? 'bg-rose-600'
                                  : f.severity === 'Medium'
                                  ? 'bg-amber-500'
                                  : 'bg-blue-500'
                              }`}
                            />
                            <span className="text-xs font-bold text-slate-900">{f.title}</span>
                          </div>
                          <span className="text-[10px] font-mono text-slate-400 font-semibold">
                            [{f.code}]
                          </span>
                        </div>

                        <p className="text-xs text-slate-600 leading-relaxed">
                          {f.description}
                        </p>

                        {/* Affected Tasks Pill List */}
                        {f.affected_task_titles.length > 0 && (
                          <div className="pt-2 border-t border-slate-100">
                            <div className="text-[11px] font-medium text-slate-500 mb-1">
                              Affected Deliverables:
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {f.affected_task_titles.map((title, i) => (
                                <span
                                  key={i}
                                  className="text-[11px] font-medium text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 truncate max-w-xs"
                                >
                                  {title}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="text-[11px] text-blue-700 font-medium">
                          Next Step: {f.suggested_action}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Card Footer: Action to inspect tasks */}
              <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    onSelectProject(r.project_id);
                    onNavigateToTasks(r.project_id);
                  }}
                  className="px-3.5 py-1.5 text-xs font-semibold text-blue-700 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <span>Resolve Tasks in {r.project_name}</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
