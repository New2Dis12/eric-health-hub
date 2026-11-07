import {test,before,after} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {generateSessionCookie} from '@auth0/nextjs-auth0/testing'
import {createTrainingService} from '../lib/training/service'
import {createLoggingHandlers} from '../lib/training/logging-http'
import {requireTrainingPrincipal,type TrainingPrincipal} from '../lib/training/auth'
import type {TrainingDatabase,Queryable} from '../lib/training/database'
import type {WorkoutSession} from '../lib/training/session'
import {ApiError} from '../lib/private-api'
const db=new PGlite(), subject='auth0|synthetic-task2'
const principal:TrainingPrincipal={subject,source:'browser',scopes:['training.read','training.write']}
const database:TrainingDatabase={transaction:(sub,fn)=>db.transaction(async tx=>{
  await tx.exec('SET LOCAL ROLE stunna_runtime');await tx.query("SELECT set_config('stunna.subject',$1,true)",[sub]);return fn(tx as Queryable)
})}
const service=createTrainingService(database), cmd=(v:object)=>({idempotencyKey:randomUUID(),reason:'Synthetic logging test',...v})
let strength:WorkoutSession,other:WorkoutSession,intervals:WorkoutSession,athlete:string
const ex={key:'synthetic-squat',name:'Synthetic squat',sets:3,reps:5,durationSeconds:null,target:null,restSeconds:60,notes:null}
const actual={reps:0,load:{value:0,unit:'kg',basis:'added'},rpe:null,source:'user_reported'}
const reject=(code:number)=>(e:unknown)=>e instanceof ApiError&&e.status===code
const occ=(s:WorkoutSession,type='exercise')=>s.snapshot!.occurrences.find(o=>o.type===type)!.id
async function log(s:WorkoutSession,item:object,itemRevision=0){
  const state=await service.results(principal,s.id)
  return cmd({operation:'log_workout',sessionId:s.id,expectedSessionRevision:state.sessionRevision,expectedItemRevision:itemRevision,item})
}
before(async()=>{
  process.env.AUTH0_ALLOWED_SUB=subject
  for(const name of ['001_foundation','002_prescriptions','003_methodology','004_workout_overviews','005_session_start','006_session_entries']) await db.exec(await readFile(new URL('../db/migrations/'+name+'.up.sql',import.meta.url),'utf8'))
  await db.exec('CREATE ROLE stunna_runtime');await db.exec(await readFile(new URL('../db/runtime-grants.sql',import.meta.url),'utf8'))
  const b=await service.write(principal,cmd({operation:'create_block',block:{title:'Synthetic',goal:'Fixture',startsOn:'2026-01-01',endsOn:'2026-01-31',source:'manual'}}))
  athlete=(await db.query<{id:string}>('SELECT id FROM stunna.athletes WHERE auth0_sub=$1',[subject])).rows[0].id
  const endurance={...ex,key:'synthetic-endurance',name:'Synthetic endurance',sets:null,reps:null,
    warmups:[{phase:'warmup',modality:'run',label:'Warm up',durationSeconds:60,targets:[],rpe:null}],
    intervalBlocks:[{repeat:2,segments:['run','row','bike'].flatMap(modality=>['work','recovery'].map(phase=>({phase,modality,label:'Synthetic segment',durationSeconds:60,targets:[],rpe:null})))}]}
  const sessions=[]
  for(const exercise of [ex,ex,endurance]){
    const p=await service.write(principal,cmd({operation:'create_planned_session',plan:{blockId:b.blockId,kind:exercise===endurance?'run':'strength',purpose:'Synthetic combined day',scheduledAt:'2026-01-02T12:00:00Z',timeZone:'UTC',source:'manual'}}))
    await db.query(`INSERT INTO stunna.prescription_revisions(athlete_id,planned_session_id,revision,title,exercises,change_reason,source) VALUES($1,$2,1,'Synthetic',$3,'Fixture','synthetic')`,[athlete,p.plannedSessionId,JSON.stringify([exercise])])
    const s=await service.write(principal,cmd({operation:'start_workout',plannedSessionId:p.plannedSessionId,expectedPrescriptionRevision:1,expectedSessionRevision:0}));sessions.push(s.workout!)
  }
  ;[strength,other,intervals]=sessions
})
after(()=>db.close())
test('strength entries preserve zero/null, typed loads, independent sessions and immutable prescription',async()=>{
  const snapshot=JSON.stringify(strength.snapshot)
  for(const [i,basis] of ['total','per_hand','bodyweight'].entries()) await service.write(principal,await log(strength,{kind:'strength_set',occurrenceId:occ(strength),setOrdinal:i+1,actual:{...actual,reps:i===0?0:null,load:{value:i*10,unit:i===1?'lb':'kg',basis},rpe:i===1?7:null}}))
  const read=await createTrainingService(database).results(principal,strength.id)
  assert.equal(read.entries.length,3);assert.equal((read.entries[0].value as typeof actual).reps,0)
  assert.equal((read.entries[1].value as typeof actual).reps,null)
  assert.equal((await service.results(principal,other.id)).entries.length,0)
  const saved=await service.workout(principal,(await db.query<{planned_session_id:string}>('SELECT planned_session_id FROM stunna.actual_sessions WHERE id=$1',[strength.id])).rows[0].planned_session_id)
  assert.equal(JSON.stringify(saved!.snapshot),snapshot)
})
test('exercise/overall notes correct and clear with prior values retained; bounded read/history',async()=>{
  const item={kind:'exercise_note',occurrenceId:occ(strength),notes:'Synthetic exercise note'}
  const first=await service.write(principal,await log(strength,item))
  await service.write(principal,await log(strength,{...item,notes:''},1))
  await service.write(principal,await log(strength,{kind:'workout_note',notes:'Synthetic overall'}))
  await service.write(principal,await log(strength,{kind:'workout_note',notes:''},1))
  const saved=await service.results(principal,strength.id),history=await service.results(principal,strength.id,true)
  assert.equal(saved.notes,'');assert.equal(saved.entries.find(e=>e.id===first.entryId),undefined)
  const corrections=history.entries.filter(e=>e.kind==='exercise_note');assert.equal(corrections.length,2)
  assert.deepEqual(corrections[1].before_value,{notes:'Synthetic exercise note'})
  assert.equal(corrections[1].actor_sub,subject);assert.equal(corrections[1].source,'browser')
  const p=await service.results(principal,strength.id,true,2);assert.equal(p.entries.length,2);assert.equal(p.nextOffset,2)
  assert.equal((await service.results(principal,strength.id,true,2,2)).entries.length,2)
})
test('strength correction retains old actuals and exact replay; changed keys/revisions conflict',async()=>{
  const item={kind:'strength_set',occurrenceId:occ(strength),setOrdinal:1,actual:{...actual,reps:4}}
  const input=await log(strength,item,1),result=await service.write(principal,input)
  assert.deepEqual(await service.write(principal,input),result)
  await assert.rejects(service.write(principal,{...input,item:{...item,actual:{...actual,reps:8}}}),reject(409))
  await assert.rejects(service.write(principal,await log(strength,item,1)),reject(409))
  const history=await service.results(principal,strength.id,true)
  const entry=history.entries.find(e=>e.id===result.entryId)!
  assert.equal((entry.before_value as typeof actual).reps,0);assert.equal((entry.value as typeof actual).reps,4)
  assert.equal((await db.query('SELECT * FROM stunna.audit_events WHERE entity_id=$1',[result.entryId])).rows.length,1)
})
test('running/rowing/cycling ordered warmup/work/recovery actuals accept correct units and explicit missing values',async()=>{
  for(const occurrence of intervals.snapshot!.occurrences.filter(o=>o.type!=='exercise')){
    const segment=occurrence.type==='warmup'?intervals.snapshot!.exercises[0].warmups![0]:intervals.snapshot!.exercises[0].intervalBlocks![0].segments[occurrence.segment!]
    const special=segment.modality==='row'?{metric:'rowing_split',value:130,unit:'sec/500m'}:segment.modality==='bike'?{metric:'cycling_cadence',value:90,unit:'rpm'}:{metric:'pace',value:330,unit:'sec/km'}
    await service.write(principal,await log(intervals,{kind:'interval',occurrenceId:occurrence.id,actual:{metrics:[{metric:'duration',value:null,unit:'s'},{metric:'distance',value:0,unit:'m'},{metric:'speed',value:2,unit:'m/s'},{metric:'power',value:100,unit:'W'},special,...(segment.modality==='row'?[{metric:'stroke_rate',value:24,unit:'spm'}]:[])],rpe:null,source:'user_reported'}}))
  }
  const read=await service.results(principal,intervals.id)
  assert.deepEqual(read.entries.map(e=>e.occurrence_id),intervals.snapshot!.occurrences.filter(o=>o.type!=='exercise').map(o=>o.id))
  assert.equal(read.entries.length,13)
})
test('invalid modality, units, bounds, cross-workout identities and extra fields reject without writes',async()=>{
  const inputs=[
    {kind:'strength_set',occurrenceId:occ(other),setOrdinal:1,actual},
    {kind:'strength_set',occurrenceId:occ(strength),setOrdinal:4,actual},
    {kind:'strength_set',occurrenceId:occ(strength),setOrdinal:1,actual:{...actual,reps:501}},
    {kind:'strength_set',occurrenceId:occ(strength),setOrdinal:1,actual:{...actual,load:{value:10,unit:'W',basis:'total'}}},
    {kind:'exercise_note',occurrenceId:randomUUID(),notes:'Synthetic'},
  ]
  for(const item of inputs) await assert.rejects(service.write(principal,await log(strength,item)),reject(400))
  for(const metrics of [[{metric:'rowing_split',value:10,unit:'sec/500m'}],[{metric:'speed',value:10,unit:'rpm'}],[{metric:'power',value:6000,unit:'W'}],[{metric:'duration',value:1,unit:'s'},{metric:'duration',value:2,unit:'s'}]]) await assert.rejects(service.write(principal,await log(intervals,{kind:'interval',occurrenceId:occ(intervals,'warmup'),actual:{metrics,rpe:null,source:'user_reported'}})),reject(400))
})
test('concurrent first entry/edit conflicts, audit failure rolls back entry/session/receipt',async()=>{
  const item={kind:'exercise_note',occurrenceId:occ(other),notes:'Synthetic race'}
  const a=await log(other,item),b=await log(other,{...item,notes:'Synthetic competitor'})
  const results=await Promise.allSettled([service.write(principal,a),service.write(principal,b)])
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1)
  const before=await service.results(principal,other.id)
  const input=await log(other,{kind:'workout_note',notes:'Synthetic rolled back'})
  await db.exec(`CREATE FUNCTION stunna.synthetic_fail_log() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic audit failure'; END $$; CREATE TRIGGER synthetic_fail_log BEFORE INSERT ON stunna.audit_events FOR EACH ROW EXECUTE FUNCTION stunna.synthetic_fail_log()`)
  try {await assert.rejects(service.write(principal,input))} finally {await db.exec('DROP TRIGGER synthetic_fail_log ON stunna.audit_events; DROP FUNCTION stunna.synthetic_fail_log()')}
  assert.deepEqual(await service.results(principal,other.id),before)
  assert.equal((await db.query('SELECT * FROM stunna.write_requests WHERE idempotency_key=$1',[input.idempotencyKey])).rows.length,0)
  await service.write(principal,input)
})
test('runtime grants, FORCE RLS, cross-owner FK and finalized writes fail closed',async()=>{
  await database.transaction('auth0|unrelated',async tx=>assert.equal((await tx.query('SELECT * FROM stunna.session_entries')).rows.length,0))
  await database.transaction('',async tx=>assert.equal((await tx.query('SELECT * FROM stunna.session_entries')).rows.length,0))
  await assert.rejects(database.transaction(subject,tx=>tx.query('DELETE FROM stunna.session_entries')))
  await assert.rejects(database.transaction(subject,tx=>tx.query("UPDATE stunna.session_entries SET reason='Changed'")))
  await assert.rejects(database.transaction(subject,tx=>tx.query('CREATE TABLE stunna.forbidden(id integer)')))
  const forced=await db.query<{relforcerowsecurity:boolean}>("SELECT relforcerowsecurity FROM pg_class WHERE oid='stunna.session_entries'::regclass");assert.equal(forced.rows[0].relforcerowsecurity,true)
  await assert.rejects(service.results({...principal,subject:'auth0|wrong'},strength.id),reject(403))
  await assert.rejects(service.results({...principal,scopes:['training.write']},strength.id),reject(403))
  await assert.rejects(service.write({...principal,scopes:['training.read']},await log(strength,{kind:'workout_note',notes:''})),reject(403))
  await db.query("UPDATE stunna.actual_sessions SET status='completed',completed_at=started_at WHERE id=$1",[other.id])
  await assert.rejects(service.write(principal,await log(other,{kind:'workout_note',notes:''},1)),reject(409))
})
test('logging HTTP: encrypted cookie saves/reads, CSRF/bearer/anonymous/flag/bounds fail safely',async()=>{
  const origin='https://task2.invalid'
  Object.assign(process.env,{AUTH0_DOMAIN:'tenant.invalid',AUTH0_CLIENT_ID:'synthetic',AUTH0_CLIENT_SECRET:'synthetic',AUTH0_SECRET:'2a'.repeat(32),APP_BASE_URL:origin})
  const cookie='__session='+await generateSessionCookie({user:{sub:subject},tokenSet:{accessToken:'synthetic',expiresAt:Math.floor(Date.now()/1000)+3600},internal:{sid:'synthetic',createdAt:Math.floor(Date.now()/1000)}},{secret:process.env.AUTH0_SECRET!})
  const handlers=createLoggingHandlers({enabled:()=>true,principal:requireTrainingPrincipal,service:()=>service})
  const input=await log(strength,{kind:'workout_note',notes:'Synthetic HTTP'},2)
  const post=(extra:Record<string,string>,body=JSON.stringify(input))=>handlers.POST(new Request(origin+'/api/training/results',{method:'POST',headers:{'content-type':'application/json',cookie,...extra},body}))
  assert.equal((await post({origin})).status,200)
  assert.equal((await post({origin})).status,200)
  const read=await handlers.GET(new Request(origin+'/api/training/results?session='+strength.id,{headers:{cookie}}))
  assert.equal(read.status,200);assert.equal((await read.json()).notes,'Synthetic HTTP');assert.match(read.headers.get('cache-control')!,/no-store/)
  assert.equal((await post({origin:'null'})).status,403)
  assert.equal((await post({origin,authorization:'Bearer invalid'})).status,401)
  assert.equal((await post({origin},'x'.repeat(17000))).status,413)
  assert.equal((await post({origin},'{')).status,400)
  assert.equal((await handlers.GET(new Request(origin+'/api/training/results?session='+strength.id))).status,401)
  const disabled=createLoggingHandlers({enabled:()=>false,principal:requireTrainingPrincipal,service:()=>service})
  assert.equal((await disabled.GET(new Request(origin))).status,404)
})

