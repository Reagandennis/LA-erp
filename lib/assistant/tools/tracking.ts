import 'server-only';

import { listTrackedDevices } from '@/lib/tracked-devices';

import { asString, type ToolDefinition } from '../types';
import { localStamp, matches, optFlag, pageOf } from './_shared';

/**
 * The Map module's live trackers (Traccar and Zello), read only: the same list
 * /api/map/devices gives the map, behind the same grant. The map's layers,
 * geofences and drawings are left on the page: they are geometry, not answers.
 */
const MAP_MODULE = 'map';
const PAGE_SIZE = 20;
/** A fix older than this is called out, as the map greys a stale tracker. */
const STALE_MINUTES = 30;

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

const listTrackedDevicesTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: MAP_MODULE,
  functionDeclaration: {
    name: 'list_tracked_devices',
    description:
      'Tracked vehicles, radios and phones from the Map, with each one\'s last known position: coordinates, address where known, when the fix was taken and how old it is, speed, battery, online or not. Search by name. 20 per page.',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Device name, tracker id or category' },
        onlineOnly: { type: 'boolean', description: 'Leave out trackers reporting offline' },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args, ctx) {
    const q = asString(args.q);
    const onlineOnly = optFlag(args, 'onlineOnly') ?? false;
    const { devices, sources } = await listTrackedDevices();
    const now = Date.now();
    const wanted = devices.filter(
      (device) => (!onlineOnly || device.online !== false) && matches(q, device.name, device.uniqueId, device.category),
    );
    const { rows, page, total, more } = pageOf(wanted, args, PAGE_SIZE);
    const configured = Object.values(sources).some((source) => source.configured);
    const problems = Object.entries(sources)
      .filter(([, source]) => source.configured && source.error)
      .map(([name, source]) => `${name}: ${source.error}`);
    return {
      total,
      page,
      more,
      devices: rows.map((device) => {
        const minutesAgo = Math.max(0, Math.round((now - device.at) / 60_000));
        return {
          name: device.name,
          source: device.source,
          ...(device.category ? { category: device.category } : {}),
          lat: round(device.lat, 5),
          lon: round(device.lon, 5),
          ...(device.address ? { address: device.address } : {}),
          lastFix: localStamp(new Date(device.at).toISOString(), ctx.timeZone),
          minutesAgo,
          ...(minutesAgo > STALE_MINUTES ? { stale: true } : {}),
          ...(device.speedKph !== undefined ? { speedKph: Math.round(device.speedKph) } : {}),
          ...(device.batteryPct !== undefined ? { batteryPct: Math.round(device.batteryPct) } : {}),
          ...(device.online !== undefined ? { online: device.online } : {}),
        };
      }),
      ...(!configured ? { note: 'No tracking source (Traccar or Zello) is set up, so there are no positions.' } : {}),
      // A source that is down must not read as "nobody is out": say which one failed.
      ...(problems.length > 0 ? { sourceProblems: problems } : {}),
      ...(configured && total === 0 && q ? { note: `No tracker matches "${q}".` } : {}),
      timesShownIn: ctx.timeZone,
      href: '/modules/map',
    };
  },
};

export const trackingTools: ToolDefinition[] = [listTrackedDevicesTool];
