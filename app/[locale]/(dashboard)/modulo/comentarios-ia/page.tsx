import { requireComentariosIaContext } from '@/lib/marketing-comentarios-ia/auth';
import { getCommentPlanLimits, getCommentSettings, getCommentStats, listComments } from '@/lib/marketing-comentarios-ia/service';
import ComentariosIaModuleClient from './ComentariosIaModuleClient';

export const dynamic = 'force-dynamic';

export default async function ComentariosIAPage() {
  const ctx = await requireComentariosIaContext();
  const teamId = ctx?.teamId || 0;
  const [settings, commentsData, stats, plan] = teamId
    ? await Promise.all([
        getCommentSettings(teamId),
        listComments(teamId, new URLSearchParams('limit=20')),
        getCommentStats(teamId),
        getCommentPlanLimits(teamId),
      ])
    : [null, { comments: [], pagination: { total: 0 } }, null, null] as any;

  return (
    <ComentariosIaModuleClient
      settings={settings}
      comments={commentsData?.comments || []}
      stats={stats}
      plan={plan}
    />
  );
}
