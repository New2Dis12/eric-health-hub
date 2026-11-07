import { z } from 'zod'
const bounded = (max: number) => z.number().min(0).max(max)
export const strengthActual = z.strictObject({
  reps: bounded(500).int().nullable(),
  load: z.strictObject({ value: bounded(2000), unit: z.enum(['kg','lb']), basis: z.enum(['total','per_hand','added','bodyweight']) }).nullable(),
  rpe: bounded(10).nullable(), source: z.literal('user_reported'),
})
const metricUnits = {
  duration: ['s'], distance: ['m','km','mi'], speed: ['m/s','km/h','mph'], pace: ['sec/km','sec/mi'],
  power: ['W'], rowing_split: ['sec/500m'], stroke_rate: ['spm'], cycling_cadence: ['rpm'],
} as const
export const actualMetric = z.strictObject({
  metric: z.enum(['duration','distance','speed','pace','power','rowing_split','stroke_rate','cycling_cadence']),
  value: bounded(1000000).nullable(), unit: z.enum(['s','m','km','mi','m/s','km/h','mph','sec/km','sec/mi','W','sec/500m','spm','rpm']),
}).refine(m => (metricUnits[m.metric] as readonly string[]).includes(m.unit), 'Metric unit mismatch')
  .refine(m => m.value === null || m.value <= ({duration:86400,distance:1000000,speed:200,pace:86400,power:5000,rowing_split:86400,stroke_rate:300,cycling_cadence:300}[m.metric]), 'Metric out of bounds')
export const intervalActual = z.strictObject({ metrics: z.array(actualMetric).max(8), rpe: bounded(10).nullable(), source: z.literal('user_reported') })
  .refine(v => new Set(v.metrics.map(m => m.metric)).size === v.metrics.length, 'Duplicate metric')
export const logFields = {
  sessionId: z.uuid(), expectedSessionRevision: z.number().int().min(1).max(2147483646),
  expectedItemRevision: z.number().int().min(0).max(2147483646),
  item: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('strength_set'), occurrenceId: z.uuid(), setOrdinal: z.number().int().min(1).max(50), actual: strengthActual }),
    z.strictObject({ kind: z.literal('interval'), occurrenceId: z.uuid(), actual: intervalActual }),
    z.strictObject({ kind: z.literal('exercise_note'), occurrenceId: z.uuid(), notes: z.string().max(4000) }),
    z.strictObject({ kind: z.literal('workout_note'), notes: z.string().max(4000) }),
  ]),
}
export const loggingInput = z.object(logFields)
export type LogInput = z.infer<typeof loggingInput>
export type LogValue = z.infer<typeof strengthActual> | z.infer<typeof intervalActual> | { notes: string }
export type LogEntry = { id: string; item_key: string; kind: string; occurrence_id: string | null; set_ordinal: number;
  revision: number; session_revision: number; value: LogValue; before_value: LogValue | null; actor_sub: string; source: 'browser'|'api'; reason: string; recorded_at: string }
export type SessionResults = { sessionId: string; sessionRevision: number; status: string; notes: string; notesRevision: number; entries: LogEntry[]; nextOffset: number | null }
