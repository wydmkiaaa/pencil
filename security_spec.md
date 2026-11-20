# Security Specification (Phase 0: Payload-First Security TDD)

## 1. Data Invariants
1. **User Ownership & PII Isolation**: `/users/{userId}` and all nested subcollections (`tasks`, `dailyGoals`, `subjects`, `chapters`, `flashcards`, `focusSessions`) are strictly isolated to `request.auth.uid == userId`. No other authenticated user may read or list another user's PII or study records.
2. **Relational Consistency**: Every `Chapter` must reference an existing `Subject` owned by the same user (`exists(.../subjects/$(incoming().subjectId))`). Every `StudyTask`, `DailyGoal`, `Subject`, `Chapter`, `Flashcard`, and `FocusSession` must set `ownerId == request.auth.uid` immutably.
3. **Private Room Password Gate**: A `FocusRoom` with `visibility == "private"` must have a non-empty `passwordHash`. Non-hosts cannot read (`get`) or list (`list`) a private room unless they have an active participant record in `/focusRooms/{roomId}/participants/{uid}`. Joining a private room requires an atomic batch creating `/focusRooms/{roomId}/passes/{uid}` where `passHash == room.passwordHash`, coupled with `existsAfter` on `/focusRooms/{roomId}/participants/{uid}`.
4. **Temporal & Volumetric Integrity**: All `createdAt` and `updatedAt` timestamps must match `request.time`. All strings, arrays (`videoLectures`, `pdfSources`), and numeric ranges are strictly bounded.
5. **No Raw PDF Storage**: Chapters store only `pdfSources` metadata (`fileName`, `pageCount`, `extractedAt`) and generated `notes` / `flashcards`—never raw PDF binaries.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Identity Spoofing on Task Create**: Authenticated user `userA` attempts to create `/users/userA/tasks/t1` with `ownerId: "userB"`. Expected: `PERMISSION_DENIED`.
2. **Cross-Tenant Read on Profile PII**: Authenticated user `userA` attempts `get` on `/users/userB`. Expected: `PERMISSION_DENIED`.
3. **Ghost Field / Shadow Update**: Authenticated user `userA` creates or updates a `StudyTask` with extra field `isAdmin: true`. Expected: `PERMISSION_DENIED`.
4. **Orphan Chapter Creation**: User `userA` creates `/users/userA/chapters/c1` referencing `subjectId: "nonexistent_subject"`. Expected: `PERMISSION_DENIED`.
5. **Resource Poisoning (Oversized ID)**: User `userA` attempts to create `/users/userA/subjects/<150-char-id>`. Expected: `PERMISSION_DENIED`.
6. **Resource Poisoning (Oversized String)**: User `userA` attempts to create a `StudyTask` with a 5,000-character `title`. Expected: `PERMISSION_DENIED`.
7. **Timestamp Forgery**: User `userA` creates a `FocusSession` with a backdated client timestamp `createdAt` instead of `serverTimestamp()`. Expected: `PERMISSION_DENIED`.
8. **Immutable Field Mutation**: User `userA` attempts to change `ownerId` or `createdAt` on an existing `Flashcard`. Expected: `PERMISSION_DENIED`.
9. **Private Room Enumeration**: User `userB` queries `/focusRooms` without filtering to `visibility == 'public'` (attempting to list `userA`'s private room). Expected: `PERMISSION_DENIED`.
10. **Private Room Unauthorized Join**: User `userB` attempts to create `/focusRooms/privRoom1/participants/userB` without a matching `/passes/userB` containing `passHash == room.passwordHash`. Expected: `PERMISSION_DENIED`.
11. **Room Hijack**: User `userB` attempts to update `/focusRooms/pubRoom1` hosted by `userA` to change `hostId` or `name`. Expected: `PERMISSION_DENIED`.
12. **Terminal Status Tampering / Invalid Enum**: User `userA` attempts to set `StudyTask.status` to `"archived"` or `FocusSession.durationSeconds` to `-50`. Expected: `PERMISSION_DENIED`.
