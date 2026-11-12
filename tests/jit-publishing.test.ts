import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { migrate } from '../scripts/migrations'
import { createTrainingService } from '../lib/training/service'
import { createTrainingContextReader } from '../lib/training/context'
import { createMcpTrainingPublisher } from '../lib/training/mcp-publishing'
import type { TrainingDatabase, Queryable } from '../lib/training/database'
import type { TrainingPrincipal } from '../lib/training/auth'
import { ApiError } from '../lib/private-api'
import { commandSchema, weeklyIntentFields } from '../lib/training/models'
import { readFile } from 'node:fs/promises'

const db = new PGlite()
const subject = 'auth0|synthetic-jit-owner'
const owner: TrainingPrincipal = { subject, scopes: ['training.read','training.write'], source: 'api' }
const readOnly: TrainingPrincipal = { ...owner, scopes: ['training.read'] }
const other: TrainingPrincipal = { ...owner, subject: 'auth0|synthetic-jit-other' }
const database: TrainingDatabase = { transaction: (identity, work) => db.transaction(async tx => {
  await tx.exec('SET LOCAL ROLE stunna_runtime')
  await tx.query("SELECT set_config('stunna.subject',$1,true)", [identity])
  return work(tx as Queryable)
}) }
let publishNow = new Date('2026-11-09T16:00:00Z')
const service = createTrainingService(database, () => publishNow)
const read = createTrainingContextReader(() => database, () => new Date('2026-11-09T16:00:00Z'))
const publisher = createMcpTrainingPublisher(() => service)
const request = (command: Record<string, unknown>) => ({ idempotencyKey: randomUUID(), reason: 'Synthetic owner approval test', ...command })
const asMcp = ({ operation: _operation, ...rest }: Record<string, unknown>) => rest
const overview = { rationale: 'Synthetic targeted adaptation', expectedDurationMinutes: { min: 30, max: 50 }, rpe: { min: 5, max: 7 } }
const strength = [
  { key: 'squat', name: 'Squat', sets: 3, reps: 5, durationSeconds: null, target: { value: 40, unit: 'kg' }, restSeconds: 120, notes: 'Synthetic strength example', loadBasis: 'total' },
  { key: 'row', name: 'Row', sets: 2, reps: 8, durationSeconds: null, target: { value: 20, unit: 'kg' }, restSeconds: 60, notes: null, loadBasis: 'per_hand' },
]
const run = [{ key: 'run-intervals', name: 'Intervals', sets: null, reps: null, durationSeconds: 1800, target: null, restSeconds: null, notes: 'Synthetic intervals', intervalBlocks: [{ repeat: 3, segments: [
  { phase: 'work', modality: 'run', label: 'Work', durationSeconds: 120, targets: [{ metric: 'pace', unit: 'sec/km', range: { min: 300, max: 360 } }], rpe: { min: 6, max: 8 } },
  { phase: 'recovery', modality: 'run', label: 'Recover', durationSeconds: 90, targets: [], rpe: null },
] }] }]
const status = (code: number) => (error: unknown) => error instanceof ApiError && error.status === code
let tuesday = ''
let thursday = ''
let blockId = ''

before(async () => {
  process.env.STUNNA_ENABLED = 'true'
  process.env.AUTH0_ALLOWED_SUB = subject
  await db.transaction(tx => migrate({ query: async (sql, params) => params ? tx.query(sql, params) : (await tx.exec(sql)).at(-1) ?? { rows: [] } } as Queryable, 'up'))
  await db.exec('CREATE ROLE stunna_runtime')
  await db.exec(await readFile(new URL('../db/runtime-grants.sql', import.meta.url), 'utf8'))
})
after(() => db.close())

