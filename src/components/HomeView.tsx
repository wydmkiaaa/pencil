import React, { useMemo, useState } from 'react';
import { Bell, Check, Clock, Plus, Trash2 } from 'lucide-react';
import {
  createDailyGoal,
  createTask,
  deleteDailyGoal,
  deleteTask,
  toggleDailyGoal,
  updateTaskRating,
  updateTaskStatus,
} from '../lib/studyRepo';
import { formatDurationShort, getDateKey, getGreetingLabel } from '../lib/spacedRepetition';
import { PastelSelect } from './PastelSelect';
import {
  HARDNESS_LABELS,
  HARDNESS_ORDER_WEIGHT,
  PRIORITY_LABELS,
  PRIORITY_ORDER_WEIGHT,
  type DailyGoal,
  type DifficultyLevel,
  type Flashcard,
  type FocusSession,
  type NavTabId,
  type StudyTask,
  type Subject,
  type TaskPriority,
  type TaskStatus,
  type UserProfile,
} from '../types/study';

interface HomeViewProps {
  uid: string;
  profile: UserProfile;
  tasks: StudyTask[];
  dailyGoals: DailyGoal[];
  subjects: Subject[];
  sessions: FocusSession[];
  flashcards: Flashcard[];
  onNavigate: (tab: NavTabId) => void;
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: 'Not Started',
  working: 'Working',
  completed: 'Completed',
};

type TaskSortBy = 'newest' | 'priority' | 'hardness';

