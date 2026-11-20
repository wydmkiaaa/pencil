import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Globe,
  KeyRound,
  Lock,
  LogOut,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Send,
  Users,
  Volume2,
} from 'lucide-react';
import { AMBIENT_SOUND_OPTIONS } from '../lib/ambientAudio';
import { formatClock, formatDurationShort, getDateKey } from '../lib/spacedRepetition';
import {
  closeFocusRoom,
  createFocusRoom,
  joinFocusRoom,
  leaveFocusRoom,
  logFocusSession,
  sendRoomMessage,
  subscribeFocusRoom,
  subscribeHostedFocusRooms,
  subscribePublicFocusRooms,
  subscribeRoomMessages,
  subscribeRoomParticipants,
  updateParticipantState,
  updateRoomTimerAndSound,
} from '../lib/studyRepo';
import { PastelSelect } from './PastelSelect';
import type {
  AmbientSoundId,
  FocusMode,
  FocusRoom,
  ParticipantStatus,
  RoomMessage,
  RoomParticipant,
  RoomVisibility,
  Subject,
  UserProfile,
} from '../types/study';

interface RoomsViewProps {
  uid: string;
  profile: UserProfile;
  subjects: Subject[];
  ambientSound: AmbientSoundId;
  ambientVolume: number;
  onChangeAmbientSound: (sound: AmbientSoundId) => void;
  onChangeAmbientVolume: (vol: number) => void;
}

