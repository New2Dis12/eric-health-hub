import 'server-only'
import { z } from 'zod'
import { ApiError, apiError, privateJson } from '../private-api'
import { assertSourceAccess } from './source-evidence'
import { assertTrainingAccess, requireTrainingPrincipal, type TrainingPrincipal, type TrainingScope } from './auth'
import { readCommand } from './http'
import { trainingService, type createTrainingService } from './service'
const page=z.strictObject({session:z.uuid()})
export function createSourceHandlers(deps:{enabled:()=>boolean;principal:(r:Request,s:TrainingScope)=>Promise<TrainingPrincipal>;service:()=>ReturnType<typeof createTrainingService>}) {
  return {
    async GET(request:Request) {
      try {
        if (!deps.enabled()) throw new ApiError(404,'Not found')
        const principal=await deps.principal(request,'training.read')
        assertSourceAccess(principal,'training.read')
        const p=page.safeParse(Object.fromEntries(new URL(request.url).searchParams))
        if (!p.success) throw new ApiError(400,'Invalid source request')
        return privateJson(await deps.service().sources.candidates(principal,p.data.session))
      } catch(e) {return apiError(e)}
    },
    async POST(request:Request) {
      try {
        if (!deps.enabled()) throw new ApiError(404,'Not found')
        const principal=await deps.principal(request,'training.write')
        assertSourceAccess(principal,'training.write')
        assertTrainingAccess(principal,'training.read')
        return privateJson(await deps.service().sources.link(principal,await readCommand(request)))
      } catch(e) {return apiError(e)}
    },
  }
}
export const sourceHandlers=createSourceHandlers({enabled:()=>process.env.STUNNA_ENABLED==='true',principal:requireTrainingPrincipal,service:trainingService})
