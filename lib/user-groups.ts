import 'server-only';

import { Prisma } from '@prisma/client';

import { prisma } from './prisma';

/**
 * User groups, set up in Admin → Groups.
 *
 * A group is a team. Its members see the trips created or owned by any other
 * member, and may edit them on the same terms as their own — deleting a
 * member's draft and removing a member's log entries included; they may edit
 * and delete each other's handovers; and they see any to-do shared with the
 * group, including one shared before they joined. Everything else keeps its
 * own rules.
 */

export interface GroupView {
  id: number;
  name: string;
  description: string | null;
  members: Array<{ id: number; name: string; email: string; status: string }>;
  createdAt: string;
}

export class GroupError extends Error {}

/** The people who share at least one group with `userId`, the user included. */
export async function groupPeerIds(userId: number): Promise<Set<number>> {
  const rows = await prisma.userGroupMember.findMany({
    where: { group: { members: { some: { userId } } } },
    select: { userId: true },
  });
  return new Set([userId, ...rows.map((row) => row.userId)]);
}

/**
 * A Prisma filter on a user relation: that user is in a group with `userId`.
 * For a where clause on a record's creator or owner.
 */
export function inGroupWith(userId: number): Prisma.UserWhereInput {
  return { groupMemberships: { some: { group: { members: { some: { userId } } } } } };
}

/** The groups a user belongs to, for the share picker. */
export async function groupsOf(userId: number): Promise<Array<{ id: number; name: string; memberCount: number }>> {
  const rows = await prisma.userGroup.findMany({
    where: { members: { some: { userId } } },
    select: { id: true, name: true, _count: { select: { members: true } } },
    orderBy: { name: 'asc' },
  });
  return rows.map((row) => ({ id: row.id, name: row.name, memberCount: row._count.members }));
}

// --- To-dos shared with a group -----------------------------------------------

/** A to-do filter: the user's own, and those shared with them directly or through a group. */
export function todoVisibleTo(userId: number): Prisma.PersonalTodoWhereInput {
  return {
    OR: [
      { userId },
      { shares: { some: { userId } } },
      { groupShares: { some: { group: { members: { some: { userId } } } } } },
    ],
  };
}

/** Ids of to-dos shared with `userId`, directly or through one of their groups. */
export async function sharedTodoIds(userId: number): Promise<number[]> {
  const rows = await prisma.$queryRaw<Array<{ todoId: number }>>`
    SELECT "todoId" FROM "PersonalTodoShare" WHERE "userId" = ${userId}
    UNION
    SELECT gs."todoId" FROM "PersonalTodoGroupShare" gs
      JOIN "UserGroupMember" m ON m."groupId" = gs."groupId"
      WHERE m."userId" = ${userId}
  `;
  return rows.map((row) => row.todoId);
}

/** Whether a to-do is shared with `userId`, directly or through a group. */
export async function isTodoSharedWith(todoId: number, userId: number): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ todoId: number }>>`
    SELECT "todoId" FROM "PersonalTodoShare" WHERE "todoId" = ${todoId} AND "userId" = ${userId}
    UNION
    SELECT gs."todoId" FROM "PersonalTodoGroupShare" gs
      JOIN "UserGroupMember" m ON m."groupId" = gs."groupId"
      WHERE gs."todoId" = ${todoId} AND m."userId" = ${userId}
    LIMIT 1
  `;
  return rows.length > 0;
}

/**
 * Shares an owner's to-do with groups they belong to. Returns the members
 * newly able to see it (not the owner), for notifications.
 */