export const RoomsView: React.FC<RoomsViewProps> = ({
  uid,
  profile,
  subjects,
  ambientSound,
  ambientVolume,
  onChangeAmbientSound,
  onChangeAmbientVolume,
}) => {
  const [publicRooms, setPublicRooms] = useState<FocusRoom[]>([]);
  const [hostedRooms, setHostedRooms] = useState<FocusRoom[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [activeRoom, setActiveRoom] = useState<FocusRoom | null>(null);
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [messages, setMessages] = useState<RoomMessage[]>([]);

  // Create room form
  const [showCreate, setShowCreate] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [roomTopic, setRoomTopic] = useState('');
  const [roomVisibility, setRoomVisibility] = useState<RoomVisibility>('public');
  const [roomPassword, setRoomPassword] = useState('');
  const [roomTimerMode, setRoomTimerMode] = useState<FocusMode>('timer');
  const [roomTimerMins, setRoomTimerMins] = useState(50);
  const [roomDefaultSound, setRoomDefaultSound] = useState<AmbientSoundId>('brown');
  const [creating, setCreating] = useState(false);

  // Join private room form
  const [joinCode, setJoinCode] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [joining, setJoining] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);

  // Active room local controls
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [myStatus, setMyStatus] = useState<ParticipantStatus>('focusing');
  const [checkInText, setCheckInText] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [localSessionStartMs, setLocalSessionStartMs] = useState<number>(() => Date.now());

  const subjectsMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);

  useEffect(() => {
    const unsubPub = subscribePublicFocusRooms(setPublicRooms);
    const unsubHosted = subscribeHostedFocusRooms(uid, setHostedRooms);
    return () => {
      unsubPub();
      unsubHosted();
    };
  }, [uid]);

  useEffect(() => {
    if (!activeRoomId) {
      setActiveRoom(null);
      setParticipants([]);
      setMessages([]);
      return;
    }
    const unsubRoom = subscribeFocusRoom(activeRoomId, (room) => {
      if (!room || !room.isActive) {
        setActiveRoomId(null);
        setActiveRoom(null);
        return;
      }
      setActiveRoom(room);
    });
    const unsubPart = subscribeRoomParticipants(activeRoomId, setParticipants);
    const unsubMsg = subscribeRoomMessages(activeRoomId, setMessages);
    setLocalSessionStartMs(Date.now());
    return () => {
      unsubRoom();
      unsubPart();
      unsubMsg();
    };
  }, [activeRoomId]);

  useEffect(() => {
    if (!activeRoom || activeRoom.timerStatus !== 'running') return;
    const id = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [activeRoom]);

  const computeRoomElapsedSeconds = (room: FocusRoom): number => {
    const runningDelta =
      room.timerStatus === 'running' && room.timerStartedAtMs > 0
        ? Math.max(0, Math.floor((nowMs - room.timerStartedAtMs) / 1000))
        : 0;
    return room.timerAccumulatedSeconds + runningDelta;
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setRoomError(null);
    if (!roomName.trim()) return;
    if (roomVisibility === 'private' && roomPassword.trim().length < 4) {
      setRoomError('Please set a password of at least 4 characters for a private room.');
      return;
    }
    setCreating(true);
    try {
      const id = await createFocusRoom(uid, profile, {
        name: roomName,
        topic: roomTopic,
        visibility: roomVisibility,
        password: roomPassword,
        timerMode: roomTimerMode,
        timerDurationSeconds: roomTimerMins * 60,
        ambientSound: roomDefaultSound,
      });
      onChangeAmbientSound(roomDefaultSound);
      setRoomName('');
      setRoomTopic('');
      setRoomPassword('');
      setShowCreate(false);
      setActiveRoomId(id);
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : 'Unable to create room.');
    } finally {
      setCreating(false);
    }
  };

  const handleJoinPublic = async (room: FocusRoom) => {
    setRoomError(null);
    setJoining(true);
    try {
      const subj = selectedSubjectId ? subjectsMap.get(selectedSubjectId) : undefined;
      await joinFocusRoom(uid, profile, room.id, undefined, subj?.name || 'General Study');
      if (room.ambientSound !== 'none' && ambientSound === 'none') {
        onChangeAmbientSound(room.ambientSound);
      }
      setActiveRoomId(room.id);
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : 'Could not join room.');
    } finally {
      setJoining(false);
    }
  };

  const handleJoinPrivate = async (e: React.FormEvent) => {
    e.preventDefault();
    setRoomError(null);
    if (!joinCode.trim()) {
      setRoomError('Enter the private room code.');
      return;
    }
    setJoining(true);
    try {
      const subj = selectedSubjectId ? subjectsMap.get(selectedSubjectId) : undefined;
      const joined = await joinFocusRoom(
        uid,
        profile,
        joinCode.trim(),
        joinPassword,
        subj?.name || 'General Study',
      );
      if (joined.ambientSound !== 'none' && ambientSound === 'none') {
        onChangeAmbientSound(joined.ambientSound);
      }
      setJoinCode('');
      setJoinPassword('');
      setActiveRoomId(joined.id);
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : 'Unable to join private room.');
    } finally {
      setJoining(false);
    }
  };

  const handleHostTimerAction = async (action: 'start' | 'pause' | 'reset') => {
    if (!activeRoom || activeRoom.hostId !== uid) return;
    const elapsed = computeRoomElapsedSeconds(activeRoom);
    if (action === 'start') {
      await updateRoomTimerAndSound(activeRoom.id, {
        timerMode: activeRoom.timerMode,
        timerDurationSeconds: activeRoom.timerDurationSeconds,
        timerStatus: 'running',
        timerStartedAtMs: Date.now(),
        timerAccumulatedSeconds: activeRoom.timerAccumulatedSeconds,
        ambientSound: activeRoom.ambientSound,
      });
    } else if (action === 'pause') {
      await updateRoomTimerAndSound(activeRoom.id, {
        timerMode: activeRoom.timerMode,
        timerDurationSeconds: activeRoom.timerDurationSeconds,
        timerStatus: 'paused',
        timerStartedAtMs: 0,
        timerAccumulatedSeconds: elapsed,
        ambientSound: activeRoom.ambientSound,
      });
    } else {
      await updateRoomTimerAndSound(activeRoom.id, {
        timerMode: activeRoom.timerMode,
        timerDurationSeconds: activeRoom.timerDurationSeconds,
        timerStatus: 'idle',
        timerStartedAtMs: 0,
        timerAccumulatedSeconds: 0,
        ambientSound: activeRoom.ambientSound,
      });
    }
  };

  const handleHostUpdateRoomConfig = async (
    nextMode: FocusMode,
    nextMins: number,
    nextSound: AmbientSoundId,
  ) => {
    if (!activeRoom || activeRoom.hostId !== uid) return;
    await updateRoomTimerAndSound(activeRoom.id, {
      timerMode: nextMode,
      timerDurationSeconds: Math.max(1, Math.min(240, nextMins)) * 60,
      timerStatus: 'idle',
      timerStartedAtMs: 0,
      timerAccumulatedSeconds: 0,
      ambientSound: nextSound,
    });
  };

  const handleLogRoomSession = async () => {
    if (!activeRoom) return;
    const roomElapsed = computeRoomElapsedSeconds(activeRoom);
    const localElapsed = Math.max(0, Math.floor((Date.now() - localSessionStartMs) / 1000));
    const durationToLog = roomElapsed >= 15 ? roomElapsed : localElapsed;
    if (durationToLog < 10) {
      setSessionNotice('Study in the room for at least 10 seconds before logging.');
      return;
    }
    const subj = selectedSubjectId ? subjectsMap.get(selectedSubjectId) : undefined;
    await logFocusSession(uid, {
      mode: activeRoom.timerMode,
      contextType: activeRoom.visibility === 'private' ? 'private_room' : 'public_room',
      roomId: activeRoom.id,
      roomName: activeRoom.name,
      subjectId: subj?.id || '',
      subjectName: subj?.name || 'General Study',
      subjectColor: subj?.color || '#4B5563',
      durationSeconds: durationToLog,
      ambientSound,
      completedAt: new Date().toISOString(),
      dateKey: getDateKey(),
    });
    setLocalSessionStartMs(Date.now());
    setSessionNotice(
      `Saved ${formatDurationShort(durationToLog)} (${activeRoom.visibility} room) to your Progress log.`,
    );
  };

  const handleLeaveRoom = async () => {
    if (!activeRoom) return;
    await leaveFocusRoom(activeRoom.id, uid);
    setActiveRoomId(null);
    setSessionNotice(null);
  };

  const handleEndRoom = async () => {
    if (!activeRoom || activeRoom.hostId !== uid) return;
    await closeFocusRoom(activeRoom.id);
    setActiveRoomId(null);
    setSessionNotice(null);
  };

  const handleUpdateMyPresence = async (nextSubjectId: string, nextStatus: ParticipantStatus) => {
    setSelectedSubjectId(nextSubjectId);
    setMyStatus(nextStatus);
    if (!activeRoom) return;
    const subj = nextSubjectId ? subjectsMap.get(nextSubjectId) : undefined;
    await updateParticipantState(activeRoom.id, uid, {
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl || '',
      subjectName: subj?.name || 'General Study',
      status: nextStatus,
    });
  };

  const handleSendCheckIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRoom || !checkInText.trim()) return;
    const text = checkInText.trim();
    setCheckInText('');
    await sendRoomMessage(activeRoom, uid, profile.displayName, text);
  };

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  // --- Active Collaborative Room View ---
  if (activeRoom) {
    const isHost = activeRoom.hostId === uid;
    const elapsed = computeRoomElapsedSeconds(activeRoom);
    const displaySeconds =
      activeRoom.timerMode === 'timer'
        ? Math.max(0, activeRoom.timerDurationSeconds - elapsed)
        : elapsed;

    return (
      <div className="space-y-6">
        {/* Room Header */}
        <div className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1 min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--pastel-muted)]">
              <span className="inline-flex items-center gap-1.5">
                {activeRoom.visibility === 'private' ? (
                  <Lock className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <Globe className="w-3.5 h-3.5 shrink-0" />
                )}
                <span>{activeRoom.visibility === 'private' ? 'Private Study Room' : 'Public Study Room'}</span>
              </span>
              <span aria-hidden="true">·</span>
              <span>Hosted by {activeRoom.hostName}</span>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => void handleCopyCode(activeRoom.id)}
                className="inline-flex items-center gap-1 font-mono-tabular hover:text-[var(--pastel-ink)] cursor-pointer"
              >
                <span>Code: {activeRoom.id}</span>
                {copiedCode ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight truncate">{activeRoom.name}</h1>
            {activeRoom.topic && (
              <p className="text-xs text-[var(--pastel-muted)]">{activeRoom.topic}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void handleLogRoomSession()}
              className="px-4 py-2 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold hover:opacity-90 cursor-pointer whitespace-nowrap"
            >
              Log Room Session
            </button>
            <button
              type="button"
              onClick={() => void handleLeaveRoom()}
              className="px-4 py-2 rounded-full border border-[var(--pastel-border)] hover:bg-[var(--pastel-soft)] text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Leave</span>
            </button>
            {isHost && (
              <button
                type="button"
                onClick={() => void handleEndRoom()}
                className="px-4 py-2 rounded-full border border-red-200 text-red-700 hover:bg-red-50 text-xs font-bold cursor-pointer whitespace-nowrap"
              >
                End Room
              </button>
            )}
          </div>
        </div>

        {sessionNotice && (
          <div className="px-5 py-3 rounded-2xl bg-[var(--pastel-soft)] border border-[var(--pastel-border)] text-xs font-medium">
            {sessionNotice}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Shared Room Timer & Soundscape */}
          <div className="lg:col-span-7 space-y-6">
            <section className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 md:p-8 space-y-6 text-center">
              <div className="flex flex-wrap items-center justify-between gap-3 text-left">
                <div className="text-xs text-[var(--pastel-muted)]">
                  Shared Room {activeRoom.timerMode === 'timer' ? 'Timer' : 'Stopwatch'} ·{' '}
                  <span className="capitalize">{activeRoom.timerStatus}</span>
                </div>
                {isHost && (
                  <div className="flex flex-wrap items-center gap-2">
                    <PastelSelect
                      value={activeRoom.timerMode}
                      onChange={(val) =>
                        void handleHostUpdateRoomConfig(
                          val as FocusMode,
                          Math.round(activeRoom.timerDurationSeconds / 60),
                          activeRoom.ambientSound,
                        )
                      }
                      ariaLabel="Room clock mode"
                      variant="pill"
                      align="right"
                      className="min-w-[116px]"
                      options={[
                        { value: 'timer', label: 'Timer' },
                        { value: 'stopwatch', label: 'Stopwatch' },
                      ]}
                    />
                    {activeRoom.timerMode === 'timer' && (
                      <PastelSelect
                        value={String(Math.round(activeRoom.timerDurationSeconds / 60))}
                        onChange={(val) =>
                          void handleHostUpdateRoomConfig(
                            activeRoom.timerMode,
                            Number(val),
                            activeRoom.ambientSound,
                          )
                        }
                        ariaLabel="Room timer duration"
                        variant="pill"
                        align="right"
                        className="min-w-[96px]"
                        options={[25, 45, 50, 60, 90].map((m) => ({
                          value: String(m),
                          label: `${m} min`,
                        }))}
                      />
                    )}
                  </div>
                )}
              </div>

              <div className="text-6xl font-extrabold tracking-tight font-mono-tabular py-4">
                {formatClock(displaySeconds)}
              </div>

              {isHost ? (
                <div className="flex items-center justify-center gap-3">
                  {activeRoom.timerStatus !== 'running' ? (
                    <button
                      type="button"
                      onClick={() => void handleHostTimerAction('start')}
                      className="px-6 py-2.5 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold flex items-center gap-2 cursor-pointer"
                    >
                      <Play className="w-4 h-4" />
                      <span>{activeRoom.timerStatus === 'paused' ? 'Resume Room Timer' : 'Start Room Timer'}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleHostTimerAction('pause')}
                      className="px-6 py-2.5 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold flex items-center gap-2 cursor-pointer"
                    >
                      <Pause className="w-4 h-4" />
                      <span>Pause</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleHostTimerAction('reset')}
                    className="px-5 py-2.5 rounded-full border border-[var(--pastel-border)] hover:bg-[var(--pastel-soft)] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset</span>
                  </button>
                </div>
              ) : (
                <p className="text-xs text-[var(--pastel-muted)]">
                  Timer synced with {activeRoom.hostName}. Log your session whenever you finish a study block.
                </p>
              )}
            </section>

            {/* Calming Soundscape & Personal Subject Presence */}
            <section className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--pastel-muted)]">
                    Your Subject in This Room
                  </label>
                  <PastelSelect
                    value={selectedSubjectId}
                    onChange={(val) => void handleUpdateMyPresence(val, myStatus)}
                    ariaLabel="Your subject in this room"
                    variant="field"
                    className="w-full"
                    options={[
                      { value: '', label: 'General Study' },
                      ...subjects.map((s) => ({ value: s.id, label: s.name, color: s.color })),
                    ]}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--pastel-muted)]">
                    Your Focus Status
                  </label>
                  <div className="flex items-center gap-1 p-1 bg-[var(--pastel-soft)] rounded-full">
                    {(['focusing', 'break', 'idle'] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => void handleUpdateMyPresence(selectedSubjectId, st)}
                        className={`flex-1 py-1.5 text-xs font-semibold rounded-full capitalize cursor-pointer ${
                          myStatus === st
                            ? 'bg-[var(--pastel-surface)] text-[var(--pastel-ink)] shadow-xs'
                            : 'text-[var(--pastel-muted)]'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-[var(--pastel-border)] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-medium">
                    <Volume2 className="w-4 h-4 text-[var(--pastel-muted)]" />
                    <span>Room Calming Audio</span>
                  </div>
                  <span className="text-xs text-[var(--pastel-muted)] font-mono-tabular">
                    {Math.round(ambientVolume * 100)}%
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {AMBIENT_SOUND_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        onChangeAmbientSound(opt.id);
                        if (isHost) {
                          void handleHostUpdateRoomConfig(
                            activeRoom.timerMode,
                            Math.round(activeRoom.timerDurationSeconds / 60),
                            opt.id,
                          );
                        }
                      }}
                      className={`px-3.5 py-1.5 text-xs rounded-full border transition-colors cursor-pointer ${
                        ambientSound === opt.id
                          ? 'border-[var(--pastel-accent)] bg-[var(--pastel-soft)] font-bold'
                          : 'border-[var(--pastel-border)] hover:bg-[var(--pastel-canvas)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
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

          {/* Participants & Quiet Check-in */}
          <div className="lg:col-span-5 space-y-6">
            <section className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-extrabold tracking-tight flex items-center gap-2">
                  <Users className="w-4 h-4 text-[var(--pastel-muted)]" />
                  <span>Studying Together ({participants.length})</span>
                </h2>
              </div>
              <div className="divide-y divide-[var(--pastel-border)]">
                {participants.map((p) => {
                  const initials = (p.displayName || 'S').slice(0, 2).toUpperCase();
                  return (
                    <div key={p.id} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {p.avatarUrl ? (
                          <img
                            src={p.avatarUrl}
                            alt={p.displayName}
                            referrerPolicy="no-referrer"
                            className="w-8 h-8 rounded-full object-cover bg-[var(--pastel-soft)] shrink-0"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-[var(--pastel-soft)] text-[var(--pastel-ink)] text-xs font-extrabold flex items-center justify-center shrink-0">
                            {initials}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="text-sm font-bold truncate">{p.displayName}</div>
                          <div className="text-xs text-[var(--pastel-muted)] truncate">
                            {p.subjectName || 'General Study'}
                          </div>
                        </div>
                      </div>
                      <span className="text-xs font-bold text-[var(--pastel-muted)] capitalize shrink-0">
                        {p.status}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-4">
              <div>
                <h2 className="text-base font-extrabold tracking-tight">Quiet Check-Ins</h2>
                <p className="text-xs text-[var(--pastel-muted)]">
                  Share your study goal for this block without noisy distractions.
                </p>
              </div>
              <div className="max-h-52 overflow-y-auto space-y-2.5 pr-1">
                {messages.length === 0 ? (
                  <p className="text-xs text-[var(--pastel-muted)] py-4 text-center">
                    No check-ins yet. Say what you&apos;re working on!
                  </p>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} className="p-3.5 rounded-2xl bg-[var(--pastel-canvas)] border border-[var(--pastel-border)] space-y-0.5">
                      <div className="text-[11px] font-medium text-[var(--pastel-muted)]">
                        {m.senderName}
                      </div>
                      <p className="text-xs leading-relaxed">{m.text}</p>
                    </div>
                  ))
                )}
              </div>
              <form onSubmit={handleSendCheckIn} className="flex items-center gap-2">
                <input
                  type="text"
                  value={checkInText}
                  onChange={(e) => setCheckInText(e.target.value)}
                  placeholder="Share a quick goal check-in..."
                  maxLength={280}
                  className="flex-1 px-4 py-2.5 text-xs rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!checkInText.trim()}
                  className="w-9 h-9 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] hover:opacity-90 flex items-center justify-center cursor-pointer disabled:opacity-40 shrink-0"
                  aria-label="Send check-in"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </section>
          </div>
        </div>
      </div>
    );
  }

  // --- Rooms Lobby ---
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Collaborative Study Rooms</h1>
          <p className="text-sm text-[var(--pastel-muted)]">
            Join an open public desk or create a password-protected private room with shared timers and calming sounds.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((prev) => !prev)}
          className="px-4 py-2.5 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold hover:opacity-90 flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>{showCreate ? 'Close' : 'Create Room'}</span>
        </button>
      </div>

      {roomError && (
        <div className="p-3.5 rounded-2xl border border-red-200 bg-red-50 text-red-800 text-xs">
          {roomError}
        </div>
      )}

      {showCreate && (
        <form
          onSubmit={handleCreateRoom}
          className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-4"
        >
          <h2 className="text-base font-extrabold tracking-tight">Create a Study Room</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--pastel-muted)]">Room Name</label>
              <input
                type="text"
                required
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="e.g., Late Night Anatomy Review"
                maxLength={100}
                className="w-full px-4 py-2 text-sm rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--pastel-muted)]">Study Topic (optional)</label>
              <input
                type="text"
                value={roomTopic}
                onChange={(e) => setRoomTopic(e.target.value)}
                placeholder="e.g., Silent 50/10 blocks"
                maxLength={160}
                className="w-full px-4 py-2 text-sm rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--pastel-muted)]">Visibility</label>
              <PastelSelect
                value={roomVisibility}
                onChange={(val) => setRoomVisibility(val as RoomVisibility)}
                ariaLabel="Room visibility"
                variant="field"
                className="w-full"
                options={[
                  { value: 'public', label: 'Public (Discoverable)' },
                  { value: 'private', label: 'Private (Password Required)' },
                ]}
              />
            </div>

            {roomVisibility === 'private' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--pastel-muted)]">Room Password</label>
                <input
                  type="password"
                  required
                  value={roomPassword}
                  onChange={(e) => setRoomPassword(e.target.value)}
                  placeholder="Min 4 characters"
                  className="w-full px-3.5 py-2 text-sm rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)]"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--pastel-muted)]">Clock Mode</label>
              <PastelSelect
                value={roomTimerMode}
                onChange={(val) => setRoomTimerMode(val as FocusMode)}
                ariaLabel="Clock mode"
                variant="field"
                className="w-full"
                options={[
                  { value: 'timer', label: `Timer (${roomTimerMins}m)` },
                  { value: 'stopwatch', label: 'Stopwatch' },
                ]}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--pastel-muted)]">Default Sound</label>
              <PastelSelect
                value={roomDefaultSound}
                onChange={(val) => setRoomDefaultSound(val as AmbientSoundId)}
                ariaLabel="Default sound"
                variant="field"
                className="w-full"
                options={AMBIENT_SOUND_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
              />
            </div>
          </div>

          {roomTimerMode === 'timer' && (
            <div className="flex items-center gap-2 text-xs text-[var(--pastel-muted)]">
              <span>Timer length (minutes):</span>
              <input
                type="number"
                min={5}
                max={240}
                value={roomTimerMins}
                onChange={(e) => setRoomTimerMins(Math.max(5, Math.min(240, Number(e.target.value) || 25)))}
                className="w-20 px-3 py-1.5 rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] font-mono-tabular"
              />
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 text-xs font-medium text-[var(--pastel-muted)] rounded-full hover:bg-[var(--pastel-soft)] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="px-5 py-2 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold hover:opacity-90 cursor-pointer disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Open Room'}
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Public Rooms Directory */}
        <section className="lg:col-span-8 bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-extrabold tracking-tight">Public Focus Rooms</h2>
            <span className="text-xs text-[var(--pastel-muted)] font-mono-tabular">
              {publicRooms.length} active
            </span>
          </div>

          {publicRooms.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <p className="text-sm font-medium">No public rooms open right now</p>
              <p className="text-xs text-[var(--pastel-muted)]">
                Create a public room above to invite others to focus alongside you.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {publicRooms.map((room) => (
                <div
                  key={room.id}
                  className="p-5 rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] flex flex-col justify-between space-y-4 min-h-[164px]"
                >
                  <div className="space-y-1">
                    <div className="text-xs text-[var(--pastel-muted)] flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5" />
                      <span>{room.hostName}</span>
                      <span aria-hidden="true">·</span>
                      <span className="capitalize">{room.timerMode}</span>
                    </div>
                    <h3 className="text-base font-extrabold tracking-tight">{room.name}</h3>
                    {room.topic && (
                      <p className="text-xs text-[var(--pastel-muted)] line-clamp-2">{room.topic}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={joining}
                    onClick={() => void handleJoinPublic(room)}
                    className="w-full py-2.5 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold hover:opacity-90 cursor-pointer disabled:opacity-50"
                  >
                    Join Public Room
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Join Private Room & Hosted Rooms */}
        <div className="lg:col-span-4 space-y-6">
          <section className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-4">
            <div className="space-y-1">
              <h2 className="text-base font-extrabold tracking-tight flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-[var(--pastel-muted)]" />
                <span>Join Private Room</span>
              </h2>
              <p className="text-xs text-[var(--pastel-muted)]">
                Enter the room code and password shared by your study partner.
              </p>
            </div>

            <form onSubmit={handleJoinPrivate} className="space-y-3">
              <input
                type="text"
                required
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="Room code (e.g., room-k7m2p9)"
                className="w-full px-4 py-2 text-sm rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] font-mono-tabular focus:outline-none"
              />
              <input
                type="password"
                required
                value={joinPassword}
                onChange={(e) => setJoinPassword(e.target.value)}
                placeholder="Room password"
                className="w-full px-4 py-2 text-sm rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
              />
              <button
                type="submit"
                disabled={joining}
                className="w-full py-2.5 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold hover:opacity-90 cursor-pointer disabled:opacity-50"
              >
                {joining ? 'Verifying...' : 'Enter Private Room'}
              </button>
            </form>
          </section>

          {hostedRooms.length > 0 && (
            <section className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-3">
              <h2 className="text-base font-extrabold tracking-tight">Your Hosted Rooms</h2>
              <div className="divide-y divide-[var(--pastel-border)]">
                {hostedRooms.map((r) => (
                  <div key={r.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-bold truncate">{r.name}</div>
                      <div className="text-xs text-[var(--pastel-muted)] font-mono-tabular">
                        {r.visibility === 'private' ? 'Private' : 'Public'} · {r.id}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleJoinPublic(r)}
                      className="px-3.5 py-1.5 rounded-full border border-[var(--pastel-border)] hover:bg-[var(--pastel-soft)] text-xs font-semibold cursor-pointer shrink-0"
                    >
                      Re-enter
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};
