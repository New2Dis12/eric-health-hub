import 'server-only'
import { randomUUID } from 'node:crypto'
import { ApiError } from '../private-api'
import type { Queryable } from './database'
import type { SessionSnapshot } from './session'
import type { LogEntry, LogInput, LogValue, SessionResults } from './logging-models'

export async function readResults(tx: Queryable, athlete: string, session: string, history: boolean, limit: number, offset: number): Promise<SessionResults> {
  const { rows } = await tx.query('SELECT id,revision,status,notes FROM stunna.actual_sessions WHERE athlete_id=$1 AND id=$2 FOR SHARE', [athlete, session])
  if (!rows[0]) throw new ApiError(404, 'Session not found')
  // Stable ordering: current items ordered by first item key, history by session revision.
  const entries = (await tx.query<LogEntry>(`SELECT id,item_key,kind,occurrence_id,set_ordinal,revision,session_revision,value,before_value,actor_sub,source,reason,recorded_at FROM (
    SELECT *, row_number() OVER (PARTITION BY item_key ORDER BY revision DESC) AS latest FROM stunna.session_entries
    WHERE athlete_id=$1 AND session_id=$2) e ${history ? '' : "WHERE latest=1 AND kind<>'workout_note'"}
    ORDER BY session_revision,id LIMIT $3 OFFSET $4`, [athlete,session,limit+1,offset])).rows
  const note = (await tx.query<{revision:number}>("SELECT revision FROM stunna.session_entries WHERE athlete_id=$1 AND session_id=$2 AND kind='workout_note' ORDER BY revision DESC LIMIT 1",[athlete,session])).rows[0]
  return { notesRevision:note?.revision??0, sessionId:session, sessionRevision: rows[0].revision, status:rows[0].status, notes:rows[0].notes,
    entries:entries.slice(0,limit),nextOffset:entries.length>limit && offset+limit<=10000?offset+limit:null }
}

export async function logResult(tx: Queryable, athlete: string, command: LogInput, actor: string, source: 'browser'|'api', reason: string) {
  const { rows } = await tx.query('SELECT revision,status,notes,prescription_snapshot FROM stunna.actual_sessions WHERE athlete_id=$1 AND id=$2', [athlete,command.sessionId])
  const session=rows[0]
  if (!session) throw new ApiError(404, 'Session not found')
  if (session.status !== 'in_progress') throw new ApiError(409,'Finalized session is read only')
  if (session.revision !== command.expectedSessionRevision) throw new ApiError(409,'Session revision conflict')
  const snapshot=session.prescription_snapshot as SessionSnapshot | null
  if (!snapshot) throw new ApiError(409,'Session has no pinned prescription')
  const item=command.item
  const occurrenceId='occurrenceId' in item?item.occurrenceId:null
  const occurrence=snapshot.occurrences.find(o=>o.id===occurrenceId)
  if (item.kind !== 'workout_note') {
    if (!occurrence) throw new ApiError(400,'Unknown pinned occurrence')
    const exercise=snapshot.exercises[occurrence.exercise]
    if (item.kind === 'interval') {
      const segment=occurrence.type==='warmup'?exercise.warmups?.[occurrence.segment!]:
        occurrence.type==='interval'?exercise.intervalBlocks?.[occurrence.block!]?.segments[occurrence.segment!]:undefined
      if (!segment || !['run','row','bike','ski'].includes(segment.modality)) throw new ApiError(400,'Expected pinned endurance interval')
      for (const metric of item.actual.metrics) {
        if ((metric.metric==='rowing_split' || metric.metric==='stroke_rate') && segment.modality!=='row' ||
          metric.metric==='cycling_cadence' && segment.modality!=='bike' || metric.metric==='pace' && !['run','ski'].includes(segment.modality)) throw new ApiError(400,'Metric incompatible with modality')
      }
    } else if (item.kind === 'execution_check') {
      const blocks = exercise?.intervalBlocks
      const block = blocks?.[occurrence.block!]
      const segment = occurrence.type === 'warmup' ? exercise?.warmups?.[occurrence.segment!] :
        occurrence.type === 'interval' && block && occurrence.repeat! >= 0 && occurrence.repeat! < block.repeat
          ? block.segments[occurrence.segment!] : undefined
      if (!blocks?.length || !segment) throw new ApiError(400, 'Expected pinned interval protocol segment')
    } else if (occurrence.type!=='exercise') throw new ApiError(400,'Expected pinned exercise')
    if (item.kind==='strength_set' && (exercise.sets === null || item.setOrdinal>exercise.sets)) throw new ApiError(400,'Set outside pinned strength prescription')
  }
  const ordinal=item.kind==='strength_set'?item.setOrdinal:0
  const key=[item.kind,occurrenceId??'session',ordinal].join(':')
  const prior=(await tx.query<LogEntry>('SELECT * FROM stunna.session_entries WHERE athlete_id=$1 AND session_id=$2 AND item_key=$3 ORDER BY revision DESC LIMIT 1',[athlete,command.sessionId,key])).rows[0]
  if ((prior?.revision??0)!==command.expectedItemRevision) throw new ApiError(409,'Item revision conflict')
  const value:LogValue='actual' in item ? item.actual : item.kind === 'execution_check' ? { checked: item.checked } : { notes: item.notes }
  const before=item.kind==='workout_note'?{notes:session.notes}:prior?.value??null
  const id=randomUUID(), revision=(prior?.revision??0)+1, sessionRevision=session.revision+1
  await tx.query(`INSERT INTO stunna.session_entries(id,athlete_id,session_id,item_key,kind,occurrence_id,set_ordinal,revision,session_revision,value,before_value,actor_sub,source,reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[id,athlete,command.sessionId,key,item.kind,occurrenceId,ordinal,revision,sessionRevision,JSON.stringify(value),before===null?null:JSON.stringify(before),actor,source,reason])
  if (item.kind==='workout_note') await tx.query('UPDATE stunna.actual_sessions SET notes=$1,revision=$2,updated_at=now() WHERE athlete_id=$3 AND id=$4',[item.notes,sessionRevision,athlete,command.sessionId])
  else await tx.query('UPDATE stunna.actual_sessions SET revision=$1,updated_at=now() WHERE athlete_id=$2 AND id=$3',[sessionRevision,athlete,command.sessionId])
  return { entryId:id,itemRevision:revision,actualSessionId:command.sessionId,sessionRevision }
}