test('weekly intent is date-only, not executable until owner-approved details publish; app and MCP agree', async () => {
  const intent = request({ operation: 'save_weekly_intent', weekStartsOn: '2026-11-09', timeZone: 'America/Chicago',
    title: 'Synthetic week', focus: 'Aerobic foundation and strength', days: [
      { date: '2026-11-10', kind: 'strength', purpose: 'Strength focus, details pending' },
      { date: '2026-11-12', kind: 'run', purpose: 'Run focus, details pending' },
    ] })
  const validated = weeklyIntentFields.safeParse(asMcp(intent))
  assert.ok(validated.success, JSON.stringify(validated.error?.issues))
  const result = await publisher.week(owner, asMcp(intent) as never)
  assert.equal(result.plannedSessionIds?.length, 2)
  blockId = result.blockId!
  tuesday = result.plannedSessionIds![0]
  thursday = result.plannedSessionIds![1]
  assert.deepEqual(await publisher.week(owner, asMcp(intent) as never), result, 'exact retries must reuse original receipts')
  const beforePublish = await read(owner, { date: '2026-11-10' })
  assert.equal(beforePublish.dateOnlyWorkouts[0].prescription, null)
  assert.equal(beforePublish.dateOnlyWorkouts[0].scheduledAt, null)
  assert.equal(beforePublish.dateOnlyWorkouts[0].trainingDate, '2026-11-10')
  assert.equal(beforePublish.calendar.find(x => x.date === '2026-11-12')?.workoutCount, 1)
  await assert.rejects(service.write(owner, request({ operation: 'start_workout', plannedSessionId: tuesday,
    expectedPrescriptionRevision: 1, expectedSessionRevision: 0 })), status(404))
  const approved = request({ operation: 'publish_approved_workout', plannedSessionId: tuesday,
    expectedPrescriptionRevision: 0, title: 'Synthetic Tuesday strength', overview, exercises: strength,
    approvalNote: 'Owner explicitly approved the exact Tuesday prescription in synthetic conversation' })
  const first = await publisher.publish(owner, asMcp(approved) as never)
  assert.equal(first.prescriptionRevision, 1)
  assert.deepEqual(await publisher.publish(owner, asMcp(approved) as never), first)
  const inApp = await read({ ...owner, source: 'browser' }, { date: '2026-11-10' })
  const inMcp = await read(owner, { date: '2026-11-10' })
  assert.deepEqual(inApp, inMcp)
  assert.deepEqual(inMcp.dateOnlyWorkouts[0].prescription?.exercises.map(x => x.key), ['squat', 'row'])
  assert.equal(inMcp.dateOnlyWorkouts[0].prescription?.exercises[0].target?.unit, 'kg')
  assert.equal(inMcp.dateOnlyWorkouts[0].prescription?.approvalNote, 'Owner explicitly approved the exact Tuesday prescription in synthetic conversation')
  assert.equal(inMcp.dateOnlyWorkouts[0].scheduledAt, null)
  assert.equal((await read(owner, { date: '2026-11-12' })).dateOnlyWorkouts[0].prescription, null)
  const runApproved = request({ operation: 'publish_approved_workout', plannedSessionId: thursday,
    expectedPrescriptionRevision: 0, title: 'Synthetic Thursday run', overview, exercises: run,
    approvalNote: 'Owner explicitly approved the exact Thursday prescription in synthetic conversation' })
  await assert.rejects(publisher.publish(owner, asMcp(runApproved) as never), status(400),
    'an existing Thursday placeholder cannot receive detail on Monday')
  publishNow = new Date('2026-11-12T15:00:00Z')
  const thursdayResult = await publisher.publish(owner, asMcp(runApproved) as never)
  assert.equal(thursdayResult.prescriptionRevision, 1)
  const thursdayDay = await read(owner, { date: '2026-11-12' })
  assert.equal(thursdayDay.dateOnlyWorkouts[0].prescription?.exercises[0].intervalBlocks?.[0].segments[0].targets[0].unit, 'sec/km')
  assert.equal(thursdayDay.dateOnlyWorkouts[0].scheduledAt, null)
})

