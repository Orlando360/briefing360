-- Run this in your Supabase SQL Editor
-- https://app.supabase.com → your project → SQL Editor

CREATE TABLE IF NOT EXISTS public.briefings (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  fecha       DATE NOT NULL,
  tipo        TEXT NOT NULL CHECK (tipo IN ('ia', 'marketing')),
  contenido   TEXT NOT NULL,
  generado_en TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, fecha, tipo)
);

-- Enable Row Level Security
ALTER TABLE public.briefings ENABLE ROW LEVEL SECURITY;

-- Users can only read/write their own briefings
CREATE POLICY "Own briefings only"
  ON public.briefings
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for fast date queries
CREATE INDEX IF NOT EXISTS idx_briefings_user_fecha
  ON public.briefings (user_id, fecha DESC);
