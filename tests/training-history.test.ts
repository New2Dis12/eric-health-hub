import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { PGlite } from '@electric-sql/pglite'
import { createTrainingHistoryReader } from '../lib/training/history'
import { createEricHealthMcpServer } from '../lib/mcp-server'
import type { TrainingDatabase, Queryable } from '../lib/training/database'
import type { TrainingPrincipal } from '../lib/training/auth'
import { ApiError } from '../lib/private-api'

const db = new PGlite()
const owner = 'auth0|issue59-synthetic-owner'
const other = 'auth0|issue59-synthetic-other'
const principal: TrainingPrincipal = { subject: owner, source: 'api', scopes: ['training.read'] }
const database: TrainingDatabase = {
  transaction: (subject, work) => db.transaction(async tx => {
    await tx.exec('SET LOCAL ROLE stunna_runtime')
    await tx.query("SELECT set_config('stunna.subject',$1,true)", [subject])
    return work(tx as Queryable)
  }),
}
const read = createTrainingHistoryReader(() => database)
const fixture = (name: string) => readFile(new URL('../db/migrations/' + name + '.up.sql', import.meta.url), 'utf8')
const reject = (n: number) => (error: unknown) => error instanceof ApiError && error.status === n

before(async () => {
  process.env.STUNNA_ENABLED = 'true'
  process.env.AUTH0_ALLOWED_SUB = owner
  for (const n of ['001_foundation', '002_prescriptions', '003_methodology', '004_workout_overviews', '005_session_start', '006_session_entries', '007_execution_checks', '008_jit_publishing']) {
    await db.exec(await fixture(n))
  }
  await db.exec('CREATE ROLE stunna_runtime')
  await db.exec(await readFile(new URL('../db/runtime-grants.sql', import.meta.url), 'utf8'))
  const athlete = randomUUID(), outsider = randomUUID(), block = randomUUID(), plan = randomUUID()
  await db.query("INSERT INTO stunna.athletes(id,auth0_sub,time_zone) VALUES($1,$2,'America/Chicago'),($3,$4,'America/Chicago')", [athlete,owner,outsider,other])
  await db.query("INSERT INTO stunna.training_blocks(id,athlete_id,title,goal,starts_on,ends_on,source) VALUES($1,$2,'Synthetic fall block','Return to consistent training','2026-09-01','2026-12-01','manual')",[block,athlete])
  await db.query("INSERT INTO stunna.block_context_revisions(athlete_id,block_id,revision,context,change_reason,approved_at) VALUES($1,$2,1,$3,'Synthetic methodology',now())",[
    athlete,block,JSON.stringify({weeklyStructure:[],progressionRules:['Build consistency'],sourceReferences:['synthetic']}),
  ])
  const workoutGroup = 'history:traininglog:2026-10-06-run:noon'
  const bench = (id:string,athleteId:string,key:string,when:string,performance:unknown,sourceReference:string) =>
    db.query("INSERT INTO stunna.exercise_benchmarks(id,athlete_id,exercise_key,performed_at,performance,source,verification_status,comparison_context,source_reference) VALUES($1,$2,$3,$4,$5,'reviewed_import','verified','Indoor training',$6)",[
      id,athleteId,key,when,JSON.stringify(performance),sourceReference,
    ])
  await bench(randomUUID(),athlete,'treadmill-run','2026-10-06T17:00:00Z',{sets:1,reps:null,durationSeconds:1800,target:null,targets:[{metric:'distance',unit:'km',range:{min:5,max:5}}]},workoutGroup)
  await bench(randomUUID(),athlete,'goblet-squat','2026-10-06T17:00:00Z',{sets:3,reps:8,durationSeconds:null,target:{value:35,unit:'lb'}},'history:traininglog:2026-10-06-strength:noon')
  await bench(randomUUID(),athlete,'cycling-cadence','2026-10-12T17:00:00Z',{sets:1,reps:null,durationSeconds:900,target:null},'history:traininglog:2026-10-12-bike:noon')
  await bench(randomUUID(),outsider,'deadlift','2026-10-06T17:00:00Z',{sets:2,reps:5,durationSeconds:null,target:{value:300,unit:'lb'}},'history:other-athlete:private:noon')
  await db.query("INSERT INTO stunna.body_measurements(id,athlete_id,kind,value,unit,measured_at,time_zone,source) VALUES($1,$2,'weight',190,'lb','2026-10-01T17:00:00Z','America/Chicago','api')",[randomUUID(),athlete])
  await db.query("INSERT INTO stunna.body_measurements(id,athlete_id,kind,value,unit,measured_at,time_zone,source) VALUES($1,$2,'weight',188,'lb','2026-10-15T17:00:00Z','America/Chicago','api')",[randomUUID(),athlete])
  await db.query("INSERT INTO stunna.body_measurements(id,athlete_id,kind,value,unit,measured_at,time_zone,source) VALUES($1,$2,'waist',35,'in','2026-10-15T17:00:00Z','America/Chicago','api')",[randomUUID(),athlete])
  await db.query("INSERT INTO stunna.planned_sessions(id,athlete_id,block_id,planned_on,time_zone,kind,purpose,source) VALUES($1,$2,$3,'2026-10-18','America/Chicago','strength','Synthetic live workout','manual')",[plan,athlete,block])
  await db.query("INSERT INTO stunna.actual_sessions(id,athlete_id,planned_session_id,started_at,completed_at,status,notes,rpe,source) VALUES($1,$2,$3,'2026-10-18T13:00:00Z','2026-10-18T14:00:00Z','completed','Synthetic completed training',7,'manual')",[
    randomUUID(),athlete,plan,
  ])
})
after(() => db.close())