test('approved revisions append immutably; stale revisions conflict and started sessions stay pinned', async () => {
  const start = await service.write(owner, request({ operation: 'start_workout', plannedSessionId: tuesday,
    expectedPrescriptionRevision: 1, expectedSessionRevision: 0 }))
  assert.equal(start.workout?.prescriptionRevision, 1)
  const changed = request({ operation: 'publish_approved_workout', plannedSessionId: tuesday,
    expectedPrescriptionRevision: 1, title: 'Synthetic revised Tuesday', overview,
    exercises: [{ ...strength[0], reps: 6 }, strength[1]],
    approvalNote: 'Owner explicitly approved the revised exact Tuesday prescription in synthetic conversation' })
  const published = await publisher.publish(owner, asMcp(changed) as never)
  assert.equal(published.prescriptionRevision, 2)
  await assert.rejects(publisher.publish(owner, asMcp({ ...changed, idempotencyKey: randomUUID() }) as never), status(409))
  await assert.rejects(publisher.publish(owner, asMcp({ ...changed, title: 'Reused key' }) as never), status(409))
  assert.equal((await service.workout(owner, tuesday))?.prescriptionRevision, 1)
  assert.equal((await service.workout(owner, tuesday))?.snapshot?.exercises[0].reps, 5)
  assert.equal((await read(owner, { date: '2026-11-10' })).dateOnlyWorkouts[0].prescription?.revision, 2)
  const versions = await database.transaction(subject, async tx => tx.query<{ revision:number; approval_note:string }>(
    'SELECT revision,approval_note FROM stunna.prescription_revisions WHERE planned_session_id=$1 ORDER BY revision', [tuesday]))
  assert.deepEqual(versions.rows.map(x => x.revision), [1, 2])
  assert.ok(versions.rows.every(x => x.approval_note.includes('Owner explicitly approved')))
})

test('scope, subject, ownership, validation and RLS reject unauthorized or phantom publication', async () => {
  const command = request({ operation: 'publish_approved_workout', plannedSessionId: thursday,
    expectedPrescriptionRevision: 1, title: 'Synthetic unauthorized', overview, exercises: run,
    approvalNote: 'Synthetic explicit approval note for authorization validation' })
  await assert.rejects(publisher.publish(readOnly, asMcp(command) as never), status(403))
  await assert.rejects(publisher.publish(other, asMcp(command) as never), status(403))
  await assert.rejects(publisher.publish(owner, asMcp({ ...command, exercises: [{ ...strength[0], target: { value: 10, unit: 'lbs' } }] }) as never), status(400))
  await assert.rejects(publisher.publish(owner, asMcp({ ...command, exercises: [{ ...run[0], targets: [{ metric: 'resistance', unit: '%', range: { min: 10, max: 20 } }] }] }) as never), status(400))
  await assert.rejects(publisher.publish(owner, asMcp({ ...command, approvalNote: '' }) as never), status(400))
  await database.transaction(other.subject, async tx => {
    const rows = await tx.query('SELECT revision FROM stunna.prescription_revisions WHERE planned_session_id=$1', [thursday])
    assert.equal(rows.rows.length, 0)
    await assert.rejects(tx.query('UPDATE stunna.prescription_revisions SET title=$1 WHERE planned_session_id=$2', ['Tamper', thursday]))
  })
  assert.equal((await read(owner, { date: '2026-11-12' })).dateOnlyWorkouts[0].prescription?.revision, 1)
})

test('minimal single-day owner-approved publication works without weekly plan', async () => {
  publishNow = new Date('2026-11-12T15:00:00Z')
  const result = await publisher.publish(owner, asMcp(request({ operation: 'publish_approved_workout',
    newPlan: { date: '2026-11-13', timeZone: 'America/Chicago', kind: 'run', purpose: 'Synthetic one-day plan' },
    expectedPrescriptionRevision: 0, title: 'Synthetic Friday easy run', overview, exercises: run,
    approvalNote: 'Owner explicitly approved exact Friday synthetic workout in conversation' })) as never)
  assert.equal(result.prescriptionRevision, 1)
  assert.equal((await read(owner, { date: '2026-11-13' })).dateOnlyWorkouts[0].prescription?.title, 'Synthetic Friday easy run')
  assert.ok(blockId)
  publishNow = new Date('2026-11-10T15:00:00Z')
  const sameDay = await publisher.publish(owner, asMcp(request({ operation: 'publish_approved_workout',
    newPlan: { blockId, date: '2026-11-10', timeZone: 'America/Chicago', kind: 'run', purpose: 'Synthetic second Tuesday modality' },
    expectedPrescriptionRevision: 0, title: 'Synthetic Tuesday run', overview, exercises: run,
    approvalNote: 'Owner explicitly approved independent Tuesday synthetic run in conversation' })) as never)
  assert.equal(sameDay.prescriptionRevision, 1)
  const tuesdayDay = await read(owner, { date: '2026-11-10' })
  assert.equal(tuesdayDay.dateOnlyWorkouts.length, 2)
  assert.deepEqual(new Set(tuesdayDay.dateOnlyWorkouts.map(x => x.kind)), new Set(['strength','run']))
  assert.equal((await service.workout(owner, tuesday))?.snapshot?.exercises[0].reps, 5)
})

