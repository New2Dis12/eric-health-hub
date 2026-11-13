import 'server-only'
import { createSourceEvidenceService } from './source-evidence'
import { getGarminActivities, getGarminActivityFit } from '../garmin'
import type { GarminClient } from './garmin-evidence'
import { logResult, readResults } from './logging'
import { readWorkoutSession, startWorkout, completeWorkout, workoutId } from './session'
import { createHash, randomUUID } from 'node:crypto'
import { commandSchema, type TrainingCommand, type WriteResult, type TrainingHistory, type TrainingBlock, type PlannedSession, type ActualSession, type BodyMeasurement } from './models'
import { assertTrainingAccess, type TrainingPrincipal } from './auth'
import { getTrainingDatabase, type TrainingDatabase, type Queryable } from './database'
import { ApiError } from '../private-api'
import { blockMethodology, localTrainingDate, moveTrainingDate, prescriptionExercisesFor } from './context-models'

export function createTrainingService(database: TrainingDatabase, now = () => new Date(), garmin: GarminClient = {list:getGarminActivities,fit:id=>getGarminActivityFit(id,30,120,0,0,20)}) {
  return {
    sources: createSourceEvidenceService(database,garmin,now),
    async results(principal: TrainingPrincipal, sessionId: unknown, history=false, limit=50, offset=0) {
      assertTrainingAccess(principal, 'training.read')
      if (!workoutId.safeParse(sessionId).success || typeof history!=='boolean' || !Number.isInteger(limit) || limit<1 || limit>100 || !Number.isInteger(offset) || offset<0 || offset>10000) throw new ApiError(400,'Invalid result page')
      return database.transaction(principal.subject, async tx => {
        const {rows}=await tx.query<{id:string}>('SELECT id FROM stunna.athletes WHERE auth0_sub=$1',[principal.subject])
        if (!rows[0]) throw new ApiError(404,'Session not found')
        return readResults(tx,rows[0].id,sessionId as string,history,limit,offset)
      })
    },
    async workout(principal: TrainingPrincipal, planId: unknown) {
      assertTrainingAccess(principal, 'training.read')
      if (!workoutId.safeParse(planId).success) throw new ApiError(400, 'Invalid workout ID')
      return database.transaction(principal.subject, async tx => {
        const { rows } = await tx.query<{id:string}>('SELECT id FROM stunna.athletes WHERE auth0_sub=$1', [principal.subject])
        if (!rows[0]) return null
        return readWorkoutSession(tx, rows[0].id, planId as string)
      })
    },
    async read(principal: TrainingPrincipal, limit = 50, offset = 0): Promise<TrainingHistory> {
      assertTrainingAccess(principal, 'training.read')
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10000) {
        throw new ApiError(400, 'Invalid page bounds')
      }
      return database.transaction(principal.subject, async tx => {
        // Explicit owner predicates plus database RLS; never use a caller's athlete ID.
        const { rows: athletes } = await tx.query<{ id: string }>('SELECT id FROM stunna.athletes WHERE auth0_sub=$1', [principal.subject])
        if (!athletes[0]) return { blocks: [], plans: [], sessions: [], measurements: [] }
        const params = [athletes[0].id, limit, offset]
        return {
          blocks: (await tx.query<TrainingBlock>('SELECT * FROM stunna.training_blocks WHERE athlete_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3', params)).rows,
          plans: (await tx.query<PlannedSession>('SELECT * FROM stunna.planned_sessions WHERE athlete_id=$1 ORDER BY COALESCE(planned_on, (scheduled_at AT TIME ZONE time_zone)::date) DESC, id DESC LIMIT $2 OFFSET $3', params)).rows,
          sessions: (await tx.query<ActualSession>('SELECT * FROM stunna.actual_sessions WHERE athlete_id=$1 ORDER BY started_at DESC, id DESC LIMIT $2 OFFSET $3', params)).rows,
          measurements: (await tx.query<BodyMeasurement>('SELECT * FROM stunna.body_measurements WHERE athlete_id=$1 ORDER BY measured_at DESC, id DESC LIMIT $2 OFFSET $3', params)).rows,
        }
      })
    },
    async write(principal: TrainingPrincipal, input: unknown): Promise<WriteResult> {
      assertTrainingAccess(principal, 'training.write')
      const parsed = commandSchema.safeParse(input)
      if (!parsed.success) throw new ApiError(400, 'Invalid training command')
      const command = parsed.data
      // Zod fixes property order/defaults; hashing validated values makes retries stable.
      const hash = createHash('sha256').update(JSON.stringify({ source: principal.source, command })).digest('hex')
      try {
        return await database.transaction(principal.subject, async tx => {
          await tx.query('INSERT INTO stunna.athletes(id,auth0_sub) VALUES($1,$2) ON CONFLICT(auth0_sub) DO NOTHING', [randomUUID(), principal.subject])
          const { rows: athletes } = await tx.query<{ id: string }>('SELECT id FROM stunna.athletes WHERE auth0_sub=$1 FOR UPDATE', [principal.subject])
          const athleteId = athletes[0].id
          // Locking the athlete serializes concurrent retries, revisions and completion.
          const { rows: prior } = await tx.query<{ request_hash: string; result: WriteResult }>(
            'SELECT request_hash,result FROM stunna.write_requests WHERE athlete_id=$1 AND idempotency_key=$2', [athleteId, command.idempotencyKey])
          if (prior[0]) {
            if (prior[0].request_hash !== hash) throw new ApiError(409, 'Idempotency key was already used for different input')
            return prior[0].result
          }
          const audit = async (entity: string, entityId: string, before: number | null, after = 1) => {
            await tx.query(`INSERT INTO stunna.audit_events
              (id,athlete_id,actor_sub,operation,entity_type,entity_id,before_revision,after_revision,reason,source)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [randomUUID(), athleteId, principal.subject, command.operation, entity, entityId, before, after, command.reason, principal.source])
          }
          const result = await execute(tx, athleteId, command, principal, audit, now)
          await tx.query('INSERT INTO stunna.write_requests(athlete_id,idempotency_key,request_hash,result) VALUES($1,$2,$3,$4)',
            [athleteId, command.idempotencyKey, hash, JSON.stringify(result)])
          return result
        })
      } catch (error) {
        if (error instanceof ApiError) throw error
        // Database driver messages can contain private bound values; never return them.
        if (typeof error === 'object' && error && 'code' in error && ['23503','23505','23514'].includes(String(error.code))) {
          throw new ApiError(409, 'Record constraint conflict')
        }
        throw error
      }
    },
  }
}

async function execute(tx: Queryable, athleteId: string, command: TrainingCommand, principal: TrainingPrincipal,
  audit: (entity: string, id: string, before: number | null, after?: number) => Promise<void>, now: () => Date): Promise<WriteResult> {
  const id = randomUUID()
  if (command.operation === 'log_workout') {
    const result = await logResult(tx,athleteId,command,principal.subject,principal.source,command.reason)
    await audit('session_entry',result.entryId,command.expectedSessionRevision,result.sessionRevision)
    return result
  }
  if (command.operation === 'start_workout') {
    const result = await startWorkout(tx, athleteId, command, principal.source === 'browser' ? 'manual' : 'api')
    if (result.created) await audit('actual_session', result.workout.id, null)
    return { workout: result.workout }
  }
  if (command.operation === 'complete_workout') {
    const result = await completeWorkout(tx, athleteId, command)
    await audit('actual_session', result.actualSessionId, command.expectedSessionRevision, result.sessionRevision)
    return result
  }
  if (command.operation === 'save_weekly_intent') {
    const week = command
    const blockId = id
    const end = moveTrainingDate(week.weekStartsOn, 6)
    await tx.query(`INSERT INTO stunna.training_blocks(id,athlete_id,title,goal,starts_on,ends_on,source)
      VALUES($1,$2,$3,$4,$5,$6,'manual')`,
      [blockId, athleteId, week.title, week.focus, week.weekStartsOn, end])
    await audit('training_block', blockId, null)
    const plannedSessionIds: string[] = []
    for (const day of week.days) {
      const planId = randomUUID()
      await tx.query(`INSERT INTO stunna.planned_sessions
        (id,athlete_id,block_id,scheduled_at,planned_on,time_zone,kind,purpose,source)
        VALUES($1,$2,$3,NULL,$4,$5,$6,$7,'manual')`,
        [planId, athleteId, blockId, day.date, week.timeZone, day.kind, day.purpose])
      await audit('planned_session', planId, null)
      plannedSessionIds.push(planId)
    }
    const methodology = week.methodology ?? {
      weeklyStructure: [...new Set(week.days.map(day => day.date))].map(date => ({
        weekday: ((new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7) + 1,
        slots: week.days.filter(day => day.date === date).map(day => day.purpose),
      })),
      progressionRules: [], sourceReferences: [],
    }
    const parsedMethodology = blockMethodology.safeParse(methodology)
    if (!parsedMethodology.success) throw new ApiError(400, 'Invalid weekly training structure')
    await tx.query(`INSERT INTO stunna.block_context_revisions
      (athlete_id,block_id,revision,context,change_reason)
      VALUES($1,$2,1,$3,$4)`,
      [athleteId, blockId, JSON.stringify(parsedMethodology.data), week.reason])
    await audit('block_context_revision', blockId, null)
    return { blockId, plannedSessionIds }
  }
  if (command.operation === 'publish_approved_workout') {
    let plannedSessionId = command.plannedSessionId
    if (command.newPlan) {
      if (command.expectedPrescriptionRevision !== 0) throw new ApiError(409, 'New workout must start at revision zero')
      const plan = command.newPlan
      let blockId = plan.blockId
      if (!blockId) {
        blockId = randomUUID()
        await tx.query(`INSERT INTO stunna.training_blocks(id,athlete_id,title,goal,starts_on,ends_on,source)
          VALUES($1,$2,$3,$4,$5,$5,'manual')`,
          [blockId, athleteId, command.title, plan.purpose, plan.date])
        await audit('training_block', blockId, null)
      }
      const { rows: blocks } = await tx.query<{id:string}>(`SELECT id FROM stunna.training_blocks
        WHERE id=$1 AND athlete_id=$2 AND starts_on <= $3::date AND ends_on >= $3::date`,
        [blockId, athleteId, plan.date])
      if (!blocks[0]) throw new ApiError(404, 'Training block not found for date')
      plannedSessionId = randomUUID()
      await tx.query(`INSERT INTO stunna.planned_sessions
        (id,athlete_id,block_id,scheduled_at,planned_on,time_zone,kind,purpose,source)
        VALUES($1,$2,$3,NULL,$4,$5,$6,$7,'manual')`,
        [plannedSessionId, athleteId, blockId, plan.date, plan.timeZone, plan.kind, plan.purpose])
      await audit('planned_session', plannedSessionId, null)
    }
    const { rows: plans } = await tx.query<{kind:string; planned_on: string | null; scheduled_at: Date | string | null; time_zone: string}>(`SELECT kind, planned_on::text AS planned_on, scheduled_at, time_zone FROM stunna.planned_sessions
      WHERE id=$1 AND athlete_id=$2`, [plannedSessionId, athleteId])
    if (!plans[0]) throw new ApiError(404, 'Planned workout not found')
    // An initial executable prescription may only be published the night before
    // or on the athlete's local training day. Existing revisions remain immutable.
    if (command.expectedPrescriptionRevision === 0) {
      const plan = plans[0]
      const planDate = plan.planned_on
        ? plan.planned_on
        : localTrainingDate(new Date(plan.scheduled_at!), plan.time_zone)
      const today = localTrainingDate(now(), plan.time_zone)
      if (planDate !== today && planDate !== moveTrainingDate(today, 1))
        throw new ApiError(400, 'Initial workout publication is allowed only the day before or day of training')
    }
    const exercises = prescriptionExercisesFor(plans[0].kind).safeParse(command.exercises)
    if (!exercises.success) throw new ApiError(400, 'Invalid exercises or incompatible modality targets')
    const encoded = JSON.stringify(exercises.data)
    if (Buffer.byteLength(encoded, 'utf8') > 20000) throw new ApiError(400, 'Prescription exceeds storage limit')
    const occurrences = exercises.data.reduce((total, exercise) =>
      total + 1 + (exercise.warmups?.length ?? 0) +
      (exercise.intervalBlocks?.reduce((sum, block) => sum + block.repeat * block.segments.length, 0) ?? 0), 0)
    if (occurrences > 4096) throw new ApiError(400, 'Prescription exceeds execution limit')
    const { rows: latest } = await tx.query<{revision:number}>(`SELECT revision FROM stunna.prescription_revisions
      WHERE athlete_id=$1 AND planned_session_id=$2 ORDER BY revision DESC LIMIT 1`,
      [athleteId, plannedSessionId])
    const previous = latest[0]?.revision ?? 0
    if (previous !== command.expectedPrescriptionRevision) throw new ApiError(409, 'Prescription revision conflict; re-read before publishing')
    const revision = previous + 1
    const { rows: published } = await tx.query<{approved_at:Date}>(`INSERT INTO stunna.prescription_revisions
      (athlete_id,planned_session_id,revision,title,overview,exercises,change_reason,source,approval_note,approved_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,transaction_timestamp()) RETURNING approved_at`,
      [athleteId, plannedSessionId, revision, command.title, command.overview === null ? null : JSON.stringify(command.overview),
        encoded, command.reason, principal.source === 'api' ? 'api' : 'manual', command.approvalNote])
    await audit('prescription_revision', plannedSessionId!, previous || null, revision)
    return { plannedSessionId, prescriptionRevision: revision,
      approvedAt: new Date(published[0].approved_at).toISOString() }
  }
  if (command.operation === 'create_block') {
    const b = command.block
    await tx.query(`INSERT INTO stunna.training_blocks(id,athlete_id,title,goal,starts_on,ends_on,source)
      VALUES($1,$2,$3,$4,$5,$6,$7)`, [id, athleteId, b.title, b.goal, b.startsOn, b.endsOn, b.source])
    await audit('training_block', id, null)
    return { blockId: id }
  }
  if (command.operation === 'create_planned_session') {
    const p = command.plan
    const { rows } = await tx.query('SELECT id FROM stunna.training_blocks WHERE id=$1 AND athlete_id=$2 AND $3::timestamptz AT TIME ZONE $4 >= starts_on AND ($3::timestamptz AT TIME ZONE $4)::date <= ends_on', [p.blockId, athleteId, p.scheduledAt, p.timeZone])
    if (!rows.length) throw new ApiError(404, 'Training block not found for that date')
    await tx.query(`INSERT INTO stunna.planned_sessions(id,athlete_id,block_id,scheduled_at,time_zone,kind,purpose,source)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [id, athleteId, p.blockId, p.scheduledAt, p.timeZone, p.kind, p.purpose, p.source])
    await audit('planned_session', id, null)
    return { plannedSessionId: id }
  }
  const result: WriteResult = {}
  const source = principal.source === 'browser' ? 'manual' : 'api'
  if (command.measurement) {
    const m = command.measurement
    await tx.query(`INSERT INTO stunna.body_measurements(id,athlete_id,kind,value,unit,measured_at,time_zone,source)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [id, athleteId, m.kind, m.value, m.unit, m.measuredAt, m.timeZone, source])
    result.measurementId = id
    await audit('body_measurement', id, null)
  }
  if (command.session) {
    const s = command.session
    const { rows: plans } = await tx.query('SELECT id FROM stunna.planned_sessions WHERE id=$1 AND athlete_id=$2', [s.plannedSessionId, athleteId])
    if (!plans[0]) throw new ApiError(404, 'Planned session not found')
    const { rows: actuals } = await tx.query<ActualSession & { prescription_snapshot?: unknown }>('SELECT * FROM stunna.actual_sessions WHERE planned_session_id=$1 AND athlete_id=$2', [s.plannedSessionId, athleteId])
    const previous = actuals[0]
    // Legacy observations must not rewrite the pinned player session or its completion.
    if (previous?.prescription_snapshot) throw new ApiError(409, 'Pinned session requires dedicated workout commands')
    if (s.expectedRevision !== (previous?.revision ?? 0)) throw new ApiError(409, 'Session revision conflict; reload before retrying')
    if (previous?.status === 'completed' && (s.status !== 'completed' || Date.parse(s.completedAt!) !== new Date(previous.completed_at!).getTime() || Date.parse(s.startedAt) !== new Date(previous.started_at).getTime())) {
      throw new ApiError(409, 'A finalized session cannot be reopened or finalized again')
    }
    const actualId = previous?.id ?? randomUUID()
    const revision = (previous?.revision ?? 0) + 1
    if (previous) {
      await tx.query(`UPDATE stunna.actual_sessions SET started_at=$1,completed_at=$2,status=$3,notes=$4,rpe=$5,revision=$6,updated_at=now(),source=$7
        WHERE id=$8 AND athlete_id=$9`, [s.startedAt, s.completedAt, s.status, s.notes, s.rpe, revision, source, actualId, athleteId])
    } else {
      await tx.query(`INSERT INTO stunna.actual_sessions(id,athlete_id,planned_session_id,started_at,completed_at,status,notes,rpe,source)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [actualId, athleteId, s.plannedSessionId, s.startedAt, s.completedAt, s.status, s.notes, s.rpe, source])
    }
    await audit('actual_session', actualId, previous?.revision ?? null, revision)
    result.actualSessionId = actualId
    result.sessionRevision = revision
  }
  return result
}

// Lazy: importing or using existing integrations requires no PostgreSQL config.
export function trainingService() { return createTrainingService(getTrainingDatabase()) }
