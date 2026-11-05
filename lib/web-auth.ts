import 'server-only'
import { NextRequest } from 'next/server'
import { Auth0Client } from '@auth0/nextjs-auth0/server'

let client: Auth0Client | undefined

// Separate from MCP: missing browser configuration must never break /mcp.
export function getWebAuth(): Auth0Client {
  const { AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_SECRET, APP_BASE_URL } = process.env
  if (!AUTH0_DOMAIN || !AUTH0_CLIENT_ID || !AUTH0_CLIENT_SECRET || !AUTH0_SECRET || !APP_BASE_URL) {
    throw new Error('Browser authentication is not configured')
  }
  if (!/^[0-9a-f]{64}$/i.test(AUTH0_SECRET)) throw new Error('Invalid browser session secret')
  const base = new URL(APP_BASE_URL)
  if (base.pathname !== '/' || base.search || base.hash || base.username || base.password ||
    (base.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && base.hostname === 'localhost' && base.protocol === 'http:'))) {
    throw new Error('Invalid application origin')
  }
  return client ??= new Auth0Client({
    domain: AUTH0_DOMAIN,
    clientId: AUTH0_CLIENT_ID,
    clientSecret: AUTH0_CLIENT_SECRET,
    secret: AUTH0_SECRET,
    appBaseUrl: base.origin,
    authorizationParameters: { scope: 'openid profile email' },
    enableAccessTokenEndpoint: false,
    session: {
      rolling: false,
      absoluteDuration: 60 * 60 * 8,
      cookie: { secure: base.protocol === 'https:', sameSite: 'lax', path: '/' },
    },
    transactionCookie: { secure: base.protocol === 'https:', sameSite: 'lax', path: '/' },
    beforeSessionSaved: async session => {
      if (!isAllowedSubject(session.user.sub)) throw new Error('Access denied')
      return session
    },
  })
}

export function isAllowedSubject(subject: unknown): subject is string {
  return typeof subject === 'string' && !!process.env.AUTH0_ALLOWED_SUB && subject === process.env.AUTH0_ALLOWED_SUB
}

export async function getWebSubject(request?: Request): Promise<string | null> {
  const auth = getWebAuth()
  const session = request ? await auth.getSession(new NextRequest(request.url, { headers: request.headers })) : await auth.getSession()
  if (!session || !Number.isFinite(session.internal.createdAt) ||
    session.internal.createdAt + 60 * 60 * 8 <= Date.now() / 1000) return null
  return isAllowedSubject(session.user.sub) ? session.user.sub : null
}
