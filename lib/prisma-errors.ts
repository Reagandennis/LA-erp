const DATABASE_UNREACHABLE_FRAGMENT = "Can't reach database server";

interface PrismaErrorLike {
  code?: unknown;
  message?: unknown;
  name?: unknown;
}

export function isPrismaDatabaseUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as PrismaErrorLike;

  return (
    candidate.code === 'P1001' ||
    (candidate.name === 'PrismaClientInitializationError' &&
      typeof candidate.message === 'string' &&
      candidate.message.includes(DATABASE_UNREACHABLE_FRAGMENT))
  );
}
