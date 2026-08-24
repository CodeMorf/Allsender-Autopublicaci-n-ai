import 'server-only';
import { getTeamForUser, getUser } from '@/lib/db/queries';

export async function requireAutopublishContext() {
  const [team, user] = await Promise.all([getTeamForUser(), getUser()]);
  if (!team || !user) return null;
  return { team, user, teamId: Number((team as any).id), userId: Number((user as any).id) };
}
