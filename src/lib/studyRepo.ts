import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import { sha256Hex } from './spacedRepetition';
import {
  BLUEPRINT_LIMITS,
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_REVIEW_INTERVALS,
  type AmbientSoundId,
  type BlurtSession,
  type BlurtWeakPoint,
  type Chapter,
  type ChapterPhoto,
  type DailyGoal,
  type DifficultyLevel,
  type FocusContextType,
  type FocusMode,
  type FocusRoom,
  type FocusSession,
  type Flashcard,
  type FriendLink,
  type FriendRequest,
  type NotificationSettings,
  type ParticipantStatus,
  type PastelThemeId,
  type PdfSourceMeta,
  type PriorityLevel,
  type PublicProfile,
  type ReviewIntervalConfig,
  type RoomMessage,
  type RoomParticipant,
  type RoomTimerStatus,
  type RoomVisibility,
  type StudyTask,
  type Subject,
  type TaskPriority,
  type TaskStatus,
  type UserProfile,
  type VideoLecture,
} from '../types/study';

function genId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}_${rand}`;
}

export function normalizeHandle(raw: string, uidFallback: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, BLUEPRINT_LIMITS.HANDLE_MAX);
  if (cleaned.length >= 3) {
    return cleaned;
  }
  const suffix = uidFallback.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) || 'user';
  return `scholar_${suffix}`.slice(0, BLUEPRINT_LIMITS.HANDLE_MAX);
}

function sanitizeIntervals(input?: Partial<ReviewIntervalConfig>): ReviewIntervalConfig {
  return {
    hardDays: Math.max(1, Math.min(365, Math.round(Number(input?.hardDays) || DEFAULT_REVIEW_INTERVALS.hardDays))),
    midDays: Math.max(1, Math.min(365, Math.round(Number(input?.midDays) || DEFAULT_REVIEW_INTERVALS.midDays))),
    easyDays: Math.max(1, Math.min(365, Math.round(Number(input?.easyDays) || DEFAULT_REVIEW_INTERVALS.easyDays))),
  };
}

function sanitizeNotificationSettings(input?: Partial<NotificationSettings>): NotificationSettings {
  return {
    taskReminders: input?.taskReminders ?? DEFAULT_NOTIFICATION_SETTINGS.taskReminders,
    dueFlashcards: input?.dueFlashcards ?? DEFAULT_NOTIFICATION_SETTINGS.dueFlashcards,
    sessionChimes: input?.sessionChimes ?? DEFAULT_NOTIFICATION_SETTINGS.sessionChimes,
  };
}

export async function ensureUserProfile(
  uid: string,
  defaults: { displayName: string; email?: string | null; avatarUrl?: string | null },
): Promise<UserProfile> {
  const path = `users/${uid}`;
  const ref = doc(db, 'users', uid);
  const pubRef = doc(db, 'publicProfiles', uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const existing = snap.data() as UserProfile;
      const resolvedHandle =
        existing.handle && existing.handle.trim().length >= 3
          ? normalizeHandle(existing.handle, uid)
          : normalizeHandle(`${existing.displayName || defaults.displayName}_${uid.slice(0, 4)}`, uid);

      if (!existing.handle) {
        await updateDoc(ref, {
          handle: resolvedHandle,
          updatedAt: serverTimestamp(),
        });
      }

      const pubSnap = await getDoc(pubRef);
      if (!pubSnap.exists()) {
        await setDoc(pubRef, {
          uid,
          handle: resolvedHandle,
          displayName: (existing.displayName || 'Scholar').slice(0, BLUEPRINT_LIMITS.DISPLAY_NAME_MAX),
          avatarUrl: (existing.avatarUrl || '').slice(0, BLUEPRINT_LIMITS.AVATAR_URL_MAX),
          bio: (existing.bio || '').slice(0, BLUEPRINT_LIMITS.BIO_MAX),
          pastelTheme: existing.pastelTheme || 'stone',
          isPublic: Boolean(existing.isPublic),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      return existing.handle ? existing : { ...existing, handle: resolvedHandle };
    }
    const cleanName = (defaults.displayName || 'Scholar').trim().slice(0, BLUEPRINT_LIMITS.DISPLAY_NAME_MAX) || 'Scholar';
    const handle = normalizeHandle(`${cleanName}_${uid.slice(0, 4)}`, uid);
    const profile: UserProfile = {
      uid,
      displayName: cleanName,
      email: (defaults.email || '').slice(0, 160),
      avatarUrl: (defaults.avatarUrl || '').slice(0, BLUEPRINT_LIMITS.AVATAR_URL_MAX),
      bio: '',
      pastelTheme: 'stone',
      dailyGoalMinutes: 120,
      reviewIntervals: { ...DEFAULT_REVIEW_INTERVALS },
      notificationSettings: { ...DEFAULT_NOTIFICATION_SETTINGS },
      isPublic: false,
      handle,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, profile);
    await setDoc(pubRef, {
      uid,
      handle,
      displayName: cleanName,
      avatarUrl: profile.avatarUrl || '',
      bio: '',
      pastelTheme: 'stone',
      isPublic: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return profile;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeUserProfile(uid: string, onData: (profile: UserProfile | null) => void): Unsubscribe {
  const path = `users/${uid}`;
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      onData(snap.exists() ? (snap.data() as UserProfile) : null);
    },
    (error) => handleFirestoreError(error, OperationType.GET, path),
  );
}

export async function updateUserProfile(
  uid: string,
  updates: Partial<
    Pick<
      UserProfile,
      | 'displayName'
      | 'email'
      | 'avatarUrl'
      | 'bio'
      | 'pastelTheme'
      | 'dailyGoalMinutes'
      | 'reviewIntervals'
      | 'notificationSettings'
      | 'isPublic'
      | 'handle'
    >
  >,
): Promise<void> {
  const userPath = `users/${uid}`;
  const userRef = doc(db, 'users', uid);

  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (updates.displayName !== undefined) {
    payload.displayName = updates.displayName.trim().slice(0, BLUEPRINT_LIMITS.DISPLAY_NAME_MAX) || 'Scholar';
  }
  if (updates.email !== undefined) {
    payload.email = updates.email.trim().slice(0, 160);
  }
  if (updates.avatarUrl !== undefined) {
    payload.avatarUrl = updates.avatarUrl.slice(0, BLUEPRINT_LIMITS.AVATAR_URL_MAX);
  }
  if (updates.bio !== undefined) {
    payload.bio = updates.bio.trim().slice(0, BLUEPRINT_LIMITS.BIO_MAX);
  }
  if (updates.pastelTheme !== undefined) {
    payload.pastelTheme = updates.pastelTheme as PastelThemeId;
  }
  if (updates.dailyGoalMinutes !== undefined) {
    payload.dailyGoalMinutes = Math.max(15, Math.min(720, Math.round(updates.dailyGoalMinutes)));
  }
  if (updates.reviewIntervals !== undefined) {
    payload.reviewIntervals = sanitizeIntervals(updates.reviewIntervals);
  }
  if (updates.notificationSettings !== undefined) {
    payload.notificationSettings = sanitizeNotificationSettings(updates.notificationSettings);
  }
  if (updates.isPublic !== undefined) {
    payload.isPublic = Boolean(updates.isPublic);
  }
  if (updates.handle !== undefined) {
    payload.handle = normalizeHandle(updates.handle, uid);
  }

  let latest: UserProfile;
  try {
    const existingSnap = await getDoc(userRef);
    if (existingSnap.exists()) {
      await updateDoc(userRef, payload);
      const updatedSnap = await getDoc(userRef);
      latest = (updatedSnap.exists() ? updatedSnap.data() : existingSnap.data()) as UserProfile;
    } else {
      const cleanName = (typeof payload.displayName === 'string' && payload.displayName) || 'Scholar';
      const fallbackProfile: UserProfile = {
        uid,
        displayName: cleanName,
        email: typeof payload.email === 'string' ? payload.email : '',
        avatarUrl: typeof payload.avatarUrl === 'string' ? payload.avatarUrl : '',
        bio: typeof payload.bio === 'string' ? payload.bio : '',
        pastelTheme: (payload.pastelTheme as PastelThemeId) || 'stone',
        dailyGoalMinutes: typeof payload.dailyGoalMinutes === 'number' ? payload.dailyGoalMinutes : 120,
        reviewIntervals: (payload.reviewIntervals as ReviewIntervalConfig) || { ...DEFAULT_REVIEW_INTERVALS },
        notificationSettings:
          (payload.notificationSettings as NotificationSettings) || { ...DEFAULT_NOTIFICATION_SETTINGS },
        isPublic: typeof payload.isPublic === 'boolean' ? payload.isPublic : false,
        handle:
          typeof payload.handle === 'string'
            ? payload.handle
            : normalizeHandle(`${cleanName}_${uid.slice(0, 4)}`, uid),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(userRef, fallbackProfile);
      latest = fallbackProfile;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, userPath);
  }

  const touchesPublic =
    updates.isPublic !== undefined ||
    updates.handle !== undefined ||
    updates.displayName !== undefined ||
    updates.avatarUrl !== undefined ||
    updates.bio !== undefined ||
    updates.pastelTheme !== undefined;

  if (!touchesPublic) return;

  const publicPath = `publicProfiles/${uid}`;
  const pubRef = doc(db, 'publicProfiles', uid);
  let pubExists = false;
  try {
    const pubSnap = await getDoc(pubRef);
    pubExists = pubSnap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, publicPath);
  }

  const handleVal = normalizeHandle(latest.handle || latest.displayName, uid);
  if (pubExists) {
    try {
      await updateDoc(pubRef, {
        displayName: (latest.displayName || 'Scholar').slice(0, BLUEPRINT_LIMITS.DISPLAY_NAME_MAX),
        handle: handleVal,
        avatarUrl: (latest.avatarUrl || '').slice(0, BLUEPRINT_LIMITS.AVATAR_URL_MAX),
        bio: (latest.bio || '').slice(0, BLUEPRINT_LIMITS.BIO_MAX),
        pastelTheme: latest.pastelTheme || 'stone',
        isPublic: Boolean(latest.isPublic),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, publicPath);
    }
  } else {
    try {
      await setDoc(pubRef, {
        uid,
        handle: handleVal,
        displayName: (latest.displayName || 'Scholar').slice(0, BLUEPRINT_LIMITS.DISPLAY_NAME_MAX),
        avatarUrl: (latest.avatarUrl || '').slice(0, BLUEPRINT_LIMITS.AVATAR_URL_MAX),
        bio: (latest.bio || '').slice(0, BLUEPRINT_LIMITS.BIO_MAX),
        pastelTheme: latest.pastelTheme || 'stone',
        isPublic: Boolean(latest.isPublic),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, publicPath);
    }
  }
}

// --- Discoverable Study Profiles, Friends & Friend Requests ---
export function subscribePublicProfiles(onData: (profiles: PublicProfile[]) => void): Unsubscribe {
  const path = 'publicProfiles';
  return onSnapshot(
    collection(db, 'publicProfiles'),
    (snap) => {
      onData(snap.docs.map((d) => ({ ...(d.data() as PublicProfile), uid: d.id })));
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path),
  );
}

export function subscribeFriends(uid: string, onData: (friends: FriendLink[]) => void): Unsubscribe {
  const path = `users/${uid}/friends`;
  const q = query(collection(db, 'users', uid, 'friends'), where('ownerId', '==', uid), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FriendLink, 'id'>) })));
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path),
  );
}

export async function hasApprovedFriendRequest(uid: string, targetUid: string): Promise<boolean> {
  const [outgoingSnap, incomingSnap] = await Promise.all([
    getDoc(doc(db, 'friendRequests', `${uid}__${targetUid}`)),
    getDoc(doc(db, 'friendRequests', `${targetUid}__${uid}`)),
  ]);
  const outgoingApproved =
    outgoingSnap.exists() && (outgoingSnap.data() as Omit<FriendRequest, 'id'>).status === 'accepted';
  const incomingApproved =
    incomingSnap.exists() && (incomingSnap.data() as Omit<FriendRequest, 'id'>).status === 'accepted';
  return outgoingApproved || incomingApproved;
}

export async function addFriend(uid: string, target: PublicProfile): Promise<void> {
  if (target.uid === uid) return;
  const path = `users/${uid}/friends/${target.uid}`;
  const friendRef = doc(db, 'users', uid, 'friends', target.uid);

  let resolvedTarget = target;
  try {
    const pubSnap = await getDoc(doc(db, 'publicProfiles', target.uid));
    if (!pubSnap.exists()) {
      throw new Error('Study profile not found.');
    }
    resolvedTarget = { ...(pubSnap.data() as PublicProfile), uid: pubSnap.id };
    if (!resolvedTarget.isPublic) {
      const approved = await hasApprovedFriendRequest(uid, target.uid);
      if (!approved) {
        throw new Error('Friend request must be approved before adding this learner to your friends list.');
      }
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('Friend request must be approved') || error.message === 'Study profile not found.')
    ) {
      throw error;
    }
    handleFirestoreError(error, OperationType.GET, `publicProfiles/${target.uid}`);
  }

  const payload = {
    handle: normalizeHandle(resolvedTarget.handle || target.handle, target.uid),
    displayName: (resolvedTarget.displayName || target.displayName).slice(0, BLUEPRINT_LIMITS.DISPLAY_NAME_MAX),
    avatarUrl: (resolvedTarget.avatarUrl || '').slice(0, BLUEPRINT_LIMITS.AVATAR_URL_MAX),
    bio: (resolvedTarget.bio || '').slice(0, BLUEPRINT_LIMITS.BIO_MAX),
  };

  try {
    const existingSnap = await getDoc(friendRef);
    if (existingSnap.exists()) {
      await updateDoc(friendRef, payload);
    } else {
      await setDoc(friendRef, {
        ownerId: uid,
        friendUid: target.uid,
        ...payload,
        createdAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function removeFriend(uid: string, friendUid: string): Promise<void> {
  const path = `users/${uid}/friends/${friendUid}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'friends', friendUid));
    try {
      const reqRef = doc(db, 'friendRequests', `${uid}__${friendUid}`);
      const reqSnap = await getDoc(reqRef);
      if (reqSnap.exists()) {
        await deleteDoc(reqRef);
      }
    } catch {
      // Ignore optional cleanup if no request record exists
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

function toTimestampMs(val: unknown): number {
  if (!val) return 0;
  if (typeof val === 'object' && val !== null && 'toMillis' in val && typeof (val as { toMillis: () => number }).toMillis === 'function') {
    return (val as { toMillis: () => number }).toMillis();
  }
  if (typeof val === 'string') {
    const parsed = Date.parse(val);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

export function subscribeIncomingFriendRequests(
  uid: string,
  onData: (requests: FriendRequest[]) => void,
): Unsubscribe {
  const path = 'friendRequests';
  const q = query(collection(db, 'friendRequests'), where('toUid', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<FriendRequest, 'id'>) }))
        .sort((a, b) => toTimestampMs(b.updatedAt || b.createdAt) - toTimestampMs(a.updatedAt || a.createdAt));
      onData(items);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path),
  );
}

