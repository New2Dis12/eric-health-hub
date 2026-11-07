import 'server-only'
import { z } from 'zod'
import { ApiError, apiError, privateJson } from '../private-api'
import { readCommand } from './http'
import { requireTrainingPrincipal, type TrainingPrincipal, type TrainingScope } from './auth'
import { trainingService, type createTrainingService } from './service'
const page = z.strictObject({ session: z.uuid(), history: z.enum(['true','false']).default('false'),
  limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).max(10000).default(0) })
export function createLoggingHandlers(deps:{enabled:()=>boolean; principal:(r:Request,s:TrainingScope)=>Promise<TrainingPrincipal>;service:()=>ReturnType<typeof createTrainingService>}) {
  return {
    async GET(request:Request) {
      try {
        if (!deps.enabled()) throw new ApiError(404,'Not found')
        const principal=await deps.principal(request,'training.read')
        const p=page.safeParse(Object.fromEntries(new URL(request.url).searchParams))
        if (!p.success) throw new ApiError(400,'Invalid result page')
        return privateJson(await deps.service().results(principal,p.data.session,p.data.history==='true',p.data.limit,p.data.offset))
      } catch(e) {return apiError(e)}
    },
    async POST(request:Request) {
      try {
        if (!deps.enabled()) throw new ApiError(404,'Not found')
        const principal=await deps.principal(request,'training.write'), input=await readCommand(request)
        if (!input || typeof input!=='object' || !('operation' in input) || input.operation!=='log_workout') throw new ApiError(400,'Expected workout logging command')
        return privateJson(await deps.service().write(principal,input))
      } catch(e) {return apiError(e)}
    },
  }
}
export const loggingHandlers=createLoggingHandlers({enabled:()=>process.env.STUNNA_ENABLED==='true',principal:requireTrainingPrincipal,service:trainingService})
