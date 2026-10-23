import React, { useState } from 'react';
import {
  ShieldCheck,
  GitCommit,
  GitPullRequest,
  CheckCircle2,
  TrendingUp,
  AlertTriangle,
  ArrowRight,
  Layers,
  Terminal,
  Activity,
  Users,
  Award,
  Sparkles,
  ExternalLink,
  Lock,
  UserCheck,
  Sun,
  Moon
} from 'lucide-react';

interface FrontPageProps {
  onOpenAuth: (mode?: 'login' | 'register') => void;
  onExploreDemo: () => void;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
}

export const FrontPage: React.FC<FrontPageProps> = ({
  onOpenAuth,
  onExploreDemo,
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

  const [activePreviewTab, setActivePreviewTab] = useState<'ledger' | 'git' | 'risk'>('ledger');
  const [simulatedDelayDays, setSimulatedDelayDays] = useState(5);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 selection:bg-blue-100 selection:text-blue-900 font-sans">
      {/* =========================================================================
          TOP BAR CONTRACT (3 Zones: Brand wordmark — Nav links — Login & Register)
          ========================================================================= */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Brand Wordmark (Single text element) */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-[var(--primary-accent)] text-white flex items-center justify-center font-bold text-sm tracking-wider shadow-xs">
              P
            </div>
            <a href="#" className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
              PULSE
            </a>
          </div>

          {/* Zone 2: Navigation Links */}
          <nav className="hidden md:flex items-center gap-8 text-xs font-semibold text-slate-600">
            <a href="#features" className="hover:text-slate-900 transition-colors whitespace-nowrap">
              Capabilities
            </a>
            <a href="#ledger" className="hover:text-slate-900 transition-colors whitespace-nowrap">
              Contribution Ledger
            </a>
            <a href="#architecture" className="hover:text-slate-900 transition-colors whitespace-nowrap">
              Architecture
            </a>
          </nav>

          {/* Zone 3: Top-Right Authentication Controls */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Precision Theme Mode Toggle */}
            <button
              type="button"
              onClick={handleToggleTheme}
              title={activeTheme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              aria-label={activeTheme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              className="p-2 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100/80 transition-colors cursor-pointer"
            >
              {activeTheme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400 hover:text-amber-300 transition-transform duration-200 rotate-0 hover:rotate-45" />
              ) : (
                <Moon className="w-4 h-4 text-slate-700 hover:text-indigo-600 transition-transform duration-200" />
              )}
            </button>

            <button
              type="button"
              onClick={() => onOpenAuth('login')}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 hover:text-slate-950 transition-colors whitespace-nowrap rounded-lg hover:bg-slate-100/80 cursor-pointer"
            >
              Log In
            </button>
            <button
              type="button"
              onClick={() => onOpenAuth('register')}
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-xs transition-colors whitespace-nowrap cursor-pointer"
            >
              Register
            </button>
          </div>
        </div>
      </header>

      {/* =========================================================================
          HERO SECTION
          ========================================================================= */}
      <section className="pt-16 pb-14 sm:pt-20 sm:pb-20 bg-linear-to-b from-white via-slate-50 to-slate-100 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center space-y-6">
            {/* Unboxed Metadata Kicker (Zero-Pill Discipline) */}
            <div className="flex items-center justify-center gap-2 text-xs font-medium text-slate-500">
              <span>Algorithmic Project Governance</span>
              <span aria-hidden="true">·</span>
              <span>Verifiable Contribution Telemetry</span>
              <span aria-hidden="true">·</span>
              <span>Zero Subjective Bias</span>
            </div>

            {/* Display Headline */}
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-slate-900 tracking-tight leading-[1.15]" style={{ textWrap: 'balance' }}>
              Transform invisible engineering effort into transparent, auditable project momentum.
            </h1>

            {/* Value Proposition Prose */}
            <p className="text-base sm:text-lg text-slate-600 leading-relaxed max-w-2xl mx-auto">
              PULSE pairs real-time delivery with cryptographic GitHub commit reconciliation.
              Recognize code reviews, architecture mentoring, and technical debt alongside feature velocity.
            </p>

            {/* Primary Action Group */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => onOpenAuth('register')}
                className="w-full sm:w-auto px-6 py-3 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-sm hover:shadow transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Create Workspace Account</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={onExploreDemo}
                className="w-full sm:w-auto px-5 py-3 text-sm font-semibold text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl shadow-2xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Explore Live Workspace Demo</span>
              </button>
            </div>

            {/* Adjacent Proof Badges (Unboxed Text with Separators) */}
            <div className="pt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-slate-500">
              <span className="flex items-center gap-1.5 text-slate-700 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                SQLite Write-Ahead Logging
              </span>
              <span aria-hidden="true">·</span>
              <span className="flex items-center gap-1.5 text-slate-700 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                Cryptographic SHA-256 Hashes
              </span>
              <span aria-hidden="true">·</span>
              <span className="flex items-center gap-1.5 text-slate-700 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                Deterministic Risk Formulas
              </span>
            </div>
          </div>

          {/* =========================================================================
              LIVE INTERACTIVE PREVIEW CANVAS
              ========================================================================= */}
          <div className="mt-12 sm:mt-16 max-w-5xl mx-auto bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
            {/* Window Top Bar & Interactive Tab Selector */}
            <div className="px-5 py-3.5 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-slate-700" />
                <div className="w-3 h-3 rounded-full bg-slate-700" />
                <div className="w-3 h-3 rounded-full bg-slate-700" />
                <span className="ml-2 text-xs font-mono text-slate-400">
                  pulse-kernel://telemetry/live-inspector
                </span>
              </div>

              {/* Segmented Controls (Interactive buttons) */}
              <div className="flex items-center p-1 bg-slate-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => setActivePreviewTab('ledger')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    activePreviewTab === 'ledger'
                      ? 'bg-slate-700 text-white shadow-2xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Fair Ledger
                </button>
                <button
                  type="button"
                  onClick={() => setActivePreviewTab('git')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    activePreviewTab === 'git'
                      ? 'bg-slate-700 text-white shadow-2xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  GitHub Sync
                </button>
                <button
                  type="button"
                  onClick={() => setActivePreviewTab('risk')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    activePreviewTab === 'risk'
                      ? 'bg-slate-700 text-white shadow-2xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Ripple Simulator
                </button>
              </div>
            </div>

            {/* Tab 1: Fair Contribution Ledger */}
            {activePreviewTab === 'ledger' && (
              <div className="p-6 sm:p-8 space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      Algorithmic Contributor Weighting Engine
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Formula: Visible Commits (35%) + Code Reviews (25%) + Peer Mentoring Kudos (20%) + Backlog Resolution (20%)
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-600">
                    <span>Audit Status: Verified</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums text-slate-900 font-semibold">100% Deterministic</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-500">Elena Rostova</span>
                      <span className="text-xs font-bold text-blue-600 font-mono tabular-nums">88.4 / 100</span>
                    </div>
                    <div className="text-sm font-semibold text-slate-900">Staff Systems Architect</div>
                    <div className="text-xs text-slate-600 space-y-1">
                      <div className="flex justify-between">
                        <span>PR Reviews Conducted:</span>
                        <span className="font-mono tabular-nums font-semibold">34</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Architecture Kudos:</span>
                        <span className="font-mono tabular-nums font-semibold">12</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Backlog Velocity:</span>
                        <span className="font-mono tabular-nums font-semibold">14 closed</span>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-500">Marcus Chen</span>
                      <span className="text-xs font-bold text-blue-600 font-mono tabular-nums">79.2 / 100</span>
                    </div>
                    <div className="text-sm font-semibold text-slate-900">Lead Distributed Systems</div>
                    <div className="text-xs text-slate-600 space-y-1">
                      <div className="flex justify-between">
                        <span>PR Reviews Conducted:</span>
                        <span className="font-mono tabular-nums font-semibold">21</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Code Refactoring Kudos:</span>
                        <span className="font-mono tabular-nums font-semibold">8</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Backlog Velocity:</span>
                        <span className="font-mono tabular-nums font-semibold">18 closed</span>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-500">Aisha Patel</span>
                      <span className="text-xs font-bold text-blue-600 font-mono tabular-nums">84.7 / 100</span>
                    </div>
                    <div className="text-sm font-semibold text-slate-900">Senior Security Engineer</div>
                    <div className="text-xs text-slate-600 space-y-1">
                      <div className="flex justify-between">
                        <span>Vulnerability Audits:</span>
                        <span className="font-mono tabular-nums font-semibold">16</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Peer Commendations:</span>
                        <span className="font-mono tabular-nums font-semibold">9</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Backlog Velocity:</span>
                        <span className="font-mono tabular-nums font-semibold">11 closed</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-blue-50/60 border border-blue-200 rounded-lg text-xs text-blue-900 flex items-center justify-between gap-4">
                  <span className="font-medium">
                    Every member receives credit for invisible coordination work, technical debt resolution, and code review thoroughness.
                  </span>
                  <button
                    type="button"
                    onClick={onExploreDemo}
                    className="font-semibold text-blue-700 hover:text-blue-900 underline whitespace-nowrap cursor-pointer"
                  >
                    Open Live Ledger &rarr;
                  </button>
                </div>
              </div>
            )}

            {/* Tab 2: GitHub & Jira Dual Sync */}
            {activePreviewTab === 'git' && (
              <div className="p-6 sm:p-8 space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      Cryptographic Git Hash & Task Correlation
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Automated webhook reconciles git commits with task status, PR lifecycle, and branch heads.
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-600">
                    <span>Reconciliation: Real-time</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-emerald-700 font-medium">Webhook Active</span>
                  </div>
                </div>

                <div className="space-y-3 font-mono text-xs">
                  <div className="p-3 bg-slate-900 text-slate-200 rounded-lg flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="text-blue-400 font-bold">commit 9c4f1a2</span>
                      <span className="text-slate-300">feat(security): enforce cryptographic session signatures</span>
                    </div>
                    <span className="text-slate-400 text-[11px] whitespace-nowrap">Jira #SEC-412 · Merged</span>
                  </div>
                  <div className="p-3 bg-slate-900 text-slate-200 rounded-lg flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="text-blue-400 font-bold">commit 3b7e8d1</span>
                      <span className="text-slate-300">perf(wal): enable SQLite memory-mapped IO and 64MB cache</span>
                    </div>
                    <span className="text-slate-400 text-[11px] whitespace-nowrap">Jira #DB-108 · In Review</span>
                  </div>
                  <div className="p-3 bg-slate-900 text-slate-200 rounded-lg flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="text-blue-400 font-bold">commit a5019ef</span>
                      <span className="text-slate-300">fix(scheduler): resolve critical path DAG cycle detection</span>
                    </div>
                    <span className="text-slate-400 text-[11px] whitespace-nowrap">Jira #CORE-89 · Done</span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 text-xs text-slate-500">
                  <span>Supports per-developer GitHub personal access tokens or organization webhooks.</span>
                  <button
                    type="button"
                    onClick={() => onOpenAuth('login')}
                    className="font-semibold text-slate-900 hover:underline cursor-pointer"
                  >
                    Connect GitHub Repository &rarr;
                  </button>
                </div>
              </div>
            )}

            {/* Tab 3: Ripple Simulator */}
            {activePreviewTab === 'risk' && (
              <div className="p-6 sm:p-8 space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      What-If Cascading Dependency Ripple Simulator
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Simulate deliverable slippage and calculate downstream milestone blast radius.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-600">Simulate Delay:</span>
                    <input
                      type="range"
                      min={1}
                      max={14}
                      value={simulatedDelayDays}
                      onChange={(e) => setSimulatedDelayDays(Number(e.target.value))}
                      className="w-24 cursor-pointer accent-blue-600"
                    />
                    <span className="text-xs font-mono font-bold text-blue-600 tabular-nums">
                      +{simulatedDelayDays}d
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-xl space-y-2">
                    <div className="text-xs font-semibold text-amber-900">Downstream Impacted Tasks</div>
                    <div className="text-2xl font-bold text-amber-900 font-mono tabular-nums">
                      {Math.min(12, Math.round(simulatedDelayDays * 1.8))}
                    </div>
                    <p className="text-xs text-amber-800">
                      Cross-team dependencies blocked in milestone sprints.
                    </p>
                  </div>

                  <div className="p-4 bg-rose-50/70 border border-rose-200 rounded-xl space-y-2">
                    <div className="text-xs font-semibold text-rose-900">Projected Delivery Slip</div>
                    <div className="text-2xl font-bold text-rose-900 font-mono tabular-nums">
                      +{Math.round(simulatedDelayDays * 1.3)} days
                    </div>
                    <p className="text-xs text-rose-800">
                      Calculated on critical path directed acyclic graph.
                    </p>
                  </div>

                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                    <div className="text-xs font-semibold text-slate-700">Mitigation Strategy</div>
                    <div className="text-xs text-slate-600 space-y-1.5 pt-1">
                      <div className="font-medium text-slate-900">Reassign 2 non-critical tasks</div>
                      <p>Transfer secondary validation to available peer engineers to restore target deadline.</p>
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-slate-100 rounded-lg text-xs text-slate-700 flex items-center justify-between">
                  <span>Interactive simulation runs client-side with zero mutation of live production data.</span>
                  <button
                    type="button"
                    onClick={onExploreDemo}
                    className="font-semibold text-slate-900 hover:underline cursor-pointer"
                  >
                    Open Risk Simulator &rarr;
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* =========================================================================
          SECTION 2: CORE CAPABILITIES (Numbered Asymmetric Bento Flow)
          ========================================================================= */}
      <section id="features" className="py-16 sm:py-24 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mb-12">
            <div className="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-2">
              Enterprise Governance
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight" style={{ textWrap: 'balance' }}>
              Built for engineering leaders who value transparency over politics.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Feature 01 */}
            <div className="p-6 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col justify-between">
              <div className="space-y-4">
                <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm">
                  01
                </div>
                <h3 className="text-lg font-bold text-slate-900">
                  Algorithmic Fair Contribution Ledger
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Raw commit counts incentivize superficial line thrashing. PULSE evaluates pull request reviews,
                  architectural RFC discussions, bug reproductions, and teammate kudos into a verifiable contribution profile.
                </p>
              </div>
              <div className="pt-6 border-t border-slate-200/60 mt-6 text-xs text-slate-500">
                <span>Weighted Metrics</span>
                <span className="mx-2">·</span>
                <span>Peer Endorsements</span>
              </div>
            </div>

            {/* Feature 02 */}
            <div className="p-6 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col justify-between">
              <div className="space-y-4">
                <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm">
                  02
                </div>
                <h3 className="text-lg font-bold text-slate-900">
                  Cascading Ripple & Bottleneck Detection
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Identify single-points-of-failure before deadlines slip. When a foundational library or security review slips,
                  our dependency graph forecasts the exact date impact on downstream deliverables across all projects.
                </p>
              </div>
              <div className="pt-6 border-t border-slate-200/60 mt-6 text-xs text-slate-500">
                <span>DAG Analysis</span>
                <span className="mx-2">·</span>
                <span>Critical Path Blast Radius</span>
              </div>
            </div>

            {/* Feature 03 */}
            <div className="p-6 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col justify-between">
              <div className="space-y-4">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm">
                  03
                </div>
                <h3 className="text-lg font-bold text-slate-900">
                  Bidirectional GitHub & Backlog Synchronization
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Link task tickets to branch references and commits automatically. Track team velocity with verified audit logs,
                  preventing manual status spreadsheet updates and stale ticketing queues.
                </p>
              </div>
              <div className="pt-6 border-t border-slate-200/60 mt-6 text-xs text-slate-500">
                <span>Webhook Integration</span>
                <span className="mx-2">·</span>
                <span>Branch Lifecycle</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          SECTION 3: ARCHITECTURE & RELIABILITY
          ========================================================================= */}
      <section id="architecture" className="py-16 sm:py-24 bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-6">
              <div className="text-xs font-mono text-blue-400">
                ARCHITECTURE // ZERO-OVERHEAD INTEGRITY
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white" style={{ textWrap: 'balance' }}>
                Engineered with SQLite WAL and deterministic REST pipelines.
              </h2>
              <p className="text-slate-300 text-sm leading-relaxed">
                Most governance tools suffer from heavy server roundtrips and convoluted multi-tier synchronization.
                PULSE is built on lightweight, ACID-compliant storage with sub-millisecond query execution.
              </p>

              <div className="space-y-3 pt-2 text-xs text-slate-300">
                <div className="flex items-start gap-3">
                  <div className="p-1 rounded bg-slate-800 text-blue-400 shrink-0 mt-0.5">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="font-semibold text-white">Write-Ahead Logging (WAL):</span> Non-blocking concurrent queries ensure instant dashboard metrics even during high-volume commit syncing.
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="p-1 rounded bg-slate-800 text-blue-400 shrink-0 mt-0.5">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="font-semibold text-white">Role-Based Access Control (RBAC):</span> Granular permissions separate System Admins, Project Leaders, Engineers, and Guest Reviewers.
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="p-1 rounded bg-slate-800 text-blue-400 shrink-0 mt-0.5">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="font-semibold text-white">Audit Invariant Guarantees:</span> Contributor calculations run through deterministic mathematical filters that prevent score tampering.
                  </div>
                </div>
              </div>

              <div className="pt-4 flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => onOpenAuth('register')}
                  className="px-5 py-2.5 text-xs font-semibold text-slate-900 bg-white hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                >
                  Create Your Account
                </button>
                <button
                  type="button"
                  onClick={onExploreDemo}
                  className="px-5 py-2.5 text-xs font-semibold text-slate-300 hover:text-white border border-slate-700 hover:border-slate-600 rounded-lg transition-colors cursor-pointer"
                >
                  Launch Workspace Demo
                </button>
              </div>
            </div>

            {/* Architectural Code / Schema Snippet Container */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 font-mono text-xs text-slate-300 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-3 text-slate-400">
                <span className="flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-blue-400" />
                  <span>pulse.schema.sql</span>
                </span>
                <span className="text-[11px] text-emerald-400">PRAGMA journal_mode = WAL</span>
              </div>
              <pre className="text-slate-300 leading-relaxed overflow-x-auto text-[11.5px]">
{`-- Deterministic Contributor Scoring Ledger
CREATE TABLE member_contributions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  visible_commits_score REAL DEFAULT 0,
  code_reviews_score REAL DEFAULT 0,
  mentoring_kudos_score REAL DEFAULT 0,
  backlog_velocity_score REAL DEFAULT 0,
  composite_fair_score REAL GENERATED ALWAYS AS (
    (visible_commits_score * 0.35) +
    (code_reviews_score * 0.25) +
    (mentoring_kudos_score * 0.20) +
    (backlog_velocity_score * 0.20)
  ) STORED
);`}
              </pre>
              <div className="pt-2 border-t border-slate-800 text-[11px] text-slate-500 flex justify-between">
                <span>Verified Schema Constraints</span>
                <span className="text-slate-400">Latency: &lt;1.2ms</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          SECTION 4: CALL TO ACTION CONVERSION BLOCK
          ========================================================================= */}
      <section className="py-16 sm:py-20 bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center space-y-6">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight" style={{ textWrap: 'balance' }}>
            Ready to bring clarity and fairness to your engineering delivery?
          </h2>
          <p className="text-sm sm:text-base text-slate-600 max-w-xl mx-auto leading-relaxed">
            Sign up in seconds, invite your teammates, and start evaluating project health with verifiable telemetry.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => onOpenAuth('register')}
              className="w-full sm:w-auto px-6 py-3 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              Register Workspace Account
            </button>
            <button
              type="button"
              onClick={() => onOpenAuth('login')}
              className="w-full sm:w-auto px-6 py-3 text-sm font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
            >
              Sign In to Existing Account
            </button>
          </div>
        </div>
      </section>

      {/* =========================================================================
          QUIET FOOTER
          ========================================================================= */}
      <footer className="py-10 bg-slate-50 text-slate-500 text-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-900">PULSE</span>
            <span aria-hidden="true">·</span>
            <span>Intelligent Project Delivery & Fair Contribution Platform</span>
          </div>

          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => onOpenAuth('login')}
              className="hover:text-slate-900 transition-colors cursor-pointer"
            >
              Log In
            </button>
            <button
              type="button"
              onClick={() => onOpenAuth('register')}
              className="hover:text-slate-900 transition-colors cursor-pointer"
            >
              Register
            </button>
            <button
              type="button"
              onClick={onExploreDemo}
              className="hover:text-slate-900 transition-colors cursor-pointer"
            >
              Launch Demo Workspace
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
};
