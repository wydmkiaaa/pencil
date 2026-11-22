import React, { useEffect, useMemo, useState } from 'react';
import { signOut, updateProfile } from 'firebase/auth';
import {
  Bell,
  Check,
  Clock,
  Copy,
  Eye,
  Globe,
  Layers,
  Lock,
  LogOut,
  Palette,
  Search,
  Target,
  Trash2,
  Upload,
  User,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { auth } from '../lib/firebase';
import {
  addFriend,
  cancelFriendRequest,
  normalizeHandle,
  removeFriend,
  respondToFriendRequest,
  sendFriendRequest,
  updateUserProfile,
} from '../lib/studyRepo';
import {
  BLUEPRINT_LIMITS,
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_REVIEW_INTERVALS,
  PASTEL_THEMES,
  type FriendLink,
  type FriendRequest,
  type NotificationSettings,
  type PastelThemeId,
  type PublicProfile,
  type UserProfile,
} from '../types/study';
import { FriendRequestsView } from './FriendRequestsView';

interface SettingsViewProps {
  uid: string;
  profile: UserProfile;
  profileLoaded: boolean;
  friends: FriendLink[];
  publicProfiles: PublicProfile[];
  incomingRequests: FriendRequest[];
  outgoingRequests: FriendRequest[];
}

async function compressImageToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const size = 160;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas not supported.');
  }
  const minDim = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - minDim) / 2;
  const sy = (bitmap.height - minDim) / 2;
  ctx.drawImage(bitmap, sx, sy, minDim, minDim, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', 0.8);
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return (name.trim().slice(0, 2) || 'SC').toUpperCase();
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  uid,
  profile,
  profileLoaded,
  friends,
  publicProfiles,
  incomingRequests,
  outgoingRequests,
}) => {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [handleInput, setHandleInput] = useState(profile.handle || '');
  const [bio, setBio] = useState(profile.bio || '');
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl || '');
  const [dailyGoalMinutes, setDailyGoalMinutes] = useState(profile.dailyGoalMinutes || 120);
  const [isPublic, setIsPublic] = useState(Boolean(profile.isPublic));
  const [shareStudyGoal, setShareStudyGoal] = useState(profile.shareStudyGoal ?? true);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [copiedHandle, setCopiedHandle] = useState(false);

  const [friendSearch, setFriendSearch] = useState('');
  const [busyFriendUid, setBusyFriendUid] = useState<string | null>(null);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [friendNotice, setFriendNotice] = useState<string | null>(null);
  const [showProfileViewerDirectory, setShowProfileViewerDirectory] = useState(false);
  const [profileDirectoryFilter, setProfileDirectoryFilter] = useState<'all' | 'following' | 'public'>('all');
  const [viewedProfileUid, setViewedProfileUid] = useState<string | null>(null);
  const [copiedViewedHandle, setCopiedViewedHandle] = useState(false);

  const baseIntervals = profile.reviewIntervals || DEFAULT_REVIEW_INTERVALS;
  const [hardDays, setHardDays] = useState(String(baseIntervals.hardDays));
  const [midDays, setMidDays] = useState(String(baseIntervals.midDays));
  const [easyDays, setEasyDays] = useState(String(baseIntervals.easyDays));
  const [savingIntervals, setSavingIntervals] = useState(false);
  const [intervalsSavedMsg, setIntervalsSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(profile.displayName);
  }, [profile.displayName]);

  useEffect(() => {
    if (profile.handle) {
      setHandleInput(profile.handle);
    } else if (profileLoaded) {
      setHandleInput(normalizeHandle(`${profile.displayName}_${uid.slice(0, 4)}`, uid));
    }
  }, [profile.handle, profile.displayName, profileLoaded, uid]);

  useEffect(() => {
    setBio(profile.bio || '');
  }, [profile.bio]);

  useEffect(() => {
    setAvatarUrl(profile.avatarUrl || '');
  }, [profile.avatarUrl]);

  useEffect(() => {
    setDailyGoalMinutes(profile.dailyGoalMinutes || 120);
  }, [profile.dailyGoalMinutes]);

  useEffect(() => {
    setIsPublic(Boolean(profile.isPublic));
  }, [profile.isPublic]);

  useEffect(() => {
    setShareStudyGoal(profile.shareStudyGoal ?? true);
  }, [profile.shareStudyGoal]);

  useEffect(() => {
    const iv = profile.reviewIntervals || DEFAULT_REVIEW_INTERVALS;
    setHardDays(String(iv.hardDays));
    setMidDays(String(iv.midDays));
    setEasyDays(String(iv.easyDays));
  }, [profile.reviewIntervals]);

  const notifSettings: NotificationSettings =
    profile.notificationSettings || DEFAULT_NOTIFICATION_SETTINGS;

  const friendUidSet = useMemo(() => new Set(friends.map((f) => f.friendUid)), [friends]);

  const publicProfileByUid = useMemo(() => {
    const map = new Map<string, PublicProfile>();
    publicProfiles.forEach((p) => map.set(p.uid, p));
    return map;
  }, [publicProfiles]);

  const friendsByUid = useMemo(() => {
    const map = new Map<string, FriendLink>();
    friends.forEach((f) => map.set(f.friendUid, f));
    return map;
  }, [friends]);

  const outgoingByTargetUid = useMemo(() => {
    const map = new Map<string, FriendRequest>();
    outgoingRequests.forEach((req) => {
      map.set(req.toUid, req);
    });
    return map;
  }, [outgoingRequests]);

  const incomingBySenderUid = useMemo(() => {
    const map = new Map<string, FriendRequest>();
    incomingRequests.forEach((req) => {
      map.set(req.fromUid, req);
    });
    return map;
  }, [incomingRequests]);

  const discoverableScholars = useMemo(() => {
    const q = friendSearch.trim().toLowerCase().replace(/^@/, '');
    return publicProfiles
      .filter((p) => p.uid !== uid && !friendUidSet.has(p.uid))
      .filter((p) => {
        if (!q) return true;
        const matchesIdentity =
          p.displayName.toLowerCase().includes(q) ||
          p.handle.toLowerCase().includes(q);
        // Never match or expose bio text for unfollowed private accounts
        const matchesBio = p.isPublic && (p.bio || '').toLowerCase().includes(q);
        return matchesIdentity || matchesBio;
      })
      .slice(0, 16);
  }, [publicProfiles, uid, friendUidSet, friendSearch]);

  const viewableDirectoryProfiles = useMemo(() => {
    const q = friendSearch.trim().toLowerCase().replace(/^@/, '');
    const entries: Array<{
      uid: string;
      displayName: string;
      handle: string;
      avatarUrl?: string;
      bio?: string;
      pastelTheme?: PastelThemeId;
      isPublic: boolean;
      isFollowing: boolean;
      dailyGoalMinutes?: number;
      shareStudyGoal?: boolean;
      pub?: PublicProfile;
    }> = [];

    friends.forEach((f) => {
      const pub = publicProfileByUid.get(f.friendUid);
      entries.push({
        uid: f.friendUid,
        displayName: pub?.displayName || f.displayName,
        handle: pub?.handle || f.handle,
        avatarUrl: pub?.avatarUrl ?? f.avatarUrl,
        bio: pub?.bio ?? f.bio,
        pastelTheme: pub?.pastelTheme || 'stone',
        isPublic: Boolean(pub?.isPublic),
        isFollowing: true,
        dailyGoalMinutes: pub?.dailyGoalMinutes,
        shareStudyGoal: pub?.shareStudyGoal ?? true,
        pub,
      });
    });

    publicProfiles.forEach((p) => {
      if (p.uid === uid || friendUidSet.has(p.uid)) return;
      if (!p.isPublic) return; // Strictly exclude unfollowed private accounts
      entries.push({
        uid: p.uid,
        displayName: p.displayName,
        handle: p.handle,
        avatarUrl: p.avatarUrl,
        bio: p.bio,
        pastelTheme: p.pastelTheme || 'stone',
        isPublic: true,
        isFollowing: false,
        dailyGoalMinutes: p.dailyGoalMinutes,
        shareStudyGoal: p.shareStudyGoal ?? true,
        pub: p,
      });
    });

    return entries
      .filter((entry) => {
        if (profileDirectoryFilter === 'following') return entry.isFollowing;
        if (profileDirectoryFilter === 'public') return entry.isPublic && !entry.isFollowing;
        return true;
      })
      .filter((entry) => {
        if (!q) return true;
        return (
          entry.displayName.toLowerCase().includes(q) ||
          entry.handle.toLowerCase().includes(q) ||
          (entry.bio || '').toLowerCase().includes(q)
        );
      });
  }, [friends, publicProfiles, publicProfileByUid, friendUidSet, uid, profileDirectoryFilter, friendSearch]);

  const matchedExistingFriend = useMemo(() => {
    const q = friendSearch.trim().toLowerCase().replace(/^@/, '');
    if (!q) return false;
    return friends.some(
      (f) =>
        f.displayName.toLowerCase().includes(q) ||
        f.handle.toLowerCase().includes(q),
    );
  }, [friendSearch, friends]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileLoaded) return;
    setProfileError(null);
    setSavedNotice(null);

    const cleanedHandle = handleInput
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, BLUEPRINT_LIMITS.HANDLE_MAX);

    if (cleanedHandle.length < 3) {
      setProfileError('Study handle must be at least 3 characters (letters, numbers, _ or -).');
      return;
    }

    setSaving(true);
    try {
      setHandleInput(cleanedHandle);
      await updateUserProfile(uid, {
        displayName,
        bio,
        avatarUrl,
        dailyGoalMinutes,
        isPublic,
        shareStudyGoal,
        handle: cleanedHandle,
      });
      if (auth.currentUser) {
        try {
          await updateProfile(auth.currentUser, {
            displayName: displayName.trim().slice(0, BLUEPRINT_LIMITS.DISPLAY_NAME_MAX),
          });
        } catch {
          // Non-fatal: Firestore profile is the source of truth
        }
      }
      setSavedNotice('Profile saved.');
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Unable to save profile right now.');
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePublicProfile = async () => {
    if (!profileLoaded) return;
    const next = !isPublic;
    setIsPublic(next);
    setSavedNotice(null);
    setProfileError(null);
    try {
      await updateUserProfile(uid, {
        isPublic: next,
      });
      setSavedNotice(
        next
          ? 'Your profile is now public. Anyone can view and add you directly.'
          : 'Your profile is now private. People can find your handle in search, but cannot view your profile until you approve their request.',
      );
    } catch (err) {
      setIsPublic(!next);
      setProfileError(err instanceof Error ? err.message : 'Unable to update visibility setting.');
    }
  };

  const handleToggleShareStudyGoal = async () => {
    if (!profileLoaded) return;
    const next = !shareStudyGoal;
    setShareStudyGoal(next);
    setSavedNotice(null);
    setProfileError(null);
    try {
      await updateUserProfile(uid, {
        shareStudyGoal: next,
      });
      setSavedNotice(
        next
          ? 'Your daily study target is visible to approved followers and public viewers.'
          : 'Your daily study target is hidden from other learners.',
      );
    } catch (err) {
      setShareStudyGoal(!next);
      setProfileError(err instanceof Error ? err.message : 'Unable to update goal sharing setting.');
    }
  };

  const handleUploadAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setProfileError(null);
    try {
      const compressed = await compressImageToDataUrl(file);
      setAvatarUrl(compressed);
      await updateUserProfile(uid, { avatarUrl: compressed });
      setSavedNotice('Profile picture updated.');
    } catch {
      setProfileError('Could not process that image file.');
    }
  };

  const handleClearAvatar = async () => {
    setProfileError(null);
    setAvatarUrl('');
    try {
      await updateUserProfile(uid, { avatarUrl: '' });
      setSavedNotice('Using clean initials avatar.');
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Unable to clear profile picture.');
    }
  };

  const handleSelectTheme = async (themeId: PastelThemeId) => {
    await updateUserProfile(uid, { pastelTheme: themeId });
  };

  const handleCopyHandle = async () => {
    const cleaned = handleInput.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const normalized = cleaned.length >= 3 ? cleaned : normalizeHandle(displayName, uid);
    try {
      await navigator.clipboard.writeText(`@${normalized}`);
      setCopiedHandle(true);
      window.setTimeout(() => setCopiedHandle(false), 1800);
    } catch {
      // clipboard blocked
    }
  };

  const handleAddFriend = async (target: PublicProfile) => {
    setBusyFriendUid(target.uid);
    setFriendNotice(null);
    try {
      await addFriend(uid, target);
      setFriendNotice(`Added ${target.displayName} as a study friend.`);
    } catch (err) {
      setFriendNotice(err instanceof Error ? err.message : 'Unable to add friend right now.');
    } finally {
      setBusyFriendUid(null);
    }
  };

  const handleSendRequest = async (target: PublicProfile) => {
    setBusyFriendUid(target.uid);
    setFriendNotice(null);
    try {
      const senderProfile: UserProfile = {
        ...profile,
        handle:
          handleInput.trim().length >= 3
            ? handleInput.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
            : profile.handle,
      };
      await sendFriendRequest(senderProfile, target);
      setFriendNotice(`Friend request sent to ${target.displayName}.`);
    } catch (err) {
      setFriendNotice(err instanceof Error ? err.message : 'Unable to send friend request right now.');
    } finally {
      setBusyFriendUid(null);
    }
  };

  const handleCancelRequest = async (req: FriendRequest) => {
    setBusyFriendUid(req.toUid);
    setFriendNotice(null);
    try {
      await cancelFriendRequest(req.id);
      setFriendNotice(`Cancelled request to ${req.toDisplayName}.`);
    } catch (err) {
      setFriendNotice(err instanceof Error ? err.message : 'Unable to cancel request.');
    } finally {
      setBusyFriendUid(null);
    }
  };

  const handleRespondRequest = async (req: FriendRequest, decision: 'accepted' | 'declined') => {
    setBusyRequestId(req.id);
    setFriendNotice(null);
    try {
      await respondToFriendRequest(req.id, decision);
      setFriendNotice(
        decision === 'accepted'
          ? `Approved ${req.fromDisplayName}'s friend request.`
          : `Declined ${req.fromDisplayName}'s friend request.`,
      );
    } catch (err) {
      setFriendNotice(err instanceof Error ? err.message : 'Unable to respond to request.');
    } finally {
      setBusyRequestId(null);
    }
  };

  const handleRemoveFriend = async (friendUid: string) => {
    setBusyFriendUid(friendUid);
    setFriendNotice(null);
    try {
      await removeFriend(uid, friendUid);
    } finally {
      setBusyFriendUid(null);
    }
  };

  const handleSaveIntervals = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingIntervals(true);
    setIntervalsSavedMsg(null);
    try {
      await updateUserProfile(uid, {
        reviewIntervals: {
          hardDays: Math.max(1, Math.min(365, Math.round(Number(hardDays) || 1))),
          midDays: Math.max(1, Math.min(365, Math.round(Number(midDays) || 3))),
          easyDays: Math.max(1, Math.min(365, Math.round(Number(easyDays) || 7))),
        },
      });
      setIntervalsSavedMsg('Review intervals saved.');
    } finally {
      setSavingIntervals(false);
    }
  };

  const handleToggleNotificationSetting = async (key: keyof NotificationSettings) => {
    const next: NotificationSettings = {
      ...notifSettings,
      [key]: !notifSettings[key],
    };
    await updateUserProfile(uid, { notificationSettings: next });
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Settings &amp; Appearance</h1>
          <p className="text-sm font-semibold text-[var(--pastel-muted)]">
            Customize your profile, public visibility, study friends, and pastel workspace palette.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void signOut(auth)}
          className="px-4 py-2 rounded-full border border-[var(--pastel-border)] hover:bg-[var(--pastel-soft)] text-xs font-bold flex items-center gap-2 cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign Out</span>
        </button>
      </div>

      {/* Pastel Theme Customization */}
      <section className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Palette className="w-4 h-4 text-[var(--pastel-muted)]" />
          <div>
            <h2 className="text-base font-extrabold tracking-tight">Pastel Workspace Theme</h2>
            <p className="text-xs text-[var(--pastel-muted)]">
              Choose a soft pastel tone to tint the entire workspace while preserving crisp readability.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          {PASTEL_THEMES.map((theme) => {
            const active = profile.pastelTheme === theme.id;
            return (
              <button
                key={theme.id}
                type="button"
                onClick={() => void handleSelectTheme(theme.id)}
                className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer space-y-2 ${
                  active
                    ? 'border-[var(--pastel-ink)] ring-1 ring-[var(--pastel-ink)]'
                    : 'border-[var(--pastel-border)] hover:bg-[var(--pastel-canvas)]'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="w-6 h-6 rounded-full border border-black/10"
                    style={{ backgroundColor: theme.swatch }}
                  />
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: theme.accent }}
                  />
                </div>
                <div className="text-xs font-bold">{theme.label}</div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Profile Settings */}
      <section className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-[var(--pastel-muted)]" />
            <h2 className="text-base font-extrabold tracking-tight">Profile, Visibility &amp; Goals</h2>
          </div>

          <button
            type="button"
            disabled={!profileLoaded}
            onClick={() => void handleTogglePublicProfile()}
            className={`px-4 py-2 rounded-full border text-xs font-bold inline-flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-50 ${
              isPublic
                ? 'bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] border-[var(--pastel-accent)]'
                : 'bg-[var(--pastel-canvas)] text-[var(--pastel-ink)] border-[var(--pastel-border)] hover:bg-[var(--pastel-soft)]'
            }`}
          >
            {isPublic ? <Globe className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            <span>{isPublic ? 'Public Profile Enabled' : 'Profile Private'}</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-6">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={displayName}
              referrerPolicy="no-referrer"
              className="w-20 h-20 rounded-full object-cover border border-[var(--pastel-border)] bg-[var(--pastel-soft)]"
            />
          ) : (
            <div className="w-20 h-20 rounded-full border border-[var(--pastel-border)] bg-[var(--pastel-soft)] text-[var(--pastel-ink)] text-xl font-extrabold flex items-center justify-center">
              {getInitials(displayName)}
            </div>
          )}

          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <label className="px-4 py-2 rounded-full border border-[var(--pastel-border)] hover:bg-[var(--pastel-soft)] text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                <span>Upload Picture</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => void handleUploadAvatar(e)}
                  className="hidden"
                />
              </label>
              {avatarUrl && (
                <button
                  type="button"
                  onClick={() => void handleClearAvatar()}
                  className="px-4 py-2 rounded-full border border-[var(--pastel-border)] hover:bg-[var(--pastel-soft)] text-xs font-bold text-[var(--pastel-muted)] cursor-pointer"
                >
                  Use Initials
                </button>
              )}
            </div>
            <p className="text-[11px] text-[var(--pastel-muted)]">
              {isPublic
                ? `Your profile is public. Learners can search @${handleInput || '...'}, view your study profile, and add you directly.`
                : `Your profile is private. Learners can still find @${handleInput || '...'} in search, but cannot view your full profile until you approve their request.`}
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[var(--pastel-muted)]">
                Profile Name
              </label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={BLUEPRINT_LIMITS.DISPLAY_NAME_MAX}
                className="w-full px-4 py-2 text-sm font-semibold rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[var(--pastel-muted)]">
                Study Handle
              </label>
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs text-[var(--pastel-muted)]">
                    @
                  </span>
                  <input
                    type="text"
                    value={handleInput}
                    onChange={(e) =>
                      setHandleInput(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))
                    }
                    maxLength={BLUEPRINT_LIMITS.HANDLE_MAX}
                    placeholder="your_handle"
                    className="w-full pl-8 pr-3 py-2 text-sm font-mono-tabular rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleCopyHandle()}
                  className="p-2.5 rounded-full border border-[var(--pastel-border)] hover:bg-[var(--pastel-soft)] cursor-pointer"
                  title="Copy handle"
                  aria-label="Copy handle"
                >
                  {copiedHandle ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[var(--pastel-muted)]">
                Daily Study Target (minutes)
              </label>
              <input
                type="number"
                min={15}
                max={720}
                value={dailyGoalMinutes}
                onChange={(e) => setDailyGoalMinutes(Number(e.target.value) || 120)}
                className="w-full px-4 py-2 text-sm rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] font-mono-tabular focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[var(--pastel-muted)]">
              Study Focus / Bio
            </label>
            <input
              type="text"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="e.g., Pre-med finals prep · Deep work mornings"
              maxLength={BLUEPRINT_LIMITS.BIO_MAX}
              className="w-full px-4 py-2 text-sm font-semibold rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] px-4 py-3">
            <div className="flex items-start gap-2.5">
              <Target className="w-4 h-4 text-[var(--pastel-muted)] shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="text-xs font-bold">Share Daily Study Target on Viewable Profile</div>
                <p className="text-[11px] text-[var(--pastel-muted)]">
                  Visible only to people who can open your profile (approved followers, or anyone if public).
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={shareStudyGoal}
              disabled={!profileLoaded}
              onClick={() => void handleToggleShareStudyGoal()}
              className={`px-4 py-1.5 rounded-full border text-xs font-bold transition-colors cursor-pointer shrink-0 disabled:opacity-50 ${
                shareStudyGoal
                  ? 'bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] border-[var(--pastel-accent)]'
                  : 'bg-[var(--pastel-surface)] text-[var(--pastel-muted)] border-[var(--pastel-border)] hover:bg-[var(--pastel-soft)]'
              }`}
            >
              {shareStudyGoal ? 'Shared' : 'Hidden'}
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <span className={`text-xs ${profileError ? 'text-red-700 font-bold' : 'text-[var(--pastel-muted)]'}`}>
              {profileError || savedNotice || (profile.email ? `Signed in as ${profile.email}` : '')}
            </span>
            <button
              type="submit"
              disabled={saving || !profileLoaded}
              className="px-5 py-2.5 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold hover:opacity-90 cursor-pointer disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        </form>
      </section>

      {/* Study Friends, Private Requests & Viewable Profiles */}
      <section className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[var(--pastel-muted)]" />
            <div>
              <h2 className="text-base font-extrabold tracking-tight">
                Study Friends &amp; Profile Viewer ({friends.length})
              </h2>
              <p className="text-xs text-[var(--pastel-muted)]">
                View profiles of learners you follow or public accounts you want to follow. Unfollowed private profiles stay locked until approved.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowProfileViewerDirectory((prev) => !prev)}
            className={`px-4 py-2 rounded-full border text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
              showProfileViewerDirectory
                ? 'bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] border-[var(--pastel-accent)]'
                : 'border-[var(--pastel-border)] bg-[var(--pastel-canvas)] hover:bg-[var(--pastel-soft)] text-[var(--pastel-ink)]'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>{showProfileViewerDirectory ? 'Hide Profile Directory' : 'View Profiles'}</span>
          </button>
        </div>

        {showProfileViewerDirectory && (
          <div className="rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-extrabold tracking-tight">
                  Viewable Study Profiles ({viewableDirectoryProfiles.length})
                </div>
                <p className="text-[11px] text-[var(--pastel-muted)]">
                  Includes everyone you follow (private or public) and public profiles you can follow. Unfollowed private accounts are excluded.
                </p>
              </div>
              <div className="flex items-center gap-1 p-1 rounded-full border border-[var(--pastel-border)] bg-[var(--pastel-surface)]">
                {(
                  [
                    { id: 'all' as const, label: 'All Viewable' },
                    { id: 'following' as const, label: 'Following' },
                    { id: 'public' as const, label: 'Public to Follow' },
                  ]
                ).map((tab) => {
                  const active = profileDirectoryFilter === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setProfileDirectoryFilter(tab.id)}
                      className={`px-3 py-1 rounded-full text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                        active
                          ? 'bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)]'
                          : 'text-[var(--pastel-muted)] hover:text-[var(--pastel-ink)]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {viewableDirectoryProfiles.length === 0 ? (
              <p className="py-5 text-center text-xs text-[var(--pastel-muted)]">
                No viewable profiles match this filter yet.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-72 overflow-y-auto pr-0.5">
                {viewableDirectoryProfiles.map((entry) => {
                  const themeMeta = PASTEL_THEMES.find((t) => t.id === entry.pastelTheme);
                  return (
                    <div
                      key={entry.uid}
                      className="p-3 rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-surface)] flex items-center justify-between gap-3"
                    >
                      <button
                        type="button"
                        onClick={() => setViewedProfileUid(entry.uid)}
                        className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer"
                      >
                        {entry.avatarUrl ? (
                          <img
                            src={entry.avatarUrl}
                            alt={entry.displayName}
                            referrerPolicy="no-referrer"
                            className="w-9 h-9 rounded-full object-cover bg-[var(--pastel-soft)] shrink-0"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-[var(--pastel-soft)] text-[var(--pastel-ink)] text-xs font-extrabold flex items-center justify-center shrink-0">
                            {getInitials(entry.displayName)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-sm font-bold truncate">{entry.displayName}</span>
                            {themeMeta && (
                              <span
                                className="w-2.5 h-2.5 rounded-full border border-black/15 shrink-0"
                                style={{ backgroundColor: themeMeta.swatch }}
                                title={`${themeMeta.label} theme`}
                              />
                            )}
                          </div>
                          <div className="text-[11px] text-[var(--pastel-muted)] truncate">
                            @{entry.handle} ·{' '}
                            {entry.isFollowing
                              ? entry.isPublic
                                ? 'Following · Public'
                                : 'Following · Private'
                              : 'Public profile'}
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setViewedProfileUid(entry.uid)}
                        className="px-3 py-1.5 rounded-full border border-[var(--pastel-border)] hover:bg-[var(--pastel-soft)] text-xs font-bold inline-flex items-center gap-1 cursor-pointer shrink-0"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>View</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <FriendRequestsView
          uid={uid}
          friends={friends}
          publicProfiles={publicProfiles}
          incomingRequests={incomingRequests}
          outgoingRequests={outgoingRequests}
          isProfilePublic={isPublic}
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Search & Add / Request Scholars */}
          <div className="space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-[var(--pastel-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={friendSearch}
                onChange={(e) => setFriendSearch(e.target.value)}
                placeholder="Search learners by name or @handle..."
                className="w-full pl-9 pr-4 py-2.5 text-sm font-semibold rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
              />
            </div>

            {friendNotice && (
              <div className="text-xs font-bold text-[var(--pastel-ink)] bg-[var(--pastel-soft)] rounded-2xl px-4 py-2">
                {friendNotice}
              </div>
            )}

            <div className="divide-y divide-[var(--pastel-border)] border border-[var(--pastel-border)] rounded-2xl px-4 max-h-72 overflow-y-auto">
              {discoverableScholars.length === 0 ? (
                <p className="py-6 text-center text-xs text-[var(--pastel-muted)]">
                  {friendSearch.trim()
                    ? matchedExistingFriend
                      ? 'That learner is already in your Study Circle.'
                      : 'No matching study profiles found.'
                    : 'No other study profiles available right now.'}
                </p>
              ) : (
                discoverableScholars.map((person) => {
                  const outgoingReq = outgoingByTargetUid.get(person.uid);
                  const incomingReq = incomingBySenderUid.get(person.uid);
                  const hasApprovedRequest =
                    outgoingReq?.status === 'accepted' || incomingReq?.status === 'accepted';
                  const canViewThisProfile = Boolean(person.isPublic);
                  const isBusy =
                    busyFriendUid === person.uid ||
                    (incomingReq ? busyRequestId === incomingReq.id : false);

                  return (
                    <div key={person.uid} className="py-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {person.avatarUrl ? (
                          <img
                            src={person.avatarUrl}
                            alt={person.displayName}
                            referrerPolicy="no-referrer"
                            className="w-9 h-9 rounded-full object-cover bg-[var(--pastel-soft)] shrink-0"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-[var(--pastel-soft)] text-[var(--pastel-ink)] text-xs font-extrabold flex items-center justify-center shrink-0">
                            {getInitials(person.displayName)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {canViewThisProfile ? (
                              <button
                                type="button"
                                onClick={() => setViewedProfileUid(person.uid)}
                                className="text-sm font-bold truncate hover:underline cursor-pointer text-left"
                              >
                                {person.displayName}
                              </button>
                            ) : (
                              <span className="text-sm font-bold truncate">{person.displayName}</span>
                            )}
                            {!person.isPublic && (
                              <Lock
                                className="w-3 h-3 text-[var(--pastel-muted)] shrink-0"
                                aria-label="Private account"
                              />
                            )}
                          </div>
                          <div className="text-xs text-[var(--pastel-muted)] truncate">
                            @{person.handle}
                            {canViewThisProfile
                              ? person.bio
                                ? ` · ${person.bio}`
                                : ''
                              : ' · Private account · Follow to view profile'}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {canViewThisProfile && (
                          <button
                            type="button"
                            onClick={() => setViewedProfileUid(person.uid)}
                            aria-label={`View ${person.displayName}'s profile`}
                            title="View public profile"
                            className="p-1.5 rounded-full border border-[var(--pastel-border)] text-[var(--pastel-muted)] hover:text-[var(--pastel-ink)] hover:bg-[var(--pastel-soft)] cursor-pointer shrink-0"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {person.isPublic || hasApprovedRequest ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleAddFriend(person)}
                            className="px-3.5 py-1.5 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold inline-flex items-center gap-1.5 hover:opacity-90 cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
                          >
                            <UserPlus className="w-3.5 h-3.5 shrink-0" />
                            <span>{isBusy ? 'Adding...' : 'Add'}</span>
                          </button>
                        ) : incomingReq?.status === 'pending' ? (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleRespondRequest(incomingReq, 'accepted')}
                              className="px-3 py-1.5 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold inline-flex items-center gap-1 hover:opacity-90 cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
                            >
                              <Check className="w-3 h-3 shrink-0" />
                              <span>Accept</span>
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleRespondRequest(incomingReq, 'declined')}
                              aria-label={`Decline request from ${person.displayName}`}
                              className="p-1.5 rounded-full border border-[var(--pastel-border)] text-[var(--pastel-muted)] hover:text-red-600 hover:bg-[var(--pastel-soft)] cursor-pointer disabled:opacity-50"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : outgoingReq?.status === 'pending' ? (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="px-3 py-1.5 rounded-full border border-[var(--pastel-border)] bg-[var(--pastel-soft)] text-[var(--pastel-muted)] text-xs font-bold inline-flex items-center gap-1 whitespace-nowrap">
                              <Clock className="w-3 h-3 shrink-0" />
                              <span>Requested</span>
                            </span>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleCancelRequest(outgoingReq)}
                              aria-label={`Cancel request to ${person.displayName}`}
                              title="Cancel request"
                              className="p-1.5 rounded-full border border-[var(--pastel-border)] text-[var(--pastel-muted)] hover:text-red-600 hover:bg-[var(--pastel-soft)] cursor-pointer disabled:opacity-50"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleSendRequest(person)}
                            className="px-3.5 py-1.5 rounded-full border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] hover:bg-[var(--pastel-soft)] text-[var(--pastel-ink)] text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
                          >
                            <UserPlus className="w-3.5 h-3.5 shrink-0" />
                            <span>
                              {isBusy
                                ? 'Sending...'
                                : outgoingReq?.status === 'declined'
                                  ? 'Request Again'
                                  : 'Request'}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Current Friends List */}
          <div className="space-y-3">
            <div className="text-xs font-bold text-[var(--pastel-muted)] pt-2">
              Your Study Circle
            </div>
            <div className="divide-y divide-[var(--pastel-border)] border border-[var(--pastel-border)] rounded-2xl px-4 max-h-72 overflow-y-auto">
              {friends.length === 0 ? (
                <p className="py-6 text-center text-xs text-[var(--pastel-muted)]">
                  You haven&apos;t added any study friends yet.
                </p>
              ) : (
                friends.map((friend) => {
                  const livePub = publicProfileByUid.get(friend.friendUid);
                  const shownName = livePub?.displayName || friend.displayName;
                  const shownHandle = livePub?.handle || friend.handle;
                  const shownAvatar = livePub?.avatarUrl ?? friend.avatarUrl;
                  const shownBio = livePub?.bio ?? friend.bio;
                  return (
                    <div key={friend.id} className="py-3 flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setViewedProfileUid(friend.friendUid)}
                        className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer group"
                      >
                        {shownAvatar ? (
                          <img
                            src={shownAvatar}
                            alt={shownName}
                            referrerPolicy="no-referrer"
                            className="w-9 h-9 rounded-full object-cover bg-[var(--pastel-soft)] shrink-0"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-[var(--pastel-soft)] text-[var(--pastel-ink)] text-xs font-extrabold flex items-center justify-center shrink-0">
                            {getInitials(shownName)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-sm font-bold truncate group-hover:underline">
                              {shownName}
                            </span>
                            {livePub && !livePub.isPublic && (
                              <Lock
                                className="w-3 h-3 text-[var(--pastel-muted)] shrink-0"
                                aria-label="Private account you follow"
                              />
                            )}
                          </div>
                          <div className="text-xs text-[var(--pastel-muted)] truncate">
                            @{shownHandle}
                            {shownBio ? ` · ${shownBio}` : ''}
                          </div>
                        </div>
                      </button>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => setViewedProfileUid(friend.friendUid)}
                          aria-label={`View ${shownName}'s profile`}
                          title="View study profile"
                          className="p-2 rounded-full text-[var(--pastel-muted)] hover:text-[var(--pastel-ink)] hover:bg-[var(--pastel-soft)] transition-colors cursor-pointer shrink-0"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={busyFriendUid === friend.friendUid}
                          onClick={() => void handleRemoveFriend(friend.friendUid)}
                          aria-label={`Remove ${shownName}`}
                          className="p-2 rounded-full text-[var(--pastel-muted)] hover:text-red-600 hover:bg-[var(--pastel-soft)] transition-colors cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Spaced Repetition Review Intervals */}
      <section className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-[var(--pastel-muted)]" />
          <div>
            <h2 className="text-base font-extrabold tracking-tight">Flashcard Review Intervals</h2>
            <p className="text-xs text-[var(--pastel-muted)]">
              Set how many days to wait before practicing a card again when marked Hard, Mid, or Easy.
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveIntervals} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <label className="space-y-1.5">
            <span className="block text-xs font-bold text-[var(--pastel-muted)]">Hard (days)</span>
            <input
              type="number"
              min={1}
              max={365}
              value={hardDays}
              onChange={(e) => setHardDays(e.target.value)}
              className="w-full px-4 py-2 text-sm font-mono-tabular rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
            />
          </label>
          <label className="space-y-1.5">
            <span className="block text-xs font-bold text-[var(--pastel-muted)]">Mid (days)</span>
            <input
              type="number"
              min={1}
              max={365}
              value={midDays}
              onChange={(e) => setMidDays(e.target.value)}
              className="w-full px-4 py-2 text-sm font-mono-tabular rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
            />
          </label>
          <label className="space-y-1.5">
            <span className="block text-xs font-bold text-[var(--pastel-muted)]">Easy (days)</span>
            <input
              type="number"
              min={1}
              max={365}
              value={easyDays}
              onChange={(e) => setEasyDays(e.target.value)}
              className="w-full px-4 py-2 text-sm font-mono-tabular rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={savingIntervals}
            className="px-5 py-2.5 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold hover:opacity-90 cursor-pointer disabled:opacity-50"
          >
            {savingIntervals ? 'Saving...' : 'Save Intervals'}
          </button>
        </form>
        {intervalsSavedMsg && (
          <p className="text-xs text-[var(--pastel-muted)]">{intervalsSavedMsg}</p>
        )}
      </section>

      {/* In-App Notifications */}
      <section className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <Bell className="w-4 h-4 text-[var(--pastel-muted)]" />
          <div>
            <h2 className="text-base font-extrabold tracking-tight">App Notifications</h2>
            <p className="text-xs text-[var(--pastel-muted)]">
              Manage in-app reminders, flashcard alerts, and completion chimes inside Pencil.
            </p>
          </div>
        </div>

        <div className="divide-y divide-[var(--pastel-border)]">
          {(
            [
              {
                key: 'taskReminders' as const,
                title: 'Task & Deadline Reminders',
                desc: 'Show task reminders and approaching deadlines in the notification bell and in-app banner.',
              },
              {
                key: 'dueFlashcards' as const,
                title: 'Due Flashcard Alerts',
                desc: 'Notify you inside the app when spaced-repetition cards are ready for review.',
              },
              {
                key: 'sessionChimes' as const,
                title: 'Completion & Reminder Chimes',
                desc: 'Play a gentle soft chime when focus blocks finish or an in-app reminder arrives.',
              },
            ]
          ).map((item) => {
            const enabled = notifSettings[item.key];
            return (
              <div
                key={item.key}
                className="py-3.5 flex items-center justify-between gap-4"
              >
                <div className="space-y-0.5">
                  <div className="text-sm font-bold">{item.title}</div>
                  <p className="text-xs text-[var(--pastel-muted)]">{item.desc}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  onClick={() => void handleToggleNotificationSetting(item.key)}
                  className={`px-4 py-1.5 rounded-full border text-xs font-bold transition-colors cursor-pointer shrink-0 ${
                    enabled
                      ? 'bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] border-[var(--pastel-accent)]'
                      : 'bg-[var(--pastel-canvas)] text-[var(--pastel-muted)] border-[var(--pastel-border)] hover:bg-[var(--pastel-soft)]'
                  }`}
                >
                  {enabled ? 'On' : 'Off'}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Study Profile Viewer Modal */}
      {viewedProfileUid && (() => {
        const pub = publicProfileByUid.get(viewedProfileUid);
        const friendLink = friendsByUid.get(viewedProfileUid);
        const isFollowing = Boolean(friendLink);
        const canView = isFollowing || Boolean(pub?.isPublic);
        const display = pub?.displayName || friendLink?.displayName || 'Study Learner';
        const handle = pub?.handle || friendLink?.handle || 'scholar';
        const avatar = pub?.avatarUrl ?? friendLink?.avatarUrl;
        const bioText = pub?.bio ?? friendLink?.bio;
        const themeMeta = PASTEL_THEMES.find((t) => t.id === (pub?.pastelTheme || 'stone'));
        const sharesGoal = pub?.shareStudyGoal !== false;
        const goalMins = pub?.dailyGoalMinutes;
        const isBusy = busyFriendUid === viewedProfileUid;

        return (
          <div
            className="fixed inset-0 z-50 bg-black/35 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={() => {
              setViewedProfileUid(null);
              setCopiedViewedHandle(false);
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl shadow-xl p-6 space-y-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3.5 min-w-0">
                  {canView && avatar ? (
                    <img
                      src={avatar}
                      alt={display}
                      referrerPolicy="no-referrer"
                      className="w-14 h-14 rounded-full object-cover border border-[var(--pastel-border)] bg-[var(--pastel-soft)] shrink-0"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-full border border-[var(--pastel-border)] bg-[var(--pastel-soft)] text-[var(--pastel-ink)] text-base font-extrabold flex items-center justify-center shrink-0">
                      {getInitials(display)}
                    </div>
                  )}
                  <div className="min-w-0 space-y-1">
                    <h3 className="text-lg font-extrabold tracking-tight truncate">{display}</h3>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--pastel-muted)]">
                      <span className="font-mono-tabular">@{handle}</span>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(`@${handle}`).then(() => {
                            setCopiedViewedHandle(true);
                            window.setTimeout(() => setCopiedViewedHandle(false), 1600);
                          });
                        }}
                        className="p-1 rounded-full hover:bg-[var(--pastel-soft)] cursor-pointer"
                        aria-label="Copy learner handle"
                      >
                        {copiedViewedHandle ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setViewedProfileUid(null);
                    setCopiedViewedHandle(false);
                  }}
                  className="p-2 rounded-full hover:bg-[var(--pastel-soft)] text-[var(--pastel-muted)] cursor-pointer shrink-0"
                  aria-label="Close profile modal"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {!canView ? (
                <div className="rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] p-5 text-center space-y-2">
                  <Lock className="w-5 h-5 mx-auto text-[var(--pastel-muted)]" />
                  <div className="text-sm font-bold">Private Study Profile</div>
                  <p className="text-xs text-[var(--pastel-muted)] leading-relaxed">
                    You can only view profiles of learners you follow or public accounts. Send a follow request and wait for approval to view this learner&apos;s study profile.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-3 py-1 rounded-full border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] text-[11px] font-bold inline-flex items-center gap-1.5">
                      {pub?.isPublic ? (
                        <Globe className="w-3 h-3" />
                      ) : (
                        <Lock className="w-3 h-3" />
                      )}
                      <span>
                        {isFollowing
                          ? pub?.isPublic
                            ? 'Following · Public Account'
                            : 'Following · Private Account'
                          : 'Public Account'}
                      </span>
                    </span>

                    {themeMeta && (
                      <span className="px-3 py-1 rounded-full border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] text-[11px] font-bold inline-flex items-center gap-1.5">
                        <span
                          className="w-3 h-3 rounded-full border border-black/15"
                          style={{ backgroundColor: themeMeta.swatch }}
                        />
                        <span>{themeMeta.label} Theme</span>
                      </span>
                    )}
                  </div>

                  <div className="rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] p-4 space-y-3">
                    <div className="space-y-1">
                      <div className="text-[11px] font-bold text-[var(--pastel-muted)]">
                        Study Focus / Bio
                      </div>
                      <p className="text-xs font-medium leading-relaxed text-[var(--pastel-ink)]">
                        {bioText?.trim() || 'No study focus added yet.'}
                      </p>
                    </div>

                    <div className="pt-2.5 border-t border-[var(--pastel-border)] flex items-center justify-between gap-3">
                      <span className="text-[11px] font-bold text-[var(--pastel-muted)]">
                        Daily Study Target
                      </span>
                      <span className="text-xs font-bold font-mono-tabular">
                        {sharesGoal && goalMins ? `${goalMins} min / day` : 'Hidden by learner'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                {isFollowing ? (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => {
                      void handleRemoveFriend(viewedProfileUid);
                      setViewedProfileUid(null);
                    }}
                    className="px-4 py-2 rounded-full border border-[var(--pastel-border)] hover:bg-[var(--pastel-soft)] text-xs font-bold text-red-600 cursor-pointer disabled:opacity-50"
                  >
                    Remove from Circle
                  </button>
                ) : (
                  pub?.isPublic && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleAddFriend(pub)}
                      className="px-4 py-2 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold inline-flex items-center gap-1.5 hover:opacity-90 cursor-pointer disabled:opacity-50"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>{isBusy ? 'Adding...' : 'Follow / Add'}</span>
                    </button>
                  )
                )}
                <button
                  type="button"
                  onClick={() => {
                    setViewedProfileUid(null);
                    setCopiedViewedHandle(false);
                  }}
                  className="px-4 py-2 rounded-full border border-[var(--pastel-border)] hover:bg-[var(--pastel-soft)] text-xs font-bold cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
