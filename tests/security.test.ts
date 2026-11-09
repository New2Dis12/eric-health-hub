import assert from 'node:assert/strict'
import { test, before, afterEach, mock } from 'node:test'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose'
import { generateSessionCookie } from '@auth0/nextjs-auth0/testing'
import { NextRequest } from 'next/server'
import { getWebAuth, getWebSubject } from '../lib/web-auth'
import { requireTrainingPrincipal, verifyTrainingBearer, assertTrainingAccess } from '../lib/training/auth'
import { ApiError, requireSameOrigin } from '../lib/private-api'
import { readCommand, createTrainingHandlers } from '../lib/training/http'
import { connectionOptions } from '../lib/training/database'
import { GET as ouraTest } from '../app/api/oura/test/route'
import { GET as ouraAuthorize } from '../app/api/oura/authorize/route'
import { GET as ouraCallback } from '../app/api/oura/callback/route'
import { GET as garminTest } from '../app/api/garmin/test/route'
import { GET as mcpGet, POST as mcpPost, DELETE as mcpDelete } from '../app/mcp/route'
import { proxy } from '../proxy'

const subject = 'auth0|synthetic-athlete'
const origin = 'https://app.invalid'
const secret = '7a'.repeat(32)
let keys: Awaited<ReturnType<typeof generateKeyPair>>
let jwk: Awaited<ReturnType<typeof exportJWK>>
let localKeys: ReturnType<typeof createLocalJWKSet>
let sdkFetch: typeof fetch = async () => discovery()
async function discovery() {
  return Response.json({ issuer: 'https://tenant.invalid/', authorization_endpoint: 'https://tenant.invalid/authorize',
    token_endpoint: 'https://tenant.invalid/oauth/token', jwks_uri: 'https://tenant.invalid/.well-known/jwks.json',
    response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
    code_challenge_methods_supported: ['S256'] })
}
const status = (code: number) => (e: unknown) => e instanceof ApiError && e.status === code

before(async () => {
  keys = await generateKeyPair('RS256')
  jwk = { ...await exportJWK(keys.publicKey), kid: 'test-key' }
  localKeys = createLocalJWKSet({ keys: [jwk] })
  process.env.AUTH0_DOMAIN = 'tenant.invalid'
  process.env.AUTH0_ALLOWED_SUB = subject
  process.env.AUTH0_CLIENT_ID = 'synthetic-client'
  process.env.AUTH0_CLIENT_SECRET = 'synthetic-secret'
  process.env.AUTH0_SECRET = secret
  process.env.APP_BASE_URL = origin
  // SDK captures fetch when constructed; install discovery fixture first.
  mock.method(globalThis, 'fetch', (...args: Parameters<typeof fetch>) => sdkFetch(...args))
  await getWebSubject(new Request(origin))
})
afterEach(() => { mock.restoreAll(); sdkFetch = async () => discovery() })

