import React, { useMemo, useState } from 'react';
import { Check, Clock, UserCheck, UserPlus, X } from 'lucide-react';
import { addFriend, cancelFriendRequest, respondToFriendRequest } from '../lib/studyRepo';
import type { FriendLink, FriendRequest, PublicProfile } from '../types/study';

export interface FriendRequestsViewProps {
  uid: string;
  friends: FriendLink[];
  publicProfiles: PublicProfile[];
  incomingRequests: FriendRequest[];
  outgoingRequests: FriendRequest[];
  isProfilePublic: boolean;
  onNotice?: (message: string | null) => void;
}

type RequestTab = 'incoming' | 'approved' | 'sent';

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return (name.trim().slice(0, 2) || 'SC').toUpperCase();
}

export const FriendRequestsView: React.FC<FriendRequestsViewProps> = ({
  uid,
  friends,
  publicProfiles,
  incomingRequests,
  outgoingRequests,
  isProfilePublic,
  onNotice,
}) => {
  const [activeTab, setActiveTab] = useState<RequestTab>('incoming');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const friendUidSet = useMemo(() => new Set(friends.map((f) => f.friendUid)), [friends]);
  const publicProfileByUid = useMemo(() => {
    const map = new Map<string, PublicProfile>();
    publicProfiles.forEach((p) => map.set(p.uid, p));
    return map;
  }, [publicProfiles]);

  const pendingIncoming = useMemo(
    () => incomingRequests.filter((r) => r.status === 'pending'),
    [incomingRequests],
  );
  const approvedIncoming = useMemo(
    () => incomingRequests.filter((r) => r.status === 'accepted'),
    [incomingRequests],
  );
  const activeOutgoing = useMemo(
    () => outgoingRequests.filter((r) => r.status !== 'accepted'),
    [outgoingRequests],
  );

  const notify = (msg: string | null) => {
    setLocalNotice(msg);
    onNotice?.(msg);
  };

  const handleRespond = async (req: FriendRequest, decision: 'accepted' | 'declined') => {
    setBusyId(req.id);
    setErrorMsg(null);
    notify(null);
    try {
      await respondToFriendRequest(req.id, decision);
      notify(
        decision === 'accepted'
          ? `Approved ${req.fromDisplayName}'s friend request. They can now join your study circle.`
          : `Declined ${req.fromDisplayName}'s friend request.`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to respond to friend request.');
    } finally {
      setBusyId(null);
    }
  };

  const handleAddApprovedRequester = async (req: FriendRequest) => {
    setBusyId(req.id);
    setErrorMsg(null);
    notify(null);
    try {
      const latestProfile = publicProfileByUid.get(req.fromUid);
      const target: PublicProfile = latestProfile || {
        uid: req.fromUid,
        handle: req.fromHandle,
        displayName: req.fromDisplayName,
        avatarUrl: req.fromAvatarUrl,
        bio: req.fromBio,
        pastelTheme: 'stone',
        isPublic: false,
      };
      await addFriend(uid, target);
      notify(`Added ${target.displayName} to your study circle.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to add friend right now.');
    } finally {
      setBusyId(null);
    }
  };

  const handleCancelOutgoing = async (req: FriendRequest) => {
    setBusyId(req.id);
    setErrorMsg(null);
    notify(null);
    try {
      await cancelFriendRequest(req.id);
      notify(`Removed request to ${req.toDisplayName}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to cancel request.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-bold text-[var(--pastel-muted)]">
          <UserCheck className="w-3.5 h-3.5 shrink-0" />
          <span>Friend Requests</span>
          <span aria-hidden="true">·</span>
          <span>{isProfilePublic ? 'Public account' : 'Private approval queue'}</span>
        </div>

        <div
          role="tablist"
          aria-label="Friend request filters"
          className="flex items-center gap-1 p-1 rounded-full border border-[var(--pastel-border)] bg-[var(--pastel-canvas)]"
        >
          {(
            [
              { id: 'incoming' as const, label: 'Incoming', count: pendingIncoming.length },
              { id: 'approved' as const, label: 'Approved', count: approvedIncoming.length },
              { id: 'sent' as const, label: 'Sent', count: activeOutgoing.length },
            ]
          ).map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setActiveTab(tab.id);
                  setErrorMsg(null);
                }}
                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[var(--pastel-accent)] ${
                  active
                    ? 'bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)]'
                    : 'text-[var(--pastel-muted)] hover:text-[var(--pastel-ink)]'
                }`}
              >
                <span>{tab.label}</span>
                <span className="ml-1.5 font-mono-tabular opacity-80">{tab.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {errorMsg && (
        <div className="text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded-2xl px-4 py-2.5">
          {errorMsg}
        </div>
      )}

      {!errorMsg && localNotice && (
        <div className="text-xs font-bold text-[var(--pastel-ink)] bg-[var(--pastel-soft)] rounded-2xl px-4 py-2.5">
          {localNotice}
        </div>
      )}

      <div className="divide-y divide-[var(--pastel-border)] border border-[var(--pastel-border)] rounded-2xl px-4 max-h-72 overflow-y-auto">
        {activeTab === 'incoming' &&
          (pendingIncoming.length === 0 ? (
            <p className="py-5 text-center text-xs text-[var(--pastel-muted)]">
              No pending friend requests right now. Requests must be approved here before learners are added to your circle.
            </p>
          ) : (
            pendingIncoming.map((req) => (
              <div key={req.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {req.fromAvatarUrl ? (
                    <img
                      src={req.fromAvatarUrl}
                      alt={req.fromDisplayName}
                      referrerPolicy="no-referrer"
                      className="w-9 h-9 rounded-full object-cover bg-[var(--pastel-soft)] shrink-0"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-[var(--pastel-soft)] text-[var(--pastel-ink)] text-xs font-extrabold flex items-center justify-center shrink-0">
                      {getInitials(req.fromDisplayName)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-bold truncate">{req.fromDisplayName}</div>
                    <div className="text-xs text-[var(--pastel-muted)] truncate">
                      @{req.fromHandle}
                      {req.fromBio ? ` · ${req.fromBio}` : ''}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={busyId === req.id}
                    onClick={() => void handleRespond(req, 'accepted')}
                    className="px-4 py-2 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold inline-flex items-center gap-1.5 hover:opacity-90 cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-[var(--pastel-accent)]"
                  >
                    <Check className="w-3.5 h-3.5 shrink-0" />
                    <span>{busyId === req.id ? 'Saving...' : 'Accept'}</span>
                  </button>
                  <button
                    type="button"
                    disabled={busyId === req.id}
                    onClick={() => void handleRespond(req, 'declined')}
                    className="px-4 py-2 rounded-full border border-[var(--pastel-border)] text-[var(--pastel-muted)] hover:text-[var(--pastel-ink)] hover:bg-[var(--pastel-soft)] text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-[var(--pastel-accent)]"
                  >
                    <X className="w-3.5 h-3.5 shrink-0" />
                    <span>Decline</span>
                  </button>
                </div>
              </div>
            ))
          ))}

        {activeTab === 'approved' &&
          (approvedIncoming.length === 0 ? (
            <p className="py-5 text-center text-xs text-[var(--pastel-muted)]">
              Accepted incoming requests appear here.
            </p>
          ) : (
            approvedIncoming.map((req) => {
              const alreadyAdded = friendUidSet.has(req.fromUid);
              return (
                <div key={req.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {req.fromAvatarUrl ? (
                      <img
                        src={req.fromAvatarUrl}
                        alt={req.fromDisplayName}
                        referrerPolicy="no-referrer"
                        className="w-9 h-9 rounded-full object-cover bg-[var(--pastel-soft)] shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-[var(--pastel-soft)] text-[var(--pastel-ink)] text-xs font-extrabold flex items-center justify-center shrink-0">
                        {getInitials(req.fromDisplayName)}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-bold truncate">{req.fromDisplayName}</div>
                      <div className="text-xs text-[var(--pastel-muted)] truncate">
                        @{req.fromHandle}
                        <span aria-hidden="true"> · </span>
                        <span>Approved</span>
                      </div>
                    </div>
                  </div>

                  {alreadyAdded ? (
                    <span className="text-xs font-bold text-[var(--pastel-muted)] whitespace-nowrap shrink-0">
                      In Study Circle
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busyId === req.id}
                      onClick={() => void handleAddApprovedRequester(req)}
                      className="px-4 py-2 rounded-full border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] hover:bg-[var(--pastel-soft)] text-[var(--pastel-ink)] text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
                    >
                      <UserPlus className="w-3.5 h-3.5 shrink-0" />
                      <span>{busyId === req.id ? 'Adding...' : 'Add Back'}</span>
                    </button>
                  )}
                </div>
              );
            })
          ))}

        {activeTab === 'sent' &&
          (activeOutgoing.length === 0 ? (
            <p className="py-5 text-center text-xs text-[var(--pastel-muted)]">
              No pending or declined outgoing requests.
            </p>
          ) : (
            activeOutgoing.map((req) => (
              <div key={req.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {req.toAvatarUrl ? (
                    <img
                      src={req.toAvatarUrl}
                      alt={req.toDisplayName}
                      referrerPolicy="no-referrer"
                      className="w-9 h-9 rounded-full object-cover bg-[var(--pastel-soft)] shrink-0"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-[var(--pastel-soft)] text-[var(--pastel-ink)] text-xs font-extrabold flex items-center justify-center shrink-0">
                      {getInitials(req.toDisplayName)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-bold truncate">{req.toDisplayName}</div>
                    <div className="text-xs text-[var(--pastel-muted)] truncate">
                      @{req.toHandle}
                      <span aria-hidden="true"> · </span>
                      <span>{req.status === 'declined' ? 'Declined' : 'Awaiting approval'}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {req.status === 'pending' && (
                    <span className="inline-flex items-center gap-1 text-xs text-[var(--pastel-muted)] whitespace-nowrap shrink-0">
                      <Clock className="w-3.5 h-3.5 shrink-0" />
                      <span>Pending</span>
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={busyId === req.id}
                    onClick={() => void handleCancelOutgoing(req)}
                    className="px-3.5 py-2 rounded-full border border-[var(--pastel-border)] text-[var(--pastel-muted)] hover:text-red-600 hover:bg-[var(--pastel-soft)] text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    <X className="w-3.5 h-3.5 shrink-0" />
                    <span>{req.status === 'declined' ? 'Dismiss' : 'Cancel'}</span>
                  </button>
                </div>
              </div>
            ))
          ))}
      </div>
    </div>
  );
};
