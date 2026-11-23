import 'server-only'
import { z } from 'zod'
import { ApiError } from '../private-api'
import { assertTrainingAccess, type TrainingPrincipal } from './auth'
import { contextDate, localTrainingDate } from './context-models'
import { getTrainingDatabase, type TrainingDatabase } from './database'

// Historical lookup shares the existing owner-scoped transaction and RLS boundary.
// It does not turn retrospective observations into pinned live workout sessions.
export const historyFields = z.strictObject({
  fromDate: contextDate.optional(),
  toDate: contextDate.optional(),
  query: z.string().trim().min(1).max(80).optional(),
  category: z.enum(['all', 'workouts', 'benchmarks', 'measurements', 'blocks']).default('all'),
  limit: z.number().int().min(1).max(50).default(25),
  offset: z.number().int().min(0).max(10000).default(0),
})
export const historyInput = historyFields.refine(
  v => !v.fromDate || !v.toDate || v.fromDate <= v.toDate,
  { message: 'fromDate must be on or before toDate' },
)

export type TrainingHistoryItem = {
  id: string
  category: 'workout' | 'benchmark' | 'measurement' | 'block'
  date: string
  timestamp: string | null
  timePrecision: 'recorded' | 'standardized_noon' | 'stored'
  label: string
  source: string
  sourceReference: string | null
  details: Record<string, unknown>
}
type Athlete = { id: string; time_zone: string }
type BenchmarkRow = {
  id: string; exercise_key: string; performed_at: Date | string
  performance: unknown; source: string; verification_status: string
  comparison_context: string; source_reference: string | null
}
type WorkoutRow = {
  id: string; started_at: Date | string; completed_at: Date | string | null
  status: string; notes: string | null; rpe: number | null; source: string
  kind: string; purpose: string
}
type MeasurementRow = {
  id: string; kind: string; value: number; unit: string
  measured_at: Date | string; time_zone: string; source: string; revision: number
}
type BlockRow = {
  id: string; title: string; goal: string; starts_on: string; ends_on: string
  source: string; context: unknown; methodology_revision: number | null
}
const instant = (value: Date | string) => new Date(value).toISOString()
function itemDate(value: Date | string, timeZone: string) {
  return localTrainingDate(new Date(value), timeZone)
}

