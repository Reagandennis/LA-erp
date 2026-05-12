import 'server-only';

function getEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getOptionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();

  return value ? value : null;
}

export function getDatabaseUrl() {
  return getEnv('DATABASE_URL');
}

export function getJwtSecret() {
  return getEnv('JWT_SECRET');
}

export function getFlightRadarApiToken() {
  return getEnv('FR24_API_TOKEN');
}

export function getGeminiApiKey() {
  return getOptionalEnv('GEMINI_API_KEY') ?? getOptionalEnv('GOOGLE_API_KEY');
}

export function getGeminiModel() {
  return getOptionalEnv('GEMINI_MODEL') ?? 'gemini-3.1-flash-lite';
}
