/**
 * Dirty Dozen Security Test Specification Payloads
 * All 12 adversarial payloads are strictly rejected by firestore.rules.
 */

export interface AdversarialTestCase {
  id: number;
  name: string;
  targetPath: string;
  operation: 'create' | 'get' | 'list' | 'update';
  actorUid: string;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
  enforcingRule: string;
}

export const DIRTY_DOZEN_CASES: AdversarialTestCase[] = [
  {
    id: 1,
    name: 'Identity Spoofing on Task Create',
    targetPath: '/users/userA/tasks/task_1',
    operation: 'create',
    actorUid: 'userA',
    payload: {
      ownerId: 'userB',
      title: 'Spoofed task',
      priority: 'high',
      status: 'not_started',
    },
    expectedResult: 'PERMISSION_DENIED',
    enforcingRule: 'isValidStudyTask: data.ownerId == request.auth.uid',
  },
  {
    id: 2,
    name: 'Cross-Tenant Read on Profile PII',
    targetPath: '/users/userB',
    operation: 'get',
    actorUid: 'userA',
    expectedResult: 'PERMISSION_DENIED',
    enforcingRule: 'users/{userId} allow get: isOwner(userId)',
  },
  {
    id: 3,
    name: 'Shadow Update with Ghost Field',
    targetPath: '/users/userA/tasks/task_1',
    operation: 'update',
    actorUid: 'userA',
    payload: {
      status: 'completed',
      isAdmin: true,
    },
    expectedResult: 'PERMISSION_DENIED',
    enforcingRule: 'isValidStudyTask hasOnly + affectedKeys().hasOnly',
  },
  {
    id: 4,
    name: 'Orphan Chapter Creation',
    targetPath: '/users/userA/chapters/chap_1',
    operation: 'create',
    actorUid: 'userA',
    payload: {
      ownerId: 'userA',
      subjectId: 'nonexistent_subject',
      title: 'Chapter 1',
      order: 1,
      notes: '',
      videoLectures: [],
      pdfSources: [],
    },
    expectedResult: 'PERMISSION_DENIED',
    enforcingRule: 'chapters create: exists(.../subjects/$(incoming().subjectId))',
  },
  {
    id: 5,
    name: 'Resource Poisoning via Oversized ID',
    targetPath: `/users/userA/subjects/${'a'.repeat(150)}`,
    operation: 'create',
    actorUid: 'userA',
    payload: { ownerId: 'userA', name: 'Math', color: '#8FA89B' },
    expectedResult: 'PERMISSION_DENIED',
    enforcingRule: 'isValidId(subjectId): id.size() <= 128',
  },
  {
    id: 6,
    name: 'Resource Poisoning via Oversized Title',
    targetPath: '/users/userA/tasks/task_big',
    operation: 'create',
    actorUid: 'userA',
    payload: {
      ownerId: 'userA',
      title: 'x'.repeat(5000),
      priority: 'low',
      status: 'not_started',
    },
    expectedResult: 'PERMISSION_DENIED',
    enforcingRule: 'isValidStudyTask: data.title.size() <= 200',
  },
  {
    id: 7,
    name: 'Timestamp Forgery on FocusSession',
    targetPath: '/users/userA/focusSessions/sess_1',
    operation: 'create',
    actorUid: 'userA',
    payload: {
      ownerId: 'userA',
      mode: 'timer',
      contextType: 'solo',
      durationSeconds: 1500,
      ambientSound: 'brown',
      completedAt: '2026-01-01T00:00:00Z',
      dateKey: '2026-01-01',
      createdAt: '2020-01-01T00:00:00Z',
    },
    expectedResult: 'PERMISSION_DENIED',
    enforcingRule: 'focusSessions create: incoming().createdAt == request.time',
  },
  {
    id: 8,
    name: 'Immutable Field Mutation on Flashcard',
    targetPath: '/users/userA/flashcards/card_1',
    operation: 'update',
    actorUid: 'userA',
    payload: {
      ownerId: 'userB',
      front: 'Updated Q',
    },
    expectedResult: 'PERMISSION_DENIED',
    enforcingRule: 'flashcards update: incoming().ownerId == existing().ownerId',
  },
  {
    id: 9,
    name: 'Private Room Enumeration via Unfiltered List',
    targetPath: '/focusRooms',
    operation: 'list',
    actorUid: 'userB',
    expectedResult: 'PERMISSION_DENIED',
    enforcingRule: 'focusRooms list: visibility == public || hostId == uid',
  },
  {
    id: 10,
    name: 'Private Room Unauthorized Join Without Password Proof',
    targetPath: '/focusRooms/priv_room_1/participants/userB',
    operation: 'create',
    actorUid: 'userB',
    payload: {
      uid: 'userB',
      roomId: 'priv_room_1',
      roomVisibility: 'private',
      roomHostId: 'userA',
      displayName: 'User B',
      status: 'focusing',
    },
    expectedResult: 'PERMISSION_DENIED',
    enforcingRule: 'participants create: existsAfter(.../passes/$(request.auth.uid))',
  },
  {
    id: 11,
    name: 'Focus Room Host Hijack',
    targetPath: '/focusRooms/pub_room_1',
    operation: 'update',
    actorUid: 'userB',
    payload: {
      hostId: 'userB',
      name: 'Hijacked Room',
    },
    expectedResult: 'PERMISSION_DENIED',
    enforcingRule: 'focusRooms update: existing().hostId == request.auth.uid',
  },
  {
    id: 12,
    name: 'Invalid Enum & Negative Duration Tampering',
    targetPath: '/users/userA/focusSessions/sess_neg',
    operation: 'create',
    actorUid: 'userA',
    payload: {
      ownerId: 'userA',
      mode: 'timer',
      contextType: 'solo',
      durationSeconds: -50,
      ambientSound: 'brown',
      completedAt: '2026-11-20T07:00:00Z',
      dateKey: '2026-11-20',
    },
    expectedResult: 'PERMISSION_DENIED',
    enforcingRule: 'isValidFocusSession: data.durationSeconds >= 1',
  },
];
