import { makePhotoHandlers } from '@/lib/task-assignment-photo-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const handlers = makePhotoHandlers('vehicle');
export const GET = handlers.GET;
export const POST = handlers.POST;
