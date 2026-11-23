/**
 * lib/user-groups.ts for tests that are not about groups: nobody is in a
 * group, so every rule falls back to the person's own records. The filters
 * keep their real shape so a test can still assert on them.
 */
export const userGroupsStub = {
  groupPeerIds: async (userId: number) => new Set([userId]),
  inGroupWith: (userId: number) => ({ groupMemberships: { some: { group: { members: { some: { userId } } } } } }),
  todoVisibleTo: (userId: number) => ({
    OR: [{ userId }, { shares: { some: { userId } } }, { groupShares: { some: { group: { members: { some: { userId } } } } } }],
  }),
  groupsOf: async () => [],
  sharedTodoIds: async () => [] as number[],
  isTodoSharedWith: async () => false,
};
