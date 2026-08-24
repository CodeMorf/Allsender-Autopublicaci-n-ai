'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  Clock,
  Edit3,
  ExternalLink,
  Loader2,
  MessageCircle,
  MessageSquareReply,
  PauseCircle,
  RotateCcw,
  Save,
  Settings,
  Sparkles,
  ThumbsUp,
  X,
  Zap,
} from 'lucide-react';

type CommentItem = {
  id: number;
  platform: string;
  status: string;
  authorUsername?: string | null;
  commentText: string;
  aiReply?: string | null;
  action?: string | null;
  createdAt?: string | null;
  metadata?: Record<string, any>;
};

type Account = { id: number; platform: string; displayName?: string | null; username?: string | null };

type Props = {
  settings: any;
  comments: CommentItem[];
  stats: any;
  plan: any;
};

const statusLabel: Record<string, string> = {
  answered: 'respondido',
  generated: 'listo para revisar',
  approved: 'aprobado',
  pending: 'pendiente',
  received: 'recibido',
  ignored: 'ignorado',
  needs_human: 'requiere revision',
  needs_setup: 'pendiente de conexion',
  pending_connection: 'conexion pendiente',
  failed: 'fallido',
};

function commercialStatus(status: string, action?: string | null) {
  if (action === 'self_reply_loop_guard') return 'Respuesta propia ignorada';
  if (action === 'channel_permission_required') return 'Requiere reconectar el canal';
  if (status === 'pending_connection' || status === 'needs_setup') return 'Conexion pendiente';
  if (status === 'failed') return 'No se pudo publicar la respuesta';
  return statusLabel[status] || status || 'pendiente';
}

function StatusBadge({ status, action }: { status: string; action?: string | null }) {
  const map: Record<string, string> = {
    answered: 'bg-emerald-100 text-emerald-700',
    generated: 'bg-blue-100 text-blue-700',
    approved: 'bg-violet-100 text-violet-700',
    pending: 'bg-amber-100 text-amber-700',
    received: 'bg-amber-100 text-amber-700',
    ignored: 'bg-slate-100 text-slate-600',
    needs_human: 'bg-orange-100 text-orange-700',
    needs_setup: 'bg-orange-100 text-orange-700',
    pending_connection: 'bg-orange-100 text-orange-700',
    failed: 'bg-red-100 text-red-700',
  };
  const tone = action === 'channel_permission_required' ? map.failed : action === 'self_reply_loop_guard' ? map.ignored : map[status] || map.pending;
  return <span className={`rounded-full px-3 py-1 text-xs font-black ${tone}`}>{commercialStatus(status, action)}</span>;
}

function strategyName(settings: any) {
  if (settings?.algorithm === 'smart_ai') return 'IA inteligente';
  if (settings?.algorithm === 'product_link') return 'Productos';
  return 'WhatsApp directo';
}

function baseStats(stats: any, comments: CommentItem[]) {
  return {
    total: Number(stats?.total ?? comments.length ?? 0),
    answered: Number(stats?.answered ?? comments.filter((c) => c.status === 'answered').length),
    pending: Number((stats?.pending || 0) + (stats?.generated || 0) + (stats?.received || 0)),
    failed: Number(stats?.failed || comments.filter((c) => c.status === 'failed').length),
    clicks: Number(stats?.linkClicks || 0),
  };
}

