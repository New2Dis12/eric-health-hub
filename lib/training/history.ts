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
  performance: unknown; source: string;¶»§q«^