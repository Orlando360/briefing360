import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ fecha: string; tipo: string }> }
) {
  const { fecha, tipo } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!['ia', 'marketing'].includes(tipo)) {
    return NextResponse.json({ error: 'Tipo inválido' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('briefings')
    .select('contenido, generado_en')
    .eq('user_id', user.id)
    .eq('fecha', fecha)
    .eq('tipo', tipo)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(data)
}
