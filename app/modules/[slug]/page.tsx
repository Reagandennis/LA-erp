import { redirect } from 'next/navigation';
import { getServerAuth } from '@/lib/auth';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasRole } from '@/lib/user';
import ModuleClient from './module-client';

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const auth = await getServerAuth();

  if (!auth) {
    redirect('/auth/login');
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);

  return (
    <ModuleClient 
      slug={slug} 
      isAdmin={isAdmin} 
      userName={auth.user.name} 
      userEmail={auth.user.email} 
    />
  );
}
