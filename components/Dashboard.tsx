'use client'

import { useState, useEffect, useRef } from 'react'
import ContentView from './ContentView'

type BriefingEntry = { contenido: string; generado_en: string }
type StoredData = { [fecha: string]: { ia?: BriefingEntry; marketing?: BriefingEntry } }

const STORAGE_KEY = 'noticias_del_dia_v1'

function getTodayKey() { return new Date().toISOString().split('T')[0] }

function formatDateLong(f: string) {
  return new Date(f + 'T12:00:00').toLocaleDateString('es-CO', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}
function formatDateShort(f: string) {
  if (f === getTodayKey()) return 'Hoy'
  return new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' })
}

function loadStorage(): StoredData {
  if (typeof window === 'undefined') return {}
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch { return {} }
}
function saveStorage(d: StoredData) {
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
    .replace(/(<li>[^]*?<\/li>)/g, (m) => `<ul>${m}</ul>`)
    .replace(/<\/ul>\s*<ul>/g, '')
}

export default function Dashboard() {
  const [tab, setTab]               = useState<'ia' | 'marketing' | 'contenido'>('ia')
  const [selectedFecha, setSel]     = useState<string>(getTodayKey())
  const [storage, setStorage]       = useState<StoredData>({})
  const [generating, setGenerating] = useState(false)
  const [streamText, setStreamText] = useState('')   // live streaming preview
  const [streamType, setStreamType] = useState<'ia' | 'marketing' | null>(null)
  const [toast, setToast]           = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)
  const [sidebarOpen, setSidebar]   = useState(false)
  const [hydrated, setHydrated]     = useState(false)
  const abortRef                    = useRef<AbortController | null>(null)

  useEffect(() => { setStorage(loadStorage()); setHydrated(true) }, [])

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  async function generateBriefing(fecha: string, tipo: 'ia' | 'marketing'): Promise<boolean> {
    abortRef.current = new AbortController()
    setStreamType(tipo)
    setStreamText('')

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.NEXT_PUBLIC_APP_SECRET}`,
        },
        body: JSON.stringify({ fecha, tipo }),
        signal: abortRef.current.signal,
      })

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: 'Error de red' }))
        throw new Error(err.error || `HTTP ${res.status}`)
      }

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let   buffer  = ''
      let   full    = ''

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

          let parsed: { text?: string; done?: boolean; error?: string; generado_en?: string }
          try { parsed = JSON.parse(raw) } catch { continue }

          if (parsed.error) throw new Error(parsed.error)

          if (parsed.text) {
            full += parsed.text
            setStreamText(full)
          }

          if (parsed.done) {
            const entry: BriefingEntry = {
              contenido:   full,
              generado_en: parsed.generado_en || new Date().toISOString(),
            }
            const updated = loadStorage()
            if (!updated[fecha]) updated[fecha] = {}
            updated[fecha][tipo] = entry
            saveStorage(updated)
            setStorage({ ...updated })
            return true
          }
        }
      }

      // stream ended without done flag — save what we have
      if (full.length > 100) {
        const entry: BriefingEntry = { contenido: full, generado_en: new Date().toISOString() }
        const updated = loadStorage()
        if (!updated[fecha]) updated[fecha] = {}
        updated[fecha][tipo] = entry
        saveStorage(updated)
        setStorage({ ...updated })
        return true
      }

      throw new Error('Respuesta incompleta')
    } catch (e: unknown) {
      const err = e as { message?: string; name?: string }
      if (err?.name !== 'AbortError') {
        showToast('Error: ' + (err?.message || 'Desconocido'), 'err')
      }
      return false
    } finally {
      setStreamText('')
      setStreamType(null)
    }
  }

  async function handleGenerateToday() {
    if (generating) return
    const today = getTodayKey()
    setSel(today)
    const current = loadStorage()
    const needed = (['ia', 'marketing'] as const).filter(t => !current[today]?.[t])

    if (needed.length === 0) { showToast('Los briefings de hoy ya están listos'); return }

    setGenerating(true)
    let ok = true
    for (const tipo of needed) {
      const result = await generateBriefing(today, tipo)
      if (!result) { ok = false; break }
    }
    setGenerating(false)
    if (ok) showToast('✦ Briefings generados')
  }

  async function handleRegenerate() {
    if (generating) return
    setGenerating(true)
    const ok = await generateBriefing(selectedFecha, briefingTab)
    setGenerating(false)
    if (ok) showToast('✦ Regenerado')
  }

  async function handleGenerateSingle(fecha: string, tipo: 'ia' | 'marketing') {
    if (generating) return
    setGenerating(true)
    const ok = await generateBriefing(fecha, tipo)
    setGenerating(false)
    if (ok) showToast('✦ Listo')
  }

  const today = getTodayKey()
  const briefingTab     = tab === 'contenido' ? 'ia' : tab
  const currentBriefing = storage[selectedFecha]?.[briefingTab]
  const isStreaming     = generating && streamType === briefingTab && selectedFecha === today
  const fechasList  = Object.keys(storage)
    .filter(f => storage[f]?.ia || storage[f]?.marketing)
    .sort((a, b) => b.localeCompare(a))
  const hasAny = fechasList.length > 0

  return (
    <div style={s.root}>

      {/* ── HEADER ─────────────────────────────────────── */}
      <header style={s.header}>
        <div style={s.hLeft}>
          <button style={s.menuBtn} onClick={() => setSidebar(o => !o)}>
            {[0,1,2].map(i => <span key={i} style={s.menuLine} />)}
          </button>
          <div style={s.logo}>
            <div style={s.logoIcon}>✦</div>
            <div>
              <div style={s.logoTitle}>Las Noticias del Día</div>
              <div style={s.logoSub}>ORLANDO IGUARÁN · MÉTODO 360™</div>
            </div>
          </div>
        </div>

        <div style={s.hRight}>
          <button
            onClick={handleGenerateToday}
            disabled={generating}
            style={{ ...s.genBtn, opacity: generating ? 0.45 : 1, cursor: generating ? 'not-allowed' : 'pointer' }}
          >
            {generating ? <><span style={s.spinSm} />Generando…</> : <>✦ Generar hoy</>}
          </button>
        </div>
      </header>

      {/* ── TABS ───────────────────────────────────────── */}
      <div style={s.tabs}>
        {([
          { id: 'ia',        label: 'Inteligencia Artificial', color: '#A78BFA' },
          { id: 'marketing', label: 'Marketing',               color: 'var(--accent)' },
          { id: 'contenido', label: 'Contenido de Hoy',        color: '#34D399' },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            ...s.tab,
            color:        tab === t.id ? (t.id === 'contenido' ? '#34D399' : 'var(--accent)') : 'var(--text-muted)',
            fontWeight:   tab === t.id ? 700 : 500,
            borderBottom: tab === t.id ? `2px solid ${t.id === 'contenido' ? '#34D399' : 'var(--accent)'}` : '2px solid transparent',
          }}>
            <span style={{
              ...s.tabDot,
              background: t.color,
              boxShadow:  tab === t.id ? `0 0 8px ${t.color}60` : 'none',
            }} />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── LAYOUT ─────────────────────────────────────── */}
      <div style={s.layout}>

        {/* SIDEBAR */}
        <aside style={{
          ...s.sidebar,
          transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
          visibility: sidebarOpen ? 'visible' : 'hidden',
        }}>
          <div style={s.sbHead}>
            <span style={s.sbTitle}>HISTORIAL</span>
            <button onClick={() => setSidebar(false)} style={s.closeBtn}>✕</button>
          </div>
          {fechasList.length === 0
            ? <div style={s.sbEmpty}>Sin briefings aún.<br />Pulsa «Generar hoy».</div>
            : fechasList.map(f => {
                const tipos = (['ia','marketing'] as const).filter(t => storage[f]?.[t])
                const sel   = f === selectedFecha
                return (
                  <button key={f} onClick={() => { setSel(f); setSidebar(false) }} style={{
                    ...s.sbItem,
                    background: sel ? 'rgba(245,197,24,0.07)' : 'transparent',
                    borderLeft: `2px solid ${sel ? 'var(--accent)' : 'transparent'}`,
                  }}>
                    <div style={{ ...s.sbDay, color: sel ? 'var(--accent)' : 'var(--text)' }}>
                      {formatDateShort(f)}
                    </div>
                    <div style={s.bRow}>
                      {tipos.includes('ia') && <span style={{ ...s.badge, background:'rgba(167,139,250,0.12)', color:'#A78BFA' }}>IA</span>}
                      {tipos.includes('marketing') && <span style={{ ...s.badge, background:'rgba(245,197,24,0.1)', color:'var(--accent)' }}>MKT</span>}
                    </div>
                  </button>
                )
              })
          }
        </aside>

        {sidebarOpen && <div style={s.overlay} onClick={() => setSidebar(false)} />}

        {/* ── CONTENIDO DE HOY TAB ─────────────────────── */}
        {tab === 'contenido' && <ContentView />}

        {/* ── BRIEFING CONTENT ─────────────────────────── */}
        <main style={{ ...s.content, display: tab === 'contenido' ? 'none' : undefined }}>
          {!hydrated ? null

          : isStreaming ? (
            /* ── STREAMING VIEW ── */
            <div>
              <div style={s.streamHeader}>
                <div style={s.streamPulse} />
                <span style={s.streamLabel}>
                  Claude está generando el briefing de {briefingTab === 'ia' ? 'IA' : 'Marketing'}…
                </span>
              </div>
              {streamText ? (
                <div className="briefing-body"
                  dangerouslySetInnerHTML={{ __html: md2html(streamText) }} />
              ) : (
                <div style={s.skeletons}>
                  {[180, 120, 200, 90, 160].map((w, i) => (
                    <div key={i} className="skeleton" style={{ height: 14, width: `${w}px`, maxWidth: '90%', marginBottom: 12 }} />
                  ))}
                </div>
              )}
            </div>

          ) : !currentBriefing ? (
            /* ── EMPTY STATE ── */
            <div style={s.empty}>
              <div style={s.emptyGlyph}>{briefingTab === 'ia' ? '🤖' : '📣'}</div>
              <h2 style={s.emptyTitle}>
                {!hasAny ? 'Las Noticias del Día' : `Briefing de ${briefingTab === 'ia' ? 'IA' : 'Marketing'} no disponible`}
              </h2>
              <p style={s.emptyText}>
                {!hasAny
                  ? 'Lo más relevante de IA y Marketing,\nfiltrado para tu agencia cada mañana.'
                  : `No hay briefing de ${briefingTab === 'ia' ? 'IA' : 'Marketing'} para esta fecha.`}
              </p>
              <button
                onClick={() => !hasAny ? handleGenerateToday() : handleGenerateSingle(selectedFecha, briefingTab)}
                disabled={generating}
                style={{ ...s.emptyBtn, opacity: generating ? 0.5 : 1 }}
              >
                ✦ {!hasAny ? 'Generar primer briefing' : 'Generar ahora'}
              </button>
            </div>

          ) : (
            /* ── BRIEFING ── */
            <div>
              <div style={s.bHead}>
                <div>
                  <div style={{
                    ...s.tipoBadge,
                    background: briefingTab === 'ia' ? 'rgba(167,139,250,0.08)' : 'rgba(245,197,24,0.08)',
                    color:      briefingTab === 'ia' ? '#A78BFA' : 'var(--accent)',
                    border:     `1px solid ${briefingTab === 'ia' ? 'rgba(167,139,250,0.2)' : 'var(--accent-border)'}`,
                  }}>
                    {briefingTab === 'ia' ? '🤖 Inteligencia Artificial' : '📣 Marketing'}
                  </div>
                  <h1 style={s.bDate}>{formatDateLong(selectedFecha)}</h1>
                  <p style={s.bMeta}>
                    Generado a las {new Date(currentBriefing.generado_en)
                      .toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                    {' · '}~{Math.round(currentBriefing.contenido.length / 5)} palabras
                  </p>
                </div>
                {selectedFecha === today && (
                  <button onClick={handleRegenerate} disabled={generating}
                    style={{ ...s.regenBtn, opacity: generating ? 0.4 : 1 }}>
                    ↺ Regenerar
                  </button>
                )}
              </div>
              <div style={s.divider} />
              <div className="briefing-body"
                dangerouslySetInnerHTML={{ __html: md2html(currentBriefing.contenido) }} />
            </div>
          )}
        </main>
      </div>

      {/* ── TOAST ──────────────────────────────────────── */}
      {toast && (
        <div style={{
          ...s.toast,
          background:   toast.type === 'ok' ? 'var(--bg-card)' : '#1A0808',
          borderColor:  toast.type === 'ok' ? 'var(--accent-border)' : 'rgba(248,113,113,0.3)',
          color:        toast.type === 'ok' ? 'var(--text)' : '#F87171',
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

/* ── STYLES ──────────────────────────────────────────── */
const s: Record<string, React.CSSProperties> = {
  root:      { height:'100vh', display:'flex', flexDirection:'column', background:'var(--bg)', overflow:'hidden' },
  header:    { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 24px', height:'58px', background:'var(--bg-card)', borderBottom:'1px solid var(--border)', flexShrink:0, position:'sticky', top:0, zIndex:100 },
  hLeft:     { display:'flex', alignItems:'center', gap:'14px' },
  menuBtn:   { background:'none', border:'none', cursor:'pointer', padding:'6px', display:'flex', flexDirection:'column', gap:'4px', borderRadius:'6px', flexShrink:0 },
  menuLine:  { display:'block', width:'18px', height:'1.5px', background:'var(--text-muted)', borderRadius:'2px' },
  logo:      { display:'flex', alignItems:'center', gap:'12px' },
  logoIcon:  { width:'34px', height:'34px', background:'var(--accent)', borderRadius:'9px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'16px', color:'#0A0A0A', fontWeight:'900', flexShrink:0, boxShadow:'0 0 16px rgba(245,197,24,0.3)' },
  logoTitle: { fontSize:'15px', fontWeight:'800', color:'var(--text)', letterSpacing:'-0.01em' },
  logoSub:   { fontSize:'8px', color:'var(--text-dim)', letterSpacing:'0.12em', fontWeight:'600', marginTop:'1px' },
  hRight:    { display:'flex', alignItems:'center', gap:'12px' },
  genBtn:    { background:'var(--accent)', color:'#0A0A0A', border:'none', borderRadius:'9px', padding:'8px 16px', fontSize:'12px', fontWeight:'800', fontFamily:'inherit', display:'flex', alignItems:'center', gap:'6px', transition:'opacity 0.15s', boxShadow:'0 0 20px rgba(245,197,24,0.2)' },
  spinSm:    { width:'12px', height:'12px', border:'2px solid rgba(10,10,10,0.3)', borderTopColor:'#0A0A0A', borderRadius:'50%', animation:'spin 0.7s linear infinite', display:'inline-block', flexShrink:0 },
  tabs:      { display:'flex', padding:'0 24px', background:'var(--bg-card)', borderBottom:'1px solid var(--border)', flexShrink:0 },
  tab:       { padding:'13px 18px', fontSize:'13px', cursor:'pointer', background:'none', border:'none', fontFamily:'inherit', display:'flex', alignItems:'center', gap:'8px', transition:'all 0.15s' },
  tabDot:    { width:'7px', height:'7px', borderRadius:'50%', flexShrink:0, transition:'box-shadow 0.2s' },
  layout:    { display:'flex', flex:1, overflow:'hidden', position:'relative' },
  sidebar:   { position:'fixed', top:0, left:0, width:'230px', height:'100vh', background:'var(--bg-surface)', borderRight:'1px solid var(--border)', zIndex:200, overflowY:'auto', transition:'transform 0.25s ease, visibility 0.25s', display:'flex', flexDirection:'column' },
  sbHead:    { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 14px', borderBottom:'1px solid var(--border)', flexShrink:0 },
  sbTitle:   { fontSize:'9px', fontWeight:'700', color:'var(--text-dim)', letterSpacing:'0.14em' },
  closeBtn:  { background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', fontSize:'13px', fontFamily:'inherit', padding:'2px 6px', borderRadius:'4px' },
  sbEmpty:   { padding:'16px 14px', fontSize:'11px', color:'var(--text-dim)', lineHeight:'1.7' },
  sbItem:    { width:'100%', padding:'10px 14px', cursor:'pointer', border:'none', fontFamily:'inherit', textAlign:'left', transition:'background 0.12s' },
  sbDay:     { fontSize:'12px', fontWeight:'600' },
  bRow:      { display:'flex', gap:'4px', marginTop:'4px' },
  badge:     { fontSize:'8px', fontWeight:'700', padding:'2px 6px', borderRadius:'10px', letterSpacing:'0.05em' },
  overlay:   { position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:150, backdropFilter:'blur(2px)' },
  content:   { flex:1, overflowY:'auto', padding:'36px 44px', maxWidth:'860px' },
  // Streaming
  streamHeader: { display:'flex', alignItems:'center', gap:'10px', marginBottom:'24px', padding:'12px 16px', background:'rgba(245,197,24,0.06)', border:'1px solid var(--accent-border)', borderRadius:'10px' },
  streamPulse:  { width:'8px', height:'8px', borderRadius:'50%', background:'var(--accent)', flexShrink:0, animation:'pulse 1.2s ease infinite' },
  streamLabel:  { fontSize:'12px', color:'var(--accent)', fontWeight:'600' },
  skeletons:    { paddingTop:'8px' },
  // Empty
  empty:     { display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'420px', gap:'16px', textAlign:'center' },
  emptyGlyph: { fontSize:'48px', marginBottom:'4px' },
  emptyTitle: { fontSize:'20px', fontWeight:'800', color:'var(--text)', letterSpacing:'-0.02em' },
  emptyText:  { fontSize:'14px', color:'var(--text-muted)', lineHeight:'1.7', whiteSpace:'pre-line', maxWidth:'360px' },
  emptyBtn:   { background:'var(--accent)', color:'#0A0A0A', border:'none', borderRadius:'10px', padding:'13px 26px', fontSize:'13px', fontWeight:'800', cursor:'pointer', fontFamily:'inherit', marginTop:'8px', boxShadow:'0 0 24px rgba(245,197,24,0.25)', transition:'opacity 0.15s' },
  // Briefing
  bHead:     { display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:'8px', gap:'16px', animation:'fadeUp 0.3s ease' },
  tipoBadge: { display:'inline-flex', alignItems:'center', gap:'6px', padding:'4px 12px', borderRadius:'20px', fontSize:'10px', fontWeight:'700', letterSpacing:'0.08em', marginBottom:'10px' },
  bDate:     { fontSize:'24px', fontWeight:'900', color:'var(--text)', lineHeight:'1.15', letterSpacing:'-0.02em', textTransform:'capitalize' },
  bMeta:     { fontSize:'11px', color:'var(--text-dim)', marginTop:'6px' },
  divider:   { height:'1px', background:'var(--border)', margin:'20px 0 24px' },
  regenBtn:  { background:'rgba(255,255,255,0.04)', color:'var(--text-muted)', border:'1px solid var(--border-strong)', borderRadius:'9px', padding:'9px 16px', fontSize:'11px', fontWeight:'600', cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap', flexShrink:0 },
  toast:     { position:'fixed', bottom:'24px', right:'24px', border:'1px solid', borderRadius:'10px', padding:'12px 18px', fontSize:'13px', fontWeight:'500', zIndex:999, animation:'fadeUp 0.3s ease', boxShadow:'var(--shadow-lg)' },
}
