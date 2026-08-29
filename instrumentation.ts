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
    const { listAccountsForProvider } = await import('@/lib/messaging-accounts');
    const { startTelegramMirror } = await import('@/lib/telegram');
    for (const account of await listAccountsForProvider('telegram')) {
      void startTelegramMirror(account.userId, account.id);
    }
  } catch (error) {
    console.error('[telegram] could not start mirrors:', error);
  }
}
