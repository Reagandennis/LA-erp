'use client';

import { useEffect, useState } from 'react';

const ZONES = [
  { city: 'Nairobi',      tz: 'Africa/Nairobi' },
  { city: 'Lagos',        tz: 'Africa/Lagos' },
  { city: 'Cairo',        tz: 'Africa/Cairo' },
  { city: 'London',       tz: 'Europe/London' },
  { city: 'Paris',        tz: 'Europe/Paris' },
  { city: 'Dubai',        tz: 'Asia/Dubai' },
  { city: 'Mumbai',       tz: 'Asia/Kolkata' },
  { city: 'Singapore',    tz: 'Asia/Singapore' },
  { city: 'Tokyo',        tz: 'Asia/Tokyo' },
  { city: 'Sydney',       tz: 'Australia/Sydney' },
  { city: 'New York',     tz: 'America/New_York' },
  { city: 'Los Angeles',  tz: 'America/Los_Angeles' },
  { city: 'São Paulo',    tz: 'America/Sao_Paulo' },
];

function fmt(date: Date, tz: string) {
  return date.toLocaleTimeString('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function fmtDay(date: Date, tz: string) {
  return date.toLocaleDateString('en-GB', {
    timeZone: tz,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
}

export default function WorldClockTicker() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) {
    return <div className="ticker-bar bg-primary" />;
  }

  const chips = ZONES.map((z) => (
    <span key={z.city} className="flex items-center gap-1.5 shrink-0 px-3">
      <span className="font-semibold tracking-wide opacity-80">{z.city}</span>
      <span className="tabular-nums opacity-95">{fmt(now, z.tz)}</span>
      <span className="text-[10px] opacity-50">{fmtDay(now, z.tz)}</span>
      <span className="mx-2 opacity-30 select-none">·</span>
    </span>
  ));

  return (
    <div className="ticker-bar overflow-hidden bg-primary text-white text-xs font-mono select-none">
      {/* pause on hover via group */}
      <div className="group flex h-full items-center">
        <div className="ticker-track flex items-center group-hover:[animation-play-state:paused]">
          {chips}
          {/* duplicate for seamless loop */}
          {chips}
        </div>
      </div>
    </div>
  );
}
