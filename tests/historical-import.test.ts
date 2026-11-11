import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { migrate } from '../scripts/migrations'
import { createTrainingService } from '../lib/training/service'
import { historicalBatch, inspectMarkdownStructure, normalizeHistoricalMarkdown, sourceClasses } from '../lib/training/historical-models'
import { createHistoricalHandlers } from '../lib/training/historical-http'
import { createTrainingHandlers } from '../lib/training/http'
import type { TrainingDatabase, Queryable } from '../lib/training/database'
import type { TrainingPrincipal } from '../lib/training/auth'
import { ApiError } from '../lib/private-api'

const db=new PGlite()
const subject='auth0|history-synthetic'
const athlete='33333333-3333-4333-8333-333333333333'
const principal:TrainingPrincipal={subject,source:'api',scopes:['training.read','training.write']}
const connection:TrainingDatabase={transaction:(sub,work)=>db.transaction(async tx=>{
  await tx.query('SET LOCAL ROLE stunna_runtime')
  await tx.query("SELECT set_config('stunna.subject',$1,true)",[sub])
  return work(tx as Queryable)
})}
const service=createTrainingService(connection)
const checksum=(letter:string)=>letter.repeat(64)
const summary=(exercise:string)=>({exercise,sets:3,reps:null,load:{value:50,unit:'lb',basis:'total'},
  rpe:7,verification:'partial_summary'})
const workout=(id:string,modality:'strength'|'run'='strength')=>({
  sourceRecordId:id,category:'workout',occurredOn:'2024-03-05',modality,
  completion:'confirmed',precision:'date',startedAt:null,rpe:null,notes:null,
  strength:modality==='strength'?[summary('Synthetic lift')]:[],
  metrics:modality==='run'?[{name:'distance',value:5,unit:'km',provenance:'reported'}]:[],
  provenance:'reported',
})
const batch=(version:number,records:unknown[],hash='a')=>historicalBatch.parse({
  sourceKey:'training_log',fileVersion:version,checksum:checksum(hash),authority:90,records,
})
const importIt=(b:ReturnType<typeof batch>,dryRun=true)=>service.importHistory(principal,b,
  dryRun?{dryRun:true}:{dryRun:false,explicitPrivateAuthorization:true})
const read=()=>service.history(principal,{limit:25,offset:0})
const status=(code:number)=>(e:unknown)=>e instanceof ApiError && e.status===code
before(async()=>{
  process.env.AUTH0_ALLOWED_SUB=subject
  await db.transaction(tx=>migrate({query:async(sql:string,values?:unknown[])=>
    values?tx.query(sql,values):{rows:(await tx.exec(sql)).at(-1)?.rows??[]}} as Queryable,'up'))
  await db.exec('CREATE ROLE stunna_runtime')
  await db.exec(await readFile(new URL('../db/runtime-grants.sql',import.meta.url),'utf8'))
  await db.query('INSERT INTO stunna.athletes(id,auth0_sub) VALUES($1,$2)',[athlete,subject])
})
after(()=>db.close())

test('date-only unplanned strength and run are independent without invented timestamps',async()=>{
  const b=batch(1,[workout('strength-one'),workout('run-one','run')])
  assert.deepEqual((await importIt(b)).created,2)
  assert.equal((await read()).items.length,0,'dry run must not write')
  const result=await importIt(b,false)
  assert.equal(result.created,2)
  const page=await read()
  assert.equal(page.items.length,2)
  assert.equal(new Set(page.items.map((x:any)=>x.session_id)).size,2)
  for(const item of page.items as any[]){
    assert.equal(item.started_at,null)
    assert.equal(item.historical_precision,'date')
    assert.equal(item.status,'completed')
    assert.equal(item.observed_on,'2024-03-05')
  }
  assert.equal((await db.query<{n:number}>("SELECT count(*)::int AS n FROM stunna.actual_sessions WHERE is_historical")).rows[0].n,2)
})

test('partial strength retains unknown reps and load convention, not a confirmed set',async()=>{
  const entry=(await read()).items.find((x:any)=>x.source_record_id==='strength-one') as any
  assert.equal(entry.payload.details.strength[0].reps,null)
  assert.equal(entry.payload.details.strength[0].load.basis,'total')
  assert.equal(entry.payload.details.strength[0].verification,'partial_summary')
  assert.equal((await db.query<{n:number}>('SELECT count(*)::int AS n FROM stunna.session_entries')).rows[0].n,0)
})

