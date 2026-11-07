import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { generateSessionCookie } from '@auth0/nextjs-auth0/testing'
import { PGlite } from '@electric-sql/pglite'
import { confirmStartedWorkout } from '../lib/training/session-client'
import { createTrainingService } from '../lib/training/service'
import { createSessionHandlers } from '../lib/training/session-http'
import { requireTrainingPrincipal } from '../lib/training/auth'
import type { TrainingDatabase, Queryable } from '../lib/training/database'
import type { TrainingPrincipal } from '../lib/training/auth'
import { ApiError } from '../lib/private-api'
const db = new PGlite()
const subject = 'auth0|synthetic-session'
const principal: TrainingPrincipal = {subject,source:'browser',scopes:['training.read','training.write']}
const database: TrainingDatabase = { transaction: (identity, work) => db.transaction(async tx => {
  await tx.exec('SET LOCAL ROLE stunna_runtime')
  await tx.query("SELECT set_config('stunna.subject',$1,true)",[identity])
  return work(tx as Queryable)
}) }
const service = createTrainingService(database)
const command = (values: object) => ({idempotencyKey:randomUUID(),reason:'Synthetic start test',...values})
const start = (id:string, revision=1, sessionRevision=0) => command({operation:'start_workout',plannedSessionId:id,expectedPrescriptionRevision:revision,expectedSessionRevision:sessionRevision})
const status = (code:number) => (e:unknown) => e instanceof ApiError && e.status===code
let strength:string, run:string, athlete:string
const exercise = {key:'synthetic-squat',name:'Synthetic squat',sets:3,reps:5,durationSeconds:null,target:null,restSeconds:60,notes:null}
before(async()=>{
  process.env.AUTH0_ALLOWED_SUB=subject
  for(const name of ['001_foundation','002_prescriptions','003_methodology','004_workout_overviews','005_session_start']) await db.exec(await readFile(new URL('../db/migrations/'+name+'.up.sql',import.meta.url),'utf8'))
  await db.exec('CREATE ROLE stunna_runtime')
  await db.exec(await readFile(new URL('../db/runtime-grants.sql',import.meta.url),'utf8'))
  const b=await service.write(principal,command({operation:'create_block',block:{title:'Synthetic block',goal:'Fixture',startsOn:'2026-01-01',endsOn:'2026-01-31',source:'manual'}}))
  for(const kind of ['strength','run']) {
    const p=await service.write(principal,command({operation:'create_planned_session',plan:{blockId:b.blockId,kind,purpose:'Synthetic combined day',scheduledAt:'2026-01-02T12:00:00Z',timeZone:'UTC',source:'manual'}}))
    if(kind==='strength') strength=p.plannedSessionId!; else run=p.plannedSessionId!
  }
  athlete=(await db.query<{id:string}>('SELECT id FROM stunna.athletes WHERE auth0_sub=$1',[subject])).rows[0].id
  const intervals={...exercise,key:'synthetic-interval',name:'Synthetic intervals',intervalBlocks:[{repeat:2,segments:[{phase:'work',modality:'run',label:'Work',durationSeconds:60,targets:[],rpe:null},{phase:'recovery',modality:'run',label:'Recover',durationSeconds:60,targets:[],rpe:null}]}]}
  for(const [id,ex] of [[strength,exercise],[run,intervals]] as const) await db.query(`INSERT INTO stunna.prescription_revisions(athlete_id,planned_session_id,revision,title,exercises,change_reason,source) VALUES($1,$2,1,'Synthetic workout',$3,'Fixture','synthetic')`,[athlete,id,JSON.stringify([ex])])
})
after(()=>db.close())
test('start/retry/concurrent tabs converge, second service resumes, combined workouts have separate pinned IDs',async()=>{
  const input=start(strength)
  const [a,b,c]=await Promise.all([service.write(principal,input),service.write(principal,input),service.write(principal,start(strength))])
  assert.deepEqual(a,b);assert.equal(a.workout?.id,c.workout?.id)
  const resumed=await createTrainingService(database).workout(principal,strength)
  assert.deepEqual(resumed, a.workout)
  const other=await service.write(principal,start(run))
  assert.notEqual(other.workout?.id,a.workout?.id)
  assert.equal(other.workout?.snapshot?.occurrences.filter(x=>x.type==='interval').length,4)
  assert.equal(new Set(other.workout?.snapshot?.occurrences.map(x=>x.id)).size,5)
  assert.equal((await db.query('SELECT * FROM stunna.audit_events WHERE operation=$1',['start_workout'])).rows.length,2)
  await assert.rejects(service.write(principal,{...input,expectedPrescriptionRevision:2}),status(409))
  await assert.rejects(service.write(principal,start(strength,1,99)),status(409))
})
test('later approved plans do not rewrite pinned snapshot and finalized sessions never reopen',async()=>{
  const original=await service.workout(principal,strength)
  await db.query(`INSERT INTO stunna.prescription_revisions(athlete_id,planned_session_id,revision,title,exercises,change_reason,source) VALUES($1,$2,2,'Changed plan',$3,'Fixture','synthetic')`,[athlete,strength,JSON.stringify([{...exercise,reps:8}])])
  assert.deepEqual((await service.write(principal,start(strength,2))).workout,original)
  await assert.rejects(db.query('UPDATE stunna.actual_sessions SET prescription_revision=2 WHERE id=$1',[original!.id]))
  await db.query("UPDATE stunna.actual_sessions SET status='completed',completed_at=started_at,revision=2 WHERE id=$1",[original!.id])
  assert.equal((await service.write(principal,start(strength,2))).workout?.status,'completed')
  assert.equal((await service.workout(principal,strength))?.revision,2)
})
test('missing and future-only prescriptions fail, stale prescription conflicts, failed audit rolls back all writes',async()=>{
  const b=await service.write(principal,command({operation:'create_block',block:{title:'Fixture',goal:'Fixture',startsOn:'2026-01-01',endsOn:'2026-01-31',source:'manual'}}))
  const p=(await service.write(principal,command({operation:'create_planned_session',plan:{blockId:b.blockId,kind:'run',purpose:'Fixture',scheduledAt:'2026-01-02T12:00:00Z',timeZone:'UTC',source:'manual'}}))).plannedSessionId!
  await assert.rejects(service.write(principal,start(p)),status(404))
  await db.query(`INSERT INTO stunna.prescription_revisions(athlete_id,planned_session_id,revision,title,exercises,change_reason,source,approved_at) VALUES($1,$2,1,'Fixture',$3,'Fixture','synthetic','2099-01-01')`,[athlete,p,JSON.stringify([exercise])])
  await assert.rejects(service.write(principal,start(p)),status(404))
  await db.query("UPDATE stunna.prescription_revisions SET approved_at='2026-01-01' WHERE planned_session_id=$1",[p])
  await assert.rejects(service.write(principal,start(p,2)),status(409))
  await db.exec(`CREATE FUNCTION stunna.synthetic_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic failure'; END $$; CREATE TRIGGER synthetic_fail BEFORE INSERT ON stunna.audit_events FOR EACH ROW EXECUTE FUNCTION stunna.synthetic_fail()`)
  const input=start(p)
  try {await assert.rejects(service.write(principal,input))} finally {await db.exec('DROP TRIGGER synthetic_fail ON stunna.audit_events; DROP FUNCTION stunna.synthetic_fail()')}
  assert.equal(await service.workout(principal,p),null)
  assert.equal((await db.query('SELECT * FROM stunna.write_requests WHERE idempotency_key=$1',[input.idempotencyKey])).rows.length,0)
  assert.ok((await service.write(principal,input)).workout)
})
test('scope, subject, strict validation, ownership/RLS and snapshot grants fail closed',async()=>{
  await assert.rejects(service.write({...principal,scopes:['training.read']},start(run)),status(403))
  await assert.rejects(service.workout({...principal,subject:'auth0|wrong'},run),status(403))
  await assert.rejects(service.write(principal,{...start(run),athleteId:athlete}),status(400))
  await assert.rejects(service.workout(principal,'invalid'),status(400))
  await database.transaction('auth0|other',async tx=>assert.equal((await tx.query('SELECT * FROM stunna.actual_sessions')).rows.length,0))
  await assert.rejects(database.transaction(subject,tx=>tx.query("UPDATE stunna.actual_sessions SET prescription_snapshot='{}' WHERE planned_session_id=$1",[run])))
  await assert.rejects(database.transaction(subject,tx=>tx.query(`INSERT INTO stunna.actual_sessions(id,athlete_id,planned_session_id,started_at,status,source) VALUES($1,$2,$3,now(),'in_progress','manual')`,[randomUUID(),randomUUID(),run])))
})
test('new HTTP route enforces flag, invalid bearer, operation and request bounds with private responses',async()=>{
  const handler=createSessionHandlers({enabled:()=>false,principal:requireTrainingPrincipal,service:()=>service})
  assert.equal((await handler.GET(new Request('https://example.test/api/training/session?workout='+run))).status,404)
  const auth=createSessionHandlers({enabled:()=>true,principal:requireTrainingPrincipal,service:()=>service})
  assert.equal((await auth.POST(new Request('https://example.test/api/training/session',{method:'POST',headers:{authorization:'Bearer invalid'}}))).status,401)
  const local=createSessionHandlers({enabled:()=>true,principal:async()=>principal,service:()=>service})
  assert.equal((await local.POST(new Request('https://example.test/api/training/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operation:'record_observation'})}))).status,400)
  const read=await local.GET(new Request('https://example.test/api/training/session?workout='+run))
  assert.equal(read.status,200);assert.match(read.headers.get('cache-control')!,/no-store/)
})
test('two encrypted browser sessions resume server truth; CSRF, anonymous and invalid-bearer fallback fail',async()=>{
  const origin='https://session.invalid'
  Object.assign(process.env,{AUTH0_DOMAIN:'tenant.invalid',AUTH0_CLIENT_ID:'synthetic-client',AUTH0_CLIENT_SECRET:'synthetic-secret',AUTH0_SECRET:'7b'.repeat(32),APP_BASE_URL:origin})
  const cookie=async(sid:string)=>'__session='+await generateSessionCookie({user:{sub:subject},tokenSet:{accessToken:'synthetic',expiresAt:Math.floor(Date.now()/1000)+3600},internal:{sid,createdAt:Math.floor(Date.now()/1000)}},{secret:process.env.AUTH0_SECRET!})
  const first=await cookie('synthetic-first'),second=await cookie('synthetic-second')
  const handler=createSessionHandlers({enabled:()=>true,principal:requireTrainingPrincipal,service:()=>service})
  const input=start(run)
  const request=(headers:Record<string,string>)=>new Request(origin+'/api/training/session',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(input)})
  const result=await handler.POST(request({cookie:first,origin}));assert.equal(result.status,200)
  const saved=await result.json()
  const read=await handler.GET(new Request(origin+'/api/training/session?workout='+run,{headers:{cookie:second}}))
  assert.deepEqual(await read.json(),saved)
  assert.equal((await handler.POST(request({cookie:first}))).status,403)
  assert.equal((await handler.POST(request({cookie:first,origin:'null'}))).status,403)
  assert.equal((await handler.POST(request({cookie:first,origin,authorization:'Bearer invalid'}))).status,401)
  assert.equal((await handler.GET(new Request(origin+'/api/training/session?workout='+run))).status,401)
})

// The client helper is the exact write/read sequence used by SessionStart.
test('lost Start response followed by finalization reconciles current state without changing exact replay',async()=>{
  const input=start(run)
  const handlers=createSessionHandlers({enabled:()=>true,principal:async()=>principal,service:()=>service})
  let loseResponse=true
  const transport=async(url:string,init?:RequestInit)=>{
    const request=new Request('https://session.invalid'+url,init)
    if(init?.method==='POST') {
      const response=await handlers.POST(request)
      if(loseResponse) {loseResponse=false; throw new Error('Synthetic lost reply after commit')}
      return response
    }
    return handlers.GET(request)
  }
  await assert.rejects(confirmStartedWorkout(transport,run,input))
  const original=await service.workout(principal,run)
  await db.query("UPDATE stunna.actual_sessions SET status='completed',completed_at=started_at,revision=revision+1 WHERE id=$1",[original!.id])
  assert.equal((await service.write(principal,input)).workout!.status,'in_progress')
  const confirmed=await confirmStartedWorkout(transport,run,input)
  assert.equal(confirmed.status,'completed')
  assert.equal(confirmed.revision,original!.revision+1)
  assert.equal(confirmed.id,original!.id)
})
test('successful write with failed reconciliation remains unconfirmed and retries the same receipt safely',async()=>{
  const input=start(run)
  let failRead=true
  const handlers=createSessionHandlers({enabled:()=>true,principal:async()=>principal,service:()=>service})
  const transport=async(url:string,init?:RequestInit)=>{
    if(init?.method==='POST') return handlers.POST(new Request('https://session.invalid'+url,init))
    if(failRead) return new Response('{}',{status:503})
    return handlers.GET(new Request('https://session.invalid'+url,init))
  }
  await assert.rejects(confirmStartedWorkout(transport,run,input))
  failRead=false
  assert.equal((await confirmStartedWorkout(transport,run,input)).status,'completed')
})
