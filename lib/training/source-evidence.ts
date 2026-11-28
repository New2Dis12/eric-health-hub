import 'server-only'
import { cyclingOnly } from './cycling-only'
import { randomUUID, createHash } from 'node:crypto'
import { GarminRequestError } from '../garmin'
import { ApiError } from '../private-api'
import { assertTrainingAccess, type TrainingPrincipal } from './auth'
import type { TrainingDatabase, Queryable } from './database'
import { sourceLinkInput, type SavedSourceEvidence, type SourceResult, type CandidateResult, type GarminCandidate, type SourceEvidence } from './source-evidence-models'
import { candidatesFrom, garminUtc, origin, normalizeGarminFit, type GarminClient } from './garmin-evidence'
import { compatiblePair, reconcilePair } from './paired-evidence'
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
    WHERE l.athlete_id=$1 AND l.session_id=$2 ORDER BY l.provider,l.source_id`,[athlete,session])).rows
  const evidence=rows.map(r=>({id:r.id,revision:r.revision,evidence:r.evidence,recordedAt:new Date(r.recorded_at).toISOString()}))
  const reconciled=reconcilePair(evidence.filter(row=>row.evidence.provider==='garmin'))
  return {status:rows.length?'matched':'unavailable',evidence,...(reconciled && {reconciled})}
}
export function assertSourceAccess(principal: TrainingPrincipal, scope: 'training.read'|'training.write') {
  assertTrainingAccess(principal,scope)
  if (process.env.STUNNA_ENABLED!=='true' || process.env.GARMIN_MCP_ENABLED!=='true') throw new ApiError(404,'Garmin source integration unavailable')
  if (principal.source!=='browser' && !principal.healthScopes?.includes('garmin.read')) throw new ApiError(403,'Garmin read scope required')
}
async function owned(tx: Queryable, subject: string, session: string, lock=false, discoveryEnd?:Date) {
  const a=(await tx.query<{id:string}>('SELECT id FROM stunna.athletes WHERE auth0_sub=$1'+(lock?' FOR UPDATE':''),[subject])).rows[0]
  if (!a) throw new ApiError(404,'Session not found')
  const s=(await tx.query<{id:string;revision:number;status:string;started_at:Date;completed_at:Date;prescription_snapshot:SessionSnapshot}>(
    'SELECT id,revision,status,started_at,completed_at,prescription_snapshot FROM stunna.actual_sessions WHERE athlete_id=$1 AND id=$2',[a.id,session])).rows[0]
  if (!s) throw new ApiError(404,'Session not found')
  if (discoveryEnd && s.status==='in_progress' && cyclingOnly(s.prescription_snapshot)) {
    return {athlete:a.id,session:{...s,completed_at:discoveryEnd}}
  }
  if (s.status!=='completed' || !s.prescription_snapshot) throw new ApiError(409,'Completed pinned session required')
  return {athlete:a.id,session:s}
}
function modalities(snapshot: SessionSnapshot) {
  // Prescription labels are hints, never evidence or inferred measurements.
  return [...new Set([snapshot.kind,...snapshot.exercises.flatMap(e=>[
    ...(e.warmups??[]).map(s=>s.modality),...(e.intervalBlocks??[]).flatMap(b=>b.segments.map(s=>s.modality)),
  ])].filter(m=>['run','bike','row','ski','swim'].includes(m)))]
}
// Inspect a bounded number of FIT files on the completed-results screen only.
async function discoverPairs(raw: unknown, candidates: GarminCandidate[], session: Awaited<ReturnType<typeof owned>>['session'],
  saved: SavedSourceEvidence[], garmin: GarminClient, subject: string, now: () => Date) {
  const verifiedPairs: number[][] = []
  const inspected: SourceEvidence[] = saved.map(row => row.evidence)
  const allowed = modalities(session.prescription_snapshot)
  const start = new Date(session.started_at).getTime(), end = new Date(session.completed_at).getTime()
  const rows = Array.isArray(raw) ? raw : []
  const times = rows.map(row => Date.parse(garminUtc(row?.startTimeGMT) ?? ''))
  // A full newest-first page can cover this session if it extends past the candidate window.
  const coversWindow = rows.length < 20 || (times.every((t,i) => Number.isFinite(t) && (!i || t <= times[i-1])) &&
    times[times.length-1] < start - 86400000)
  let complete = coversWindow && candidates.length < 8 && new Set(rows.map(row=>row?.activityId)).size===rows.length && rows.every(row => Number.isSafeInteger(row?.activityId) && row.activityId > 0)
  let downloads = 0
  for (const candidate of candidates) {
    candidate.origin = origin(candidate.manufacturer ?? null)
    if (candidate.linked) continue
    const time = Date.parse(candidate.startUtc ?? '')
    const duration = candidate.durationSeconds
    if (candidate.modality && !candidate.compatible || time >= end ||
        (duration !== null && time + duration * 1000 <= start)) continue
    if (downloads >= 4) { complete = false; continue }
    downloads++
    try {
      const evidence = normalizeGarminFit(await garmin.fit(candidate.activityId),candidate.activityId,subject,now(),candidate.manufacturer)
      candidate.origin = evidence.recording?.origin ?? 'unknown'
      if (candidate.origin === 'unknown' || !evidence.modality || !evidence.startUtc || !evidence.endUtc || evidence.startField !== 'session.startTime') complete = false
      for (const partner of inspected) {
        if (saved.length && partner !== saved[0].evidence) continue
        if (compatiblePair(partner,evidence,session,allowed)) verifiedPairs.push([Number(partner.sourceId),candidate.activityId])
      }
      inspected.push(evidence)
    } catch { complete = false }
  }
  return {verifiedPairs, ...(complete && verifiedPairs.length === 1 && {suggestedPair:verifiedPairs[0]})}
}
export function createSourceEvidenceService(database: TrainingDatabase, garmin: GarminClient, now=()=>new Date()) {
  const context=(principal:TrainingPrincipal,id:string)=>database.transaction(principal.subject,tx=>owned(tx,principal.subject,id))
  return {
    async candidates(principal:TrainingPrincipal,sessionId:unknown, discover=false): Promise<CandidateResult> {
      assertSourceAccess(principal,'training.read')
      if (!sourceLinkInput.shape.sessionId.safeParse(sessionId).success) throw new ApiError(400,'Invalid session ID')
      const c=discover && principal.source==="browser" ? await database.transaction(principal.subject,tx=>owned(tx,principal.subject,sessionId as string,false,now())) : await context(principal,sessionId as string)
      if(!await database.transaction(principal.subject,sourceStorageAvailable)) return {status:'unavailable',candidates:[],reason:'Source storage is not available; saved workout results are unchanged.',sessionRevision:c.session.revision,evidenceRevision:0}
      const saved=await database.transaction(principal.subject,tx=>readSourceResult(tx,c.athlete,c.session.id))
      const sources=saved.evidence.filter(e=>e.evidence.provider==='garmin')
      const revision=sources[0]?.revision??0
      let stage: 'activity_list' | 'candidate_normalization' | 'linked_lookup' = 'activity_list'
      try {
        const raw=await garmin.list(20)
        stage = 'candidate_normalization'
        const candidates=candidatesFrom(raw,modalities(c.session.prescription_snapshot),new Date(c.session.started_at),new Date(c.session.completed_at),new Set())
        stage = 'linked_lookup'
        const linked=new Set((await database.transaction(principal.subject,tx=>tx.query<{source_id:string}>("SELECT source_id FROM stunna.source_links WHERE athlete_id=$1 AND provider='garmin' AND source_id=ANY($2::text[])",[c.athlete,candidates.map(a=>String(a.activityId))]))).rows.map(r=>r.source_id))
        for (const candidate of candidates) {
          const current=sources.find(s=>s.evidence.sourceId===String(candidate.activityId))
          candidate.linked=linked.has(String(candidate.activityId))
          candidate.linkedElsewhere=candidate.linked && !current
          candidate.evidenceRevision=current?.revision??0
        }
        const pairing = process.env.STUNNA_PAIRED_EVIDENCE_DISABLED!=='true'
        const discovery = discover && pairing && sources.length < 2
          ? await discoverPairs(raw,candidates,c.session,sources,garmin,principal.subject,now) : {}
        return {...discovery,...(sources.length===1 && process.env.STUNNA_PAIRED_EVIDENCE_DISABLED!=='true' && {pairAnchor:{evidenceId:sources[0].id,sourceId:sources[0].evidence.sourceId}}),status:revision?'matched':candidates.length?'needs_confirmation':'unavailable',candidates,reason:'Select and explicitly confirm the Garmin activity. Time and modality are hints; no automatic association.',sessionRevision:c.session.revision,evidenceRevision:revision}
      } catch (error) {
        const failure = stage === 'activity_list' && error instanceof GarminRequestError ? error : null
        console.warn('Garmin candidate lookup failed', { stage: failure?.stage ?? stage, status: failure?.status })
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
      const candidate=page.candidates.find(a=>a.activityId===command.activityId)
      if (!candidate) throw new ApiError(422,'Activity unavailable in bounded candidate list; re-read candidates')
      let evidence: ReturnType<typeof normalizeGarminFit>
      try { evidence=normalizeGarminFit(await garmin.fit(command.activityId),command.activityId,principal.subject,now(),candidate.manufacturer) }
      catch(e) { if(e instanceof ApiError) throw e; throw new ApiError(422,'Garmin FIT unavailable, invalid or exceeds limits') }
      // Recheck identity, revisions and pair eligibility together under the athlete lock.
      try {
        return await database.transaction(principal.subject,async tx=>{
          const live=await owned(tx,principal.subject,command.sessionId,true)
          const prior=await checkPrior(tx,live.athlete)
          if (prior) return prior
          if (live.session.revision!==command.expectedSessionRevision) throw new ApiError(409,'Session revision conflict')
          const sources=(await readSourceResult(tx,live.athlete,command.sessionId)).evidence.filter(e=>e.evidence.provider==='garmin')
          const current=sources.find(e=>e.evidence.sourceId===String(command.activityId))
          const others=sources.filter(e=>e!==current)
          if ((current?.revision??0)!==command.expectedEvidenceRevision) throw new ApiError(409,'Evidence revision conflict; re-read saved results')
          if (command.pairedWithEvidenceId && process.env.STUNNA_PAIRED_EVIDENCE_DISABLED==='true')
            throw new ApiError(409,'New pairs are disabled')
          if (command.pairedWithEvidenceId && (current || others.length!==1 || others[0].id!==command.pairedWithEvidenceId))
            throw new ApiError(409,'Pair confirmation is stale; re-read both activity identities')
          if (others.length && ((!current && !command.pairedWithEvidenceId) || others.length!==1 ||
              !compatiblePair(others[0].evidence,evidence,live.session,modalities(live.session.prescription_snapshot))))
            throw new ApiError(409,'A pair requires explicit confirmation, complementary origins, matching modality and overlapping FIT times')
          if (command.pairedWithEvidenceId) evidence.match.pairedWithEvidenceId=command.pairedWithEvidenceId
          const remember=async(evidenceId:string,evidenceRevision:number)=>{
            const result={evidenceId,evidenceRevision,actualSessionId:command.sessionId}
            await tx.query('INSERT INTO stunna.write_requests(athlete_id,idempotency_key,request_hash,result) VALUES($1,$2,$3,$4)',[live.athlete,command.idempotencyKey,hash,JSON.stringify(result)])
            return result
          }
          if (current && current.evidence.contentSha256===evidence.contentSha256 && current.evidence.recording &&
              current.evidence.recording.origin===evidence.recording?.origin &&
              current.evidence.recording.listManufacturer===evidence.recording?.listManufacturer)
            return remember(current.id,current.revision)
          const link=(await tx.query<{id:string}>("SELECT id FROM stunna.source_links WHERE athlete_id=$1 AND session_id=$2 AND provider='garmin' AND source_id=$3",[live.athlete,command.sessionId,String(command.activityId)])).rows[0]
          if (link && current && current.evidence.contentSha256!==evidence.contentSha256) {
            const seen=await tx.query(`SELECT 1 FROM stunna.source_evidence_revisions
              WHERE athlete_id=$1 AND link_id=$2 AND revision<$3 AND evidence->>'contentSha256'=$4 LIMIT 1`,
              [live.athlete,link.id,current.revision,evidence.contentSha256])
            if (seen.rows.length) throw new ApiError(409,'Earlier FIT revision already recorded; current evidence retained')
          }
          const linkId=link?.id??randomUUID()
          if (!link) await tx.query("INSERT INTO stunna.source_links(id,athlete_id,session_id,provider,source_id) VALUES($1,$2,$3,'garmin',$4)",[linkId,live.athlete,command.sessionId,String(command.activityId)])
          const evidenceId=randomUUID(), revision=(current?.revision??0)+1
          await tx.query(`INSERT INTO stunna.source_evidence_revisions(id,athlete_id,link_id,revision,evidence,actor_sub,source,reason)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[evidenceId,live.athlete,linkId,revision,JSON.stringify(evidence),principal.subject,principal.source,command.reason])
          await tx.query(`INSERT INTO stunna.audit_events(id,athlete_id,actor_sub,operation,entity_type,entity_id,before_revision,after_revision,reason,source)
            VALUES($1,$2,$3,'link_garmin','source_evidence',$4,$5,$6,$7,$8)`,[randomUUID(),live.athlete,principal.subject,evidenceId,current?.revision??null,revision,command.reason,principal.source])
          return remember(evidenceId,revision)
        })
      } catch(e) {
        if (typeof e==='object' && e && 'code' in e && ['23503','23505','23514'].includes(String(e.code))) throw new ApiError(409,'Duplicate activity or evidence constraint conflict')
        throw e
      }
    },
  }
}
