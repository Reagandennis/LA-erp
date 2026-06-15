import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { userHasModule, userHasRole } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Issues a Zello Channels API auth token (a JWT signed with your Zello developer
 * private key) so the browser never sees the private key.
 *
 * Configure via environment variables:
 *   ZELLO_ISSUER       — your Zello API key / issuer
 *   ZELLO_PRIVATE_KEY  — the RS256 private key (PEM; use \n for newlines in .env)
 *   ZELLO_NETWORK      — (optional) default Zello Work network name
 *   ZELLO_CHANNEL      — (optional) default channel name
 *
 * If the issuer/key aren't set, `configured` is false and the console falls back
 * to a manually-pasted token or Zello Work username/password auth.
 */
export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!userHasRole(auth.user, ADMIN_ROLE_NAME) && !userHasModule(auth.user, 'radio-zello')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const issuer = process.env.ZELLO_ISSUER?.trim();
  const privateKey = process.env.ZELLO_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const network = process.env.ZELLO_NETWORK?.trim() ?? '';
  const channel = process.env.ZELLO_CHANNEL?.trim() ?? '';

  if (!issuer || !privateKey) {
    return NextResponse.json({ configured: false, token: null, network, channel });
  }

  try {
    const token = jwt.sign({ iss: issuer }, privateKey, { algorithm: 'RS256', expiresIn: '6h' });
    return NextResponse.json({ configured: true, token, network, channel });
  } catch {
    return NextResponse.json(
      { configured: false, token: null, network, channel, error: 'Could not sign Zello token — check ZELLO_PRIVATE_KEY.' },
      { status: 500 },
    );
  }
}
