import assert from 'node:assert/strict'
import { test, afterEach, mock } from 'node:test'
import { getValidOuraAccessToken, type StoredOuraTokens } from '../lib/oura-tokens'
import { getOuraTestResultFromStore } from '../lib/oura-data'
import { OURA_TOKEN_URL } from '../lib/oura'

afterEach(() => mock.restoreAll())
function providerFixture(expired = false, rejectOnce = false) {
  process.env.UPSTASH_REDIS_KV_REST_API_URL = 'https://redis.invalid'
  process.env.UPSTASH_REDIS_KV_REST_API_TOKEN = 'synthetic'
  process.env.OURA_CLIENT_ID = 'synthetic'
  process.env.OURA_CLIENT_SECRET = 'synthetic'
  let stored: StoredOuraTokens = { accessToken: 'old-synthetic', refreshToken: 'old-refresh', expiresAt: expired ? 1 : Date.now()+3600000, updatedAt: 1 }
  const commands: string[][] = []
  let refreshes = 0
  mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('https://redis.invalid')) {
      const body = JSON.parse(String(init?.body))
      const run = (cmd: string[]) => {
        commands.push(cmd)
        const [operation, key] = cmd
        if (operation.toLowerCase() === 'get') return { result: JSON.stringify(stored) }
        if (operation.toLowerCase() === 'set') {
          if (key === 'oura:tokens') stored = JSON.parse(cmd[2])
          return { result: 'OK' }
        }
        return { result: 1 }
      }
      return Response.json(Array.isArray(body[0]) ? body.map(run) : run(body))
    }
    if (url === OURA_TOKEN_URL) {
      refreshes++
      const form = new URLSearchParams(String(init?.body))
      assert.equal(form.get('grant_type'), 'refresh_token')
      assert.equal(form.get('refresh_token'), 'old-refresh')
      assert.equal(init?.cache, 'no-store')
      return Response.json({ access_token: 'new-synthetic', refresh_token: 'new-refresh', expires_in: 3600, token_type: 'Bearer' })
    }
    assert.ok(url.startsWith('https://api.ouraring.com/v2/usercollection/'))
    const auth = (init?.headers as Record<string,string>).Authorization
    assert.equal(init?.cache, 'no-store')
    if (rejectOnce && auth === 'Bearer old-synthetic') return new Response('', { status: 401 })
    assert.ok(auth === 'Bearer old-synthetic' || auth === 'Bearer new-synthetic')
    return Response.json({ data: url.includes('/sleep?') ? [{ day: '2026-01-01', type: 'long_sleep', lowest_heart_rate: 60 }] : [{ day: '2026-01-01', score: 80 }] })
  })
  return { commands, getStored: () => stored, getRefreshes: () => refreshes }
}

test('Oura cached token and summary still use existing Upstash keys without browser/DB config', async () => {
  delete process.env.DATABASE_URL
  delete process.env.AUTH0_CLIENT_ID
  const fixture = providerFixture()
  const summary = await getOuraTestResultFromStore()
  assert.equal(summary.status, 'success')
  if (summary.status === 'success') {
    assert.equal(summary.sample.readinessScore, 80)
    assert.equal(summary.sample.restingHeartRate, 60)
  }
  assert.equal(fixture.getRefreshes(), 0)
  assert.ok(fixture.commands.some(cmd => cmd[0].toLowerCase() === 'get' && cmd[1] === 'oura:tokens'))
})

test('expired Oura token is refreshed under existing lock and rotated token persists', async () => {
  const fixture = providerFixture(true)
  assert.deepEqual(await getValidOuraAccessToken(), { status: 'ok', accessToken: 'new-synthetic' })
  assert.equal(fixture.getStored().refreshToken, 'new-refresh')
  assert.equal(fixture.getRefreshes(), 1)
  assert.ok(fixture.commands.some(cmd => cmd[0].toLowerCase() === 'set' && cmd[1] === 'oura:tokens:refresh-lock' && cmd.some(v => v.toLowerCase() === 'nx')))
  assert.ok(fixture.commands.some(cmd => cmd[0].toLowerCase() === 'del' && cmd[1] === 'oura:tokens:refresh-lock'))
})

test('upstream Oura 401 forces one refresh and retries summary', async () => {
  const fixture = providerFixture(false, true)
  assert.equal((await getOuraTestResultFromStore()).status, 'success')
  assert.equal(fixture.getRefreshes(), 1)
})
