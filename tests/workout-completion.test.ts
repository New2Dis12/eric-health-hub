import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { createTrainingService } from '../lib/training/service'
import { createSessionHandlers } from '../lib/training/session-http'
import { type TrainingPrincipal } from '../lib/training/auth'
import type { TrainingDatabase, Queryable } from '../lib/training/database'
import { ApiError } from '../lib/private-api'

const db = new PGlite()
const subject = 'auth0|synthetic-issue34'
const principal: TrainingPrincipal = { subject, source: 'browser', scopes: ['training.read','training.write'] }
const database: TrainingDatabase = { transaction: (sub, fn) => db.transaction(async tx => {
  await tx.exec('SET LOCAL ROLE stunna_runtime')
  await tx.query("SELECT set_config('stunna.subject',$1,true)",[sub])
  return fn(tx as Queryable)
}) }
const service = createTrainingService(database)
const command = (v: object) => ({ idempotencyKey: randomUUID(), reason: 'Synthetic issue34', ...v })
const reject = (code: number) => (e: unknown) => e instanceof ApiError && e.status === code
let athlete: string
let strength: NonNullable<Awaited<ReturnType<typeof service.workout>>>
let cardio: typeof strength
let other: typeof strength
let concurrent: typeof strength
const ex = { key: 'synthetic-lift', name: 'Synthetic lift', sets: 3, reps: 5, durationSeconds: null, target: null, restSeconds: 30, notes: null }
before(async () => {
  process.env.AUTH0_ALLOWED_SUB = subject
  for (const name of ['001_foundation','002_prescriptions','003_methodology','004_workout_overviews','005_session_start','006_session_entries','007_execution_checks','009_source_evidence']) {
    await db.exec(await readFile(new URL('../db/migrations/'+name+'.up.sql',import.meta.url),'utf8'))
  }
  await db.exec('CREATE ROLE stunna_runtime')
  await db.exec(await readFile(new URL('../db/runtime-grants.sql',import.meta.url),'utf8'))
  const b = await service.write(principal, command({ operation:'create_block',block:{title:'Synthetic',goal:'Fixture',startsOn:'2026-01-01',endsOn:'2026-01-31',source:'manual'} }))
  athlete = (await db.query<{id:string}>('SELECT id FROM stunna.athletes WHERE auth0_sub=$1',[subject])).rows[0].id
  for (const [i, exercise] of [ex, { ...ex, key:'synthetic-run', name:'Synthetic run', sets:null, reps:null, durationSeconds:120 }, ex, ex].entries()) {
    const p = await service.write(principal, command({ operation:'create_planned_session',plan:{
      blockId:b.blockId,kind:i===1?'run':'strength',purpose:'Same synthetic day',scheduledAt:'2026-01-02T12:00:00Z',timeZone:'UTC',source:'manual',
    } }))
    await db.query("INSERT INTO stunna.prescription_revisions(athlete_id,planned_session_id,revision,title,exercises,change_reason,source) VALUES($1,$2,1,'Synthetic',$3,'Fixture','synthetic')",
      [athlete,p.plannedSessionId,JSON.stringify([exercise])])
    const result = await service.write(principal, command({ operation:'start_workout',plannedSessionId:p.plannedSessionId,expectedPrescriptionRevision:1,expectedSessionRevision:0 }))
    if (i===0) strength=result.workout!
    if (i===1) cardio=result.workout!
    if (i===2) other=result.workout!
    if (i===3) concurrent=result.workout!
  }
})
after(() => db.close())
async function log(session: typeof strength, item: object) {
  const current = await service.results(principal,session.id)
  return service.write(principal,command({operation:'log_workout',sessionId:session.id,
    expectedSessionRevision:current.sessionRevision,expectedItemRevision:0,item}))
}
async function complete(session: typeof strength) {
  const current = await service.results(principal,session.id)
  return { ...command({}), operation:'complete_workout', sessionId:session.id, expectedSessionRevision:current.sessionRevision }
}
test('pinned strength completion preserves start, snapshot, notes and partial sets; exact retry is audited once',async()=>{
  const beforeRow = (await db.query<{started_at:Date;prescription_snapshot:unknown}>('SELECT started_at,prescription_snapshot FROM stunna.actual_sessions WHERE id=$1',[strength.id])).rows[0]
  await log(strength,{kind:'strength_set',occurrenceId:strength.snapshot!.occurrences[0].id,setOrdinal:1,
    actual:{reps:0,load:null,rpe:null,source:'user_reported'}})
  await log(strength,{kind:'workout_note',notes:'Synthetic saved overall note'})
  const input = await complete(strength)
  const receipt = await service.write(principal,input)
  assert.equal(receipt.actualSessionId,strength.id)
  assert.equal(receipt.sessionRevision,4)
  assert.deepEqual(await service.write(principal,input),receipt)
  const current = await service.results(principal,strength.id)
  assert.equal(current.status,'completed')
  assert.equal(current.notes,'Synthetic saved overall note')
  assert.equal(current.entries.length,1)
  assert.equal((current.entries[0].value as {reps:number}).reps,0)
  const row = (await db.query<{started_at:Date;completed_at:Date;prescription_snapshot:unknown;revision:number}>(
    'SELECT started_at,completed_at,prescription_snapshot,revision FROM stunna.actual_sessions WHERE id=$1',[strength.id])).rows[0]
  assert.deepEqual(row.started_at,beforeRow.started_at)
  assert.deepEqual(row.prescription_snapshot,beforeRow.prescription_snapshot)
  assert.ok(new Date(row.completed_at).getTime()>=new Date(row.started_at).getTime())
  assert.equal(row.revision,4)
  assert.equal((await db.query("SELECT id FROM stunna.audit_events WHERE operation='complete_workout' AND entity_id=$1",[strength.id])).rows.length,1)
  const planId = (await db.query<{planned_session_id:string}>('SELECT planned_session_id FROM stunna.actual_sessions WHERE id=$1',[strength.id])).rows[0].planned_session_id
  assert.equal((await service.workout(principal,planId))!.status,'completed')
  await assert.rejects(service.write(principal,{...input,idempotencyKey:randomUUID()}),reject(409))
  await assert.rejects(log(strength,{kind:'exercise_note',occurrenceId:strength.snapshot!.occurrences[0].id,notes:'After completion'}),reject(409))
})
test('cardio can finish with no telemetry, keep saved exercise notes, and not affect same-day workout',async()=>{
  const note = await log(cardio,{kind:'exercise_note',occurrenceId:cardio.snapshot!.occurrences[0].id,notes:'Synthetic cardio feeling'})
  assert.ok(note.entryId)
  const receipt = await service.write(principal,await complete(cardio))
  assert.equal(receipt.actualSessionId,cardio.id)
  const result = await service.results(principal,cardio.id)
  assert.equal(result.status,'completed')
  assert.equal(result.entries.length,1)
  assert.equal(result.entries[0].kind,'exercise_note')
  assert.equal((await service.results(principal,other.id)).status,'in_progress')
  assert.equal((await service.results(principal,other.id)).entries.length,0)
  assert.equal((await db.query<{count:number}>("SELECT count(*)::int AS count FROM stunna.session_entries WHERE session_id=$1 AND kind='interval'",[cardio.id])).rows[0].count,0)
})
test('stale revision, wrong owner, read-only principal, invalid input and no pinned snapshot fail closed',async()=>{
  const input=await complete(other)
  await assert.rejects(service.write(principal,{...input,expectedSessionRevision:input.expectedSessionRevision+1}),reject(409))
  await assert.rejects(service.write({...principal,subject:'auth0|synthetic-other'},input),reject(403))
  await assert.rejects(service.write({...principal,scopes:['training.read']},input),reject(403))
  await assert.rejects(service.write(principal,{...input,sessionId:'invalid'}),reject(400))
  assert.equal((await service.results(principal,other.id)).status,'in_progress')
})
test('audit failure rolls back completion and idempotency receipt',async()=>{
  const input=await complete(other)
  await db.exec("ALTER TABLE stunna.audit_events ADD CONSTRAINT issue34_test_rollback CHECK (operation <> 'complete_workout') NOT VALID")
  try { await assert.rejects(service.write(principal,input)) }
  finally { await db.exec('ALTER TABLE stunna.audit_events DROP CONSTRAINT issue34_test_rollback') }
  assert.equal((await service.results(principal,other.id)).status,'in_progress')
  assert.equal((await db.query('SELECT * FROM stunna.write_requests WHERE idempotency_key=$1',[input.idempotencyKey])).rows.length,0)
  const receipt=await service.write(principal,input)
  assert.equal(receipt.actualSessionId,other.id)
})
test('completion HTTP endpoint requires write principal and rejects other operations',async()=>{
  const seen:string[]=[]
  const handlers=createSessionHandlers({
    enabled:()=>true,principal:async(_r,scope)=>{seen.push(scope);return principal},service:()=>service,
  })
  const response=await handlers.POST(new Request('https://synthetic.example/api/training/session',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(command({operation:'create_block'})),
  }))
  assert.equal(response.status,400)
  assert.deepEqual(seen,['training.write'])
})

