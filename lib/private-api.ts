import 'server-only'
import { getWebSubject } from './web-auth'
import { verifyHealthToken, type HealthScope } from './auth0'

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export function privateJson(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' } })
}

export function apiError(error: unknown) {
  return error instanceof ApiError
    ? privateJson({ error: error.message }, error.status)
    : privateJson({ error: 'Service unavailable' }, 503)
}

export async function requireBrowserSubject(request?: Request): Promise<string> {
  const subject = await getWebSubject(request)
  if (!subject) throw new ApiError(401, 'Unauthorized')
  return subject
}

export async function requireHealthAccess(request: Request, scope: HealthScope) {
  if (request.headers.has('authorization')) {
    const token = await verifyHealthToken(request.headers.get('authorization'))
    if (!token) throw new ApiError(401, 'Unauthorized')
    if (!token.scopes.includes(scope)) throw new ApiError(403, 'Forbidden')
    return token.subject
  }
  return requireBrowserSubject(request)
}

// Never derive the trusted origin from Host/X-Forwarded-Host.
export function requireSameOrigin(request: Request) {
  const origin = request.headers.get('origin')
  const configured = process.env.APP_BASE_URL
  if (!configured || origin !== new URL(configured).origin || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new ApiError(403, 'Invalid request origin')
  }
}
