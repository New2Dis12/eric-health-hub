import { z } from 'zod'

export const contextDate = z.iso.date().refine(date => date >= '1901-01-01' && date <= '9998-12-31')
export const contextInput = z.strictObject({ date: contextDate.optional() })
const exerciseKey = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
const target = z.strictObject({
  value: z.number().positive().max(2000),
  unit: z.enum(['lb', 'kg', 'mph', 'km/h']),
})
const dose = z.strictObject({
  sets: z.number().int().min(1).max(50).nullable(),
  reps: z.number().int().min(1).max(500).nullable(),
  durationSeconds: z.number().int().min(1).max(86400).nullable(),
  target: target.nullable(),
})
const text = z.string().trim().min(1).max(400)
const range = z.strictObject({ min: z.number().nonnegative(), max: z.number().nonnegative() })
  .refine(value => value.min <= value.max)
const rpe = z.strictObject({ min: z.number().min(0).max(10), max: z.number().min(0).max(10) })
  .refine(value => value.min <= value.max)
export const workoutOverview = z.strictObject({
  rationale: text.nullable(),
  expectedDurationMinutes: z.strictObject({
    min: z.number().int().min(1).max(1440),
    max: z.number().int().min(1).max(1440),
  }).refine(value => value.min <= value.max).nullable(),
  rpe: rpe.nullable(),
})

const metricUnits = [
  ['speed', ['mph', 'km/h', 'm/s']],
  ['pace', ['sec/km', 'sec/mi']],
  ['distance', ['m', 'km', 'mi']],
  ['power', ['W']],
  ['rowing_split', ['sec/500m']],
  ['stroke_rate', ['spm']],
  ['cycling_cadence', ['rpm']],
] as const

export const metricTarget = z.strictObject({
  metric: z.enum(['speed', 'pace', 'distance', 'power', 'rowing_split', 'stroke_rate', 'cycling_cadence']),
  unit: z.enum(['mph', 'km/h', 'm/s', 'sec/km', 'sec/mi', 'm', 'km', 'mi', 'W', 'sec/500m', 'spm', 'rpm']),
  range: range.nullable(),
}).refine(value => metricUnits.some(([metric, units]) =>
  metric === value.metric && (units as readonly string[]).includes(value.unit)), 'Metric and unit must agree')
const segment = z.strictObject({
  phase: z.enum(['warmup', 'work', 'recovery', 'transition', 'cooldown']),
  modality: z.enum(['run', 'row', 'bike', 'ski', 'strength', 'mobility', 'other']),
  label: text,
  durationSeconds: z.number().int().min(1).max(86400).nullable(),
  targets: z.array(metricTarget).max(8),
  rpe: rpe.nullable(),
  strength: dose.extend({ loadBasis: z.enum(['total', 'per_hand', 'added', 'bodyweight', 'unverified']) }).optional(),
})
export const blockMethodology = z.strictObject({
  weeklyStructure: z.array(z.strictObject({
    weekday: z.number().int().min(1).max(7),
    slots: z.array(text).min(1).max(8),
  })).max(7),
  progressionRules: z.array(text).max(12),
  sourceReferences: z.array(text).max(12),
})
export const benchmarkPerformance = dose.extend({
  targets: z.array(metricTarget).max(8).optional(),
  rpe: rpe.optional(),
}).refine(value => Object.values(value).some(part => part !== null && part !== undefined))
export const prescriptionExercises = z.array(dose.extend({
  key: exerciseKey,
  name: z.string().trim().min(1).max(100),
  restSeconds: z.number().int().min(0).max(3600).nullable(),
  notes: text.nullable(),
  rpe: rpe.optional(),
  repsRange: z.strictObject({ min: z.number().int().min(1).max(500), max: z.number().int().min(1).max(500) })
    .refine(value => value.min <= value.max).optional(),
  loadBasis: z.enum(['total', 'per_hand', 'added', 'bodyweight', 'unverified']).optional(),
  optional: z.boolean().optional(),
  equipment: text.optional(),
  comparisonContext: text.optional(),
  sourceReferences: z.array(text).max(8).optional(),
  warmups: z.array(segment).max(8).optional(),
  intervalBlocks: z.array(z.strictObject({
    repeat: z.number().int().min(1).max(30),
    segments: z.array(segment).min(1).max(12),
  })).max(8).optional(),
  targets: z.array(metricTarget).max(8).optional(),
  adjustments: z.array(z.strictObject({
    condition: text,
    action: text,
    substitution: z.strictObject({ exerciseKey, name: text, equipment: text }).optional(),
  })).max(8).optional(),
})).min(1).max(24)

export type Segment = z.infer<typeof segment>
export type MetricTarget = z.infer<typeof metricTarget>
export type Dose = z.infer<typeof dose>

export function localTrainingDate(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(instant)
  const get = (type: string) => parts.find(part => part.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function moveTrainingDate(date: string, days: number) {
  const instant = new Date(date + 'T12:00:00Z')
  instant.setUTCDate(instant.getUTCDate() + days)
  return instant.toISOString().slice(0, 10)
}

export function trainingWeek(date: string) {
  const mondayOffset = (new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7
  return Array.from({ length: 7 }, (_, i) => moveTrainingDate(date, i - mondayOffset))
}
