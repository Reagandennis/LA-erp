import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { enforceRateLimit } from '@/lib/rate-limit';
import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';
import { getUploadLimitMb, mbToBytes } from '@/lib/upload-limits';

type PersonalTodoLookupClient = {
  findFirst: (args: { where: { id: number; userId: number } }) => Promise<{ id: number } | null>;
};

type AttachmentRecord = {
  id: number;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: Date;
};

type PersonalTodoAttachmentClient = {
  findMany: (args: {
    where: { todoId: number; userId: number };
    orderBy: Array<{ createdAt: 'asc' | 'desc' }>;
  }) => Promise<AttachmentRecord[]>;
  create: (args: {
    data: {
      todoId: number;
      userId: number;
      filename: string;
      mimeType: string;
      size: number;
      content: Buffer;
    };
  }) => Promise<AttachmentRecord>;
};

const personalTodoClient = (prisma as unknown as { personalTodo: PersonalTodoLookupClient }).personalTodo;
const personalTodoAttachmentClient = (
  prisma as unknown as { personalTodoAttachment: PersonalTodoAttachmentClient }
).personalTodoAttachment;

function parseTaskId(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function serializeAttachment(attachment: AttachmentRecord) {
  return {
    id: attachment.id,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    size: attachment.size,
    createdAt: attachment.createdAt.toISOString(),
  };
}

async function ensureTaskOwnership(taskId: number, userId: number) {
  const task = await personalTodoClient.findFirst({
    where: { id: taskId, userId },
  });
  return task;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.tasks);

  if (response || !auth) {
    return response;
  }

  const { taskId: rawTaskId } = await params;
  const taskId = parseTaskId(rawTaskId);

  if (!taskId) {
    return NextResponse.json({ error: 'Invalid task id' }, { status: 400 });
  }

  const task = await ensureTaskOwnership(taskId, auth.user.id);

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  const attachments = await personalTodoAttachmentClient.findMany({
    where: { todoId: taskId, userId: auth.user.id },
    orderBy: [{ createdAt: 'desc' }],
  });

  return NextResponse.json({ attachments: attachments.map(serializeAttachment) });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.tasks);

  if (response || !auth) {
    return response;
  }

  const { taskId: rawTaskId } = await params;
  const taskId = parseTaskId(rawTaskId);

  if (!taskId) {
    return NextResponse.json({ error: 'Invalid task id' }, { status: 400 });
  }

  const task = await ensureTaskOwnership(taskId, auth.user.id);

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  const rateLimit = await enforceRateLimit({
    scope: 'file.upload',
    key: `${auth.user.id}`,
    limit: 20,
    windowMs: 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: 'Too many uploads. Slow down and try again.',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      { status: 429 },
    );
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const files = formData.getAll('files');

  if (!files.length) {
    return NextResponse.json({ error: 'No files uploaded' }, { status: 400 });
  }

  const maxFileMb = await getUploadLimitMb('fileMb');
  const created: AttachmentRecord[] = [];

  for (const file of files) {
    if (!(file instanceof File)) {
      continue;
    }

    if (file.size > mbToBytes(maxFileMb)) {
      return NextResponse.json(
        { error: `"${file.name}" exceeds the ${maxFileMb} MB per-file limit` },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const record = await personalTodoAttachmentClient.create({
      data: {
        todoId: taskId,
        userId: auth.user.id,
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        content: buffer,
      },
    });

    created.push(record);
  }

  if (created.length === 0) {
    return NextResponse.json({ error: 'No valid files uploaded' }, { status: 400 });
  }

  return NextResponse.json({ attachments: created.map(serializeAttachment) }, { status: 201 });
}
