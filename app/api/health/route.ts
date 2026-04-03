import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const checks: Record<string, string> = { app: 'ok' }
  let healthy = true

  // Check Supabase
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (url && key) {
      const res = await fetch(`${url}/rest/v1/briefings?select=id&limit=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(5000),
      })
      checks.supabase = res.ok ? 'ok' : `error: ${res.status}`
      if (!res.ok) healthy = false
    } else {
      checks.supabase = 'missing env vars'
      healthy = false
    }
  } catch (e) {
    checks.supabase = `error: ${(e as Error).message}`
    healthy = false
  }

  // Check Claude API key
  checks.claude_key = process.env.ANTHROPIC_API_KEY ? 'configured' : 'missing'
  if (!process.env.ANTHROPIC_API_KEY) healthy = false

  // Check APP_SECRET
  checks.app_secret = process.env.APP_SECRET ? 'configured' : 'missing'

  return NextResponse.json(
    { status: healthy ? 'healthy' : 'degraded', checks, timestamp: new Date().toISOString() },
    { status: healthy ? 200 : 503 }
  )
}
