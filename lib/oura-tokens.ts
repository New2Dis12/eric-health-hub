import 'server-only'
import { Redis } from '@upstash/redis'
import { OURA_TOKEN_URL, type OuraTokenResponse } from '@/lib/oura'

const TOKENS_KEY = 'oura:tokens'
const REFRESH_LOCK_KEY = 'oura:tokens:refresh-lock'
const EXPIRY_SKEW_MS = 60_000
const REFRESH_LOCK_SECONDS = 30

export type StoredOuraTokens = {
  accessToken: string
  refreshToken: string | null
  expiresAt: number
  updatedAt: number
}

export type AccessTokenResult =
  | { status: 'ok'; accessToken: string }
  | { status: 'not_connected' }
  | { status: 'refresh_failed' }
  | { status: 'storage_unavailable' }

let redisClient: Redis | null = null

function getRedis() {
  const url = process.env.UPSTASH_REDIS_KV_REST_API_URL
  const token = process.env.UPSTASH_REDIS_KV_REST_API_TOKEN
  if (!url || !token) return null
  redisClient ??= new Redis({ url, token })
  return redisClient
}

export function isTokenStorageConfigured() {
  return getRedis() !== null
}

function toStoredTokens(response: OuraTokenResponse, previousRefreshToken: string | null): StoredOuraTokens {
  const now = Date.now()
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? previousRefreshToken,
    expiresAt: now + response.expires_in * 1000,
    updatedAt: now,
  }
}

export async function saveOuraTokens(response: OuraTokenResponse) {
  const redis = getRedis()
  if (!redis) throw new Error('Upstash Redis is not configured')
  const tokens = toStoredTokens(response, null)
  await redis.set(TOKENS_KEY, tokens)
  return tokens
}

async function readStoredTokens(redis: Redis) {
  return redis.get<StoredOuraTokens>(TOKENS_KEY)
}

async function requestTokenRefresh(refreshToken: string): Promise<OuraTokenResponse | null> {
  const clientId = process.env.OURA_CLIENT_ID
  const clientSecret = process.env.OURA_CLIENT_SECRET
  if (!clientId || !clientSecret) return null

  const response = await fetch(OURA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    cache: 'no-store',
  })

  if (!response.ok) {
    console.error('Oura token refresh failed with status', response.status)
    return null
  }
  return (await response.json()) as OuraTokenResponse
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function refreshStoredTokens(redis: Redis, current: StoredOuraTokens): Promise<AccessTokenResult> {
  if (!current.refreshToken) return { status: 'refresh_failed' }

  // Oura refresh tokens are single-use, so only one request may spend it at a time.
  const lockAcquired = await redis.set(REFRESH_LOCK_KEY, '1', { nx: true, ex: REFRESH_LOCK_SECONDS })
  if (!lockAcquired) {
    for (let attempt = 0; attempt < 10; attempt++) {
      await sleep(500)
      const latest = await readStoredTokens(redis)
      if (latest && latest.updatedAt > current.updatedAt) {
        return { status: 'ok', accessToken: latest.accessToken }
      }
    }
    return { status: 'refresh_failed' }
  }

  try {
    const latest = await readStoredTokens(redis)
    if (latest && latest.updatedAt > current.updatedAt && latest.expiresAt - EXPIRY_SKEW_MS > Date.now()) {
      return { status: 'ok', accessToken: latest.accessToken }
    }

    const refreshed = await requestTokenRefresh(current.refreshToken)
    if (!refreshed) return { status: 'refresh_failed' }

    const tokens = toStoredTokens(refreshed, current.refreshToken)
    await redis.set(TOKENS_KEY, tokens)
    return { status: 'ok', accessToken: tokens.accessToken }
  } finally {
    await redis.del(REFRESH_LOCK_KEY)
  }
}

export async function getValidOuraAccessToken(options: { forceRefresh?: boolean } = {}): Promise<AccessTokenResult> {
  const redis = getRedis()
  if (!redis) return { status: 'storage_unavailable' }

  try {
    const tokens = await readStoredTokens(redis)
    if (!tokens?.accessToken) return { status: 'not_connected' }

    const isExpired = tokens.expiresAt - EXPIRY_SKEW_MS <= Date.now()
    if (!isExpired && !options.forceRefresh) {
      return { status: 'ok', accessToken: tokens.accessToken }
    }
    return await refreshStoredTokens(redis, tokens)
  } catch (error) {
    console.error('Failed to read or refresh Oura tokens from Redis', error)
    return { status: 'storage_unavailable' }
  }
}

export async function hasStoredOuraTokens() {
  const redis = getRedis()
  if (!redis) return false
  try {
    return (await redis.exists(TOKENS_KEY)) === 1
  } catch {
    return false
  }
}
