
import 'server-only'
import { createRemoteJWKSet, jwtVerify } from 'jose'

const RESOURCE = 'https://eric-health-hub.vercel.app/mcp'

export type HealthScope = 'oura.read' | 'garmin.read'

export type VerifiedHealthToken = {
  subject: string
  scopes: HealthScope[]
}

let cachedDomain: string | undefined
let cachedJWKS: ReturnType<typeof createRemoteJWKSet> | undefined

function getAuth0Config() {
  const domain = process.env.AUTH0_DOMAIN
    ?.replace(/^https?:\/\//, '')
    .replace(/\/$/, '')

  if (!domain) {
    throw new Error('AUTH0_DOMAIN is not configured')
  }

  if (domain !== cachedDomain || !cachedJWKS) {
    cachedDomain = domain
    cachedJWKS = createRemoteJWKSet(
      new URL(`https://${domain}/.well-known/jwks.json`),
    )
  }

  return {
    issuer: `https://${domain}/`,
    jwks: cachedJWKS,
  }
}

export async function verifyHealthToken(
  authorizationHeader: string | null,
): Promise<VerifiedHealthToken | null> {
  if (!authorizationHeader) return null

  const match = /^Bearer (.+)$/i.exec(authorizationHeader)
  if (!match) return null

  try {
    const { issuer, jwks } = getAuth0Config()

    const { payload } = await jwtVerify(match[1], jwks, {
      issuer,
      audience: RESOURCE,
      algorithms: ['RS256'],
      clockTolerance: 30,
    })

    const allowedSubject = process.env.AUTH0_ALLOWED_SUB

    if (
    !allowedSubject ||
    typeof payload.sub !== 'string' ||
    payload.sub !== allowedSubject
    ) {
    return null
    }

    const rawScopes =
      typeof payload.scope === 'string'
        ? payload.scope.split(/\s+/)
        : []

    const scopes = rawScopes.filter(
      (scope): scope is HealthScope =>
        scope === 'oura.read' || scope === 'garmin.read',
    )

    if (scopes.length === 0) return null

    return {
      subject: payload.sub,
      scopes,
    }
  } catch (error) {
    console.error(
      'Auth0 access token verification failed',
      error instanceof Error ? error.name : 'Unknown error',
    )
    return null
  }
}
