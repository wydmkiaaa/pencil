import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteRoomVoiceSignal,
  sendRoomVoiceSignal,
  subscribeRoomVoiceSignals,
  updateParticipantVoiceState,
} from './studyRepo';
import type {
  FocusRoom,
  RoomParticipant,
  RoomVoiceSignal,
  VoiceSettings,
} from '../types/study';

export interface MediaDeviceOption {
  deviceId: string;
  label: string;
}

export interface PeerAudioOverride {
  volume: number;
  muted: boolean;
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const VOICE_STORAGE_KEY = 'pencil_room_voice_settings_v1';

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  inputDeviceId: '',
  outputDeviceId: '',
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  voiceMode: 'open_mic',
  masterVolume: 1,
  deafened: false,
};

export function loadStoredVoiceSettings(): VoiceSettings {
  try {
    const raw = window.localStorage.getItem(VOICE_STORAGE_KEY);
    if (!raw) return DEFAULT_VOICE_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<VoiceSettings>;
    return {
      inputDeviceId: typeof parsed.inputDeviceId === 'string' ? parsed.inputDeviceId : '',
      outputDeviceId: typeof parsed.outputDeviceId === 'string' ? parsed.outputDeviceId : '',
      echoCancellation: parsed.echoCancellation ?? true,
      noiseSuppression: parsed.noiseSuppression ?? true,
      autoGainControl: parsed.autoGainControl ?? true,
      voiceMode: parsed.voiceMode === 'push_to_talk' ? 'push_to_talk' : 'open_mic',
      masterVolume:
        typeof parsed.masterVolume === 'number'
          ? Math.max(0, Math.min(1, parsed.masterVolume))
          : 1,
      deafened: Boolean(parsed.deafened),
    };
  } catch {
    return DEFAULT_VOICE_SETTINGS;
  }
}

interface UseRoomVoiceParams {
  room: FocusRoom | null;
  uid: string;
  participants: RoomParticipant[];
}

interface PeerConnectionEntry {
  pc: RTCPeerConnection;
  remoteSessionId: string;
  pendingIce: RTCIceCandidateInit[];
  remoteStream: MediaStream | null;
  audioEl: HTMLAudioElement | null;
}