test('historical benchmark search finds two independent same-day workouts, and noon precision', async () => {
  const page = await read(principal,{fromDate:'2026-10-06',toDate:'2026-10-06',category:'workouts'})
  assert.equal(page.records.length,2)
  assert.deepEqual(page.records.map(x=>x.label).sort(),['goblet-squat','treadmill-run'])
  assert.equal(new Set(page.records.map(x=>x.sourceReference)).size,2)
  assert.ok(page.records.every(x=>x.date==='2026-10-06' && x.timePrecision==='standardized_noon'))
  assert.ok(!page.records.some(x=>JSON.stringify(x).includes('deadlift')))
})

test('exercise name and metric substrings are searchable without a saved session UUID', async () => {
  const run = await read(principal,{query:'distance',category:'benchmarks'})
  assert.equal(run.records.length,1)
  assert.equal(run.records[0].label,'treadmill-run')
  assert.equal(((run.records[0].details.performance as {targets:{metric:string}[]}).targets[0]).metric,'distance')
  const squat = await read(principal,{query:'goblet',category:'all'})
  assert.equal(squat.records.length,1)
})

test('weight and waist trend are paginated, correctly dated and never mixed with private athlete', async () => {
  const page = await read(principal,{category:'measurements',query:'weight',limit:1})
  assert.equal(page.records.length,1); assert.equal(page.hasMore,true)
  assert.equal(page.records[0].date,'2026-10-15')
  assert.equal(page.records[0].details.value,188)
  const second = await read(principal,{category:'measurements',query:'weight',limit:1,offset:1})
  assert.equal(second.hasMore,false)
  assert.equal(second.records[0].details.value,190)
})

test('block context and existing live session are discoverable without altering either', async () => {
  const context = await read(principal,{category:'blocks',query:'consistency'})
  assert.equal(context.records.length,1)
  assert.deepEqual((context.records[0].details.methodology as {progressionRules:string[]}).progressionRules,['Build consistency'])
  const completed = await read(principal,{category:'workouts',fromDate:'2026-10-18',toDate:'2026-10-18'})
  assert.equal(completed.records.length,1)
  assert.equal(completed.records[0].details.status,'completed')
  assert.equal(completed.records[0].details.resultsTool,'get_saved_workout_results')
})

test('input validation and existing scoped authorization reject inappropriate queries', async () => {
  await assert.rejects(read(principal,{fromDate:'2026-12-01',toDate:'2026-09-01'}),reject(400))
  await assert.rejects(read(principal,{limit:10000}),reject(400))
  await assert.rejects(read({...principal,scopes:[]},{}),reject(403))
  await assert.rejects(read({...principal,subject:other},{}),reject(403))
  const empty = await read(principal,{fromDate:'2026-11-01',toDate:'2026-11-01'})
  assert.equal(empty.records.length,1) // the block interval overlaps the requested date
})

