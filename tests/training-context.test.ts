import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { durationEstimate, effortSummary, exerciseSummary } from '../lib/training/workout-summary'
import { benchmarkPerformance, metricTarget, prescriptionExercisesFor, workoutOverview } from '../lib/training/context-models'
import { createTrainingContextReader } from '../lib/training/context'
import type { Queryable, TrainingDatabase } from '../lib/training/database'
import type { TrainingPrincipal } from '../lib/training/auth'
import { ApiError } from '../lib/private-api'

const db = new PGlite()
const subject = 'auth0|stunna-sprint2-synthetic'
const principal: TrainingPrincipal = { subject, source: 'browser', scopes: ['training.read'] }
const file = (path: string) => readFile(new URL(path, import.meta.url), 'utf8')
const database: TrainingDatabase = {
  transaction: (identity, work) => db.transaction(async tx => {
    await tx.exec('SET LOCAL ROLE stunna_runtime')
    await tx.query("SELECT set_config('stunna.subject',$1,true)", [identity])
    return work(tx as Queryable)
  }),
}
// UTC has rolled to Thursday, but Chicago is still Wednesday.
const read = createTrainingContextReader(() => database, () => new Date('2026-11-05T03:00:00Z'))
const status = (expected: number) => (e: unknown) => e instanceof ApiError && e.status === expected

before(async () => {
  process.env.AUTH0_ALLOWED_SUB = subject
  process.env.STUNNA_ENABLED = 'true'
  await db.exec(await file('../db/migrations/001_foundation.up.sql'))
  await db.exec(await file('../db/migrations/002_prescriptions.up.sql'))
  await db.exec(await file('../db/migrations/003_methodology.up.sql'))
  await db.exec(await file('../db/migrations/004_workout_overviews.up.sql'))
  await db.exec('CREATE ROLE stunna_runtime')
  await db.exec(await file('../db/runtime-grants.sql'))
  const fixture = await file('../db/fixtures/sprint-2-synthetic.sql')
  await db.transaction(async tx => {
    await tx.exec("SET LOCAL stunna.allow_synthetic_seed='on'; SET LOCAL stunna.fixture_date='2026-11-04'")
    await tx.exec(fixture)
    await tx.exec("SET LOCAL stunna.fixture_subject='auth0|synthetic-other-athlete'")
    await tx.exec(fixture)
  })
})
after(() => db.close())

test('browser and API principals read the same corrected prescription and previous performance', async () => {
  const day = await read(principal, {})
  assert.equal(day.date, '2026-11-04')
  assert.equal(day.timeZone, 'America/Chicago')
  assert.deepEqual(day.calendar.map(entry => entry.date), ['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06','2026-11-07','2026-11-08'])
  assert.equal(day.workouts.length, 1)
  const plan = day.workouts[0].prescription!
  assert.equal(plan.revision, 2)
  assert.deepEqual(plan.exercises.map(item => item.position), [1, 2, 3])
  assert.deepEqual(plan.exercises[0].target, { value: 40, unit: 'lb' })
  assert.deepEqual(plan.exercises[0].previous?.performance.target, { value: 35, unit: 'lb' })
  assert.equal(plan.exercises[2].target, null)
  assert.equal(plan.exercises[2].previous, null)
  assert.deepEqual(await read({ ...principal, source: 'api' }, { date: day.date }), day)
})

test('calendar navigation distinguishes a run, rest day and unsaved prescription', async () => {
  const run = await read(principal, { date: '2026-11-05' })
  assert.equal(run.workouts[0].kind, 'run')
  assert.deepEqual(run.workouts[0].prescription?.exercises[1].target, { value: 6, unit: 'mph' })
  assert.equal(run.workouts[0].prescription?.exercises[1].restSeconds, 60)
  const rest = await read(principal, { date: '2026-11-06' })
  assert.deepEqual(rest.workouts, [])
  const incomplete = await read(principal, { date: '2026-11-07' })
  assert.equal(incomplete.workouts[0].prescription, null)
})

