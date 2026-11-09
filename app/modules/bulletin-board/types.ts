// Shared types for the Bulletin Board module (mirror lib/bulletin.ts).

export const BULLETIN_CATEGORIES = ['Announcement', 'Notice', 'Safety', 'Event', 'Policy', 'Reminder'] as const;
export type BulletinCategory = (typeof BULLETIN_CATEGORIES)[number];

export const TITLE_MAX = 160;

export type BulletinAuthor = { id: number; name: string };

export type BulletinPostSummary = {
  id: number;
  title: string;
  body: string;
  category: string;
  pinned: boolean;
  expiresAt: string | null;
  expired: boolean;
  createdAt: string;
  updatedAt: string;
  author: BulletinAuthor | null;
  readCount: number;
  readByMe: boolean;
};

export type BulletinReader = { id: number; name: string; readAt: string };

export type BulletinPostDetail = BulletinPostSummary & { readers: BulletinReader[] };

export type BulletinStats = {
  unread: number;
  pinned: number;
  active: number;
  thisWeek: number;
};

export type BulletinData = {
  posts: BulletinPostSummary[];
  stats: BulletinStats;
};
