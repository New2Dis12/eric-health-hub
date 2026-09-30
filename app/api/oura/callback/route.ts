import { NextResponse, type NextRequest } from 'next/server'
import {
  ACCESS_TOKEN_COOKIE,
  OAUTH_STATE_COOKIE,
  OURA_TOKEN_URL,
  OURA_REDIRECT_URI,
  REFRESH_TOKEN_COOKIE,
  type OuraTokenResponse,
} from '@/lib/oura'

function redirectHome(request: NextRequest, status: string) {
  const response = NextResponse.redirect(new URL(`/?oura=${status}`, request.url))
  response.cookies.delete({ name: OAUTH_STATE_COOKIE, path: '/api/oura' })
  return response
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const oauthError = searchParams.get('error')

  if (oauthError) {
    return redirectHome(request, oauthError === 'access_denied' ? 'denied' : 'error')
  }

  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value
  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectHome(request, 'invalid_state')
  }

  const clientId = process.env.OURA_CLIENT_ID
  const clientSecret = process.env.OURA_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return redirectHome(request, 'not_configured')
  }

  let tokens: OuraTokenResponse
  try {
    const tokenResponse = await fetch(OURA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: OURA_REDIRECT_URI,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      cache: 'no-store',
    })

    if (!tokenResponse.ok) {
      console.error('Oura token exchange failed with status', tokenResponse.status)
      return redirectHome(request, 'error')
    }

    tokens = (await tokenResponse.json()) as OuraTokenResponse
  } catch (error) {
    console.error('Oura token exchange request failed', error)
    return redirectHome(request, 'error')
  }

  const response = redirectHome(request, 'connected')
  const cookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    path: '/',
  }

  response.cookies.set(ACCESS_TOKEN_COOKIE, tokens.access_token, {
    ...cookieOptions,
    maxAge: tokens.expires_in,
  })
  if (tokens.refresh_token) {
    response.cookies.set(REFRESH_TOKEN_COOKIE, tokens.refresh_token, {
      ...cookieOptions,
      maxAge: 60 * 60 * 24 * 30,
    })
  }

  return response
}