async function cookie(sub = subject, expired = false) {
  return '__session=' + await generateSessionCookie({
    user: { sub }, tokenSet: { accessToken: 'synthetic', expiresAt: Math.floor(Date.now()/1000) + 3600 },
    internal: { sid: 'synthetic-session', createdAt: expired ? 1 : Math.floor(Date.now()/1000) },
  }, { secret })
}
async function bearer(overrides: Record<string, unknown> = {}, audience = 'https://eric-health-hub.vercel.app/mcp', issuer = 'https://tenant.invalid/') {
  return 'Bearer ' + await new SignJWT({ scope: 'training.read training.write', ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setSubject(String(overrides.sub ?? subject))
    .setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime(overrides.exp as number ?? '5m').sign(keys.privateKey)
}

test('encrypted SDK browser sessions authorize only allowed subject; tampered/expired cookies fail', async () => {
  assert.equal(await getWebSubject(new Request(origin)), null)
  assert.equal(await getWebSubject(new Request(origin, { headers: { cookie: await cookie() } })), subject)
  assert.equal(await getWebSubject(new Request(origin, { headers: { cookie: await cookie('auth0|other') } })), null)
  assert.equal(await getWebSubject(new Request(origin, { headers: { cookie: await cookie(subject, true) } })), null)
  assert.equal(await getWebSubject(new Request(origin, { headers: { cookie: (await cookie()).slice(0,-8) + 'tampered' } })), null)
})

test('cookie writes require trusted Origin; missing, cross-site and spoofed hosts fail', async () => {
  const sessionCookie = await cookie()
  const request = (headers: Record<string,string>) => new Request(origin+'/api/training', { method: 'POST', headers: { cookie: sessionCookie, ...headers } })
  const principal = await requireTrainingPrincipal(request({ origin }), 'training.write')
  assert.equal(principal.subject, subject)
  assert.equal(principal.source, 'browser')
  for (const headers of [{}, { origin: 'https://attacker.invalid' }, { origin, 'sec-fetch-site': 'cross-site' }, { origin: 'null' }, { host: 'attacker.invalid', origin: 'https://attacker.invalid' }]) {
    await assert.rejects(requireTrainingPrincipal(request(headers as Record<string,string>), 'training.write'), status(403))
  }
  await assert.rejects(requireTrainingPrincipal(request({ authorization: 'Bearer invalid', origin }), 'training.write'), status(401))
  assert.throws(() => requireSameOrigin(new Request(origin)), status(403))
})

test('training bearer validates signature/issuer/audience/expiry/subject and enforces separate scopes', async () => {
  const token = await verifyTrainingBearer(await bearer(), localKeys)
  assert.equal(token?.subject, subject)
  assert.deepEqual(token?.scopes, ['training.read','training.write'])
  for (const header of [
    null, 'Basic foo', 'Bearer junk', await bearer({ sub: 'auth0|other' }),
    await bearer({ exp: 1 }), await bearer({}, 'wrong-audience'), await bearer({}, undefined, 'https://wrong.invalid/'),
  ]) assert.equal(await verifyTrainingBearer(header, localKeys), null)
  const differentKeys = await generateKeyPair('RS256')
  const bad = await new SignJWT({ scope: 'training.write' }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setSubject(subject).setIssuer('https://tenant.invalid/').setAudience('https://eric-health-hub.vercel.app/mcp').setIssuedAt().setExpirationTime('5m').sign(differentKeys.privateKey)
  assert.equal(await verifyTrainingBearer('Bearer '+bad, localKeys), null)
  const readOnly = await verifyTrainingBearer(await bearer({ scope: 'training.read' }), localKeys)
  assert.throws(() => assertTrainingAccess(readOnly!, 'training.write'), status(403))
  const healthOnly = await verifyTrainingBearer(await bearer({ scope: 'oura.read garmin.read' }), localKeys)
  assert.throws(() => assertTrainingAccess(healthOnly!, 'training.read'), status(403))
})

test('real bearer request authorization uses Auth0 JWKS and cannot gain training permissions from health scopes', async () => {
  mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    assert.equal(String(input), 'https://tenant.invalid/.well-known/jwks.json')
    return Response.json({ keys: [jwk] })
  })
  const req = (authorization: string) => new Request(origin+'/api/training', { headers: { authorization } })
  assert.equal((await requireTrainingPrincipal(req(await bearer()), 'training.write')).source, 'api')
  await assert.rejects(requireTrainingPrincipal(req(await bearer({ scope: 'training.read' })), 'training.write'), status(403))
  await assert.rejects(requireTrainingPrincipal(req(await bearer({ scope: 'oura.read' })), 'training.read'), status(403))
})

test('anonymous provider APIs and MCP methods stop before provider/Redis access', async () => {
  let networkCalls = 0
  mock.method(globalThis, 'fetch', async () => { networkCalls++; throw new Error('must not call a provider') })
  for (const handler of [ouraTest, ouraAuthorize, ouraCallback]) {
    const response = await handler(new NextRequest(origin+'/api/oura/test'))
    assert.equal(response.status, 401)
    assert.match(response.headers.get('cache-control')!, /no-store/)
  }
  process.env.GARMIN_TEST_SECRET = 'synthetic-test-secret'
  assert.equal((await garminTest(new Request(origin+'/api/garmin/test', { headers: { 'x-garmin-test-secret': 'synthetic-test-secret' } }))).status, 401)
  for (const method of [mcpGet, mcpPost, mcpDelete]) {
    const response = await method(new Request(origin+'/mcp'))
    assert.equal(response.status, 401)
    assert.match(response.headers.get('www-authenticate')!, /oauth-protected-resource/)
  }
  assert.equal(networkCalls, 0)
})

test('Auth0 login uses secure HttpOnly state cookies and PKCE; auxiliary auth endpoints are unavailable', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({
    issuer: 'https://tenant.invalid/', authorization_endpoint: 'https://tenant.invalid/authorize',
    token_endpoint: 'https://tenant.invalid/oauth/token', jwks_uri: 'https://tenant.invalid/.well-known/jwks.json',
    response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
    code_challenge_methods_supported: ['S256'],
  }))
  const response = await proxy(new NextRequest(origin+'/auth/login'))
  assert.equal(response.status, 307)
  const target = new URL(response.headers.get('location')!)
  assert.equal(target.origin, 'https://tenant.invalid')
  assert.equal(target.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(target.searchParams.get('redirect_uri'), origin+'/auth/callback')
  assert.ok(target.searchParams.get('state'))
  const setCookie = response.headers.get('set-cookie')!
  assert.match(setCookie, /HttpOnly/i)
  assert.match(setCookie, /Secure/i)
  assert.match(setCookie, /SameSite=lax/i)
  assert.equal((await proxy(new NextRequest(origin+'/auth/access-token'))).status, 404)
  // A callback cannot create a session without the matching encrypted transaction.
  const callback = await proxy(new NextRequest(origin+'/auth/callback?code=bad&state=bad'))
  assert.ok(callback.status >= 400)
  assert.doesNotMatch(callback.headers.get('set-cookie') ?? '', /__session=/)
  assert.ok(getWebAuth())
})

