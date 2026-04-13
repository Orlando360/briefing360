/**
 * anthropic-retry.ts
 * Wrapper universal para llamadas a la Anthropic API con retry automático.
 * Aplica en TODOS los API routes del ecosistema Orlando 360™.
 *
 * Errores cubiertos:
 *  - 529: Overloaded
 *  - 429: Rate limit (respeta Retry-After header)
 *  - 503: Service unavailable
 *  - 500: Internal server error (transiente)
 *
 * Para rutas SSE/streaming usa streamClaudeWithRetry de @/lib/claude.
 */

const RETRY_STATUS_CODES = new Set([429, 500, 503, 529])
const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000 // 1s → 2s → 4s (+ jitter)

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | Array<{ type: string; text?: string }>
}

interface AnthropicRequest {
  model: string
  max_tokens: number
  messages: AnthropicMessage[]
  system?: string
  [key: string]: unknown
}

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>
  usage?: { input_tokens: number; output_tokens: number }
  model?: string
  stop_reason?: string
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function jitteredDelay(attempt: number): number {
  const base = BASE_DELAY_MS * Math.pow(2, attempt - 1) // 1s, 2s, 4s
  return base + Math.random() * base * 0.5              // +0–50% jitter
}

export async function callAnthropicWithRetry(
  requestBody: AnthropicRequest,
  apiKey: string,
): Promise<AnthropicResponse> {
  if (requestBody.stream === true) {
    throw new Error('Use streaming-specific handler for stream requests')
  }

  let lastError: Error | null = null

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let response: Response

    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(requestBody),
      })
    } catch (err) {
      // Network error — fetch itself threw (no HTTP response)
      if (err instanceof TypeError) {
        lastError = err
        if (attempt < MAX_RETRIES) {
          const delayMs = jitteredDelay(attempt)
          console.warn(
            `[AnthropicRetry] Network error on attempt ${attempt}/${MAX_RETRIES}. ` +
            `Retrying in ${Math.round(delayMs)}ms...`,
          )
          await sleep(delayMs)
          continue
        }
      }
      throw err
    }

    if (response.ok) {
      return response.json() as Promise<AnthropicResponse>
    }

    let errorBody: { error?: { message?: string; type?: string } } = {}
    try { errorBody = await response.json() } catch { /* ignore parse failure */ }

    const errorMessage = errorBody?.error?.message ?? `HTTP ${response.status}`
    const errorType    = errorBody?.error?.type    ?? 'unknown_error'

    if (RETRY_STATUS_CODES.has(response.status)) {
      lastError = new Error(`[${errorType}] ${errorMessage}`)

      if (attempt < MAX_RETRIES) {
        // Respect Retry-After for 429s; fall back to jittered exponential backoff
        let delayMs = jitteredDelay(attempt)
        const retryAfter = response.headers.get('retry-after')
        if (retryAfter) {
          const serverDelay = parseInt(retryAfter, 10) * 1000
          if (!isNaN(serverDelay)) delayMs = serverDelay
        }

        console.warn(
          `[AnthropicRetry] Attempt ${attempt}/${MAX_RETRIES} failed ` +
          `(${response.status}: ${errorType}). Retrying in ${Math.round(delayMs)}ms...`,
        )
        await sleep(delayMs)
        continue
      }

      // Retriable error but out of attempts
      break
    }

    // Non-retriable error — fail immediately
    throw new Error(`[Anthropic ${response.status}] ${errorMessage}`)
  }

  throw lastError ?? new Error('Unknown Anthropic API error after 3 attempts')
}
