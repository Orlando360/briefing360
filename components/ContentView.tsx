'use client'

import { useState, useRef } from 'react'

type ContentEntry = { contenido: string; noticias: string; generado_en: string }
const STORAGE_KEY = 'contenido_del_dia_v1'

function loadContent(): Record<string, ContentEntry> {
  if (typeof window === 'undefined') return {}
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch { return {} }
}
function saveContent(d: Record<string, ContentEntry>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)) } catch {}
}

function md2html(md: string): string {
  return md
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/^---$/gm, '<hr />')
    .replace(/^→ (.+)$/gm, '<li>$1</li>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hlip])(.+)$/gm, '<p>$1</p>')
    .replace(/<p><\/p>/g, '')
    .replace(/<p>(<h[234]>)/g, '$1')
    .replace(/(<\/h[234]>)<\/p>/g, '$1')
    .replace(/<p>(<hr \/>)<\/p>/g, '$1')
    .replace(/(<li>[^]*?<\/li>)/g, m => `<ul>${m}</ul>`)
    .replace(/<\/ul>\s*<ul>/g, '')
}

export default function ContentView() {
  const today = new Date().toISOString().split('T')[0]
  const [generating, setGenerating] = useState(false)
  const [streamText, setStreamText]   = useState('')
  const [newsUsed, setNewsUsed]       = useState('')
  const [entry, setEntry]             = useState<ContentEntry | null>(() => loadContent()[today] || null)
  const [toast, setToast]             = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)
  const [showNews, setShowNews]       = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  async function generate(force = false) {
    if (generating) return
    const stored = loadContent()
    if (!force && stored[today]) { setEntry(stored[today]); return }

    abortRef.current = new AbortController()
    setGenerating(true)
    setStreamText('')
    setNewsUsed('')

    try {
      const res = await fetch('/api/content', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.NEXT_PUBLIC_APP_SECRET}`,
        },
        body:    JSON.stringify({ fecha: today }),
        signal:  abortRef.current.signal,
      })

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: 'Error de red' }))
        throw new Error(err.error || `HTTP ${res.status}`)
      }

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let   buffer  = ''
      let   full    = ''
      let   news    = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (!raw) continue

          let parsed: { text?: string; done?: boolean; error?: string; generado_en?: string; news?: string }
          try { parsed = JSON.parse(raw) } catch { continue }

          if (parsed.error) throw new Error(parsed.error)

          if (parsed.news) {
            news = parsed.news
            setNewsUsed(news)
          }

          if (parsed.text) {
            full += parsed.text
            setStreamText(full)
          }

          if (parsed.done) {
            const newEntry: ContentEntry = {
              contenido:   full,
              noticias:    news,
              generado_en: parsed.generado_en || new Date().toISOString(),
            }
            const updated = loadContent()
            updated[today] = newEntry
            saveContent(updated)
            setEntry(newEntry)
            setStreamText('')
            showToast('✦ Contenido generado')
            return
          }
        }
      }

      if (full.length > 200) {
        const newEntry: ContentEntry = { contenido: full, noticias: news, generado_en: new Date().toISOString() }
        const updated = loadContent()
        updated[today] = newEntry
        saveContent(updated)
        setEntry(newEntry)
        setStreamText('')
        showToast('✦ Listo')
      } else {
        throw new Error('Respuesta incompleta')
      }
    } catch (e: unknown) {
      const err = e as { message?: string; name?: string }
      if (err?.name !== 'AbortError') showToast('Error: ' + (err?.message || 'Desconocido'), 'err')
    } finally {
      setGenerating(false)
      setStreamText('')
    }
  }

  const isStreaming = generating

  return (
    <div style={s.root}>
      {/* ── TOP BAR ─────────────────────────────────────── */}
      <div style={s.topBar}>
        <div>
          <div style={s.moduleTitle}>Contenido de Hoy</div>
          <div style={s.moduleDate}>
            {new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
        </div>
        <div style={s.topActions}>
          {entry && !generating && (
            <button onClick={() => generate(true)} style={s.regenBtn}>
              ↺ Regenerar
            </button>
          )}
          <button
            onClick={() => generate(false)}
            disabled={generating}
            style={{ ...s.mainBtn, opacity: generating ? 0.45 : 1, cursor: generating ? 'not-allowed' : 'pointer' }}
          >
            {generating
              ? <><span style={s.spinSm} />Generando…</>
              : entry ? <>✦ Ya generado hoy</> : <>✦ Generar contenido</>
            }
          </button>
        </div>
      </div>

      {/* ── NOTICIAS USADAS ──────────────────────────────── */}
      {(newsUsed || entry?.noticias) && (
        <div style={s.newsBox}>
          <button style={s.newsToggle} onClick={() => setShowNews(v => !v)}>
            <span style={s.newsDot} />
            Noticias reales usadas como base {showNews ? '▲' : '▼'}
          </button>
          {showNews && (
            <pre style={s.newsPre}>{newsUsed || entry?.noticias}</pre>
          )}
        </div>
      )}

      {/* ── CONTENT AREA ─────────────────────────────────── */}
      {isStreaming ? (
        <div style={s.section}>
          <div style={s.streamBar}>
            <span style={s.streamDot} />
            <span style={s.streamLabel}>Claude está creando tu contenido con las noticias de hoy…</span>
          </div>
          {streamText ? (
            <div className="briefing-body" dangerouslySetInnerHTML={{ __html: md2html(streamText) }} />
          ) : (
            <div style={s.skeletons}>
              {[220, 160, 280, 130, 200, 90, 240].map((w, i) => (
                <div key={i} className="skeleton" style={{ height: 14, width: `${w}px`, maxWidth: '95%', marginBottom: 12 }} />
              ))}
            </div>
          )}
        </div>
      ) : entry ? (
        <div style={s.section}>
          <div style={s.genMeta}>
            Generado a las {new Date(entry.generado_en).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
            {' · '}~{Math.round(entry.contenido.length / 5)} palabras
          </div>
          <div className="briefing-body" dangerouslySetInnerHTML={{ __html: md2html(entry.contenido) }} />
        </div>
      ) : (
        <div style={s.empty}>
          <div style={s.emptyIcon}>✍️</div>
          <h2 style={s.emptyTitle}>Contenido de Hoy</h2>
          <p style={s.emptyText}>
            Busca las noticias reales del día y genera automáticamente:<br />
            3 Reels con guion · 5 Hooks · Carrusel · 3 Historias · Opinión polémica · Estrategia de venta
          </p>
          <button onClick={() => generate(false)} style={s.mainBtn}>
            ✦ Generar contenido
          </button>
        </div>
      )}

      {/* ── TOAST ──────────────────────────────────────── */}
      {toast && (
        <div style={{
          ...s.toast,
          background:  toast.type === 'ok' ? 'var(--bg-card)' : '#1A0808',
          borderColor: toast.type === 'ok' ? 'var(--accent-border)' : 'rgba(248,113,113,0.3)',
          color:       toast.type === 'ok' ? 'var(--text)' : '#F87171',
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  root:        { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' },
  topBar:      { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '28px 44px 20px', flexShrink: 0, gap: '16px', flexWrap: 'wrap' },
  moduleTitle: { fontSize: '20px', fontWeight: '900', color: 'var(--text)', letterSpacing: '-0.02em' },
  moduleDate:  { fontSize: '11px', color: 'var(--text-dim)', marginTop: '4px', textTransform: 'capitalize' },
  topActions:  { display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 },
  mainBtn:     { background: 'var(--accent)', color: '#0A0A0A', border: 'none', borderRadius: '10px', padding: '10px 20px', fontSize: '13px', fontWeight: '800', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '7px', boxShadow: '0 0 20px rgba(245,197,24,0.22)', transition: 'opacity 0.15s', whiteSpace: 'nowrap' },
  regenBtn:    { background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)', border: '1px solid var(--border-strong)', borderRadius: '9px', padding: '9px 14px', fontSize: '11px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' },
  spinSm:      { width: '12px', height: '12px', border: '2px solid rgba(10,10,10,0.3)', borderTopColor: '#0A0A0A', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block', flexShrink: 0 },
  // News box
  newsBox:     { margin: '0 44px 8px', background: 'rgba(245,197,24,0.04)', border: '1px solid var(--accent-border)', borderRadius: '10px', overflow: 'hidden' },
  newsToggle:  { width: '100%', background: 'none', border: 'none', padding: '10px 14px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '11px', fontWeight: '600', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'left' },
  newsDot:     { width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 },
  newsPre:     { padding: '10px 14px 14px', fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'pre-wrap', lineHeight: '1.6', margin: 0, fontFamily: 'inherit' },
  // Streaming
  section:     { padding: '0 44px 44px', flex: 1 },
  streamBar:   { display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', background: 'rgba(245,197,24,0.06)', border: '1px solid var(--accent-border)', borderRadius: '10px', marginBottom: '24px' },
  streamDot:   { width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, animation: 'pulse 1.2s ease infinite' },
  streamLabel: { fontSize: '12px', color: 'var(--accent)', fontWeight: '600' },
  skeletons:   { paddingTop: '8px' },
  genMeta:     { fontSize: '11px', color: 'var(--text-dim)', marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid var(--border)' },
  // Empty
  empty:       { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 44px', gap: '16px', textAlign: 'center' },
  emptyIcon:   { fontSize: '48px', marginBottom: '4px' },
  emptyTitle:  { fontSize: '20px', fontWeight: '900', color: 'var(--text)', letterSpacing: '-0.02em' },
  emptyText:   { fontSize: '14px', color: 'var(--text-muted)', lineHeight: '1.75', maxWidth: '440px' },
  toast:       { position: 'fixed', bottom: '24px', right: '24px', border: '1px solid', borderRadius: '10px', padding: '12px 18px', fontSize: '13px', fontWeight: '500', zIndex: 999, animation: 'fadeUp 0.3s ease', boxShadow: 'var(--shadow-lg)' },
}
