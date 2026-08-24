'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  Edit3,
  Facebook,
  Image as ImageIcon,
  Instagram,
  Loader2,
  Megaphone,
  PackageSearch,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';

type Account = { id: number; platform: string; displayName?: string | null; username?: string | null; picture?: string | null; zernioAccountId: string; zernioProfileId: string; isPublishReady: boolean };
type Product = { id: number; name: string; description?: string | null; category?: string | null; price?: number | null; currency?: string | null; imageUrl?: string | null; stock?: number | null; images: string[] };
type MediaItem = { id: string; type: 'image'; url: string; previewUrl?: string; file?: File; uploading?: boolean };
type Post = { id: number; title?: string | null; body: string; mediaUrl?: string | null; mediaItems?: MediaItem[]; status: string; scheduledAt?: string | null; publishedAt?: string | null; createdAt?: string | null; channels: any[] };
type Plan = { planCode: string; planName: string; maxChannelsPerPost: number; enabledPlatforms: string[]; allowMultiChannelPost: boolean; allowAiCaption: boolean; allowAdvancedCalendar: boolean; allowPhonePreview: boolean; upgradeUrl: string; timezoneDefault: string };

const emptyPlan: Plan = {
  planCode: 'basic',
  planName: 'Basico',
  maxChannelsPerPost: 1,
  enabledPlatforms: ['facebook', 'instagram'],
  allowMultiChannelPost: false,
  allowAiCaption: false,
  allowAdvancedCalendar: false,
  allowPhonePreview: true,
  upgradeUrl: '/es/pricing',
  timezoneDefault: 'America/Santo_Domingo',
};

const statusCopy: Record<string, string> = {
  draft: 'Borrador',
  scheduled: 'Programada',
  publishing: 'Publicando',
  published: 'Publicada',
  partial: 'Parcial',
  failed: 'Fallida',
  cancelled: 'Cancelada',
  archived: 'Archivada',
};

function platformIcon(platform?: string) {
  const p = String(platform || '').toLowerCase();
  if (p === 'facebook') return <Facebook className="h-4 w-4" />;
  if (p === 'instagram') return <Instagram className="h-4 w-4" />;
  return <Megaphone className="h-4 w-4" />;
}