test('runtime cannot read another athlete or change approved prescriptions', async () => {
  await database.transaction(subject, async tx => {
    const visible = await tx.query('SELECT * FROM stunna.prescription_revisions')
    assert.equal(visible.rows.length, 3)
    assert.equal((await tx.query('SELECT * FROM stunna.exercise_benchmarks')).rows.length, 2)
    assert.equal((await tx.query('SELECT * FROM stunna.training_preferences')).rows.length, 1)
  })
  await assert.rejects(database.transaction(subject, tx => tx.query("UPDATE stunna.prescription_revisions SET title='tampered'")), /permission denied/)
  await assert.rejects(read({ ...principal, subject: 'auth0|synthetic-other-athlete' }, {}), status(403))
})

test('context validates dates, scope and feature flag before connecting', async () => {
  const neverConnect = createTrainingContextReader(() => { throw Error('Unexpected database connection') })
  await assert.rejects(neverConnect(principal, { date: '2026-02-30' }), status(400))
  await assert.rejects(neverConnect(principal, { athleteId: 'other' }), status(400))
  await assert.rejects(neverConnect({ ...principal, scopes: ['training.write'] }, {}), status(403))
  process.env.STUNNA_ENABLED = 'false'
  try { await assert.rejects(neverConnect(principal, {}), status(404)) }
  finally { process.env.STUNNA_ENABLED = 'true' }
})

test('structured methodology survives reads for combined days, rowing and cycling', async () => {
  const fixture = await file('../db/fixtures/sprint-2-representative.sql')
  await db.transaction(async tx => {
    await tx.exec("SET LOCAL stunna.allow_synthetic_seed='on'")
    await tx.exec(fixture)
  })
  const combined = await read(principal, { date: '2026-11-05' })
  assert.equal(combined.workouts.length, 2)
  assert.equal(combined.workouts[0].kind, 'run')
  assert.equal(combined.workouts[1].kind, 'strength')
  const press = combined.workouts[1].prescription!.exercises[0]
  assert.equal(press.loadBasis, 'per_hand')
  assert.deepEqual(press.repsRange, { min: 8, max: 10 })
  assert.deepEqual(press.rpe, { min: 6, max: 7 })
  assert.ok(press.adjustments?.[0].substitution)
  assert.equal(combined.workouts[1].prescription!.exercises[1].optional, true)
  const run = combined.workouts[0].prescription!.exercises[0]
  assert.equal(run.warmups?.[0].phase, 'warmup')
  assert.equal(run.intervalBlocks?.[0].repeat, 3)
  assert.deepEqual(run.intervalBlocks?.[0].segments.map(segment => segment.phase), ['work', 'recovery'])
  assert.equal(run.intervalBlocks?.[0].segments[1].targets[0].range, null)
  assert.ok(combined.workouts[0].block.methodology?.weeklyStructure.length)
  const row = await read(principal, { date: '2026-11-06' })
  const targets = row.workouts[0].prescription!.exercises[0].intervalBlocks![0].segments[0].targets
  assert.deepEqual(targets.map(target => target.unit), ['m', 'sec/500m', 'spm'])
  const bike = await read(principal, { date: '2026-11-08' })
  assert.equal(bike.workouts[0].kind, 'bike')
  assert.equal(bike.workouts[0].prescription!.exercises[0].intervalBlocks![0].segments[0].targets[0].unit, 'W')
})

test('unknown or unverified evidence cannot become a verified comparison', async () => {
  await db.exec("UPDATE stunna.exercise_benchmarks SET verification_status='unverified' WHERE source='synthetic'")
  const context = await read(principal, { date: '2026-11-04' })
  assert.equal(context.workouts[0].prescription!.exercises[0].previous, null)
})

test('typed targets reject conflicting modalities and inverted ranges', () => {
  assert.equal(metricTarget.safeParse({ metric: 'stroke_rate', unit: 'rpm', range: { min: 20, max: 22 } }).success, false)
  assert.equal(metricTarget.safeParse({ metric: 'rowing_split', unit: 'sec/500m', range: { min: 170, max: 160 } }).success, false)
  assert.equal(metricTarget.safeParse({ metric: 'power', unit: 'W', range: null }).success, true)
})

