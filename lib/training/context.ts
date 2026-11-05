import 'server-only'
import { ApiError } from '../private-api'
import { assertTrainingAccess, type TrainingPrincipal } from './auth'
import { getTrainingDatabase, type TrainingDatabase } from './database'
import {
  benchmarkPerformance, contextInput, localTrainingDate, moveTrainingDate, prescriptionExercises, trainingWeek,
} from './context-models'

type ScheduleRow = {
  id: string
  kind: string
  purpose: string
  scheduled_at: Date | string
  block_title: string
  block_goal: string
  revision: number | null
  title: string | null
  exercises: unknown
  change_reason: string | null
  approved_at: Date | string | null
  source: string | null
}
const maxWorkoutsPerDay = 8

export function createTrainingContextReader(database: () => TrainingDatabase, now = () => new Date()) {
  return async (principal: TrainingPrincipal, input: unknown) => {
    if (process.env.STUNNA_ENABLED !== 'true') throw new ApiError(404, 'Not found')
    assertTrainingAccess(principal, 'training.read')
    const parsed = contextInput.safeParse(input)
    if (!parsed.success) throw new ApiError(400, 'Use a valid date in YYYY-MM-DD format')

    return database().transaction(principal.subject, async tx => {
      const identity = await tx.query<{
        id: string; time_zone: string; show_previous: boolean | null; training_focus: string | null
      }>(`SELECT a.id, a.time_zone, pref.show_previous, pref.training_focus
        FROM stunna.athletes a LEFT JOIN stunna.training_preferences pref ON pref.athlete_id=a.id
        WHERE a.auth0_sub=$1`, [principal.subject])
      const athlete = identity.rows[0]
      const timeZone = athlete?.time_zone ?? 'UTC'
      const today = localTrainingDate(now(), timeZone)
      const date = parsed.data.date ?? today
      const dates = trainingWeek(date)
      const preferences = {
        showPrevious: athlete?.show_previous ?? true,
        trainingFocus: athlete?.training_focus ?? null,
      }
      const weekParams = [athlete?.id, dates[0], moveTrainingDate(dates[6], 1), timeZone]
      const { rows: days } = athlete ? await tx.query<{ day: string; count: number }>(`
        SELECT to_char(timezone($4, scheduled_at), 'YYYY-MM-DD') AS day, count(*)::int AS count
        FROM stunna.planned_sessions WHERE athlete_id=$1
          AND scheduled_at >= ($2::date::timestamp AT TIME ZONE $4)
          AND scheduled_at < ($3::date::timestamp AT TIME ZONE $4)
        GROUP BY 1`, weekParams) : { rows: [] }
      const calendar = dates.map(day => ({ date: day, workoutCount: days.find(row => row.day === day)?.count ?? 0 }))
      const { rows } = athlete ? await tx.query<ScheduleRow>(`
        SELECT p.id, p.kind, p.purpose, p.scheduled_at, b.title AS block_title, b.goal AS block_goal,
          r.revision, r.title, r.exercises, r.change_reason, r.approved_at, r.source
        FROM stunna.planned_sessions p
        JOIN stunna.training_blocks b ON b.athlete_id=p.athlete_id AND b.id=p.block_id
        LEFT JOIN LATERAL (
          SELECT revision, title, exercises, change_reason, approved_at, source
          FROM stunna.prescription_revisions
          WHERE athlete_id=p.athlete_id AND planned_session_id=p.id AND approved_at <= transaction_timestamp()
          ORDER BY revision DESC LIMIT 1
        ) r ON true
        WHERE p.athlete_id=$1
          AND p.scheduled_at >= ($2::date::timestamp AT TIME ZONE $3)
          AND p.scheduled_at < (($2::date + 1)::timestamp AT TIME ZONE $3)
        ORDER BY p.scheduled_at, p.id LIMIT $4`, [athlete.id, date, timeZone, maxWorkoutsPerDay]) : { rows: [] }
      const exerciseLists = rows.map(row => row.revision === null ? [] : prescriptionExercises.parse(row.exercises))
      const keys = [...new Set(exerciseLists.flatMap(list => list.map(item => item.key)))]
      const { rows: history } = athlete && preferences.showPrevious && keys.length > 0
        ? await tx.query<{ exercise_key: string; performed_at: Date | string; performance: unknown; source: string }>(`
          SELECT DISTINCT ON (exercise_key) exercise_key, performed_at, performance, source
          FROM stunna.exercise_benchmarks
          WHERE athlete_id=$1 AND exercise_key=ANY($2::text[])
            AND performed_at < ($3::date::timestamp AT TIME ZONE $4)
            AND performed_at <= transaction_timestamp()
          ORDER BY exercise_key, performed_at DESC, id DESC`, [athlete.id, keys, date, timeZone])
        : { rows: [] }
      const previous = new Map(history.map(row => [row.exercise_key, {
        date: localTrainingDate(new Date(row.performed_at), timeZone),
        performance: benchmarkPerformance.parse(row.performance),
        source: row.source,
      }]))

      return {
        date, today, timeZone, calendar, preferences,
        hasMoreWorkouts: (calendar.find(day => day.date === date)?.workoutCount ?? 0) > maxWorkoutsPerDay,
        workouts: rows.map((row, index) => ({
          id: row.id,
          kind: row.kind,
          purpose: row.purpose,
          scheduledAt: new Date(row.scheduled_at).toISOString(),
          block: { title: row.block_title, goal: row.block_goal },
          prescription: row.revision === null ? null : {
            revision: row.revision,
            title: row.title!,
            reason: row.change_reason!,
            approvedAt: new Date(row.approved_at!).toISOString(),
            source: row.source!,
            exercises: exerciseLists[index].map((exercise, position) => ({
              ...exercise, position: position + 1, previous: previous.get(exercise.key) ?? null,
            })),
          },
        })),
      }
    })
  }
}

export const getTrainingContext = createTrainingContextReader(getTrainingDatabase)
export type TrainingContext = Awaited<ReturnType<typeof getTrainingContext>>
