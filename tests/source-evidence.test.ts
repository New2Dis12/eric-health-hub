import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { Encoder, Profile, type SessionMesg, type RecordMesg, type FileIdMesg, type LapMesg } from '@garmin/fitsdk'
import { createTrainingService } from '../lib/training/service'
import { decodeGarminFitArchive } from '../lib/fit-activity'
import { normalizeGarminFit, candidatesFrom } from '../lib/training/garmin-evidence'
import type { GarminClient } from '../lib/training/garmin-evidence'
import type { TrainingPrincipal } from '../lib/training/auth'
import type { TrainingDatabase, Queryable } from '../lib/training/database'
import { createSourceHandlers } from '../lib/training/source-evidence-http'
import { createMcpTrainingActuals } from '../lib/training/mcp-actuals'
import { ApiError, requireSameOrigin } from '../lib/private-api'

const db=new PGlite()
const subject='auth0|synthetic-issue40'
const principal:TrainingPrincipal={subject,source:'api',scopes:['training.read','training.write'],healthScopes:['garmin.read']}
const database:TrainingDatabase={transaction:(s,work)=>db.transaction(async tx=>{
  await tx.exec('SET LOCAL ROLE stunna_runtime')
  await tx.query("SELECT set_config('stunna.subject',$1,true)",[s])
  return work(tx as Queryable)
})}
const start='2026-10-27T18:52:01.000Z',end='2026-10-27T19:22:01.000Z'
function syntheticFit(sport='running',missing=false) {
  const encoder=new Encoder()
  encoder.onMesg(Profile.MesgNum.FILE_ID,{type:'activity',manufacturer:'garmin'} as FileIdMesg)
  encoder.onMesg(Profile.MesgNum.SESSION,{sport,startTime:new Date(start),timestamp:new Date(end),
    totalElapsedTime:1800,totalTimerTime:1750,totalDistance:0,...(missing?{}:{avgHeartRate:150,avgCadence:80,avgSpeed:2.5,enhancedAvgSpeed:4.0})} as SessionMesg)
  encoder.onMesg(Profile.MesgNum.LAP,{startTime:new Date(start),timestamp:new Date(end),totalElapsedTime:1800,totalDistance:0} as LapMesg)
  encoder.onMesg(Profile.MesgNum.RECORD,{timestamp:new Date(start),distance:0,...(missing?{}:{heartRate:150,cadence:80,speed:0})} as RecordMesg)
  return Buffer.from(encoder.close())
}
const metadata=(id:number,typeKey='running')=>({activityId:id,activityName:'Synthetic activity',activityType:{typeKey},startTimeGMT:'2026-10-27 18:52:01',duration:1800,distance:0})
let raw:unknown=[metadata(101),metadata(102,'indoor_cycling'),metadata(103,'indoor_rowing')]
let unavailable=false,malformed=false,fitCalls=0,listCalls=0
const client:GarminClient={list:async limit=>{listCalls++;assert.equal(limit,20);if(unavailable) throw new Error('synthetic outage');return raw},fit:async id=>{
  fitCalls++;if(unavailable) throw new Error('synthetic outage')
  return {activityId:id,...decodeGarminFitArchive(malformed?Buffer.alloc(10):syntheticFit(id===102?'cycling':id===103?'rowing':'running',id===103),30,120,0,0,20)}
}}
const service=createTrainingService(database,()=>new Date('2026-10-28T00:00:00Z'),client)
let athlete:string,run:string,bike:string,row:string,second:string,inProgress:string
const reject=(status:number)=>(e:unknown)=>e instanceof ApiError && e.status===status
const command=(sessionId:string,activityId:number,expectedEvidenceRevision=0)=>({sessionId,activityId,expectedSessionRevision:2,expectedEvidenceRevision,confirmed:true,idempotencyKey:randomUUID(),reason:'Synthetic explicit owner confirmation'})
before(async()=>{
  process.env.AUTH0_ALLOWED_SUB=subject;process.env.STUNNA_ENABLED='true';process.env.GARMIN_MCP_ENABLED='true'
  for(const n of ['001_foundation','002_prescriptions','003_methodology','004_workout_overviews','005_session_start','006_session_entries','007_execution_checks','008_jit_publishing','009_source_evidence']) await db.exec(await readFile(new URL('../db/migrations/'+n+'.up.sql',import.meta.url),'utf8'))
  await db.exec('CREATE ROLE stunna_runtime')
  await db.exec(await readFile(new URL('../db/runtime-grants.sql',import.meta.url),'utf8'))
  athlete=randomUUID();const block=randomUUID()
  await db.query('INSERT INTO stunna.athletes(id,auth0_sub) VALUES($1,$2)',[athlete,subject])
  await db.query("INSERT INTO stunna.training_blocks(id,athlete_id,title,goal,starts_on,ends_on,source) VALUES($1,$2,'Synthetic','Fixture','2026-10-01','2026-10-31','manual')",[block,athlete])
  for(const kind of ['run','bike','other','run','run']) {
    const plan=randomUUID(),id=randomUUID()
    await db.query("INSERT INTO stunna.planned_sessions(id,athlete_id,block_id,planned_on,time_zone,kind,purpose,source) VALUES($1,$2,$3,'2026-10-27','UTC',$4,'Synthetic','manual')",[plan,athlete,block,kind])
    const active=!!second
    const snapshot={title:'Synthetic pinned workout',kind,purpose:'Fixture',overview:null,exercises:kind==='other'?[{key:'row',name:'Synthetic rowing',sets:null,reps:null,durationSeconds:1800,target:null,restSeconds:null,notes:null,intervalBlocks:[{repeat:1,segments:[{modality:'row'}]}]}]:[],occurrences:[]}
    await db.query("INSERT INTO stunna.prescription_revisions(athlete_id,planned_session_id,revision,title,exercises,change_reason,source) VALUES($1,$2,1,'Synthetic',$3,'Fixture','synthetic')",[athlete,plan,JSON.stringify([{key:'synthetic',name:'Synthetic',sets:null,reps:null,durationSeconds:1800,target:null,restSeconds:null,notes:null}])])
    await db.query("INSERT INTO stunna.actual_sessions(id,athlete_id,planned_session_id,started_at,completed_at,status,source,revision,prescription_revision,prescription_snapshot) VALUES($1,$2,$3,$4,$5,$6,'manual',2,1,$7)",[id,athlete,plan,start,active?null:end,active?'in_progress':'completed',JSON.stringify(snapshot)])
    if(!run)run=id;else if(!bike)bike=id;else if(!row)row=id;else if(!second)second=id;else inProgress=id
  }
})
after(()=>db.close())

