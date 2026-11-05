import { requireHealthAccess, apiError } from '@/lib/private-api'
import { NextResponse } from 'next/server'
import { getOuraTestResultFromStore } from '@/lib/oura-data'

export const dynamic = 'force-dynamic'

const httpStatusByResult = {
  success: 200,
  not_connected: 401,
  unauthorized: 401,
  error: 502,
} as const

export async function GET(request: Request) {
  try { await requireHealthAccess(request, 'oura.read') } catch (error) { return apiError(error) }
  const result = await getOuraTestResultFromStore()
  return NextResponse.json(result, {
    status: httpStatusByResult[result.status],
    headers: { 'Cache-Control': 'no-store' },
  })
}
