import { NextResponse } from 'next/server'

// Storage is handled client-side via localStorage
export async function GET() {
  return NextResponse.json([])
}
