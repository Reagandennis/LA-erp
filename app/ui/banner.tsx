'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { AlertTriangleIcon, CheckCircleIcon, CloseIcon, InfoCircleIcon } from './icons';

export type BannerVariant = 'success' | 'error' | 'warning' | 'info';

export interface BannerOptions {
  variant?: BannerVariant;
  title: string;
  description?: string;
  /** Milliseconds before auto-dismiss. 0 keeps it until dismissed. */
  duration?: number;
}

interface BannerItem extends Required<Omit<BannerOptions, 'description'>> {
  id: string;
  description?: string;
}

interface BannerApi {
  show: (options: BannerOptions) => string;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  warning: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
  dismiss: (id: string) => void;
}

const noop = () => '';
const BannerContext = createContext<BannerApi>({
  show: noop,
  success: noop,
  error: noop,
  warning: noop,
  info: noop,
  dismiss: () => {},
});

export function useBanner() {
  return useContext(BannerContext);
}

/**
 * Opt out of the automatic banner for a single request by sending this header.
 * The interceptor strips it before the request leaves the browser.
 */
export const SILENT_BANNER_HEADER = 'x-silent-banner';

const DEFAULT_DURATION = 4000;
const ERROR_DURATION = 8000;
const MAX_VISIBLE = 4;

const VARIANT_STYLES: Record<
  BannerVariant,
  { wrap: string; icon: string; Icon: typeof CheckCircleIcon }
> = {
  success: {
    wrap: 'border-emerald-200 bg-emerald-50',
    icon: 'text-emerald-500',
    Icon: CheckCircleIcon,
  },
  error: {
    wrap: 'border-rose-200 bg-rose-50',
    icon: 'text-rose-500',
    Icon: AlertTriangleIcon,
  },
  warning: {
    wrap: 'border-amber-200 bg-amber-50',
    icon: 'text-amber-500',
    Icon: AlertTriangleIcon,
  },
  info: {
    wrap: 'border-gray-200 bg-white',
    icon: 'text-primary',
    Icon: InfoCircleIcon,
  },
};

// --- Automatic messages ---------------------------------------------------

/**
 * Endpoints that must never raise an automatic banner: polling, background
 * reads that happen to be POSTs, autosaves, and flows with their own UI.
 */
const SILENT_PATHS: RegExp[] = [
  /^\/api\/auth\//,
  /^\/api\/ai-chatbot/,
  // Every source's notification endpoint (…/notifications, …/trip-notifications):
  // read-marking is a side effect of clicking a toast, never a user-facing save.
  /notifications$/,
  /^\/api\/planning\/todo-personal\/board/,
  /^\/api\/zello\//,
  /^\/api\/(whatsapp|telegram|signal)\/(status|thread|chats|media)/,
  /^\/api\/users\/mentions/,
  /^\/api\/flight-(radar|tracker)/,
  /\/upvote$/,
];

/** Path segment → singular label, for building "X created" style messages. */
const ENTITY_LABELS: Record<string, string> = {
  tasks: 'Task',
  subtasks: 'Subtask',
  comments: 'Comment',
  attachments: 'Attachment',
  share: 'Share',
  quotes: 'Quote',
  templates: 'Template',
  'brand-profiles': 'Brand profile',
  products: 'Product',
  customers: 'Client',
  invoices: 'Invoice',
  payments: 'Payment',
  trips: 'Trip',
  items: 'Itinerary item',
  drivers: 'Driver licence',
  vehicles: 'Vehicle',
  contacts: 'Contact',
  contracts: 'Contract',
  notes: 'Note',
  sops: 'SOP',
  personnel: 'Personnel record',
  travelers: 'Traveller',
  feedback: 'Feedback',
  files: 'File',
  events: 'Event',
  intel: 'Assessment',
  handover: 'Handover',
  users: 'User',
  organization: 'Organisation settings',
  schedule: 'Schedule',
  employees: 'Employee',
  conversations: 'Conversation',
  messages: 'Message',
  'task-assignment': 'Assignment',
  log: 'Log entry',
  fuel: 'Fill-up',
  maintenance: 'Maintenance',
  trip: 'Trip',
  email: 'Test email',
  audit: 'Audit',
  highlights: 'Highlights',
  'world-clocks': 'World clocks',
  document: 'Document',
  photo: 'Photo',
  logo: 'Logo',
};

function entityFor(path: string): string | null {
  const parts = path.split('/').filter(Boolean).slice(1); // drop "api"

  // Walk from the end so /api/quotes/12/trip resolves against "trip" first.
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const segment = parts[i];
    if (/^\d+$/.test(segment)) continue;
    const label = ENTITY_LABELS[segment];
    if (label) return label;
  }
  return null;
}

/** Trailing segments that read better as a verb than as "<entity> created". */
const ACTION_VERBS: Record<string, string> = {
  send: 'sent',
  submit: 'submitted',
  duplicate: 'duplicated',
  acknowledge: 'acknowledged',
  test: 'sent',
  share: 'shared',
};

/** Trailing segments where a POST is an upload, not a creation. */
const UPLOAD_SEGMENTS = new Set(['photo', 'logo', 'document', 'attachments']);

