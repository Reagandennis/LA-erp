import 'server-only';

import { API_ACCESS } from '@/lib/api-access';
import { BULLETIN_CATEGORIES, getPost, listPosts } from '@/lib/bulletin';

import { asString, type ToolDefinition, ToolRefusal } from '../types';
import { localStamp, matches, optEnum, optFlag, pageOf, reqId } from './_shared';

/** The Bulletin Board, read only. Reading a notice here does not mark it as seen. */
const PAGE_SIZE = 20;
const HREF = '/modules/bulletin-board';
const READERS_SHOWN = 25;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

const listBulletinTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: API_ACCESS.bulletin,
  functionDeclaration: {
    name: 'list_bulletin_posts',
    description:
      'Company notices on the Bulletin Board, pinned first then newest: title, category, author, when posted, expiry, whether the user has seen it, and the opening lines. 20 per page.',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Words in the title or text, or the author' },
        category: { type: 'string', enum: [...BULLETIN_CATEGORIES] },
        unreadOnly: { type: 'boolean', description: 'Only notices the user has not seen' },
        includeExpired: { type: 'boolean', description: 'Also notices past their expiry (off the board)' },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args, ctx) {
    const q = asString(args.q);
    const category = optEnum(args, 'category', BULLETIN_CATEGORIES);
    const unreadOnly = optFlag(args, 'unreadOnly') ?? false;
    const includeExpired = optFlag(args, 'includeExpired') ?? false;
    const posts = await listPosts(ctx.userId, { includeExpired });
    const wanted = posts.filter(
      (post) =>
        (!category || post.category === category) &&
        (!unreadOnly || !post.readByMe) &&
        matches(q, post.title, post.body, post.author?.name),
    );
    const { rows, page, total, more } = pageOf(wanted, args, PAGE_SIZE);
    return {
      total,
      page,
      more,
      unread: posts.filter((post) => !post.expired && !post.readByMe).length,
      posts: rows.map((post) => ({
        id: post.id,
        title: post.title,
        category: post.category,
        ...(post.pinned ? { pinned: true } : {}),
        author: post.author?.name ?? null,
        posted: localStamp(post.createdAt, ctx.timeZone),
        ...(post.expiresAt ? { expires: localStamp(post.expiresAt, ctx.timeZone) } : {}),
        ...(post.expired ? { expired: true } : {}),
        seenByUser: post.readByMe,
        preview: clip(post.body, 160),
      })),
      href: HREF,
    };
  },
};

const getBulletinTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: API_ACCESS.bulletin,
  functionDeclaration: {
    name: 'get_bulletin_post',
    description: 'Read one Bulletin Board notice in full, with who has seen it. Does not mark it as seen.',
    parameters: {
      type: 'object',
      properties: { postId: { type: 'integer' } },
      required: ['postId'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'postId', 'use list_bulletin_posts');
    const post = await getPost(id, ctx.userId);
    if (!post) throw new ToolRefusal(`Notice ${id} was not found. Find it with list_bulletin_posts.`);
    return {
      id: post.id,
      title: post.title,
      category: post.category,
      pinned: post.pinned,
      author: post.author?.name ?? null,
      posted: localStamp(post.createdAt, ctx.timeZone),
      edited: post.updatedAt !== post.createdAt ? localStamp(post.updatedAt, ctx.timeZone) : null,
      expires: localStamp(post.expiresAt, ctx.timeZone),
      expired: post.expired,
      text: clip(post.body, 6000),
      seenByUser: post.readByMe,
      seenBy: post.readCount,
      readers: post.readers.slice(0, READERS_SHOWN).map((reader) => reader.name),
      ...(post.readers.length > READERS_SHOWN ? { readersMore: post.readers.length - READERS_SHOWN } : {}),
      timesShownIn: ctx.timeZone,
      href: HREF,
    };
  },
};

export const bulletinTools: ToolDefinition[] = [listBulletinTool, getBulletinTool];
