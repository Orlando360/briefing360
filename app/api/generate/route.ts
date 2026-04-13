import { NextRequest } from 'next/server'
import { PROMPT_IA, PROMPT_MKT } from '@/lib/prompts'
import { streamClaudeWithRetry } from '@/lib/claude'
import Anthropic from '@anthropic-ai/sdk'

export const runtime = 'edge'
export const maxDuration = 300

// Server-side web search — Anthropic runs the searches, no client execution needed.
// The _20260209 version includes dynamic filtering: Claude writes code to filter
// results before they hit the context window, improving quality and token efficiency.
const WEB_SEARCH_TOOL: Anthropic.Messages.WebSearchTool20260209 = {
  type: 'web_search_20260209',
  name: 'web_search',
}

export async function POST(req: NextRequest) {
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

  const responseStream = new ReadableStream({
    async start(controller) {
      const send = (data: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

      try {
        let fullText = ''
        let messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }]

        // Agentic loop: Claude searches the web, reasons, and writes the briefing.
        // pause_turn means the server-side tool loop hit its 10-call limit — we
        // re-send the conversation so Claude can continue from where it left off.
        for (let iteration = 0; iteration < 5; iteration++) {
          const claudeStream = await streamClaudeWithRetry({
            model: 'claude-opus-4-6',
            max_tokens: 8000,
            thinking: { type: 'adaptive' },
            messages,
            tools: [WEB_SEARCH_TOOL],
          })

          for await (const chunk of claudeStream) {
            // Only stream text deltas — thinking and tool blocks stay internal.
            if (
              chunk.type === 'content_block_delta' &&
              chunk.delta.type === 'text_delta'
            ) {
              fullText += chunk.delta.text
              send({ text: chunk.delta.text })
            }
          }

          const finalMsg = await claudeStream.finalMessage()

          if (finalMsg.stop_reason !== 'pause_turn') break

          // Append assistant turn and continue — the API resumes automatically.
          messages = [
            ...messages,
            { role: 'assistant', content: finalMsg.content },
          ]
        }

        send({ done: true, generado_en: new Date().toISOString(), total: fullText.length })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Error desconocido al generar el briefing'
        console.error('[generate] Anthropic error:', message)
        send({ error: message, done: true })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(responseStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
