import React, { useMemo, useState } from 'react';
import { formatDurationShort, getDateKey } from '../lib/spacedRepetition';
import { PastelSelect } from './PastelSelect';
import type { FocusSession, Subject, UserProfile } from '../types/study';

interface ProgressViewProps {
  profile: UserProfile;
  sessions: FocusSession[];
  subjects: Subject[];
}

export const ProgressView: React.FC<ProgressViewProps> = ({
  profile,
  sessions,
  subjects,
}) => {
  const [subjectFilter, setSubjectFilter] = useState<string>('all');

  const filteredSessions = useMemo(() => {
    if (subjectFilter === 'all') return sessions;
    return sessions.filter((s) => s.subjectId === subjectFilter);
  }, [sessions, subjectFilter]);

  const totalSeconds = useMemo(
    () => filteredSessions.reduce((acc, s) => acc + s.durationSeconds, 0),
    [filteredSessions],
  );

  // Current daily streak (consecutive days with >= 1 session)
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
        // allow streak ending yesterday if today hasn't logged yet
        cursor.setDate(cursor.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  }, [sessions]);

  // Last 14 days bar series
  const last14Days = useMemo(() => {
    const totalsByDay = new Map<string, number>();
    filteredSessions.forEach((s) => {
      totalsByDay.set(s.dateKey, (totalsByDay.get(s.dateKey) || 0) + s.durationSeconds);
    });

    const days: Array<{ dateKey: string; label: string; minutes: number }> = [];
    for (let offset = 13; offset >= 0; offset--) {
      const d = new Date();
      d.setDate(d.getDate() - offset);
      const key = getDateKey(d);
      days.push({
        dateKey: key,
        label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        minutes: Math.round((totalsByDay.get(key) || 0) / 60),
      });
    }
    return days;
  }, [filteredSessions]);

  // Last 35 days consistency grid
  const last35Days = useMemo(() => {
    const totalsByDay = new Map<string, number>();
    filteredSessions.forEach((s) => {
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
  }, [filteredSessions]);

  // Per-subject breakdown (always across all subjects)
  const subjectBreakdown = useMemo(() => {
    const map = new Map<string, { name: string; color: string; seconds: number }>();
    sessions.forEach((s) => {
      const key = s.subjectId || 'general';
      const existing = map.get(key);
      if (existing) {
        existing.seconds += s.durationSeconds;
      } else {
        map.set(key, {
          name: s.subjectName || 'General Study',
          color: s.subjectColor || '#4B5563',
          seconds: s.durationSeconds,
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.seconds - a.seconds);
  }, [sessions]);

  const maxMinutes14 = Math.max(profile.dailyGoalMinutes, ...last14Days.map((d) => d.minutes), 30);
  const allTotalSeconds = sessions.reduce((acc, s) => acc + s.durationSeconds, 0);
  const roomSessionsCount = filteredSessions.filter((s) => s.contextType !== 'solo').length;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Progress &amp; Consistency</h1>
          <p className="text-sm text-[var(--pastel-muted)]">
            Visualize study hours and daily consistency overall or filtered by subject.
          </p>
        </div>

        <PastelSelect
          value={subjectFilter}
          onChange={setSubjectFilter}
          ariaLabel="Filter progress by subject"
          variant="pill"
          align="right"
          className="min-w-[180px]"
          options={[
            { value: 'all', label: 'Overall (All Subjects)' },
            ...subjects.map((s) => ({ value: s.id, label: s.name, color: s.color })),
          ]}
        />
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-5 space-y-1">
          <div className="text-xs text-[var(--pastel-muted)]">Total Study Time</div>
          <div className="text-2xl font-extrabold font-mono-tabular">
            {formatDurationShort(totalSeconds)}
          </div>
        </div>
        <div className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-5 space-y-1">
          <div className="text-xs text-[var(--pastel-muted)]">Active Streak</div>
          <div className="text-2xl font-extrabold font-mono-tabular">
            {streakDays} {streakDays === 1 ? 'day' : 'days'}
          </div>
        </div>
        <div className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-5 space-y-1">
          <div className="text-xs text-[var(--pastel-muted)]">Sessions Logged</div>
          <div className="text-2xl font-extrabold font-mono-tabular">{filteredSessions.length}</div>
        </div>
        <div className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-5 space-y-1">
          <div className="text-xs text-[var(--pastel-muted)]">Study Room Sessions</div>
          <div className="text-2xl font-extrabold font-mono-tabular">{roomSessionsCount}</div>
        </div>
      </div>

      {/* 14-Day Study Bar Chart & 35-Day Consistency Heatmap */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <section className="lg:col-span-8 bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 flex flex-col justify-between gap-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-extrabold tracking-tight">Last 14 Days (Minutes)</h2>
            <span className="text-xs text-[var(--pastel-muted)] font-mono-tabular">
              Daily goal: {profile.dailyGoalMinutes}m
            </span>
          </div>

          <div className="h-52 flex items-end gap-1.5 sm:gap-2 pt-2">
            {last14Days.map((day, index) => {
              const heightPct = Math.round((day.minutes / maxMinutes14) * 100);
              const showShortDate = index === 0 || index === last14Days.length - 1 || index % 2 === 0;
              const shortDay = day.dateKey.slice(8);
              return (
                <div key={day.dateKey} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end min-w-0">
                  <span className="text-[10px] font-mono-tabular text-[var(--pastel-muted)] h-4 flex items-center">
                    {day.minutes > 0 ? day.minutes : ''}
                  </span>
                  <div className="w-full max-w-[26px] flex-1 flex items-end bg-[var(--pastel-soft)]/55 rounded-xl overflow-hidden">
                    <div
                      className="w-full rounded-xl bg-[var(--pastel-accent)] transition-all"
                      style={{ height: `${Math.max(day.minutes > 0 ? 8 : 0, heightPct)}%` }}
                      title={`${day.label}: ${day.minutes} minutes`}
                    />
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
              Darker tiles represent longer daily focus blocks.
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

      {/* Per Subject Time Distribution */}
      <section className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-4">
        <h2 className="text-base font-extrabold tracking-tight">Hours Per Subject</h2>
        {subjectBreakdown.length === 0 ? (
          <p className="py-6 text-xs text-[var(--pastel-muted)] text-center">
            No focus sessions recorded yet.
          </p>
        ) : (
          <div className="space-y-3">
            {subjectBreakdown.map((item) => {
              const pct = allTotalSeconds > 0 ? Math.round((item.seconds / allTotalSeconds) * 100) : 0;
              return (
                <div key={item.name} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 font-medium">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: item.color }}
                      />
                      <span>{item.name}</span>
                    </div>
                    <span className="font-mono-tabular text-[var(--pastel-muted)]">
                      {formatDurationShort(item.seconds)} · {pct}%
                    </span>
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
    </div>
  );
};
