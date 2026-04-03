#!/usr/bin/env node
/**
 * BRIEFING 360™ — Database Setup
 *
 * Crea la tabla 'briefings' en tu proyecto de Supabase.
 *
 * Uso:
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... node scripts/setup-db.js
 *
 * O con el .env.local:
 *   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=eyJ... node scripts/setup-db.js
 */

const https = require('https')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://loiuvsfmrejxfaotlxvn.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SERVICE_ROLE_KEY) {
  console.error('\n❌ Error: SUPABASE_SERVICE_ROLE_KEY no encontrada.')
  console.error('\nUso: SUPABASE_SERVICE_ROLE_KEY=eyJ... node scripts/setup-db.js')
  console.error('\nEncuéntrala en: https://supabase.com/dashboard/project/loiuvsfmrejxfaotlxvn/settings/api\n')
  process.exit(1)
}

const SQL = `
CREATE TABLE IF NOT EXISTS public.briefings (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  fecha       DATE NOT NULL,
  tipo        TEXT NOT NULL CHECK (tipo IN ('ia', 'marketing')),
  contenido   TEXT NOT NULL,
  generado_en TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, fecha, tipo)
);

ALTER TABLE public.briefings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'briefings' AND policyname = 'Own briefings only'
  ) THEN
    CREATE POLICY "Own briefings only"
      ON public.briefings
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_briefings_user_fecha
  ON public.briefings (user_id, fecha DESC);
`

async function request(url, options, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const opts = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    }
    const req = https.request(opts, (res) => {
      let data = ''
      res.on('data', (chunk) => data += chunk)
      res.on('end', () => resolve({ status: res.statusCode, body: data }))
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

async function main() {
  console.log('\n🏗️  Briefing 360™ — Database Setup')
  console.log('=====================================')
  console.log(`📡 Supabase: ${SUPABASE_URL}`)
  console.log()

  // Check if table exists
  console.log('🔍 Verificando tabla briefings...')
  const check = await request(`${SUPABASE_URL}/rest/v1/briefings?limit=1`, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    }
  })

  if (check.status === 200) {
    console.log('✅ La tabla briefings ya existe!')
    console.log('\n🚀 Todo listo. Visita: https://briefing360.vercel.app\n')
    return
  }

  // Try to create via SQL API
  console.log('📦 Creando tabla briefings...')

  // The SQL endpoint requires special permissions
  // Let's try the pg-meta endpoint if available
  const res = await request(
    `${SUPABASE_URL}/rest/v1/rpc/exec_sql`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      }
    },
    { sql_query: SQL }
  )

  if (res.status < 400) {
    console.log('✅ Tabla creada exitosamente!')
  } else {
    console.log('\n⚠️  No se pudo crear automáticamente.')
    console.log('\n📋 Copia y pega este SQL en el Supabase Dashboard:')
    console.log('   https://supabase.com/dashboard/project/loiuvsfmrejxfaotlxvn/sql/new')
    console.log('\n' + '─'.repeat(60))
    console.log(SQL.trim())
    console.log('─'.repeat(60))
  }

  console.log('\n🚀 App desplegada: https://briefing360.vercel.app\n')
}

main().catch(console.error)