export async function shareTodoWithGroups(todoId: number, ownerId: number, groupIds: number[]): Promise<number[]> {
  const ids = [...new Set(groupIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) return [];
  const groups = await prisma.userGroup.findMany({
    where: { id: { in: ids }, members: { some: { userId: ownerId } } },
    select: { id: true, members: { select: { userId: true } } },
  });
  if (groups.length === 0) return [];
  const before = new Set([...(await sharedWithUserIds(todoId))]);
  await prisma.personalTodoGroupShare.createMany({
    data: groups.map((group) => ({ todoId, groupId: group.id })),
    skipDuplicates: true,
  });
  const members = new Set(groups.flatMap((group) => group.members.map((m) => m.userId)));
  return [...members].filter((id) => id !== ownerId && !before.has(id));
}

export async function unshareTodoFromGroup(todoId: number, groupId: number): Promise<void> {
  await prisma.personalTodoGroupShare.deleteMany({ where: { todoId, groupId } });
}

/** Everyone a to-do is currently shared with, directly or through a group. */
async function sharedWithUserIds(todoId: number): Promise<number[]> {
  const rows = await prisma.$queryRaw<Array<{ userId: number }>>`
    SELECT "userId" FROM "PersonalTodoShare" WHERE "todoId" = ${todoId}
    UNION
    SELECT m."userId" FROM "PersonalTodoGroupShare" gs
      JOIN "UserGroupMember" m ON m."groupId" = gs."groupId"
      WHERE gs."todoId" = ${todoId}
  `;
  return rows.map((row) => row.userId);
}

/** The groups a to-do is shared with, by id, for many to-dos at once. */
export async function todoGroupShares(todoIds: number[]): Promise<Map<number, Array<{ id: number; name: string }>>> {
  const map = new Map<number, Array<{ id: number; name: string }>>();
  if (todoIds.length === 0) return map;
  const rows = await prisma.personalTodoGroupShare.findMany({
    where: { todoId: { in: todoIds } },
    select: { todoId: true, group: { select: { id: true, name: true } } },
  });
  for (const row of rows) map.set(row.todoId, [...(map.get(row.todoId) ?? []), row.group]);
  return map;
}

// --- Admin ----------------------------------------------------------------------

const GROUP_SELECT = {
  id: true,
  name: true,
  description: true,
  createdAt: true,
  members: {
    select: { user: { select: { id: true, name: true, email: true, status: true } } },
    orderBy: { user: { name: 'asc' } },
  },
} as const satisfies Prisma.UserGroupSelect;

type GroupRow = Prisma.UserGroupGetPayload<{ select: typeof GROUP_SELECT }>;

function groupView(row: GroupRow): GroupView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    members: row.members.map((m) => m.user),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listGroups(): Promise<GroupView[]> {
  const rows = await prisma.userGroup.findMany({ select: GROUP_SELECT, orderBy: { name: 'asc' } });
  return rows.map(groupView);
}

export interface GroupInput {
  name?: unknown;
  description?: unknown;
  memberIds?: unknown;
}

async function readInput(input: GroupInput, selfId: number | null) {
  const data: { name?: string; description?: string | null } = {};
  if (selfId === null || 'name' in input) {
    const name = String(input.name ?? '').trim();
    if (!name || name.length > 60) throw new GroupError('Give the group a name (up to 60 characters).');
    const clash = await prisma.userGroup.findFirst({ where: { name: { equals: name, mode: 'insensitive' } }, select: { id: true } });
    if (clash && clash.id !== selfId) throw new GroupError(`There is already a group called ${name}.`);
    data.name = name;
  }
  if ('description' in input) data.description = String(input.description ?? '').trim().slice(0, 200) || null;
  let memberIds: number[] | null = null;
  if ('memberIds' in input) {
    if (!Array.isArray(input.memberIds)) throw new GroupError('Pick the members.');
    const wanted = [...new Set(input.memberIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    const found = await prisma.user.findMany({ where: { id: { in: wanted } }, select: { id: true } });
    memberIds = found.map((u) => u.id);
  }
  return { data, memberIds };
}

export async function createGroup(input: GroupInput): Promise<GroupView> {
  const { data, memberIds } = await readInput(input, null);
  const row = await prisma.userGroup.create({
    data: {
      name: data.name as string,
      description: data.description ?? null,
      members: memberIds?.length ? { create: memberIds.map((userId) => ({ userId })) } : undefined,
    },
    select: GROUP_SELECT,
  });
  return groupView(row);
}

export async function updateGroup(id: number, input: GroupInput): Promise<GroupView | null> {
  const existing = await prisma.userGroup.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return null;
  const { data, memberIds } = await readInput(input, id);
  const row = await prisma.$transaction(async (tx) => {
    if (memberIds) {
      await tx.userGroupMember.deleteMany({ where: { groupId: id, userId: { notIn: memberIds } } });
      await tx.userGroupMember.createMany({ data: memberIds.map((userId) => ({ groupId: id, userId })), skipDuplicates: true });
    }
    return tx.userGroup.update({ where: { id }, data, select: GROUP_SELECT });
  });
  return groupView(row);
}

export async function deleteGroup(id: number): Promise<GroupView | null> {
  const row = await prisma.userGroup.findUnique({ where: { id }, select: GROUP_SELECT });
  if (!row) return null;
  await prisma.userGroup.delete({ where: { id } });
  return groupView(row);
}
