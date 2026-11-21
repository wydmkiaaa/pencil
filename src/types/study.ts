export type PastelThemeId = 'stone' | 'sage' | 'blush' | 'sky' | 'lavender' | 'butter';

export type DifficultyLevel = 'easy' | 'medium' | 'hard';
export type PriorityLevel = 'low' | 'medium' | 'high';
export type TaskPriority = PriorityLevel;
export type TaskStatus = 'not_started' | 'working' | 'completed';

export type AmbientSoundId = 'none' | 'brown' | 'pink' | 'white' | 'rain' | 'forest';

export type FocusMode = 'timer' | 'stopwatch' | 'flashcards' | 'blurting';
export type FocusContextType = 'solo' | 'public_room' | 'private_room' | 'active_recall';
export type RoomVisibility = 'public' | 'private';
export type RoomTimerStatus = 'idle' | 'running' | 'paused';
export type ParticipantStatus = 'focusing' | 'break' | 'idle';

export type NavTabId =
  | 'home'
  | 'focus'
  | 'rooms'
  | 'syllabus'
  | 'review'
  | 'progress'
  | 'settings';

export interface ReviewIntervalConfig {
  hardDays: number;
  midDays: number;
  easyDays: number;
}

export const DEFAULT_REVIEW_INTERVALS: ReviewIntervalConfig = {
  hardDays: 1,
  midDays: 3,
  easyDays: 7,
};

export interface NotificationSettings {
  taskReminders: boolean;
  dueFlashcards: boolean;
  sessionChimes: boolean;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  taskReminders: true,
  dueFlashcards: true,
  sessionChimes: true,
};

export const PRIORITY_ORDER_WEIGHT: Record<PriorityLevel, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export const HARDNESS_ORDER_WEIGHT: Record<DifficultyLevel, number> = {
  hard: 3,
  medium: 2,
  easy: 1,
};

export const PRIORITY_LABELS: Record<PriorityLevel, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const HARDNESS_LABELS: Record<DifficultyLevel, string> = {
  easy: 'Easy',
  medium: 'Mid',
  hard: 'Hard',
};

export const BLUEPRINT_LIMITS = {
  DISPLAY_NAME_MAX: 80,
  HANDLE_MAX: 32,
  BIO_MAX: 300,
  AVATAR_URL_MAX: 100000,
  PHOTO_DATA_URL_MAX: 340000,
  TASK_TITLE_MAX: 200,
  TASK_NOTES_MAX: 1000,
  GOAL_TITLE_MAX: 160,
  SUBJECT_NAME_MAX: 100,
  SUBJECT_DESC_MAX: 400,
  CHAPTER_TITLE_MAX: 160,
  CHAPTER_NOTES_MAX: 50000,
  VIDEO_TITLE_MAX: 160,
  VIDEO_URL_MAX: 500,
  FLASHCARD_FRONT_MAX: 1000,
  FLASHCARD_BACK_MAX: 2000,
  BLURT_TEXT_MAX: 20000,
  ROOM_NAME_MAX: 100,
  ROOM_TOPIC_MAX: 160,
  ROOM_MESSAGE_MAX: 280,
} as const;

