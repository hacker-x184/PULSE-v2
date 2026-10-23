import React, { useState, useEffect } from 'react';
import {
  MessageSquare,
  FileText,
  Award,
  Sparkles,
  Plus,
  Send,
  Calendar,
  User,
  Users,
  CheckCircle2,
  Clock,
  Copy,
  Check,
  AlertCircle,
  Tag,
  ArrowRight
} from 'lucide-react';
import { Project, TeamMember, MeetingNote, Discussion, PeerKudos, User as UserType } from '../../types';
import { api } from '../../api/client';
import { Modal } from '../common/Modal';
import { Avatar } from '../common/Avatar';

interface CollaborationPageProps {
  projects: Project[];
  team: TeamMember[];
  selectedProjectId: string;
  onSelectProject: (id: string) => void;
  currentUser: UserType | null;
}

export const CollaborationPage: React.FC<CollaborationPageProps> = ({
  projects,
  team,
  selectedProjectId,
  onSelectProject,
  currentUser
}) => {
  const [activeTab, setActiveTab] = useState<'discussions' | 'meetings' | 'kudos' | 'standup'>('discussions');
  const [projectId, setProjectId] = useState(selectedProjectId || (projects[0]?.id || ''));

  // Discussions state
  const [discussions, setDiscussions] = useState<Discussion[]>([]);
  const [discTitle, setDiscTitle] = useState('');
  const [discContent, setDiscContent] = useState('');
  const [discCategory, setDiscCategory] = useState('Architecture');
  const [isPostingDisc, setIsPostingDisc] = useState(false);

  // Meeting Notes state
  const [meetingNotes, setMeetingNotes] = useState<MeetingNote[]>([]);
  const [isCreateMeetingOpen, setIsCreateMeetingOpen] = useState(false);
  const [meetTitle, setMeetTitle] = useState('');
  const [meetDate, setMeetDate] = useState(new Date().toISOString().split('T')[0]);
  const [meetAttendees, setMeetAttendees] = useState('');
  const [meetContent, setMeetContent] = useState('');
  const [meetActionItems, setMeetActionItems] = useState('');
  const [isSavingMeeting, setIsSavingMeeting] = useState(false);

  // Kudos state
  const [kudosList, setKudosList] = useState<PeerKudos[]>([]);
  const [kudosToMemberId, setKudosToMemberId] = useState(team[0]?.id || '');
  const [kudosCategory, setKudosCategory] = useState('Mentorship & Guidance');
  const [kudosMessage, setKudosMessage] = useState('');
  const [isSendingKudos, setIsSendingKudos] = useState(false);
  const [kudosNotice, setKudosNotice] = useState<string | null>(null);

  // Stand-up state
  const [standupData, setStandupData] = useState<any>(null);
  const [isLoadingStandup, setIsLoadingStandup] = useState(false);
  const [copiedStandup, setCopiedStandup] = useState(false);

  // Load active tab data
  useEffect(() => {
    if (activeTab === 'discussions') {
      loadDiscussions();
    } else if (activeTab === 'meetings') {
      loadMeetingNotes();
    } else if (activeTab === 'kudos') {
      loadKudos();
    } else if (activeTab === 'standup') {
      loadStandup();
    }
  }, [activeTab, projectId]);

  const loadDiscussions = async () => {
    try {
      const res = await api.getDiscussions(projectId || undefined);
      setDiscussions(res);
    } catch {}
  };

  const loadMeetingNotes = async () => {
    try {
      const res = await api.getMeetingNotes(projectId || undefined);
      setMeetingNotes(res);
    } catch {}
  };

  const loadKudos = async () => {
    try {
      const res = await api.getKudos(projectId || undefined);
      setKudosList(res);
    } catch {}
  };

  const loadStandup = async () => {
    setIsLoadingStandup(true);
    try {
      const res = await api.getStandupSummary(projectId || undefined);
      setStandupData(res);
    } catch {} finally {
      setIsLoadingStandup(false);
    }
  };

  const handlePostDiscussion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!discTitle.trim() || !discContent.trim()) return;
    setIsPostingDisc(true);
    try {
      await api.createDiscussion({
        project_id: projectId || projects[0]?.id || 'p-ledger',
        title: discTitle.trim(),
        content: discContent.trim(),
        category: discCategory
      });
      setDiscTitle('');
      setDiscContent('');
      loadDiscussions();
    } catch {} finally {
      setIsPostingDisc(false);
    }
  };

  const handleSaveMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!meetTitle.trim()) return;
    setIsSavingMeeting(true);
    try {
      await api.createMeetingNote({
        project_id: projectId || projects[0]?.id || 'p-ledger',
        title: meetTitle.trim(),
        meeting_date: meetDate,
        attendees: meetAttendees || 'Team',
        content: meetContent,
        action_items: meetActionItems
      });
      setIsCreateMeetingOpen(false);
      setMeetTitle('');
      setMeetContent('');
      setMeetActionItems('');
      loadMeetingNotes();
    } catch {} finally {
      setIsSavingMeeting(false);
    }
  };

  const handleSendKudos = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!kudosMessage.trim() || !kudosToMemberId) return;
    setIsSendingKudos(true);
    try {
      await api.sendKudos({
        project_id: projectId || undefined,
        to_member_id: kudosToMemberId,
        category: kudosCategory,
        message: kudosMessage.trim()
      });
      setKudosNotice('Peer recognition awarded and added to invisible work portfolio!');
      setKudosMessage('');
      loadKudos();
      setTimeout(() => setKudosNotice(null), 4000);
    } catch {} finally {
      setIsSendingKudos(false);
    }
  };

  const handleCopyStandup = () => {
    if (!standupData?.standup_text) return;
    navigator.clipboard.writeText(standupData.standup_text);
    setCopiedStandup(true);
    setTimeout(() => setCopiedStandup(false), 3000);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Team Collaboration & Intelligence Hub
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Architectural discussions, synchronized meeting minutes, peer recognition, and automated stand-ups.
          </p>
        </div>

        {/* Project Selector Filter */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-500">Project:</label>
          <select
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              onSelectProject(e.target.value);
            }}
            className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-lg shadow-2xs text-slate-800"
          >
            <option value="">All Projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto pb-px">
        <button
          type="button"
          onClick={() => setActiveTab('discussions')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'discussions'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Team Discussions ({discussions.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('meetings')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'meetings'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Meeting Minutes & Decisions ({meetingNotes.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('kudos')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'kudos'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Award className="w-3.5 h-3.5 text-amber-500" />
          <span>Peer Kudos & Invisible Work ({kudosList.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('standup')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'standup'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-purple-600" />
          <span>Automated Daily Stand-up</span>
        </button>
      </div>

      {/* TAB 1: Discussions */}
      {activeTab === 'discussions' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Post Form */}
          <div className="lg:col-span-1">
            <form onSubmit={handlePostDiscussion} className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs space-y-3">
              <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-blue-600" />
                <span>Start Technical Discussion</span>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Topic Category</label>
                <select
                  value={discCategory}
                  onChange={(e) => setDiscCategory(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-800"
                >
                  <option value="Architecture">Architecture & Technical Specs</option>
                  <option value="Sprint Planning">Sprint Planning & Scope</option>
                  <option value="Blockers">Blockers & Escalations</option>
                  <option value="Performance">Performance & Reliability</option>
                  <option value="General">General Engineering Sync</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Discussion Title *</label>
                <input
                  type="text"
                  required
                  value={discTitle}
                  onChange={(e) => setDiscTitle(e.target.value)}
                  placeholder="e.g. SQLite WAL pragma benchmark"
                  className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Proposal / Content *</label>
                <textarea
                  required
                  rows={4}
                  value={discContent}
                  onChange={(e) => setDiscContent(e.target.value)}
                  placeholder="Share details, context, code snippets, or architecture rationale..."
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={isPostingDisc}
                className="w-full py-2 px-4 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-2xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{isPostingDisc ? 'Posting...' : 'Post Discussion'}</span>
              </button>
            </form>
          </div>

          {/* Discussions Feed */}
          <div className="lg:col-span-2 space-y-3">
            {discussions.length === 0 ? (
              <div className="bg-white p-8 rounded-xl border border-slate-200 text-center text-xs text-slate-400">
                No active discussions found for this workspace project. Start one now!
              </div>
            ) : (
              discussions.map((d) => (
                <div key={d.id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs space-y-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={d.author_name} avatarUrl={d.author_avatar} size="md" />
                      <div>
                        <div className="text-xs font-bold text-slate-900">{d.author_name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {new Date(d.created_at).toLocaleDateString()} at{' '}
                          {new Date(d.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                      {d.category}
                    </span>
                  </div>

                  <h3 className="text-sm font-bold text-slate-900">{d.title}</h3>
                  <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">{d.content}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 2: Meeting Minutes */}
      {activeTab === 'meetings' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-slate-700">Sprint Standups, Syncs, and Design Reviews</span>
            <button
              type="button"
              onClick={() => setIsCreateMeetingOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-2xs transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Record Meeting Notes</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {meetingNotes.length === 0 ? (
              <div className="col-span-2 bg-white p-8 rounded-xl border border-slate-200 text-center text-xs text-slate-400">
                No meeting notes recorded yet. Record architectural decisions and action items.
              </div>
            ) : (
              meetingNotes.map((mn) => (
                <div key={mn.id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-bold text-slate-900">{mn.title}</h3>
                    <div className="flex items-center gap-1 text-[11px] text-slate-500 font-mono shrink-0">
                      <Calendar className="w-3 h-3" />
                      <span>{mn.meeting_date}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs text-slate-600">
                    <Users className="w-3.5 h-3.5 text-slate-400" />
                    <span className="font-medium text-slate-700">Attendees:</span>
                    <span className="truncate">{mn.attendees}</span>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">
                    {mn.content}
                  </div>

                  {mn.action_items && (
                    <div className="space-y-1">
                      <div className="text-[11px] font-semibold text-emerald-800 uppercase tracking-wider flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        <span>Action Items</span>
                      </div>
                      <div className="text-xs text-slate-800 bg-emerald-50/60 p-2.5 rounded border border-emerald-200/70 whitespace-pre-wrap">
                        {mn.action_items}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 3: Peer Kudos & Invisible Work */}
      {activeTab === 'kudos' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <form onSubmit={handleSendKudos} className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs space-y-3">
              <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <Award className="w-4 h-4 text-amber-500" />
                <span>Recognize Invisible Work</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Reward peer mentoring, technical architecture reviews, documentation, on-call unblocking, and emotional leadership.
              </p>

              {kudosNotice && (
                <div className="p-2.5 text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{kudosNotice}</span>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Recognize Teammate</label>
                <select
                  value={kudosToMemberId}
                  onChange={(e) => setKudosToMemberId(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-800"
                >
                  {team.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.role})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Recognition Category</label>
                <select
                  value={kudosCategory}
                  onChange={(e) => setKudosCategory(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-800"
                >
                  <option value="Mentorship & Guidance">Mentorship & Guidance</option>
                  <option value="Unblocking Teammates">Unblocking Teammates Under Pressure</option>
                  <option value="Code Review Thoroughness">Code Review Thoroughness</option>
                  <option value="System Reliability & On-Call">System Reliability & On-Call Dedication</option>
                  <option value="Design & Documentation Quality">Design & Documentation Quality</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Kudos Message *</label>
                <textarea
                  required
                  rows={3}
                  value={kudosMessage}
                  onChange={(e) => setKudosMessage(e.target.value)}
                  placeholder="Describe how their contribution helped the team succeed..."
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={isSendingKudos}
                className="w-full py-2 px-4 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-2xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <Award className="w-3.5 h-3.5" />
                <span>{isSendingKudos ? 'Awarding...' : 'Award Peer Kudos'}</span>
              </button>
            </form>
          </div>

          <div className="lg:col-span-2 space-y-3">
            {kudosList.length === 0 ? (
              <div className="bg-white p-8 rounded-xl border border-slate-200 text-center text-xs text-slate-400">
                No kudos awarded yet. Be the first to appreciate a teammate's invisible efforts!
              </div>
            ) : (
              kudosList.map((k) => (
                <div key={k.id} className="bg-white p-4 rounded-xl border border-amber-200/80 shadow-2xs space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold">
                        ★
                      </span>
                      <span className="text-xs font-bold text-slate-900">
                        {k.from_name} <span className="font-normal text-slate-400">recognized</span> {k.to_member_name}
                      </span>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                      {k.category}
                    </span>
                  </div>
                  <p className="text-xs text-slate-700 italic pl-8">"{k.message}"</p>
                  <div className="text-[10px] text-slate-400 font-mono text-right">
                    {new Date(k.created_at).toLocaleDateString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 4: Daily Stand-up Generator */}
      {activeTab === 'standup' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700">
              Auto-Compiled Agile Stand-up Brief (Yesterday / Today / Blockers)
            </span>
            <button
              type="button"
              onClick={handleCopyStandup}
              disabled={!standupData?.standup_text}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              {copiedStandup ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedStandup ? 'Copied to Clipboard!' : 'Copy Stand-up Text'}</span>
            </button>
          </div>

          {isLoadingStandup ? (
            <div className="p-8 bg-white rounded-xl border border-slate-200 text-center text-xs text-slate-400 animate-pulse">
              Compiling deliverables, verified commits, and active blockers...
            </div>
          ) : (
            <div className="p-5 bg-slate-900 text-slate-200 rounded-xl font-mono text-xs whitespace-pre-wrap leading-relaxed shadow-md border border-slate-800">
              {standupData?.standup_text || 'Select a project to generate daily stand-up.'}
            </div>
          )}
        </div>
      )}

      {/* Record Meeting Modal */}
      <Modal
        isOpen={isCreateMeetingOpen}
        onClose={() => setIsCreateMeetingOpen(false)}
        title="Record Meeting Minutes & Action Items"
        subtitle="Capture decisions and synchronize tasks with team members."
      >
        <form onSubmit={handleSaveMeeting} className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Meeting Title *</label>
            <input
              type="text"
              required
              value={meetTitle}
              onChange={(e) => setMeetTitle(e.target.value)}
              placeholder="e.g. Sprint 2 Planning & Blocker Sync"
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg text-slate-900"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Meeting Date</label>
              <input
                type="date"
                value={meetDate}
                onChange={(e) => setMeetDate(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Attendees</label>
              <input
                type="text"
                value={meetAttendees}
                onChange={(e) => setMeetAttendees(e.target.value)}
                placeholder="Elena, Marcus, Devon"
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg text-slate-900"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Discussion & Decisions *</label>
            <textarea
              required
              rows={4}
              value={meetContent}
              onChange={(e) => setMeetContent(e.target.value)}
              placeholder="Summary of architectural discussions, agreements, or technical changes..."
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg text-slate-900 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Assigned Action Items</label>
            <textarea
              rows={2}
              value={meetActionItems}
              onChange={(e) => setMeetActionItems(e.target.value)}
              placeholder="1. Marcus to update lock timeout\n2. Elena to review IAM specs"
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg text-slate-900 resize-none"
            />
          </div>

          <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsCreateMeetingOpen(false)}
              className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSavingMeeting}
              className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-2xs"
            >
              {isSavingMeeting ? 'Saving...' : 'Save Meeting Minutes'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