export function describeMutation(
  method: string,
  path: string,
): { title: string } | null {
  // Only the platform's own API. A server action posts to a page URL, and
  // third-party hosts are filtered out before we get here.
  if (!path.startsWith('/api/')) return null;
  if (SILENT_PATHS.some((pattern) => pattern.test(path))) return null;

  const upper = method.toUpperCase();
  const segments = path.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? '';

  // Verb form only applies to POST: DELETE /files/1/share is an un-share, so it
  // falls through to the "<entity> deleted" wording instead.
  if (upper === 'POST' && ACTION_VERBS[last]) {
    const parent = entityFor(`/${segments.slice(0, -1).join('/')}`);
    return { title: `${parent ?? 'Item'} ${ACTION_VERBS[last]}` };
  }

  if (upper === 'POST' && UPLOAD_SEGMENTS.has(last)) {
    return { title: `${ENTITY_LABELS[last] ?? 'File'} uploaded` };
  }

  const entity = entityFor(path);

  if (upper === 'DELETE') return { title: `${entity ?? 'Item'} deleted` };
  if (upper === 'POST') return { title: `${entity ?? 'Item'} created` };
  return { title: `${entity ?? 'Changes'} saved` };
}

// --- Provider -------------------------------------------------------------

function BannerCard({
  banner,
  onDismiss,
}: Readonly<{ banner: BannerItem; onDismiss: () => void }>) {
  const style = VARIANT_STYLES[banner.variant] ?? VARIANT_STYLES.info;
  const Icon = style.Icon;

  return (
    <div
      className={`pointer-events-auto flex w-full items-start gap-3 rounded-2xl border px-4 py-3 shadow-lg ${style.wrap}`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.icon}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-gray-900">{banner.title}</p>
        {banner.description && (
          <p className="mt-0.5 break-words text-xs leading-relaxed text-gray-600">
            {banner.description}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded-lg p-1 text-gray-400 transition-colors hover:bg-black/5 hover:text-gray-700"
      >
        <CloseIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function BannerProvider({
  children,
  interceptFetch = true,
}: Readonly<{ children: ReactNode; interceptFetch?: boolean }>) {
  const [banners, setBanners] = useState<BannerItem[]>([]);
  const timers = useRef(new Map<string, number>());
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setBanners((current) => current.filter((banner) => banner.id !== id));
  }, []);

  const show = useCallback(
    (options: BannerOptions) => {
      counter.current += 1;
      const id = `banner-${counter.current}`;
      const variant = options.variant ?? 'info';
      const duration =
        options.duration ?? (variant === 'error' ? ERROR_DURATION : DEFAULT_DURATION);

      setBanners((current) => {
        // Collapse an identical banner that is already on screen rather than stacking.
        const duplicate = current.find(
          (banner) => banner.title === options.title && banner.variant === variant,
        );
        const base = duplicate
          ? current.filter((banner) => banner.id !== duplicate.id)
          : current;

        return [
          ...base,
          { id, variant, title: options.title, description: options.description, duration },
        ].slice(-MAX_VISIBLE);
      });

      if (duration > 0) {
        timers.current.set(
          id,
          window.setTimeout(() => dismiss(id), duration),
        );
      }

      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => window.clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const api = useMemo<BannerApi>(
    () => ({
      show,
      dismiss,
      success: (title, description) => show({ variant: 'success', title, description }),
      error: (title, description) => show({ variant: 'error', title, description }),
      warning: (title, description) => show({ variant: 'warning', title, description }),
      info: (title, description) => show({ variant: 'info', title, description }),
    }),
    [show, dismiss],
  );

  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  /**
   * One interception point covers every module: any mutating same-origin /api
   * call reports its outcome, so new call sites are covered without being touched.
   */
  useEffect(() => {
    if (!interceptFetch) return;

    const original = window.fetch;

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (
        init?.method ??
        (input instanceof Request ? input.method : 'GET')
      ).toUpperCase();

      const rawUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;

      let path: string | null = null;
      try {
        const url = new URL(rawUrl, window.location.origin);
        path = url.origin === window.location.origin ? url.pathname : null;
      } catch {
        path = null;
      }

      // Callers can suppress a single request's banner via a header.
      let silenced = false;
      if (init?.headers) {
        const headers = new Headers(init.headers);
        if (headers.has(SILENT_BANNER_HEADER)) {
          silenced = true;
          headers.delete(SILENT_BANNER_HEADER);
          init = { ...init, headers };
        }
      }

      const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
      const descriptor =
        !silenced && mutating && path ? describeMutation(method, path) : null;

      if (!descriptor) {
        return original(input, init);
      }

      try {
        const response = await original(input, init);

        if (response.ok) {
          apiRef.current.success(descriptor.title);
        } else {
          // Clone so the caller still receives an unread body.
          let detail: string | undefined;
          try {
            const body = (await response.clone().json()) as { error?: unknown };
            if (typeof body?.error === 'string') detail = body.error;
          } catch {
            /* not JSON */
          }
          apiRef.current.error(
            detail ?? `Request failed (${response.status})`,
            detail ? undefined : descriptor.title,
          );
        }

        return response;
      } catch (error) {
        apiRef.current.error(
          'Network error',
          `${descriptor.title} could not be completed. Check your connection and try again.`,
        );
        throw error;
      }
    };

    return () => {
      window.fetch = original;
    };
  }, [interceptFetch]);

  return (
    <BannerContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-[300] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {banners.map((banner) => (
          <BannerCard
            key={banner.id}
            banner={banner}
            onDismiss={() => dismiss(banner.id)}
          />
        ))}
      </div>
    </BannerContext.Provider>
  );
}
