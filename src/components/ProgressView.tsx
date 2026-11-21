import React, { useMemo, useState } from 'react';
import { formatDurationShort, getDateKey } from '../lib/spacedRepetition';
import { PastelSelect } from './PastelSelect';
import type { FocusSession, Subject, UserProfile } from '../types/study';

interface ProgressViewProps {
  profile: UserProfile;
  sessions: FocusSession[];
  subjects: Subject[];
}

type TimelineCategoryFilter = 'combined' | 'focus_rooms' | 'active_recall';

function isActiveRecallSession(s: FocusSession): boolean {
  return s.contextType === 'active_recall' || s.mode === 'flashcards' || s.mode === 'blurting';
}

export const ProgressView: React.FC<ProgressViewProps> = ({
  profile,
  sessions,
  subjects,
}) => {
  const [subjectFilter, setSubjectFilter] = useState<string>('all');
  const [timelineView, setTimelineView] = useState<TimelineCategoryFilter>('combined');

  const subjectFilteredSessions = useMemo(() => {
    if (subjectFilter === 'all') return sessions;
    return sessions.filter((s) => s.subjectId === subjectFilter);
  }, [sessions, subjectFilter]);

  const viewFilteredSessions = useMemo(() => {
    if (timelineView === 'combined') return subjectFilteredSessions;
    if (timelineView === 'active_recall') {
      return subjectFilteredSessions.filter((s) => isActiveRecallSession(s));
    }
    return subjectFilteredSessions.filter((s) => !isActiveRecallSession(s));
  }, [subjectFilteredSessions, timelineView]);

  const totals = useMemo(() => {
    let soloSeconds = 0;
    let roomSeconds = 0;
    let flashcardsSeconds = 0;
    let blurtingSeconds = 0;

    subjectFilteredSessions.forEach((s) => {
      if (isActiveRecallSession(s)) {
        if (s.mode === 'blurting') blurtingSeconds += s.durationSeconds;
        else flashcardsSeconds += s.durationSeconds;
      } else if (s.contextType === 'public_room' || s.contextType === 'private_room') {
        roomSeconds += s.durationSeconds;
      } else {
        soloSeconds += s.durationSeconds;
      }
    });

    const focusRoomSeconds = soloSeconds + roomSeconds;
    const activeRecallSeconds = flashcardsSeconds + blurtingSeconds;
    const combinedSeconds = focusRoomSeconds + activeRecallSeconds;

    return {
      combinedSeconds,
      focusRoomSeconds,
      soloSeconds,
      roomSeconds,
      activeRecallSeconds,
      flashcardsSeconds,
      blurtingSeconds,
    };
  }, [subjectFilteredSessions]);

  // Current daily streak (consecutive days with >= 1 study session across focus or recall)
  const streakDays = useMemo(() => {
    const daySet = new Set(sessions.map((s) => s.dateKey));
    let streak = 0;
    const cursor = new Date();
    for (let i = 0; i < 365; i++) {
      const key = getDateKey(cursor);
      if (daySet.has(key)) {
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
      } else if (i === 0) {
        cursor.setDate(cursor.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  }, [sessions]);

  // Last 14 days stacked bar series (Focus & Rooms vs Active Recall)
  const last14Days = useMemo(() => {
    const byDay = new Map<string, { focusRoomSec: number; recallSec: number }>();
    subjectFilteredSessions.forEach((s) => {
      const cur = byDay.get(s.dateKey) || { focusRoomSec: 0, recallSec: 0 };
      if (isActiveRecallSession(s)) {
        cur.recallSec += s.durationSeconds;
      } else {
        cur.focusRoomSec += s.durationSeconds;
      }
      byDay.set(s.dateKey, cur);
    });

    const days: Array<{
      dateKey: string;
      label: string;
      focusRoomMin: number;
      recallMin: number;
      shownMinutes: number;
    }> = [];

    for (let offset = 13; offset >= 0; offset--) {
      const d = new Date();
      d.setDate(d.getDate() - offset);
      const key = getDateKey(d);
      const rec = byDay.get(key) || { focusRoomSec: 0, recallSec: 0 };
      const focusRoomMin = Math.round(rec.focusRoomSec / 60);
      const recallMin = Math.round(rec.recallSec / 60);
      const shownMinutes =
        timelineView === 'combined'
          ? focusRoomMin + recallMin
          : timelineView === 'focus_rooms'
            ? focusRoomMin
            : recallMin;

      days.push({
        dateKey: key,
        label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        focusRoomMin,
        recallMin,
        shownMinutes,
      });
    }
    return days;
  }, [subjectFilteredSessions, timelineView]);

  // Last 35 days consistency grid
  const last35Days = useMemo(() => {
    const totalsByDay = new Map<string, number>();
    viewFilteredSessions.forEach((s) => {
      totalsByDay.set(s.dateKey, (totalsByDay.get(s.dateKey) || 0) + s.durationSeconds);
    });
    const grid: Array<{ dateKey: string; minutes: number }> = [];
    for (let offset = 34; offset >= 0; offset--) {
      const d = new Date();
      d.setDate(d.getDate() - offset);
      const key = getDateKey(d);
      grid.push({
        dateKey: key,
        minutes: Math.round((totalsByDay.get(key) || 0) / 60),
      });
    }
    return grid;
  }, [viewFilteredSessions]);

  // Per-subject breakdown (always across all subjects, showing Focus/Rooms & Active Recall split)
  const subjectBreakdown = useMemo(() => {
    const map = new Map<
      string,
      { name: string; color: string; focusRoomSec: number; recallSec: number; totalSec: number }
    >();
    sessions.forEach((s) => {
      const key = s.subjectId || 'general';
      const existing = map.get(key) || {
        name: s.subjectName || 'General Study',
        color: s.subjectColor || '#4B5563',
        focusRoomSec: 0,
        recallSec: 0,
        totalSec: 0,
      };
      if (isActiveRecallSession(s)) {
        existing.recallSec += s.durationSeconds;
      } else {
        existing.focusRoomSec += s.durationSeconds;
      }
      existing.totalSec += s.durationSeconds;
      map.set(key, existing);
    });
    return Array.from(map.values()).sort((a, b) => b.totalSec - a.totalSec);
  }, [sessions]);

  const maxMinutes14 = Math.max(
    profile.dailyGoalMinutes,
    ...last14Days.map((d) => d.shownMinutes),
    30,
  );
  const allTotalSeconds = sessions.reduce((acc, s) => acc + s.durationSeconds, 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Study Timeline &amp; Progress</h1>
          <p className="text-sm text-[var(--pastel-muted)]">
            Track Focus Room hours and Active Recall (Flashcards &amp; Blurting) both combined and separately.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1 p-1 bg-[var(--pastel-soft)] rounded-full">
            {(
              [
                { id: 'combined', label: 'Combined' },
                { id: 'focus_rooms', label: 'Focus & Rooms' },
                { id: 'active_recall', label: 'Active Recall' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setTimelineView(opt.id)}
                className={`px-3.5 py-1.5 text-xs font-bold rounded-full transition-colors whitespace-nowrap cursor-pointer ${
                  timelineView === opt.id
                    ? 'bg-[var(--pastel-surface)] text-[var(--pastel-ink)] shadow-xs'
                    : 'text-[var(--pastel-muted)] hover:text-[var(--pastel-ink)]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <PastelSelect
            value={subjectFilter}
            onChange={setSubjectFilter}
            ariaLabel="Filter progress by subject"
            variant="pill"
            align="right"
            className="min-w-[175px]"
            options={[
              { value: 'all', label: 'Overall (All Subjects)' },
              ...subjects.map((s) => ({ value: s.id, label: s.name, color: s.color })),
            ]}
          />
        </div>
      </div>

      {/* KPI Strip: Combined + Separate Focus/Rooms + Separate Active Recall */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-5 space-y-1.5">
          <div className="text-xs font-bold text-[var(--pastel-muted)]">Combined Study Time</div>
          <div className="text-2xl font-extrabold font-mono-tabular">
            {formatDurationShort(totals.combinedSeconds)}
          </div>
          <div className="text-[11px] text-[var(--pastel-muted)] font-mono-tabular">
            {subjectFilteredSessions.length} total sessions
          </div>
        </div>

        <div className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-5 space-y-1.5">
          <div className="text-xs font-bold text-[var(--pastel-muted)]">Focus &amp; Study Rooms</div>
          <div className="text-2xl font-extrabold font-mono-tabular">
            {formatDurationShort(totals.focusRoomSeconds)}
          </div>
          <div className="text-[11px] text-[var(--pastel-muted)] font-mono-tabular">
            Solo {formatDurationShort(totals.soloSeconds)} · Rooms{' '}
            {formatDurationShort(totals.roomSeconds)}
          </div>
        </div>

        <div className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-5 space-y-1.5">
          <div className="text-xs font-bold text-[var(--pastel-muted)]">Active Recall Time</div>
          <div className="text-2xl font-extrabold font-mono-tabular">
            {formatDurationShort(totals.activeRecallSeconds)}
          </div>
          <div className="text-[11px] text-[var(--pastel-muted)] font-mono-tabular">
            Cards {formatDurationShort(totals.flashcardsSeconds)} · Blurt{' '}
            {formatDurationShort(totals.blurtingSeconds)}
          </div>
        </div>

        <div className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-5 space-y-1.5">
          <div className="text-xs font-bold text-[var(--pastel-muted)]">Active Streak</div>
          <div className="text-2xl font-extrabold font-mono-tabular">
            {streakDays} {streakDays === 1 ? 'day' : 'days'}
          </div>
          <div className="text-[11px] text-[var(--pastel-muted)]">
            Daily goal {profile.dailyGoalMinutes}m
          </div>
        </div>
      </div>

      {/* 14-Day Study Bar Chart & 35-Day Consistency Heatmap */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <section className="lg:col-span-8 bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 flex flex-col justify-between gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-extrabold tracking-tight">Last 14 Days (Minutes)</h2>
              {timelineView === 'combined' && (
                <div className="flex items-center gap-4 pt-1 text-[11px] text-[var(--pastel-muted)]">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-[var(--pastel-accent)]" />
                    Focus &amp; Rooms
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600/80" />
                    Active Recall (Cards + Blurting)
                  </span>
                </div>
              )}
            </div>
            <span className="text-xs text-[var(--pastel-muted)] font-mono-tabular">
              Daily goal: {profile.dailyGoalMinutes}m
            </span>
          </div>

          <div className="h-52 flex items-end gap-1.5 sm:gap-2 pt-2">
            {last14Days.map((day, index) => {
              const totalPct = Math.round((day.shownMinutes / maxMinutes14) * 100);
              const focusPartPct =
                day.shownMinutes > 0
                  ? Math.round((day.focusRoomMin / day.shownMinutes) * 100)
                  : 0;
              const recallPartPct = day.shownMinutes > 0 ? 100 - focusPartPct : 0;
              const showShortDate =
                index === 0 || index === last14Days.length - 1 || index % 2 === 0;
              const shortDay = day.dateKey.slice(8);

              return (
                <div
                  key={day.dateKey}
                  className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end min-w-0"
                >
                  <span className="text-[10px] font-mono-tabular text-[var(--pastel-muted)] h-4 flex items-center">
                    {day.shownMinutes > 0 ? day.shownMinutes : ''}
                  </span>
                  <div className="w-full max-w-[26px] flex-1 flex items-end bg-[var(--pastel-soft)]/55 rounded-xl overflow-hidden">
                    {day.shownMinutes > 0 && (
                      <div
                        className="w-full rounded-xl overflow-hidden flex flex-col justify-end transition-all"
                        style={{ height: `${Math.max(8, totalPct)}%` }}
                        title={`${day.label}: Focus/Rooms ${day.focusRoomMin}m · Active Recall ${day.recallMin}m`}
                      >
                        {timelineView === 'combined' ? (
                          <>
                            {day.recallMin > 0 && (
                              <div
                                className="w-full bg-emerald-600/80"
                                style={{ height: `${recallPartPct}%` }}
                              />
                            )}
                            {day.focusRoomMin > 0 && (
                              <div
                                className="w-full bg-[var(--pastel-accent)]"
                                style={{ height: `${focusPartPct}%` }}
                              />
                            )}
                          </>
                        ) : (
                          <div
                            className={`w-full h-full ${
                              timelineView === 'active_recall'
                                ? 'bg-emerald-600/80'
                                : 'bg-[var(--pastel-accent)]'
                            }`}
                          />
                        )}
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] text-[var(--pastel-muted)] font-mono-tabular h-4 flex items-center">
                    {showShortDate ? shortDay : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="lg:col-span-4 bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 flex flex-col justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-base font-extrabold tracking-tight">35-Day Consistency</h2>
            <p className="text-xs text-[var(--pastel-muted)]">
              Darker tiles represent longer{' '}
              {timelineView === 'active_recall'
                ? 'active recall'
                : timelineView === 'focus_rooms'
                  ? 'focus room'
                  : 'combined study'}{' '}
              days.
            </p>
          </div>

          <div className="grid grid-cols-7 gap-2">
            {last35Days.map((cell) => {
              let opacity = 'opacity-15';
              if (cell.minutes >= 120) opacity = 'opacity-100';
              else if (cell.minutes >= 60) opacity = 'opacity-75';
              else if (cell.minutes >= 30) opacity = 'opacity-50';
              else if (cell.minutes > 0) opacity = 'opacity-30';
              return (
                <div
                  key={cell.dateKey}
                  title={`${cell.dateKey}: ${cell.minutes} min`}
                  className={`aspect-square rounded-xl bg-[var(--pastel-accent)] ${opacity}`}
                />
              );
            })}
          </div>

          <div className="flex items-center justify-between text-[11px] text-[var(--pastel-muted)]">
            <span>Less</span>
            <span>More</span>
          </div>
        </section>
      </div>

      {/* Per Subject Time Distribution + Chronological Study Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <section className="lg:col-span-5 bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-4">
          <h2 className="text-base font-extrabold tracking-tight">Time Per Subject</h2>
          {subjectBreakdown.length === 0 ? (
            <p className="py-6 text-xs text-[var(--pastel-muted)] text-center">
              No study sessions recorded yet.
            </p>
          ) : (
            <div className="space-y-3.5">
              {subjectBreakdown.map((item) => {
                const pct =
                  allTotalSeconds > 0 ? Math.round((item.totalSec / allTotalSeconds) * 100) : 0;
                return (
                  <div key={item.name} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs gap-2">
                      <div className="flex items-center gap-2 font-medium min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="truncate">{item.name}</span>
                      </div>
                      <span className="font-mono-tabular text-[var(--pastel-muted)] shrink-0">
                        {formatDurationShort(item.totalSec)} · {pct}%
                      </span>
                    </div>
                    <div className="text-[11px] text-[var(--pastel-muted)] font-mono-tabular">
                      Focus/Rooms {formatDurationShort(item.focusRoomSec)} · Recall{' '}
                      {formatDurationShort(item.recallSec)}
                    </div>
                    <div className="h-2 rounded-full bg-[var(--pastel-soft)] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: item.color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="lg:col-span-7 bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-extrabold tracking-tight">Study Timeline</h2>
              <p className="text-xs text-[var(--pastel-muted)]">
                Chronological feed across Focus, Study Rooms, Flashcards, and Blurting.
              </p>
            </div>
            <span className="text-xs text-[var(--pastel-muted)] font-mono-tabular">
              {viewFilteredSessions.length} entries
            </span>
          </div>

          {viewFilteredSessions.length === 0 ? (
            <p className="py-8 text-xs text-[var(--pastel-muted)] text-center">
              No sessions match this filter yet.
            </p>
          ) : (
            <div className="divide-y divide-[var(--pastel-border)] max-h-[380px] overflow-y-auto pr-1">
              {viewFilteredSessions.slice(0, 30).map((sess) => {
                const isRecall = isActiveRecallSession(sess);
                const categoryLabel = isRecall
                  ? sess.mode === 'blurting'
                    ? 'Active Recall · Blurting'
                    : 'Active Recall · Flashcards'
                  : sess.contextType === 'solo'
                    ? `Focus · ${sess.mode === 'stopwatch' ? 'Stopwatch' : 'Timer'}`
                    : `Study Room · ${sess.roomName || 'Room'}`;

                return (
                  <div
                    key={sess.id}
                    className="py-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: sess.subjectColor || '#4B5563' }}
                        />
                        <span className="text-xs font-bold truncate">
                          {sess.subjectName || 'General Study'}
                          {sess.chapterTitle ? ` · ${sess.chapterTitle}` : ''}
                        </span>
                      </div>
                      <div className="text-[11px] text-[var(--pastel-muted)]">
                        <span
                          className={
                            isRecall
                              ? 'text-emerald-800 font-semibold'
                              : 'font-medium text-[var(--pastel-ink)]'
                          }
                        >
                          {categoryLabel}
                        </span>
                        <span aria-hidden="true"> · </span>
                        <span className="font-mono-tabular">
                          {new Date(sess.completedAt || sess.dateKey).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    </div>

                    <div className="text-xs font-extrabold font-mono-tabular shrink-0">
                      {formatDurationShort(sess.durationSeconds)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