test('recovery, prescriptions and estimated BIA do not become workouts or verified measures',async()=>{
  const records=[
    {sourceRecordId:'recovery',category:'recovery',occurredOn:'2024-03-06',
     provenance:'reported',representation:'represented',attributes:{type:'rest'}},
    {sourceRecordId:'plan',category:'plan',occurredOn:'2024-03-07',
     provenance:'prescribed',representation:'represented',attributes:{sets:3}},
    {sourceRecordId:'bia',category:'bia_estimate',occurredOn:'2024-03-08',
     provenance:'estimated',representation:'optional_unknowns',attributes:{bodyFatPercent:20}},
    {sourceRecordId:'unknown',category:'unknown',occurredOn:null,
     provenance:'unknown',representation:'deferred',attributes:{reason:'unmapped'}},
  ]
  assert.equal((await importIt(batch(2,[...records,workout('strength-one'),workout('run-one','run')],'b'),false)).created,4)
  const page=await read()
  assert.equal(page.items.length,6)
  assert.equal(page.items.filter((x:any)=>x.session_id!==null).length,2)
  assert.equal((await db.query<{n:number}>('SELECT count(*)::int AS n FROM stunna.body_measurements')).rows[0].n,0)
  assert.equal(historicalBatch.safeParse({sourceKey:'training_log',fileVersion:3,checksum:checksum('c'),
    authority:90,records:[{...records[2],provenance:'measured'}]}).success,false)
})

test('file-version reconciliation is dry-run, idempotent, revisioned and audited',async()=>{
  const corrected={...workout('strength-one'),notes:'Corrected synthetic observation',rpe:8}
  const all=[corrected,workout('run-one','run')]
  const b=batch(3,all,'c')
  const preview=await importIt(b)
  assert.equal(preview.updated,1)
  assert.equal(preview.unchanged,1)
  assert.equal(preview.missingFromSnapshot,4)
  assert.equal((await read()).items.find((x:any)=>x.source_record_id==='strength-one')?.revision,1)
  assert.equal((await importIt(b,false)).updated,1)
  assert.equal((await importIt(b,false)).duplicate,true)
  const page=await read()
  assert.equal(page.items.find((x:any)=>x.source_record_id==='strength-one')?.revision,2)
  assert.equal(page.items.length,6)
  assert.equal((await service.history(principal,{revisions:true,limit:25,offset:0})).items.length,7)
  assert.equal((await db.query<{n:number}>("SELECT count(*)::int AS n FROM stunna.historical_evidence WHERE source_record_id='strength-one'")).rows[0].n,2)
  assert.ok(Number((await db.query<{n:number}>("SELECT count(*)::int AS n FROM stunna.audit_events WHERE operation='historical_import'")).rows[0].n)>=7)
  await assert.rejects(importIt(batch(2,all,'d'),false),status(409))
  await assert.rejects(importIt(batch(3,all,'e'),false),status(409))
})

test('scope and athlete subject deny history and private import; page bounds enforced',async()=>{
  await assert.rejects(service.history({...principal,scopes:['training.write']},{limit:25,offset:0}),status(403))
  await assert.rejects(service.importHistory({...principal,scopes:['training.read']},batch(4,[],'d'),{dryRun:true}),status(403))
  await assert.rejects(service.history({...principal,subject:'auth0|other'},{limit:25,offset:0}),status(403))
  await assert.rejects(service.history(principal,{limit:500,offset:0}),status(400))
  assert.equal((await service.history(principal,{date:'2024-03-05',limit:25,offset:0})).items.length,2)
  const first=(await read()).items.find((x:any)=>x.session_id) as any
  assert.equal((await service.history(principal,{sessionId:first.session_id,limit:25,offset:0})).items.length,1)
  await connection.transaction(subject,async tx=>{
    const rows=(await tx.query('SELECT * FROM stunna.historical_evidence WHERE athlete_id=$1',[athlete])).rows
    assert.ok(rows.length>0)
  })
  await connection.transaction('auth0|other',async tx=>{
    assert.equal((await tx.query('SELECT * FROM stunna.historical_evidence')).rows.length,0)
    await assert.rejects(tx.query('INSERT INTO stunna.historical_import_files(athlete_id,source_key,file_version,checksum,authority) VALUES($1,$2,99,$3,1)',[athlete,'bad',checksum('f')]))
  })
})

test('live-player strictness survives historical migration',async()=>{
  await assert.rejects(connection.transaction(subject,tx=>tx.query(
    "INSERT INTO stunna.actual_sessions(id,athlete_id,source,status,started_at) VALUES('44444444-4444-4444-8444-444444444444',$1,'api','completed',NULL)",[athlete])))
  await assert.rejects(connection.transaction(subject,tx=>tx.query(
    "UPDATE stunna.actual_sessions SET is_historical=false WHERE is_historical=true AND historical_on='2024-03-05'")))
})

