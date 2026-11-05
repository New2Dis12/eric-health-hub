import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import { randomUUID } from 'node:crypto'
import { generateSessionCookie } from '@auth0/nextjs-auth0/testing'
import { requireTrainingPrincipal } from '../lib/training/auth'
import { PGlite } from '@electric-sql/pglite'
import { migrate } from '../scripts/migrations'
import { createTrainingService } from '../lib/training/service'
import type { TrainingDatabase, Queryable } from '../lib/training/database'
import type { TrainingPrincipal } from '../lib/training/auth'
import { ApiError } from '../lib/private-api'
import { createTrainingHandlers } from '../lib/training/http'

function migrationConnection(tx: Pick<PGlite, 'query' | 'exec'>): Queryable {
  return { query: async (sql: string, values?: unknown[]) => {
    if (values) return tx.query(sql, values)
    const results = await tx.exec(sql)
    return results.at(-1) ?? { rows: [] }
  } } as Queryable
}

const engine = new PGlite()
const principal: TrainingPrincipal = { subject: 'auth0|synthetic-athlete', source: 'api', scopes: ['training.read','training.write'] }
// Runs the actual migration/service SQL against PostgreSQL in WASM, with a
// restricted non-owner role. No mocks of SQL, transactions, constraints or RLS.
const database: TrainingDatabase = {
  transaction: (subject, work) => engine.transaction(async tx => {
    await tx.query('SET LOCAL ROLE stunna_runtime')
    await tx.query("SELECT set_config('stunna.subject',$1,true)", [subject])
    return work(tx as Queryable)
  }),
}
const service = createTrainingService(database)
const command = (values: Record<string, unknown>) => ({ idempotencyKey: randomUUID(), reason: 'Synthetic test', ...values })
const measurement = { kind: 'weight', value: 100, unit: 'kg', measuredAt: '2026-01-02T12:00:00Z', timeZone: 'UTC' }
const session = (plannedSessionId: string, revision = 0) => ({ plannedSessionId, expectedRevision: revision, startedAt: '2026-01-02T12:00:00Z', completedAt: null, status: 'in_progress', notes: 'Synthetic only', rpe: 5 })
const conflict = (status: number) => (error: unknown) => error instanceof ApiError && error.status === status

before(async () => {
  process.env.AUTH0_ALLOWED_SUB = principal.subject
  await engine.transaction(tx => migrate(migrationConnection(tx), 'up'))
  await engine.exec('CREATE ROLE stunna_runtime')
  await engine.exec(await readFile(new URL('../db/runtime-grants.sql', import.meta.url), 'utf8'))
})
after(() => engine.close())

async function createPlan() {
  const block = await service.write(principal, command({ operation: 'create_block', block: { title: 'Synthetic block', goal: 'Fixture', startsOn: '2026-01-01', endsOn: '2026-01-31', source: 'manual' } }))
  const plan = await service.write(principal, command({ operation: 'create_planned_session', plan: { blockId: block.blockId, scheduledAt: '2026-01-02T12:00:00Z', timeZone: 'UTC', kind: 'run', purpose: 'Fixture', source: 'manual' } }))
  return plan.plannedSessionId!
}

test('migrations are repeatable; down/up recreates the schema and tracks versions', async () => {
  await engine.transaction(tx => migrate(migrationConnection(tx), 'up'))
  const fresh = new PGlite()
  try {
    await fresh.transaction(tx => migrate(migrationConnection(tx), 'up'))
    await fresh.transaction(tx => migrate(migrationConnection(tx), 'down'))
    assert.equal((await fresh.query<{ tab: string | null }>("SELECT to_regclass('stunna.prescription_revisions') AS tab")).rows[0].tab, null)
    assert.ok((await fresh.query<{ tab: string | null }>("SELECT to_regclass('stunna.actual_sessions') AS tab")).rows[0].tab)
    await fresh.transaction(tx => migrate(migrationConnection(tx), 'down'))
    assert.equal((await fresh.query<{ tab: string | null }>("SELECT to_regclass('stunna.actual_sessions') AS tab")).rows[0].tab, null)
    await fresh.transaction(tx => migrate(migrationConnection(tx), 'up'))
    assert.equal((await fresh.query('SELECT * FROM public.stunna_schema_migrations')).rows.length, 2)
  } finally { await fresh.close() }
})

