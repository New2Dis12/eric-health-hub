import 'server-only'
import { ApiError } from '@/lib/private-api'
import { assertTrainingAccess, type TrainingPrincipal } from './auth'
import { approvedWorkoutFields, weeklyIntentFields } from './models'
import { trainingService, type createTrainingService } from './service'
import type { z } from 'zod'

type Service = ReturnType<typeof createTrainingService>

// Chat-side consent is a required caller action, not a claim that the server can
// cryptographically verify a conversational approval. The exact submitted
// prescription and approval note are versioned/audited by the shared service.
export function createMcpTrainingPublisher(service: () => Service = trainingService) {
  return {
    async week(principal: TrainingPrincipal, input: z.infer<typeof weeklyIntentFields>) {
      if (process.env.STUNNA_ENABLED !== 'true') throw new ApiError(404, 'Not found')
      assertTrainingAccess(principal, 'training.write')
      const parsed = weeklyIntentFields.safeParse(input)
      if (!parsed.success) throw new ApiError(400, 'Invalid weekly intent')
      return service().write(principal, { operation: 'save_weekly_intent', ...parsed.data })
    },
    async publish(principal: TrainingPrincipal, input: z.infer<typeof approvedWorkoutFields>) {
      if (process.env.STUNNA_ENABLED !== 'true') throw new ApiError(404, 'Not found')
      assertTrainingAccess(principal, 'training.write')
      const parsed = approvedWorkoutFields.safeParse(input)
      if (!parsed.success) throw new ApiError(400, 'Invalid approved prescription')
      return service().write(principal, { operation: 'publish_approved_workout', ...parsed.data })
    },
  }
}
