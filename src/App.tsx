import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  BarChart3,
  Bell,
  BookOpen,
  Clock,
  Home,
  Layers,
  Settings,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import { AuthGate } from './components/AuthGate';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FocusView } from './components/FocusView';
import { HomeView } from './components/HomeView';
import { ProgressView } from './components/ProgressView';
import { ReviewView } from './components/ReviewView';
import { RoomsView } from './components/RoomsView';
import { SettingsView } from './components/SettingsView';
import { SyllabusView } from './components/SyllabusView';
import { ambientAudio } from './lib/ambientAudio';
import { auth } from './lib/firebase';
import {
  ensureUserProfile,
  subscribeChapters,
  subscribeDailyGoals,
  subscribeFlashcards,
  subscribeFocusSessions,
  subscribeFriends,
  subscribePublicProfiles,
  subscribeSubjects,
  subscribeTasks,
  subscribeUserProfile,
} from './lib/studyRepo';
import type {
  AmbientSoundId,
  Chapter,
  DailyGoal,
  Flashcard,
  FocusSession,
  FriendLink,
  NavTabId,
  PublicProfile,
  StudyTask,
  Subject,
  UserProfile,
} from './types/study';

interface NotificationItem {
  id: string;
  title: string;
  detail: string;
  urgency: 'overdue' | 'soon' | 'info';
  targetTab: NavTabId;
}

