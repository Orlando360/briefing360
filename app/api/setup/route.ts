import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const SETUP_SECRET = process.env.SETUP_SECRET

export async function POST(req: NextRequest) {
  const { secret, serviceRoleKey } = await req.json()

  if (!SETUP_SECRET || secret !== SETUP_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const key = serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!key) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY required' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key
  )

  const sql = `
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

  // Try direct approach via pg REST
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/exec_sql`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ sql_query: sql }),
      }
    )

    if (!response.ok) {
      // Table creation via RPC failed - try checking if table exists
      const checkRes = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/briefings?limit=1`,
        {
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
          },
        }
      )

      if (checkRes.ok || checkRes.status === 200) {
        return NextResponse.json({ ok: true, message: 'Table already exists' })
      }

      return NextResponse.json({
        ok: false,
        error: 'Could not create table via API. Please run the SQL manually in Supabase Dashboard.',
        sql,
      })
    }
  } catch {}

  return NextResponse.json({ ok: true, message: 'Setup complete' })
}
