import { z } from 'zod'
import { startWorkoutFields, type WorkoutSession } from './session'

const id = z.uuid()
const instant = z.iso.datetime({ offset: true })
const date = z.iso.date()
const zone = z.string().min(1).max(100).refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false }
}, 'Invalid IANA time zone')
const kind = z.enum(['strength', 'run', 'bike', 'swim', 'mobility', 'other'])
const provenance = z.enum(['manual', 'reviewed_import'])

export const measurementSchema = z.strictObject({
  kind: z.enum(['weight','waist']), value: z.number().positive().max(2000),
  unit: z.enum(['kg','lb','cm','in']), measuredAt: instant, timeZone: zone,
}).refine(m => m.kind === 'weight' ? ['kg','lb'].includes(m.unit) : ['cm','in'].includes(m.unit), 'Incompatible measurement unit')

export const actualSessionSchema = z.strictObject({
  plannedSessionId: id,
  expectedRevision: z.number().int().min(0).max(2147483646),
  startedAt: instant, completedAt: instant.nullable(),
  status: z.enum(['in_progress','completed']),
  notes: z.string().max(4000).default(''), rpe: z.number().min(0).max(10).nullable().default(null),
}).refine(s => (s.status === 'completed') === (s.completedAt !== null), 'Completion requires a timestamp')
  .refine(s => !s.completedAt || Date.parse(s.completedAt) >= Date.parse(s.startedAt), 'Completion precedes start')

const envelope = { idempotencyKey: id, reason: z.string().trim().min(1).max(500) }
export const commandSchema = z.discriminatedUnion('operation', [
  z.strictObject({ ...envelope, operation: z.literal('start_workout'), ...startWorkoutFields }),
  z.strictObject({ ...envelope, operation: z.literal('create_block'), block: z.strictObject({
    title: z.string().trim().min(1).max(200), goal: z.string().trim().min(1).max(2000),
    startsOn: date, endsOn: date, source: provenance,
  }).refine(b => b.endsOn >= b.startsOn, 'Block ends before start') }),
  z.strictObject({ ...envelope, operation: z.literal('create_planned_session'), plan: z.strictObject({
    blockId: id, scheduledAt: instant, timeZone: zone, kind,
    purpose: z.string().trim().min(1).max(2000), source: provenance,
  }) }),
  z.strictObject({ ...envelope, operation: z.literal('record_observation'),
    measurement: measurementSchema.optional(), session: actualSessionSchema.optional(),
  }).refine(c => !!c.measurement || !!c.session, 'A measurement or session is required'),
])
export type TrainingCommand = z.infer<typeof commandSchema>

export type Athlete = { id: string; auth0_sub: string; time_zone: string; created_at: Date }
export type TrainingBlock = { id: string; athlete_id: string; title: string; goal: string; starts_on: string; ends_on: string; source: 'manual' | 'reviewed_import'; revision: number }
export type PlannedSession = { id: string; athlete_id: string; block_id: string; scheduled_at: Date; time_zone: string; kind: z.infer<typeof kind>; purpose: string; source: 'manual' | 'reviewed_import'; revision: number }
export type ActualSession = { id: string; athlete_id: string; planned_session_id: string; started_at: Date; completed_at: Date | null; status: 'in_progress' | 'completed'; notes: string; rpe: number | null; revision: number; source: 'manual' | 'api' }
export type BodyMeasurement = { id: string; athlete_id: string; kind: 'weight' | 'waist'; value: number; unit: 'kg' | 'lb' | 'cm' | 'in'; measured_at: Date; time_zone: string; source: 'manual' | 'api'; revision: number }
export type AuditEvent = { id: string; athlete_id: string; actor_sub: string; operation: string; entity_type: string; entity_id: string; before_revision: number | null; after_revision: number; reason: string; source: 'browser' | 'api'; occurred_at: Date }
export type WriteResult = { blockId?: string; plannedSessionId?: string; actualSessionId?: string; sessionRevision?: number; measurementId?: string; workout?: WorkoutSession }
export type TrainingHistory = { blocks: TrainingBlock[]; plans: PlannedSession[]; sessions: ActualSession[]; measurements: BodyMeasurement[] }
