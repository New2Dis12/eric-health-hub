import assert from 'node:assert/strict'
import { test, mock, afterEach } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { getGarminActivities, getGarminActivityFit } from '../lib/garmin'
import { readLimitedResponse } from '../lib/limited-response'
import { createEricHealthMcpServer } from '../lib/mcp-server'
import { workoutFit, zipFile } from './fixtures'

afterEach(() => mock.restoreAll())

function mockGarminFetch(handler: typeof globalThis.fetch) {
  process.env.UPSTASH_REDIS_KV_REST_API_URL = 'https://redis.invalid'
  process.env.UPSTASH_REDIS_KV_REST_API_TOKEN = 'test-only'
  const cached = { accessToken: 'cached-test-token', expiresAt: Date.now() + 3600_000 }
  let cacheReads = 0
  const fetch = mock.method(globalThis, 'fetch', async (url: RequestInfo | URL, options?: RequestInit) => {
    if (String(url).startsWith('https://redis.invalid')) {
      const body = JSON.parse(String(options?.body))
      const command = (cmd: string[]) => {
        if (cmd[0].toLowerCase() === 'get') { cacheReads++; return { result: JSON.stringify(cached) } }
        return { result: cmd[0].toLowerCase() === 'set' ? 'OK' : 1 }
      }
      return Response.json(Array.isArray(body[0]) ? body.map(command) : command(body))
    }
    return handler(url, options)
  })
  return { fetch, reads: () => cacheReads }
}

test('FIT download reuses cached token, fixed Garmin host, no-store, redirect block and deadline', async () => {
  let downloads = 0
  const cache = mockGarminFetch(async (url, options) => {
    downloads++
    assert.equal(url, 'https://personal.connectapi.garmin.com/download-service/files/activity/123')
    assert.deepEqual(options?.headers, { Authorization: 'Bearer cached-test-token' })
    assert.equal(options?.redirect, 'error')
    assert.equal(options?.cache, 'no-store')
    assert.ok(options?.signal instanceof AbortSignal)
    return new Response(zipFile(workoutFit()))
  })
  const result = await getGarminActivityFit(123)
  assert.equal(result.activityId, 123)
  assert.equal(result.fitRecordCount, 5)
  assert.equal(downloads, 1)
  assert.equal(cache.reads(), 1)
})

test('401 refreshes existing token cache once, retries and handles upstream failures', async () => {
  const fresh = `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test`
  process.env.GARMIN_API_KEY = 'test-key'
  let attempts = 0
  mockGarminFetch(async (url: RequestInfo | URL, options?: RequestInit) => {
    if (String(url).includes('personalapitoken-service')) {
      assert.equal(options?.method, 'POST')
      assert.deepEqual(options?.headers, { Authorization: 'ApiKey test-key' })
      return new Response(JSON.stringify({ access_token: fresh }))
    }
    if (attempts++ === 0) return new Response('', { status: 401 })
    assert.deepEqual(options?.headers, { Authorization: `Bearer ${fresh}` })
    return new Response(zipFile(workoutFit()))
  })
  assert.equal((await getGarminActivityFit(123)).available, true)
  assert.equal(attempts, 2)
  mockGarminFetch(async () => new Response('', { status: 503 }))
  await assert.rejects(getGarminActivityFit(123), /HTTP 503/)
})

test('activity listing remains JSON and never downloads FIT without an ID', async () => {
  mockGarminFetch(async url => {
    assert.equal(url, 'https://personal.connectapi.garmin.com/activitylist-service/activities/search/activities?start=0&limit=10')
    return Response.json([{ activityId: 123, activityName: 'Run' }])
  })
  assert.deepEqual(await getGarminActivities(10), [{ activityId: 123, activityName: 'Run' }])
  await assert.rejects(getGarminActivityFit(-1), /Invalid/)
})

test('streamed size limit works with absent or misleading Content-Length, and empty bodies', async () => {
  for (const headers of [{}, { 'content-length': '1' }, { 'content-length': '100' }] as Record<string, string>[]) {
    await assert.rejects(readLimitedResponse(new Response(new Uint8Array(20), { headers }), 10), /limit/)
  }
  await assert.rejects(readLimitedResponse(new Response(null), 10), /empty/)
  assert.equal((await readLimitedResponse(new Response('123'), 10)).length, 3)
})

test('MCP retains Oura and only exposes Garmin with feature flag AND authorized scope', async () => {
  for (const [enabled, scope] of [['false', true], ['true', false], ['true', true]] as const) {
    process.env.GARMIN_MCP_ENABLED = enabled
    const server = createEricHealthMcpServer(scope)
    const client = new Client({ name: 'test', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    try {
      const names = (await client.listTools()).tools.map(t => t.name)
      assert.ok(names.includes('get_oura_summary'))
      assert.equal(names.includes('get_garmin_activities'), enabled === 'true' && scope)
      if (enabled === 'true' && scope) {
        mockGarminFetch(async () => new Response(zipFile(workoutFit())))
        const result = await client.callTool({ name: 'get_garmin_activities', arguments: { activityId: 123, maxSamples: 2 } })
        assert.ok(Array.isArray(result.content))
        const first = result.content[0] as { type: string; text: string }
        const fit = JSON.parse(first.text)
        assert.equal(fit.samples.length, 2)
        assert.equal(fit.nextStartSeconds, 2)
        const invalid = await client.callTool({ name: 'get_garmin_activities', arguments: { activityId: 123, maxSamples: 2001 } })
        assert.equal(invalid.isError, true)
      }
    } finally {
      await client.close()
      await server.close()
    }
  }
})
