import 'server-only'
import { randomUUID, createHash } from 'node:crypto'
import { ApiError } from '../private-api'
import { assertTrainingAccess, type TrainingPrincipal } from './auth'
import type { TrainingDatabase, Queryable } from './database'
import { sourceLinkInput, type SavedSourceEvidence, type SourceResult, type CandidateResult } from './source-evidence-models'
import { candidatesFrom, normalizeGarminFit, type GarminClient } from './garmin-evidence'
import type { SessionSnapshot } from './session'

export async function sourceStorageAvailable(tx:Queryable) {
  // Check before referencing additive relations: a failed SQL statement would abort this transaction.
  const {rows}=await tx.query<{available:boolean}>("SELECT coalesce(has_table_privilege(current_user,to_regclass('stunna.source_links'),'SELECT'),false) AND coalesce(has_table_privilege(current_user,to_regclass('stunna.source_evidence_revisions'),'SELECT'),false) AS available")
  return rows[0]?.available===true
}
export async function readSourceResult(tx: Queryable, athlete: string, session: string): Promise<SourceResult> {
  if(!await sourceStorageAvailable(tx)) return {status:'unavailable',evidence:[]}
  const rows=(await tx.query<{id:string;revision:number;evidence:SavedSourceEvidence['evidence'];recorded_at:Date}>(`SELECT e.id,e.revision,e.evidence,e.recorded_at
    FROM stunna.source_links l JOIN LATERAL (SELECT id,revision,evidence,recorded_at FROM stunna.source_evidence_revisions
      WHERE athlete_id=l.athlete_id AND link_id=l.id ORDER BY revision DESC LIMIT 1) e ON true
    WHERE l.athlete_id=$1 AND l.session_id=$2 ORDER BY l.provider`,[athlete,session])).rows
  return {status:rows.length?'matched':'unavailable',evidence:rows.map(r=>({id:r.id,revision:r.revision,evidence:r.evidence,recordedAt:new Date(r.recorded_at).toISOString()}))}
}
export function assertSourceAccess(principal: TrainingPrincipal, scope: 'training.read'|'training.write') {
  assertTrainingAccess(principal,scope)
  if (process.env.STUNNA_ENABLED!=='true' || process.env.GARMIN_MCP_ENABLED!=='true') throw new ApiError(404,'Garmin source integration unavailable')
  if (principal.source!=='browser' && !principal.healthScopes?.includes('garmin.read')) throw new ApiError(403,'Garmin read scope required')
}
async function owned(tx: Queryable, subject: string, session: string, lock=false) {
  const a=(await tx.query<{id:string}>('SELECT id FROM stunna.athletes WHERE auth0_sub=$1'+(lock?' FOR UPDATE':''),[subject])).rows[0]
  if (!a) throw new ApiError(404,'Session not found')
  const s=(await tx.query<{id:string;revision:number;status:string;started_at:Date;completed_at:Date;prescription_snapshot:SessionSnapshot}>(
    'SELECT id,revision,status,started_at,completed_at,prescription_snapshot FROM stunna.actual_sessions WHERE athlete_id=$1 AND id=$2',[a.id,session])).rows[0]
  if (!s) throw new ApiError(404,'Session not found')
  if (s.status!=='completed' || !s.prescription_snapshot) throw new ApiError(409,'Completed pinned session required')
  return {athlete:a.id,session:s}
}
function modalities(snapshot: SessionSnapshot) {
  // Prescription labels are hints, never evidence or inferred measurements.
  return [...new Set([snapshot.kind,...snapshot.exercises.flatMap(e=>[
    ...(e.warmups??[]).map(s=>s.modality),...(e.intervalBlocks??[]).flatMap(b=>b.segments.map(s=>s.modality)),
  ])].filter(m=>['run','bike','row','ski','swim'].includes(m)))]
}
export function createSourceEvidenceService(database: TrainingDatabase, garmin: GarminClient, now=()=>new Date()) {
  const context=(principal:TrainingPrincipal,id:string)=>database.transaction(principal.subject,tx=>owned(tx,principal.subject,id))
  return {
    async candidates(principal:TrainingPrincipal,sessionId:unknown): Promise<CandidateResult> {
      assertSourceAccess(principal,'training.read')
      if (!sourceLinkInput.shape.sessionId.safeParse(sessionId).success) throw new ApiError(400,'Invalid session ID')
      const c=await context(principal,sessionId as string)
      if(!await database.transaction(principal.subject,sourceStorageAvailable)) return {status:'unavailable',candidates:[],reason:'Source storage is not available; saved workout results are unchanged.',sessionRevision:c.session.revision,evidenceRevision:0}
      const saved=await database.transaction(principal.subject,tx=>readSourceResult(tx,c.athlete,c.session.id))
      const revision=saved.evidence.find(e=>e.evidence.provider==='garmin')?.revision??0
      try {
        const raw=await garmin.list(20)
        const candidates=candidatesFrom(raw,modalities(c.session.prescription_snapshot),new Date(c.session.started_at),new Date(c.session.completed_at),new Set())
        const linked=new Set((await database.transaction(principal.subject,tx=>tx.query<{source_id:string}>("SELECT source_id FROM stunna.source_links WHERE athlete_id=$1 AND provider='garmin' AND source_id=ANY($2::text[])",[c.athlete,candidates.map(a=>String(a.activityId))]))).rows.map(r=>r.source_id))
        for (const candidate of candidates) candidate.linked=linked.has(String(candidate.activityId))
        return {status:revision?'matched':candidates.length?'needs_confirmation':'unavailable',candidates,reason:'Select and explicitly confirm the Garmin activity. Time and modality are hints; no automatic association.',sessionRevision:c.session.revision,evidenceRevision:revision}
      } catch {
        return {status:revision?'matched':'unavailable',candidates:[],reason:'Garmin unavailable or activity list invalid; saved evidence is unchanged.',sessionRevision:c.session.revision,evidenceRevision:revision}
      }
    },
    async link(principal:TrainingPrincipal,input:unknown) {
      assertSourceAccess(principal,'training.write')
      assertTrainingAccess(principal,'training.read')
      const parsed=sourceLinkInput.safeParse(input)
      if (!parsed.success) throw new ApiError(400,'Explicit activity confirmation and exact revisions required')
      const command=parsed.data
      const hash=createHash('sha256').update(JSON.stringify({operation:'link_garmin',source:principal.source,command})).digest('hex')
      const checkPrior=async(tx:Queryable,athlete:string)=>{
        const p=(await tx.query<{request_hash:string;result:{evidenceId:string;evidenceRevision:number;actualSessionId:string}}>('SELECT request_hash,result FROM stunna.write_requests WHERE athlete_id=$1 AND idempotency_key=$2',[athlete,command.idempotencyKey])).rows[0]
        if (p && p.request_hash!==hash) throw new ApiError(409,'Idempotency key already used for different input')
        return p?.result
      }
      const c=await context(principal,command.sessionId)
      const previous=await database.transaction(principal.subject,tx=>checkPrior(tx,c.athlete))
      if (previous) return previous // Retry works even when Garmin is unavailable.
      const page=await this.candidates(principal,command.sessionId)
      if (!page.candidates.some(a=>a.activityId===command.activityId)) throw new ApiError(422,'Activity unavailable in bounded candidate list; re-read candidates')
      let evidence: ReturnType<typeof normalizeGarminFit>
      try { evidence=normalizeGarminFit(await garmin.fit(command.activityId),command.activityId,principal.subject,now()) }
      catch(e) { if(e instanceof ApiError) throw e; throw new ApiError(422,'Garmin FIT unavailable, invalid or exceeds limits') }
      // Confirmation explicitly permits incomplete/wrong-modality hints; it never fills missing metrics.
      try {
        return await database.transaction(principal.subject,async tx=>{
          const live=await owned(tx,principal.subject,command.sessionId,true)
          const prior=await checkPrior(tx,live.athlete)
          if (prior) return prior
          if (live.session.revision!==command.expectedSessionRevision) throw new ApiError(409,'Session revision conflict')
          const link=(await tx.query<{id:string;source_id:string}>("SELECT id,source_id FROM stunna.source_links WHERE athlete_id=$1 AND session_id=$2 AND provider='garmin'",[live.athlete,command.sessionId])).rows[0]
          if (link && link.source_id!==String(command.activityId)) throw new ApiError(409,'Garmin identity is immutable; replacement/relink requires owner intervention')
          const current=(await readSourceResult(tx,live.athlete,command.sessionId)).evidence.find(e=>e.evidence.provider==='garmin')
          if ((current?.revision??0)!==command.expectedEvidenceRevision) throw new ApiError(409,'Evidence revision conflict; re-read saved results')
          const linkId=link?.id??randomUUID()
          if (!link) await tx.query("INSERT INTO stunna.source_links(id,athlete_id,session_id,provider,source_id) VALUES($1,$2,$3,'garmin',$4)",[linkId,live.athlete,command.sessionId,String(command.activityId)])
          const evidenceId=randomUUID(), revision=(current?.revision??0)+1
          await tx.query(`INSERT INTO stunna.source_evidence_revisions(id,athlete_id,link_id,revision,evidence,actor_sub,source,reason)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[evidenceId,live.athlete,linkId,revision,JSON.stringify(evidence),principal.subject,principal.source,command.reason])
          await tx.query(`INSERT INTO stunna.audit_events(id,athlete_id,actor_sub,operation,entity_type,entity_id,before_revision,after_revision,reason,source)
            VALUES($1,$2,$3,'link_garmin','source_evidence',$4,$5,$6,$7,$8)`,[randomUUID(),live.athlete,principal.subject,evidenceId,current?.revision??null,revision,command.reason,principal.source])
          const result={evidenceId,evidenceRevision:revision,actualSessionId:command.sessionId}
          await tx.query('INSERT INTO stunna.write_requests(athlete_id,idempotency_key,request_hash,result) VALUES($1,$2,$3,$4)',[live.athlete,command.idempotencyKey,hash,JSON.stringify(result)])
          return result
        })
      } catch(e) {
        if (typeof e==='object' && e && 'code' in e && ['23503','23505','23514'].includes(String(e.code))) throw new ApiError(409,'Duplicate activity or evidence constraint conflict')
        throw e
      }
    },
  }
}