test('bounded JSON parsing rejects malformed, oversized, misleading length, unknown pagination and content types', async () => {
  const req = (body: string, headers = { 'content-type': 'application/json' }) => new Request(origin, { method: 'POST', headers, body })
  await assert.rejects(readCommand(req('{')), status(400))
  await assert.rejects(readCommand(req('{}', { 'content-type': 'text/plain' })), status(415))
  for (const headers of [{ 'content-type': 'application/json' }, { 'content-type': 'application/json', 'content-length': '1' }]) {
    await assert.rejects(readCommand(req('x'.repeat(17000), headers)), status(413))
  }
  const handlers = createTrainingHandlers({ enabled: () => true, principal: async () => ({ subject, scopes: ['training.read'], source: 'api' }), service: () => { throw new Error('must not connect') } })
  assert.equal((await handlers.GET(new Request(origin+'?limit=101'))).status, 400)
  assert.equal((await handlers.GET(new Request(origin+'?athleteId=other'))).status, 400)
})

test('remote database TLS is verified even when URL tries to disable verification', () => {
  const options = connectionOptions('postgresql://user:synthetic@db.invalid/db?sslmode=no-verify&sslcert=bad')
  assert.deepEqual(options.ssl, { rejectUnauthorized: true })
  assert.doesNotMatch(options.connectionString!, /ssl/)
  assert.equal(connectionOptions('postgresql://localhost/test').ssl, false)
})


