
import 'server-only'
import { Redis } from '@upstash/redis'
import { readLimitedResponse } from './limited-response'
import { decodeGarminFitArchive } from './fit-activity'

const BASE = 'https://personal.connectapi.garmin.com'
const TOKEN_URL = `${BASE}/personalapitoken-service/personal-api/personal-api-key/token`
const TOKEN_KEY = 'garmin:access-token'
const TOKEN_LOCK_KEY = 'garmin:token-lock'

type CachedToken = {
  accessToken: string
  expiresAt: number
}

type GarminFailureStage = 'key_configuration' | 'token_cache' | 'token_exchange' | 'token_response' | 'activity_request' | 'activity_response'

export class GarminRequestError extends Error {
  constructor(readonly stage: GarminFailureStage, message: string, readonly status?: number) {
    super(message)
  }
}

function getRedis() {
  const url = process.env.UPSTASH_REDIS_KV_REST_API_URL
  const token = process.env.UPSTASH_REDIS_KV_REST_API_TOKEN
  if (!url || !token) throw new Error('Redis is not configured')
  return new Redis({ url, token })
}

function tokenExpiration(token: string): number {
  const payload = token.split('.')[1]
  if (!payload) throw new Error('Invalid Garmin access token')

  const decoded = JSON.parse(
    Buffer.from(payload, 'base64url').toString('utf8')
  ) as { exp?: number }

  if (typeof decoded.exp !== 'number') {
    throw new Error('Garmin token has no expiration')
  }
  return decoded.exp * 1000
}

async function obtainToken(): Promise<CachedToken> {
  const key = process.env.GARMIN_API_KEY
  if (!key) throw new GarminRequestError('key_configuration', 'GARMIN_API_KEY is missing')

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `ApiKey ${key}` },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {
    throw new GarminRequestError('token_exchange', 'Garmin token exchange failed')
  })

  if (!response.ok) {
    throw new GarminRequestError('token_exchange', `Garmin authentication failed: HTTP ${response.status}`, response.status)
  }

  const raw = (await readLimitedResponse(response, 16 * 1024).catch(() => {
    throw new GarminRequestError('token_response', 'Garmin token response is unreadable', response.status)
  })).toString('utf8').trim()

  let token = raw
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'string') token = parsed
    else if (
      parsed &&
      typeof parsed === 'object' &&
      'access_token' in parsed &&
      typeof parsed.access_token === 'string'
    ) {
      token = parsed.access_token
    }
  } catch {
    // Garmin may return a raw JWT.
  }

  try {
    return { accessToken: token, expiresAt: tokenExpiration(token) }
  } catch {
    throw new GarminRequestError('token_response', 'Garmin token response is invalid', response.status)
  }
}

async function getToken(forceRefresh = false): Promise<string> {
  const redis = getRedis()
  const isValid = (token: CachedToken | null) =>
    token && token.expiresAt > Date.now() + 60_000

  if (!forceRefresh) {
    const cached = await redis.get<CachedToken>(TOKEN_KEY)
    if (isValid(cached)) return cached!.accessToken
  }

  const locked = await redis.set(TOKEN_LOCK_KEY, '1', {
    nx: true,
    ex: 30,
  })

  if (!locked) {
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 500))
      const cached = await redis.get<CachedToken>(TOKEN_KEY)
      if (isValid(cached)) return cached!.accessToken
    }
    throw new Error('Garmin token refresh is busy')
  }

  let succeeded = false
  try {
    if (!forceRefresh) {
      const cached = await redis.get<CachedToken>(TOKEN_KEY)
      if (isValid(cached)) {
        succeeded = true
        return cached!.accessToken
      }
    }

    const token = await obtainToken()
    const ttl = Math.max(
      1,
      Math.floor((token.expiresAt - Date.now()) / 1000)
    )
    await redis.set(TOKEN_KEY, token, { ex: ttl })
    succeeded = true
    return token.accessToken
  } finally {
    try {
      await redis.del(TOKEN_LOCK_KEY)
    } catch (error) {
      // The lock expires automatically. Preserve any earlier failure for diagnosis.
      if (succeeded) throw error
    }
  }
}

async function garminGet(path: string, binary = false): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getToken(attempt === 1).catch(error => {
      if (error instanceof GarminRequestError) throw error
      throw new GarminRequestError('token_cache', 'Garmin token cache failed')
    })
    const response = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    }).catch(() => {
      throw new GarminRequestError('activity_request', 'Garmin activity request failed')
    })

    if (response.status === 401 && attempt === 0) {
      await response.body?.cancel()
      continue
    }

    if (!response.ok) {
      await response.body?.cancel()
      throw new GarminRequestError('activity_request', `Garmin request failed: HTTP ${response.status}`, response.status)
    }

    if (binary) return readLimitedResponse(response, 16 * 1024 * 1024)
    try {
      const bytes = await readLimitedResponse(response, 512 * 1024)
      return JSON.parse(bytes.toString('utf8'))
    } catch {
      throw new GarminRequestError('activity_response', 'Garmin activity response is invalid', response.status)
    }
  }

  throw new Error('Garmin authorization failed')
}

export async function getGarminActivities(limit = 20) {
  const count = Math.max(1, Math.min(50, Math.floor(limit)))
  const params = new URLSearchParams({
    start: '0',
    limit: String(count),
  })

  return garminGet(
    `/activitylist-service/activities/search/activities?${params}`
  )
}

export async function getGarminActivity(activityId: number) {
  if (!Number.isSafeInteger(activityId) || activityId <= 0) {
    throw new Error('Invalid Garmin activity ID')
  }

  return garminGet(`/activity-service/activity/${activityId}`)
}

export async function getGarminActivityFit(
  activityId: number,
  everySeconds = 1,
  maxSamples = 1000,
  startSeconds = 0,
  lapStartIndex = 0,
  maxLaps = 100,
) {
  if (!Number.isSafeInteger(activityId) || activityId <= 0) {
    throw new Error('Invalid Garmin activity ID')
  }
  const archive = await garminGet(`/download-service/files/activity/${activityId}`, true) as Buffer
  return { activityId, ...decodeGarminFitArchive(archive, everySeconds, maxSamples, startSeconds, lapStartIndex, maxLaps) }
}
