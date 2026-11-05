import 'server-only'
import { z } from 'zod'
import { apiError, ApiError, privateJson } from '../private-api'
import { requireTrainingPrincipal, type TrainingPrincipal, type TrainingScope } from './auth'
import { trainingService, type createTrainingService } from './service'

const pageSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
})

export async function readCommand(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new ApiError(415, 'Expected application/json')
  const max = 16 * 1024
  if (Number(request.headers.get('content-length')) > max) throw new ApiError(413, 'Request too large')
  if (!request.body) throw new ApiError(400, 'Missing request body')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > max) throw new ApiError(413, 'Request too large')
      chunks.push(value)
    }
  } finally { await reader.cancel(); reader.releaseLock() }
  try { return JSON.parse(Buffer.concat(chunks, size).toString('utf8')) }
  catch { throw new ApiError(400, 'Invalid JSON') }
}

type Dependencies = {
  principal: (request: Request, scope: TrainingScope) => Promise<TrainingPrincipal>
  service: () => ReturnType<typeof createTrainingService>
  enabled: () => boolean
}
export function createTrainingHandlers(deps: Dependencies) {
  return {
    async GET(request: Request) {
      try {
        if (!deps.enabled()) throw new ApiError(404, 'Not found')
        const principal = await deps.principal(request, 'training.read')
        const params = pageSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
        if (!params.success) throw new ApiError(400, 'Invalid pagination')
        const data = await deps.service().read(principal, params.data.limit, params.data.offset)
        return privateJson({ ...data, pagination: { ...params.data,
          nextOffset: Object.values(data).some(rows => rows.length === params.data.limit) && params.data.offset + params.data.limit <= 10000 ? params.data.offset + params.data.limit : null } })
      } catch (error) { return apiError(error) }
    },
    async POST(request: Request) {
      try {
        if (!deps.enabled()) throw new ApiError(404, 'Not found')
        const principal = await deps.principal(request, 'training.write')
        const input = await readCommand(request)
        return privateJson(await deps.service().write(principal, input))
      } catch (error) { return apiError(error) }
    },
  }
}
export const trainingHandlers = createTrainingHandlers({ principal: requireTrainingPrincipal, service: trainingService, enabled: () => process.env.STUNNA_ENABLED === 'true' })
