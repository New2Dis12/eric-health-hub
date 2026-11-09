import 'server-only'
import { z } from 'zod'
import { ApiError } from '@/lib/private-api'
import { assertTrainingAccess, type TrainingPrincipal } from './auth'
import { logFields } from './logging-models'
import { trainingService, type createTrainingService } from './service'

// Use the same RLS-enforced service, validated command and durable idempotency ledger as the browser API.
export const actualsPage = z.strictObject({
  sessionId: z.uuid().optional(),
  plannedSessionId: z.uuid().optional(),
  history: z.boolean().default(false),
  limit: z.number().int().min(1).max(50).default(25),
  offset: z.number().int().min(0).max(10000).default(0),
})
export const actualsWrite = z.strictObject({
  idempotencyKey: z.uuid(),
  reason: z.string().trim().min(1).max(500),
  sessionId: logFields.sessionId,
  expectedSessionRevision: logFields.expectedSessionRevision,
  expectedItemRevision: logFields.expectedItemRevision,
  item: z.discriminatedUnion('kind', [
    z.strictObject({kind:z.literal('strength_set'),occurrenceId:z.uuid(),setOrdinal:z.number().int().min(1).max(50),actual:z.strictObject({
      reps:z.number().int().min(0).max(500).nullable(),
      load:z.strictObject({value:z.number().min(0).max(2000),unit:z.enum(['kg','lb']),basis:z.enum(['total','per_hand','added','bodyweight'])}).nullable(),
      rpe:z.number().min(0).max(10).nullable(),
      source:z.literal('user_reported'),
    })}),
    z.strictObject({kind:z.literal('exercise_note'),occurrenceId:z.uuid(),notes:z.string().max(4000)}),
    z.strictObject({kind:z.literal('workout_note'),notes:z.string().max(4000)}),
  ]),
})
type Service = ReturnType<typeof createTrainingService>
export function createMcpTrainingActuals(service: () => Service = trainingService) {
  return {
    async read(principal: TrainingPrincipal, input: z.infer<typeof actualsPage>) {
      assertTrainingAccess(principal, 'training.read')
      if (process.env.STUNNA_ENABLED !== 'true') throw new ApiError(404,'Not found')
      const page = actualsPage.parse(input)
      // A calendar returns a planned workout ID, whereas the results reader uses the
      // actual-session ID. Resolve only the authenticated athlete's existing session.
      if ((page.sessionId === undefined) === (page.plannedSessionId === undefined)) throw new ApiError(400, 'Supply exactly one workout identifier')
      const sessionId = page.plannedSessionId
        ? (await service().workout(principal, page.plannedSessionId))?.id
        : page.sessionId
      if (!sessionId) throw new ApiError(404, 'Saved session not found')
      return service().results(principal,sessionId,page.history,page.limit,page.offset)
    },
    async write(principal: TrainingPrincipal, input: z.infer<typeof actualsWrite>) {
      assertTrainingAccess(principal, 'training.write')
      if (process.env.STUNNA_ENABLED !== 'true') throw new ApiError(404,'Not found')
      const parsed = actualsWrite.parse(input)
      return service().write(principal,{...parsed,operation:'log_workout'})
    },
  }
}