test('measurement + session commit together, retry once, and persist in authorized history', async () => {
  const plannedSessionId = await createPlan()
  const input = command({ operation: 'record_observation', measurement, session: session(plannedSessionId) })
  const result = await service.write(principal, input)
  const retry = await service.write(principal, input)
  assert.deepEqual(retry, result)
  const history = await service.read(principal)
  assert.equal(history.sessions.find(s => s.id === result.actualSessionId)?.revision, 1)
  assert.equal(history.measurements.filter(m => m.id === result.measurementId).length, 1)
  assert.equal(history.measurements.find(m => m.id === result.measurementId)?.value, 100)
  const audits = await engine.query<{ entity_type: string; actor_sub: string; after_revision: number }>('SELECT * FROM stunna.audit_events WHERE entity_id = ANY($1::uuid[])', [[result.actualSessionId,result.measurementId]])
  assert.equal(audits.rows.length, 2)
  assert.ok(audits.rows.every(r => r.actor_sub === principal.subject && r.after_revision === 1))
  await assert.rejects(service.write(principal, { ...input, measurement: { ...measurement, value: 101 } }), conflict(409))
})

test('a missing session or failed audit rolls back measurements and idempotency records', async () => {
  const plannedSessionId = await createPlan()
  const before = (await service.read(principal)).measurements.length
  const missing = command({ operation: 'record_observation', measurement, session: session(randomUUID()) })
  await assert.rejects(service.write(principal, missing), conflict(404))
  assert.equal((await service.read(principal)).measurements.length, before)
  // Inject a PostgreSQL failure *after* the record inserts, at the audit boundary.
  await engine.exec(`CREATE FUNCTION stunna.reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic failure'; END $$;
    CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON stunna.audit_events FOR EACH ROW EXECUTE FUNCTION stunna.reject_audit();`)
  const input = command({ operation: 'record_observation', measurement, session: session(plannedSessionId) })
  try { await assert.rejects(service.write(principal, input)) }
  finally { await engine.exec('DROP TRIGGER synthetic_audit_failure ON stunna.audit_events; DROP FUNCTION stunna.reject_audit()') }
  assert.equal((await service.read(principal)).measurements.length, before)
  assert.equal((await engine.query('SELECT * FROM stunna.write_requests WHERE idempotency_key=$1', [input.idempotencyKey])).rows.length, 0)
  assert.ok((await service.write(principal, input)).actualSessionId)
})