test('same-day multiple candidates and wrong modality are hints only, all require confirmation',async()=>{
  const page=await service.sources.candidates(principal,run)
  assert.equal(page.status,'needs_confirmation');assert.equal(page.candidates.length,3)
  assert.equal(page.candidates[0].startUtc,start);assert.equal(page.candidates[0].compatible,true)
  assert.equal(page.candidates.find(c=>c.activityId===102)?.compatible,false)
  assert.equal((await service.results(principal,run)).sourceResult?.status,'unavailable')
  assert.equal(fitCalls,0)
  await assert.rejects(service.sources.link(principal,{...command(run,101),confirmed:false}),reject(400))
  await assert.rejects(service.sources.link(principal,{...command(run,101),metrics:{power:500}}),reject(400))
})
test('run FIT persists native summary, zero versus null, source identity and fresh browser/MCP readback',async()=>{
  const input=command(run,101),receipt=await service.sources.link(principal,input)
  const current=await createTrainingService(database).results({...principal,source:'browser'},run)
  assert.equal(current.status,'completed');assert.equal(current.sessionRevision,2);assert.equal(current.entries.length,0)
  const saved=current.sourceResult!.evidence[0]
  assert.equal(saved.id,receipt.evidenceId);assert.equal(saved.evidence.sourceId,'101');assert.equal(saved.evidence.modality,'run')
  assert.equal(saved.evidence.summary.find(m=>m.field==='distanceMeters')?.value,0)
  assert.equal(saved.evidence.summary.find(m=>m.field==='avgPowerWatts')?.value,null)
  assert.equal(saved.evidence.summary.find(m=>m.field==='elapsedSeconds')?.value,1800)
  assert.equal(saved.evidence.summary.find(m=>m.field==='avgSpeedMetersPerSecond')?.value,4)
  assert.match(saved.evidence.contentSha256,/^[0-9a-f]{64}$/)
  assert.equal(saved.evidence.match.actor,subject)
  assert.equal(saved.evidence.laps.length,1)
  assert.ok(!saved.evidence.sensors.columns.includes('paceSecondsPerKm'))
  const mcp=createMcpTrainingActuals(()=>service)
  assert.deepEqual((await mcp.read(principal,{sessionId:run,history:false,limit:25,offset:0})).sourceResult,current.sourceResult)
  unavailable=true
  const previousCalls=fitCalls
  assert.deepEqual(await service.sources.link(principal,input),receipt)
  assert.equal(fitCalls,previousCalls)
  unavailable=false
  assert.equal((await db.query("SELECT * FROM stunna.audit_events WHERE operation='link_garmin' AND entity_id=$1",[receipt.evidenceId])).rows.length,1)
  await assert.rejects(service.sources.link(principal,{...input,reason:'Different input'}),reject(409))
})
test('bike and row sources persist without fabricating absent power or HR',async()=>{
  await service.sources.link(principal,command(bike,102))
  await service.sources.link(principal,command(row,103))
  assert.equal((await service.results(principal,bike)).sourceResult?.evidence[0].evidence.modality,'bike')
  const saved=(await service.results(principal,row)).sourceResult!.evidence[0].evidence
  assert.equal(saved.modality,'row');assert.equal(saved.summary.find(m=>m.field==='avgHeartRateBpm')?.value,null)
  assert.equal(saved.sensors.samples[0][saved.sensors.columns.indexOf('heartRateBpm')],null)
  assert.equal(saved.summary.find(m=>m.field==='distanceMeters')?.value,0)
})
test('duplicate activity and replacement/relink are rejected; refresh appends history with optimistic revision',async()=>{
  await assert.rejects(service.sources.link(principal,command(second,101)),reject(409))
  await assert.rejects(service.sources.link(principal,command(run,102,1)),reject(409))
  await assert.rejects(service.sources.link(principal,command(run,101)),reject(409))
  const result=await service.sources.link(principal,command(run,101,1))
  assert.equal(result.evidenceRevision,2)
  assert.equal((await db.query('SELECT * FROM stunna.source_evidence_revisions e JOIN stunna.source_links l ON l.id=e.link_id WHERE l.session_id=$1',[run])).rows.length,2)
  assert.equal((await service.results(principal,run)).sourceResult?.evidence[0].revision,2)
  assert.equal((await service.results(principal,run)).sessionRevision,2)
  await assert.rejects(service.sources.link(principal,{...command(run,101,2),expectedSessionRevision:1}),reject(409))
})
test('ownership, Garmin permission, read/write scopes, completed pin and feature gates fail before vendor access',async()=>{
  const before=listCalls
  await assert.rejects(service.sources.candidates({...principal,subject:'auth0|wrong'},run),reject(403))
  await assert.rejects(service.sources.candidates({...principal,healthScopes:[]},run),reject(403))
  await assert.rejects(service.sources.link({...principal,scopes:['training.read']},command(second,101)),reject(403))
  await assert.rejects(service.sources.candidates(principal,randomUUID()),reject(404))
  await assert.rejects(service.sources.candidates(principal,inProgress),reject(409))
  process.env.GARMIN_MCP_ENABLED='false'
  await assert.rejects(service.sources.candidates(principal,run),reject(404))
  process.env.GARMIN_MCP_ENABLED='true';assert.equal(listCalls,before)
  await database.transaction('auth0|wrong',async tx=>assert.equal((await tx.query('SELECT * FROM stunna.source_links')).rows.length,0))
})
test('Garmin outage, malformed FIT and activity outside bounded candidates leave no new writes',async()=>{
  unavailable=true;assert.equal((await service.sources.candidates(principal,second)).status,'unavailable')
  await assert.rejects(service.sources.link(principal,command(second,101)),reject(422));unavailable=false
  malformed=true;await assert.rejects(service.sources.link(principal,command(second,101)),reject(422));malformed=false
  await assert.rejects(service.sources.link(principal,command(second,999)),reject(422))
  assert.equal((await service.results(principal,second)).sourceResult?.evidence.length,0)
})
test('audit failure rolls back identity, evidence and idempotency receipt',async()=>{
  raw=[metadata(104)]
  const input=command(second,104)
  await db.exec("ALTER TABLE stunna.audit_events ADD CONSTRAINT issue40_rollback CHECK (operation<>'link_garmin') NOT VALID")
  try {await assert.rejects(service.sources.link(principal,input))}
  finally {await db.exec('ALTER TABLE stunna.audit_events DROP CONSTRAINT issue40_rollback')}
  assert.equal((await db.query('SELECT * FROM stunna.source_links WHERE session_id=$1',[second])).rows.length,0)
  assert.equal((await db.query('SELECT * FROM stunna.write_requests WHERE idempotency_key=$1',[input.idempotencyKey])).rows.length,0)
  const [a,b]=await Promise.all([service.sources.link(principal,input),service.sources.link(principal,input)])
  assert.deepEqual(a,b)
})
test('runtime cannot update/delete provenance history; FORCE RLS and composite identity enforced',async()=>{
  const rows=(await db.query<{relname:string;relrowsecurity:boolean;relforcerowsecurity:boolean}>("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('source_links','source_evidence_revisions')")).rows
  assert.equal(rows.length,2);assert.ok(rows.every(r=>r.relrowsecurity && r.relforcerowsecurity))
  for(const sql of ['UPDATE stunna.source_links SET provider=provider','DELETE FROM stunna.source_evidence_revisions']) await assert.rejects(database.transaction(subject,tx=>tx.query(sql)))
})
test('candidate normalization bounds, incomplete UTC metadata and absent summaries never infer metrics',()=>{
  const c=candidatesFrom([{...metadata(1),startTimeGMT:null,activityType:{}},metadata(1),metadata(2,'unknown')],['run'],new Date(start),new Date(end),new Set())
  assert.equal(c[0].startUtc,null);assert.equal(c[0].modality,null)
  assert.throws(()=>candidatesFrom(Array.from({length:21},(_,i)=>metadata(i+1)),[],new Date(start),new Date(end),new Set()))
  const encoded=new Encoder();encoded.onMesg(Profile.MesgNum.RECORD,{timestamp:new Date(start),heartRate:100} as RecordMesg)
  const fit={activityId:1,...decodeGarminFitArchive(Buffer.from(encoded.close()),30,120)}
  const evidence=normalizeGarminFit(fit,1,subject,new Date())
  assert.deepEqual(evidence.summary,[]);assert.equal(evidence.modality,null);assert.equal(evidence.endUtc,null)
  assert.throws(()=>decodeGarminFitArchive(Buffer.alloc(16*1024*1024+1),30,120),/too large/)
})
test('HTTP adapter uses training scopes, private cache, strict JSON bounds and configured-origin CSRF',async()=>{
  const scopes:string[]=[]
  const handlers=createSourceHandlers({enabled:()=>true,principal:async(_r,s)=>{scopes.push(s);return principal},service:()=>service})
  const read=await handlers.GET(new Request('https://synthetic.example/api/training/sources?session='+run))
  assert.equal(read.status,200);assert.equal(read.headers.get('cache-control'),'private, no-store')
  const write=await handlers.POST(new Request('https://synthetic.example/api/training/sources',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:run})}))
  assert.equal(write.status,400);assert.deepEqual(scopes,['training.read','training.write'])
  process.env.APP_BASE_URL='https://synthetic.example'
  assert.throws(()=>requireSameOrigin(new Request('https://attacker.example',{headers:{host:'synthetic.example',origin:'https://attacker.example'}})),reject(403))
  assert.throws(()=>requireSameOrigin(new Request('https://synthetic.example',{headers:{origin:'https://synthetic.example','sec-fetch-site':'cross-site'}})),reject(403))
})


test('multiple native FIT sessions do not become an invented summary or modality',()=>{
  const encoder=new Encoder()
  for(const sport of ['running','cycling']) encoder.onMesg(Profile.MesgNum.SESSION,{sport,startTime:new Date(start),timestamp:new Date(end),totalElapsedTime:1800} as SessionMesg)
  const evidence=normalizeGarminFit({activityId:1,...decodeGarminFitArchive(Buffer.from(encoder.close()),30,120)},1,subject,new Date())
  assert.deepEqual(evidence.summary,[]);assert.equal(evidence.modality,null)
  assert.ok(evidence.coverage.warnings.some(w=>w.includes('No single native session summary')))
})