test('legacy observation cannot mutate pinned completed session or overwrite notes',async()=>{
  const row=(await db.query<{planned_session_id:string;started_at:Date;completed_at:Date;revision:number}>(
    'SELECT planned_session_id,started_at,completed_at,revision FROM stunna.actual_sessions WHERE id=$1',[strength.id])).rows[0]
  await assert.rejects(service.write(principal,command({operation:'record_observation',session:{
    plannedSessionId:row.planned_session_id,expectedRevision:row.revision,
    startedAt:new Date(row.started_at).toISOString(),completedAt:new Date(row.completed_at).toISOString(),
    status:'completed',notes:'Attempted overwrite',rpe:null,
  }})),reject(409))
  assert.equal((await service.results(principal,strength.id)).notes,'Synthetic saved overall note')
})

test('concurrent exact completion retries converge on one receipt and one audit event',async()=>{
  const input=await complete(concurrent)
  const [a,b]=await Promise.all([service.write(principal,input),service.write(principal,input)])
  assert.deepEqual(a,b)
  assert.equal((await db.query<{count:number}>("SELECT count(*)::int AS count FROM stunna.audit_events WHERE operation='complete_workout' AND entity_id=$1",[concurrent.id])).rows[0].count,1)
  await assert.rejects(service.write(principal,{...input,idempotencyKey:randomUUID()}),reject(409))
})
