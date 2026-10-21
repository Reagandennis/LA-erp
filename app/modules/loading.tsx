import RouteSkeleton from '@/app/ui/route-skeleton';

// Prefetched with the sidebar link, so navigation paints instantly and the
// page streams in behind it (see node_modules/next/dist/docs: loading.js).
export default function Loading() {
  return <RouteSkeleton />;
}
