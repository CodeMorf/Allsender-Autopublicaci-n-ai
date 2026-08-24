'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Copy, ExternalLink, Link2, MessageCircle, Save, Sparkles } from 'lucide-react';

type SettingsShape = {
  enabled?: boolean;
  algorithm?: string;
  whatsappNumber?: string;
  defaultWhatsappMessage?: string;
  shortLinksEnabled?: boolean;
  metadata?: Record<string, any>;
};

function cleanPhone(value: string) {
  return String(value || '').replace(/[^\d]/g, '');
}

function buildWaUrl(phone: string, message: string) {
  const cleaned = cleanPhone(phone);
  if (!cleaned) return '';
  const text = String(message || '').trim();
  return `https://wa.me/${cleaned}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

function normalizeSettings(payload: any): SettingsShape {
  const source = payload?.settings || payload || {};
  return {
    enabled: Boolean(source.enabled ?? source.isEnabled ?? source.is_enabled ?? true),
    algorithm: source.algorithm || 'product_link',
    whatsappNumber: source.whatsappNumber || source.whatsapp_number || '',
    defaultWhatsappMessage:
      source.defaultWhatsappMessage ||
      source.default_whatsapp_message ||
      'Hola, vengo desde Facebook. Me interesa este producto. ¿Me puedes ayudar?',
    shortLinksEnabled: Boolean(source.shortLinksEnabled ?? source.short_links_enabled ?? true),
    metadata: source.metadata || {},
  };
}

export default function ComentariosIaWhatsappLinkPage() {
  const [settings, setSettings] = useState<SettingsShape>({
    enabled: true,
    algorithm: 'product_link',
    whatsappNumber: '',
    defaultWhatsappMessage: 'Hola, vengo desde Facebook. Me interesa este producto. ¿Me puedes ayudar?',
    shortLinksEnabled: true,
    metadata: {},
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const waUrl = useMemo(
    () => buildWaUrl(settings.whatsappNumber || '', settings.defaultWhatsappMessage || ''),
    [settings.whatsappNumber, settings.defaultWhatsappMessage]
  );

  const shortUrl = String(settings.metadata?.whatsappShortUrl || '');

  useEffect(() => {
    let active = true;

    fetch('/api/marketing/comentarios-ia/settings')
      .then((res) => res.json())
      .then((json) => {
        if (!active) return;
        setSettings((current) => ({ ...current, ...normalizeSettings(json) }));
      })
      .catch(() => {
        if (!active) return;
        setError('No pudimos cargar la configuración todavía.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  function patch(next: Partial<SettingsShape>) {
    setSettings((current) => ({ ...current, ...next }));
  }

  async function save(extra?: Partial<SettingsShape>) {
    setSaving(true);
    setError('');
    setNotice('');

    const payload = {
      ...settings,
      ...(extra || {}),
      enabled: true,
      shortLinksEnabled: true,
    };

    try {
      const response = await fetch('/api/marketing/comentarios-ia/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await response.json().catch(() => ({}));

      if (!response.ok || json?.ok === false) {
        throw new Error(json?.message || 'No pudimos guardar la configuración. Revisa el número y vuelve a intentar.');
      }

      setSettings(normalizeSettings(json?.settings || payload));
      setNotice('Configuración guardada correctamente.');
      return normalizeSettings(json?.settings || payload);
    } catch (err: any) {
      setError(err?.message || 'No pudimos guardar la configuración. Revisa el número y vuelve a intentar.');
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function generateShortLink() {
    setGenerating(true);
    setError('');
    setNotice('');

    try {
      if (!waUrl) {
        throw new Error('Agrega un número de WhatsApp para generar el enlace.');
      }

      const response = await fetch('/api/marketing/comentarios-ia/short-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destinationUrl: waUrl,
          title: 'WhatsApp Comentarios IA',
          slug: `wa-${cleanPhone(settings.whatsappNumber || '').slice(-8) || 'comentarios'}`,
        }),
      });

      const json = await response.json().catch(() => ({}));

      if (!response.ok || json?.ok === false) {
        throw new Error(json?.message || 'No pudimos generar el enlace corto.');
      }

      const nextMetadata = {
        ...(settings.metadata || {}),
        whatsappShortUrl: json.shortUrl || json.url || json.link?.shortUrl || json.link?.url || waUrl,
        whatsappDirectUrl: waUrl,
      };

      const saved = await save({
        metadata: nextMetadata,
        shortLinksEnabled: true,
        algorithm: settings.algorithm || 'product_link',
      });

      setSettings((current) => ({
        ...current,
        ...(saved || {}),
        metadata: nextMetadata,
      }));

      setNotice('Enlace de WhatsApp generado y guardado.');
    } catch (err: any) {
      setError(err?.message || 'No pudimos generar el enlace.');
    } finally {
      setGenerating(false);
    }
  }

  async function copyText(value: string) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setNotice('Enlace copiado.');
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 px-6 py-8">
        <div className="mx-auto max-w-5xl rounded-[2rem] border bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold text-slate-500">Cargando configuración...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-[2rem] border bg-white p-6 shadow-sm">
          <a href="/es/modulo/comentarios-ia" className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-950">
            <ArrowLeft className="h-4 w-4" />
            Volver a Comentarios IA
          </a>

          <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
                <MessageCircle className="h-4 w-4" />
                WhatsApp de cierre
              </div>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
                Enlace de WhatsApp para Comentarios IA
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Configura el número y el mensaje que la IA usará cuando un comentario tenga intención de compra.
              </p>
            </div>

            <a
              href="/es/settings/comentarios-ia"
              className="inline-flex items-center justify-center gap-2 rounded-2xl border bg-white px-5 py-3 text-sm font-black text-slate-900 hover:bg-slate-50"
            >
              Configuración avanzada <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>

        {notice ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">
            {notice}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
            {error}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[1fr_.8fr]">
          <section className="rounded-[2rem] border bg-white p-6 shadow-sm">
            <h2 className="text-xl font-black text-slate-950">Datos del enlace</h2>

            <div className="mt-6 space-y-5">
              <label className="block">
                <span className="text-sm font-black text-slate-800">Número de WhatsApp</span>
                <input
                  value={settings.whatsappNumber || ''}
                  onChange={(event) => patch({ whatsappNumber: event.target.value })}
                  placeholder="+18091234567"
                  className="mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-slate-950"
                />
                <span className="mt-2 block text-xs font-semibold text-slate-500">
                  Usa código de país. Ejemplo: +1 para Estados Unidos, +1809 para República Dominicana.
                </span>
              </label>

              <label className="block">
                <span className="text-sm font-black text-slate-800">Mensaje inicial</span>
                <textarea
                  value={settings.defaultWhatsappMessage || ''}
                  onChange={(event) => patch({ defaultWhatsappMessage: event.target.value })}
                  rows={4}
                  placeholder="Hola, vengo desde Facebook. Me interesa este producto."
                  className="mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-slate-950"
                />
              </label>

              <label className="block">
                <span className="text-sm font-black text-slate-800">Estrategia</span>
                <select
                  value={settings.algorithm || 'product_link'}
                  onChange={(event) => patch({ algorithm: event.target.value })}
                  className="mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-slate-950"
                >
                  <option value="product_link">Producto + WhatsApp</option>
                  <option value="whatsapp_direct">Enviar directo a WhatsApp</option>
                  <option value="smart_ai">IA inteligente</option>
                </select>
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  onClick={() => save()}
                  disabled={saving}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-60"
                >
                  <Save className="h-4 w-4" />
                  {saving ? 'Guardando...' : 'Guardar configuración'}
                </button>

                <button
                  onClick={generateShortLink}
                  disabled={generating || !waUrl}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-400 px-5 py-3 text-sm font-black text-slate-950 disabled:opacity-60"
                >
                  <Sparkles className="h-4 w-4" />
                  {generating ? 'Generando...' : 'Generar link corto'}
                </button>
              </div>
            </div>
          </section>

          <aside className="space-y-5">
            <div className="rounded-[2rem] border bg-white p-6 shadow-sm">
              <h3 className="flex items-center gap-2 text-lg font-black text-slate-950">
                <Link2 className="h-5 w-5 text-emerald-600" />
                Vista previa
              </h3>

              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-slate-400">Link directo</p>
                  <div className="mt-2 rounded-2xl bg-slate-50 p-4 text-xs font-semibold text-slate-700 break-all">
                    {waUrl || 'Agrega un número para generar el enlace directo.'}
                  </div>
                  {waUrl ? (
                    <div className="mt-3 flex gap-2">
                      <button onClick={() => copyText(waUrl)} className="rounded-xl border px-3 py-2 text-xs font-black hover:bg-slate-50">
                        <Copy className="mr-1 inline h-3 w-3" />
                        Copiar
                      </button>
                      <a href={waUrl} target="_blank" className="rounded-xl border px-3 py-2 text-xs font-black hover:bg-slate-50">
                        Abrir
                      </a>
                    </div>
                  ) : null}
                </div>

                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-slate-400">Link corto</p>
                  <div className="mt-2 rounded-2xl bg-slate-50 p-4 text-xs font-semibold text-slate-700 break-all">
                    {shortUrl || 'Todavía no se ha generado un link corto.'}
                  </div>
                  {shortUrl ? (
                    <div className="mt-3 flex gap-2">
                      <button onClick={() => copyText(shortUrl)} className="rounded-xl border px-3 py-2 text-xs font-black hover:bg-slate-50">
                        <Copy className="mr-1 inline h-3 w-3" />
                        Copiar
                      </button>
                      <a href={shortUrl} target="_blank" className="rounded-xl border px-3 py-2 text-xs font-black hover:bg-slate-50">
                        Abrir
                      </a>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="rounded-[2rem] border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
              <b>Uso recomendado:</b>
              <p className="mt-2">
                Mantén la estrategia en Producto + WhatsApp para que la IA responda precio/disponibilidad y cierre con WhatsApp cuando aplique.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