test('source-only DB constraints reject malformed results/cross-session FKs; null loads and scope guards persist',async()=>{
  const item={kind:'strength_set',occurrenceId:occ(strength),setOrdinal:2,actual:{reps:null,load:null,rpe:null,source:'user_reported'}}
  await service.write(principal,await log(strength,item,1))
  assert.deepEqual((await service.results(principal,strength.id)).entries.find(e=>e.kind==='strength_set'&&e.set_ordinal===2)!.value,item.actual)
  await assert.rejects(service.write({...principal,subject:'auth0|unrelated'},await log(strength,{kind:'workout_note',notes:''},3)),reject(403))
  await assert.rejects(service.results(principal,strength.id,false,101),reject(400))
  const insert=(athleteId:string,sessionId:string,occurrence:string,value:object)=>database.transaction(subject,tx=>tx.query(`INSERT INTO stunna.session_entries(id,athlete_id,session_id,item_key,kind,occurrence_id,set_ordinal,revision,session_revision,value,actor_sub,source,reason) VALUES($1,$2,$3,$4,'strength_set',$5,1,50,999,$6,$7,'browser','Synthetic SQL rejection')`,[randomUUID(),athleteId,sessionId,'strength_set:'+occurrence+':1',occurrence,JSON.stringify(value),subject]))
  await assert.rejects(insert(athlete,strength.id,occ(strength),{...actual,load:{value:5,unit:'W',basis:'total'}}))
  await assert.rejects(insert(randomUUID(),strength.id,occ(strength),actual))
  await assert.rejects(insert(athlete,strength.id,occ(intervals),actual))
  const fk=(await db.query<{count:number}>("SELECT count(*)::int AS count FROM pg_constraint WHERE conrelid='stunna.session_entries'::regclass AND contype='f' AND array_length(conkey,1)=2")).rows[0]
  assert.equal(fk.count,1)
})