export function useRoomVoice({ room, uid, participants }: UseRoomVoiceParams) {
  const [settings, setSettings] = useState<VoiceSettings>(() => loadStoredVoiceSettings());
  const [voiceJoined, setVoiceJoined] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isPttPressed, setIsPttPressed] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [connectingVoice, setConnectingVoice] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [inputDevices, setInputDevices] = useState<MediaDeviceOption[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceOption[]>([]);
  const [peerOverrides, setPeerOverrides] = useState<Record<string, PeerAudioOverride>>({});
  const [connectedPeerUids, setConnectedPeerUids] = useState<string[]>([]);

  const sessionIdRef = useRef<string>('');
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, PeerConnectionEntry>>(new Map());
  const processedSignalsRef = useRef<Set<string>>(new Set());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const meterTimerRef = useRef<number | null>(null);
  const speakingRef = useRef(false);
  const lastSpeakingChangeRef = useRef(0);
  const roomRef = useRef<FocusRoom | null>(room);
  const lastVoiceRoomRef = useRef<FocusRoom | null>(room);
  const settingsRef = useRef<VoiceSettings>(settings);
  const effectiveMutedRef = useRef<boolean>(true);
  const voiceJoinedRef = useRef<boolean>(false);
  const joinTokenRef = useRef<number>(0);

  roomRef.current = room;
  if (room) {
    lastVoiceRoomRef.current = room;
  }
  settingsRef.current = settings;
  voiceJoinedRef.current = voiceJoined;

  const effectiveMuted =
    !voiceJoined ||
    settings.deafened ||
    (settings.voiceMode === 'push_to_talk' ? !isPttPressed : isMuted);

  effectiveMutedRef.current = effectiveMuted;

  useEffect(() => {
    try {
      window.localStorage.setItem(VOICE_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // ignore storage failure
    }
  }, [settings]);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs: MediaDeviceOption[] = [];
      const outputs: MediaDeviceOption[] = [];
      devices.forEach((d, idx) => {
        if (d.kind === 'audioinput') {
          inputs.push({
            deviceId: d.deviceId,
            label: d.label || `Microphone ${inputs.length + 1}`,
          });
        } else if (d.kind === 'audiooutput') {
          outputs.push({
            deviceId: d.deviceId,
            label: d.label || `Speaker ${outputs.length + 1}`,
          });
        }
        void idx;
      });
      setInputDevices(inputs);
      setOutputDevices(outputs);
    } catch {
      // ignore permission-gated enumerate errors
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;
    const handler = () => void refreshDevices();
    mediaDevices.addEventListener('devicechange', handler);
    return () => mediaDevices.removeEventListener('devicechange', handler);
  }, [refreshDevices]);

  const syncConnectedPeersState = useCallback(() => {
    const active: string[] = [];
    peersRef.current.forEach((entry, peerUid) => {
      if (entry.pc.connectionState !== 'closed') {
        active.push(peerUid);
      }
    });
    setConnectedPeerUids(active);
  }, []);

  const applyAudioElementSettings = useCallback(
    (peerUid: string, audioEl: HTMLAudioElement | null) => {
      if (!audioEl) return;
      const override = peerOverrides[peerUid];
      const peerVol = override ? override.volume : 1;
      const peerMuted = override ? override.muted : false;
      audioEl.muted = settings.deafened || peerMuted;
      audioEl.volume = Math.max(0, Math.min(1, settings.masterVolume * peerVol));

      const sinkCapable = audioEl as HTMLAudioElement & {
        setSinkId?: (sinkId: string) => Promise<void>;
      };
      if (settings.outputDeviceId && typeof sinkCapable.setSinkId === 'function') {
        void sinkCapable.setSinkId(settings.outputDeviceId).catch(() => {
          // fallback to default audio output
        });
      }
    },
    [peerOverrides, settings.deafened, settings.masterVolume, settings.outputDeviceId],
  );

  useEffect(() => {
    peersRef.current.forEach((entry, peerUid) => {
      applyAudioElementSettings(peerUid, entry.audioEl);
    });
  }, [applyAudioElementSettings]);

  const teardownPeer = useCallback(
    (peerUid: string) => {
      const entry = peersRef.current.get(peerUid);
      if (!entry) return;
      if (entry.audioEl) {
        entry.audioEl.pause();
        entry.audioEl.muted = true;
        entry.audioEl.srcObject = null;
        entry.audioEl.removeAttribute('src');
        entry.audioEl.remove();
        entry.audioEl = null;
      }
      try {
        entry.pc.onicecandidate = null;
        entry.pc.ontrack = null;
        entry.pc.onconnectionstatechange = null;
        entry.pc.close();
      } catch {
        // ignore close errors
      }
      peersRef.current.delete(peerUid);
      syncConnectedPeersState();
    },
    [syncConnectedPeersState],
  );

  const stopMeter = useCallback(() => {
    if (meterTimerRef.current !== null) {
      window.clearInterval(meterTimerRef.current);
      meterTimerRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setMicLevel(0);
    if (speakingRef.current) {
      speakingRef.current = false;
      setIsSpeaking(false);
    }
  }, []);

  const startMeter = useCallback(
    (stream: MediaStream) => {
      stopMeter();
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      meterTimerRef.current = window.setInterval(() => {
        if (effectiveMutedRef.current) {
          setMicLevel(0);
          if (speakingRef.current) {
            speakingRef.current = false;
            setIsSpeaking(false);
            const r = roomRef.current;
            if (r && voiceJoinedRef.current) {
              void updateParticipantVoiceState(r.id, uid, {
                voiceJoined: true,
                isMuted: true,
                isSpeaking: false,
                voiceSessionId: sessionIdRef.current,
              }).catch(() => {});
            }
          }
          return;
        }

        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) {
          sum += data[i];
        }
        const avg = sum / Math.max(1, data.length);
        const level = Math.min(100, Math.round((avg / 90) * 100));
        setMicLevel(level);

        const now = Date.now();
        const nextSpeaking = level >= 12;
        if (nextSpeaking !== speakingRef.current && now - lastSpeakingChangeRef.current > 350) {
          speakingRef.current = nextSpeaking;
          lastSpeakingChangeRef.current = now;
          setIsSpeaking(nextSpeaking);
          const r = roomRef.current;
          if (r && voiceJoinedRef.current) {
            void updateParticipantVoiceState(r.id, uid, {
              voiceJoined: true,
              isMuted: false,
              isSpeaking: nextSpeaking,
              voiceSessionId: sessionIdRef.current,
            }).catch(() => {});
          }
        }
      }, 110);
    },
    [stopMeter, uid],
  );

  const leaveVoice = useCallback(
    async (skipFirestoreUpdate = false) => {
      joinTokenRef.current += 1;
      voiceJoinedRef.current = false;

      const targetRoom = roomRef.current || lastVoiceRoomRef.current;
      const currentSession = sessionIdRef.current;
      const peerUids = Array.from(peersRef.current.keys());

      // Synchronously stop all remote peer playback and local microphone capture first
      peerUids.forEach((peerUid) => teardownPeer(peerUid));
      stopMeter();

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }

      sessionIdRef.current = '';
      lastVoiceRoomRef.current = null;
      processedSignalsRef.current.clear();
      setVoiceJoined(false);
      setConnectingVoice(false);
      setIsPttPressed(false);
      setIsSpeaking(false);

      if (targetRoom && currentSession && peerUids.length > 0) {
        await Promise.all(
          peerUids.map((peerUid) =>
            sendRoomVoiceSignal(targetRoom, {
              fromUid: uid,
              toUid: peerUid,
              sessionId: currentSession,
              kind: 'bye',
              payload: '{}',
            }).catch(() => {}),
          ),
        );
      }

      if (!skipFirestoreUpdate && targetRoom) {
        await updateParticipantVoiceState(targetRoom.id, uid, {
          voiceJoined: false,
          isMuted: true,
          isSpeaking: false,
          voiceSessionId: '',
        }).catch(() => {});
      }
    },
    [stopMeter, teardownPeer, uid],
  );

  const captureLocalMicStream = useCallback(async (cfg: VoiceSettings): Promise<MediaStream> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone access is not supported in this browser.');
    }
    const audioConstraints: MediaTrackConstraints = {
      echoCancellation: cfg.echoCancellation,
      noiseSuppression: cfg.noiseSuppression,
      autoGainControl: cfg.autoGainControl,
      ...(cfg.inputDeviceId ? { deviceId: { exact: cfg.inputDeviceId } } : {}),
    };
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
    } catch (err) {
      if (cfg.inputDeviceId) {
        // Retry with default microphone if selected device disappeared
        return await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: cfg.echoCancellation,
            noiseSuppression: cfg.noiseSuppression,
            autoGainControl: cfg.autoGainControl,
          },
          video: false,
        });
      }
      throw err;
    }
  }, []);

  const joinVoice = useCallback(async () => {
    const currentRoom = roomRef.current;
    if (!currentRoom) return;
    if (currentRoom.voiceEnabled === false) {
      setVoiceError('Voice chat is currently turned off by the room host.');
      return;
    }

    const token = joinTokenRef.current + 1;
    joinTokenRef.current = token;
    const targetRoomId = currentRoom.id;

    setVoiceError(null);
    setConnectingVoice(true);
    try {
      const stream = await captureLocalMicStream(settingsRef.current);
      if (
        joinTokenRef.current !== token ||
        !roomRef.current ||
        roomRef.current.id !== targetRoomId ||
        roomRef.current.voiceEnabled === false
      ) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      localStreamRef.current = stream;
      const shouldStartMuted =
        settingsRef.current.deafened || settingsRef.current.voiceMode === 'push_to_talk' || isMuted;
      stream.getAudioTracks().forEach((t) => {
        t.enabled = !shouldStartMuted;
      });

      const newSessionId = `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      sessionIdRef.current = newSessionId;
      lastVoiceRoomRef.current = currentRoom;
      processedSignalsRef.current.clear();

      voiceJoinedRef.current = true;
      setVoiceJoined(true);
      startMeter(stream);
      void refreshDevices();

      await updateParticipantVoiceState(currentRoom.id, uid, {
        voiceJoined: true,
        isMuted: shouldStartMuted,
        isSpeaking: false,
        voiceSessionId: newSessionId,
      });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Could not access your microphone. Please check browser permissions.';
      setVoiceError(
        msg.toLowerCase().includes('denied') || msg.toLowerCase().includes('permission')
          ? 'Microphone permission was denied. Allow mic access in your browser settings to talk.'
          : msg,
      );
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
    } finally {
      if (joinTokenRef.current === token) {
        setConnectingVoice(false);
      }
    }
  }, [captureLocalMicStream, isMuted, refreshDevices, startMeter, uid]);

  // Apply mute state changes to active local audio tracks + sync Firestore
  useEffect(() => {
    if (!voiceJoined || !localStreamRef.current) return;
    localStreamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = !effectiveMuted;
    });
    const r = roomRef.current;
    if (r) {
      void updateParticipantVoiceState(r.id, uid, {
        voiceJoined: true,
        isMuted: effectiveMuted,
        isSpeaking: effectiveMuted ? false : speakingRef.current,
        voiceSessionId: sessionIdRef.current,
      }).catch(() => {});
    }
  }, [effectiveMuted, voiceJoined, uid]);

  // Push-to-Talk Spacebar listener (only when voiceJoined & push_to_talk & not typing)
  useEffect(() => {
    if (!voiceJoined || settings.voiceMode !== 'push_to_talk') {
      setIsPttPressed(false);
      return;
    }
    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || isTypingTarget(e.target)) return;
      e.preventDefault();
      setIsPttPressed(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      setIsPttPressed(false);
    };
    const onBlur = () => setIsPttPressed(false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [voiceJoined, settings.voiceMode]);

  // Hot-swap microphone device or constraints while connected
  const updateVoiceSettings = useCallback(
    async (partial: Partial<VoiceSettings>) => {
      const next: VoiceSettings = { ...settingsRef.current, ...partial };
      setSettings(next);

      const needsMicRefresh =
        voiceJoinedRef.current &&
        localStreamRef.current &&
        (partial.inputDeviceId !== undefined ||
          partial.echoCancellation !== undefined ||
          partial.noiseSuppression !== undefined ||
          partial.autoGainControl !== undefined);

      if (needsMicRefresh) {
        try {
          const newStream = await captureLocalMicStream(next);
          const newTrack = newStream.getAudioTracks()[0];
          if (newTrack) {
            newTrack.enabled = !effectiveMutedRef.current;
            peersRef.current.forEach((entry) => {
              const audioSender = entry.pc.getSenders().find((s) => s.track?.kind === 'audio');
              if (audioSender) {
                void audioSender.replaceTrack(newTrack).catch(() => {});
              } else {
                entry.pc.addTrack(newTrack, newStream);
              }
            });
          }
          localStreamRef.current?.getTracks().forEach((t) => t.stop());
          localStreamRef.current = newStream;
          startMeter(newStream);
          setVoiceError(null);
        } catch (err) {
          setVoiceError(err instanceof Error ? err.message : 'Unable to switch microphone settings.');
        }
      }
    },
    [captureLocalMicStream, startMeter],
  );

  const getOrCreatePeer = useCallback(
    (peerUid: string, remoteSessionId: string): PeerConnectionEntry => {
      const existing = peersRef.current.get(peerUid);
      if (existing && existing.remoteSessionId === remoteSessionId && existing.pc.connectionState !== 'closed') {
        return existing;
      }
      if (existing) {
        teardownPeer(peerUid);
      }

      const pc = new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS });
      const entry: PeerConnectionEntry = {
        pc,
        remoteSessionId,
        pendingIce: [],
        remoteStream: null,
        audioEl: null,
      };

      const stream = localStreamRef.current;
      if (stream) {
        stream.getAudioTracks().forEach((track) => {
          pc.addTrack(track, stream);
        });
      }

      pc.onicecandidate = (event) => {
        const currentRoom = roomRef.current;
        if (!event.candidate || !currentRoom || !sessionIdRef.current) return;
        void sendRoomVoiceSignal(currentRoom, {
          fromUid: uid,
          toUid: peerUid,
          sessionId: sessionIdRef.current,
          kind: 'ice',
          payload: JSON.stringify(event.candidate.toJSON()),
        }).catch(() => {});
      };

      pc.ontrack = (event) => {
        if (!voiceJoinedRef.current) return;
        const remoteStream = event.streams[0] || new MediaStream([event.track]);
        entry.remoteStream = remoteStream;
        if (!entry.audioEl) {
          const audio = new Audio();
          audio.autoplay = true;
          entry.audioEl = audio;
        }
        entry.audioEl.srcObject = remoteStream;
        applyAudioElementSettings(peerUid, entry.audioEl);
        void entry.audioEl.play().catch(() => {});
        syncConnectedPeersState();
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          syncConnectedPeersState();
        } else if (pc.connectionState === 'connected') {
          syncConnectedPeersState();
        }
      };

      peersRef.current.set(peerUid, entry);
      syncConnectedPeersState();
      return entry;
    },
    [applyAudioElementSettings, syncConnectedPeersState, teardownPeer, uid],
  );

  // Initiate offers deterministically (uid < peer.uid) when voice participants change
  useEffect(() => {
    if (!room || !voiceJoined || !sessionIdRef.current) return;
    if (room.voiceEnabled === false) {
      void leaveVoice();
      return;
    }

    const activeVoicePeers = participants.filter(
      (p) => p.uid !== uid && Boolean(p.voiceJoined) && Boolean(p.voiceSessionId),
    );
    const activePeerIds = new Set(activeVoicePeers.map((p) => p.uid));

    Array.from(peersRef.current.keys()).forEach((peerUid) => {
      if (!activePeerIds.has(peerUid)) {
        teardownPeer(peerUid);
      }
    });

    activeVoicePeers.forEach((peer) => {
      const peerSession = peer.voiceSessionId || '';
      const existing = peersRef.current.get(peer.uid);
      if (existing && existing.remoteSessionId === peerSession) {
        return;
      }
      if (uid < peer.uid) {
        const entry = getOrCreatePeer(peer.uid, peerSession);
        void entry.pc
          .createOffer({ offerToReceiveAudio: true })
          .then(async (offer) => {
            if (!voiceJoinedRef.current) return;
            await entry.pc.setLocalDescription(offer);
            if (!voiceJoinedRef.current || !roomRef.current || !sessionIdRef.current) return;
            await sendRoomVoiceSignal(roomRef.current, {
              fromUid: uid,
              toUid: peer.uid,
              sessionId: sessionIdRef.current,
              kind: 'offer',
              payload: JSON.stringify(offer),
            });
          })
          .catch(() => {});
      }
    });
  }, [room, voiceJoined, participants, uid, getOrCreatePeer, teardownPeer, leaveVoice]);

  // Listen to incoming WebRTC signals when joined to voice
  useEffect(() => {
    if (!room || !voiceJoined) return;
    const roomId = room.id;

    const handleSignal = async (signal: RoomVoiceSignal) => {
      if (!voiceJoinedRef.current || processedSignalsRef.current.has(signal.id)) return;
      processedSignalsRef.current.add(signal.id);

      try {
        if (signal.kind === 'bye') {
          teardownPeer(signal.fromUid);
          return;
        }

        const entry = getOrCreatePeer(signal.fromUid, signal.sessionId);
        const parsed = JSON.parse(signal.payload) as RTCSessionDescriptionInit | RTCIceCandidateInit;

        if (signal.kind === 'offer') {
          const desc = parsed as RTCSessionDescriptionInit;
          if (entry.pc.signalingState !== 'stable') {
            await entry.pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
          }
          if (!voiceJoinedRef.current) {
            teardownPeer(signal.fromUid);
            return;
          }
          await entry.pc.setRemoteDescription(new RTCSessionDescription(desc));
          const answer = await entry.pc.createAnswer();
          await entry.pc.setLocalDescription(answer);
          for (const candidate of entry.pendingIce) {
            await entry.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
          }
          entry.pendingIce = [];
          if (voiceJoinedRef.current && roomRef.current && sessionIdRef.current) {
            await sendRoomVoiceSignal(roomRef.current, {
              fromUid: uid,
              toUid: signal.fromUid,
              sessionId: sessionIdRef.current,
              kind: 'answer',
              payload: JSON.stringify(answer),
            });
          }
        } else if (signal.kind === 'answer') {
          const desc = parsed as RTCSessionDescriptionInit;
          if (entry.pc.signalingState === 'have-local-offer') {
            await entry.pc.setRemoteDescription(new RTCSessionDescription(desc));
            for (const candidate of entry.pendingIce) {
              await entry.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
            }
            entry.pendingIce = [];
          }
        } else if (signal.kind === 'ice') {
          const candidate = parsed as RTCIceCandidateInit;
          if (entry.pc.remoteDescription) {
            await entry.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
          } else {
            entry.pendingIce.push(candidate);
          }
        }
      } catch {
        // ignore malformed or stale signals
      } finally {
        void deleteRoomVoiceSignal(roomId, signal.id);
      }
    };

    const unsub = subscribeRoomVoiceSignals(roomId, uid, (signals) => {
      signals.forEach((sig) => {
        void handleSignal(sig);
      });
    });

    return () => {
      unsub();
    };
  }, [room, voiceJoined, uid, getOrCreatePeer, teardownPeer]);

  // Leave voice cleanly if room closes or changes
  useEffect(() => {
    if (!room) {
      if (voiceJoinedRef.current || peersRef.current.size > 0 || localStreamRef.current) {
        void leaveVoice(true);
      }
      return;
    }
    if (room.voiceEnabled === false && voiceJoinedRef.current) {
      void leaveVoice();
    }
  }, [room?.id, room?.voiceEnabled, leaveVoice]);

  useEffect(() => {
    return () => {
      void leaveVoice(true);
    };
  }, [leaveVoice]);

  const setPeerAudioOverride = useCallback(
    (peerUid: string, update: Partial<PeerAudioOverride>) => {
      setPeerOverrides((prev) => {
        const current = prev[peerUid] || { volume: 1, muted: false };
        return {
          ...prev,
          [peerUid]: {
            volume:
              update.volume !== undefined
                ? Math.max(0, Math.min(1, update.volume))
                : current.volume,
            muted: update.muted !== undefined ? update.muted : current.muted,
          },
        };
      });
    },
    [],
  );

  return {
    settings,
    updateVoiceSettings,
    voiceJoined,
    isMuted,
    setIsMuted,
    effectiveMuted,
    isPttPressed,
    setIsPttPressed,
    isSpeaking,
    micLevel,
    connectingVoice,
    voiceError,
    setVoiceError,
    inputDevices,
    outputDevices,
    refreshDevices,
    peerOverrides,
    setPeerAudioOverride,
    connectedPeerUids,
    joinVoice,
    leaveVoice,
  };
}
