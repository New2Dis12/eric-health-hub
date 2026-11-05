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
export const benchmarkPerformance = dose.refine(value => Object.values(value).some(part => part !== null))
export const prescriptionExercises = z.array(dose.extend({
  key: exerciseKey,
  name: z.string().trim().min(1).max(100),
  restSeconds: z.number().int().min(0).max(3600).nullable(),
  notes: z.string().trim().min(1).max(400).nullable(),
})).min(1).max(24)

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
