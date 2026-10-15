/**
 * Next.js server bootstrap.
 *
 * Runs once when the server process starts (not per request). Everything here
 * is dynamically imported so this file stays free of Node-only APIs — it is
 * also compiled for the Edge runtime, which has neither `process.once` nor
 * child processes.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  try {
    const { describeWacliRuntime, ensureWacliContainer } = await import('@/lib/wacli-runtime');
    // With WACLI_CONTAINER set, wacli lives in the bundled Docker service; bring
    // it up with the app so a fresh server needs no manual `docker compose up`.
    const boot = await ensureWacliContainer();
    if (boot !== 'native') {
      console.log(`[wacli] using ${describeWacliRuntime()} (${boot}).`);
    }
  } catch (error) {
    // The sync supervisor retries with backoff, so the module recovers once
    // the container is up; until then the status endpoint reports why not.
    console.error('[wacli] container is not available:', error instanceof Error ? error.message : error);
  }

  try {
    const { installShutdownHooks, reconcileSyncProcesses } = await import('@/lib/whatsapp-sync');
    // Without this, killing the server orphans its wacli children, which keep
    // holding the store lock and block the next start.
    installShutdownHooks();
    const states = await reconcileSyncProcesses();
    if (states.length > 0) {
      console.log(`[whatsapp-sync] following ${states.length} linked account(s).`);
    }
  } catch (error) {
    // A failure here must never stop the app from serving.
    console.error('[whatsapp-sync] could not start sync processes:', error);
  }

  try {
    const { reconcileIngest } = await import('@/lib/messaging-ingest');
    const started = await reconcileIngest();
    if (started.signal || started.whatsapp) {
      console.log(
        `[messaging-ingest] signal=${started.signal} whatsapp=${started.whatsapp} account(s).`,
      );
    }
  } catch (error) {
    console.error('[messaging-ingest] could not start ingest loops:', error);
  }

  try {
    const { scheduleMaintenance } = await import('@/lib/maintenance');
    // Keeps the Session and RateLimitBucket tables from growing without bound.
    scheduleMaintenance();
  } catch (error) {
    console.error('[maintenance] could not schedule housekeeping:', error);
  }

  try {
    const { listAccountsForProvider } = await import('@/lib/messaging-accounts');
    const { startTelegramMirror } = await import('@/lib/telegram');
    for (const account of await listAccountsForProvider('telegram')) {
      void startTelegramMirror(account.userId, account.id);
    }
  } catch (error) {
    console.error('[telegram] could not start mirrors:', error);
  }
}
