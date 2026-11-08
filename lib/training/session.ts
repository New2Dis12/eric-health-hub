import 'server-only'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ApiError } from '../private-api'
import { prescriptionExercisesFor, workoutOverview, type prescriptionExercises } from './context-models'
import type { Queryable } from './database'

export type SessionSnapshot = {
  title: string; kind: string; purpose: string; overview: z.infer<typeof workoutOverview> | null
  exercises: z.infer<typeof prescriptionExercises>
  occurrences: { id: string; exercise: number; key: string; type: string; block?: number; repeat?: number; segment?: number }[]
}
export type WorkoutSession = {
  id: string; revision: number; status: 'in_progress' | 'completed'; startedAt: string
  prescriptionRevision: number | null; snapshot: SessionSnapshot | null
}
export const workoutId = z.uuid()
export const startWorkoutFields = {
  plannedSessionId: workoutId,
  expectedPrescriptionRevision: z.number().int().min(1).max(2147483646),
  expectedSessionRevision: z.number().int().min(0).max(2147483646),
}
export async function readWorkoutSession(tx: Queryable, athleteId: string, planId: string): Promise<WorkoutSession | null> {
  const { rows } = await tx.query(`SELECT id,revision,status,started_at,prescription_revision,prescription_snapshot
    FROM stunna.actual_sessions WHERE athlete_id=$1 AND planned_session_id=$2`, [athleteId, planId])
  const row = rows[0]
  return row ? { id: row.id, revision: row.revision, status: row.status, startedAt: new Date(row.started_at).toISOString(),
    prescriptionRevision: row.prescription_revision, snapshot: row.prescription_snapshot } : null
}
export async function startWorkout(tx: Queryable, athleteId: string, input: z.infer<ReturnType<typeof startSchema>>, source: string) {
  const existing = await readWorkoutSession(tx, athleteId, input.plannedSessionId)
  if (existing) {
    // Zero allows concurrent first-start requests to converge, without mutating the session.
    if (input.expectedSessionRevision !== 0 && input.expectedSessionRevision !== existing.revision) throw new ApiError(409, 'Session changed; reload before retrying')
    return { workout: existing, created: false }
  }
  if (input.expectedSessionRevision !== 0) throw new ApiError(409, 'Session changed; reload before retrying')
  const { rows } = await tx.query(`SELECT p.kind,p.purpose,r.revision,r.title,r.overview,r.exercises
    FROM stunna.planned_sessions p JOIN LATERAL (
      SELECT revision,title,overview,exercises FROM stunna.prescription_revisions
      WHERE athlete_id=p.athlete_id AND planned_session_id=p.id AND approved_at<=transaction_timestamp()
      ORDER BY revision DESC LIMIT 1
    ) r ON true WHERE p.athlete_id=$1 AND p.id=$2`, [athleteId, input.plannedSessionId])
  const row = rows[0]
  if (!row) throw new ApiError(404, 'Approved workout not found')
  if (row.revision !== input.expectedPrescriptionRevision) throw new ApiError(409, 'Prescription changed; reload before starting')
  const exercises = prescriptionExercisesFor(row.kind).parse(row.exercises)
  const occurrences: SessionSnapshot['occurrences'] = []
  exercises.forEach((exercise, index) => {
    const add = (type: string, values = {}) => {
      if (occurrences.length >= 4096) throw new ApiError(400, 'Prescription has too many execution items')
      occurrences.push({ id: randomUUID(), exercise: index, key: exercise.key, type, ...values })
    }
    add('exercise')
    exercise.warmups?.forEach((_, segment) => add('warmup', { segment }))
    exercise.intervalBlocks?.forEach((block, i) => {
      for (let repeat = 0; repeat < block.repeat; repeat++) block.segments.forEach((_, segment) => add('interval', { block: i, repeat, segment }))
    })
  })
  const snapshot: SessionSnapshot = { title: row.title, kind: row.kind, purpose: row.purpose,
    overview: row.overview === null ? null : workoutOverview.parse(row.overview), exercises, occurrences }
  await tx.query(`INSERT INTO stunna.actual_sessions(id,athlete_id,planned_session_id,started_at,status,source,prescription_revision,prescription_snapshot)
    VALUES($1,$2,$3,transaction_timestamp(),'in_progress',$4,$5,$6)`,
    [randomUUID(), athleteId, input.plannedSessionId, source, row.revision, JSON.stringify(snapshot)])
  return { workout: (await readWorkoutSession(tx, athleteId, input.plannedSessionId))!, created: true }
}
const startSchema = () => z.object(startWorkoutFields)