test('concurrent retries/finalization are unique, stale updates conflict, audited corrections preserve completion', async () => {
  const plannedSessionId = await createPlan()
  const input = command({ operation: 'record_observation', session: session(plannedSessionId) })
  const results = await Promise.all([service.write(principal, input), service.write(principal, input)])
  assert.deepEqual(results[0], results[1])
  const completed = { ...session(plannedSessionId, 1), completedAt: '2026-01-02T13:00:00Z', status: 'completed' }
  const competing = await Promise.allSettled([
    service.write(principal, command({ operation: 'record_observation', session: completed })),
    service.write(principal, command({ operation: 'record_observation', session: completed })),
  ])
  assert.equal(competing.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(competing.filter(r => r.status === 'rejected' && conflict(409)(r.reason)).length, 1)
  const correction = await service.write(principal, command({ operation: 'record_observation', session: { ...completed, expectedRevision: 2, notes: 'Audited correction' } }))
  assert.equal(correction.sessionRevision, 3)
  await assert.rejects(service.write(principal, command({ operation: 'record_observation', session: { ...session(plannedSessionId, 3) } })), conflict(409))
  assert.equal((await service.read(principal)).sessions.filter(s => s.planned_session_id === plannedSessionId).length, 1)
})

test('wrong-account services, read-only writes, invalid units/dates/unknown fields and invalid pages fail', async () => {
  await assert.rejects(service.read({ ...principal, subject: 'auth0|other' }), conflict(403))
  await assert.rejects(service.write({ ...principal, scopes: ['training.read'] }, command({ operation: 'record_observation', measurement })), conflict(403))
  for (const bad of [
    { ...measurement, unit: 'cm' }, { ...measurement, value: -1 }, { ...measurement, value: Infinity },
    { ...measurement, measuredAt: '2026-02-30T12:00:00Z' }, { ...measurement, timeZone: 'unknown' },
  ]) await assert.rejects(service.write(principal, command({ operation: 'record_observation', measurement: bad })), conflict(400))
  await assert.rejects(service.write(principal, command({ operation: 'record_observation', measurement, athleteId: randomUUID() })), conflict(400))
  for (const [limit, offset] of [[0,0],[101,0],[50,-1],[50,10001]]) await assert.rejects(service.read(principal, limit, offset), conflict(400))
  assert.equal((await service.read(principal, 1)).measurements.length, 1)
})

test('database RLS denies reads and writes without subject and across athletes, including foreign keys', async () => {
  const foreignId = randomUUID(), foreignBlockId = randomUUID()
  await engine.query('INSERT INTO stunna.athletes(id,auth0_sub) VALUES($1,$2)', [foreignId, 'auth0|other'])
  await engine.query("INSERT INTO stunna.training_blocks(id,athlete_id,title,goal,starts_on,ends_on,source) VALUES($1,$2,'Fixture','Fixture','2026-01-01','2026-01-31','manual')", [foreignBlockId, foreignId])
  await database.transaction(principal.subject, async tx => {
    assert.equal((await tx.query('SELECT * FROM stunna.athletes WHERE id=$1', [foreignId])).rows.length, 0)
    assert.equal((await tx.query('SELECT * FROM stunna.training_blocks WHERE id=$1', [foreignBlockId])).rows.length, 0)
  })
  await assert.rejects(database.transaction(principal.subject, tx => tx.query("INSERT INTO stunna.body_measurements(id,athlete_id,kind,value,unit,measured_at,time_zone,source) VALUES($1,$2,'weight',100,'kg',now(),'UTC','api')", [randomUUID(),foreignId])))
  await database.transaction('', async tx => { assert.equal((await tx.query('SELECT * FROM stunna.body_measurements')).rows.length, 0) })
  await assert.rejects(service.write(principal, command({ operation: 'create_planned_session', plan: { blockId: foreignBlockId, scheduledAt: '2026-01-02T12:00:00Z', timeZone: 'UTC', kind: 'run', purpose: 'Fixture', source: 'manual' } })), conflict(404))
  // Audit and measurement UPDATE/DELETE privileges are absent for the runtime role.
  await assert.rejects(database.transaction(principal.subject, tx => tx.query('DELETE FROM stunna.audit_events')))
  await assert.rejects(database.transaction(principal.subject, tx => tx.query('UPDATE stunna.body_measurements SET value=1')))
})

test('authenticated HTTP endpoint persists measurement + session; disabled/anonymous never touch service', async () => {
  const handlers = createTrainingHandlers({ enabled: () => true, service: () => service, principal: async () => principal })
  const plannedSessionId = await createPlan()
  const input = command({ operation: 'record_observation', measurement, session: session(plannedSessionId) })
  const response = await handlers.POST(new Request('https://app.invalid/api/training', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }))
  assert.equal(response.status, 200)
  assert.match(response.headers.get('cache-control')!, /no-store/)
  const saved = await response.json()
  const history = await handlers.GET(new Request('https://app.invalid/api/training?limit=100'))
  assert.ok((await history.json()).sessions.some((s: { id: string }) => s.id === saved.actualSessionId))
  const blocked = createTrainingHandlers({ enabled: () => false, principal: async () => { throw new Error('must not authenticate') }, service: () => { throw new Error('must not connect') } })
  assert.equal((await blocked.GET(new Request('https://app.invalid/api/training'))).status, 404)
  const anonymous = createTrainingHandlers({ enabled: () => true, principal: async () => { throw new ApiError(401, 'Unauthorized') }, service: () => { throw new Error('must not connect') } })
  assert.equal((await anonymous.POST(new Request('https://app.invalid/api/training', { method: 'POST', body: '{}' }))).status, 401)
})


test('encrypted browser session can atomically save/read through the real HTTP auth and SQL service', async () => {
  const origin = 'https://app.invalid'
  process.env.AUTH0_DOMAIN = 'tenant.invalid'
  process.env.AUTH0_CLIENT_ID = 'synthetic-client'
  process.env.AUTH0_CLIENT_SECRET = 'synthetic-secret'
  process.env.AUTH0_SECRET = '7a'.repeat(32)
  process.env.APP_BASE_URL = origin
  const cookie = '__session='+await generateSessionCookie({ user: { sub: principal.subject }, tokenSet: { accessToken: 'synthetic', expiresAt: Math.floor(Date.now()/1000)+3600 }, internal: { sid: 'synthetic-session', createdAt: Math.floor(Date.now()/1000) } }, { secret: process.env.AUTH0_SECRET })
  const handlers = createTrainingHandlers({ enabled: () => true, principal: requireTrainingPrincipal, service: () => service })
  const plannedSessionId = await createPlan()
  const input = command({ operation: 'record_observation', measurement, session: session(plannedSessionId) })
  const request = () => new Request(origin+'/api/training', { method: 'POST', headers: { cookie, origin, 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
  const write = await handlers.POST(request())
  assert.equal(write.status, 200)
  const result = await write.json()
  assert.deepEqual(await (await handlers.POST(request())).json(), result)
  const read = await handlers.GET(new Request(origin+'/api/training', { headers: { cookie } }))
  assert.equal(read.status, 200)
  const data = await read.json()
  assert.ok(data.sessions.some((s: { id: string }) => s.id === result.actualSessionId))
  assert.ok(data.measurements.some((m: { id: string }) => m.id === result.measurementId))
  assert.equal((await handlers.POST(new Request(origin+'/api/training', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(input) }))).status, 403)
})
