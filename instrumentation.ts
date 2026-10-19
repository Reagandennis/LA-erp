/**
 * Next.js server bootstrap.
 *
 * Runs once when the server process starts (not per request). This file is
 * also compiled for the Edge runtime, which has neither Node built-ins nor
 * child processes, so all real work lives in instrumentation-node.ts.
 *
 * Keep the import inside an `if (NEXT_RUNTIME === 'nodejs')` block rather than
 * an early return: the bundler replaces NEXT_RUNTIME with a constant and drops
 * the whole branch from the Edge build. After an early return webpack still
 * follows the import and fails on `crypto`, `child_process`, etc.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerNode } = await import('./instrumentation-node');
    await registerNode();
  }
}