test('HTTP history route is feature-gated and read-only; synthetic scope and bounds',async()=>{
  const request=new Request('https://example.test/api/training/history?date=2024-03-05&limit=1')
  const deps={enabled:()=>true,principal:async()=>principal,service:()=>service}
  const response=await createHistoricalHandlers(deps).GET(request)
  assert.equal(response.status,200)
  assert.equal((await response.json()).items.length,1)
  assert.equal((await createHistoricalHandlers({...deps,enabled:()=>false}).GET(request)).status,404)
  assert.equal((await createHistoricalHandlers(deps).GET(new Request('https://example.test/api/training/history?limit=10000'))).status,400)
})

test('populated history refuses destructive rollback without reviewed export',async()=>{
  await assert.rejects(db.transaction(tx=>migrate({query:async(sql:string,values?:unknown[])=>(
    values?tx.query(sql,values):{rows:(await tx.exec(sql)).at(-1)?.rows??[]})} as Queryable,'down')),
    /Historical records exist/)
})

test('Markdown structure enumerates all nine classes without inventing values',()=>{
  assert.equal(sourceClasses.length,9)
  for(const c of sourceClasses){
    const result=inspectMarkdownStructure(c,'# Synthetic\n## Section\nUnknown details')
    assert.equal(result.headingCount,2)
    assert.equal(result.requiresPrivateMapping,true)
    assert.ok(result.supportedCategories.length)
  }
  assert.throws(()=>inspectMarkdownStructure('training_log','x'.repeat(2_000_001)))
})


test('strict Markdown adapter normalizes synthetic versions and explicitly defers ambiguous sections',async()=>{
  const markdown=(notes:string)=>`# Synthetic private log
<!-- stunna-record: markdown-strength -->
- category: workout
- occurredOn: 2024-05-12
- modality: strength
- completion: confirmed
- precision: date
- provenance: reported
- logicalRecordId: markdown-logical
- notes: ${notes}
| exercise | sets | reps | load | unit | basis | rpe | verification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Synthetic lift | 2 | ? | ? | | | ? | partial_summary |
<!-- stunna-record: unsupported-one -->
- category: coaching
- notes: Not a workout
`
  const one=normalizeHistoricalMarkdown({fileClass:'training_log',sourceKey:'markdown_synthetic',
    fileVersion:1,authority:65,markdown:markdown('Initial synthetic')})
  assert.deepEqual(one.unmappedCategories,['coaching'])
  assert.deepEqual(one.deferredIds,['unsupported-one'])
  assert.equal(one.batch.records.length,2)
  const parsedWorkout=one.batch.records.find(x=>x.category==='workout')
  assert.equal(parsedWorkout?.category==='workout' && parsedWorkout.strength[0].reps,null)
  assert.equal((await service.importHistory(principal,one.batch,{dryRun:true})).created,2)
  assert.equal((await service.importHistory(principal,one.batch,
    {dryRun:false,explicitPrivateAuthorization:true})).created,2)
  const two=normalizeHistoricalMarkdown({fileClass:'training_log',sourceKey:'markdown_synthetic',
    fileVersion:2,authority:65,markdown:markdown('Revised synthetic')})
  assert.equal((await service.importHistory(principal,two.batch,{dryRun:true})).updated,1)
  assert.equal((await service.importHistory(principal,two.batch,
    {dryRun:false,explicitPrivateAuthorization:true})).updated,1)
  assert.equal((await service.importHistory(principal,two.batch,
    {dryRun:false,explicitPrivateAuthorization:true})).duplicate,true)
  const entries=(await service.history(principal,{revisions:true,limit:50,offset:0})).items as any[]
  assert.equal(entries.filter(x=>x.source_record_id==='markdown-strength').length,2)
  const unmarked=normalizeHistoricalMarkdown({fileClass:'training_log',sourceKey:'unmarked',
    fileVersion:1,authority:65,markdown:'# Unstructured private content\nNo explicit identity'})
  assert.equal(unmarked.batch.records.length,0)
  assert.ok(unmarked.unmappedCategories.includes('unmarked_markdown'))
})

