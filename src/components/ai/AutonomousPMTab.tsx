import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Clock,
  ShieldCheck,
  Play,
  Edit3,
  Save,
  X,
  Plus,
  Trash2,
  User,
  RefreshCw,
  Layers,
  Check,
  FileText,
  ChevronDown,
  ChevronUp,
  Bot,
  AlertCircle,
  HelpCircle,
  Activity,
  Calendar,
  CheckSquare,
  ShieldAlert
} from 'lucide-react';
import { api } from '../../api/client';
import { TeamMember } from '../../types';

interface AutonomousPMTabProps {
  selectedProjectId: string;
  projects: Array<{ id: string; name: string }>;
  documents: any[];
  onWorkflowExecuted?: () => void;
}

export const AutonomousPMTab: React.FC<AutonomousPMTabProps> = ({
  selectedProjectId,
  projects = [],
  documents = [],
  onWorkflowExecuted
}) => {
  // Input State
  const [ideaInput, setIdeaInput] = useState('');
  const [targetProjectId, setTargetProjectId] = useState<string>(selectedProjectId || 'new');
  const [selectedDocId, setSelectedDocId] = useState<string>('');
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  // Workflow State
  const [activeWorkflow, setActiveWorkflow] = useState<any | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Clarification / Interview State
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [useDefaults, setUseDefaults] = useState<Record<string, boolean>>({});
  const [additionalRequirements, setAdditionalRequirements] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  // Plan Edit State
  const [isEditingPlan, setIsEditingPlan] = useState(false);
  const [editablePlan, setEditablePlan] = useState<any | null>(null);
  const [revisionPrompt, setRevisionPrompt] = useState('');
  const [isRequestingRevision, setIsRequestingRevision] = useState(false);

  // Live Project Monitoring State
  const [monitoringData, setMonitoringData] = useState<any | null>(null);
  const [isMonitoring, setIsMonitoring] = useState(false);

  // Load team members for assignee mapping
  useEffect(() => {
    const loadTeam = async () => {
      try {
        const team = await api.getTeam();
        setTeamMembers(team);
      } catch {
        // Ignored
      }
    };
    loadTeam();
  }, []);

  // Update targetProjectId when prop changes
  useEffect(() => {
    if (selectedProjectId && selectedProjectId !== 'all') {
      setTargetProjectId(selectedProjectId);
    }
  }, [selectedProjectId]);

  // Load existing workflow if one is active for this project
  const loadActiveWorkflows = async () => {
    try {
      const wfs = await api.getWorkflows(selectedProjectId !== 'all' ? selectedProjectId : undefined);
      const apmWorkflows = wfs.filter((w: any) => w.workflow_type === 'autonomous_pm');
      if (apmWorkflows.length > 0 && !activeWorkflow) {
        const latest = apmWorkflows[0];
        const status = await api.getAutonomousPMStatus(latest.id);
        setActiveWorkflow(status);
        if (status.proposed_plan) {
          setEditablePlan(JSON.parse(JSON.stringify(status.proposed_plan)));
        }
      }
    } catch {
      // Ignored
    }
  };

  useEffect(() => {
    loadActiveWorkflows();
  }, [selectedProjectId]);

  // 1. Start Workflow from Idea or Document
  const handleStartWorkflow = async () => {
    if (!ideaInput.trim() && !selectedDocId) {
      setErrorMsg('Please enter a project idea or select an ingested requirements document.');
      return;
    }

    setIsProcessing(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await api.startAutonomousPM({
        project_id: targetProjectId,
        idea: ideaInput.trim(),
        document_id: selectedDocId || undefined
      });

      setActiveWorkflow(res);
      if (res.proposed_plan) {
        setEditablePlan(JSON.parse(JSON.stringify(res.proposed_plan)));
      }
      setAnswers({});
      setUseDefaults({});
      setSuccessMsg('Autonomous PM initialized. Conversational discovery started.');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to start autonomous project manager workflow.');
    } finally {
      setIsProcessing(false);
    }
  };

  // 2. Submit Clarification Answers
  const handleSubmitClarifications = async (forceGeneratePlan = false) => {
    if (!activeWorkflow?.workflow_id) return;

    setIsProcessing(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const questions = activeWorkflow.pending_questions || [];
    const payloadAnswers = questions.map((q: any) => ({
      question_id: q.id,
      question: q.question,
      answer: answers[q.id]?.trim() || undefined,
      use_default: Boolean(useDefaults[q.id]),
      default_proposed: q.proposedDefault,
      skipped: !answers[q.id]?.trim() && !useDefaults[q.id]
    }));

    try {
      const res = await api.clarifyAutonomousPM(activeWorkflow.workflow_id, {
        answers: payloadAnswers,
        additional_requirements: additionalRequirements.trim() || undefined,
        force_generate_plan: forceGeneratePlan
      });

      setActiveWorkflow((prev: any) => ({ ...prev, ...res }));
      if (res.proposed_plan) {
        setEditablePlan(JSON.parse(JSON.stringify(res.proposed_plan)));
      }
      setAnswers({});
      setUseDefaults({});
      setAdditionalRequirements('');
      setSuccessMsg(forceGeneratePlan ? 'Generated complete project plan.' : 'Clarifications submitted. Requirements updated.');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to process clarifications.');
    } finally {
      setIsProcessing(false);
    }
  };

  // 3. Save Edited Plan
  const handleSavePlanEdits = async () => {
    if (!activeWorkflow?.workflow_id || !editablePlan) return;

    setIsProcessing(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await api.updatePlanAutonomousPM(activeWorkflow.workflow_id, editablePlan);
      setActiveWorkflow((prev: any) => ({
        ...prev,
        proposed_plan: res.plan,
        plan_hash: res.plan_hash,
        status: 'WAITING_APPROVAL'
      }));
      setEditablePlan(JSON.parse(JSON.stringify(res.plan)));
      setIsEditingPlan(false);
      setSuccessMsg(`Plan updated to version ${res.plan.version}. Previous approvals invalidated. New Hash: ${res.plan_hash}`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update plan.');
    } finally {
      setIsProcessing(false);
    }
  };

  // 4. Approve & Execute Mutations
  const handleApprovePlan = async () => {
    if (!activeWorkflow?.workflow_id) return;

    setIsProcessing(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await api.approveAutonomousPM(activeWorkflow.workflow_id, {
        plan_hash: activeWorkflow.plan_hash
      });

      setActiveWorkflow((prev: any) => ({
        ...prev,
        status: 'COMPLETED',
        execution_results: res
      }));

      setSuccessMsg('Plan approved and project tasks created successfully.');
      if (onWorkflowExecuted) {
        onWorkflowExecuted();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to execute approved plan.');
    } finally {
      setIsProcessing(false);
    }
  };

  // 5. Reject Plan
  const handleRejectPlan = async () => {
    if (!activeWorkflow?.workflow_id) return;
    if (!window.confirm('Are you sure you want to reject this proposed project plan?')) return;

    setIsProcessing(true);
    setErrorMsg(null);

    try {
      await api.rejectWorkflow(activeWorkflow.workflow_id);
      setActiveWorkflow((prev: any) => ({ ...prev, status: 'REJECTED' }));
      setSuccessMsg('Plan was rejected.');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to reject plan.');
    } finally {
      setIsProcessing(false);
    }
  };

  // 6. Request AI Revision
  const handleRequestRevision = async () => {
    if (!activeWorkflow?.workflow_id || !revisionPrompt.trim()) return;

    setIsProcessing(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await api.clarifyAutonomousPM(activeWorkflow.workflow_id, {
        additional_requirements: `Revision requested: ${revisionPrompt.trim()}`,
        force_generate_plan: true
      });

      setActiveWorkflow((prev: any) => ({ ...prev, ...res }));
      if (res.proposed_plan) {
        setEditablePlan(JSON.parse(JSON.stringify(res.proposed_plan)));
      }
      setRevisionPrompt('');
      setIsRequestingRevision(false);
      setSuccessMsg('AI updated the proposed plan based on your revision request.');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to request revision.');
    } finally {
      setIsProcessing(false);
    }
  };

  // 7. Live Project Monitoring
  const handleFetchMonitoring = async () => {
    if (!activeWorkflow?.workflow_id) return;

    setIsMonitoring(true);
    try {
      const mon = await api.monitorAutonomousPM(activeWorkflow.workflow_id);
      setMonitoringData(mon);
    } catch (err: any) {
      setErrorMsg(err.message || 'Project has not been executed yet to monitor.');
    } finally {
      setIsMonitoring(false);
    }
  };

  // Reset to start a new project plan
  const handleResetWorkflow = () => {
    setActiveWorkflow(null);
    setEditablePlan(null);
    setIdeaInput('');
    setMonitoringData(null);
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-6">
      {/* Header Banner */}
      <div className="p-4 bg-[var(--surface-secondary)] border border-[var(--border-color)] rounded-2xl flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h3 className="text-sm font-bold text-[var(--text-primary)] tracking-tight flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-[var(--primary-accent)]" />
              Autonomous Project Manager
            </h3>
          </div>
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
            Interviews you on requirements, formulates structured architecture, and creates project deliverables upon your approval.
          </p>
        </div>

        {activeWorkflow && (
          <button
            type="button"
            onClick={handleResetWorkflow}
            className="px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-color)] hover:border-[var(--primary-accent)]/40 rounded-xl transition-colors cursor-pointer shrink-0"
          >
            New Plan
          </button>
        )}
      </div>

      {/* Notifications */}
      {successMsg && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/25 rounded-xl text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/25 rounded-xl text-xs text-rose-600 dark:text-rose-400 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* ==================================================================== */}
      {/* STAGE 1: INPUT IDEA OR DOCUMENT                                      */}
      {/* ==================================================================== */}
      {!activeWorkflow && (
        <div className="space-y-4 bg-[var(--surface-primary)] p-5 rounded-2xl border border-[var(--border-color)]">
          <div>
            <label className="text-xs font-bold text-[var(--text-primary)] block mb-1">
              1. What project would you like to plan?
            </label>
            <p className="text-xs text-[var(--text-secondary)] mb-3">
              Describe your project idea in ordinary language, paste requirements, or select an uploaded document.
            </p>
            <textarea
              rows={4}
              value={ideaInput}
              onChange={e => setIdeaInput(e.target.value)}
              placeholder="e.g. Build an automated invoice reconciliation and payment verification engine with WhatsApp alerts, PDF extraction, and team approval gates..."
              className="w-full px-3.5 py-3 text-xs text-[var(--text-primary)] bg-[var(--surface-secondary)] border border-[var(--border-color)] rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[var(--primary-accent)]/30 placeholder-[var(--text-muted)] resize-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div>
              <label className="text-xs font-semibold text-[var(--text-primary)] block mb-1">
                Target Project
              </label>
              <select
                value={targetProjectId}
                onChange={e => setTargetProjectId(e.target.value)}
                className="w-full text-xs p-2.5 bg-[var(--surface-secondary)] border border-[var(--border-color)] rounded-xl text-[var(--text-primary)] focus:outline-hidden"
              >
                <option value="new">+ Create as New Project in Workspace</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>
                    Add to existing: {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-[var(--text-primary)] block mb-1">
                Optional Ingested Document
              </label>
              <select
                value={selectedDocId}
                onChange={e => setSelectedDocId(e.target.value)}
                className="w-full text-xs p-2.5 bg-[var(--surface-secondary)] border border-[var(--border-color)] rounded-xl text-[var(--text-primary)] focus:outline-hidden"
              >
                <option value="">None (Use natural language idea only)</option>
                {documents.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.filename} ({d.page_count} pages)
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="button"
              onClick={handleStartWorkflow}
              disabled={isProcessing || (!ideaInput.trim() && !selectedDocId)}
              className="px-5 py-2.5 bg-[var(--primary-accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-semibold rounded-xl transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Planning Project...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Create Project Plan</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* STAGE 2: REQUIREMENTS CLARIFICATION                                  */}
      {/* ==================================================================== */}
      {activeWorkflow && activeWorkflow.status === 'AWAITING_ANSWERS' && (
        <div className="space-y-4 bg-[var(--surface-primary)] p-5 rounded-2xl border border-[var(--border-color)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
              <h4 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">
                Requirements Clarification
              </h4>
            </div>
          </div>

          <p className="text-xs text-[var(--text-secondary)]">
            Please review these key project decisions. You can provide your preferences or accept the suggested defaults.
          </p>

          {/* Questions List */}
          <div className="space-y-3.5">
            {activeWorkflow.pending_questions?.map((q: any) => (
              <div
                key={q.id}
                className="p-4 bg-[var(--surface-secondary)]/60 border border-[var(--border-color)] rounded-xl space-y-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-xs text-[var(--text-primary)] flex items-start gap-2">
                    <HelpCircle className="w-4 h-4 text-[var(--primary-accent)] shrink-0 mt-0.5" />
                    <span>{q.question}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium">
                      {q.category || 'Architecture'}
                    </span>
                    {q.isMaterial && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Material
                      </span>
                    )}
                  </div>
                </div>

                {/* Proposed Default Box */}
                {q.proposedDefault && (
                  <div className="p-2.5 bg-[var(--surface-primary)] border border-[var(--border-color)] rounded-lg text-xs flex items-center justify-between gap-3">
                    <div className="text-[11px] text-[var(--text-secondary)]">
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">Proposed Default: </span>
                      <span>{q.proposedDefault}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setUseDefaults(prev => ({ ...prev, [q.id]: !prev[q.id] }));
                        if (!useDefaults[q.id]) {
                          setAnswers(prev => ({ ...prev, [q.id]: '' }));
                        }
                      }}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition-all cursor-pointer shrink-0 flex items-center gap-1 ${
                        useDefaults[q.id]
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-[var(--surface-secondary)] text-[var(--text-secondary)] border-[var(--border-color)] hover:border-[var(--primary-accent)]'
                      }`}
                    >
                      <Check className="w-3 h-3" />
                      {useDefaults[q.id] ? 'Accepted' : 'Accept Default'}
                    </button>
                  </div>
                )}

                {/* Custom Answer Input */}
                {!useDefaults[q.id] && (
                  <input
                    type="text"
                    value={answers[q.id] || ''}
                    onChange={e => setAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                    placeholder="Or enter your custom preference in ordinary language..."
                    className="w-full px-3 py-2 text-xs text-[var(--text-primary)] bg-[var(--surface-primary)] border border-[var(--border-color)] rounded-lg focus:outline-hidden focus:ring-1 focus:ring-[var(--primary-accent)]"
                  />
                )}
              </div>
            ))}
          </div>

          {/* Additional Notes Field */}
          <div>
            <label className="text-xs font-semibold text-[var(--text-secondary)] block mb-1">
              Provide Additional Requirements or Constraints (Optional)
            </label>
            <input
              type="text"
              value={additionalRequirements}
              onChange={e => setAdditionalRequirements(e.target.value)}
              placeholder="e.g. Must support mobile viewport, max budget is fixed, SQLite only..."
              className="w-full px-3 py-2 text-xs text-[var(--text-primary)] bg-[var(--surface-secondary)] border border-[var(--border-color)] rounded-xl focus:outline-hidden"
            />
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex items-center justify-between gap-3 border-t border-[var(--border-color)]">
            <button
              type="button"
              onClick={() => handleSubmitClarifications(true)}
              disabled={isProcessing}
              className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline transition-colors cursor-pointer"
            >
              Skip remaining questions & generate plan now →
            </button>

            <button
              type="button"
              onClick={() => handleSubmitClarifications(false)}
              disabled={isProcessing}
              className="px-5 py-2.5 bg-[var(--primary-accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-semibold rounded-xl transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Processing Answers...</span>
                </>
              ) : (
                <>
                  <span>Submit Answers & Update Requirements</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* STAGE 3: EDITABLE PLAN PREVIEW & HUMAN-IN-THE-LOOP APPROVAL          */}
      {/* ==================================================================== */}
      {activeWorkflow && (activeWorkflow.status === 'WAITING_APPROVAL' || activeWorkflow.status === 'PLAN_READY') && (
        <div className="space-y-5 bg-[var(--surface-primary)] p-5 rounded-2xl border border-[var(--border-color)]">
          {/* Plan Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-color)] pb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">
                  Proposed Project Execution Plan
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold">
                  v{editablePlan?.version || 1}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold">
                  Hash: {activeWorkflow.plan_hash?.slice(0, 10)}
                </span>
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                Review deliverables, story points, and suggested assignments. You can edit individual items before signing off.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsEditingPlan(!isEditingPlan)}
                className="px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] bg-[var(--surface-secondary)] border border-[var(--border-color)] hover:border-[var(--primary-accent)] rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
              >
                <Edit3 className="w-3.5 h-3.5 text-[var(--primary-accent)]" />
                <span>{isEditingPlan ? 'Cancel Editing' : 'Edit Plan'}</span>
              </button>

              <button
                type="button"
                onClick={() => setIsRequestingRevision(!isRequestingRevision)}
                className="px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-color)] rounded-xl transition-all cursor-pointer"
              >
                Request AI Revision
              </button>
            </div>
          </div>

          {/* AI Revision Prompt Drawer */}
          {isRequestingRevision && (
            <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl space-y-2">
              <label className="text-xs font-bold text-[var(--text-primary)] block">
                How should the AI revise the plan?
              </label>
              <textarea
                rows={2}
                value={revisionPrompt}
                onChange={e => setRevisionPrompt(e.target.value)}
                placeholder="e.g. Tighten milestone dates to 2 weeks, add a comprehensive database backup deliverable..."
                className="w-full p-2.5 text-xs text-[var(--text-primary)] bg-[var(--surface-primary)] border border-[var(--border-color)] rounded-lg focus:outline-hidden"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsRequestingRevision(false)}
                  className="px-3 py-1 text-xs text-[var(--text-secondary)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleRequestRevision}
                  disabled={isProcessing || !revisionPrompt.trim()}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
                >
                  {isProcessing ? 'Revising Plan...' : 'Generate Revised Plan'}
                </button>
              </div>
            </div>
          )}

          {/* Project Summary & Objectives */}
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider block mb-1">
                Project Name
              </label>
              {isEditingPlan ? (
                <input
                  type="text"
                  value={editablePlan?.projectName || ''}
                  onChange={e => setEditablePlan({ ...editablePlan, projectName: e.target.value })}
                  className="w-full text-xs font-bold p-2 bg-[var(--surface-secondary)] border border-[var(--border-color)] rounded-lg"
                />
              ) : (
                <div className="text-sm font-bold text-[var(--text-primary)]">
                  {editablePlan?.projectName}
                </div>
              )}
            </div>

            <div>
              <label className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider block mb-1">
                Executive Summary
              </label>
              {isEditingPlan ? (
                <textarea
                  rows={2}
                  value={editablePlan?.projectSummary || ''}
                  onChange={e => setEditablePlan({ ...editablePlan, projectSummary: e.target.value })}
                  className="w-full text-xs p-2 bg-[var(--surface-secondary)] border border-[var(--border-color)] rounded-lg"
                />
              ) : (
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  {editablePlan?.projectSummary}
                </p>
              )}
            </div>

            {/* Tech Stack Tags */}
            {editablePlan?.recommendedTechStack && (
              <div>
                <label className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider block mb-1">
                  Architecture & Technology Stack
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {editablePlan.recommendedTechStack.map((tech: string, i: number) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded text-[11px] bg-[var(--surface-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] font-medium"
                    >
                      {tech}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Deliverables & Tasks Table */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">
                Deliverables & Subtasks ({editablePlan?.tasks?.length || 0})
              </label>
              {isEditingPlan && (
                <button
                  type="button"
                  onClick={() => {
                    const newTask = {
                      id: `t-manual-${Date.now()}`,
                      title: 'New Deliverable',
                      description: 'Custom deliverable scope',
                      priority: 'Medium',
                      estimated_hours: 8,
                      story_points: 3,
                      due_date: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
                      assignee_id: teamMembers[0]?.id || null,
                      assignee_name: teamMembers[0]?.name || 'Unassigned',
                      dependencies: [],
                      acceptance_criteria: ['Verification passes'],
                      subtasks: []
                    };
                    setEditablePlan({ ...editablePlan, tasks: [...editablePlan.tasks, newTask] });
                  }}
                  className="px-2.5 py-1 text-[11px] font-semibold text-[var(--primary-accent)] border border-[var(--primary-accent)]/40 rounded-lg hover:bg-[var(--primary-accent)]/10 transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> Add Deliverable
                </button>
              )}
            </div>

            <div className="space-y-3">
              {editablePlan?.tasks?.map((task: any, idx: number) => (
                <div
                  key={task.id || idx}
                  className="p-3.5 bg-[var(--surface-secondary)]/50 border border-[var(--border-color)] rounded-xl space-y-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 space-y-1">
                      {isEditingPlan ? (
                        <input
                          type="text"
                          value={task.title}
                          onChange={e => {
                            const newTasks = [...editablePlan.tasks];
                            newTasks[idx].title = e.target.value;
                            setEditablePlan({ ...editablePlan, tasks: newTasks });
                          }}
                          className="w-full text-xs font-bold p-1.5 bg-[var(--surface-primary)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)]"
                        />
                      ) : (
                        <div className="text-xs font-bold text-[var(--text-primary)]">
                          {idx + 1}. {task.title}
                        </div>
                      )}

                      <p className="text-[11px] text-[var(--text-secondary)]">
                        {task.description}
                      </p>
                    </div>

                    {/* Badge / Controls */}
                    <div className="flex items-center gap-2 shrink-0">
                      {isEditingPlan ? (
                        <select
                          value={task.priority}
                          onChange={e => {
                            const newTasks = [...editablePlan.tasks];
                            newTasks[idx].priority = e.target.value;
                            setEditablePlan({ ...editablePlan, tasks: newTasks });
                          }}
                          className="text-[10px] p-1 bg-[var(--surface-primary)] border border-[var(--border-color)] rounded text-[var(--text-primary)]"
                        >
                          <option value="High">High</option>
                          <option value="Medium">Medium</option>
                          <option value="Low">Low</option>
                        </select>
                      ) : (
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                            task.priority === 'High'
                              ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                              : task.priority === 'Medium'
                              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                              : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                          }`}
                        >
                          {task.priority}
                        </span>
                      )}

                      {isEditingPlan && (
                        <button
                          type="button"
                          onClick={() => {
                            const newTasks = editablePlan.tasks.filter((_: any, i: number) => i !== idx);
                            setEditablePlan({ ...editablePlan, tasks: newTasks });
                          }}
                          className="p-1 text-rose-500 hover:bg-rose-500/10 rounded cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Task Meta: Assignee, Hours, Points, Due Date */}
                  <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-[var(--text-muted)]">
                    <div className="flex items-center gap-1">
                      <User className="w-3.5 h-3.5 text-[var(--primary-accent)]" />
                      {isEditingPlan ? (
                        <select
                          value={task.assignee_id || ''}
                          onChange={e => {
                            const newTasks = [...editablePlan.tasks];
                            const member = teamMembers.find(m => m.id === e.target.value);
                            newTasks[idx].assignee_id = member?.id || null;
                            newTasks[idx].assignee_name = member?.name || 'Unassigned';
                            setEditablePlan({ ...editablePlan, tasks: newTasks });
                          }}
                          className="text-[11px] p-1 bg-[var(--surface-primary)] border border-[var(--border-color)] rounded text-[var(--text-primary)]"
                        >
                          <option value="">Unassigned</option>
                          {teamMembers.map(m => (
                            <option key={m.id} value={m.id}>
                              {m.name} ({m.role})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="font-medium text-[var(--text-secondary)]">
                          {task.assignee_name || 'Unassigned'}
                        </span>
                      )}
                    </div>

                    <span>•</span>

                    <div className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {isEditingPlan ? (
                        <input
                          type="number"
                          value={task.estimated_hours}
                          onChange={e => {
                            const newTasks = [...editablePlan.tasks];
                            newTasks[idx].estimated_hours = Number(e.target.value);
                            setEditablePlan({ ...editablePlan, tasks: newTasks });
                          }}
                          className="w-14 text-[11px] p-1 bg-[var(--surface-primary)] border border-[var(--border-color)] rounded text-[var(--text-primary)]"
                        />
                      ) : (
                        <span>{task.estimated_hours}h estimated</span>
                      )}
                    </div>

                    <span>•</span>

                    <div className="flex items-center gap-1">
                      <span>{task.story_points} pts</span>
                    </div>

                    <span>•</span>

                    <div className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>Due: {task.due_date}</span>
                    </div>
                  </div>

                  {/* Acceptance Criteria */}
                  {task.acceptance_criteria && task.acceptance_criteria.length > 0 && (
                    <div className="pt-1.5 space-y-1">
                      <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider block">
                        Acceptance Criteria:
                      </span>
                      {task.acceptance_criteria.map((crit: string, cIdx: number) => (
                        <div key={cIdx} className="text-[11px] text-[var(--text-secondary)] flex items-start gap-1.5 pl-1">
                          <CheckSquare className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
                          <span>{crit}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Risk Register */}
          {editablePlan?.riskRegister && editablePlan.riskRegister.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-[var(--border-color)]">
              <label className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider block">
                Risk Register & Mitigation Strategy
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {editablePlan.riskRegister.map((risk: any, i: number) => (
                  <div key={i} className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl space-y-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[var(--text-primary)]">{risk.risk}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400 font-mono">
                        {risk.severity}
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--text-secondary)]">
                      <span className="font-semibold">Mitigation:</span> {risk.mitigation}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Save Edits button if in editing mode */}
          {isEditingPlan && (
            <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-center justify-between gap-3">
              <span className="text-xs text-blue-600 dark:text-blue-400">
                You have active edits. Saving will increment plan version and recompute the tamper-proof plan hash.
              </span>
              <button
                type="button"
                onClick={handleSavePlanEdits}
                disabled={isProcessing}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 shrink-0"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save Plan Edits</span>
              </button>
            </div>
          )}

          {/* Human Review & Approval Action Controls */}
          <div className="pt-4 border-t border-[var(--border-color)] flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleRejectPlan}
              disabled={isProcessing}
              className="px-4 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-500/10 border border-transparent rounded-xl transition-colors cursor-pointer"
            >
              Reject Plan
            </button>

            <button
              type="button"
              onClick={handleApprovePlan}
              disabled={isProcessing || isEditingPlan}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-2 shadow-sm"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Creating Project Tasks...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Approve & Create Tasks</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* STAGE 4: PLAN APPROVED & PROJECT CREATED                             */}
      {/* ==================================================================== */}
      {activeWorkflow && activeWorkflow.status === 'COMPLETED' && (
        <div className="space-y-5 bg-[var(--surface-primary)] p-5 rounded-2xl border border-[var(--border-color)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-500 shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-[var(--text-primary)]">
                Plan Approved & Project Created
              </h4>
              <p className="text-xs text-[var(--text-secondary)]">
                All approved deliverables and milestones have been successfully created and scheduled.
              </p>
            </div>
          </div>

          {/* Live Monitoring Dashboard (Tracked from Real SQLite State) */}
          {monitoringData && (
            <div className="p-4 bg-[var(--surface-secondary)]/70 border border-[var(--border-color)] rounded-xl space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-blue-500" />
                  Live Progress Tracking vs Approved Baseline
                </span>
                <span className="text-[10px] font-mono text-[var(--text-muted)]">
                  Tracked: {new Date(monitoringData.tracked_at).toLocaleTimeString()}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2.5 bg-[var(--surface-primary)] border border-[var(--border-color)] rounded-lg">
                  <div className="text-base font-bold text-emerald-500 font-mono">
                    {monitoringData.completion_rate}%
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)]">Completion Rate</div>
                </div>
                <div className="p-2.5 bg-[var(--surface-primary)] border border-[var(--border-color)] rounded-lg">
                  <div className="text-base font-bold text-amber-500 font-mono">
                    {monitoringData.overdue_tasks?.length || 0}
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)]">Overdue Tasks</div>
                </div>
                <div className="p-2.5 bg-[var(--surface-primary)] border border-[var(--border-color)] rounded-lg">
                  <div className="text-base font-bold text-rose-500 font-mono">
                    {monitoringData.blocked_tasks?.length || 0}
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)]">Blocked Deliverables</div>
                </div>
              </div>

              {/* Recommendations */}
              {monitoringData.recommendations && monitoringData.recommendations.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider block">
                    Autonomous PM Recovery & Optimization Actions:
                  </span>
                  {monitoringData.recommendations.map((rec: string, i: number) => (
                    <div key={i} className="text-[11px] text-[var(--text-secondary)] flex items-start gap-2">
                      <ArrowRight className="w-3.5 h-3.5 text-[var(--primary-accent)] shrink-0 mt-0.5" />
                      <span>{rec}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
