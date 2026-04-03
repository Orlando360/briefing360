import { NextRequest } from 'next/server'
import { PROMPT_IA, PROMPT_MKT } from '@/lib/prompts'
import { streamClaudeWithRetry } from '@/lib/claude'

export const runtime = 'edge'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const appSecret = process.env.APP_SECRET
  if (!appSecret || authHeader !== `Bearer ${appSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const { fecha, tipo } = await req.json()

  if (!['ia', 'marketing'].includes(tipo)) {
    return new Response(JSON.stringify({ error: 'Tipo inválido' }), { status: 400 })
  }

  const dateObj = new Date(fecha + 'T12:00:00')
  const fechaTxt = dateObj.toLocaleDateString('es-CO', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  const prompt = (tipo === 'ia' ? PROMPT_IA : PROMPT_MKT).replace(/{fecha}/g, fechaTxt)

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

      try {
        let fullText = ''
        const anthropicStream = await streamClaudeWithRetry({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          messages: [{ role: 'user', content: prompt }],
        })

        for await (const chunk of anthropicStream) {
          if (
            chunk.type === 'content_block_delta' &&
            chunk.delta.type === 'text_delta'
          ) {
            fullText += chunk.delta.text
            send({ text: chunk.delta.text })
          }
        }

        send({ done: true, generado_en: new Date().toISOString(), total: fullText.length })
      } catch (err: unknown) {
        const e = err as { message?: string }
        send({ error: e?.message || 'Error al generar' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