export const HomeView: React.FC<HomeViewProps> = ({
  uid,
  profile,
  tasks,
  dailyGoals,
  subjects,
  sessions,
  flashcards,
  onNavigate,
}) => {
  const todayKey = getDateKey();
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | TaskPriority>('all');
  const [hardnessFilter, setHardnessFilter] = useState<'all' | DifficultyLevel>('all');
  const [sortBy, setSortBy] = useState<TaskSortBy>('priority');

  // New task state
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskNotes, setTaskNotes] = useState('');
  const [taskPriority, setTaskPriority] = useState<TaskPriority>('medium');
  const [taskHardness, setTaskHardness] = useState<DifficultyLevel>('medium');
  const [taskSubjectId, setTaskSubjectId] = useState('');
  const [taskDueAt, setTaskDueAt] = useState('');
  const [taskReminderAt, setTaskReminderAt] = useState('');
  const [savingTask, setSavingTask] = useState(false);

  // New daily goal state
  const [goalTitle, setGoalTitle] = useState('');
  const [savingGoal, setSavingGoal] = useState(false);

  const subjectMap = useMemo(() => {
    const map = new Map<string, Subject>();
    subjects.forEach((s) => map.set(s.id, s));
    return map;
  }, [subjects]);

  const todayGoals = useMemo(
    () => dailyGoals.filter((g) => g.targetDate === todayKey),
    [dailyGoals, todayKey],
  );

  const todayBreakdown = useMemo(() => {
    let focusRoomSeconds = 0;
    let activeRecallSeconds = 0;
    sessions.forEach((s) => {
      if (s.dateKey !== todayKey) return;
      if (s.contextType === 'active_recall' || s.mode === 'flashcards' || s.mode === 'blurting') {
        activeRecallSeconds += s.durationSeconds;
      } else {
        focusRoomSeconds += s.durationSeconds;
      }
    });
    return {
      total: focusRoomSeconds + activeRecallSeconds,
      focusRoomSeconds,
      activeRecallSeconds,
    };
  }, [sessions, todayKey]);

  const todayGoalProgressPct = Math.min(
    100,
    Math.round((todayBreakdown.total / Math.max(1, profile.dailyGoalMinutes * 60)) * 100),
  );

  const dueFlashcardsCount = useMemo(() => {
    const nowIso = new Date().toISOString();
    return flashcards.filter((c) => c.nextReviewAt <= nowIso).length;
  }, [flashcards]);

  const filteredTasks = useMemo(() => {
    const list = tasks.filter((t) => {
      const cardHardness: DifficultyLevel = t.hardness || 'medium';
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
      if (hardnessFilter !== 'all' && cardHardness !== hardnessFilter) return false;
      return true;
    });

    if (sortBy === 'priority') {
      return [...list].sort((a, b) => {
        const pDiff = PRIORITY_ORDER_WEIGHT[b.priority] - PRIORITY_ORDER_WEIGHT[a.priority];
        if (pDiff !== 0) return pDiff;
        return (
          HARDNESS_ORDER_WEIGHT[b.hardness || 'medium'] -
          HARDNESS_ORDER_WEIGHT[a.hardness || 'medium']
        );
      });
    }
    if (sortBy === 'hardness') {
      return [...list].sort((a, b) => {
        const hDiff =
          HARDNESS_ORDER_WEIGHT[b.hardness || 'medium'] -
          HARDNESS_ORDER_WEIGHT[a.hardness || 'medium'];
        if (hDiff !== 0) return hDiff;
        return PRIORITY_ORDER_WEIGHT[b.priority] - PRIORITY_ORDER_WEIGHT[a.priority];
      });
    }
    return list;
  }, [tasks, statusFilter, priorityFilter, hardnessFilter, sortBy]);

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    setSavingTask(true);
    try {
      await createTask(uid, {
        title: taskTitle,
        notes: taskNotes,
        priority: taskPriority,
        hardness: taskHardness,
        subjectId: taskSubjectId,
        dueAt: taskDueAt,
        reminderAt: taskReminderAt,
      });
      setTaskTitle('');
      setTaskNotes('');
      setTaskPriority('medium');
      setTaskHardness('medium');
      setTaskSubjectId('');
      setTaskDueAt('');
      setTaskReminderAt('');
      setShowTaskForm(false);
    } finally {
      setSavingTask(false);
    }
  };

  const handleAddGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goalTitle.trim()) return;
    setSavingGoal(true);
    try {
      await createDailyGoal(uid, goalTitle, todayKey);
      setGoalTitle('');
    } finally {
      setSavingGoal(false);
    }
  };

  const firstName = profile.displayName.split(' ')[0] || profile.displayName;
  const greeting = getGreetingLabel();
  const formattedToday = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="space-y-8">
      {/* Greeting sitting cleanly on the canvas + metrics strip */}
      <section className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="space-y-1.5">
            <div className="text-xs font-bold text-[var(--pastel-muted)] tracking-wide">
              <span>{formattedToday}</span>
              <span aria-hidden="true"> · </span>
              <span>Daily Desk</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-balance">
              {greeting}, {firstName}
            </h1>
            <p className="text-sm font-semibold text-[var(--pastel-muted)] max-w-xl leading-relaxed">
              Keep today light and deliberate. Prioritize tasks by urgency and hardness, check off daily goals, and log focused or active recall study.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('focus')}
              className="px-5 py-2.5 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold hover:opacity-90 transition-opacity cursor-pointer whitespace-nowrap"
            >
              Open Focus Space
            </button>
            <button
              type="button"
              onClick={() => onNavigate('rooms')}
              className="px-5 py-2.5 rounded-full bg-[var(--pastel-surface)] border border-[var(--pastel-border)] text-xs font-bold hover:bg-[var(--pastel-soft)] transition-colors cursor-pointer whitespace-nowrap"
            >
              Study Rooms
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-stretch">
          <div className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-5 flex flex-col justify-between gap-2.5 min-h-[124px]">
            <div className="text-xs font-bold text-[var(--pastel-muted)]">Today&apos;s Study</div>
            <div className="text-2xl font-extrabold font-mono-tabular">
              {formatDurationShort(todayBreakdown.total)}
              <span className="text-xs font-semibold text-[var(--pastel-muted)]">
                {' '}
                / {formatDurationShort(profile.dailyGoalMinutes * 60)}
              </span>
            </div>
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-[var(--pastel-muted)] font-mono-tabular">
                Focus/Rooms {formatDurationShort(todayBreakdown.focusRoomSeconds)} · Active Recall{' '}
                {formatDurationShort(todayBreakdown.activeRecallSeconds)}
              </div>
              <div className="h-2 rounded-full bg-[var(--pastel-soft)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[var(--pastel-accent)] transition-all"
                  style={{ width: `${todayGoalProgressPct}%` }}
                />
              </div>
            </div>
          </div>

          <div className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-5 flex flex-col justify-between gap-3 min-h-[124px]">
            <div className="text-xs font-bold text-[var(--pastel-muted)]">Active Tasks</div>
            <div className="text-2xl font-extrabold font-mono-tabular">
              {tasks.filter((t) => t.status !== 'completed').length}
            </div>
            <div className="text-xs font-semibold text-[var(--pastel-muted)]">
              {tasks.filter((t) => t.status === 'working').length} working ·{' '}
              {tasks.filter((t) => t.status === 'completed').length} completed
            </div>
          </div>

          <div className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-5 flex flex-col justify-between gap-3 min-h-[124px]">
            <div className="text-xs font-bold text-[var(--pastel-muted)]">Cards Due Today</div>
            <div className="text-2xl font-extrabold font-mono-tabular">{dueFlashcardsCount}</div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[var(--pastel-muted)]">
                {flashcards.length} total in deck
              </span>
              {dueFlashcardsCount > 0 && (
                <button
                  type="button"
                  onClick={() => onNavigate('review')}
                  className="font-bold underline underline-offset-4 text-[var(--pastel-ink)] hover:opacity-75 cursor-pointer whitespace-nowrap"
                >
                  Review now
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Main Split: To-Do Tasks & Daily Study Goals */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* To-Do List */}
        <section className="lg:col-span-8 bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold tracking-tight">Study Tasks</h2>
              <p className="text-xs text-[var(--pastel-muted)]">
                Set priority and hardness levels, configure reminders, and track task status.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowTaskForm((prev) => !prev)}
              className="px-4 py-2 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold hover:opacity-90 transition-opacity flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{showTaskForm ? 'Close' : 'Add Task'}</span>
            </button>
          </div>

          {showTaskForm && (
            <form
              onSubmit={handleAddTask}
              className="p-5 rounded-2xl bg-[var(--pastel-canvas)] border border-[var(--pastel-border)] space-y-3"
            >
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <input
                  type="text"
                  required
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  placeholder="Task title (e.g., Complete Organic Chem Ch. 4)"
                  maxLength={200}
                  className="sm:col-span-6 px-4 py-2 text-sm rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-surface)] focus:outline-none"
                />
                <PastelSelect
                  value={taskPriority}
                  onChange={(val) => setTaskPriority(val as TaskPriority)}
                  ariaLabel="Task priority"
                  variant="field"
                  className="sm:col-span-3 w-full"
                  options={[
                    { value: 'high', label: 'High Priority' },
                    { value: 'medium', label: 'Medium Priority' },
                    { value: 'low', label: 'Low Priority' },
                  ]}
                />
                <PastelSelect
                  value={taskHardness}
                  onChange={(val) => setTaskHardness(val as DifficultyLevel)}
                  ariaLabel="Task hardness"
                  variant="field"
                  className="sm:col-span-3 w-full"
                  options={[
                    { value: 'hard', label: 'Hard' },
                    { value: 'medium', label: 'Mid Hardness' },
                    { value: 'easy', label: 'Easy' },
                  ]}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <PastelSelect
                  value={taskSubjectId}
                  onChange={setTaskSubjectId}
                  ariaLabel="Task subject"
                  variant="field"
                  className="w-full self-end"
                  options={[
                    { value: '', label: 'No specific subject' },
                    ...subjects.map((s) => ({ value: s.id, label: s.name, color: s.color })),
                  ]}
                />
                <div className="space-y-1">
                  <label className="block text-[11px] text-[var(--pastel-muted)]">Due date &amp; time</label>
                  <input
                    type="datetime-local"
                    value={taskDueAt}
                    onChange={(e) => setTaskDueAt(e.target.value)}
                    className="w-full px-3.5 py-1.5 text-xs rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-surface)] focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-[11px] text-[var(--pastel-muted)]">App reminder</label>
                  <input
                    type="datetime-local"
                    value={taskReminderAt}
                    onChange={(e) => setTaskReminderAt(e.target.value)}
                    className="w-full px-3.5 py-1.5 text-xs rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-surface)] focus:outline-none"
                  />
                </div>
              </div>

              <input
                type="text"
                value={taskNotes}
                onChange={(e) => setTaskNotes(e.target.value)}
                placeholder="Optional note or page numbers..."
                maxLength={1000}
                className="w-full px-4 py-2 text-sm rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-surface)] focus:outline-none"
              />

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowTaskForm(false)}
                  className="px-4 py-2 rounded-full text-xs font-bold text-[var(--pastel-muted)] hover:text-[var(--pastel-ink)] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingTask}
                  className="px-5 py-2 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold hover:opacity-90 cursor-pointer disabled:opacity-50"
                >
                  {savingTask ? 'Saving...' : 'Save Task'}
                </button>
              </div>
            </form>
          )}

          {/* Filter & sort controls */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 p-1 bg-[var(--pastel-soft)] rounded-full overflow-x-auto max-w-full">
              {(['all', 'not_started', 'working', 'completed'] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={`px-3.5 py-1.5 text-xs font-bold rounded-full transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    statusFilter === status
                      ? 'bg-[var(--pastel-surface)] text-[var(--pastel-ink)] shadow-xs'
                      : 'text-[var(--pastel-muted)] hover:text-[var(--pastel-ink)]'
                  }`}
                >
                  {status === 'all' ? 'All' : STATUS_LABELS[status]}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <PastelSelect
                value={priorityFilter}
                onChange={(val) => setPriorityFilter(val as 'all' | TaskPriority)}
                ariaLabel="Filter by priority"
                variant="pill"
                align="right"
                className="min-w-[130px]"
                options={[
                  { value: 'all', label: 'All Priorities' },
                  { value: 'high', label: 'High Priority' },
                  { value: 'medium', label: 'Medium Priority' },
                  { value: 'low', label: 'Low Priority' },
                ]}
              />
              <PastelSelect
                value={hardnessFilter}
                onChange={(val) => setHardnessFilter(val as 'all' | DifficultyLevel)}
                ariaLabel="Filter by hardness"
                variant="pill"
                align="right"
                className="min-w-[120px]"
                options={[
                  { value: 'all', label: 'All Hardness' },
                  { value: 'hard', label: 'Hard' },
                  { value: 'medium', label: 'Mid' },
                  { value: 'easy', label: 'Easy' },
                ]}
              />
              <PastelSelect
                value={sortBy}
                onChange={(val) => setSortBy(val as TaskSortBy)}
                ariaLabel="Sort tasks"
                variant="pill"
                align="right"
                className="min-w-[130px]"
                options={[
                  { value: 'priority', label: 'Priority First' },
                  { value: 'hardness', label: 'Hardest First' },
                  { value: 'newest', label: 'Newest First' },
                ]}
              />
            </div>
          </div>

          {/* Task rows */}
          <div className="divide-y divide-[var(--pastel-border)]">
            {filteredTasks.length === 0 ? (
              <div className="py-10 text-center space-y-2">
                <p className="text-sm font-medium">No tasks match this filter</p>
                <p className="text-xs text-[var(--pastel-muted)]">
                  Add a study task with priority and hardness ratings to organize your day.
                </p>
              </div>
            ) : (
              filteredTasks.map((task) => {
                const subj = task.subjectId ? subjectMap.get(task.subjectId) : undefined;
                const hardness: DifficultyLevel = task.hardness || 'medium';
                return (
                  <div
                    key={task.id}
                    className="py-3.5 flex flex-col gap-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2.5">
                          {subj && (
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: subj.color }}
                              title={subj.name}
                            />
                          )}
                          <span
                            className={`text-sm font-medium truncate ${
                              task.status === 'completed' ? 'line-through text-[var(--pastel-muted)]' : ''
                            }`}
                          >
                            {task.title}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--pastel-muted)]">
                          <span
                            className={
                              task.priority === 'high'
                                ? 'text-red-700 font-semibold'
                                : task.priority === 'medium'
                                  ? 'text-amber-700 font-semibold'
                                  : 'font-medium'
                            }
                          >
                            {PRIORITY_LABELS[task.priority]} priority
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-medium text-[var(--pastel-ink)]">
                            {HARDNESS_LABELS[hardness]} hardness
                          </span>
                          {subj && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{subj.name}</span>
                            </>
                          )}
                          {task.dueAt && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="inline-flex items-center gap-1 font-mono-tabular">
                                <Clock className="w-3 h-3" />
                                Due{' '}
                                {new Date(task.dueAt).toLocaleString([], {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </>
                          )}
                          {task.reminderAt && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="inline-flex items-center gap-1 font-mono-tabular">
                                <Bell className="w-3 h-3" />
                                Remind{' '}
                                {new Date(task.reminderAt).toLocaleString([], {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </>
                          )}
                        </div>
                        {task.notes && (
                          <p className="text-xs text-[var(--pastel-muted)] line-clamp-1">{task.notes}</p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <PastelSelect
                          value={task.priority}
                          onChange={(val) =>
                            void updateTaskRating(uid, task.id, val as TaskPriority, hardness)
                          }
                          ariaLabel={`Priority for ${task.title}`}
                          variant="pill"
                          className="min-w-[96px]"
                          options={[
                            { value: 'high', label: 'High' },
                            { value: 'medium', label: 'Mid Prio' },
                            { value: 'low', label: 'Low' },
                          ]}
                        />
                        <PastelSelect
                          value={hardness}
                          onChange={(val) =>
                            void updateTaskRating(uid, task.id, task.priority, val as DifficultyLevel)
                          }
                          ariaLabel={`Hardness for ${task.title}`}
                          variant="pill"
                          className="min-w-[84px]"
                          options={[
                            { value: 'hard', label: 'Hard' },
                            { value: 'medium', label: 'Mid' },
                            { value: 'easy', label: 'Easy' },
                          ]}
                        />
                        <div className="flex items-center gap-1 p-1 bg-[var(--pastel-soft)] rounded-full">
                          {(['not_started', 'working', 'completed'] as const).map((st) => (
                            <button
                              key={st}
                              type="button"
                              onClick={() => void updateTaskStatus(uid, task.id, st)}
                              className={`px-2.5 py-1 text-[11px] font-bold rounded-full transition-colors whitespace-nowrap cursor-pointer ${
                                task.status === st
                                  ? 'bg-[var(--pastel-surface)] text-[var(--pastel-ink)] shadow-xs'
                                  : 'text-[var(--pastel-muted)] hover:text-[var(--pastel-ink)]'
                              }`}
                            >
                              {STATUS_LABELS[st]}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => void deleteTask(uid, task.id)}
                          aria-label="Delete task"
                          className="p-1.5 rounded-full text-[var(--pastel-muted)] hover:text-red-600 hover:bg-[var(--pastel-soft)] transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Daily Study Goals */}
        <section className="lg:col-span-4 bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-5">
          <div className="space-y-1">
            <h2 className="text-lg font-extrabold tracking-tight">Daily Study Goals</h2>
            <p className="text-xs text-[var(--pastel-muted)]">
              Set clear intentions for today ({todayGoals.filter((g) => g.completed).length}/{todayGoals.length} complete).
            </p>
          </div>

          <form onSubmit={handleAddGoal} className="flex items-center gap-2">
            <input
              type="text"
              value={goalTitle}
              onChange={(e) => setGoalTitle(e.target.value)}
              placeholder="Add a goal for today..."
              maxLength={160}
              className="flex-1 px-4 py-2.5 text-sm rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
            />
            <button
              type="submit"
              disabled={savingGoal || !goalTitle.trim()}
              className="w-10 h-10 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] hover:opacity-90 transition-opacity flex items-center justify-center cursor-pointer disabled:opacity-40 shrink-0"
              aria-label="Add daily goal"
            >
              <Plus className="w-4 h-4" />
            </button>
          </form>

          <div className="divide-y divide-[var(--pastel-border)]">
            {todayGoals.length === 0 ? (
              <p className="py-6 text-xs text-[var(--pastel-muted)] text-center">
                No study goals added for today yet.
              </p>
            ) : (
              todayGoals.map((goal) => (
                <div key={goal.id} className="py-3 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => void toggleDailyGoal(uid, goal.id, !goal.completed)}
                    className="flex items-center gap-3 text-left min-w-0 flex-1 cursor-pointer"
                  >
                    <span
                      className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                        goal.completed
                          ? 'bg-[var(--pastel-accent)] border-[var(--pastel-accent)] text-[var(--pastel-accent-ink)]'
                          : 'border-[var(--pastel-border)] bg-[var(--pastel-canvas)]'
                      }`}
                    >
                      {goal.completed && <Check className="w-3.5 h-3.5" />}
                    </span>
                    <span
                      className={`text-sm truncate ${
                        goal.completed ? 'line-through text-[var(--pastel-muted)]' : ''
                      }`}
                    >
                      {goal.title}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteDailyGoal(uid, goal.id)}
                    aria-label="Remove goal"
                    className="p-1 text-[var(--pastel-muted)] hover:text-red-600 transition-colors cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
