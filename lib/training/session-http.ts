import 'server-only'
import { ApiError, apiError, privateJson } from '../private-api'
import { requireTrainingPrincipal, type TrainingPrincipal, type TrainingScope } from './auth'
import { readCommand } from './http'
import { trainingService, type createTrainingService } from './service'

type Dependencies = {
  enabled: () => boolean
  principal: (request: Request, scope: TrainingScope) => Promise<TrainingPrincipal>
  service: () => ReturnType<typeof createTrainingService>
}
export function createSessionHandlers(deps: Dependencies) {
  return {
    async GET(request: Request) {
      try {
        if (!deps.enabled()) throw new ApiError(404, 'Not found')
        const principal = await deps.principal(request, 'training.read')
        return privateJson({ workout: await deps.service().workout(principal, new URL(request.url).searchParams.get('workout')) })
      } catch (e) { return apiError(e) }
    },
    async POST(request: Request) {
      try {
        if (!deps.enabled()) throw new ApiError(404, 'Not found')
        const principal = await deps.principal(request, 'training.write')
        const input = await readCommand(request)
        if (!input || typeof input !== 'object' || !('operation' in input) || input.operation !== 'start_workout') throw new ApiError(400, 'Expected start workout')
        return privateJson(await deps.service().write(principal, input))
      } catch (e) { return apiError(e) }
    },
  }
}
export const sessionHandlers = createSessionHandlers({ enabled: () => process.env.STUNNA_ENABLED === 'true', principal: requireTrainingPrincipal, service: trainingService })