export function subscribeOutgoingFriendRequests(
  uid: string,
  onData: (requests: FriendRequest[]) => void,
): Unsubscribe {
  const path = 'friendRequests';
  const q = query(collection(db, 'friendRequests'), where('fromUid', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<FriendRequest, 'id'>) }))
        .sort((a, b) => toTimestampMs(b.updatedAt || b.createdAt) - toTimestampMs(a.updatedAt || a.createdAt));
      onData(items);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path),
  );
}

export async function sendFriendRequest(fromProfile: UserProfile, target: PublicProfile): Promise<void> {
  if (fromProfile.uid === target.uid) return;
  const requestId = `${fromProfile.uid}__${target.uid}`;
  const path = `friendRequests/${requestId}`;
  const reqRef = doc(db, 'friendRequests', requestId);
  try {
    const alreadyApproved = await hasApprovedFriendRequest(fromProfile.uid, target.uid);
    if (alreadyApproved) {
      await addFriend(fromProfile.uid, target);
      return;
    }

    const existingSnap = await getDoc(reqRef);
    if (existingSnap.exists()) {
      const existingData = existingSnap.data() as Omit<FriendRequest, 'id'>;
      if (existingData.status === 'pending') {
        return;
      }
      if (existingData.status === 'declined') {
        await deleteDoc(reqRef);
      }
    }

    const fromHandle = normalizeHandle(
      fromProfile.handle || `${fromProfile.displayName}_${fromProfile.uid.slice(0, 4)}`,
      fromProfile.uid,
    );
    const toHandle = normalizeHandle(target.handle || target.displayName, target.uid);

    await setDoc(reqRef, {
      fromUid: fromProfile.uid,
      toUid: target.uid,
      fromHandle,
      fromDisplayName: (fromProfile.displayName || 'Scholar').trim().slice(0, BLUEPRINT_LIMITS.DISPLAY_NAME_MAX) || 'Scholar',
      fromAvatarUrl: (fromProfile.avatarUrl || '').slice(0, BLUEPRINT_LIMITS.AVATAR_URL_MAX),
      fromBio: (fromProfile.bio || '').trim().slice(0, BLUEPRINT_LIMITS.BIO_MAX),
      toHandle,
      toDisplayName: (target.displayName || 'Scholar').trim().slice(0, BLUEPRINT_LIMITS.DISPLAY_NAME_MAX) || 'Scholar',
      toAvatarUrl: (target.avatarUrl || '').slice(0, BLUEPRINT_LIMITS.AVATAR_URL_MAX),
      toBio: (target.bio || '').trim().slice(0, BLUEPRINT_LIMITS.BIO_MAX),
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function respondToFriendRequest(
  requestId: string,
  decision: 'accepted' | 'declined',
): Promise<void> {
  const path = `friendRequests/${requestId}`;
  try {
    await updateDoc(doc(db, 'friendRequests', requestId), {
      status: decision,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function cancelFriendRequest(requestId: string): Promise<void> {
  const path = `friendRequests/${requestId}`;
  try {
    await deleteDoc(doc(db, 'friendRequests', requestId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Tasks ---
export function subscribeTasks(uid: string, onData: (items: StudyTask[]) => void): Unsubscribe {
  const path = `users/${uid}/tasks`;
  const q = query(collection(db, 'users', uid, 'tasks'), where('ownerId', '==', uid), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StudyTask, 'id'>) })));
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path),
  );
}

export async function createTask(
  uid: string,
  input: {
    title: string;
    notes?: string;
    priority: TaskPriority;
    hardness?: DifficultyLevel;
    subjectId?: string;
    dueAt?: string;
    reminderAt?: string;
  },
): Promise<void> {
  const id = genId('task');
  const path = `users/${uid}/tasks/${id}`;
  try {
    await setDoc(doc(db, 'users', uid, 'tasks', id), {
      ownerId: uid,
      title: input.title.trim().slice(0, BLUEPRINT_LIMITS.TASK_TITLE_MAX),
      notes: (input.notes || '').trim().slice(0, BLUEPRINT_LIMITS.TASK_NOTES_MAX),
      priority: input.priority,
      hardness: input.hardness || 'medium',
      status: 'not_started' as TaskStatus,
      subjectId: (input.subjectId || '').slice(0, 128),
      dueAt: (input.dueAt || '').slice(0, 64),
      reminderAt: (input.reminderAt || '').slice(0, 64),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateTaskStatus(uid: string, taskId: string, status: TaskStatus): Promise<void> {
  const path = `users/${uid}/tasks/${taskId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'tasks', taskId), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateTaskRating(
  uid: string,
  taskId: string,
  priority: TaskPriority,
  hardness: DifficultyLevel,
): Promise<void> {
  const path = `users/${uid}/tasks/${taskId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'tasks', taskId), {
      priority,
      hardness,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteTask(uid: string, taskId: string): Promise<void> {
  const path = `users/${uid}/tasks/${taskId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'tasks', taskId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Daily Goals ---
export function subscribeDailyGoals(uid: string, onData: (items: DailyGoal[]) => void): Unsubscribe {
  const path = `users/${uid}/dailyGoals`;
  const q = query(collection(db, 'users', uid, 'dailyGoals'), where('ownerId', '==', uid), orderBy('createdAt', 'asc'));
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DailyGoal, 'id'>) })));
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path),
  );
}

export async function createDailyGoal(uid: string, title: string, targetDate: string): Promise<void> {
  const id = genId('goal');
  const path = `users/${uid}/dailyGoals/${id}`;
  try {
    await setDoc(doc(db, 'users', uid, 'dailyGoals', id), {
      ownerId: uid,
      title: title.trim().slice(0, BLUEPRINT_LIMITS.GOAL_TITLE_MAX),
      targetDate,
      completed: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function toggleDailyGoal(uid: string, goalId: string, completed: boolean): Promise<void> {
  const path = `users/${uid}/dailyGoals/${goalId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'dailyGoals', goalId), {
      completed,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteDailyGoal(uid: string, goalId: string): Promise<void> {
  const path = `users/${uid}/dailyGoals/${goalId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'dailyGoals', goalId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Subjects ---
export function subscribeSubjects(uid: string, onData: (items: Subject[]) => void): Unsubscribe {
  const path = `users/${uid}/subjects`;
  const q = query(collection(db, 'users', uid, 'subjects'), where('ownerId', '==', uid), orderBy('createdAt', 'asc'));
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Subject, 'id'>) })));
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path),
  );
}

export async function createSubject(
  uid: string,
  input: {
    name: string;
    color: string;
    description?: string;
    priority?: PriorityLevel;
    hardness?: DifficultyLevel;
  },
): Promise<string> {
  const id = genId('subj');
  const path = `users/${uid}/subjects/${id}`;
  try {
    await setDoc(doc(db, 'users', uid, 'subjects', id), {
      ownerId: uid,
      name: input.name.trim().slice(0, BLUEPRINT_LIMITS.SUBJECT_NAME_MAX),
      color: input.color.slice(0, 24),
      description: (input.description || '').trim().slice(0, BLUEPRINT_LIMITS.SUBJECT_DESC_MAX),
      priority: input.priority || 'medium',
      hardness: input.hardness || 'medium',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateSubjectRating(
  uid: string,
  subjectId: string,
  priority: PriorityLevel,
  hardness: DifficultyLevel,
): Promise<void> {
  const path = `users/${uid}/subjects/${subjectId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'subjects', subjectId), {
      priority,
      hardness,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteSubject(uid: string, subjectId: string): Promise<void> {
  const path = `users/${uid}/subjects/${subjectId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'subjects', subjectId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Chapters ---
export function subscribeChapters(uid: string, onData: (items: Chapter[]) => void): Unsubscribe {
  const path = `users/${uid}/chapters`;
  const q = query(collection(db, 'users', uid, 'chapters'), where('ownerId', '==', uid), orderBy('order', 'asc'));
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Chapter, 'id'>) })));
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path),
  );
}

export async function createChapter(
  uid: string,
  input: {
    subjectId: string;
    title: string;
    order: number;
    priority?: PriorityLevel;
    hardness?: DifficultyLevel;
  },
): Promise<string> {
  const id = genId('chap');
  const path = `users/${uid}/chapters/${id}`;
  try {
    await setDoc(doc(db, 'users', uid, 'chapters', id), {
      ownerId: uid,
      subjectId: input.subjectId,
      title: input.title.trim().slice(0, BLUEPRINT_LIMITS.CHAPTER_TITLE_MAX),
      order: Math.max(0, Math.min(10000, input.order)),
      priority: input.priority || 'medium',
      hardness: input.hardness || 'medium',
      notes: '',
      videoLectures: [],
      pdfSources: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateChapterRating(
  uid: string,
  chapterId: string,
  priority: PriorityLevel,
  hardness: DifficultyLevel,
): Promise<void> {
  const path = `users/${uid}/chapters/${chapterId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'chapters', chapterId), {
      priority,
      hardness,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateChapterNotesAndPdfs(
  uid: string,
  chapterId: string,
  notes: string,
  pdfSources: PdfSourceMeta[],
): Promise<void> {
  const path = `users/${uid}/chapters/${chapterId}`;
  try {
    const cleanPdfs = pdfSources.slice(0, 15).map((p) => ({
      fileName: p.fileName.slice(0, 200),
      pageCount: Number(p.pageCount) || 1,
      extractedAt: p.extractedAt.slice(0, 64),
    }));
    await updateDoc(doc(db, 'users', uid, 'chapters', chapterId), {
      notes: notes.slice(0, BLUEPRINT_LIMITS.CHAPTER_NOTES_MAX),
      pdfSources: cleanPdfs,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateChapterVideos(
  uid: string,
  chapterId: string,
  videoLectures: VideoLecture[],
): Promise<void> {
  const path = `users/${uid}/chapters/${chapterId}`;
  try {
    const cleanVideos = videoLectures.slice(0, 30).map((v, idx) => {
      const total = Math.max(0, Math.min(864000, Math.round(Number(v.totalSeconds) || 0)));
      const rawWatched = Math.max(0, Math.min(864000, Math.round(Number(v.watchedSeconds) || 0)));
      const watched = total > 0 ? Math.min(total, rawWatched) : rawWatched;
      return {
        id: (v.id || `vid_${idx}_${Date.now().toString(36)}`).slice(0, 64),
        title: v.title.trim().slice(0, BLUEPRINT_LIMITS.VIDEO_TITLE_MAX),
        url: v.url.trim().slice(0, BLUEPRINT_LIMITS.VIDEO_URL_MAX),
        totalSeconds: total,
        watchedSeconds: watched,
        lastWatchedAt: (v.lastWatchedAt || '').slice(0, 64),
      };
    });
    await updateDoc(doc(db, 'users', uid, 'chapters', chapterId), {
      videoLectures: cleanVideos,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteChapter(uid: string, chapterId: string): Promise<void> {
  const path = `users/${uid}/chapters/${chapterId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'chapters', chapterId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Chapter Photos ---
export function subscribeChapterPhotos(uid: string, onData: (items: ChapterPhoto[]) => void): Unsubscribe {
  const path = `users/${uid}/chapterPhotos`;
  const q = query(
    collection(db, 'users', uid, 'chapterPhotos'),
    where('ownerId', '==', uid),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ChapterPhoto, 'id'>) })));
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path),
  );
}

export async function addChapterPhoto(
  uid: string,
  input: {
    subjectId: string;
    chapterId: string;
    title: string;
    dataUrl: string;
  },
): Promise<void> {
  const id = genId('photo');
  const path = `users/${uid}/chapterPhotos/${id}`;
  try {
    await setDoc(doc(db, 'users', uid, 'chapterPhotos', id), {
      ownerId: uid,
      subjectId: input.subjectId,
      chapterId: input.chapterId,
      title: (input.title.trim() || 'Study Note Photo').slice(0, 160),
      dataUrl: input.dataUrl.slice(0, BLUEPRINT_LIMITS.PHOTO_DATA_URL_MAX),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteChapterPhoto(uid: string, photoId: string): Promise<void> {
  const path = `users/${uid}/chapterPhotos/${photoId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'chapterPhotos', photoId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Flashcards (Spaced Repetition) ---
export function subscribeFlashcards(uid: string, onData: (items: Flashcard[]) => void): Unsubscribe {
  const path = `users/${uid}/flashcards`;
  const q = query(collection(db, 'users', uid, 'flashcards'), where('ownerId', '==', uid), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Flashcard, 'id'>) })));
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path),
  );
}

export async function createFlashcardsBatch(
  uid: string,
  subjectId: string,
  chapterId: string,
  cards: Array<{
    front: string;
    back: string;
    priority?: PriorityLevel;
    hardness?: DifficultyLevel;
  }>,
): Promise<void> {
  const path = `users/${uid}/flashcards`;
  try {
    const batch = writeBatch(db);
    const nowIso = new Date().toISOString();
    for (const card of cards.slice(0, 30)) {
      const id = genId('card');
      batch.set(doc(db, 'users', uid, 'flashcards', id), {
        ownerId: uid,
        subjectId,
        chapterId: chapterId.slice(0, 128),
        front: card.front.trim().slice(0, BLUEPRINT_LIMITS.FLASHCARD_FRONT_MAX),
        back: card.back.trim().slice(0, BLUEPRINT_LIMITS.FLASHCARD_BACK_MAX),
        priority: card.priority || 'medium',
        hardness: card.hardness || 'medium',
        repetitions: 0,
        intervalDays: 0,
        easeFactor: 2.5,
        nextReviewAt: nowIso,
        lastReviewedAt: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateFlashcardSchedule(
  uid: string,
  cardId: string,
  schedule: {
    repetitions: number;
    intervalDays: number;
    easeFactor: number;
    hardness: DifficultyLevel;
    nextReviewAt: string;
    lastReviewedAt: string;
  },
): Promise<void> {
  const path = `users/${uid}/flashcards/${cardId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'flashcards', cardId), {
      ...schedule,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateFlashcardDetails(
  uid: string,
  cardId: string,
  updates: {
    front?: string;
    back?: string;
    priority?: PriorityLevel;
    hardness?: DifficultyLevel;
    intervalDays?: number;
    nextReviewAt?: string;
  },
): Promise<void> {
  const path = `users/${uid}/flashcards/${cardId}`;
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (updates.front !== undefined) {
    payload.front = updates.front.trim().slice(0, BLUEPRINT_LIMITS.FLASHCARD_FRONT_MAX);
  }
  if (updates.back !== undefined) {
    payload.back = updates.back.trim().slice(0, BLUEPRINT_LIMITS.FLASHCARD_BACK_MAX);
  }
  if (updates.priority !== undefined) {
    payload.priority = updates.priority;
  }
  if (updates.hardness !== undefined) {
    payload.hardness = updates.hardness;
  }
  if (updates.intervalDays !== undefined) {
    const safeDays = Math.max(0, Math.min(36500, Math.round(updates.intervalDays)));
    payload.intervalDays = safeDays;
    payload.nextReviewAt =
      updates.nextReviewAt || new Date(Date.now() + safeDays * 24 * 60 * 60 * 1000).toISOString();
  } else if (updates.nextReviewAt !== undefined) {
    payload.nextReviewAt = updates.nextReviewAt.slice(0, 64);
  }

  try {
    await updateDoc(doc(db, 'users', uid, 'flashcards', cardId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteFlashcard(uid: string, cardId: string): Promise<void> {
  const path = `users/${uid}/flashcards/${cardId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'flashcards', cardId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Blurting Sessions ---
export function subscribeBlurtSessions(uid: string, onData: (items: BlurtSession[]) => void): Unsubscribe {
  const path = `users/${uid}/blurtSessions`;
  const q = query(
    collection(db, 'users', uid, 'blurtSessions'),
    where('ownerId', '==', uid),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BlurtSession, 'id'>) })));
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path),
  );
}

export async function createBlurtSession(
  uid: string,
  input: {
    subjectId?: string;
    subjectName?: string;
    chapterId?: string;
    chapterTitle?: string;
    sourceLabel: string;
    blurtText: string;
    durationSeconds: number;
    summary: string;
    strongPoints: string[];
    weakPoints: BlurtWeakPoint[];
    missedKeyFacts: string[];
    dateKey: string;
  },
): Promise<string> {
  const id = genId('blurt');
  const path = `users/${uid}/blurtSessions/${id}`;
  try {
    await setDoc(doc(db, 'users', uid, 'blurtSessions', id), {
      ownerId: uid,
      subjectId: (input.subjectId || '').slice(0, 128),
      subjectName: (input.subjectName || 'General Study').slice(0, 100),
      chapterId: (input.chapterId || '').slice(0, 128),
      chapterTitle: (input.chapterTitle || '').slice(0, 160),
      sourceLabel: (input.sourceLabel.trim() || 'Study Material').slice(0, 200),
      blurtText: input.blurtText.trim().slice(0, BLUEPRINT_LIMITS.BLURT_TEXT_MAX),
      durationSeconds: Math.max(1, Math.min(86400, Math.round(input.durationSeconds))),
      summary: input.summary.trim().slice(0, 2000),
      strongPoints: input.strongPoints.slice(0, 20).map((s) => s.trim().slice(0, 600)),
      weakPoints: input.weakPoints.slice(0, 20).map((w) => ({
        topic: w.topic.trim().slice(0, 200),
        gap: w.gap.trim().slice(0, 1000),
        suggestedReview: w.suggestedReview.trim().slice(0, 1000),
      })),
      missedKeyFacts: input.missedKeyFacts.slice(0, 20).map((s) => s.trim().slice(0, 600)),
      cardsGeneratedCount: 0,
      dateKey: input.dateKey,
      createdAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateBlurtSessionCardsCount(
  uid: string,
  blurtId: string,
  cardsGeneratedCount: number,
): Promise<void> {
  const path = `users/${uid}/blurtSessions/${blurtId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'blurtSessions', blurtId), {
      cardsGeneratedCount: Math.max(0, Math.min(100, Math.round(cardsGeneratedCount))),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteBlurtSession(uid: string, blurtId: string): Promise<void> {
  const path = `users/${uid}/blurtSessions/${blurtId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'blurtSessions', blurtId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Focus & Active Recall Sessions ---
export function subscribeFocusSessions(uid: string, onData: (items: FocusSession[]) => void): Unsubscribe {
  const path = `users/${uid}/focusSessions`;
  const q = query(
    collection(db, 'users', uid, 'focusSessions'),
    where('ownerId', '==', uid),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FocusSession, 'id'>) })));
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path),
  );
}

export async function logFocusSession(
  uid: string,
  input: {
    mode: FocusMode;
    contextType: FocusContextType;
    roomId?: string;
    roomName?: string;
    subjectId?: string;
    subjectName?: string;
    subjectColor?: string;
    chapterId?: string;
    chapterTitle?: string;
    durationSeconds: number;
    ambientSound: AmbientSoundId;
    completedAt: string;
    dateKey: string;
  },
): Promise<void> {
  const id = genId('sess');
  const path = `users/${uid}/focusSessions/${id}`;
  try {
    await setDoc(doc(db, 'users', uid, 'focusSessions', id), {
      ownerId: uid,
      mode: input.mode,
      contextType: input.contextType,
      roomId: (input.roomId || '').slice(0, 128),
      roomName: (input.roomName || '').slice(0, 120),
      subjectId: (input.subjectId || '').slice(0, 128),
      subjectName: (input.subjectName || 'General Study').slice(0, 100),
      subjectColor: (input.subjectColor || '#4B5563').slice(0, 24),
      chapterId: (input.chapterId || '').slice(0, 128),
      chapterTitle: (input.chapterTitle || '').slice(0, 160),
      durationSeconds: Math.max(1, Math.min(86400, Math.round(input.durationSeconds))),
      ambientSound: input.ambientSound,
      completedAt: input.completedAt.slice(0, 64),
      dateKey: input.dateKey,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

// --- Collaborative Focus Rooms ---
export function subscribePublicFocusRooms(onData: (rooms: FocusRoom[]) => void): Unsubscribe {
  const path = 'focusRooms';
  const q = query(collection(db, 'focusRooms'), where('visibility', '==', 'public'), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FocusRoom, 'id'>) })).filter((r) => r.isActive));
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path),
  );
}

export function subscribeHostedFocusRooms(uid: string, onData: (rooms: FocusRoom[]) => void): Unsubscribe {
  const path = 'focusRooms';
  const q = query(collection(db, 'focusRooms'), where('hostId', '==', uid), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FocusRoom, 'id'>) })).filter((r) => r.isActive));
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path),
  );
}

export async function createFocusRoom(
  uid: string,
  profile: UserProfile,
  input: {
    name: string;
    topic?: string;
    visibility: RoomVisibility;
    password?: string;
    timerMode: 'timer' | 'stopwatch';
    timerDurationSeconds: number;
    ambientSound: AmbientSoundId;
  },
): Promise<string> {
  const shortCode = Math.random().toString(36).slice(2, 8);
  const roomId = `room-${shortCode}`;
  const path = `focusRooms/${roomId}`;
  const safeName =
    (profile.displayName || 'Scholar').trim().slice(0, BLUEPRINT_LIMITS.DISPLAY_NAME_MAX) || 'Scholar';

  try {
    const batch = writeBatch(db);
    const roomRef = doc(db, 'focusRooms', roomId);
    batch.set(roomRef, {
      hostId: uid,
      hostName: safeName,
      name: input.name.trim().slice(0, BLUEPRINT_LIMITS.ROOM_NAME_MAX),
      topic: (input.topic || '').trim().slice(0, BLUEPRINT_LIMITS.ROOM_TOPIC_MAX),
      visibility: input.visibility,
      timerMode: input.timerMode,
      timerDurationSeconds: Math.max(60, Math.min(14400, Math.round(input.timerDurationSeconds))),
      timerStatus: 'idle' as RoomTimerStatus,
      timerStartedAtMs: 0,
      timerAccumulatedSeconds: 0,
      ambientSound: input.ambientSound,
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (input.visibility === 'private') {
      const passHash = await sha256Hex(`${roomId}:${input.password || ''}`);
      batch.set(doc(db, 'focusRooms', roomId, 'secrets', 'lock'), {
        roomId,
        hostId: uid,
        passwordHash: passHash,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    batch.set(doc(db, 'focusRooms', roomId, 'participants', uid), {
      uid,
      roomId,
      roomVisibility: input.visibility,
      roomHostId: uid,
      displayName: safeName,
      avatarUrl: (profile.avatarUrl || '').slice(0, BLUEPRINT_LIMITS.AVATAR_URL_MAX),
      subjectName: 'General Study',
      status: 'focusing' as ParticipantStatus,
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
    return roomId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function joinFocusRoom(
  uid: string,
  profile: UserProfile,
  roomIdInput: string,
  password?: string,
  subjectName?: string,
): Promise<FocusRoom> {
  const roomId = roomIdInput.trim();
  const roomPath = `focusRooms/${roomId}`;
  const roomSnap = await getDoc(doc(db, 'focusRooms', roomId));
  if (!roomSnap.exists()) {
    throw new Error('Study room not found. Check the room code and try again.');
  }
  const roomData = { id: roomSnap.id, ...(roomSnap.data() as Omit<FocusRoom, 'id'>) };
  if (!roomData.isActive) {
    throw new Error('This study room has ended.');
  }

  const safeName =
    (profile.displayName || 'Scholar').trim().slice(0, BLUEPRINT_LIMITS.DISPLAY_NAME_MAX) || 'Scholar';

  try {
    const participantRef = doc(db, 'focusRooms', roomId, 'participants', uid);
    const existingParticipantSnap = await getDoc(participantRef);

    const batch = writeBatch(db);
    if (roomData.visibility === 'private' && roomData.hostId !== uid) {
      if (!password || !password.trim()) {
        throw new Error('This is a private room. Please enter the room password.');
      }
      const passRef = doc(db, 'focusRooms', roomId, 'passes', uid);
      const existingPass = await getDoc(passRef);
      if (existingPass.exists()) {
        await deleteDoc(passRef);
      }
      const passHash = await sha256Hex(`${roomId}:${password}`);
      batch.set(passRef, {
        uid,
        roomId,
        passHash,
        createdAt: serverTimestamp(),
      });
    }

    if (existingParticipantSnap.exists()) {
      batch.update(participantRef, {
        displayName: safeName,
        avatarUrl: (profile.avatarUrl || '').slice(0, BLUEPRINT_LIMITS.AVATAR_URL_MAX),
        subjectName: (subjectName || 'General Study').slice(0, 100),
        status: 'focusing' as ParticipantStatus,
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(participantRef, {
        uid,
        roomId,
        roomVisibility: roomData.visibility,
        roomHostId: roomData.hostId,
        displayName: safeName,
        avatarUrl: (profile.avatarUrl || '').slice(0, BLUEPRINT_LIMITS.AVATAR_URL_MAX),
        subjectName: (subjectName || 'General Study').slice(0, 100),
        status: 'focusing' as ParticipantStatus,
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
    return roomData;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('insufficient')) {
      throw new Error('Incorrect room password. Please check with the room host.');
    }
    if (msg.includes('private room') || msg.includes('not found') || msg.includes('ended')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, roomPath);
  }
}

export function subscribeFocusRoom(roomId: string, onData: (room: FocusRoom | null) => void): Unsubscribe {
  const path = `focusRooms/${roomId}`;
  return onSnapshot(
    doc(db, 'focusRooms', roomId),
    (snap) => {
      onData(snap.exists() ? { id: snap.id, ...(snap.data() as Omit<FocusRoom, 'id'>) } : null);
    },
    (error) => handleFirestoreError(error, OperationType.GET, path),
  );
}

export function subscribeRoomParticipants(roomId: string, onData: (list: RoomParticipant[]) => void): Unsubscribe {
  const path = `focusRooms/${roomId}/participants`;
  return onSnapshot(
    collection(db, 'focusRooms', roomId, 'participants'),
    (snap) => {
      onData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RoomParticipant, 'id'>) })));
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path),
  );
}

export function subscribeRoomMessages(roomId: string, onData: (list: RoomMessage[]) => void): Unsubscribe {
  const path = `focusRooms/${roomId}/messages`;
  const q = query(collection(db, 'focusRooms', roomId, 'messages'), orderBy('createdAt', 'asc'));
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RoomMessage, 'id'>) })));
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path),
  );
}

export async function updateRoomTimerAndSound(
  roomId: string,
  updates: {
    timerMode: 'timer' | 'stopwatch';
    timerDurationSeconds: number;
    timerStatus: RoomTimerStatus;
    timerStartedAtMs: number;
    timerAccumulatedSeconds: number;
    ambientSound: AmbientSoundId;
  },
): Promise<void> {
  const path = `focusRooms/${roomId}`;
  try {
    await updateDoc(doc(db, 'focusRooms', roomId), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateParticipantState(
  roomId: string,
  uid: string,
  updates: { displayName: string; avatarUrl?: string; subjectName: string; status: ParticipantStatus },
): Promise<void> {
  const path = `focusRooms/${roomId}/participants/${uid}`;
  try {
    await updateDoc(doc(db, 'focusRooms', roomId, 'participants', uid), {
      displayName: updates.displayName.slice(0, BLUEPRINT_LIMITS.DISPLAY_NAME_MAX),
      avatarUrl: (updates.avatarUrl || '').slice(0, BLUEPRINT_LIMITS.AVATAR_URL_MAX),
      subjectName: updates.subjectName.slice(0, 100),
      status: updates.status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function sendRoomMessage(
  room: FocusRoom,
  uid: string,
  senderName: string,
  text: string,
): Promise<void> {
  const id = genId('msg');
  const path = `focusRooms/${room.id}/messages/${id}`;
  try {
    await setDoc(doc(db, 'focusRooms', room.id, 'messages', id), {
      roomId: room.id,
      roomVisibility: room.visibility,
      roomHostId: room.hostId,
      senderId: uid,
      senderName: senderName.slice(0, BLUEPRINT_LIMITS.DISPLAY_NAME_MAX),
      text: text.trim().slice(0, BLUEPRINT_LIMITS.ROOM_MESSAGE_MAX),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function leaveFocusRoom(roomId: string, uid: string): Promise<void> {
  const path = `focusRooms/${roomId}/participants/${uid}`;
  try {
    await deleteDoc(doc(db, 'focusRooms', roomId, 'participants', uid));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function closeFocusRoom(roomId: string): Promise<void> {
  const path = `focusRooms/${roomId}`;
  try {
    await updateDoc(doc(db, 'focusRooms', roomId), {
      isActive: false,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
