import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  Check,
  Copy,
  Globe,
  HeadphoneOff,
  Headphones,
  KeyRound,
  Lock,
  LogOut,
  MessageSquare,
  MessageSquareOff,
  Mic,
  MicOff,
  Pause,
  PhoneOff,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  SlidersHorizontal,
  Trash2,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { AMBIENT_SOUND_OPTIONS, ambientAudio } from '../lib/ambientAudio';
import { formatClock, formatDurationShort, getDateKey } from '../lib/spacedRepetition';
import {
  closeFocusRoom,
  createFocusRoom,
  deleteRoomMessage,
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
  updateRoomCommunicationSettings,
  updateRoomTimerAndSound,
} from '../lib/studyRepo';
import { useRoomVoice } from '../lib/useRoomVoice';
import { PastelSelect } from './PastelSelect';
import {
  BLUEPRINT_LIMITS,
  type AmbientSoundId,
  type FocusRoom,
  type ParticipantStatus,
  type RoomMessage,
  type RoomParticipant,
  type RoomVisibility,
  type Subject,
  type UserProfile,
} from '../types/study';

type RoomTimerMode = 'timer' | 'stopwatch';

function formatMessageTime(createdAt: unknown): string {
  if (!createdAt) return '';
  try {
    const maybeTs = createdAt as { toDate?: () => Date };
    const date = typeof maybeTs.toDate === 'function' ? maybeTs.toDate() : new Date(String(createdAt));
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

interface RoomsViewProps {
  uid: string;
  profile: UserProfile;
  subjects: Subject[];
  ambientSound: AmbientSoundId;
  ambientVolume: number;
  onChangeAmbientSound: (sound: AmbientSoundId) => void;
  onChangeAmbientVolume: (vol: number) => void;
  chimesEnabled?: boolean;
}

export const RoomsView: React.FC<RoomsViewProps> = ({
  uid,
  profile,
  subjects,
  ambientSound,
  ambientVolume,
  onChangeAmbientSound,
  onChangeAmbientVolume,
  chimesEnabled = true,
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
  const [roomTimerMode, setRoomTimerMode] = useState<RoomTimerMode>('timer');
  const [roomTimerMins, setRoomTimerMins] = useState(50);
  const [roomDefaultSound, setRoomDefaultSound] = useState<AmbientSoundId>('brown');
  const [roomCreateChatEnabled, setRoomCreateChatEnabled] = useState(true);
  const [roomCreateVoiceEnabled, setRoomCreateVoiceEnabled] = useState(true);
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
  const [chatText, setChatText] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [localSessionStartMs, setLocalSessionStartMs] = useState<number>(() => Date.now());
  const [chatScrolledUp, setChatScrolledUp] = useState(false);
  const [hasUnreadChat, setHasUnreadChat] = useState(false);
  const completedRoomTimerKeyRef = useRef<string>('');
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const isChatPinnedBottomRef = useRef(true);
  const prevLastMessageIdRef = useRef<string | null>(null);
  const activeRoomIdRef = useRef<string | null>(null);
  const uidRef = useRef(uid);
  const onChangeAmbientSoundRef = useRef(onChangeAmbientSound);

  const subjectsMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);

  const voice = useRoomVoice({
    room: activeRoom,
    uid,
    participants,
  });

  const voiceLeaveRef = useRef(voice.leaveVoice);
  activeRoomIdRef.current = activeRoomId;
  uidRef.current = uid;
  onChangeAmbientSoundRef.current = onChangeAmbientSound;
  voiceLeaveRef.current = voice.leaveVoice;

  const stopAllRoomAudio = () => {
    ambientAudio.stop();
    onChangeAmbientSoundRef.current('none');
  };

  useEffect(() => {
    const unsubPub = subscribePublicFocusRooms(setPublicRooms);
    const unsubHosted = subscribeHostedFocusRooms(uid, setHostedRooms);
    return () => {
      unsubPub();
      unsubHosted();
    };
  }, [uid]);

  useEffect(() => {
    return () => {
      if (activeRoomIdRef.current) {
        ambientAudio.stop();
        onChangeAmbientSoundRef.current('none');
        void voiceLeaveRef.current(true);
        void leaveFocusRoom(activeRoomIdRef.current, uidRef.current).catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    if (!activeRoomId) {
      setActiveRoom(null);
      setParticipants([]);
      setMessages([]);
      return;
    }
    const unsubRoom = subscribeFocusRoom(activeRoomId, (room) => {
      if (!room || !room.isActive) {
        stopAllRoomAudio();
        void voiceLeaveRef.current(true);
        setActiveRoomId(null);
        setActiveRoom(null);
        setSessionNotice(null);
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
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [activeRoom?.id, activeRoom?.timerStatus, activeRoom?.timerStartedAtMs]);

  const computeRoomElapsedSeconds = (room: FocusRoom): number => {
    const runningDelta =
      room.timerStatus === 'running' && room.timerStartedAtMs > 0
        ? Math.max(0, Math.floor((nowMs - room.timerStartedAtMs) / 1000))
        : 0;
    return room.timerAccumulatedSeconds + runningDelta;
  };

  useEffect(() => {
    if (!activeRoom) return;
    if (activeRoom.timerMode !== 'timer' || activeRoom.timerStatus !== 'running') return;
    const runningDelta =
      activeRoom.timerStartedAtMs > 0
        ? Math.max(0, Math.floor((nowMs - activeRoom.timerStartedAtMs) / 1000))
        : 0;
    const elapsed = activeRoom.timerAccumulatedSeconds + runningDelta;
    if (elapsed < activeRoom.timerDurationSeconds) return;

    const runKey = `${activeRoom.id}_${activeRoom.timerStartedAtMs}`;
    if (completedRoomTimerKeyRef.current === runKey) return;
    completedRoomTimerKeyRef.current = runKey;

    if (chimesEnabled) {
      ambientAudio.playCompletionChime();
    }
    setSessionNotice('Room focus block complete! Click "Log Room Session" to save this block.');

    if (activeRoom.hostId === uid) {
      void updateRoomTimerAndSound(activeRoom.id, {
        timerMode: activeRoom.timerMode,
        timerDurationSeconds: activeRoom.timerDurationSeconds,
        timerStatus: 'idle',
        timerStartedAtMs: 0,
        timerAccumulatedSeconds: 0,
        ambientSound: activeRoom.ambientSound,
      }).catch((err) => {
        setRoomError(err instanceof Error ? err.message : 'Unable to reset room timer.');
      });
    }
  }, [activeRoom, nowMs, uid, chimesEnabled]);

  const scrollToChatBottom = (behavior: ScrollBehavior = 'smooth') => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    isChatPinnedBottomRef.current = true;
    setChatScrolledUp(false);
    setHasUnreadChat(false);
  };

  const handleChatScroll = () => {
    const el = chatScrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom <= 36;
    isChatPinnedBottomRef.current = atBottom;
    setChatScrolledUp(!atBottom);
    if (atBottom) {
      setHasUnreadChat(false);
    }
  };

  useEffect(() => {
    isChatPinnedBottomRef.current = true;
    prevLastMessageIdRef.current = null;
    setChatScrolledUp(false);
    setHasUnreadChat(false);
  }, [activeRoom?.id]);

  useEffect(() => {
    const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
    const lastId = lastMsg?.id ?? null;
    const isNewTailMessage = lastId !== null && lastId !== prevLastMessageIdRef.current;
    prevLastMessageIdRef.current = lastId;

    if (!chatScrollRef.current) return;

    if (isChatPinnedBottomRef.current || lastMsg?.senderId === uid) {
      const rafId = window.requestAnimationFrame(() => {
        const el = chatScrollRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
        isChatPinnedBottomRef.current = true;
        setChatScrolledUp(false);
        setHasUnreadChat(false);
      });
      return () => window.cancelAnimationFrame(rafId);
    }

    if (isNewTailMessage) {
      setHasUnreadChat(true);
    }
  }, [messages, activeRoom?.id, uid]);

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
        chatEnabled: roomCreateChatEnabled,
        voiceEnabled: roomCreateVoiceEnabled,
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
    setRoomError(null);
    const now = Date.now();
    setNowMs(now);
    const runningDelta =
      activeRoom.timerStatus === 'running' && activeRoom.timerStartedAtMs > 0
        ? Math.max(0, Math.floor((now - activeRoom.timerStartedAtMs) / 1000))
        : 0;
    const elapsed = activeRoom.timerAccumulatedSeconds + runningDelta;

    try {
      if (action === 'start') {
        setSessionNotice(null);
        await updateRoomTimerAndSound(activeRoom.id, {
          timerMode: activeRoom.timerMode,
          timerDurationSeconds: activeRoom.timerDurationSeconds,
          timerStatus: 'running',
          timerStartedAtMs: now,
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
        setSessionNotice(null);
        await updateRoomTimerAndSound(activeRoom.id, {
          timerMode: activeRoom.timerMode,
          timerDurationSeconds: activeRoom.timerDurationSeconds,
          timerStatus: 'idle',
          timerStartedAtMs: 0,
          timerAccumulatedSeconds: 0,
          ambientSound: activeRoom.ambientSound,
        });
      }
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : 'Unable to update room timer.');
    }
  };

  const handleHostUpdateRoomConfig = async (
    nextMode: RoomTimerMode,
    nextMins: number,
    nextSound: AmbientSoundId,
  ) => {
    if (!activeRoom || activeRoom.hostId !== uid) return;
    setRoomError(null);
    try {
      await updateRoomTimerAndSound(activeRoom.id, {
        timerMode: nextMode,
        timerDurationSeconds: Math.max(1, Math.min(240, nextMins)) * 60,
        timerStatus: 'idle',
        timerStartedAtMs: 0,
        timerAccumulatedSeconds: 0,
        ambientSound: nextSound,
      });
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : 'Unable to update room timer settings.');
    }
  };

  const handleLogRoomSession = async () => {
    if (!activeRoom) return;
    setRoomError(null);
    const roomElapsed = computeRoomElapsedSeconds(activeRoom);
    const localElapsed = Math.max(0, Math.floor((Date.now() - localSessionStartMs) / 1000));
    const durationToLog = roomElapsed >= 15 ? roomElapsed : localElapsed;
    if (durationToLog < 10) {
      setSessionNotice('Study in the room for at least 10 seconds before logging.');
      return;
    }
    const subj = selectedSubjectId ? subjectsMap.get(selectedSubjectId) : undefined;
    try {
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
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : 'Unable to log room session.');
    }
  };

  const handleLeaveRoom = async () => {
    if (!activeRoom) return;
    const roomIdToLeave = activeRoom.id;
    stopAllRoomAudio();
    await voice.leaveVoice(true);
    setActiveRoomId(null);
    setActiveRoom(null);
    setSessionNotice(null);
    await leaveFocusRoom(roomIdToLeave, uid);
  };

  const handleEndRoom = async () => {
    if (!activeRoom || activeRoom.hostId !== uid) return;
    const roomIdToClose = activeRoom.id;
    stopAllRoomAudio();
    await voice.leaveVoice(false);
    setActiveRoomId(null);
    setActiveRoom(null);
    setSessionNotice(null);
    await closeFocusRoom(roomIdToClose);
  };

  const handleToggleHostRoomComms = async (field: 'chatEnabled' | 'voiceEnabled') => {
    if (!activeRoom || activeRoom.hostId !== uid) return;
    setRoomError(null);
    const currentChat = activeRoom.chatEnabled !== false;
    const currentVoice = activeRoom.voiceEnabled !== false;
    try {
      await updateRoomCommunicationSettings(activeRoom.id, {
        chatEnabled: field === 'chatEnabled' ? !currentChat : currentChat,
        voiceEnabled: field === 'voiceEnabled' ? !currentVoice : currentVoice,
      });
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : 'Unable to update room communication settings.');
    }
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

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRoom || activeRoom.chatEnabled === false || !chatText.trim() || sendingChat) return;
    const text = chatText.trim();
    setChatText('');
    setSendingChat(true);
    setRoomError(null);
    try {
      await sendRoomMessage(activeRoom, uid, profile.displayName, text);
    } catch (err) {
      setChatText(text);
      setRoomError(err instanceof Error ? err.message : 'Could not send message.');
    } finally {
      setSendingChat(false);
    }
  };

  const handleDeleteChat = async (messageId: string) => {
    if (!activeRoom) return;
    try {
      await deleteRoomMessage(activeRoom.id, messageId);
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : 'Could not delete message.');
    }
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
    const chatEnabled = activeRoom.chatEnabled !== false;
    const voiceEnabled = activeRoom.voiceEnabled !== false;
    const activeVoiceParticipants = participants.filter((p) => Boolean(p.voiceJoined));
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

        {roomError && (
          <div className="p-3.5 rounded-2xl border border-red-200 bg-red-50 text-red-800 text-xs">
            {roomError}
          </div>
        )}

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
                          val as RoomTimerMode,
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

            {/* Voice Channel & Voice Settings */}
            <section className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-[var(--pastel-soft)] flex items-center justify-center shrink-0">
                    {voiceEnabled ? (
                      <Mic className="w-4 h-4 text-[var(--pastel-ink)]" />
                    ) : (
                      <MicOff className="w-4 h-4 text-[var(--pastel-muted)]" />
                    )}
                  </div>
                  <div>
                    <h2 className="text-base font-extrabold tracking-tight">
                      Voice Room ({activeVoiceParticipants.length} connected)
                    </h2>
                    <p className="text-xs text-[var(--pastel-muted)]">
                      {!voiceEnabled
                        ? 'Voice chat is muted by the room host for silent study.'
                        : voice.voiceJoined
                          ? voice.settings.deafened
                            ? 'Deafened — incoming voices and mic are muted.'
                            : voice.settings.voiceMode === 'push_to_talk'
                              ? voice.isPttPressed
                                ? 'Transmitting (Push-to-Talk active)'
                                : 'Push-to-Talk ready — hold Space or Hold to Talk'
                              : voice.effectiveMuted
                                ? 'In voice · Microphone muted'
                                : voice.isSpeaking
                                  ? 'In voice · Speaking now'
                                  : 'In voice · Microphone live'
                          : 'Join voice to talk with learners in this room.'}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {isHost && (
                    <button
                      type="button"
                      onClick={() => void handleToggleHostRoomComms('voiceEnabled')}
                      className={`px-3.5 py-1.5 rounded-full border text-xs font-bold cursor-pointer whitespace-nowrap ${
                        voiceEnabled
                          ? 'border-[var(--pastel-border)] bg-[var(--pastel-canvas)] hover:bg-[var(--pastel-soft)]'
                          : 'border-red-200 bg-red-50 text-red-700'
                      }`}
                    >
                      {voiceEnabled ? 'Host: Voice On' : 'Host: Voice Off'}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setShowVoiceSettings((prev) => !prev)}
                    className={`px-3.5 py-1.5 rounded-full border text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                      showVoiceSettings
                        ? 'bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] border-[var(--pastel-accent)]'
                        : 'border-[var(--pastel-border)] bg-[var(--pastel-canvas)] hover:bg-[var(--pastel-soft)]'
                    }`}
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span>Voice Settings</span>
                  </button>
                </div>
              </div>

              {voice.voiceError && (
                <div className="p-3 rounded-2xl border border-red-200 bg-red-50 text-red-800 text-xs">
                  {voice.voiceError}
                </div>
              )}

              {/* Primary Voice Controls */}
              <div className="flex flex-wrap items-center gap-2">
                {!voice.voiceJoined ? (
                  <button
                    type="button"
                    disabled={!voiceEnabled || voice.connectingVoice}
                    onClick={() => void voice.joinVoice()}
                    className="px-5 py-2 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold inline-flex items-center gap-1.5 hover:opacity-90 cursor-pointer disabled:opacity-45"
                  >
                    <Mic className="w-3.5 h-3.5" />
                    <span>{voice.connectingVoice ? 'Connecting Mic...' : 'Join Voice'}</span>
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => void voice.leaveVoice()}
                      className="px-4 py-2 rounded-full border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <PhoneOff className="w-3.5 h-3.5" />
                      <span>Leave Voice</span>
                    </button>

                    {voice.settings.voiceMode === 'open_mic' ? (
                      <button
                        type="button"
                        onClick={() => voice.setIsMuted((prev) => !prev)}
                        className={`px-4 py-2 rounded-full border text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer ${
                          voice.isMuted
                            ? 'border-red-200 bg-red-50 text-red-700'
                            : 'border-[var(--pastel-border)] bg-[var(--pastel-soft)] text-[var(--pastel-ink)]'
                        }`}
                      >
                        {voice.isMuted ? (
                          <MicOff className="w-3.5 h-3.5" />
                        ) : (
                          <Mic className="w-3.5 h-3.5" />
                        )}
                        <span>{voice.isMuted ? 'Unmute Mic' : 'Mute Mic'}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onMouseDown={() => voice.setIsPttPressed(true)}
                        onMouseUp={() => voice.setIsPttPressed(false)}
                        onMouseLeave={() => voice.setIsPttPressed(false)}
                        onTouchStart={() => voice.setIsPttPressed(true)}
                        onTouchEnd={() => voice.setIsPttPressed(false)}
                        className={`px-4 py-2 rounded-full border text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer select-none ${
                          voice.isPttPressed
                            ? 'bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] border-[var(--pastel-accent)]'
                            : 'border-[var(--pastel-border)] bg-[var(--pastel-canvas)] hover:bg-[var(--pastel-soft)]'
                        }`}
                      >
                        <Mic className="w-3.5 h-3.5" />
                        <span>{voice.isPttPressed ? 'Talking...' : 'Hold to Talk (Space)'}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        void voice.updateVoiceSettings({ deafened: !voice.settings.deafened })
                      }
                      className={`px-4 py-2 rounded-full border text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer ${
                        voice.settings.deafened
                          ? 'border-red-200 bg-red-50 text-red-700'
                          : 'border-[var(--pastel-border)] bg-[var(--pastel-canvas)] hover:bg-[var(--pastel-soft)]'
                      }`}
                    >
                      {voice.settings.deafened ? (
                        <HeadphoneOff className="w-3.5 h-3.5" />
                      ) : (
                        <Headphones className="w-3.5 h-3.5" />
                      )}
                      <span>{voice.settings.deafened ? 'Undeafen' : 'Deafen'}</span>
                    </button>
                  </>
                )}
              </div>

              {/* Voice Volume & Live Mic Level */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[var(--pastel-muted)]">
                      Incoming Voice Volume
                    </span>
                    <span className="font-mono-tabular text-[var(--pastel-muted)]">
                      {voice.settings.deafened
                        ? 'Deafened'
                        : `${Math.round(voice.settings.masterVolume * 100)}%`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(voice.settings.masterVolume * 100)}
                    onChange={(e) =>
                      void voice.updateVoiceSettings({
                        masterVolume: Number(e.target.value) / 100,
                        deafened: false,
                      })
                    }
                    aria-label="Incoming voice volume"
                    className="w-full accent-[var(--pastel-accent)] cursor-pointer"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[var(--pastel-muted)]">
                      Microphone Input Level
                    </span>
                    <span className="font-mono-tabular text-[var(--pastel-muted)]">
                      {voice.voiceJoined
                        ? voice.effectiveMuted
                          ? 'Muted'
                          : `${voice.micLevel}%`
                        : 'Offline'}
                    </span>
                  </div>
                  <div className="h-2.5 rounded-full bg-[var(--pastel-soft)] overflow-hidden border border-[var(--pastel-border)]">
                    <div
                      className="h-full rounded-full bg-[var(--pastel-accent)] transition-all duration-100"
                      style={{
                        width: `${voice.voiceJoined && !voice.effectiveMuted ? voice.micLevel : 0}%`,
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Expandable Voice Settings Drawer */}
              {showVoiceSettings && (
                <div className="p-4 rounded-2xl bg-[var(--pastel-canvas)] border border-[var(--pastel-border)] space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-extrabold tracking-tight">
                      Audio &amp; Microphone Settings
                    </div>
                    <button
                      type="button"
                      onClick={() => void voice.refreshDevices()}
                      className="text-[11px] font-bold text-[var(--pastel-muted)] hover:text-[var(--pastel-ink)] inline-flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Refresh Devices</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <span className="text-[11px] font-bold text-[var(--pastel-muted)]">
                        Microphone Input
                      </span>
                      <PastelSelect
                        value={voice.settings.inputDeviceId}
                        onChange={(val) => void voice.updateVoiceSettings({ inputDeviceId: val })}
                        ariaLabel="Microphone input device"
                        variant="field"
                        className="w-full"
                        options={[
                          { value: '', label: 'System Default Mic' },
                          ...voice.inputDevices
                            .filter((d) => d.deviceId)
                            .map((d) => ({ value: d.deviceId, label: d.label })),
                        ]}
                      />
                    </div>

                    <div className="space-y-1">
                      <span className="text-[11px] font-bold text-[var(--pastel-muted)]">
                        Speaker / Headphones
                      </span>
                      <PastelSelect
                        value={voice.settings.outputDeviceId}
                        onChange={(val) => void voice.updateVoiceSettings({ outputDeviceId: val })}
                        ariaLabel="Speaker output device"
                        variant="field"
                        className="w-full"
                        options={[
                          { value: '', label: 'System Default Output' },
                          ...voice.outputDevices
                            .filter((d) => d.deviceId)
                            .map((d) => ({ value: d.deviceId, label: d.label })),
                        ]}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-[11px] font-bold text-[var(--pastel-muted)]">
                      Talking Mode
                    </span>
                    <div className="flex items-center gap-1.5 p-1 bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-full">
                      {(
                        [
                          { id: 'open_mic' as const, label: 'Open Mic (Mute/Unmute)' },
                          { id: 'push_to_talk' as const, label: 'Push-to-Talk (Hold Space)' },
                        ]
                      ).map((mode) => (
                        <button
                          key={mode.id}
                          type="button"
                          onClick={() =>
                            void voice.updateVoiceSettings({ voiceMode: mode.id })
                          }
                          className={`flex-1 py-1.5 px-3 text-xs font-bold rounded-full transition-colors cursor-pointer ${
                            voice.settings.voiceMode === mode.id
                              ? 'bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)]'
                              : 'text-[var(--pastel-muted)] hover:text-[var(--pastel-ink)]'
                          }`}
                        >
                          {mode.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {(
                      [
                        { key: 'echoCancellation' as const, label: 'Echo Cancellation' },
                        { key: 'noiseSuppression' as const, label: 'Noise Suppression' },
                        { key: 'autoGainControl' as const, label: 'Auto Gain Control' },
                      ]
                    ).map((toggle) => {
                      const active = voice.settings[toggle.key];
                      return (
                        <button
                          key={toggle.key}
                          type="button"
                          role="switch"
                          aria-checked={active}
                          onClick={() =>
                            void voice.updateVoiceSettings({ [toggle.key]: !active })
                          }
                          className={`px-3 py-2 rounded-2xl border text-xs font-bold flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                            active
                              ? 'border-[var(--pastel-accent)] bg-[var(--pastel-soft)] text-[var(--pastel-ink)]'
                              : 'border-[var(--pastel-border)] bg-[var(--pastel-surface)] text-[var(--pastel-muted)]'
                          }`}
                        >
                          <span className="truncate">{toggle.label}</span>
                          <span>{active ? 'On' : 'Off'}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* Participants & Room Text Chat */}
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
                  const isSelf = p.uid === uid;
                  const inVoice = Boolean(p.voiceJoined);
                  const peerSpeaking = inVoice && Boolean(p.isSpeaking) && !p.isMuted;
                  const override = voice.peerOverrides[p.uid] || { volume: 1, muted: false };

                  return (
                    <div key={p.id} className="py-3 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          {p.avatarUrl ? (
                            <img
                              src={p.avatarUrl}
                              alt={p.displayName}
                              referrerPolicy="no-referrer"
                              className={`w-8 h-8 rounded-full object-cover bg-[var(--pastel-soft)] shrink-0 ${
                                peerSpeaking ? 'ring-2 ring-[var(--pastel-accent)] ring-offset-1' : ''
                              }`}
                            />
                          ) : (
                            <div
                              className={`w-8 h-8 rounded-full bg-[var(--pastel-soft)] text-[var(--pastel-ink)] text-xs font-extrabold flex items-center justify-center shrink-0 ${
                                peerSpeaking ? 'ring-2 ring-[var(--pastel-accent)] ring-offset-1' : ''
                              }`}
                            >
                              {initials}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-sm font-bold truncate">
                                {p.displayName}
                                {isSelf ? ' (You)' : ''}
                              </span>
                              {inVoice && (
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold inline-flex items-center gap-1 shrink-0 ${
                                    p.isMuted
                                      ? 'bg-[var(--pastel-canvas)] border border-[var(--pastel-border)] text-[var(--pastel-muted)]'
                                      : peerSpeaking
                                        ? 'bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)]'
                                        : 'bg-[var(--pastel-soft)] text-[var(--pastel-ink)]'
                                  }`}
                                >
                                  {p.isMuted ? (
                                    <MicOff className="w-2.5 h-2.5" />
                                  ) : (
                                    <Mic className="w-2.5 h-2.5" />
                                  )}
                                  <span>
                                    {p.isMuted ? 'Muted' : peerSpeaking ? 'Speaking' : 'Mic On'}
                                  </span>
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-[var(--pastel-muted)] truncate">
                              {p.subjectName || 'General Study'}
                            </div>
                          </div>
                        </div>
                        <span className="text-xs font-bold text-[var(--pastel-muted)] capitalize shrink-0">
                          {p.status}
                        </span>
                      </div>

                      {!isSelf && inVoice && voice.voiceJoined && (
                        <div className="pl-11 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              voice.setPeerAudioOverride(p.uid, { muted: !override.muted })
                            }
                            aria-label={override.muted ? `Unmute ${p.displayName}` : `Mute ${p.displayName}`}
                            className="p-1 rounded-full border border-[var(--pastel-border)] text-[var(--pastel-muted)] hover:text-[var(--pastel-ink)] cursor-pointer shrink-0"
                          >
                            {override.muted ? (
                              <VolumeX className="w-3 h-3 text-red-600" />
                            ) : (
                              <Volume2 className="w-3 h-3" />
                            )}
                          </button>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={override.muted ? 0 : Math.round(override.volume * 100)}
                            onChange={(e) =>
                              voice.setPeerAudioOverride(p.uid, {
                                volume: Number(e.target.value) / 100,
                                muted: Number(e.target.value) === 0,
                              })
                            }
                            aria-label={`Volume for ${p.displayName}`}
                            className="flex-1 max-w-[140px] accent-[var(--pastel-accent)] cursor-pointer"
                          />
                          <span className="text-[10px] font-mono-tabular text-[var(--pastel-muted)] w-8">
                            {override.muted ? '0%' : `${Math.round(override.volume * 100)}%`}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Real-Time Room Text Chat */}
            <section className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {chatEnabled ? (
                    <MessageSquare className="w-4 h-4 text-[var(--pastel-muted)]" />
                  ) : (
                    <MessageSquareOff className="w-4 h-4 text-[var(--pastel-muted)]" />
                  )}
                  <div>
                    <h2 className="text-base font-extrabold tracking-tight">
                      Room Chat ({messages.length})
                    </h2>
                    <p className="text-xs text-[var(--pastel-muted)]">
                      {chatEnabled
                        ? 'Talk, ask study questions, or check in with everyone here.'
                        : 'Text chat is paused by the host for quiet study.'}
                    </p>
                  </div>
                </div>

                {isHost && (
                  <button
                    type="button"
                    onClick={() => void handleToggleHostRoomComms('chatEnabled')}
                    className={`px-3 py-1 rounded-full border text-[11px] font-bold cursor-pointer whitespace-nowrap ${
                      chatEnabled
                        ? 'border-[var(--pastel-border)] bg-[var(--pastel-canvas)] hover:bg-[var(--pastel-soft)]'
                        : 'border-red-200 bg-red-50 text-red-700'
                    }`}
                  >
                    {chatEnabled ? 'Host: Chat On' : 'Host: Chat Off'}
                  </button>
                )}
              </div>

              <div className="relative">
                <div
                  ref={chatScrollRef}
                  onScroll={handleChatScroll}
                  className="max-h-72 min-h-[180px] overflow-y-auto overscroll-contain space-y-2.5 pr-1"
                >
                  {messages.length === 0 ? (
                    <p className="text-xs text-[var(--pastel-muted)] py-8 text-center">
                      No messages yet. Say hello or share what you&apos;re studying!
                    </p>
                  ) : (
                    messages.map((m) => {
                      const isMine = m.senderId === uid;
                      const isSenderHost = m.senderId === activeRoom.hostId;
                      const canDelete = isMine || isHost;
                      const timeStr = formatMessageTime(m.createdAt);

                      return (
                        <div
                          key={m.id}
                          className={`p-3.5 rounded-2xl border space-y-1 ${
                            isMine
                              ? 'bg-[var(--pastel-soft)] border-[var(--pastel-border)]'
                              : 'bg-[var(--pastel-canvas)] border-[var(--pastel-border)]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0 text-[11px] font-bold text-[var(--pastel-muted)]">
                              <span className="truncate text-[var(--pastel-ink)]">
                                {isMine ? 'You' : m.senderName}
                              </span>
                              {isSenderHost && (
                                <span className="px-1.5 py-0.5 rounded-full bg-[var(--pastel-surface)] border border-[var(--pastel-border)] text-[9px] uppercase tracking-wide">
                                  Host
                                </span>
                              )}
                              {timeStr && <span className="font-mono-tabular font-normal">{timeStr}</span>}
                            </div>
                            {canDelete && (
                              <button
                                type="button"
                                onClick={() => void handleDeleteChat(m.id)}
                                aria-label="Delete message"
                                className="p-1 text-[var(--pastel-muted)] hover:text-red-600 cursor-pointer shrink-0"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                          <p className="text-xs leading-relaxed break-words whitespace-pre-wrap">
                            {m.text}
                          </p>
                        </div>
                      );
                    })
                  )}
                </div>

                {chatScrolledUp && messages.length > 0 && (
                  <div className="flex justify-center pt-2">
                    <button
                      type="button"
                      onClick={() => scrollToChatBottom('smooth')}
                      className={`px-3.5 py-1.5 rounded-full text-[11px] font-bold inline-flex items-center gap-1.5 shadow-sm cursor-pointer transition-colors ${
                        hasUnreadChat
                          ? 'bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)]'
                          : 'bg-[var(--pastel-surface)] border border-[var(--pastel-border)] text-[var(--pastel-ink)] hover:bg-[var(--pastel-soft)]'
                      }`}
                    >
                      <ArrowDown className="w-3 h-3" />
                      <span>{hasUnreadChat ? 'New messages' : 'Jump to latest'}</span>
                    </button>
                  </div>
                )}
              </div>

              <form onSubmit={handleSendChat} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={chatText}
                    disabled={!chatEnabled || sendingChat}
                    onChange={(e) => setChatText(e.target.value)}
                    placeholder={
                      chatEnabled
                        ? 'Send a message to the room...'
                        : 'Text chat is paused by the host'
                    }
                    maxLength={BLUEPRINT_LIMITS.ROOM_MESSAGE_MAX}
                    className="flex-1 px-4 py-2.5 text-xs rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={!chatEnabled || !chatText.trim() || sendingChat}
                    className="w-9 h-9 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] hover:opacity-90 flex items-center justify-center cursor-pointer disabled:opacity-40 shrink-0"
                    aria-label="Send message"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>
                {chatText.length >= 750 && (
                  <div className="text-[10px] font-mono-tabular text-[var(--pastel-muted)] text-right">
                    {chatText.length} / {BLUEPRINT_LIMITS.ROOM_MESSAGE_MAX}
                  </div>
                )}
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
                onChange={(val) => setRoomTimerMode(val as RoomTimerMode)}
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

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button
              type="button"
              role="switch"
              aria-checked={roomCreateChatEnabled}
              onClick={() => setRoomCreateChatEnabled((prev) => !prev)}
              className={`px-4 py-2 rounded-full border text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                roomCreateChatEnabled
                  ? 'bg-[var(--pastel-soft)] border-[var(--pastel-accent)] text-[var(--pastel-ink)]'
                  : 'bg-[var(--pastel-canvas)] border-[var(--pastel-border)] text-[var(--pastel-muted)]'
              }`}
            >
              {roomCreateChatEnabled ? (
                <MessageSquare className="w-3.5 h-3.5" />
              ) : (
                <MessageSquareOff className="w-3.5 h-3.5" />
              )}
              <span>{roomCreateChatEnabled ? 'Text Chat: On' : 'Text Chat: Off'}</span>
            </button>

            <button
              type="button"
              role="switch"
              aria-checked={roomCreateVoiceEnabled}
              onClick={() => setRoomCreateVoiceEnabled((prev) => !prev)}
              className={`px-4 py-2 rounded-full border text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                roomCreateVoiceEnabled
                  ? 'bg-[var(--pastel-soft)] border-[var(--pastel-accent)] text-[var(--pastel-ink)]'
                  : 'bg-[var(--pastel-canvas)] border-[var(--pastel-border)] text-[var(--pastel-muted)]'
              }`}
            >
              {roomCreateVoiceEnabled ? (
                <Mic className="w-3.5 h-3.5" />
              ) : (
                <MicOff className="w-3.5 h-3.5" />
              )}
              <span>{roomCreateVoiceEnabled ? 'Voice Room: On' : 'Voice Room: Off'}</span>
            </button>
          </div>

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
                    <div className="text-xs text-[var(--pastel-muted)] flex flex-wrap items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5" />
                      <span>{room.hostName}</span>
                      <span aria-hidden="true">·</span>
                      <span className="capitalize">{room.timerMode}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {room.voiceEnabled !== false && room.chatEnabled !== false
                          ? 'Text & Voice'
                          : room.chatEnabled !== false
                            ? 'Text Chat'
                            : room.voiceEnabled !== false
                              ? 'Voice Only'
                              : 'Silent'}
                      </span>
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