function prettyDate(value?: string | null) {
  if (!value) return 'Sin fecha';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

function tomorrowDate() {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function nextHour() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:00`;
}

function statusClass(status: string) {
  if (status === 'published') return 'bg-emerald-50 text-emerald-700';
  if (status === 'scheduled') return 'bg-blue-50 text-blue-700';
  if (status === 'failed') return 'bg-red-50 text-red-700';
  if (status === 'cancelled' || status === 'archived') return 'bg-slate-100 text-slate-600';
  return 'bg-amber-50 text-amber-700';
}

function PhonePreview({ account, body, mediaItems }: { account: Account | null; body: string; mediaItems: MediaItem[] }) {
  const first = mediaItems[0];
  return (
    <div className="mx-auto w-full max-w-[330px] rounded-[2rem] border-8 border-slate-950 bg-slate-950 p-2 shadow-2xl">
      <div className="rounded-[1.45rem] bg-white p-4">
        <div className="mb-4 flex items-center gap-3 border-b pb-3">
          <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-slate-500">
            {account?.picture ? <img src={account.picture} alt="" className="h-full w-full object-cover" /> : platformIcon(account?.platform)}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-slate-900">{account?.displayName || account?.username || 'Cuenta conectada'}</div>
            <div className="text-xs text-slate-500">{account?.platform || 'red social'} · Ahora</div>
          </div>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{body || 'Escribe tu publicacion para ver la vista previa.'}</p>
        {first ? (
          <div className="mt-4 overflow-hidden rounded-2xl bg-slate-100">
            <img src={first.previewUrl || first.url} alt="Vista previa" className="aspect-square w-full object-cover" />
            {mediaItems.length > 1 ? <div className="bg-slate-950 px-3 py-2 text-xs font-bold text-white">{mediaItems.length} imagenes seleccionadas</div> : null}
          </div>
        ) : (
          <div className="mt-4 flex aspect-video items-center justify-center rounded-2xl border border-dashed bg-slate-50 text-xs text-slate-400">
            <ImageIcon className="mr-2 h-4 w-4" /> Sin imagen
          </div>
        )}
        <div className="mt-4 flex justify-around border-t pt-3 text-xs text-slate-400"><span>Me gusta</span><span>Comentar</span><span>Compartir</span></div>
      </div>
    </div>
  );
}

export default function AutoPublicarPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<any[]>([]);
  const [plan, setPlan] = useState<Plan>(emptyPlan);
  const [selectedAccounts, setSelectedAccounts] = useState<number[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<number[]>([]);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [manualImageUrl, setManualImageUrl] = useState('');
  const [scheduleDates, setScheduleDates] = useState<string[]>([]);
  const [newSchedule, setNewSchedule] = useState({ date: tomorrowDate(), time: nextHour() });
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [form, setForm] = useState({
    title: '',
    body: '',
    keywords: '',
    colors: '#E0B84F, #111827, #FFFFFF',
    tone: 'moderno, vendedor y profesional',
    generateImage: false,
    campaignMode: 'single_combo',
    batchSpacingMinutes: 10,
  });

  const firstAccount = useMemo(() => accounts.find((a) => selectedAccounts.includes(a.id)) || accounts[0] || null, [accounts, selectedAccounts]);
  const selectedChannels = useMemo(() => accounts.filter((a) => selectedAccounts.includes(a.id)).map((a) => ({
    connectionId: a.id,
    platform: a.platform,
    zernioAccountId: a.zernioAccountId,
    zernioProfileId: a.zernioProfileId,
    displayName: a.displayName || a.username || a.platform,
  })), [accounts, selectedAccounts]);
  const canSubmit = selectedChannels.length > 0 && (Boolean(form.body.trim()) || mediaItems.length > 0 || selectedProducts.length > 0);

  async function loadAll() {
    setLoading(true);
    setNotice('');
    try {
      const [ui, productData, postData, calendarData] = await Promise.all([
        fetch('/api/marketing/autopublicar/ui-config', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/marketing/autopublicar/products?limit=36', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ products: [] })),
        fetch('/api/marketing/autopublicar/posts?limit=40', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ posts: [] })),
        fetch('/api/marketing/autopublicar/calendar', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ events: [] })),
      ]);
      const nextAccounts = Array.isArray(ui.accounts) ? ui.accounts : [];
      setAccounts(nextAccounts);
      setPlan(ui.planLimits || emptyPlan);
      setProducts(Array.isArray(productData.products) ? productData.products : []);
      setPosts(Array.isArray(postData.posts) ? postData.posts : []);
      setCalendarEvents(Array.isArray(calendarData.events) ? calendarData.events : []);
      if (nextAccounts.length && selectedAccounts.length === 0) setSelectedAccounts([nextAccounts[0].id]);
    } catch {
      setNotice('No se pudo cargar la informacion. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadAll(); }, []);

  function toggleAccount(account: Account) {
    if (selectedAccounts.includes(account.id)) {
      setSelectedAccounts(selectedAccounts.filter((id) => id !== account.id));
      return;
    }
    if (!plan.allowMultiChannelPost && selectedAccounts.length >= 1) {
      setNotice('Tu plan permite un canal por publicacion. Puedes cambiar el canal seleccionado.');
      setSelectedAccounts([account.id]);
      return;
    }
    if (selectedAccounts.length >= plan.maxChannelsPerPost) {
      setNotice(`Tu plan permite maximo ${plan.maxChannelsPerPost} canal(es) por publicacion.`);
      return;
    }
    setSelectedAccounts([...selectedAccounts, account.id]);
  }

  function addMediaFromUrl(url: string) {
    const clean = url.trim();
    if (!/^https?:\/\//i.test(clean)) {
      setNotice('Agrega una URL valida de imagen.');
      return;
    }
    setMediaItems((current) => [...current, { id: crypto.randomUUID(), type: 'image' as const, url: clean }].slice(0, 10));
    setManualImageUrl('');
  }

  function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const next = Array.from(files).filter((file) => file.type.startsWith('image/')).map((file) => ({
      id: crypto.randomUUID(),
      type: 'image' as const,
      url: '',
      previewUrl: URL.createObjectURL(file),
      file,
    }));
    if (!next.length) {
      setNotice('Selecciona imagenes validas.');
      return;
    }
    setMediaItems((current) => [...current, ...next].slice(0, 10));
  }

  function removeMedia(id: string) {
    setMediaItems((current) => current.filter((item) => item.id !== id));
  }

  function toggleProduct(product: Product) {
    setSelectedProducts((current) => current.includes(product.id) ? current.filter((id) => id !== product.id) : [...current, product.id]);
    const image = product.imageUrl || product.images?.[0];
    if (image && !mediaItems.some((item) => item.url === image)) addMediaFromUrl(image);
  }

  function addScheduleDate() {
    const value = `${newSchedule.date}T${newSchedule.time}:00`;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      setNotice('Elige una fecha futura para programar.');
      return;
    }
    setScheduleDates((current) => [...new Set([...current, value])].sort());
  }

  async function uploadPendingMedia(items: MediaItem[]) {
    const uploaded: MediaItem[] = [];
    for (const item of items) {
      if (!item.file) {
        uploaded.push(item);
        continue;
      }
      const formData = new FormData();
      formData.append('file', item.file);
      const response = await fetch('/api/zernio/media/upload', { method: 'POST', body: formData });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.success) throw new Error('No se pudo subir una de las imagenes.');
      const url = json.media?.url || json.media?.mediaUrl || json.media?.secureUrl || json.media?.publicUrl;
      if (!url) throw new Error('No se pudo preparar una de las imagenes.');
      uploaded.push({ id: item.id, type: 'image', url, previewUrl: item.previewUrl });
    }
    return uploaded;
  }

  async function generateContent() {
    setGenerating(true);
    setNotice('');
    try {
      const result = await fetch('/api/marketing/autopublicar/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: form.keywords,
          colors: form.colors,
          tone: form.tone,
          productIds: selectedProducts,
          generateImage: form.generateImage,
          productLimit: 4,
        }),
      }).then((r) => r.json());
      if (!result.status) throw new Error(result.message || 'No se pudo generar contenido.');
      const content = result.content || {};
      setForm((current) => ({ ...current, title: content.title || current.title, body: content.body || current.body }));
      const nextMedia = Array.isArray(content.mediaItems) ? content.mediaItems : (content.mediaUrl ? [{ type: 'image', url: content.mediaUrl }] : []);
      if (nextMedia.length) {
        setMediaItems((current) => [...nextMedia.map((m: any) => ({ id: crypto.randomUUID(), type: 'image' as const, url: m.url || m.mediaUrl || m })), ...current].slice(0, 10));
      }
      setNotice('Contenido preparado correctamente.');
    } catch (error: any) {
      setNotice(error?.message || 'No se pudo generar contenido.');
    } finally {
      setGenerating(false);
    }
  }

  async function submit(mode: 'draft' | 'schedule' | 'publish_now') {
    if (!canSubmit) {
      setNotice('Agrega contenido, imagenes y al menos un canal.');
      return;
    }
    if (mode === 'schedule' && scheduleDates.length === 0) {
      setNotice('Elige cuando deseas publicar.');
      return;
    }
    setSaving(true);
    setNotice('');
    try {
      const preparedMedia = await uploadPendingMedia(mediaItems);
      setMediaItems(preparedMedia);
      const payload = {
        title: form.title,
        body: form.body || 'Nueva publicacion',
        mediaUrl: preparedMedia[0]?.url || null,
        mediaItems: preparedMedia.map((item) => ({ type: 'image', url: item.url })),
        channels: selectedChannels,
        productIds: selectedProducts,
        batchMode: form.campaignMode,
        batchSpacingMinutes: form.batchSpacingMinutes,
        timezone: plan.timezoneDefault,
        tags: form.keywords.split(',').map((x) => x.trim()).filter(Boolean),
        uiSource: 'autopublicar_marketing_profesional',
      };
      const dates = mode === 'schedule' ? scheduleDates : [null];
      let ok = 0;
      for (const scheduledAt of dates) {
        const response = await fetch('/api/marketing/autopublicar/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-request-id': crypto.randomUUID() },
          body: JSON.stringify({
            ...payload,
            publishNow: mode === 'publish_now',
            scheduleMode: mode,
            scheduledAt,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.status) throw new Error(result.message || 'No se pudo guardar la publicacion.');
        ok += result.batch ? Number(result.createdCount || 0) : 1;
      }
      setNotice(mode === 'publish_now' ? 'Publicacion enviada correctamente.' : mode === 'schedule' ? `${ok} publicacion(es) programada(s) correctamente.` : 'Borrador guardado correctamente.');
      setForm((current) => ({ ...current, title: '', body: '' }));
      setMediaItems([]);
      setSelectedProducts([]);
      if (mode !== 'draft') setScheduleDates([]);
      await loadAll();
    } catch (error: any) {
      setNotice(error?.message || 'No se pudo completar la publicacion.');
    } finally {
      setSaving(false);
    }
  }

  async function updatePost() {
    if (!editingPost) return;
    setSaving(true);
    setNotice('');
    try {
      const preparedMedia = await uploadPendingMedia(mediaItems);
      const response = await fetch(`/api/marketing/autopublicar/posts/${editingPost.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          body: form.body,
          mediaUrl: preparedMedia[0]?.url || null,
          mediaItems: preparedMedia.map((item) => ({ type: 'image', url: item.url })),
          channels: selectedChannels,
          scheduledAt: scheduleDates[0] || editingPost.scheduledAt || null,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.status) throw new Error(result.message || 'No se pudo actualizar.');
      setNotice('Publicacion actualizada correctamente.');
      setEditingPost(null);
      setMediaItems([]);
      setScheduleDates([]);
      await loadAll();
    } catch (error: any) {
      setNotice(error?.message || 'No se pudo actualizar la publicacion.');
    } finally {
      setSaving(false);
    }
  }

  async function cancelPost(post: Post) {
    if (!window.confirm('Cancelar esta publicacion programada?')) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/marketing/autopublicar/posts/${post.id}/cancel`, { method: 'POST' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.status) throw new Error(result.message || 'No se pudo cancelar.');
      setNotice('Publicacion cancelada correctamente.');
      await loadAll();
    } catch (error: any) {
      setNotice(error?.message || 'No se pudo cancelar la publicacion.');
    } finally {
      setSaving(false);
    }
  }

  async function publishNow(post: Post) {
    setSaving(true);
    try {
      const response = await fetch(`/api/marketing/autopublicar/posts/${post.id}/publish`, { method: 'POST' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.status) throw new Error(result.message || 'No se pudo publicar.');
      setNotice('Publicacion enviada correctamente.');
      await loadAll();
    } catch (error: any) {
      setNotice(error?.message || 'No se pudo publicar ahora.');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(post: Post) {
    setEditingPost(post);
    setForm((current) => ({ ...current, title: post.title || '', body: post.body || '' }));
    setMediaItems((post.mediaItems || (post.mediaUrl ? [{ id: crypto.randomUUID(), type: 'image', url: post.mediaUrl }] : [])).map((item: any) => ({ id: crypto.randomUUID(), type: 'image', url: item.url || item.mediaUrl || item })));
    setSelectedAccounts((post.channels || []).map((channel: any) => Number(channel.connectionId)).filter(Boolean));
    setScheduleDates(post.scheduledAt ? [post.scheduledAt.slice(0, 19)] : []);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Cargando Autopublicar...</div>;
  }

  return (
    <div className="min-h-screen overflow-auto bg-slate-50 px-4 py-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-3xl border bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-800">
                <Sparkles className="h-4 w-4" /> Marketing inteligente
              </div>
              <h1 className="text-3xl font-black tracking-tight text-slate-950">Autopublicar Marketing</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">Crea publicaciones con varias imagenes, elige canales conectados y programa una o varias fechas desde un calendario simple.</p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold">
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">Canales conectados: {accounts.length}</span>
                <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-700">Productos: {products.length}</span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">Plan: {plan.planName}</span>
              </div>
            </div>
            <a href="/es/modulo/autopublicar/activar/ai" className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white">
              <Wand2 className="mr-2 h-4 w-4" /> Configurar automatico
            </a>
          </div>
        </section>

        {notice ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">{notice}</div> : null}

        <main className="grid gap-6 xl:grid-cols-[1fr_380px]">
          <section className="space-y-6">
            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-xl font-black">{editingPost ? 'Editar publicacion' : 'Crear publicacion'}</h2>
                  <p className="text-sm text-slate-500">Contenido, imagenes, productos y tono comercial.</p>
                </div>
                {editingPost ? <button onClick={() => { setEditingPost(null); setMediaItems([]); setScheduleDates([]); }} className="inline-flex items-center rounded-xl border px-3 py-2 text-sm font-bold"><X className="mr-2 h-4 w-4" /> Salir de edicion</button> : null}
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <input placeholder="Palabras clave: oferta, delivery, nuevo" value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} className="rounded-2xl border px-4 py-3 text-sm outline-none" />
                <input placeholder="Colores de la marca" value={form.colors} onChange={(e) => setForm({ ...form, colors: e.target.value })} className="rounded-2xl border px-4 py-3 text-sm outline-none" />
                <select value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })} className="rounded-2xl border px-4 py-3 text-sm outline-none">
                  <option value="moderno, vendedor y profesional">Moderno comercial</option>
                  <option value="amigable y directo">Amigable</option>
                  <option value="formal y premium">Formal</option>
                  <option value="rapido y promocional">Rapido promocional</option>
                </select>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <input placeholder="Titulo interno" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="rounded-2xl border px-4 py-3 text-sm outline-none" />
                <div className="flex gap-2">
                  <input placeholder="URL de imagen" value={manualImageUrl} onChange={(e) => setManualImageUrl(e.target.value)} className="min-w-0 flex-1 rounded-2xl border px-4 py-3 text-sm outline-none" />
                  <button onClick={() => addMediaFromUrl(manualImageUrl)} className="rounded-2xl border px-4 py-3 text-sm font-black"><Plus className="h-4 w-4" /></button>
                </div>
              </div>

              <textarea placeholder="Texto de la publicacion" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} className="mt-3 min-h-44 w-full rounded-2xl border px-4 py-3 text-sm outline-none" />

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
                <button onClick={() => fileInputRef.current?.click()} className="inline-flex items-center rounded-2xl border px-4 py-3 text-sm font-black"><Upload className="mr-2 h-4 w-4" /> Seleccionar imagenes</button>
                <label className="inline-flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold"><input type="checkbox" checked={form.generateImage} onChange={(e) => setForm({ ...form, generateImage: e.target.checked })} /> Crear imagen con IA si esta disponible</label>
                <button onClick={generateContent} disabled={generating} className="inline-flex items-center rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:opacity-60">
                  {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />} Generar con IA/stock
                </button>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {mediaItems.length === 0 ? (
                  <div className="col-span-full rounded-2xl border border-dashed bg-slate-50 p-8 text-center text-sm text-slate-500">Agrega imagenes para tu publicacion.</div>
                ) : mediaItems.map((item) => (
                  <div key={item.id} className="group relative overflow-hidden rounded-2xl border bg-slate-100">
                    <img src={item.previewUrl || item.url} alt="Imagen seleccionada" className="aspect-square w-full object-cover" />
                    <button onClick={() => removeMedia(item.id)} className="absolute right-2 top-2 rounded-full bg-white/95 p-2 shadow"><Trash2 className="h-4 w-4 text-red-600" /></button>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-black">Productos del catalogo</h2>
                  <p className="text-sm text-slate-500">Selecciona productos para usar texto e imagenes reales.</p>
                </div>
                <button onClick={loadAll} className="rounded-xl border px-3 py-2 text-xs font-black"><RefreshCw className="inline h-3 w-3" /> Actualizar</button>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {products.slice(0, 12).map((product) => (
                  <button key={product.id} onClick={() => toggleProduct(product)} className={`flex gap-3 rounded-2xl border p-3 text-left transition ${selectedProducts.includes(product.id) ? 'border-emerald-300 bg-emerald-50' : 'bg-white hover:bg-slate-50'}`}>
                    <div className="h-14 w-14 overflow-hidden rounded-xl bg-slate-100">{(product.imageUrl || product.images?.[0]) ? <img src={product.imageUrl || product.images[0]} className="h-full w-full object-cover" alt="" /> : <PackageSearch className="m-4 h-6 w-6 text-slate-400" />}</div>
                    <div className="min-w-0"><p className="truncate text-sm font-black">{product.name}</p><p className="text-xs text-slate-500">Stock: {product.stock ?? 'N/D'} · {product.category || 'General'}</p><p className="text-xs font-bold text-emerald-700">{product.price ? `${product.currency || 'DOP'} ${Number(product.price).toLocaleString('es-DO')}` : 'Sin precio'}</p></div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <h2 className="text-xl font-black">Canales y calendario</h2>
              <p className="mb-4 text-sm text-slate-500">Selecciona tus canales y agrega una o varias fechas de publicacion.</p>
              {accounts.length === 0 ? (
                <div className="rounded-2xl border border-dashed p-8 text-center"><p className="font-black">Conecta tu primer canal.</p><a href="/es/settings/connect" className="mt-3 inline-flex rounded-2xl bg-slate-950 px-4 py-2 text-sm font-black text-white">Conectar canales</a></div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">{accounts.map((account) => (
                  <button key={account.id} onClick={() => toggleAccount(account)} className={`flex items-center gap-3 rounded-2xl border p-3 text-left ${selectedAccounts.includes(account.id) ? 'border-emerald-300 bg-emerald-50' : 'bg-white hover:bg-slate-50'}`}>
                    <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-slate-100">{account.picture ? <img src={account.picture} className="h-full w-full object-cover" alt="" /> : platformIcon(account.platform)}</div>
                    <div><p className="text-sm font-black">{account.displayName || account.username || account.platform}</p><p className="text-xs text-emerald-700">{account.platform} · conectado</p></div>
                    {selectedAccounts.includes(account.id) ? <CheckCircle2 className="ml-auto h-4 w-4 text-emerald-600" /> : null}
                  </button>
                ))}</div>
              )}

              <div className="mt-5 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                <input type="date" value={newSchedule.date} onChange={(e) => setNewSchedule({ ...newSchedule, date: e.target.value })} className="rounded-2xl border px-4 py-3 text-sm outline-none" />
                <input type="time" value={newSchedule.time} onChange={(e) => setNewSchedule({ ...newSchedule, time: e.target.value })} className="rounded-2xl border px-4 py-3 text-sm outline-none" />
                <button onClick={addScheduleDate} className="inline-flex items-center justify-center rounded-2xl border px-4 py-3 text-sm font-black"><CalendarClock className="mr-2 h-4 w-4" /> Agregar fecha</button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {scheduleDates.length === 0 ? <span className="rounded-full bg-slate-100 px-3 py-2 text-xs font-bold text-slate-500">Elige cuando deseas publicar</span> : scheduleDates.map((date) => (
                  <button key={date} onClick={() => setScheduleDates((current) => current.filter((item) => item !== date))} className="inline-flex items-center rounded-full bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">{prettyDate(date)} <X className="ml-2 h-3 w-3" /></button>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <button disabled={saving || !canSubmit} onClick={() => editingPost ? updatePost() : submit('draft')} className="rounded-2xl border px-4 py-3 text-sm font-black disabled:opacity-50">{editingPost ? 'Guardar cambios' : 'Guardar borrador'}</button>
                {!editingPost ? <button disabled={saving || !canSubmit} onClick={() => submit('schedule')} className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50"><CalendarClock className="mr-2 inline h-4 w-4" /> Programar</button> : null}
                {!editingPost ? <button disabled={saving || !canSubmit} onClick={() => submit('publish_now')} className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50"><Send className="mr-2 inline h-4 w-4" /> Publicar ahora</button> : null}
              </div>
            </div>

            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <h2 className="text-xl font-black">Publicaciones</h2>
              <p className="mb-4 text-sm text-slate-500">Estado y acciones de tus publicaciones.</p>
              <div className="space-y-3">
                {posts.length === 0 ? <p className="rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-500">No hay publicaciones programadas todavia.</p> : posts.map((post) => (
                  <div key={post.id} className="rounded-2xl border p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-3 py-1 text-xs font-black ${statusClass(post.status)}`}>{statusCopy[post.status] || post.status}</span><span className="text-xs text-slate-500">{prettyDate(post.scheduledAt || post.publishedAt || post.createdAt)}</span></div>
                        <p className="mt-2 font-black text-slate-950">{post.title || post.body.slice(0, 64) || `Publicacion #${post.id}`}</p>
                        <p className="mt-1 line-clamp-2 text-sm text-slate-600">{post.body}</p>
                        <div className="mt-2 text-xs text-slate-500">{post.channels?.length || 0} canal(es) · {(post.mediaItems?.length || (post.mediaUrl ? 1 : 0))} imagen(es)</div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {['draft', 'scheduled', 'failed'].includes(post.status) ? <button onClick={() => startEdit(post)} className="rounded-xl border px-3 py-2 text-xs font-black"><Edit3 className="mr-1 inline h-3 w-3" /> Editar</button> : null}
                        {post.status === 'scheduled' ? <button onClick={() => cancelPost(post)} className="rounded-xl border px-3 py-2 text-xs font-black text-red-700"><X className="mr-1 inline h-3 w-3" /> Cancelar</button> : null}
                        {['draft', 'failed'].includes(post.status) ? <button onClick={() => publishNow(post)} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white"><Send className="mr-1 inline h-3 w-3" /> Publicar</button> : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <aside className="space-y-6">
            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-lg font-black">Vista previa</h2>
              <PhonePreview account={firstAccount} body={form.body} mediaItems={mediaItems} />
              <p className="mt-3 text-center text-xs text-slate-500">{form.body.length} caracteres · {selectedChannels.length} canal(es)</p>
            </div>
            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <h2 className="mb-3 flex items-center gap-2 text-lg font-black"><Clock className="h-5 w-5" /> Calendario</h2>
              <div className="space-y-2">
                {calendarEvents.length === 0 ? <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">No hay datos para mostrar.</p> : calendarEvents.slice(0, 8).map((event) => (
                  <div key={event.id} className="rounded-2xl border p-3 text-sm"><div className="font-black">{event.title}</div><div className="text-xs text-slate-500">{prettyDate(event.start)} · {statusCopy[event.status] || event.status}</div></div>
                ))}
              </div>
            </div>
            <div className="rounded-3xl border bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-lg font-black">Reglas</h2>
              <div className="space-y-2 text-sm text-slate-600">
                <p>Valida contenido, canales e imagenes antes de guardar.</p>
                <p>Las fechas multiples crean publicaciones independientes para evitar duplicados.</p>
                <p>Los errores internos se registran fuera de la interfaz.</p>
              </div>
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
}