test('Auth0 code callback issues a secure session only after state/nonce/subject verification', async () => {
  const login = await proxy(new NextRequest(origin+'/auth/login'))
  const target = new URL(login.headers.get('location')!)
  const state = target.searchParams.get('state')!
  const nonce = target.searchParams.get('nonce')!
  const transactionCookie = login.cookies.getAll().map(c => `${c.name}=${c.value}`).join('; ')
  sdkFetch = async (url, init) => {
    if (String(url).endsWith('/.well-known/jwks.json')) return Response.json({ keys: [jwk] })
    if (String(url).endsWith('/oauth/token')) {
      const form = new URLSearchParams(String(init?.body))
      assert.equal(form.get('grant_type'), 'authorization_code')
      assert.ok(form.get('code_verifier'))
      const idToken = await new SignJWT({ nonce }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setSubject(subject).setIssuer('https://tenant.invalid/').setAudience('synthetic-client')
        .setIssuedAt().setExpirationTime('5m').sign(keys.privateKey)
      return Response.json({ access_token: 'synthetic', id_token: idToken, token_type: 'Bearer', expires_in: 3600 })
    }
    return discovery()
  }
  const response = await proxy(new NextRequest(origin+'/auth/callback?code=synthetic&state='+encodeURIComponent(state), { headers: { cookie: transactionCookie } }))
  assert.ok(response.status >= 300 && response.status < 400)
  const issued = response.cookies.getAll().filter(c => c.name.startsWith('__session')).map(c => `${c.name}=${c.value}`).join('; ')
  assert.ok(issued)
  assert.equal(await getWebSubject(new Request(origin, { headers: { cookie: issued } })), subject)
  assert.match(response.headers.get('set-cookie')!, /HttpOnly/i)
  assert.match(response.headers.get('set-cookie')!, /Secure/i)
})

test('legacy MCP bearer scopes and tool names work without browser or training database configuration', async () => {
  mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    assert.equal(String(input), 'https://tenant.invalid/.well-known/jwks.json')
    return Response.json({ keys: [jwk] })
  })
  const prior = { client: process.env.AUTH0_CLIENT_ID, db: process.env.DATABASE_URL, garmin: process.env.GARMIN_MCP_ENABLED, stunna: process.env.STUNNA_ENABLED }
  delete process.env.AUTH0_CLIENT_ID
  delete process.env.DATABASE_URL
  process.env.GARMIN_MCP_ENABLED = 'true'
  process.env.STUNNA_ENABLED = 'false'
  const list = async (scope: string) => mcpPost(new Request(origin+'/mcp', {
    method: 'POST', headers: { authorization: await bearer({ scope }), 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  }))
  try {
    const both = await list('oura.read garmin.read')
    assert.equal(both.status, 200)
    assert.deepEqual((await both.json()).result.tools.map((t: { name: string }) => t.name), ['get_oura_summary','get_garmin_activities'])
    const oura = await list('oura.read')
    assert.equal(oura.status, 200)
    assert.deepEqual((await oura.json()).result.tools.map((t: { name: string }) => t.name), ['get_oura_summary'])
    // Existing MCP contract still requires oura.read, even for Garmin.
    assert.equal((await list('garmin.read')).status, 401)
    assert.equal((await list('training.read training.write')).status, 401)

    process.env.STUNNA_ENABLED = 'true'
    const toolNames = async (scope: string) => {
      const response = await list(scope)
      assert.equal(response.status, 200)
      return (await response.json()).result.tools.map((tool: { name: string }) => tool.name)
    }
    assert.deepEqual(await toolNames('oura.read garmin.read'), ['get_oura_summary', 'get_garmin_activities'])
    assert.deepEqual(await toolNames('training.read'), ['get_saved_workout_results', 'get_training_context'])
    assert.deepEqual(await toolNames('oura.read garmin.read training.read'), ['get_oura_summary', 'get_garmin_activities', 'get_saved_workout_results', 'get_training_context'])
    assert.deepEqual(await toolNames('training.write'), ['correct_saved_strength_result'])
    assert.deepEqual(await toolNames('training.read training.write'), ['get_saved_workout_results', 'correct_saved_strength_result', 'get_training_context'])
    assert.equal((await list('garmin.read')).status, 401)
  } finally {
    if (prior.client) process.env.AUTH0_CLIENT_ID = prior.client
    if (prior.db) process.env.DATABASE_URL = prior.db
    if (prior.garmin) process.env.GARMIN_MCP_ENABLED = prior.garmin
    else delete process.env.GARMIN_MCP_ENABLED
    if (prior.stunna) process.env.STUNNA_ENABLED = prior.stunna
    else delete process.env.STUNNA_ENABLED
  }
})
