import React, { useState } from 'react';
import {
  CheckSquare,
  Plus,
  Search,
  Filter,
  ArrowUpDown,
  Kanban,
  List as ListIcon,
  Calendar,
  AlertTriangle,
  User as UserIcon,
  Clock,
  Edit2,
  Trash2,
  AlertCircle,
  Crown,
  Bookmark,
  Bug,
  Zap,
  Users,
  Github,
  Layers,
  ChevronRight,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  ArrowRight
} from 'lucide-react';
import { Task, TaskPriority, TaskStatus, IssueType, Project, TeamMember, User } from '../../types';
import { api } from '../../api/client';
import { isTaskOverdue } from '../../utils/contribution';
import { Modal } from '../common/Modal';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { Avatar } from '../common/Avatar';
import { JiraIssueDetailModal } from './JiraIssueDetailModal';
import { ProjectLeaderModal } from '../projects/ProjectLeaderModal';
import { MemberGitHubModal } from '../github/MemberGitHubModal';

interface TasksPageProps {
  tasks: Task[];
  projects: Project[];
  team: TeamMember[];
  selectedProjectId: string;
  onSelectProject: (id: string) => void;
  onCreateTask: (data: Partial<Task>) => Promise<void>;
  onUpdateTask: (id: string, data: Partial<Task>) => Promise<void>;
  onDeleteTask: (id: string) => Promise<void>;
  currentUser?: User | null;
  onRefreshData?: () => Promise<void>;
}