test('pinned strength with unspecified prescribed reps accepts explicitly confirmed null or user-entered reps',async()=>{
  const block=await service.write(principal,cmd({operation:'create_block',block:{title:'Synthetic missing-reps fixture',goal:'Fixture',startsOn:'2026-01-01',endsOn:'2026-01-31',source:'manual'}}))
  const plan=await service.write(principal,cmd({operation:'create_planned_session',plan:{blockId:block.blockId,kind:'strength',purpose:'Synthetic',scheduledAt:'2026-01-02T12:00:00Z',timeZone:'UTC',source:'manual'}}))
  await db.query(`INSERT INTO stunna.prescription_revisions(athlete_id,planned_session_id,revision,title,exercises,change_reason,source) VALUES($1,$2,1,'Synthetic',$3,'Fixture','synthetic')`,[athlete,plan.plannedSessionId,JSON.stringify([{...ex,reps:null}])])
  const saved=await service.write(principal,cmd({operation:'start_workout',plannedSessionId:plan.plannedSessionId,expectedPrescriptionRevision:1,expectedSessionRevision:0}))
  await service.write(principal,await log(saved.workout!,{kind:'strength_set',occurrenceId:occ(saved.workout!),setOrdinal:1,actual:{reps:null,load:null,rpe:null,source:'user_reported'}}))
  const value=(await service.results(principal,saved.workout!.id)).entries[0].value
  assert.ok('reps' in value);assert.equal(value.reps,null)
})
