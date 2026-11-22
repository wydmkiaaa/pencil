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
  addFriend,
  ensureUserProfile,
  subscribeBlurtSessions,
  subscribeChapterPhotos,
  subscribeChapters,
  subscribeDailyGoals,
  subscribeFlashcards,
  subscribeFocusSessions,
  subscribeFriends,
  subscribeIncomingFriendRequests,
  subscribeOutgoingFriendRequests,
  subscribePublicProfiles,
  subscribeSubjects,
  subscribeTasks,
  subscribeUserProfile,
} from './lib/studyRepo';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_REVIEW_INTERVALS,
  type AmbientSoundId,
  type BlurtSession,
  type Chapter,
  type ChapterPhoto,
  type DailyGoal,
  type Flashcard,
  type FocusSession,
  type FriendLink,
  type FriendRequest,
  type NavTabId,
  type PublicProfile,
  type StudyTask,
  type Subject,
  type UserProfile,
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
  const [chapterPhotos, setChapterPhotos] = useState<ChapterPhoto[]>([]);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [blurtSessions, setBlurtSessions] = useState<BlurtSession[]>([]);
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const [friends, setFriends] = useState<FriendLink[]>([]);
  const [friendsLoaded, setFriendsLoaded] = useState(false);
  const [publicProfiles, setPublicProfiles] = useState<PublicProfile[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequest[]>([]);

  const [activeTab, setActiveTab] = useState<NavTabId>('home');
  const [notifOpen, setNotifOpen] = useState(false);
  const [activeInAppBanner, setActiveInAppBanner] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [ambientSound, setAmbientSound] = useState<AmbientSoundId>('none');
  const [ambientVolume, setAmbientVolume] = useState(0.35);

  const alertedRemindersRef = useRef<Set<string>>(new Set());
  const syncedAcceptedReqRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    syncedAcceptedReqRef.current.clear();
    if (!user) {
      setProfile(null);
      setTasks([]);
      setDailyGoals([]);
      setSubjects([]);
      setChapters([]);
      setChapterPhotos([]);
      setFlashcards([]);
      setBlurtSessions([]);
      setSessions([]);
      setFriends([]);
      setFriendsLoaded(false);
      setPublicProfiles([]);
      setIncomingRequests([]);
      setOutgoingRequests([]);
      setActiveInAppBanner(null);
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
      subscribeChapterPhotos(user.uid, (items) => {
        if (!cancelled) setChapterPhotos(items);
      }),
      subscribeFlashcards(user.uid, (items) => {
        if (!cancelled) setFlashcards(items);
      }),
      subscribeBlurtSessions(user.uid, (items) => {
        if (!cancelled) setBlurtSessions(items);
      }),
      subscribeFocusSessions(user.uid, (items) => {
        if (!cancelled) setSessions(items);
      }),
      subscribeFriends(user.uid, (items) => {
        if (!cancelled) {
          setFriends(items);
          setFriendsLoaded(true);
        }
      }),
      subscribePublicProfiles((items) => {
        if (!cancelled) setPublicProfiles(items);
      }),
      subscribeIncomingFriendRequests(user.uid, (items) => {
        if (!cancelled) setIncomingRequests(items);
      }),
      subscribeOutgoingFriendRequests(user.uid, (items) => {
        if (!cancelled) setOutgoingRequests(items);
      }),
    ];

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [user]);

  useEffect(() => {
    if (!user || !friendsLoaded) return;
    const friendUids = new Set(friends.map((f) => f.friendUid));
    const publicMap = new Map(publicProfiles.map((p) => [p.uid, p]));

    outgoingRequests.forEach((req) => {
      if (req.status !== 'accepted') return;
      if (friendUids.has(req.toUid) || syncedAcceptedReqRef.current.has(req.id)) return;
      syncedAcceptedReqRef.current.add(req.id);
      const latestTarget = publicMap.get(req.toUid);
      const targetProfile: PublicProfile = latestTarget || {
        uid: req.toUid,
        handle: req.toHandle,
        displayName: req.toDisplayName,
        avatarUrl: req.toAvatarUrl,
        bio: req.toBio,
        pastelTheme: 'stone',
        isPublic: false,
      };
      void addFriend(user.uid, targetProfile).catch((err) => {
        syncedAcceptedReqRef.current.delete(req.id);
        console.error('Failed to add accepted friend:', err);
      });
    });
  }, [user, friendsLoaded, outgoingRequests, friends, publicProfiles]);

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

  const notifSettings = profile?.notificationSettings || DEFAULT_NOTIFICATION_SETTINGS;

  // In-app Notifications: upcoming deadlines, triggered reminders, and due flashcards
  const notifications = useMemo<NotificationItem[]>(() => {
    const items: NotificationItem[] = [];
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    if (notifSettings.taskReminders) {
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
    }

    if (notifSettings.dueFlashcards) {
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
    }

    const pendingRequests = incomingRequests.filter((r) => r.status === 'pending');
    if (pendingRequests.length > 0) {
      items.push({
        id: 'pending_friend_requests',
        title: `${pendingRequests.length} friend ${pendingRequests.length === 1 ? 'request' : 'requests'} awaiting approval`,
        detail: `From ${pendingRequests.slice(0, 2).map((r) => `@${r.fromHandle}`).join(', ')}${pendingRequests.length > 2 ? ` +${pendingRequests.length - 2} more` : ''}`,
        urgency: 'info',
        targetTab: 'settings',
      });
    }

    return items;
  }, [tasks, flashcards, incomingRequests, notifSettings.taskReminders, notifSettings.dueFlashcards]);

  // In-app reminder banner & optional soft chime check every 30s (no desktop alerts)
  useEffect(() => {
    if (!user || !notifSettings.taskReminders) return;
    const checkReminders = () => {
      const now = Date.now();
      for (const task of tasks) {
        if (task.status === 'completed' || !task.reminderAt) continue;
        const t = new Date(task.reminderAt).getTime();
        if (!Number.isNaN(t) && t <= now && now - t < 15 * 60 * 1000) {
          const key = `${task.id}_${task.reminderAt}`;
          if (!alertedRemindersRef.current.has(key)) {
            alertedRemindersRef.current.add(key);
            setActiveInAppBanner({ id: key, title: task.title });
            if (notifSettings.sessionChimes) {
              ambientAudio.playCompletionChime();
            }
            break;
          }
        }
      }
    };
    checkReminders();
    const id = window.setInterval(checkReminders, 30000);
    return () => window.clearInterval(id);
  }, [tasks, user, notifSettings.taskReminders, notifSettings.sessionChimes]);

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
    reviewIntervals: { ...DEFAULT_REVIEW_INTERVALS },
    notificationSettings: { ...DEFAULT_NOTIFICATION_SETTINGS },
    isPublic: false,
  };

  const profileInitials = (effectiveProfile.displayName || 'SC').slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen bg-[var(--pastel-canvas)] text-[var(--pastel-ink)] pb-32">
      {/* Transparent Top Header */}
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

          {/* Zone 3: In-App Notifications & Profile Action */}
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

      {/* Subtle In-App Reminder Banner */}
      {activeInAppBanner && (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-8 pt-1">
          <div className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-2xl px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <Bell className="w-3.5 h-3.5 text-[var(--pastel-muted)] shrink-0" />
              <span className="font-bold truncate">Reminder: {activeInAppBanner.title}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('home');
                  setActiveInAppBanner(null);
                }}
                className="font-bold underline underline-offset-4 cursor-pointer"
              >
                View Task
              </button>
              <button
                type="button"
                onClick={() => setActiveInAppBanner(null)}
                aria-label="Dismiss reminder"
                className="p-1 rounded-full hover:bg-[var(--pastel-soft)] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

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
            chimesEnabled={notifSettings.sessionChimes}
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
            chapterPhotos={chapterPhotos}
          />
        )}

        {activeTab === 'review' && (
          <ReviewView
            uid={user.uid}
            profile={effectiveProfile}
            flashcards={flashcards}
            subjects={subjects}
            chapters={chapters}
            blurtSessions={blurtSessions}
            ambientSound={ambientSound}
          />
        )}

        {activeTab === 'progress' && (
          <ProgressView profile={effectiveProfile} sessions={sessions} subjects={subjects} />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            uid={user.uid}
            profile={effectiveProfile}
            profileLoaded={profile !== null}
            friends={friends}
            publicProfiles={publicProfiles}
            incomingRequests={incomingRequests}
            outgoingRequests={outgoingRequests}
          />
        )}
      </main>

      {/* Floating Bottom Dashboard Dock */}
      <nav
        aria-label="Pencil workspace navigation"
        className="fixed bottom-5 left-1/2 -translate-x-1/2 z-30 w-[calc(100%-1.5rem)] max-w-2xl lg:w-auto lg:max-w-[calc(100vw-2rem)] rounded-3xl lg:rounded-full border border-[var(--pastel-border)] bg-[var(--pastel-surface)]/95 backdrop-blur-xl shadow-lg shadow-black/5 p-2 lg:px-3 lg:py-2"
      >
        <div className="flex items-center justify-between lg:justify-center gap-1.5 lg:gap-2 overflow-x-auto no-scrollbar">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            const pendingRequestsCount =
              item.id === 'settings'
                ? incomingRequests.filter((r) => r.status === 'pending').length
                : 0;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`relative flex-1 lg:flex-initial min-w-[54px] sm:min-w-[72px] lg:min-w-0 py-2 px-2 sm:px-3 lg:px-4.5 lg:py-2 rounded-2xl lg:rounded-full flex flex-col lg:flex-row items-center justify-center gap-1.5 lg:gap-2.5 transition-colors font-bold whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] shadow-xs'
                    : 'text-[var(--pastel-muted)] hover:text-[var(--pastel-ink)] hover:bg-[var(--pastel-soft)]'
                }`}
              >
                <span
                  className={`relative w-8 h-8 rounded-full flex items-center justify-center transition-colors shrink-0 ${
                    active ? 'bg-white/15' : 'bg-[var(--pastel-soft)]/85'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" strokeWidth={2.25} />
                  {pendingRequestsCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] border border-[var(--pastel-surface)] text-[9px] font-mono-tabular flex items-center justify-center">
                      {pendingRequestsCount}
                    </span>
                  )}
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
