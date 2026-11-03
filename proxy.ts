import { NextResponse, type NextRequest } from 'next/server'
import { getWebAuth } from './lib/web-auth'

export async function proxy(request: NextRequest) {
  // Only mount login/logout/callback. No provider/MCP request crosses the SDK.
  if (!['/auth/login', '/auth/logout', '/auth/callback'].includes(request.nextUrl.pathname)) {
    return new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }
  try {
    const response = await getWebAuth().middleware(request)
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch {
    return new NextResponse('Authentication unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}

export const config = { matcher: ['/auth/:path*'] }
