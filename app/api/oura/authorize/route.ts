import { NextResponse, type NextRequest } from 'next/server'
import { OAUTH_STATE_COOKIE, OURA_AUTHORIZE_URL, OURA_SCOPES, getRedirectUri } from '@/lib/oura'

export async function GET(request: NextRequest) {
  const clientId = process.env.OURA_CLIENT_ID
  if (!clientId) {
    return NextResponse.redirect(new URL('/?oura=not_configured', request.url))
  }

  const state = crypto.randomUUID()
  const authorizeUrl = new URL(OURA_AUTHORIZE_URL)
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: getRedirectUri(request.nextUrl.origin),
    scope: OURA_SCOPES.join(' '),
    state,
  }).toString()

  const response = NextResponse.redirect(authorizeUrl)
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/api/oura',
    maxAge: 60 * 10,
  })
  return response
}
