import 'server-only';

import { Prisma } from '@prisma/client';

import { prisma } from './prisma';

export interface UploadLimits {
  fileMb: number;
  photoMb: number;
  documentMb: number;
  audioMb: number;
  logoMb: number;
}

export type UploadLimitKey = keyof UploadLimits;

export const UPLOAD_LIMIT_MIN_MB = 1;
export const UPLOAD_LIMIT_MAX_MB = 100;

function serialize(record: UploadLimits): UploadLimits {
  return {
    fileMb: record.fileMb,
    photoMb: record.photoMb,
    documentMb: record.documentMb,
    audioMb: record.audioMb,
    logoMb: record.logoMb,
  };
}

export async function getUploadLimits(): Promise<UploadLimits> {
  const existing = await prisma.uploadLimitSettings.findUnique({ where: { id: 1 } });
  if (existing) return serialize(existing);
  // First read on a fresh database: create the singleton row. Concurrent
  // requests can race here (upsert is not atomic for a missing row), so a
  // unique-constraint failure just means another request won — read theirs.
  try {
    return serialize(await prisma.uploadLimitSettings.create({ data: { id: 1 } }));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const record = await prisma.uploadLimitSettings.findUniqueOrThrow({ where: { id: 1 } });
      return serialize(record);
    }
    throw error;
  }
}

/** Resolve one category's limit in bytes, for upload-route size checks. */
export async function getUploadLimitMb(key: UploadLimitKey): Promise<number> {
  const limits = await getUploadLimits();
  return limits[key];
}

export function mbToBytes(mb: number): number {
  return mb * 1024 * 1024;
}

export async function updateUploadLimits(
  input: UploadLimits,
  updatedById: number,
): Promise<UploadLimits> {
  const record = await prisma.uploadLimitSettings.upsert({
    where: { id: 1 },
    create: { id: 1, ...input, updatedById },
    update: { ...input, updatedById },
  });
  return serialize(record);
}
