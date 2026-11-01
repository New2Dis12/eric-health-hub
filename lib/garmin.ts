
import 'server-only'
import { Redis } from '@upstash/redis'

const BASE = 'https://personal.connectapi.garmin.com'
const TOKEN_URL = `${BASE}/personalapitoken-service/personal-api/personal-api-key/token`
const TOKEN_KEY = 'garmin:access-token'
const TOKEN_LOCK_KEY = 'garmin:token-lock'

type CachedToken = {
  accessToken: string
  expiresAt: number
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
  if (!key) throw new Error('GARMIN_API_KEY is missing')

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `ApiKey ${key}` },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Garmin authentication failed: HTTP ${response.status}`)
  }

  const raw = (await response.text()).trim()

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

  return {
    accessToken: token,
    expiresAt: tokenExpiration(token),
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

  try {
    if (!forceRefresh) {
      const cached = await redis.get<CachedToken>(TOKEN_KEY)
      if (isValid(cached)) return cached!.accessToken
    }

    const token = await obtainToken()
    const ttl = Math.max(
      1,
      Math.floor((token.expiresAt - Date.now()) / 1000)
    )
    await redis.set(TOKEN_KEY, token, { ex: ttl })
    return token.accessToken
  } finally {
    await redis.del(TOKEN_LOCK_KEY)
  }
}

async function garminGet(path: string): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getToken(attempt === 1)
    const response = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })

    if (response.status === 401 && attempt === 0) continue

    if (!response.ok) {
      throw new Error(`Garmin request failed: HTTP ${response.status}`)
    }

    return response.json()
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
