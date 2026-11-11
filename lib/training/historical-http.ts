import 'server-only'
import { ApiError, apiError, privateJson } from '../private-api'
import { requireTrainingPrincipal, type TrainingPrincipal } from './auth'
import { historicalPage } from './historical-models'
import { trainingService, type createTrainingService } from './service'

type Deps = {
  enabled:()=>boolean
  principal:(request:Request,scope:'training.read')=>Promise<TrainingPrincipal>
  service:()=>ReturnType<typeof createTrainingService>
}
export function createHistoricalHandlers(deps:Deps) {
  return {async GET(request:Request) {
    try {
      if (!deps.enabled()) throw new ApiError(404,'Not found')
      const principal=await deps.principal(request,'training.read')
      const params=Object.fromEntries(new URL(request.url).searchParams)
      if (params.revisions!==undefined && !['true','false'].includes(params.revisions))
        throw new ApiError(400,'Invalid revision flag')
      const parsed=historicalPage.safeParse({
        sessionId:params.sessionId,date:params.date,
        revisions:params.revisions===undefined?false:params.revisions==='true',
        limit:params.limit===undefined?25:Number(params.limit),
        offset:params.offset===undefined?0:Number(params.offset),
      })
      if (!parsed.success) throw new ApiError(400,'Invalid historical page')
      const data=await deps.service().history(principal,parsed.data)
      if (Buffer.byteLength(JSON.stringify(data),'utf8')>128*1024) throw new ApiError(413,'Reduce history page size')
      return privateJson(data)
    } catch(e) {return apiError(e)}
  }}
}
export const historicalHandlers=createHistoricalHandlers({
  enabled:()=>process.env.STUNNA_ENABLED==='true',
  principal:requireTrainingPrincipal,
  service:trainingService,
})
