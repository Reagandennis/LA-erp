function getEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getDatabaseUrl() {
  return getEnv('DATABASE_URL');
}

export function getJwtSecret() {
  return getEnv('JWT_SECRET');
}