test('read-only runtime RLS separates both valid athlete identities', async () => {
  const saved=process.env.AUTH0_ALLOWED_SUB
  process.env.AUTH0_ALLOWED_SUB=other
  try {
    const outside=await read({...principal,subject:other},{category:'benchmarks'})
    assert.equal(outside.records.length,1)
    assert.equal(outside.records[0].label,'deadlift')
    assert.ok(outside.records.every(x=>!JSON.stringify(x).includes('goblet-squat')))
  } finally {
    process.env.AUTH0_ALLOWED_SUB=saved
  }
})

test('tied noon timestamps page through every benchmark exactly once', async () => {
  const { rows: ownerRows } = await db.query<{id:string}>('SELECT id FROM stunna.athletes WHERE auth0_sub=$1',[owner])
  for (let n=1;n<=3;n++) {
    const id='00000000-0000-4000-8000-'+String(n).padStart(12,'0')
    await db.query(
      "INSERT INTO stunna.exercise_benchmarks(id,athlete_id,exercise_key,performed_at,performance,source,verification_status,comparison_context,source_reference) VALUES ($1,$2,'tie-benchmark','2026-10-15T17:00:00Z',$3,'synthetic','verified','Tied synthetic noon','test:tie:noon')",
      [id,ownerRows[0].id,JSON.stringify({sets:1,reps:n,durationSeconds:null,target:null})],
    )
  }
  const pageIds:string[]=[]
  for (let offset=0;offset<3;offset++) {
    const page=await read(principal,{category:'benchmarks',query:'tie-benchmark',fromDate:'2026-10-15',toDate:'2026-10-15',limit:1,offset})
    assert.equal(page.records.length,1)
    pageIds.push(page.records[0].id)
  }
  assert.deepEqual(pageIds,[1,2,3].map(n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')))
  assert.equal(new Set(pageIds).size,3)
  const last=await read(principal,{category:'benchmarks',query:'tie-benchmark',fromDate:'2026-10-15',toDate:'2026-10-15',limit:1,offset:3})
  assert.equal(last.records.length,0)
})

test('measurement date filters use record timezone rather than current Chicago setting', async () => {
  const {rows:ownerRows}=await db.query<{id:string}>('SELECT id FROM stunna.athletes WHERE auth0_sub=$1',[owner])
  const id=randomUUID()
  await db.query(
    "INSERT INTO stunna.body_measurements(id,athlete_id,kind,value,unit,measured_at,time_zone,source) VALUES ($1,$2,'waist',34,'in','2026-10-07T00:30:00Z','Asia/Tokyo','api')",
    [id,ownerRows[0].id],
  )
  const tokyoDay=await read(principal,{category:'measurements',query:'waist',fromDate:'2026-10-07',toDate:'2026-10-07'})
  assert.deepEqual(tokyoDay.records.map(x=>x.id),[id])
  assert.equal(tokyoDay.records[0].date,'2026-10-07')
  assert.equal(tokyoDay.records[0].details.measurementTimeZone,'Asia/Tokyo')
  const priorChicagoDate=await read(principal,{category:'measurements',query:'waist',fromDate:'2026-10-06',toDate:'2026-10-06'})
  assert.equal(priorChicagoDate.records.length,0)
})

test('existing MCP connection exposes read-only history with owner scope and structured results', async () => {
  const server = createEricHealthMcpServer(false,{
    canReadOura:false,trainingPrincipal:principal,historyReader:read,
  })
  const client = new Client({name:'stunna-history-synthetic-client',version:'1.0.0'})
  const [a,b]=InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(a),client.connect(b)])
  try {
    const tools = await client.listTools()
    assert.ok(tools.tools.some(x=>x.name==='get_training_history'))
    assert.ok(tools.tools.some(x=>x.name==='get_training_context'))
    assert.ok(tools.tools.some(x=>x.name==='get_saved_workout_results'))
    const result = await client.callTool({name:'get_training_history',arguments:{fromDate:'2026-10-06',toDate:'2026-10-06',category:'benchmarks'}})
    assert.notEqual(result.isError,true)
    assert.equal((result.structuredContent as {records:unknown[]}).records.length,2)
  } finally {
    await client.close()
    await server.close()
  }
})
