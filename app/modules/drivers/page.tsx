import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { PEOPLE_VIEWS } from '@/lib/people-views';
import { listPersonnel, listUserOptions } from '@/lib/personnel';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import PeopleDirectory from '@/app/modules/_components/people-directory';

export const dynamic = 'force-dynamic';

const view = PEOPLE_VIEWS['drivers'];

export default async function DriversPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const auth = await getServerAuth();
  if (!auth) {
    redirect('/auth/login');
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, view.slug)) {
    redirect('/dashboard');
  }

  // The licence watchlist deep-links straight onto a person.
  const { person } = await searchParams;
  const personId = Number(Array.isArray(person) ? person[0] : person);

  const [items, users] = await Promise.all([listPersonnel({ role: view.role }), listUserOptions()]);

  return (
    <PeopleDirectory
      view={view}
      isAdmin={isAdmin}
      initialItems={items}
      initialUsers={users}
      initialSelectedId={Number.isInteger(personId) && personId > 0 ? personId : null}
    />
  );
}
