import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { computeStats, listContracts } from '@/lib/contracts';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import ContractsClient from './contracts-client';

export const dynamic = 'force-dynamic';

export default async function ContractRenewalPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const auth = await getServerAuth();
  if (!auth) {
    redirect('/auth/login');
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'contract-renewal')) {
    redirect('/dashboard');
  }

  // `?open=<contractId>` deep-links straight onto a contract (e.g. from search).
  const { open } = await searchParams;
  const openId = Number(Array.isArray(open) ? open[0] : open);

  const items = await listContracts();

  return (
    <ContractsClient
      isAdmin={isAdmin}
      initialItems={items}
      initialStats={computeStats(items)}
      initialOpenId={Number.isInteger(openId) && openId > 0 ? openId : null}
    />
  );
}