test('failed audit rolls back approval and idempotency; concurrent approvals require a fresh revision', async () => {
  const approval = request({ operation: 'publish_approved_workout', plannedSessionId: thursday,
    expectedPrescriptionRevision: 1, title: 'Synthetic revised Thursday run', overview, exercises: run,
    approvalNote: 'Owner explicitly approved revised Thursday synthetic intervals in conversation' })
  const failing = createTrainingService({ transaction: (identity, work) => db.transaction(async tx => {
    await tx.exec('SET LOCAL ROLE stunna_runtime')
    await tx.query("SELECT set_config('stunna.subject',$1,true)", [identity])
    return work({ query: async (sql, params) => {
      if (sql.includes('INSERT INTO stunna.audit_events')) throw new Error('Synthetic audit storage failure')
      return tx.query(sql, params)
    } } as Queryable)
  }) })
  await assert.rejects(failing.write(owner, approval), /Synthetic audit storage failure/)
  assert.equal((await read(owner, { date: '2026-11-12' })).dateOnlyWorkouts[0].prescription?.revision, 1)
  const succeeded = await publisher.publish(owner, asMcp(approval) as never)
  assert.equal(succeeded.prescriptionRevision, 2)
  const next = (name: string) => request({ operation: 'publish_approved_workout', plannedSessionId: thursday,
    expectedPrescriptionRevision: 2, title: name, overview, exercises: run,
    approvalNote: 'Owner explicitly approved exact concurrent synthetic workout for testing' })
  const attempts = await Promise.allSettled([
    publisher.publish(owner, asMcp(next('Synthetic concurrent A')) as never),
    publisher.publish(owner, asMcp(next('Synthetic concurrent B')) as never),
  ])
  assert.equal(attempts.filter(x => x.status === 'fulfilled').length, 1)
  assert.equal(attempts.filter(x => x.status === 'rejected' && status(409)(x.reason)).length, 1)
  assert.equal((await read(owner, { date: '2026-11-12' })).dateOnlyWorkouts[0].prescription?.revision, 3)
  const audits = await database.transaction(subject, tx => tx.query<{n:number}>(
    "SELECT count(*)::int AS n FROM stunna.audit_events WHERE operation='publish_approved_workout' AND entity_id=$1", [thursday]))
  assert.equal(audits.rows[0].n, 3)
})

test('shared HTTP/service command validation retains week and single-plan refinements', async () => {
  const week = request({ operation: 'save_weekly_intent', weekStartsOn: '2026-11-10', timeZone: 'America/Chicago',
    title: 'Synthetic invalid week', focus: 'Aerobic', days: [{ date: '2026-11-10', kind: 'run', purpose: 'Run' }] })
  assert.equal(commandSchema.safeParse(week).success, false, 'Tuesday is not a valid week start')
  await assert.rejects(service.write(owner, week), status(400))
  const outOfWeek = { ...week, weekStartsOn: '2026-11-09',
    days: [{ date: '2026-11-17', kind: 'run', purpose: 'Outside selected week' }] }
  assert.equal(commandSchema.safeParse(outOfWeek).success, false)
  await assert.rejects(service.write(owner, outOfWeek), status(400))
  const ambiguous = request({ operation: 'publish_approved_workout', plannedSessionId: tuesday,
    newPlan: { date: '2026-11-10', timeZone: 'America/Chicago', kind: 'run', purpose: 'Ambiguous' },
    expectedPrescriptionRevision: 2, title: 'Synthetic ambiguous', overview, exercises: run,
    approvalNote: 'Owner explicitly approved exact synthetic workout in conversation' })
  assert.equal(commandSchema.safeParse(ambiguous).success, false)
  await assert.rejects(service.write(owner, ambiguous), status(400))
})

