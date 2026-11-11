import 'server-only'
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { ApiError, requireBrowserSubject, requireSameOrigin } from '../private-api'
import { isAllowedSubject } from '../web-auth'

export type TrainingScope = 'training.read' | 'training.write'
export type TrainingPrincipal = { subject: string; scopes: readonly TrainingScope[]; source: 'browser' | 'api' }
import { mcpResourceUrl } from '../mcp-resource'
let keySet: { domain: string; getKey: JWTVerifyGetKey } | undefined

// Additive verifier: existing HealthScope and /mcp semantics remain unchanged.
export async function verifyTrainingBearer(header: string | null, testKey?: JWTVerifyGetKey): Promise<TrainingPrincipal | null> {
  const match = /^Bearer (\S+)$/i.exec(header ?? '')
  if (!match) return null
  try {
    const audience = mcpResourceUrl()
    if (!audience) return null
    const domain = process.env.AUTH0_DOMAIN?.replace(/^https?:\/\//, '').replace(/\/$/, '')
    if (!domain) return null
    if (!testKey && keySet?.domain !== domain) keySet = { domain, getKey: createRemoteJWKSet(new URL(`https://${domain}/.well-known/jwks.json`)) }
    const { payload } = await jwtVerify(match[1], testKey ?? keySet!.getKey, {
      issuer: `https://${domain}/`, audience, algorithms: ['RS256'], clockTolerance: 30,
      requiredClaims: ['sub', 'exp', 'iat'],
    })
    if (!isAllowedSubject(payload.sub)) return null
    const scopes = (typeof payload.scope === 'string' ? payload.scope.split(/\s+/) : [])
      .filter((s): s is TrainingScope => s === 'training.read' || s === 'training.write')
    return { subject: payload.sub, scopes, source: 'api' }
  } catch { return null }
}

export function assertTrainingAccess(principal: TrainingPrincipal, scope: TrainingScope) {
  if (!isAllowedSubject(principal?.subject)) throw new ApiError(403, 'Forbidden')
  if (!principal.scopes.includes(scope)) throw new ApiError(403, 'Insufficient training scope')
}

export async function requireTrainingPrincipal(request: Request, scope: TrainingScope): Promise<TrainingPrincipal> {
  let principal: TrainingPrincipal
  // An invalid bearer token cannot fall back to a valid browser session.
  if (request.headers.has('authorization')) {
    const token = await verifyTrainingBearer(request.headers.get('authorization'))
    if (!token) throw new ApiError(401, 'Unauthorized')
    principal = token
  } else {
    const subject = await requireBrowserSubject(request)
    if (scope === 'training.write') requireSameOrigin(request)
    principal = { subject, scopes: ['training.read', 'training.write'], source: 'browser' }
  }
  assertTrainingAccess(principal, scope)
  return principal
}