export const TasksPage: React.FC<TasksPageProps> = ({
  tasks,
  projects,
  team,
  selectedProjectId,
  onSelectProject,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  currentUser,
  onRefreshData
}) => {
  const [viewMode, setViewMode] = useState<'kanban' | 'backlog' | 'list' | 'calendar' | 'timeline'>('kanban');
  const [selectedDependencies, setSelectedDependencies] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'due_date' | 'priority' | 'created_at'>('due_date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Modal states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [inspectingTask, setInspectingTask] = useState<Task | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Jira Project Leader & GitHub modals
  const [isLeaderModalOpen, setIsLeaderModalOpen] = useState(false);
  const [isGitHubModalOpen, setIsGitHubModalOpen] = useState(false);

  // Drag and drop state
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverLane, setDragOverLane] = useState<TaskStatus | null>(null);

  // Form states for creating new issue
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState(selectedProjectId || (projects[0]?.id ?? ''));
  const [priority, setPriority] = useState<TaskPriority>('Medium');
  const [status, setStatus] = useState<TaskStatus>('To Do');
  const [issueType, setIssueType] = useState<IssueType>('Story');
  const [storyPoints, setStoryPoints] = useState<number>(3);
  const [sprint, setSprint] = useState<string>('Sprint 1 (Active)');
  const [dueDate, setDueDate] = useState('');
  const [assigneeId, setAssigneeId] = useState<string>('');
  const [estimatedHours, setEstimatedHours] = useState<string>('0');

  const now = new Date();
  const currentProject = projects.find(p => p.id === selectedProjectId) || projects[0] || null;

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setProjectId(selectedProjectId || (projects[0]?.id ?? ''));
    setPriority('Medium');
    setStatus('To Do');
    setIssueType('Story');
    setStoryPoints(3);
    setSprint(currentProject?.current_sprint || 'Sprint 1 (Active)');
    setDueDate('');
    setAssigneeId('');
    setEstimatedHours('0');
    setSelectedDependencies([]);
    setFormError(null);
  };

  const handleOpenCreate = () => {
    resetForm();
    setIsCreateOpen(true);
  };

  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setFormError('Task title / summary is required.');
      return;
    }
    if (!projectId) {
      setFormError('Please select a valid project.');
      return;
    }

    setIsSubmitting(true);
    setFormError(null);
    try {
      await onCreateTask({
        title: title.trim(),
        description: description.trim() || undefined,
        project_id: projectId,
        priority,
        status,
        issue_type: issueType,
        story_points: Number(storyPoints) || 0,
        sprint: sprint || currentProject?.current_sprint || 'Sprint 1 (Active)',
        due_date: dueDate || undefined,
        assignee_id: assigneeId || null,
        estimated_hours: parseFloat(estimatedHours) || 0,
        dependencies: selectedDependencies
      });
      setIsCreateOpen(false);
      resetForm();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save issue.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingTaskId) return;
    setIsSubmitting(true);
    try {
      await onDeleteTask(deletingTaskId);
      setDeletingTaskId(null);
      if (inspectingTask?.id === deletingTaskId) {
        setInspectingTask(null);
      }
    } catch (err: any) {
      alert(`Error deleting task: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickStatusMove = async (task: Task, newStatus: TaskStatus) => {
    try {
      await onUpdateTask(task.id, { status: newStatus });
      if (inspectingTask && inspectingTask.id === task.id) {
        setInspectingTask({ ...inspectingTask, status: newStatus });
      }
    } catch (err: any) {
      alert(`Error moving task: ${err.message}`);
    }
  };

  // Drag and Drop Handlers
  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('text/plain', taskId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedTaskId(taskId);
  };

  const handleDragOver = (e: React.DragEvent, laneId: TaskStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverLane !== laneId) {
      setDragOverLane(laneId);
    }
  };

  const handleDragLeave = (e: React.DragEvent, laneId: TaskStatus) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    if (dragOverLane === laneId) {
      setDragOverLane(null);
    }
  };

  const handleDrop = async (e: React.DragEvent, targetLane: TaskStatus) => {
    e.preventDefault();
    setDragOverLane(null);
    const taskId = e.dataTransfer.getData('text/plain') || draggedTaskId;
    setDraggedTaskId(null);

    if (!taskId) return;

    const taskToMove = tasks.find(t => t.id === taskId);
    if (!taskToMove || taskToMove.status === targetLane) return;

    try {
      await onUpdateTask(taskId, { status: targetLane });
    } catch (err: any) {
      alert(`Failed to update task status: ${err.message}`);
    }
  };

  // Filter tasks
  const filteredTasks = tasks.filter(t => {
    const matchesProject = !selectedProjectId || t.project_id === selectedProjectId;
    const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
    const matchesPriority = priorityFilter === 'all' || t.priority === priorityFilter;
    const matchesType = typeFilter === 'all' || (t.issue_type || 'Story') === typeFilter;
    const matchesAssignee =
      assigneeFilter === 'all' ||
      (assigneeFilter === 'unassigned' ? !t.assignee_id : t.assignee_id === assigneeFilter);
    const matchesSearch =
      t.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (t.description && t.description.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (t.issue_key && t.issue_key.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesProject && matchesStatus && matchesPriority && matchesType && matchesAssignee && matchesSearch;
  });

  // Sort tasks
  const sortedTasks = [...filteredTasks].sort((a, b) => {
    let comparison = 0;
    if (sortBy === 'priority') {
      const order = { High: 1, Medium: 2, Low: 3 };
      comparison = order[a.priority] - order[b.priority];
    } else if (sortBy === 'created_at') {
      comparison = (a.created_at || '').localeCompare(b.created_at || '');
    } else {
      if (!a.due_date && !b.due_date) comparison = 0;
      else if (!a.due_date) comparison = 1;
      else if (!b.due_date) comparison = -1;
      else comparison = a.due_date.localeCompare(b.due_date);
    }
    return sortOrder === 'asc' ? comparison : -comparison;
  });

  const lanes: { id: TaskStatus; label: string; count: number; color: string }[] = [
    { id: 'To Do', label: 'To Do', count: sortedTasks.filter(t => t.status === 'To Do' || (t.status as any) === 'Not Started').length, color: 'border-t-slate-400' },
    { id: 'In Progress', label: 'In Progress', count: sortedTasks.filter(t => t.status === 'In Progress').length, color: 'border-t-blue-500' },
    { id: 'In Review', label: 'In Review', count: sortedTasks.filter(t => t.status === 'In Review').length, color: 'border-t-amber-500' },
    { id: 'Done', label: 'Done', count: sortedTasks.filter(t => t.status === 'Done' || (t.status as any) === 'Completed').length, color: 'border-t-emerald-500' }
  ];

  // Group tasks for Backlog / Sprints view
  const activeSprintTasks = sortedTasks.filter(t => (t.sprint || 'Sprint 1 (Active)').includes('Active') || t.sprint === 'Sprint 1 (Active)');
  const backlogTasks = sortedTasks.filter(t => !activeSprintTasks.includes(t));
  const activeSprintPoints = activeSprintTasks.reduce((sum, t) => sum + (t.story_points || 3), 0);
  const backlogPoints = backlogTasks.reduce((sum, t) => sum + (t.story_points || 3), 0);

  const getIssueTypeIcon = (type?: IssueType) => {
    switch (type) {
      case 'Story':
        return <Bookmark className="w-3.5 h-3.5 text-emerald-600 shrink-0" />;
      case 'Bug':
        return <Bug className="w-3.5 h-3.5 text-rose-600 shrink-0" />;
      case 'Task':
        return <CheckSquare className="w-3.5 h-3.5 text-blue-600 shrink-0" />;
      case 'Epic':
        return <Zap className="w-3.5 h-3.5 text-purple-600 shrink-0" />;
      default:
        return <CheckSquare className="w-3.5 h-3.5 text-blue-600 shrink-0" />;
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Jira Project Leader & Context Banner */}
      {currentProject && (
        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold text-sm shadow-xs shrink-0 ring-1 ring-slate-800">
              {currentProject.key_prefix || 'EQX'}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-bold text-slate-900">{currentProject.name}</h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                  Jira Key: {currentProject.key_prefix || 'EQX'}
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                  {currentProject.current_sprint || 'Sprint 1 (Active)'}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                <span className="inline-flex items-center gap-1 font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                  <Crown className="w-3 h-3 text-amber-600" />
                  Leader: {currentProject.leader_name || 'Project Leader'}
                </span>
                <span>·</span>
                <span>{currentProject.members?.length || currentProject.member_ids?.length || 1} Assigned Teammates</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-start md:self-auto">
            {/* Manage Teammates Button (Leader Control) */}
            <button
              type="button"
              onClick={() => setIsLeaderModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-300 rounded-lg shadow-2xs transition-colors"
            >
              <Users className="w-3.5 h-3.5 text-blue-600" />
              <span>Manage Teammates</span>
            </button>

            {/* Connect Personal GitHub Button */}
            <button
              type="button"
              onClick={() => setIsGitHubModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-300 rounded-lg shadow-2xs transition-colors"
            >
              <Github className="w-3.5 h-3.5 text-slate-900" />
              <span>GitHub Dev</span>
            </button>

            <button
              type="button"
              onClick={handleOpenCreate}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-2xs transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Issue</span>
            </button>
          </div>
        </div>
      )}

      {/* Header & View Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <span>PULSE Agile Board</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Active sprints, drag-and-drop workflow lanes, story points, and real GitHub dev commits.
          </p>
        </div>

        {/* View Mode Switcher: Board, Backlog & Sprints, Table, Calendar, Timeline */}
        <div className="flex items-center p-0.5 bg-slate-100 rounded-lg border border-slate-200 overflow-x-auto">
          <button
            type="button"
            onClick={() => setViewMode('kanban')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
              viewMode === 'kanban'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Kanban className="w-3.5 h-3.5" />
            <span>Active Sprint</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('backlog')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
              viewMode === 'backlog'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Backlog</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
              viewMode === 'list'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ListIcon className="w-3.5 h-3.5" />
            <span>Table</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('calendar')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
              viewMode === 'calendar'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Calendar</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('timeline')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
              viewMode === 'timeline'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Timeline / Gantt</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs space-y-3">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search by issue key (e.g. EQX-101), summary, or description..."
              className="w-full pl-9 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Quick Filters */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
            {/* Issue Type filter */}
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-blue-500 shrink-0"
            >
              <option value="all">All Types</option>
              <option value="Story">Story</option>
              <option value="Task">Task</option>
              <option value="Bug">Bug</option>
              <option value="Epic">Epic</option>
            </select>

            {/* Status filter */}
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-blue-500 shrink-0"
            >
              <option value="all">All Statuses</option>
              <option value="To Do">To Do</option>
              <option value="In Progress">In Progress</option>
              <option value="In Review">In Review</option>
              <option value="Done">Done</option>
            </select>

            {/* Priority filter */}
            <select
              value={priorityFilter}
              onChange={e => setPriorityFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-blue-500 shrink-0"
            >
              <option value="all">All Priorities</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>

            {/* Assignee filter */}
            <select
              value={assigneeFilter}
              onChange={e => setAssigneeFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-blue-500 shrink-0"
            >
              <option value="all">All Assignees</option>
              <option value="unassigned">Unassigned</option>
              {team.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* VIEW MODE 1: KANBAN BOARD */}
      {viewMode === 'kanban' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {lanes.map(lane => {
            const laneTasks = sortedTasks.filter(t => t.status === lane.id);
            const isOver = dragOverLane === lane.id;

            return (
              <div
                key={lane.id}
                onDragOver={e => handleDragOver(e, lane.id)}
                onDragLeave={e => handleDragLeave(e, lane.id)}
                onDrop={e => handleDrop(e, lane.id)}
                className={`bg-slate-100/80 rounded-xl p-3 border-2 border-t-4 transition-all flex flex-col min-h-[500px] ${lane.color} ${
                  isOver ? 'border-dashed border-blue-500 bg-blue-50/50' : 'border-slate-200'
                }`}
              >
                {/* Lane Header */}
                <div className="flex items-center justify-between pb-3 mb-2 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                      {lane.label}
                    </span>
                    <span className="text-[11px] font-mono text-slate-500 bg-white px-2 py-0.5 rounded-full border border-slate-200">
                      {lane.count}
                    </span>
                  </div>
                </div>

                {/* Cards Container */}
                <div className="space-y-2.5 flex-1 overflow-y-auto pr-0.5">
                  {laneTasks.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg mt-2">
                      Drop deliverable here
                    </div>
                  ) : (
                    laneTasks.map(task => {
                      const assignee = team.find(m => m.id === task.assignee_id);
                      const overdue = isTaskOverdue(
                        { status: task.status, dueDate: task.due_date },
                        now
                      );
                      const key = task.issue_key || `EQX-${task.id.replace('t-', '')}`;

                      return (
                        <div
                          key={task.id}
                          draggable
                          onDragStart={e => handleDragStart(e, task.id)}
                          onClick={() => setInspectingTask(task)}
                          className="bg-white p-3.5 rounded-xl border border-slate-200 hover:border-blue-400 hover:shadow-md transition-all cursor-pointer group space-y-2.5"
                        >
                          {/* Jira Key & Priority Row */}
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-1.5 font-mono">
                              {getIssueTypeIcon(task.issue_type)}
                              <span className="text-blue-600 font-bold hover:underline">
                                {key}
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5">
                              {/* Story points badge */}
                              <span className="w-5 h-5 rounded bg-slate-100 text-slate-700 font-bold text-[10px] flex items-center justify-center border border-slate-200" title="Story Points">
                                {task.story_points || 3}
                              </span>

                              {/* Priority */}
                              <span
                                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                                  task.priority === 'High'
                                    ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                    : task.priority === 'Medium'
                                    ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                    : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                }`}
                              >
                                {task.priority}
                              </span>
                            </div>
                          </div>

                          {/* Title */}
                          <div className="text-xs font-semibold text-slate-900 group-hover:text-blue-600 transition-colors line-clamp-2">
                            {task.title}
                          </div>

                          {/* Footer: Due date & Assignee */}
                          <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-100 text-slate-500">
                            {task.due_date ? (
                              <div
                                className={`flex items-center gap-1 ${
                                  overdue ? 'text-rose-600 font-medium' : 'text-slate-500'
                                }`}
                              >
                                {overdue ? (
                                  <AlertTriangle className="w-3 h-3 text-rose-500 shrink-0" />
                                ) : (
                                  <Calendar className="w-3 h-3 text-slate-400 shrink-0" />
                                )}
                                <span>{task.due_date}</span>
                              </div>
                            ) : (
                              <span>No deadline</span>
                            )}

                            {assignee ? (
                              <div className="flex items-center gap-1" title={assignee.name}>
                                <Avatar name={assignee.name} avatarUrl={assignee.avatar_url} size="xs" />
                                <span className="truncate max-w-[80px] text-[10px]">{assignee.name.split(' ')[0]}</span>
                              </div>
                            ) : (
                              <span className="text-slate-400 text-[10px]">Unassigned</span>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* VIEW MODE 2: JIRA BACKLOG & SPRINT PLANNING */}
      {viewMode === 'backlog' && (
        <div className="space-y-6">
          {/* Active Sprint Section */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="text-sm font-bold text-slate-900">
                  {currentProject?.current_sprint || 'Sprint 1 (Active)'}
                </span>
                <span className="text-xs text-slate-500">
                  · {activeSprintTasks.length} issues · {activeSprintPoints} story points
                </span>
              </div>
              <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-200">
                Active Sprint
              </span>
            </div>

            <div className="divide-y divide-slate-100">
              {activeSprintTasks.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  No issues in active sprint. Move issues from Backlog below!
                </div>
              ) : (
                activeSprintTasks.map(task => {
                  const assignee = team.find(m => m.id === task.assignee_id);
                  const key = task.issue_key || `EQX-${task.id.replace('t-', '')}`;

                  return (
                    <div
                      key={task.id}
                      onClick={() => setInspectingTask(task)}
                      className="p-3.5 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {getIssueTypeIcon(task.issue_type)}
                        <span className="text-xs font-mono font-bold text-blue-600 hover:underline shrink-0">
                          {key}
                        </span>
                        <span className="text-xs font-medium text-slate-900 truncate">
                          {task.title}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                          {task.status}
                        </span>
                        <span className="w-6 h-6 rounded bg-blue-50 text-blue-700 font-bold text-xs flex items-center justify-center border border-blue-200">
                          {task.story_points || 3}
                        </span>
                        {assignee ? (
                          <Avatar
                            name={assignee.name}
                            avatarUrl={assignee.avatar_url}
                            size="xs"
                          />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center text-[10px]">
                            ?
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Backlog Section */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Layers className="w-4 h-4 text-slate-500" />
                <span className="text-sm font-bold text-slate-900">Backlog</span>
                <span className="text-xs text-slate-500">
                  · {backlogTasks.length} issues · {backlogPoints} story points
                </span>
              </div>
              <button
                type="button"
                onClick={handleOpenCreate}
                className="text-xs font-semibold text-blue-600 hover:underline"
              >
                + Create Issue in Backlog
              </button>
            </div>

            <div className="divide-y divide-slate-100">
              {backlogTasks.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  Backlog is currently empty.
                </div>
              ) : (
                backlogTasks.map(task => {
                  const assignee = team.find(m => m.id === task.assignee_id);
                  const key = task.issue_key || `EQX-${task.id.replace('t-', '')}`;

                  return (
                    <div
                      key={task.id}
                      onClick={() => setInspectingTask(task)}
                      className="p-3.5 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {getIssueTypeIcon(task.issue_type)}
                        <span className="text-xs font-mono font-bold text-slate-600 hover:underline shrink-0">
                          {key}
                        </span>
                        <span className="text-xs font-medium text-slate-800 truncate">
                          {task.title}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdateTask(task.id, { sprint: currentProject?.current_sprint || 'Sprint 1 (Active)' });
                          }}
                          className="px-2.5 py-1 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 transition-colors flex items-center gap-1"
                        >
                          <span>Move to Sprint</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                        <span className="w-6 h-6 rounded bg-slate-100 text-slate-700 font-bold text-xs flex items-center justify-center border border-slate-200">
                          {task.story_points || 3}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* VIEW MODE 3: JIRA TABLE VIEW */}
      {viewMode === 'list' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Key</th>
                  <th className="px-4 py-3">Summary</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Points</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Assignee</th>
                  <th className="px-4 py-3">Due Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {sortedTasks.map(task => {
                  const assignee = team.find(m => m.id === task.assignee_id);
                  const key = task.issue_key || `EQX-${task.id.replace('t-', '')}`;

                  return (
                    <tr
                      key={task.id}
                      onClick={() => setInspectingTask(task)}
                      className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        {getIssueTypeIcon(task.issue_type)}
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-blue-600">
                        {key}
                      </td>
                      <td className="px-4 py-3 text-slate-900 font-semibold max-w-xs truncate">
                        {task.title}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700">
                          {task.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-slate-700">
                        {task.story_points || 3}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                            task.priority === 'High'
                              ? 'bg-rose-50 text-rose-700'
                              : task.priority === 'Medium'
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-emerald-50 text-emerald-700'
                          }`}
                        >
                          {task.priority}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {assignee ? (
                          <div className="flex items-center gap-1.5">
                            <Avatar name={assignee.name} avatarUrl={assignee.avatar_url} size="xs" />
                            <span className="truncate max-w-[100px]">{assignee.name}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400">Unassigned</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px]">
                        {task.due_date || 'N/A'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW MODE 4: INTERACTIVE CALENDAR VIEW */}
      {viewMode === 'calendar' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-600" />
                <span>Deliverables & Sprint Milestones Calendar</span>
              </h2>
              <p className="text-xs text-slate-500">
                Visualizing task completion commitments by delivery deadline.
              </p>
            </div>

            <a
              href={api.getCalendarExportUrl(selectedProjectId || undefined)}
              download="pulse_schedule.ics"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors self-start sm:self-auto"
            >
              <Calendar className="w-3.5 h-3.5 text-blue-600" />
              <span>Export iCal (.ics)</span>
            </a>
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-px bg-slate-200 border border-slate-200 rounded-xl overflow-hidden text-xs">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d} className="bg-slate-50 p-2 text-center font-bold text-slate-600 text-[11px]">
                {d}
              </div>
            ))}

            {/* Days generator for October 2026 (matching project dates) */}
            {Array.from({ length: 35 }).map((_, i) => {
              // Day offset: Oct 1 2026 is a Thursday (index 4)
              const dayNum = i - 3;
              const isCurrentMonth = dayNum >= 1 && dayNum <= 31;
              const dayStr = isCurrentMonth
                ? `2026-10-${dayNum < 10 ? '0' + dayNum : dayNum}`
                : '';
              const dayTasks = sortedTasks.filter((t) => t.due_date === dayStr);

              return (
                <div
                  key={i}
                  className={`min-h-[90px] p-1.5 flex flex-col justify-between transition-colors ${
                    isCurrentMonth ? 'bg-white hover:bg-slate-50/50' : 'bg-slate-100/60 text-slate-400'
                  }`}
                >
                  <div className="flex justify-between items-center text-[10px] font-mono font-semibold text-slate-500">
                    <span>{isCurrentMonth ? dayNum : ''}</span>
                    {dayTasks.length > 0 && (
                      <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-800 text-[9px] flex items-center justify-center font-bold">
                        {dayTasks.length}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1 mt-1 flex-1 overflow-y-auto max-h-20">
                    {dayTasks.map((t) => {
                      const overdue = isTaskOverdue({ status: t.status, dueDate: t.due_date }, now);
                      return (
                        <div
                          key={t.id}
                          onClick={() => setInspectingTask(t)}
                          className={`p-1 rounded text-[10px] cursor-pointer truncate font-medium border ${
                            t.status === 'Done'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200 line-through'
                              : overdue
                              ? 'bg-rose-50 text-rose-800 border-rose-200 font-bold'
                              : t.priority === 'High'
                              ? 'bg-amber-50 text-amber-800 border-amber-200'
                              : 'bg-blue-50 text-blue-800 border-blue-200'
                          }`}
                          title={`${t.issue_key || 'TASK'}: ${t.title}`}
                        >
                          <span className="font-mono font-bold mr-1">{t.issue_key || 'TSK'}:</span>
                          <span>{t.title}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VIEW MODE 5: TIMELINE & GANTT VIEW */}
      {viewMode === 'timeline' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Clock className="w-4 h-4 text-purple-600" />
                <span>Sprint Timeline & Dependency Gantt Chart</span>
              </h2>
              <p className="text-xs text-slate-500">
                Tracking critical path pacing, prerequisite dependencies, and delivery windows.
              </p>
            </div>

            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5 font-semibold text-slate-600">
                <span className="w-3 h-3 rounded bg-slate-400"></span>
                <span>To Do</span>
              </span>
              <span className="flex items-center gap-1.5 font-semibold text-blue-700">
                <span className="w-3 h-3 rounded bg-blue-500"></span>
                <span>In Progress</span>
              </span>
              <span className="flex items-center gap-1.5 font-semibold text-amber-700">
                <span className="w-3 h-3 rounded bg-amber-500"></span>
                <span>In Review</span>
              </span>
              <span className="flex items-center gap-1.5 font-semibold text-emerald-700">
                <span className="w-3 h-3 rounded bg-emerald-500"></span>
                <span>Done</span>
              </span>
            </div>
          </div>

          <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
            {sortedTasks.map((t) => {
              const assignee = team.find((m) => m.id === t.assignee_id);
              const isHigh = t.priority === 'High';
              const isBlocked = Boolean(t.is_blocked);

              return (
                <div
                  key={t.id}
                  onClick={() => setInspectingTask(t)}
                  className="p-3.5 hover:bg-slate-50 transition-colors cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0 md:w-1/2">
                    {getIssueTypeIcon(t.issue_type)}
                    <span className="font-mono font-bold text-blue-600 shrink-0">
                      {t.issue_key || 'EQX-100'}
                    </span>
                    <span className="font-semibold text-slate-900 truncate">{t.title}</span>
                    {isBlocked && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 shrink-0">
                        BLOCKED
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-4 shrink-0 md:w-1/2 justify-between md:justify-end">
                    {assignee ? (
                      <div className="flex items-center gap-1.5" title={assignee.name}>
                        <Avatar name={assignee.name} avatarUrl={assignee.avatar_url} size="xs" />
                        <span className="text-[11px] text-slate-600 truncate max-w-[80px]">
                          {assignee.name.split(' ')[0]}
                        </span>
                      </div>
                    ) : (
                      <span className="text-[11px] text-slate-400">Unassigned</span>
                    )}

                    {/* Timeline Bar representation */}
                    <div className="w-36 bg-slate-100 h-6 rounded-md overflow-hidden relative border border-slate-200">
                      <div
                        className={`h-full flex items-center px-2 text-[10px] font-bold text-white transition-all ${
                          t.status === 'Done' || (t.status as any) === 'Completed'
                            ? 'w-full bg-emerald-600'
                            : t.status === 'In Review'
                            ? 'w-3/4 bg-amber-600'
                            : t.status === 'In Progress'
                            ? 'w-1/2 bg-blue-600'
                            : 'w-1/4 bg-slate-400'
                        }`}
                      >
                        <span className="truncate">{t.status}</span>
                      </div>
                    </div>

                    <div className="text-[11px] font-mono text-slate-500 w-24 text-right">
                      {t.due_date || 'No Date'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Jira Issue Detail Drawer / Modal */}
      {inspectingTask && (
        <JiraIssueDetailModal
          task={inspectingTask}
          isOpen={true}
          onClose={() => setInspectingTask(null)}
          project={currentProject}
          team={team}
          onUpdateTask={async (id, data) => {
            await onUpdateTask(id, data);
            if (inspectingTask && inspectingTask.id === id) {
              setInspectingTask({ ...inspectingTask, ...data });
            }
          }}
          onDeleteTask={onDeleteTask}
          onOpenGitHubModal={() => setIsGitHubModalOpen(true)}
        />
      )}

      {/* Project Leader Modal */}
      {isLeaderModalOpen && currentProject && (
        <ProjectLeaderModal
          isOpen={true}
          onClose={() => setIsLeaderModalOpen(false)}
          project={currentProject}
          team={team}
          currentUserId={currentUser?.id}
          onProjectUpdated={async () => {
            if (onRefreshData) await onRefreshData();
          }}
        />
      )}

      {/* Personal GitHub Modal */}
      <MemberGitHubModal
        isOpen={isGitHubModalOpen}
        onClose={() => setIsGitHubModalOpen(false)}
        currentUser={currentUser || null}
        onProfileUpdated={async () => {
          if (onRefreshData) await onRefreshData();
        }}
      />

      {/* Create Issue Modal */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Create Deliverable Task"
      >
        <form onSubmit={handleSaveTask} className="space-y-4">
          {formError && (
            <div className="p-3 text-xs bg-rose-50 text-rose-700 border border-rose-200 rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Issue Type
              </label>
              <select
                value={issueType}
                onChange={e => setIssueType(e.target.value as IssueType)}
                className="w-full px-3 py-1.5 text-xs text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              >
                <option value="Story">Story</option>
                <option value="Task">Task</option>
                <option value="Bug">Bug</option>
                <option value="Epic">Epic</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Story Points
              </label>
              <select
                value={storyPoints}
                onChange={e => setStoryPoints(parseInt(e.target.value, 10))}
                className="w-full px-3 py-1.5 text-xs text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              >
                {[1, 2, 3, 5, 8, 13, 21].map(pts => (
                  <option key={pts} value={pts}>{pts} Points</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Summary / Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Implement distributed lock with SQLite WAL fallback"
              className="w-full px-3 py-1.5 text-xs text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Description & Acceptance Criteria
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              placeholder="Detailed description, steps to reproduce, or technical specifications..."
              className="w-full px-3 py-1.5 text-xs text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Project *
              </label>
              <select
                value={projectId}
                onChange={e => setProjectId(e.target.value)}
                className="w-full px-3 py-1.5 text-xs text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              >
                {projects.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.key_prefix || 'EQX'})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Assignee
              </label>
              <select
                value={assigneeId}
                onChange={e => setAssigneeId(e.target.value)}
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
                value={priority}
                onChange={e => setPriority(e.target.value as TaskPriority)}
                className="w-full px-3 py-1.5 text-xs text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Workflow Status
              </label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as TaskStatus)}
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
                Sprint
              </label>
              <select
                value={sprint}
                onChange={e => setSprint(e.target.value)}
                className="w-full px-3 py-1.5 text-xs text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              >
                <option value="Sprint 1 (Active)">Sprint 1 (Active)</option>
                <option value="Sprint 2 (Planning)">Sprint 2 (Planning)</option>
                <option value="Backlog">Backlog</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Due Date
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full px-3 py-1.5 text-xs text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Estimated Hours
              </label>
              <input
                type="number"
                min="0"
                step="0.5"
                value={estimatedHours}
                onChange={e => setEstimatedHours(e.target.value)}
                className="w-full px-3 py-1.5 text-xs text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Prerequisite Dependency (Task Blocks / Depends On)
            </label>
            <select
              onChange={(e) => {
                const val = e.target.value;
                if (val && !selectedDependencies.includes(val)) {
                  setSelectedDependencies([...selectedDependencies, val]);
                }
              }}
              className="w-full px-3 py-1.5 text-xs text-slate-900 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select prerequisite task (optional)...</option>
              {tasks.filter(t => t.project_id === projectId).map(t => (
                <option key={t.id} value={t.id}>
                  [{t.issue_key || 'TASK'}] {t.title}
                </option>
              ))}
            </select>

            {selectedDependencies.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {selectedDependencies.map(depId => {
                  const depTask = tasks.find(t => t.id === depId);
                  return (
                    <span key={depId} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-700 border border-slate-200 font-mono">
                      <span>{depTask?.issue_key || depId}</span>
                      <button
                        type="button"
                        onClick={() => setSelectedDependencies(selectedDependencies.filter(d => d !== depId))}
                        className="text-slate-400 hover:text-slate-700 font-bold ml-1"
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsCreateOpen(false)}
              className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-2xs transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Creating...' : 'Create Issue'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={Boolean(deletingTaskId)}
        title="Delete Deliverable Task"
        message="Are you sure you want to permanently delete this task? This cannot be undone."
        confirmLabel="Delete Deliverable"
        onConfirm={handleDeleteConfirm}
        onClose={() => setDeletingTaskId(null)}
        isLoading={isSubmitting}
      />
    </div>
  );
};