export function createTrainingHistoryReader(database: () => TrainingDatabase = getTrainingDatabase) {
  return async (principal: TrainingPrincipal, input: unknown) => {
    if (process.env.STUNNA_ENABLED !== 'true') throw new ApiError(404, 'Not found')
    assertTrainingAccess(principal, 'training.read')
    const parsed = historyInput.safeParse(input)
    if (!parsed.success) throw new ApiError(400, 'Invalid training history filters')
    const filters = parsed.data
    // Each source is bounded independently; global ordering/pagination is applied below.
    // All SQL parameters are bound and each query has an explicit athlete predicate.
    const cap = filters.limit + filters.offset + 1
    return database().transaction(principal.subject, async tx => {
      const { rows: athletes } = await tx.query<Athlete>(
        'SELECT id, time_zone FROM stunna.athletes WHERE auth0_sub=$1', [principal.subject],
      )
      const athlete = athletes[0]
      if (!athlete) return { records: [] as TrainingHistoryItem[], hasMore: false, limit: filters.limit, offset: filters.offset, timeZone: null }
      const params = [
        athlete.id, filters.fromDate ?? null, filters.toDate ?? null,
        athlete.time_zone, filters.query?.toLowerCase() ?? null, cap,
      ]
      const output: TrainingHistoryItem[] = []

      if (filters.category === 'all' || filters.category === 'benchmarks' || filters.category === 'workouts') {
        const { rows } = await tx.query<BenchmarkRow>([
          'SELECT id, exercise_key, performed_at, performance, source, verification_status, comparison_context, source_reference',
          'FROM stunna.exercise_benchmarks WHERE athlete_id=$1',
          'AND ($2::date IS NULL OR (performed_at AT TIME ZONE $4::text)::date >= $2::date)',
          'AND ($3::date IS NULL OR (performed_at AT TIME ZONE $4::text)::date <= $3::date)',
          "AND ($5::text IS NULL OR POSITION($5 IN LOWER(exercise_key || ' ' || COALESCE(comparison_context,'') || ' ' || performance::text || ' ' || COALESCE(source_reference,''))) > 0)",
          'ORDER BY performed_at DESC, id DESC LIMIT $6',
        ].join(' '), params)
        for (const r of rows) {
          // Import source identifiers may encode :noon to document a deterministic
          // Chicago 12 PM date anchor, not an observed historical start time.
          const standardized = r.source === 'reviewed_import' && !!r.source_reference?.includes(':noon')
          output.push({
            id: r.id, category: 'benchmark',
            date: itemDate(r.performed_at, athlete.time_zone),
            timestamp: instant(r.performed_at),
            timePrecision: standardized ? 'standardized_noon' : 'stored',
            label: r.exercise_key, source: r.source,
            sourceReference: r.source_reference,
            details: { performance: r.performance, verificationStatus: r.verification_status, comparisonContext: r.comparison_context },
          })
        }
      }
      if (filters.category === 'all' || filters.category === 'workouts') {
        const { rows } = await tx.query<WorkoutRow>([
          'SELECT a.id,a.started_at,a.completed_at,a.status,a.notes,a.rpe,a.source,p.kind,p.purpose',
          'FROM stunna.actual_sessions a JOIN stunna.planned_sessions p',
          'ON p.id=a.planned_session_id AND p.athlete_id=a.athlete_id',
          'WHERE a.athlete_id=$1',
          'AND ($2::date IS NULL OR (a.started_at AT TIME ZONE $4::text)::date >= $2::date)',
          'AND ($3::date IS NULL OR (a.started_at AT TIME ZONE $4::text)::date <= $3::date)',
          "AND ($5::text IS NULL OR POSITION($5 IN LOWER(p.kind || ' ' || p.purpose || ' ' || COALESCE(a.notes,''))) > 0)",
          'ORDER BY a.started_at DESC,a.id DESC LIMIT $6',
        ].join(' '), params)
        for (const r of rows) output.push({
          id: r.id, category: 'workout', date: itemDate(r.started_at, athlete.time_zone),
          timestamp: instant(r.started_at), timePrecision: 'recorded',
          label: r.kind, source: r.source, sourceReference: null,
          details: { status: r.status, purpose: r.purpose, notes: r.notes, rpe: r.rpe,
            completedAt: r.completed_at ? instant(r.completed_at) : null,
            resultsTool: 'get_saved_workout_results', sessionId: r.id },
        })
      }
      if (filters.category === 'all' || filters.category === 'measurements') {
        const { rows } = await tx.query<MeasurementRow>([
          'SELECT id,kind,value,unit,measured_at,time_zone,source,revision',
          'FROM stunna.body_measurements WHERE athlete_id=$1',
          'AND ($2::date IS NULL OR (measured_at AT TIME ZONE $4::text)::date >= $2::date)',
          'AND ($3::date IS NULL OR (measured_at AT TIME ZONE $4::text)::date <= $3::date)',
          "AND ($5::text IS NULL OR POSITION($5 IN LOWER(kind || ' ' || unit)) > 0)",
          'ORDER BY measured_at DESC,id DESC LIMIT $6',
        ].join(' '), params)
        for (const r of rows) output.push({
          id: r.id, category: 'measurement', date: itemDate(r.measured_at, athlete.time_zone),
          timestamp: instant(r.measured_at), timePrecision: 'stored',
          label: r.kind, source: r.source, sourceReference: null,
          details: { value: r.value, unit: r.unit, revision: r.revision, measurementTimeZone: r.time_zone },
        })
      }
      if (filters.category === 'all' || filters.category === 'blocks') {
        const { rows } = await tx.query<BlockRow>([
          'SELECT b.id,b.title,b.goal,b.starts_on::text AS starts_on,b.ends_on::text AS ends_on,b.source,',
          'context.context,context.revision AS methodology_revision',
          'FROM stunna.training_blocks b LEFT JOIN LATERAL',
          '(SELECT context, revision FROM stunna.block_context_revisions',
          'WHERE athlete_id=b.athlete_id AND block_id=b.id ORDER BY revision DESC LIMIT 1) context ON true',
          'WHERE b.athlete_id=$1',
          'AND ($2::date IS NULL OR b.ends_on >= $2::date)',
          'AND ($3::date IS NULL OR b.starts_on <= $3::date)',
          "AND ($4::text IS NULL OR POSITION($4 IN LOWER(b.title || ' ' || b.goal || ' ' || COALESCE(context.context::text,''))) > 0)",
          'ORDER BY b.starts_on DESC,b.id DESC LIMIT $5',
        ].join(' '), [params[0],params[1],params[2],params[4],params[5]])
        for (const r of rows) output.push({
          id: r.id, category: 'block', date: r.starts_on,
          timestamp: null, timePrecision: 'stored',
          label: r.title, source: r.source, sourceReference: null,
          details: { startsOn: r.starts_on, endsOn: r.ends_on, goal: r.goal,
            methodology: r.context ?? null, methodologyRevision: r.methodology_revision },
        })
      }

      // Stable order ensures bounded pages and repeatable reads across fresh MCP chats.
      output.sort((a,b) => b.date.localeCompare(a.date)
        || (b.timestamp ?? '').localeCompare(a.timestamp ?? '')
        || a.category.localeCompare(b.category) || a.id.localeCompare(b.id))
      const records = output.slice(filters.offset, filters.offset + filters.limit)
      return { records, hasMore: output.length > filters.offset + filters.limit,
        limit: filters.limit, offset: filters.offset, timeZone: athlete.time_zone }
    })
  }
}
