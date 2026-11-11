import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { ApiError } from '../private-api'
import { assertTrainingAccess, type TrainingPrincipal } from './auth'
import type { TrainingDatabase } from './database'
import { historicalBatch, historicalPage, type HistoricalBatch, type HistoricalPageInput } from './historical-models'

// Private adapter only. No hosted import route; personal-data import requires a separate release gate.
// Callers must supply coordinator-reviewed, normalized records with stable logical IDs.
function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']'
  if (value && typeof value === 'object') return '{' +
    Object.entries(value).sort(([a],[b]) => a.localeCompare(b))
      .map(([k,v]) => JSON.stringify(k)+':'+stable(v)).join(',') + '}'
  return JSON.stringify(value) ?? 'null'
}
function sessionUUID(athlete: string, logicalRecordId: string): string {
  const hex = createHash('sha256').update(athlete+'\0'+logicalRecordId).digest('hex')
  return hex.slice(0,8)+'-'+hex.slice(8,12)+'-5'+hex.slice(13,16)+'-a'+hex.slice(17,20)+'-'+hex.slice(20,32)
}
type Previous = {revision:number;payload:unknown;session_id:string|null;category:string;logical_record_id:string|null}
type FileRow = {file_version:number;checksum:string;authority:number}
export function createHistoricalService(database: TrainingDatabase) {
  return {
    async history(principal: TrainingPrincipal, page: HistoricalPageInput) {
      assertTrainingAccess(principal,'training.read')
      const p=historicalPage.safeParse(page)
      if (!p.success) throw new ApiError(400,'Invalid history page')
      return database.transaction(principal.subject,async tx=>{
        const athlete=(await tx.query<{id:string}>('SELECT id FROM stunna.athletes WHERE auth0_sub=$1',[principal.subject])).rows[0]
        if (!athlete) return {items:[],limit:p.data.limit,offset:p.data.offset}
        const {rows}=await tx.query(`SELECT e.id,e.source_key,e.source_record_id,e.source_version,
          e.revision,e.category,e.representation,e.provenance,e.session_id,e.observed_on::text AS observed_on,e.payload,
          e.payload->'details'->>'modality' AS historical_modality,
          e.payload->'details'->>'precision' AS historical_precision,
          (e.payload->'details'->>'startedAt')::timestamptz AS started_at,
          CASE WHEN e.category='workout' AND e.payload->'details'->>'completion'='confirmed'
            THEN 'completed' ELSE NULL END AS status
          FROM stunna.historical_evidence e
          WHERE e.athlete_id=$1 AND ($2::date IS NULL OR e.observed_on=$2::date)
            AND ($3::uuid IS NULL OR e.session_id=$3::uuid)
            AND ($6::boolean OR e.revision=(SELECT max(x.revision) FROM stunna.historical_evidence x
              WHERE x.athlete_id=e.athlete_id AND x.source_key=e.source_key
                AND x.source_record_id=e.source_record_id))
          ORDER BY e.observed_on DESC NULLS LAST,e.id DESC LIMIT $4 OFFSET $5`,
          [athlete.id,p.data.date??null,p.data.sessionId??null,p.data.limit,p.data.offset,p.data.revisions])
        return {items:rows,limit:p.data.limit,offset:p.data.offset}
      })
    },
    async importHistory(principal: TrainingPrincipal, batch: HistoricalBatch, options: {dryRun:true}|{dryRun:false;explicitPrivateAuthorization:true}) {
      assertTrainingAccess(principal,'training.write')
      const parsed=historicalBatch.safeParse(batch)
      if (!parsed.success) throw new ApiError(400,'Invalid historical import mapping')
      if (!options.dryRun && options.explicitPrivateAuthorization !== true)
        throw new ApiError(403,'Explicit private import authorization required')
      const b=parsed.data
      return database.transaction(principal.subject,async tx=>{
        // Row lock serializes source version/revision decisions for this athlete.
        const athlete=(await tx.query<{id:string}>('SELECT id FROM stunna.athletes WHERE auth0_sub=$1 FOR UPDATE',[principal.subject])).rows[0]
        if (!athlete) throw new ApiError(404,'Athlete not found')
        const files=(await tx.query<FileRow>('SELECT file_version,checksum,authority FROM stunna.historical_import_files WHERE athlete_id=$1 AND source_key=$2 ORDER BY file_version DESC',[athlete.id,b.sourceKey])).rows
        const same=files.find(f=>f.file_version===b.fileVersion)
        if (same && same.checksum!==b.checksum) throw new ApiError(409,'Source version checksum conflict')
        if (files.some(f=>f.checksum===b.checksum && f.file_version!==b.fileVersion))
          throw new ApiError(409,'Checksum already belongs to another source version')
        if (files.length && b.fileVersion<files[0].file_version)
          throw new ApiError(409,'Stale source version')
        if (files.length && b.authority!==files[0].authority)
          throw new ApiError(409,'Source authority change requires separate review')
        if (same) return {duplicate:true,created:0,updated:0,unchanged:b.records.length,deferred:0,missingFromSnapshot:0,dryRun:options.dryRun}
        // Full file snapshots may omit previously mapped records. Retain evidence and
        // report the gap; never silently delete history or invent a replacement.
        const known=(await tx.query<{source_record_id:string}>(
          'SELECT DISTINCT source_record_id FROM stunna.historical_evidence WHERE athlete_id=$1 AND source_key=$2',
          [athlete.id,b.sourceKey])).rows
        const incoming=new Set(b.records.map(r=>r.sourceRecordId))
        const missingFromSnapshot=known.filter(r=>!incoming.has(r.source_record_id)).length
        const changes: {record:HistoricalBatch['records'][number];previous:Previous|null;payload:unknown;representation:string}[]=[]
        let unchanged=0,deferred=0,created=0,updated=0
        for (const record of b.records) {
          const prev=(await tx.query<Previous>(`SELECT revision,payload,session_id,category,logical_record_id FROM stunna.historical_evidence
            WHERE athlete_id=$1 AND source_key=$2 AND source_record_id=$3 ORDER BY revision DESC LIMIT 1`,
            [athlete.id,b.sourceKey,record.sourceRecordId])).rows[0]??null
          if (prev && prev.category!==record.category) throw new ApiError(409,'Source category changed; review required')
          const logicalId=record.category==='workout'
            ? (record.logicalRecordId??b.sourceKey+':'+record.sourceRecordId) : null
          if (prev && prev.logical_record_id!==logicalId)
            throw new ApiError(409,'Logical identity changed; review required')
          const represented=record.category==='workout' && record.completion==='confirmed'
          if (prev?.session_id && !represented) throw new ApiError(409,'Cannot demote confirmed history')
          const representation=record.category==='workout'
            ? (represented ? 'optional_unknowns' : 'deferred') : record.representation
          const payload=record.category==='workout'
            ? {completion:record.completion,rpe:record.rpe,notes:record.notes,
                strength:record.strength,metrics:record.metrics,
                modality:record.modality,precision:record.precision,
                startedAt:record.startedAt} : record.attributes
          const signature=stable({payload,category:record.category,representation,
            provenance:record.provenance,observedOn:record.occurredOn,
            modality:record.category==='workout'?record.modality:null,
            precision:record.category==='workout'?record.precision:null,
            startedAt:record.category==='workout'?record.startedAt:null,
            logicalId})
          const fingerprint=createHash('sha256').update(signature).digest('hex')
          const old=prev?.payload as Record<string,unknown>|undefined
          if (old && old.fingerprint===fingerprint) {unchanged++;continue}
          changes.push({record,previous:prev,payload:{fingerprint,details:payload},representation})
          if (representation==='deferred') deferred++
          if (prev) updated++; else created++
        }
        if (options.dryRun) return {duplicate:false,created,updated,unchanged,deferred,missingFromSnapshot,dryRun:true}
        await tx.query(`INSERT INTO stunna.historical_import_files
          (athlete_id,source_key,file_version,checksum,authority) VALUES($1,$2,$3,$4,$5)`,
          [athlete.id,b.sourceKey,b.fileVersion,b.checksum,b.authority])
        for (const c of changes) {
          const r=c.record
          let sessionId:string|null=c.previous?.session_id??null
          const logicalId=r.category==='workout'
            ? (r.logicalRecordId??b.sourceKey+':'+r.sourceRecordId) : null
          if (r.category==='workout' && r.completion==='confirmed') {
            sessionId??=sessionUUID(athlete.id,logicalId!)
            // A shared logical identity yields ONE session even when independent
            // files supply conflicting evidence. Deterministic authority order:
            // higher authority wins; on ties, lexically smaller source key wins.
            const existing=(await tx.query<{id:string}>(`SELECT id FROM stunna.actual_sessions
              WHERE id=$1 AND athlete_id=$2 AND is_historical=true FOR UPDATE`,
              [sessionId,athlete.id])).rows[0]
            const current=(await tx.query<{authority:number;source_key:string}>(`
              SELECT f.authority,e.source_key FROM stunna.historical_evidence e
              JOIN stunna.historical_import_files f
                ON f.athlete_id=e.athlete_id AND f.source_key=e.source_key
               AND f.file_version=e.source_version
              WHERE e.athlete_id=$1 AND e.session_id=$2
              ORDER BY f.authority DESC,e.source_key ASC,e.source_version DESC,e.revision DESC
              LIMIT 1`,[athlete.id,sessionId])).rows[0]
            const authoritative=!current || b.authority>current.authority ||
              (b.authority===current.authority && b.sourceKey<=current.source_key)
            if (!existing) {
              await tx.query(`INSERT INTO stunna.actual_sessions
                (id,athlete_id,planned_session_id,started_at,completed_at,status,notes,rpe,source,
                 is_historical,historical_on,historical_modality,historical_precision)
                VALUES($1,$2,NULL,$3,NULL,'completed',$4,$5,'reviewed_import',true,$6,$7,$8)`,
                [sessionId,athlete.id,r.startedAt,r.notes??'',r.rpe,r.occurredOn,r.modality,r.precision])
            } else if (authoritative) {
              await tx.query(`UPDATE stunna.actual_sessions SET started_at=$3,notes=$4,rpe=$5,
                historical_on=$6,historical_modality=$7,historical_precision=$8,
                revision=revision+1,updated_at=now()
                WHERE id=$1 AND athlete_id=$2 AND is_historical=true`,
                [sessionId,athlete.id,r.startedAt,r.notes??'',r.rpe,r.occurredOn,r.modality,r.precision])
            }
          }
          const evidenceId=randomUUID(), revision=(c.previous?.revision??0)+1
          await tx.query(`INSERT INTO stunna.historical_evidence
            (id,athlete_id,source_key,source_record_id,source_version,revision,category,
             representation,provenance,session_id,observed_on,payload,logical_record_id)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)`,
            [evidenceId,athlete.id,b.sourceKey,r.sourceRecordId,b.fileVersion,revision,
             r.category,c.representation,r.provenance,sessionId,r.occurredOn,JSON.stringify(c.payload),logicalId])
          await tx.query(`INSERT INTO stunna.audit_events
            (id,athlete_id,actor_sub,operation,entity_type,entity_id,before_revision,
             after_revision,reason,source)
            VALUES($1,$2,$3,'historical_import','historical_evidence',$4,$5,$6,
              'Reviewed private source version','api')`,
            [randomUUID(),athlete.id,principal.subject,evidenceId,c.previous?.revision??null,revision])
        }
        return {duplicate:false,created,updated,unchanged,deferred,missingFromSnapshot,dryRun:false}
      })
    },
  }
}
