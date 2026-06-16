import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { userHasModule, userHasRole } from '@/lib/user';
import { getZelloLocations } from '@/lib/zello-work';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

type AuthUser = Parameters<typeof userHasRole>[0];
function canUse(user: AuthUser): boolean {
  return userHasRole(user, ADMIN_ROLE_NAME) || userHasModule(user, 'radio-zello');
}

/**
 * Latest known position of every device.
 *
 * When a Zello Work network is configured (ZELLO_* env), this pulls the same
 * server-stored last-known positions the Zello Work web map shows, via the
 * `location/get` Server API — so devices appear even if they aren't transmitting
 * on the channel right now. Those positions are persisted, then returned.
 *
 * Without Zello Work configured (consumer Zello), it falls back to positions
 * captured live from the channel's `on_location` events and stored per channel.
 */
export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!canUse(auth.user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const channel = (searchParams.get('channel') ?? '').trim();
  const network = (searchParams.get('network') ?? '').trim();

  // Prefer the Zello Work server's stored locations (network-wide, like the Zello map).
  const live = await getZelloLocations();
  if (live.configured && !live.error) {
    const stamp = network || (process.env.ZELLO_NETWORK ?? '').trim();
    const channelKey = channel || 'all';
    await Promise.all(
      live.devices.map((d) =>
        prisma.zelloDeviceLocation.upsert({
          where: { network_channel_device: { network: stamp, channel: channelKey, device: d.device } },
          create: {
            network: stamp,
            channel: channelKey,
            device: d.device,
            latitude: d.latitude,
            longitude: d.longitude,
            accuracy: d.accuracy,
            address: null,
            at: new Date(d.at),
          },
          update: { latitude: d.latitude, longitude: d.longitude, accuracy: d.accuracy, at: new Date(d.at) },
        }),
      ),
    );
    return NextResponse.json({ devices: live.devices, source: 'zellowork', total: live.total });
  }

  // Consumer Zello / not configured: serve positions captured live on this channel.
  if (!channel) return NextResponse.json({ devices: [], source: 'stored', error: live.error ?? undefined });
  const devices = await prisma.zelloDeviceLocation.findMany({
    where: { network, channel },
    orderBy: { at: 'desc' },
    take: 500,
  });
  return NextResponse.json({ devices, source: 'stored', error: live.error ?? undefined });
}

/** Upsert one device's latest position. */
export async function POST(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!canUse(auth.user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'bad-request' }, { status: 400 });

  const channel = String(body.channel ?? '').trim();
  const device = String(body.device ?? body.from ?? '').trim();
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  if (!channel || !device || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const network = String(body.network ?? '').trim();
  const accuracy = Number(body.accuracy);
  const acc = Number.isFinite(accuracy) ? accuracy : null;
  const address = body.address ? String(body.address).slice(0, 300) : null;
  const at = new Date(typeof body.at === 'number' ? body.at : Date.now());

  await prisma.zelloDeviceLocation.upsert({
    where: { network_channel_device: { network, channel, device } },
    create: { network, channel, device, latitude, longitude, accuracy: acc, address, at },
    update: { latitude, longitude, accuracy: acc, address, at },
  });
  return NextResponse.json({ ok: true });
}