const NAV_ITEMS: Array<{
  id: NavTabId;
  label: string;
  icon: React.FC<{ className?: string; strokeWidth?: number }>;
}> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'focus', label: 'Focus', icon: Clock },
  { id: 'rooms', label: 'Rooms', icon: Users },
  { id: 'syllabus', label: 'Syllabus', icon: BookOpen },
  { id: 'review', label: 'Review', icon: Layers },
  { id: 'progress', label: 'Progress', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

function AppWorkspace() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [tasks, setTasks] = useState<StudyTask[]>([]);
  const [dailyGoals, setDailyGoals] = useState<DailyGoal[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const [friends, setFriends] = useState<FriendLink[]>([]);
  const [publicProfiles, setPublicProfiles] = useState<PublicProfile[]>([]);

  const [activeTab, setActiveTab] = useState<NavTabId>('home');
  const [notifOpen, setNotifOpen] = useState(false);
  const [ambientSound, setAmbientSound] = useState<AmbientSoundId>('none');
  const [ambientVolume, setAmbientVolume] = useState(0.35);

  const alertedRemindersRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setTasks([]);
      setDailyGoals([]);
      setSubjects([]);
      setChapters([]);
      setFlashcards([]);
      setSessions([]);
      setFriends([]);
      setPublicProfiles([]);
      ambientAudio.stop();
      return;
    }

    let cancelled = false;
    void ensureUserProfile(user.uid, {
      displayName: user.displayName || user.email?.split('@')[0] || 'Scholar',
      email: user.email,
      avatarUrl: user.photoURL,
    }).catch((err) => {
      console.error('Failed to ensure profile:', err);
    });

    const unsubs = [
      subscribeUserProfile(user.uid, (p) => {
        if (!cancelled && p) setProfile(p);
      }),
      subscribeTasks(user.uid, (items) => {
        if (!cancelled) setTasks(items);
      }),
      subscribeDailyGoals(user.uid, (items) => {
        if (!cancelled) setDailyGoals(items);
      }),
      subscribeSubjects(user.uid, (items) => {
        if (!cancelled) setSubjects(items);
      }),
      subscribeChapters(user.uid, (items) => {
        if (!cancelled) setChapters(items);
      }),
      subscribeFlashcards(user.uid, (items) => {
        if (!cancelled) setFlashcards(items);
      }),
      subscribeFocusSessions(user.uid, (items) => {
        if (!cancelled) setSessions(items);
      }),
      subscribeFriends(user.uid, (items) => {
        if (!cancelled) setFriends(items);
      }),
      subscribePublicProfiles((items) => {
        if (!cancelled) setPublicProfiles(items);
      }),
    ];

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [user]);

  useEffect(() => {
    const theme = profile?.pastelTheme || 'stone';
    document.documentElement.setAttribute('data-theme', theme);
  }, [profile?.pastelTheme]);

  const handleChangeAmbientSound = (sound: AmbientSoundId) => {
    setAmbientSound(sound);
    ambientAudio.play(sound, ambientVolume);
  };

  const handleChangeAmbientVolume = (vol: number) => {
    setAmbientVolume(vol);
    ambientAudio.setVolume(vol);
  };

  // Notifications: upcoming deadlines, triggered reminders, and due flashcards
  const notifications = useMemo<NotificationItem[]>(() => {
    const items: NotificationItem[] = [];
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    tasks.forEach((task) => {
      if (task.status === 'completed') return;

      if (task.reminderAt) {
        const remindTime = new Date(task.reminderAt).getTime();
        if (!Number.isNaN(remindTime) && remindTime <= now + 60 * 60 * 1000) {
          items.push({
            id: `rem_${task.id}`,
            title: `Reminder: ${task.title}`,
            detail:
              remindTime <= now
                ? 'Reminder time has arrived'
                : `Scheduled for ${new Date(task.reminderAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
            urgency: remindTime <= now ? 'overdue' : 'soon',
            targetTab: 'home',
          });
        }
      }

      if (task.dueAt) {
        const dueTime = new Date(task.dueAt).getTime();
        if (!Number.isNaN(dueTime) && dueTime <= now + oneDayMs) {
          items.push({
            id: `due_${task.id}`,
            title: `Deadline: ${task.title}`,
            detail:
              dueTime < now
                ? 'Overdue deadline'
                : `Due ${new Date(task.dueAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
            urgency: dueTime < now ? 'overdue' : 'soon',
            targetTab: 'home',
          });
        }
      }
    });

    const nowIso = new Date().toISOString();
    const dueCards = flashcards.filter((c) => c.nextReviewAt <= nowIso).length;
    if (dueCards > 0) {
      items.push({
        id: 'due_cards',
        title: `${dueCards} flashcards due for review`,
        detail: 'Keep your spaced repetition streak on schedule.',
        urgency: 'info',
        targetTab: 'review',
      });
    }

    return items;
  }, [tasks, flashcards]);

  // Browser desktop notification check every 30s for due task reminders
  useEffect(() => {
    if (!user) return;
    const checkReminders = () => {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      const now = Date.now();
      tasks.forEach((task) => {
        if (task.status === 'completed' || !task.reminderAt) return;
        const t = new Date(task.reminderAt).getTime();
        if (!Number.isNaN(t) && t <= now && now - t < 15 * 60 * 1000) {
          const key = `${task.id}_${task.reminderAt}`;
          if (!alertedRemindersRef.current.has(key)) {
            alertedRemindersRef.current.add(key);
            new Notification('Pencil Reminder', {
              body: task.title,
            });
          }
        }
      });
    };
    checkReminders();
    const id = window.setInterval(checkReminders, 30000);
    return () => window.clearInterval(id);
  }, [tasks, user]);

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--pastel-canvas)] text-[var(--pastel-muted)] text-sm">
        Preparing your study desk...
      </div>
    );
  }

  if (!user) {
    return <AuthGate />;
  }

  const effectiveProfile: UserProfile = profile || {
    uid: user.uid,
    displayName: user.displayName || user.email?.split('@')[0] || 'Scholar',
    email: user.email || '',
    avatarUrl: user.photoURL || '',
    bio: '',
    pastelTheme: 'stone',
    dailyGoalMinutes: 120,
    isPublic: false,
  };

  const profileInitials = (effectiveProfile.displayName || 'SC').slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen bg-[var(--pastel-canvas)] text-[var(--pastel-ink)] pb-32">
      {/* Transparent Top Header (no white bar) */}
      <header className="pt-5 pb-3">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-8 h-12 flex items-center justify-between gap-6">
          {/* Zone 1: Brand Wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className="text-xl font-extrabold tracking-tight font-display whitespace-nowrap shrink-0 cursor-pointer"
          >
            Pencil
          </button>

          {/* Zone 2: Quiet Workspace Context */}
          <div className="hidden md:flex items-center gap-4 text-xs text-[var(--pastel-muted)] whitespace-nowrap shrink-0">
            <span className="capitalize font-bold">{activeTab}</span>
            {ambientSound !== 'none' && (
              <button
                type="button"
                onClick={() => handleChangeAmbientSound('none')}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[var(--pastel-surface)] border border-[var(--pastel-border)] text-[var(--pastel-ink)] hover:opacity-80 cursor-pointer"
                title="Click to mute ambient sound"
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span className="capitalize">{ambientSound} playing</span>
              </button>
            )}
          </div>

          {/* Zone 3: Notifications & Profile Action */}
          <div className="flex items-center gap-2.5 shrink-0 relative">
            <button
              type="button"
              onClick={() => setNotifOpen((prev) => !prev)}
              aria-label="Notifications"
              className="relative w-10 h-10 rounded-full bg-[var(--pastel-surface)] border border-[var(--pastel-border)] hover:bg-[var(--pastel-soft)] transition-colors flex items-center justify-center cursor-pointer"
            >
              <Bell className="w-4 h-4" />
              {notifications.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-[10px] font-mono-tabular flex items-center justify-center">
                  {notifications.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              aria-label="Open profile settings"
              className="w-10 h-10 rounded-full overflow-hidden border border-[var(--pastel-border)] bg-[var(--pastel-surface)] flex items-center justify-center text-xs font-extrabold cursor-pointer shrink-0 hover:bg-[var(--pastel-soft)] transition-colors"
            >
              {effectiveProfile.avatarUrl ? (
                <img
                  src={effectiveProfile.avatarUrl}
                  alt={effectiveProfile.displayName}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              ) : (
                <span>{profileInitials}</span>
              )}
            </button>

            {/* Notifications Popover */}
            {notifOpen && (
              <div className="absolute right-0 top-12 w-80 max-w-[90vw] bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl shadow-lg p-5 space-y-3 z-40">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-extrabold">Reminders &amp; Deadlines</h3>
                  <button
                    type="button"
                    onClick={() => setNotifOpen(false)}
                    className="p-1.5 rounded-full text-[var(--pastel-muted)] hover:text-[var(--pastel-ink)] hover:bg-[var(--pastel-soft)] cursor-pointer"
                    aria-label="Close notifications"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {notifications.length === 0 ? (
                  <p className="py-6 text-center text-xs text-[var(--pastel-muted)]">
                    No upcoming deadlines or reminders right now.
                  </p>
                ) : (
                  <div className="max-h-72 overflow-y-auto divide-y divide-[var(--pastel-border)]">
                    {notifications.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => {
                          setActiveTab(n.targetTab);
                          setNotifOpen(false);
                        }}
                        className="w-full py-2.5 text-left hover:bg-[var(--pastel-canvas)] rounded-2xl px-3 transition-colors cursor-pointer space-y-0.5"
                      >
                        <div className="text-xs font-bold">{n.title}</div>
                        <div
                          className={`text-[11px] ${
                            n.urgency === 'overdue'
                              ? 'text-red-700'
                              : 'text-[var(--pastel-muted)]'
                          }`}
                        >
                          {n.detail}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 md:px-8 pt-3 pb-8">
        {activeTab === 'home' && (
          <HomeView
            uid={user.uid}
            profile={effectiveProfile}
            tasks={tasks}
            dailyGoals={dailyGoals}
            subjects={subjects}
            sessions={sessions}
            flashcards={flashcards}
            onNavigate={setActiveTab}
          />
        )}

        {activeTab === 'focus' && (
          <FocusView
            uid={user.uid}
            subjects={subjects}
            sessions={sessions}
            ambientSound={ambientSound}
            ambientVolume={ambientVolume}
            onChangeAmbientSound={handleChangeAmbientSound}
            onChangeAmbientVolume={handleChangeAmbientVolume}
          />
        )}

        {activeTab === 'rooms' && (
          <RoomsView
            uid={user.uid}
            profile={effectiveProfile}
            subjects={subjects}
            ambientSound={ambientSound}
            ambientVolume={ambientVolume}
            onChangeAmbientSound={handleChangeAmbientSound}
            onChangeAmbientVolume={handleChangeAmbientVolume}
          />
        )}

        {activeTab === 'syllabus' && (
          <SyllabusView
            uid={user.uid}
            subjects={subjects}
            chapters={chapters}
            flashcards={flashcards}
          />
        )}

        {activeTab === 'review' && (
          <ReviewView uid={user.uid} flashcards={flashcards} subjects={subjects} />
        )}

        {activeTab === 'progress' && (
          <ProgressView profile={effectiveProfile} sessions={sessions} subjects={subjects} />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            uid={user.uid}
            profile={effectiveProfile}
            friends={friends}
            publicProfiles={publicProfiles}
          />
        )}
      </main>

      {/* Floating Bottom Dashboard Dock with Circular Icon Badges (Settings on rightmost) */}
      <nav
        aria-label="Pencil workspace navigation"
        className="fixed bottom-5 left-1/2 -translate-x-1/2 z-30 w-[calc(100%-1.5rem)] max-w-2xl lg:w-auto lg:max-w-[calc(100vw-2rem)] rounded-3xl lg:rounded-full border border-[var(--pastel-border)] bg-[var(--pastel-surface)]/95 backdrop-blur-xl shadow-lg shadow-black/5 p-2 lg:px-3 lg:py-2"
      >
        <div className="flex items-center justify-between lg:justify-center gap-1.5 lg:gap-2 overflow-x-auto no-scrollbar">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex-1 lg:flex-initial min-w-[54px] sm:min-w-[72px] lg:min-w-0 py-2 px-2 sm:px-3 lg:px-4.5 lg:py-2 rounded-2xl lg:rounded-full flex flex-col lg:flex-row items-center justify-center gap-1.5 lg:gap-2.5 transition-colors font-bold whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] shadow-xs'
                    : 'text-[var(--pastel-muted)] hover:text-[var(--pastel-ink)] hover:bg-[var(--pastel-soft)]'
                }`}
              >
                <span
                  className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors shrink-0 ${
                    active ? 'bg-white/15' : 'bg-[var(--pastel-soft)]/85'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" strokeWidth={2.25} />
                </span>
                <span className="text-[11px] lg:text-xs leading-none">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppWorkspace />
    </ErrorBoundary>
  );
}
