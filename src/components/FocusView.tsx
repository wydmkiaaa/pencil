import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Pause, Play, RotateCcw, Volume2 } from 'lucide-react';
import { AMBIENT_SOUND_OPTIONS, ambientAudio } from '../lib/ambientAudio';
import { formatClock, formatDurationShort, getDateKey } from '../lib/spacedRepetition';
import { logFocusSession } from '../lib/studyRepo';
import { PastelSelect } from './PastelSelect';
import type { AmbientSoundId, FocusMode, FocusSession, Subject } from '../types/study';

interface FocusViewProps {
  uid: string;
  subjects: Subject[];
  sessions: FocusSession[];
  ambientSound: AmbientSoundId;
  ambientVolume: number;
  onChangeAmbientSound: (sound: AmbientSoundId) => void;
  onChangeAmbientVolume: (vol: number) => void;
  chimesEnabled?: boolean;
}

export const FocusView: React.FC<FocusViewProps> = ({
  uid,
  subjects,
  sessions,
  ambientSound,
  ambientVolume,
  onChangeAmbientSound,
  onChangeAmbientVolume,
  chimesEnabled = true,
}) => {
  const [mode, setMode] = useState<FocusMode>('timer');
  const [customMinutes, setCustomMinutes] = useState(25);
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [stopwatchSeconds, setStopwatchSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const initialTimerDurationRef = useRef(25 * 60);
  const subjectsMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);

  const handleSelectPresetMinutes = (mins: number) => {
    const clamped = Math.max(1, Math.min(240, Math.round(mins) || 25));
    setCustomMinutes(clamped);
    if (!isRunning) {
      setSecondsLeft(clamped * 60);
      initialTimerDurationRef.current = clamped * 60;
    }
  };

  const persistSession = async (durationSeconds: number, sessionMode: FocusMode) => {
    if (durationSeconds < 5) {
      setStatusMessage('Focus for at least 5 seconds before logging a session.');
      return;
    }
    setSaving(true);
    try {
      const subj = selectedSubjectId ? subjectsMap.get(selectedSubjectId) : undefined;
      await logFocusSession(uid, {
        mode: sessionMode,
        contextType: 'solo',
        subjectId: subj?.id || '',
        subjectName: subj?.name || 'General Study',
        subjectColor: subj?.color || '#4B5563',
        durationSeconds,
        ambientSound,
        completedAt: new Date().toISOString(),
        dateKey: getDateKey(),
      });
      setStatusMessage(`Logged ${formatDurationShort(durationSeconds)} (${subj?.name || 'General Study'}).`);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!isRunning) return;
    const interval = window.setInterval(() => {
      if (mode === 'timer') {
        setSecondsLeft((prev) => {
          if (prev <= 1) {
            window.clearInterval(interval);
            setIsRunning(false);
            if (chimesEnabled) {
              ambientAudio.playCompletionChime();
            }
            void persistSession(initialTimerDurationRef.current, 'timer');
            return customMinutes * 60;
          }
          return prev - 1;
        });
      } else {
        setStopwatchSeconds((prev) => prev + 1);
      }
    }, 1000);

    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, mode, customMinutes]);

  const handleToggleRun = () => {
    setStatusMessage(null);
    if (!isRunning && mode === 'timer' && secondsLeft === customMinutes * 60) {
      initialTimerDurationRef.current = customMinutes * 60;
    }
    setIsRunning((prev) => !prev);
  };

  const handleReset = () => {
    setIsRunning(false);
    setStatusMessage(null);
    if (mode === 'timer') {
      setSecondsLeft(customMinutes * 60);
      initialTimerDurationRef.current = customMinutes * 60;
    } else {
      setStopwatchSeconds(0);
    }
  };

  const handleCompleteAndLog = async () => {
    setIsRunning(false);
    if (mode === 'timer') {
      const elapsed = initialTimerDurationRef.current - secondsLeft;
      await persistSession(elapsed, 'timer');
      setSecondsLeft(customMinutes * 60);
      initialTimerDurationRef.current = customMinutes * 60;
    } else {
      await persistSession(stopwatchSeconds, 'stopwatch');
      setStopwatchSeconds(0);
    }
  };

  const switchMode = (next: FocusMode) => {
    setIsRunning(false);
    setStatusMessage(null);
    setMode(next);
  };

  const activeDisplayClock = mode === 'timer' ? formatClock(secondsLeft) : formatClock(stopwatchSeconds);
  const canLogNow =
    mode === 'timer'
      ? initialTimerDurationRef.current - secondsLeft >= 5
      : stopwatchSeconds >= 5;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Main Focus Clock */}
        <section className="lg:col-span-7 bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 md:p-8 flex flex-col justify-between gap-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-1 p-1 bg-[var(--pastel-soft)] rounded-full">
              <button
                type="button"
                onClick={() => switchMode('timer')}
                className={`px-4 py-1.5 text-xs font-bold rounded-full transition-colors whitespace-nowrap cursor-pointer ${
                  mode === 'timer'
                    ? 'bg-[var(--pastel-surface)] text-[var(--pastel-ink)] shadow-xs'
                    : 'text-[var(--pastel-muted)] hover:text-[var(--pastel-ink)]'
                }`}
              >
                Time
              </button>
              <button
                type="button"
                onClick={() => switchMode('stopwatch')}
                className={`px-4 py-1.5 text-xs font-bold rounded-full transition-colors whitespace-nowrap cursor-pointer ${
                  mode === 'stopwatch'
                    ? 'bg-[var(--pastel-surface)] text-[var(--pastel-ink)] shadow-xs'
                    : 'text-[var(--pastel-muted)] hover:text-[var(--pastel-ink)]'
                }`}
              >
                Stopwatch
              </button>
            </div>

            <PastelSelect
              value={selectedSubjectId}
              onChange={setSelectedSubjectId}
              ariaLabel="Select study subject"
              variant="pill"
              align="right"
              className="min-w-[165px] max-w-[220px]"
              options={[
                { value: '', label: 'General Study' },
                ...subjects.map((s) => ({ value: s.id, label: s.name, color: s.color })),
              ]}
            />
          </div>

          {/* Clock display */}
          <div className="py-4 text-center space-y-6 my-auto">
            <div className="text-6xl sm:text-7xl font-extrabold tracking-tight font-mono-tabular">
              {activeDisplayClock}
            </div>

            {mode === 'timer' && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                {[15, 25, 45, 60, 90].map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    disabled={isRunning}
                    onClick={() => handleSelectPresetMinutes(mins)}
                    className={`px-3.5 py-1.5 text-xs font-mono-tabular font-bold rounded-full border transition-colors cursor-pointer disabled:opacity-45 ${
                      customMinutes === mins
                        ? 'border-[var(--pastel-accent)] bg-[var(--pastel-soft)]'
                        : 'border-[var(--pastel-border)] hover:bg-[var(--pastel-soft)]'
                    }`}
                  >
                    {mins}m
                  </button>
                ))}
                <div className="flex items-center gap-1.5 pl-2">
                  <input
                    type="number"
                    min={1}
                    max={240}
                    disabled={isRunning}
                    value={customMinutes}
                    onChange={(e) => handleSelectPresetMinutes(Number(e.target.value))}
                    aria-label="Custom minutes"
                    className="w-16 px-2.5 py-1.5 text-xs font-mono-tabular rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] text-center focus:outline-none disabled:opacity-45"
                  />
                  <span className="text-xs text-[var(--pastel-muted)]">min</span>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={handleToggleRun}
                className="px-6 py-3 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-sm font-bold hover:opacity-90 transition-opacity flex items-center gap-2 cursor-pointer"
              >
                {isRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                <span>{isRunning ? 'Pause' : 'Start Focus'}</span>
              </button>

              <button
                type="button"
                onClick={handleReset}
                className="px-5 py-3 rounded-full border border-[var(--pastel-border)] hover:bg-[var(--pastel-soft)] text-sm font-bold transition-colors flex items-center gap-2 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Reset</span>
              </button>

              {canLogNow && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleCompleteAndLog()}
                  className="px-5 py-3 rounded-full border border-[var(--pastel-border)] bg-[var(--pastel-soft)] hover:bg-[var(--pastel-soft-hover)] text-sm font-bold transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{saving ? 'Logging...' : 'Finish & Log'}</span>
                </button>
              )}
            </div>

            {statusMessage && (
              <p className="text-xs text-[var(--pastel-muted)]">{statusMessage}</p>
            )}
          </div>
        </section>

        {/* Calming Ambient Noise Panel */}
        <section className="lg:col-span-5 bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 flex flex-col justify-between gap-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold tracking-tight">Calming Soundscapes</h2>
              <p className="text-xs text-[var(--pastel-muted)]">
                Seamless repeating noise generated softly in your browser.
              </p>
            </div>
            <Volume2 className="w-4 h-4 text-[var(--pastel-muted)] shrink-0" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {AMBIENT_SOUND_OPTIONS.map((option) => {
              const active = ambientSound === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onChangeAmbientSound(option.id)}
                  className={`px-4 py-3 rounded-2xl border text-left transition-colors flex flex-col justify-between gap-1 cursor-pointer ${
                    active
                      ? 'border-[var(--pastel-accent)] bg-[var(--pastel-soft)]'
                      : 'border-[var(--pastel-border)] hover:bg-[var(--pastel-canvas)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold">{option.label}</span>
                    {active && (
                      <span className="w-2 h-2 rounded-full bg-[var(--pastel-accent)] shrink-0" />
                    )}
                  </div>
                  <div className="text-[11px] text-[var(--pastel-muted)] leading-snug">
                    {option.subtitle}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="pt-2 space-y-2">
            <div className="flex items-center justify-between text-xs text-[var(--pastel-muted)]">
              <span>Ambient Volume</span>
              <span className="font-mono-tabular">{Math.round(ambientVolume * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(ambientVolume * 100)}
              onChange={(e) => onChangeAmbientVolume(Number(e.target.value) / 100)}
              className="w-full accent-[var(--pastel-accent)] cursor-pointer"
            />
          </div>
        </section>
      </div>

      {/* Logged Solo & Room Focus History */}
      <section className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-extrabold tracking-tight">Recent Focus Logs</h2>
            <p className="text-xs text-[var(--pastel-muted)]">
              Tracked across timer, stopwatch, and collaborative study rooms.
            </p>
          </div>
          <span className="text-xs text-[var(--pastel-muted)] font-mono-tabular">
            {sessions.length} total sessions
          </span>
        </div>

        {sessions.length === 0 ? (
          <p className="py-8 text-center text-xs text-[var(--pastel-muted)]">
            Complete a timer or log a stopwatch block to build your study log.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--pastel-border)] text-xs text-[var(--pastel-muted)]">
                  <th className="py-2.5 pr-4 font-medium">Subject</th>
                  <th className="py-2.5 pr-4 font-medium">Mode</th>
                  <th className="py-2.5 pr-4 font-medium">Space</th>
                  <th className="py-2.5 pr-4 font-medium">Sound</th>
                  <th className="py-2.5 pr-4 font-medium text-right">Duration</th>
                  <th className="py-2.5 font-medium text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--pastel-border)]">
                {sessions.slice(0, 12).map((sess) => (
                  <tr key={sess.id} className="hover:bg-[var(--pastel-canvas)]">
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: sess.subjectColor || '#4B5563' }}
                        />
                        <span className="font-medium truncate max-w-[180px]">
                          {sess.subjectName || 'General Study'}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-[var(--pastel-muted)] capitalize">
                      {sess.mode}
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-[var(--pastel-muted)]">
                      {sess.contextType === 'solo'
                        ? 'Solo Focus'
                        : sess.contextType === 'public_room'
                          ? `Public · ${sess.roomName || 'Room'}`
                          : `Private · ${sess.roomName || 'Room'}`}
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-[var(--pastel-muted)] capitalize">
                      {sess.ambientSound}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono-tabular">
                      {formatDurationShort(sess.durationSeconds)}
                    </td>
                    <td className="py-2.5 text-right text-xs text-[var(--pastel-muted)] font-mono-tabular">
                      {sess.dateKey}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
