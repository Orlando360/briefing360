import { NextRequest } from 'next/server'
import { PROMPT_CONTENIDO } from '@/lib/prompt-content'
import { streamClaudeWithRetry } from '@/lib/claude'

export const runtime   = 'edge'
export const maxDuration = 300

/* ── RSS fetcher ──────────────────────────────────────── */
async function fetchRSSNews(query: string, max = 6): Promise<string[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=es&gl=CO&ceid=CO:es`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)' },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return []
    const xml = await res.text()

    const items: string[] = []
    // Extract CDATA titles
    const cdataRe = /<item>[\s\S]*?<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/g
    // Extract plain titles
    const plainRe = /<item>[\s\S]*?<title>([\s\S]*?)<\/title>/g

    const re = xml.includes('CDATA') ? cdataRe : plainRe
    let m: RegExpExecArray | null
    while ((m = re.exec(xml)) !== null && items.length < max) {
      const title = m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
      if (title && title.length > 10) items.push(title)
    }
    return items
  } catch {
    return []
  }
}

async function getNewsContext(): Promise<string> {
  const [iaNews, mktNews] = await Promise.all([
    fetchRSSNews('inteligencia artificial IA tecnología', 6),
    fetchRSSNews('marketing digital instagram tiktok influencer', 6),
  ])

  const lines: string[] = []

  if (iaNews.length > 0) {
    lines.push('📡 NOTICIAS DE IA Y TECNOLOGÍA:')
    iaNews.forEach((t, i) => lines.push(`${i + 1}. ${t}`))
  }
  if (mktNews.length > 0) {
    lines.push('\n📣 NOTICIAS DE MARKETING DIGITAL:')
    mktNews.forEach((t, i) => lines.push(`${i + 1}. ${t}`))
  }

  if (lines.length === 0) {
    lines.push('(No se pudieron obtener noticias externas — usa tu conocimiento actualizado sobre tendencias de IA y marketing del momento)')
  }

  return lines.join('\n')
}

/* ── Route handler ──────────────────────────────────── */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const appSecret = process.env.APP_SECRET
  if (!appSecret || authHeader !== `Bearer ${appSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const { fecha } = await req.json().catch(() => ({ fecha: new Date().toISOString().split('T')[0] }))

  const dateObj  = new Date((fecha || new Date().toISOString().split('T')[0]) + 'T12:00:00')
  const fechaTxt = dateObj.toLocaleDateString('es-CO', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  // Fetch real news
  const noticias = await getNewsContext()

  const prompt = PROMPT_CONTENIDO
    .replace('{fecha}', fechaTxt)
    .replace('{noticias}', noticias)

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (d: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(d)}\n\n`))

      // Send news first so client knows what was used
      send({ news: noticias })

      try {
        let full = ''
        const aStream = await streamClaudeWithRetry({
          model:      'claude-opus-4-7',
          max_tokens: 5600,
          messages:   [{ role: 'user', content: prompt }],
        })

        for await (const chunk of aStream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            full += chunk.delta.text
            send({ text: chunk.delta.text })
          }
        }

        send({ done: true, generado_en: new Date().toISOString(), chars: full.length })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Error desconocido al generar el contenido'
        console.error('[content] Anthropic error:', message)
        send({ error: message, done: true })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':    'text/event-stream',
      'Cache-Control':   'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
