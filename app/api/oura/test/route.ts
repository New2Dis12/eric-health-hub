import { NextResponse, type NextRequest } from 'next/server'
import { ACCESS_TOKEN_COOKIE } from '@/lib/oura'
import { getOuraTestResult } from '@/lib/oura-data'

export const dynamic = 'force-dynamic'

const httpStatusByResult = {
  success: 200,
  not_connected: 401,
  unauthorized: 401,
  error: 502,
} as const

export async function GET(request: NextRequest) {
  const result = await getOuraTestResult(request.cookies.get(ACCESS_TOKEN_COOKIE)?.value)
  return NextResponse.json(result, {
    status: httpStatusByResult[result.status],
    headers: { 'Cache-Control': 'no-store' },
  })
}
