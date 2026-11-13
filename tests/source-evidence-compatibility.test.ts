import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { createTrainingService } from '../lib/training/service'
import { createMcpTrainingActuals } from '../lib/training/mcp-actuals'
import { decodeGarminFitArchive } from '../lib/fit-activity'
import { normalizeGarminFit } from '../lib/training/garmin-evidence'
import { workoutFit } from './fixtures'
import type { TrainingPrincipal } from '../lib/training/auth'
import type { TrainingDatabase, Queryable } from '../lib/training/database'

test('migration-008 results, enabled-009 evidence, missing grants and rollback preserve browser/MCP workout reads',async()=>{
  const db=new PGlite(),subject='auth0|synthetic-compatibility-issue40'
  const principal:TrainingPrincipal={subject,source:'browser',scopes:['training.read','training.write']}
  process.env.AUTH0_ALLOWED_SUB=subject;process.env.STUNNA_ENABLED='true'
  const sql=(name:string)=>readFile(new URL('../db/migrations/'+name,import.meta.url),'utf8')
  try {
    for(const n of ['001_foundation','002_prescriptions','003_methodology','004_workout_overviews','005_session_start','006_session_entries','007_execution_checks','008_jit_publishing']) await db.exec(await sql(n+'.up.sql'))
    await db.exec('CREATE ROLE stunna_runtime');await db.exec(await readFile(new URL('../db/runtime-grants.sql',import.meta.url),'utf8'))
    const database:TrainingDatabase={transaction:(s,fn)=>db.transaction(async tx=>{
      await tx.exec('SET LOCAL ROLE stunna_runtime');await tx.query("SELECT set_config('stunna.subject',$1,true)",[s]);return fn(tx as Queryable)
    })}
    const service=createTrainingService(database),mcp=createMcpTrainingActuals(()=>service)
    const command=(v:object)=>({idempotencyKey:randomUUID(),reason:'Synthetic compatibility',...v})
    const block=await service.write(principal,command({operation:'create_block',block:{title:'Synthetic',goal:'Fixture',startsOn:'2026-10-01',endsOn:'2026-10-31',source:'manual'}}))
    const sessions:string[]=[]
    for(const status of ['in_progress','completed'] as const) {
      const plan=await service.write(principal,command({operation:'create_planned_session',plan:{blockId:block.blockId,kind:'strength',purpose:'Synthetic',scheduledAt:'2026-10-27T12:00:00Z',timeZone:'UTC',source:'manual'}}))
      const result=await service.write(principal,command({operation:'record_observation',session:{plannedSessionId:plan.plannedSessionId,expectedRevision:0,startedAt:'2026-10-27T12:00:00Z',completedAt:status==='completed'?'2026-10-27T13:00:00Z':null,status,notes:'Preserved synthetic notes',rpe:null}}))
      sessions.push(result.actualSessionId!)
    }
    async function baseline() {
      for(const flag of ['false','true']) {
        process.env.GARMIN_MCP_ENABLED=flag
        for(const id of sessions) {
          const result=await service.results(principal,id)
          assert.equal(result.notes,'Preserved synthetic notes');assert.equal(result.sessionRevision,1)
          assert.deepEqual(result.sourceResult,{status:'unavailable',evidence:[]})
          assert.deepEqual(await mcp.read({...principal,source:'api'},{sessionId:id,history:false,limit:25,offset:0}),result)
        }
      }
    }
    await baseline() // Original migration 008, source storage never provisioned.
    await db.exec(await sql('009_source_evidence.up.sql'))
    await baseline() // Migration present before optional runtime grants are applied.
    await db.exec(await readFile(new URL('../db/runtime-grants.sql',import.meta.url),'utf8'))
    const athlete=(await db.query<{id:string}>('SELECT id FROM stunna.athletes WHERE auth0_sub=$1',[subject])).rows[0].id
    const evidence=normalizeGarminFit({activityId:501,...decodeGarminFitArchive(workoutFit(),30,120)},501,subject,new Date())
    const id=randomUUID(),link=randomUUID()
    await database.transaction(subject,async tx=>{
      await tx.query("INSERT INTO stunna.source_links(id,athlete_id,session_id,provider,source_id) VALUES($1,$2,$3,'garmin','501')",[link,athlete,sessions[1]])
      await tx.query("INSERT INTO stunna.source_evidence_revisions(id,athlete_id,link_id,revision,evidence,actor_sub,source,reason) VALUES($1,$2,$3,1,$4,$5,'browser','Synthetic')",[id,athlete,link,JSON.stringify(evidence),subject])
    })
    const enabled=await service.results(principal,sessions[1])
    assert.equal(enabled.sourceResult?.status,'matched');assert.equal(enabled.sourceResult?.evidence[0].id,id)
    assert.deepEqual((await mcp.read(principal,{sessionId:sessions[1],history:false,limit:25,offset:0})).sourceResult,enabled.sourceResult)
    await db.exec(await sql('009_source_evidence.down.sql'))
    await baseline() // Rollback removes only optional evidence; existing reads still work.
  } finally {await db.close()}
})