test('overview revisions preserve prior prescriptions and share authored summaries with API callers', async () => {
  const before = await read(principal, { date: '2026-11-05' })
  const first = before.workouts[0]
  assert.equal(first.prescription!.overview, null)
  assert.equal(durationEstimate(first), 'Duration not specified')
  assert.equal(effortSummary(first), 'Intensity not specified')
  assert.match(exerciseSummary(first.prescription!.exercises[0]), /3 rounds.*90 sec work.*75 sec recovery/)
  await db.transaction(async tx => {
    await tx.exec("SET LOCAL stunna.allow_synthetic_seed='on'")
    await tx.exec(await file('../db/fixtures/sprint-2-overviews.sql'))
  })
  const after = await read(principal, { date: '2026-11-05' })
  const updated = after.workouts[0]
  assert.equal(updated.prescription!.revision, first.prescription!.revision + 1)
  assert.deepEqual(updated.prescription!.exercises, first.prescription!.exercises)
  assert.equal(durationEstimate(updated), 'About 15–20 min')
  assert.equal(effortSummary(updated), 'RPE 6–7')
  assert.ok(updated.prescription!.overview!.rationale)
  assert.deepEqual(await read({ ...principal, source: 'api' }, { date: '2026-11-05' }), after)
  assert.equal((await db.query('SELECT * FROM stunna.actual_sessions')).rows.length, 0)
})

test('overview input validates authored duration and effort ranges', () => {
  assert.equal(workoutOverview.safeParse({
    rationale: null, expectedDurationMinutes: { min: 20, max: 10 }, rpe: null,
  }).success, false)
  assert.equal(workoutOverview.safeParse({ rationale: null, expectedDurationMinutes: null, rpe: { min: 8, max: 6 } }).success, false)
})


test('prescription incline and resistance retain explicit bounded units and match segment modality', () => {
  const incline = { metric: 'incline', unit: '%', range: { min: 0, max: 4.5 } }
  const level = { metric: 'resistance', unit: 'level', range: { min: 10, max: 12 } }
  for (const target of [incline, level, { ...level, unit: '%' }]) assert.equal(metricTarget.safeParse(target).success, true)
  for (const target of [
    { ...incline, unit: 'level' },
    { ...incline, range: { min: 0, max: 101 } },
    { ...level, unit: 'W' },
    { ...level, range: { min: 1.5, max: 2 } },
  ]) assert.equal(metricTarget.safeParse(target).success, false)
  const parse = (modality: string, target: unknown) => prescriptionExercisesFor(modality).safeParse([{
    key: 'synthetic', name: 'Synthetic', sets: null, reps: null, durationSeconds: null, target: null,
    restSeconds: null, notes: null, warmups: [{
      phase: 'warmup', modality, label: 'Warm-up', durationSeconds: 60, targets: [target], rpe: null,
    }],
  }]).success
  assert.equal(parse('run', incline), true)
  assert.equal(parse('bike', incline), false)
  assert.equal(parse('bike', level), true)
  const steady = (kind: string, target: unknown) => prescriptionExercisesFor(kind).safeParse([{
    key: 'steady', name: 'Steady', sets: null, reps: null, durationSeconds: 600, target: null,
    restSeconds: null, notes: null, targets: [target],
  }]).success
  assert.equal(steady('run', incline), true)
  assert.equal(steady('bike', incline), false)
  assert.equal(steady('bike', level), true)
  assert.equal(steady('run', level), false)
  const benchmark = { sets: null, reps: null, durationSeconds: 600, target: null }
  assert.equal(benchmarkPerformance.safeParse({ ...benchmark, targets: [incline] }).success, false)
  assert.equal(benchmarkPerformance.safeParse({ ...benchmark, targets: [level] }).success, false)
  assert.equal(benchmarkPerformance.safeParse({ ...benchmark, targets: [
    { metric: 'cycling_cadence', unit: 'rpm', range: { min: 75, max: 90 } },
  ] }).success, true)
  assert.equal(parse('row', level), false)
})