function splitList(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export default function ComentariosIaModuleClient({ settings, comments: initialComments, stats, plan }: Props) {
  const [comments, setComments] = useState<CommentItem[]>(initialComments || []);
  const [statsState, setStatsState] = useState<any>(stats || {});
  const [currentSettings, setCurrentSettings] = useState(settings || {});
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [notice, setNotice] = useState('');
  const [resettingClicks, setResettingClicks] = useState(false);
  const [draftReplies, setDraftReplies] = useState<Record<number, string>>({});
  const [settingsForm, setSettingsForm] = useState({
    enabled: Boolean(settings?.enabled),
    mode: settings?.mode || 'manual_review',
    algorithm: settings?.algorithm || 'smart_ai',
    tone: settings?.tone || 'profesional',
    language: settings?.language || 'es',
    approvalRequired: Boolean(settings?.approvalRequired ?? true),
    autoReplyPublic: Boolean(settings?.autoReplyPublic),
    autoDm: Boolean(settings?.autoDm),
    keywords: Array.isArray(settings?.metadata?.keywords) ? settings.metadata.keywords.join(', ') : '',
    blockedWords: Array.isArray(settings?.blockedWords) ? settings.blockedWords.join(', ') : '',
    businessPrompt: settings?.businessPrompt || settings?.baseInstructions || '',
    selectedAccounts: Array.isArray(settings?.metadata?.selectedAccounts) ? settings.metadata.selectedAccounts : [],
  });
  const computed = useMemo(() => baseStats(statsState, comments), [statsState, comments]);
  const isReady = Boolean(currentSettings?.enabled);

  useEffect(() => {
    fetch('/api/marketing/autopublicar/accounts', { cache: 'no-store' })
      .then((r) => r.json())
      .then((json) => setAccounts(Array.isArray(json.accounts) ? json.accounts : []))
      .catch(() => setAccounts([]));
  }, []);

  function updateLocal(id: number, patch: Partial<CommentItem>) {
    setComments((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  async function readJson(response: Response) {
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.status === false) {
      throw new Error(json.message || 'No se pudo completar la accion.');
    }
    return json;
  }

  async function saveSettings(patch?: Partial<typeof settingsForm>) {
    const next = { ...settingsForm, ...(patch || {}) };
    setSettingsForm(next);
    setSavingSettings(true);
    setNotice('');
    try {
      const response = await fetch('/api/marketing/comentarios-ia/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: next.enabled,
          mode: next.mode,
          algorithm: next.algorithm,
          tone: next.tone,
          language: next.language,
          approvalRequired: next.approvalRequired,
          autoReplyPublic: next.autoReplyPublic,
          autoDm: next.autoDm,
          blockedWords: splitList(next.blockedWords),
          businessPrompt: next.businessPrompt,
          baseInstructions: next.businessPrompt,
          metadata: {
            ...(currentSettings?.metadata || {}),
            keywords: splitList(next.keywords),
            selectedAccounts: next.selectedAccounts,
            updatedFromModule: true,
          },
        }),
      });
      const json = await readJson(response);
      setCurrentSettings(json.settings || {});
      setNotice(next.enabled ? 'Comentarios IA actualizado correctamente.' : 'Comentarios IA pausado correctamente.');
    } catch (error: any) {
      setNotice(error?.message || 'No se pudo guardar la configuracion.');
    } finally {
      setSavingSettings(false);
    }
  }

  async function generate(comment: CommentItem) {
    setBusyId(comment.id);
    setNotice('');
    try {
      const response = await fetch('/api/marketing/comentarios-ia/generate-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId: comment.id, commentText: comment.commentText, algorithm: settingsForm.algorithm }),
      });
      const json = await readJson(response);
      updateLocal(comment.id, { aiReply: json.reply, status: json.needsHuman ? 'needs_human' : 'generated' });
      setDraftReplies((current) => ({ ...current, [comment.id]: json.reply || '' }));
      setNotice('Respuesta generada correctamente.');
      return json.reply || '';
    } catch (error: any) {
      setNotice(error?.message || 'No se pudo generar la respuesta.');
      return '';
    } finally {
      setBusyId(null);
    }
  }

  async function approveAndSend(comment: CommentItem) {
    setBusyId(comment.id);
    setNotice('');
    try {
      let reply = draftReplies[comment.id] || comment.aiReply || '';
      if (!reply) reply = await generate(comment);
      if (!reply) throw new Error('No hay respuesta para enviar.');
      const response = await fetch(`/api/marketing/comentarios-ia/comments/${comment.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply, sendNow: true, privateReply: settingsForm.autoDm }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json.status === false) {
        updateLocal(comment.id, { aiReply: reply, status: json.code === 'MISSING_ZERNIO_IDS' ? 'needs_setup' : 'failed', action: json.code === 'RECONNECT_CHANNEL_REQUIRED' ? 'channel_permission_required' : comment.action });
        throw new Error(json.message || 'No se pudo publicar la respuesta.');
      }
      updateLocal(comment.id, { aiReply: reply, status: 'answered' });
      setNotice('Respuesta enviada correctamente.');
    } catch (error: any) {
      setNotice(error?.message || 'No se pudo responder.');
    } finally {
      setBusyId(null);
    }
  }

  async function ignore(comment: CommentItem, needsHuman = false) {
    setBusyId(comment.id);
    setNotice('');
    try {
      const response = await fetch(`/api/marketing/comentarios-ia/comments/${comment.id}/ignore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: needsHuman ? 'needs_human_review' : 'ignored_from_dashboard', needsHuman }),
      });
      await readJson(response);
      updateLocal(comment.id, { status: needsHuman ? 'needs_human' : 'ignored' });
      setNotice(needsHuman ? 'Comentario marcado para revision.' : 'Comentario ignorado.');
    } catch (error: any) {
      setNotice(error?.message || 'No se pudo actualizar el comentario.');
    } finally {
      setBusyId(null);
    }
  }

  async function resetClicks() {
    if (resettingClicks) return;
    const ok = window.confirm('Resetear el contador de clicks reales?');
    if (!ok) return;
    setResettingClicks(true);
    setNotice('');
    try {
      const response = await fetch('/api/marketing/comentarios-ia/clicks/reset', { method: 'POST' });
      await readJson(response);
      setStatsState((current: any) => ({ ...(current || {}), linkClicks: 0, rawLinkClicks: 0 }));
      setNotice('Clicks reiniciados correctamente.');
    } catch (error: any) {
      setNotice(error?.message || 'No se pudieron reiniciar los clicks.');
    } finally {
      setResettingClicks(false);
    }
  }

  function toggleAccount(accountId: number) {
    const current = settingsForm.selectedAccounts;
    const selectedAccounts = current.includes(accountId) ? current.filter((id: number) => id !== accountId) : [...current, accountId];
    setSettingsForm({ ...settingsForm, selectedAccounts });
  }

  return (
    <div className="min-h-screen overflow-auto bg-slate-50 px-4 py-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-3xl border bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-yellow-100 px-3 py-1 text-xs font-black text-yellow-800">
                <Sparkles className="h-4 w-4" /> Marketing conversacional
              </div>
              <h1 className="text-3xl font-black text-slate-950">Comentarios IA</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">Responde comentarios de redes conectadas con reglas, productos e IA segun la configuracion del negocio.</p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs font-black">
                <span className={`rounded-full px-3 py-1 ${isReady ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{isReady ? 'Activo' : 'Pausado'}</span>
                <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-700">Estrategia: {strategyName(currentSettings)}</span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">Plan: {plan?.planName || 'Actual'}</span>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                onClick={() => saveSettings({ enabled: !settingsForm.enabled })}
                disabled={savingSettings}
                className={`inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-black ${settingsForm.enabled ? 'bg-slate-950 text-white' : 'bg-yellow-500 text-slate-950'} disabled:opacity-60`}
              >
                {savingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : settingsForm.enabled ? <PauseCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                {settingsForm.enabled ? 'Pausar automatizacion' : 'Activar automatizacion'}
              </button>
              <a href="/es/modulo/comentarios-ia/link-whatsapp" className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 px-5 py-3 text-sm font-black text-slate-950 hover:bg-amber-300">
                <MessageCircle className="h-4 w-4" /> WhatsApp y link
              </a>
              <a href="/es/modulo/autopublicar" className="inline-flex items-center justify-center gap-2 rounded-xl border bg-white px-5 py-3 text-sm font-black text-slate-900 hover:bg-slate-50">
                <ExternalLink className="h-4 w-4" /> Ver publicaciones
              </a>
            </div>
          </div>
          {notice ? <div className="mt-5 rounded-2xl border bg-amber-50 p-4 text-sm font-bold text-amber-900">{notice}</div> : null}
        </section>

        <section className="grid gap-4 md:grid-cols-5">
          <div className="rounded-3xl border bg-white p-5 shadow-sm"><div className="flex items-center gap-3 text-slate-500"><MessageCircle className="h-5 w-5" /> Recibidos</div><p className="mt-2 text-3xl font-black">{computed.total}</p></div>
          <div className="rounded-3xl border bg-white p-5 shadow-sm"><div className="flex items-center gap-3 text-slate-500"><ThumbsUp className="h-5 w-5" /> Respondidos</div><p className="mt-2 text-3xl font-black">{computed.answered}</p></div>
          <div className="rounded-3xl border bg-white p-5 shadow-sm"><div className="flex items-center gap-3 text-slate-500"><Clock className="h-5 w-5" /> Pendientes</div><p className="mt-2 text-3xl font-black">{computed.pending}</p></div>
          <div className="rounded-3xl border bg-white p-5 shadow-sm"><div className="flex items-center gap-3 text-slate-500"><X className="h-5 w-5" /> Fallidos</div><p className="mt-2 text-3xl font-black">{computed.failed}</p></div>
          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 text-slate-500"><Zap className="h-5 w-5" /> Clicks reales</div>
              <button type="button" onClick={resetClicks} disabled={resettingClicks} className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-black text-slate-600 hover:bg-slate-50 disabled:opacity-60">
                {resettingClicks ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />} Reset
              </button>
            </div>
            <p className="mt-2 text-3xl font-black">{computed.clicks}</p>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[420px_1fr]">
          <div className="space-y-6">
            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2 text-lg font-black"><Settings className="h-5 w-5" /> Configuracion</div>
              <div className="space-y-4">
                <label className="block text-sm font-bold">Tono de respuesta</label>
                <select value={settingsForm.tone} onChange={(e) => setSettingsForm({ ...settingsForm, tone: e.target.value })} className="w-full rounded-2xl border px-4 py-3 text-sm outline-none">
                  <option value="profesional">Profesional</option>
                  <option value="amigable">Amigable</option>
                  <option value="comercial">Comercial</option>
                  <option value="rapido">Rapido</option>
                  <option value="formal">Formal</option>
                </select>

                <label className="block text-sm font-bold">Modo de trabajo</label>
                <select value={settingsForm.mode} onChange={(e) => setSettingsForm({ ...settingsForm, mode: e.target.value })} className="w-full rounded-2xl border px-4 py-3 text-sm outline-none">
                  <option value="manual_review">Revisar antes de responder</option>
                  <option value="automatic">Responder automaticamente</option>
                </select>

                <label className="block text-sm font-bold">Estrategia</label>
                <select value={settingsForm.algorithm} onChange={(e) => setSettingsForm({ ...settingsForm, algorithm: e.target.value })} className="w-full rounded-2xl border px-4 py-3 text-sm outline-none">
                  <option value="smart_ai">IA inteligente</option>
                  <option value="product_link">Productos</option>
                  <option value="whatsapp_direct">WhatsApp directo</option>
                </select>

                <div className="grid gap-2">
                  <label className="inline-flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold"><input type="checkbox" checked={settingsForm.approvalRequired} onChange={(e) => setSettingsForm({ ...settingsForm, approvalRequired: e.target.checked })} /> Requiere aprobacion</label>
                  <label className="inline-flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold"><input type="checkbox" checked={settingsForm.autoReplyPublic} onChange={(e) => setSettingsForm({ ...settingsForm, autoReplyPublic: e.target.checked })} /> Responder publico</label>
                  <label className="inline-flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold"><input type="checkbox" checked={settingsForm.autoDm} onChange={(e) => setSettingsForm({ ...settingsForm, autoDm: e.target.checked })} /> Responder privado cuando aplique</label>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-bold">Palabras clave para responder</label>
                  <input value={settingsForm.keywords} onChange={(e) => setSettingsForm({ ...settingsForm, keywords: e.target.value })} placeholder="precio, disponible, informacion" className="w-full rounded-2xl border px-4 py-3 text-sm outline-none" />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-bold">Palabras que requieren revision</label>
                  <input value={settingsForm.blockedWords} onChange={(e) => setSettingsForm({ ...settingsForm, blockedWords: e.target.value })} placeholder="queja, reclamo, cancelar" className="w-full rounded-2xl border px-4 py-3 text-sm outline-none" />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-bold">Instrucciones del negocio</label>
                  <textarea value={settingsForm.businessPrompt} onChange={(e) => setSettingsForm({ ...settingsForm, businessPrompt: e.target.value })} placeholder="Describe como debe responder la marca." className="min-h-28 w-full rounded-2xl border px-4 py-3 text-sm outline-none" />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-bold">Canales activos</label>
                  <div className="space-y-2">
                    {accounts.length === 0 ? <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Conecta tu primer canal.</p> : accounts.map((account) => (
                      <button key={account.id} onClick={() => toggleAccount(account.id)} className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm ${settingsForm.selectedAccounts.includes(account.id) ? 'border-emerald-300 bg-emerald-50' : 'bg-white'}`}>
                        <span><b>{account.displayName || account.username || account.platform}</b><br /><span className="text-xs text-slate-500">{account.platform}</span></span>
                        {settingsForm.selectedAccounts.includes(account.id) ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : null}
                      </button>
                    ))}
                  </div>
                </div>

                <button onClick={() => saveSettings()} disabled={savingSettings} className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:opacity-60">
                  {savingSettings ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Guardar configuracion
                </button>
              </div>
            </div>
          </div>

          <section className="rounded-3xl border bg-white shadow-sm">
            <div className="flex flex-col gap-2 border-b px-6 py-4 md:flex-row md:items-center md:justify-between">
              <div className="font-black">Historial de comentarios</div>
              <div className="text-xs text-slate-500">Revision, edicion y respuesta automatica</div>
            </div>
            {comments.length === 0 ? (
              <div className="p-10 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-yellow-100 text-yellow-700"><MessageSquareReply className="h-7 w-7" /></div>
                <h3 className="text-lg font-black text-slate-950">No hay comentarios todavia</h3>
                <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">Cuando una publicacion reciba comentarios, apareceran aqui para responder con IA o revisar antes de enviar.</p>
              </div>
            ) : (
              <div className="divide-y">
                {comments.map((comment) => {
                  const busy = busyId === comment.id;
                  const replyDraft = draftReplies[comment.id] ?? comment.aiReply ?? '';
                  return (
                    <article key={comment.id} className="p-5">
                      <div className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black uppercase text-slate-600">{comment.platform}</span>
                          <StatusBadge status={comment.status} action={comment.action} />
                          <span className="text-xs text-slate-400">{comment.createdAt?.slice(0, 19)}</span>
                        </div>
                        <p className="text-sm font-bold text-slate-900">{comment.authorUsername || 'Usuario'}</p>
                        <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">{comment.commentText}</p>
                        <div>
                          <label className="mb-2 flex items-center gap-2 text-xs font-black uppercase text-slate-500"><Edit3 className="h-3 w-3" /> Respuesta</label>
                          <textarea value={replyDraft} onChange={(e) => setDraftReplies((current) => ({ ...current, [comment.id]: e.target.value }))} placeholder="Genera o escribe una respuesta..." className="min-h-24 w-full rounded-2xl border px-4 py-3 text-sm outline-none" />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => generate(comment)} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-black text-slate-700 disabled:opacity-60">{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bot className="h-3 w-3" />} Generar</button>
                          <button onClick={() => approveAndSend(comment)} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white disabled:opacity-60">{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} Responder</button>
                          <button onClick={() => ignore(comment, true)} disabled={busy} className="rounded-xl border px-3 py-2 text-xs font-black text-orange-700 disabled:opacity-60">Revisar luego</button>
                          <button onClick={() => ignore(comment)} disabled={busy} className="rounded-xl border px-3 py-2 text-xs font-black text-slate-700 disabled:opacity-60">Ignorar</button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </section>
      </div>
    </div>
  );
}