test('cross-source authority shares one logical session while preserving each revision snapshot',async()=>{
  const first={...workout('source-a'),logicalRecordId:'shared-synthetic',
    notes:'Low authority date-only'}
  const high={...workout('source-b'),logicalRecordId:'shared-synthetic',
    precision:'exact',startedAt:'2024-03-05T09:00:00Z',notes:'High authority exact'}
  const lower={...workout('source-c'),logicalRecordId:'shared-synthetic',
    notes:'Lower authority must not replace exact time'}
  const make=(key:string,authority:number,record:unknown)=>historicalBatch.parse({
    sourceKey:key,fileVersion:1,checksum:checksum('a'),authority,records:[record]})
  await service.importHistory(principal,make('source_a',40,first),
    {dryRun:false,explicitPrivateAuthorization:true})
  await service.importHistory(principal,make('source_b',95,high),
    {dryRun:false,explicitPrivateAuthorization:true})
  await service.importHistory(principal,make('source_c',10,lower),
    {dryRun:false,explicitPrivateAuthorization:true})
  const evidence=(await service.history(principal,{revisions:true,limit:50,offset:0})).items as any[]
  const shared=evidence.filter(x=>x.source_record_id.startsWith('source-'))
  assert.equal(shared.length,3)
  assert.equal(new Set(shared.map(x=>x.session_id)).size,1)
  assert.equal(shared.find(x=>x.source_record_id==='source-a').historical_precision,'date')
  assert.equal(shared.find(x=>x.source_record_id==='source-a').started_at,null)
  assert.equal(shared.find(x=>x.source_record_id==='source-b').historical_precision,'exact')
  assert.equal(shared.find(x=>x.source_record_id==='source-c').historical_precision,'date')
  const current=(await db.query<{historical_precision:string;notes:string}>(
    "SELECT historical_precision,notes FROM stunna.actual_sessions WHERE id=$1",
    [shared[0].session_id])).rows[0]
  assert.equal(current.historical_precision,'exact')
  assert.equal(current.notes,'High authority exact')
  assert.equal((await db.query<{n:number}>(
    'SELECT count(*)::int AS n FROM stunna.actual_sessions WHERE id=$1',
    [shared[0].session_id])).rows[0].n,1)
  assert.notEqual(shared[0].session_id,
    (evidence.find(x=>x.source_record_id==='run-one') as any).session_id)
})

test('same-source correction preserves old date-only evidence after exact-time update',async()=>{
  const corrected={...workout('strength-one'),precision:'exact',
    startedAt:'2024-03-05T12:30:00Z',notes:'Synthetic exact correction'}
  const next=batch(4,[corrected,workout('run-one','run')],'d')
  await importIt(next,false)
  const rows=(await service.history(principal,{revisions:true,limit:50,offset:0})).items as any[]
  const versions=rows.filter(x=>x.source_record_id==='strength-one')
    .sort((a,b)=>a.revision-b.revision)
  assert.equal(versions.length,3)
  assert.equal(versions[0].historical_precision,'date')
  assert.equal(versions[0].started_at,null)
  assert.equal(versions[1].historical_precision,'date')
  assert.equal(versions[2].historical_precision,'exact')
  assert.ok(versions[2].started_at)
})

test('legacy training HTTP read remains live-only after history import and preserves paging',async()=>{
  await connection.transaction(subject,async tx=>{
    await tx.query(`INSERT INTO stunna.training_blocks
      (id,athlete_id,title,goal,starts_on,ends_on,source)
      VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',$1,'Synthetic block','Test',
        '2024-03-01','2024-03-31','manual')`,[athlete])
    await tx.query(`INSERT INTO stunna.planned_sessions
      (id,athlete_id,block_id,scheduled_at,time_zone,kind,purpose,source)
      VALUES('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',$1,
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2024-03-10T10:00:00Z',
        'UTC','strength','Synthetic planned','manual')`,[athlete])
    await tx.query(`INSERT INTO stunna.actual_sessions
      (id,athlete_id,planned_session_id,started_at,status,source)
      VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc',$1,
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','2024-03-10T10:00:00Z',
        'in_progress','api')`,[athlete])
  })
  const deps={enabled:()=>true,principal:async()=>principal,service:()=>service}
  const legacy=await createTrainingHandlers(deps).GET(
    new Request('https://example.test/api/training?limit=1&offset=0'))
  assert.equal(legacy.status,200)
  const payload=await legacy.json() as {sessions:any[]}
  assert.equal(payload.sessions.length,1)
  assert.equal(payload.sessions[0].source,'api')
  assert.ok(payload.sessions[0].planned_session_id)
  assert.ok(payload.sessions[0].started_at)
  const historical=await createHistoricalHandlers(deps).GET(
    new Request('https://example.test/api/training/history?limit=1&offset=0'))
  assert.equal(historical.status,200)
  assert.equal((await historical.json()).items.length,1)
})

test('database rejects NULL historical modality and precision, not UNKNOWN CHECK results',async()=>{
  const id='99999999-9999-4999-8999-999999999999'
  const insert=(modality:string|null,precision:string|null)=>connection.transaction(subject,tx=>tx.query(
    `INSERT INTO stunna.actual_sessions(id,athlete_id,source,status,is_historical,
      historical_on,historical_modality,historical_precision)
      VALUES($1,$2,'reviewed_import','completed',true,'2024-03-05',$3,$4)`,
    [id,athlete,modality,precision]))
  await assert.rejects(insert(null,'date'))
  await assert.rejects(insert('run',null))
  await assert.rejects(insert(null,null))
})