test('initial publication is restricted to athlete-local day before/day of, with truthful null overview', async () => {
  publishNow = new Date('2026-11-09T15:00:00Z')
  const make = (date: string, extra: Record<string, unknown> = {}) => request({
    operation: 'publish_approved_workout',
    newPlan: { date, timeZone: 'America/Chicago', kind: 'run', purpose: 'Synthetic day-specific run' },
    expectedPrescriptionRevision: 0, title: 'Synthetic day-specific run', overview: null, exercises: run,
    approvalNote: 'Owner explicitly approved exact synthetic workout in conversation', ...extra,
  })
  await assert.rejects(publisher.publish(owner, asMcp(make('2026-11-13')) as never), status(400))
  await assert.rejects(publisher.publish(owner, asMcp(make('2026-11-08')) as never), status(400))
  const countBefore = await database.transaction(subject, async tx =>
    tx.query<{n:number}>("SELECT count(*)::int AS n FROM stunna.planned_sessions WHERE purpose='Synthetic day-specific run'"))
  assert.equal(countBefore.rows[0].n, 0, 'failed publication must roll back new plan')
  const valid = await publisher.publish(owner, asMcp(make('2026-11-10')) as never)
  assert.equal(valid.prescriptionRevision, 1)
  const saved = (await read(owner, { date: '2026-11-10' })).dateOnlyWorkouts.find(w => w.id === valid.plannedSessionId)
  assert.equal(saved?.prescription?.overview, null, 'SQL NULL overview must round-trip')
  const stored = await database.transaction(subject, async tx =>
    tx.query<{overview: unknown}>('SELECT overview FROM stunna.prescription_revisions WHERE planned_session_id=$1', [valid.plannedSessionId]))
  assert.equal(stored.rows[0].overview, null)
})

test('date-only PostgreSQL values remain calendar dates on positive-offset Node hosts', async () => {
  // pg DATE (OID 1082) normally becomes host-local midnight. Auckland therefore
  // exposes the old one-day-shift bug when callers use toISOString().slice(0, 10).
  const { execFileSync } = await import('node:child_process')
  const parsedAsUtcDay = execFileSync(process.execPath, ['-e',
    "const pg = require('pg'); const d = pg.types.getTypeParser(1082, 'text')('2026-11-12'); process.stdout.write(d.toISOString().slice(0, 10))",
  ], { encoding: 'utf8', env: { ...process.env, TZ: 'Pacific/Auckland' } })
  assert.equal(parsedAsUtcDay, '2026-11-11', 'regression fixture must exercise the real pg DATE parser')

  const observedQueries: string[] = []
  const tracedDatabase: TrainingDatabase = {
    transaction: (identity, work) => database.transaction(identity, tx => work({
      query: (sql, params) => {
        observedQueries.push(sql)
        return tx.query(sql, params)
      },
    } as Queryable)),
  }
  const originalTimeZone = process.env.TZ
  process.env.TZ = 'Pacific/Auckland'
  try {
    const serviceInAuckland = createTrainingService(tracedDatabase, () => new Date('2026-11-12T15:00:00Z'))
    const contextInAuckland = createTrainingContextReader(() => tracedDatabase, () => new Date('2026-11-12T15:00:00Z'))
    const result = await serviceInAuckland.write(owner, request({
      operation: 'publish_approved_workout',
      newPlan: { date: '2026-11-12', timeZone: 'America/Chicago', kind: 'run', purpose: 'Synthetic timezone regression' },
      expectedPrescriptionRevision: 0,
      title: 'Synthetic same-day date-only run',
      overview: null,
      exercises: run,
      approvalNote: 'Owner explicitly approved the exact synthetic timezone regression workout',
    }))
    assert.equal(result.prescriptionRevision, 1, 'same-day publishing must not shift to the previous day')
    const day = await contextInAuckland(owner, { date: '2026-11-12' })
    const workout = day.dateOnlyWorkouts.find(item => item.id === result.plannedSessionId)
    assert.equal(workout?.trainingDate, '2026-11-12')
    assert.equal(workout?.scheduledAt, null)
    assert.ok(observedQueries.some(sql => sql.includes('SELECT kind, planned_on::text AS planned_on')),
      'publishing must project PostgreSQL DATE as text before pg parsing')
    assert.ok(observedQueries.some(sql => sql.includes('p.planned_on::text AS planned_on')),
      'context must project PostgreSQL DATE as text before pg parsing')
  } finally {
    if (originalTimeZone === undefined) delete process.env.TZ
    else process.env.TZ = originalTimeZone
  }
})