export interface UserProfile {
  uid: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  bio?: string;
  pastelTheme: PastelThemeId;
  dailyGoalMinutes: number;
  reviewIntervals?: ReviewIntervalConfig;
  notificationSettings?: NotificationSettings;
  isPublic?: boolean;
  handle?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PublicProfile {
  uid: string;
  handle: string;
  displayName: string;
  avatarUrl?: string;
  bio?: string;
  pastelTheme: PastelThemeId;
  isPublic: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface FriendLink {
  id: string;
  ownerId: string;
  friendUid: string;
  handle: string;
  displayName: string;
  avatarUrl?: string;
  bio?: string;
  createdAt?: unknown;
}

export interface StudyTask {
  id: string;
  ownerId: string;
  title: string;
  notes?: string;
  priority: TaskPriority;
  hardness?: DifficultyLevel;
  status: TaskStatus;
  subjectId?: string;
  dueAt?: string;
  reminderAt?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface DailyGoal {
  id: string;
  ownerId: string;
  title: string;
  targetDate: string;
  completed: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Subject {
  id: string;
  ownerId: string;
  name: string;
  color: string;
  description?: string;
  priority?: PriorityLevel;
  hardness?: DifficultyLevel;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface VideoLecture {
  id?: string;
  title: string;
  url: string;
  totalSeconds?: number;
  watchedSeconds?: number;
  lastWatchedAt?: string;
}

export interface PdfSourceMeta {
  fileName: string;
  pageCount: number;
  extractedAt: string;
}

export interface Chapter {
  id: string;
  ownerId: string;
  subjectId: string;
  title: string;
  order: number;
  priority?: PriorityLevel;
  hardness?: DifficultyLevel;
  notes: string;
  videoLectures: VideoLecture[];
  pdfSources: PdfSourceMeta[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ChapterPhoto {
  id: string;
  ownerId: string;
  subjectId: string;
  chapterId: string;
  title: string;
  dataUrl: string;
  createdAt?: unknown;
}

export interface Flashcard {
  id: string;
  ownerId: string;
  subjectId: string;
  chapterId?: string;
  front: string;
  back: string;
  priority?: PriorityLevel;
  hardness?: DifficultyLevel;
  repetitions: number;
  intervalDays: number;
  easeFactor: number;
  nextReviewAt: string;
  lastReviewedAt?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface BlurtWeakPoint {
  topic: string;
  gap: string;
  suggestedReview: string;
}

export interface BlurtSession {
  id: string;
  ownerId: string;
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
  cardsGeneratedCount?: number;
  dateKey: string;
  createdAt?: unknown;
}

export interface FocusSession {
  id: string;
  ownerId: string;
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
  createdAt?: unknown;
}

export interface FocusRoom {
  id: string;
  hostId: string;
  hostName: string;
  name: string;
  topic?: string;
  visibility: RoomVisibility;
  passwordHash: string;
  timerMode: 'timer' | 'stopwatch';
  timerDurationSeconds: number;
  timerStatus: RoomTimerStatus;
  timerStartedAtMs: number;
  timerAccumulatedSeconds: number;
  ambientSound: AmbientSoundId;
  isActive: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface RoomParticipant {
  id: string;
  uid: string;
  roomId: string;
  roomVisibility: RoomVisibility;
  roomHostId: string;
  displayName: string;
  avatarUrl?: string;
  subjectName?: string;
  status: ParticipantStatus;
  joinedAt?: unknown;
  updatedAt?: unknown;
}

export interface RoomMessage {
  id: string;
  roomId: string;
  roomVisibility: RoomVisibility;
  roomHostId: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt?: unknown;
}

export const PASTEL_THEMES: Array<{
  id: PastelThemeId;
  label: string;
  swatch: string;
  accent: string;
}> = [
  { id: 'stone', label: 'Warm Stone', swatch: '#F2F0EC', accent: '#272C30' },
  { id: 'sage', label: 'Soft Sage', swatch: '#DCE8E0', accent: '#4C6B58' },
  { id: 'blush', label: 'Dusty Blush', swatch: '#F2DFE2', accent: '#8F5B62' },
  { id: 'sky', label: 'Morning Sky', swatch: '#DDE8F2', accent: '#486985' },
  { id: 'lavender', label: 'Muted Lavender', swatch: '#E6E0F2', accent: '#685987' },
  { id: 'butter', label: 'Cream Butter', swatch: '#F0E8CD', accent: '#78673A' },
];

export const SUBJECT_COLOR_PALETTE = [
  { name: 'Slate', hex: '#4B5563' },
  { name: 'Sage', hex: '#6B8F78' },
  { name: 'Rosewood', hex: '#B57B82' },
  { name: 'Steel Blue', hex: '#6485A3' },
  { name: 'Lavender', hex: '#8678A8' },
  { name: 'Ochre', hex: '#A88E56' },
  { name: 'Terracotta', hex: '#B27C66' },
  { name: 'Moss', hex: '#7A8C62' },
];
