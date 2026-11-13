// Local synthetic browser harness only. No real identity, vendor calls or hosted DB.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { Encoder, Profile, type FileIdMesg, type SessionMesg, type RecordMesg } from '@garmin/fitsdk'
import { createTrainingService } from '../../lib/training/service'
import { createSourceHandlers } from '../../lib/training/source-evidence-http'
import { decodeGarminFitArchive } from '../../lib/fit-activity'
import { requireSameOrigin } from '../../lib/private-api'
import type { Queryable, TrainingDatabase } from '../../lib/training/database'
import type { TrainingPrincipal } from '../../lib/training/auth'

async function main() {
const db=new PGlite(),athlete=randomUUID(),block=randomUUID(),plan=randomUUID(),session=randomUUID()
const subject='auth0|synthetic-browser-issue40'
process.env.AUTH0_ALLOWED_SUB=subject;process.env.STUNNA_ENABLED='true';process.env.GARMIN_MCP_ENABLED='true'
const principal:TrainingPrincipal={subject,source:'browser',scopes:['training.read','training.write']}
for(const n of ['001_foundation','002_prescriptions','003_methodology','004_workout_overviews','005_session_start','006_session_entries','007_execution_checks','008_jit_publishing','009_source_evidence']) await db.exec(await readFile(new URL('../../db/migrations/'+n+'.up.sql',import.meta.url),'utf8'))
await db.exec('CREATE ROLE stunna_runtime');await db.exec(await readFile(new URL('../../db/runtime-grants.sql',import.meta.url),'utf8'))
await db.query('INSERT INTO stunna.athletes(id,auth0_sub) VALUES($1,$2)',[athlete,subject])
await db.query("INSERT INTO stunna.training_blocks(id,athlete_id,title,goal,starts_on,ends_on,source) VALUES($1,$2,'Synthetic','Fixture','2026-10-01','2026-10-31','manual')",[block,athlete])
await db.query("INSERT INTO stunna.planned_sessions(id,athlete_id,block_id,planned_on,time_zone,kind,purpose,source) VALUES($1,$2,$3,'2026-10-27','UTC','run','Synthetic','manual')",[plan,athlete,block])
const exercises=[{key:'synthetic-run',name:'Synthetic run',sets:null,reps:null,durationSeconds:1800,target:null,restSeconds:null,notes:null}]
await db.query("INSERT INTO stunna.prescription_revisions(athlete_id,planned_session_id,revision,title,exercises,change_reason,source) VALUES($1,$2,1,'Synthetic',$3,'Fixture','synthetic')",[athlete,plan,JSON.stringify(exercises)])
await db.query("INSERT INTO stunna.actual_sessions(id,athlete_id,planned_session_id,started_at,completed_at,status,source,revision,prescription_revision,prescription_snapshot) VALUES($1,$2,$3,'2026-10-27T18:52:01Z','2026-10-27T19:22:01Z','completed','manual',2,1,$4)",[session,athlete,plan,JSON.stringify({title:'Synthetic',kind:'run',purpose:'Fixture',exercises,occurrences:[],overview:null})])
const database:TrainingDatabase={transaction:(s,fn)=>db.transaction(async tx=>{
  await tx.exec('SET LOCAL ROLE stunna_runtime');await tx.query("SELECT set_config('stunna.subject',$1,true)",[s]);return fn(tx as Queryable)
})}
let downloads=0
const service=createTrainingService(database,()=>new Date('2026-10-28T00:00:00Z'),{
  list:async()=>[501,502].map(activityId=>({activityId,activityName:'Synthetic same-day run '+activityId,activityType:{typeKey:'running'},startTimeGMT:'2026-10-27 18:52:01',duration:1800,distance:0})),
  fit:async activityId=>{
    downloads++
    const encoder=new Encoder()
    encoder.onMesg(Profile.MesgNum.FILE_ID,{type:'activity',manufacturer:'garmin'} as FileIdMesg)
    encoder.onMesg(Profile.MesgNum.SESSION,{sport:'running',startTime:new Date('2026-10-27T18:52:01Z'),timestamp:new Date('2026-10-27T19:22:01Z'),totalElapsedTime:1800,totalDistance:0} as SessionMesg)
    encoder.onMesg(Profile.MesgNum.RECORD,{timestamp:new Date('2026-10-27T18:52:01Z'),distance:0} as RecordMesg)
    return {activityId,...decodeGarminFitArchive(Buffer.from(encoder.close()),30,120,0,0,20)}
  },
})
const handlers=createSourceHandlers({enabled:()=>true,principal:async(request,scope)=>{if(scope==='training.write') requireSameOrigin(request);return principal},service:()=>service})
const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url!,process.env.APP_BASE_URL)
    let response:Response
    if(url.pathname==='/results') response=Response.json(await service.results(principal,session))
    else if(url.pathname==='/probe') response=Response.json({downloads,links:(await db.query('SELECT id FROM stunna.source_links')).rows.length,audits:(await db.query("SELECT id FROM stunna.audit_events WHERE operation='link_garmin'")).rows.length})
    else if(url.pathname==='/api/training/sources') {
      const chunks:Buffer[]=[];for await(const c of req)chunks.push(c)
      const request=new Request(url,{method:req.method,headers:req.headers as Record<string,string>,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})})
      response=await(req.method==='POST'?handlers.POST(request):handlers.GET(request))
    } else {
      const name=url.pathname==='/source.js'?'source.js':'index.html'
      response=new Response(await readFile(join(process.argv[2],name)),{headers:{'content-type':name.endsWith('.js')?'text/javascript':'text/html'}})
    }
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()))
  }catch{res.writeHead(500);res.end('Synthetic harness error')}
})
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
process.env.APP_BASE_URL='http://127.0.0.1:'+(server.address() as {port:number}).port
console.log(process.env.APP_BASE_URL)
process.on('SIGTERM',()=>{server.close();void db.close().then(()=>process.exit(0))})

}
void main().catch(()=>{console.error("Synthetic source server failed");process.exitCode=1})
