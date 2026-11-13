
import 'server-only'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { ApiError } from '@/lib/private-api'
import { getOuraTestResultFromStore } from '@/lib/oura-data'
import { getGarminActivities, getGarminActivityFit } from '@/lib/garmin'
import { getTrainingContext } from '@/lib/training/context'
import { contextDate } from '@/lib/training/context-models'
import type { TrainingPrincipal } from '@/lib/training/auth'
import { actualsPage, actualsWrite, createMcpTrainingActuals } from '@/lib/training/mcp-actuals'
import { weeklyIntentFields, approvedWorkoutFields } from '@/lib/training/models'
import { trainingService } from '@/lib/training/service'
import { sourceLinkInput } from '@/lib/training/source-evidence-models'
import { createMcpTrainingPublisher } from '@/lib/training/mcp-publishing'

const measurementSchema = z.object({
  value: z.number().nullable(),
  date: z.string().nullable(),
})

const summarySchema = {
  readinessScore: measurementSchema,
  sleepScore: measurementSchema,
  activityScore: measurementSchema,
  restingHeartRate: measurementSchema.extend({ unit: z.literal('bpm') }),
  retrievedAt: z.string(),
}

function errorResult(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: message }] }
}

export function createEricHealthMcpServer(canReadGarmin = false, options: {
  canReadOura?: boolean
  trainingPrincipal?: TrainingPrincipal
  actualsAdapter?: ReturnType<typeof createMcpTrainingActuals>
  publishingAdapter?: ReturnType<typeof createMcpTrainingPublisher>
} = {}) {
  const server = new McpServer({ name: 'eric-health-hub', version: '0.1.0' })

  if (options.canReadOura !== false) server.registerTool(
    'get_oura_summary',
    {
      title: 'Get Oura summary',
      description:
        "Returns Eric's latest Oura readiness score, sleep score, activity score, and resting heart rate, with the date of each measurement.",
      inputSchema: {},
      outputSchema: summarySchema,
      annotations: {
        title: 'Get Oura summary',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      const result = await getOuraTestResultFromStore()

      if (result.status === 'not_connected') {
        return errorResult('Oura is not connected. Connect Oura from the Eric Health Hub homepage first.')
      }
      if (result.status === 'unauthorized') {
        return errorResult('Oura authorization has expired or was revoked. Reconnect Oura from the Eric Health Hub homepage.')
      }
      if (result.status === 'error') return errorResult(result.message)

      const { sample } = result
      const summary = {
        readinessScore: { value: sample.readinessScore, date: sample.readinessDay },
        sleepScore: { value: sample.sleepScore, date: sample.sleepDay },
        activityScore: { value: sample.activityScore, date: sample.activityDay },
        restingHeartRate: { value: sample.restingHeartRate, date: sample.restingHeartRateDay, unit: 'bpm' as const },
        retrievedAt: result.checkedAt,
      }

      return {
        structuredContent: summary,
        content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }],
      }
    },
  )

  // Garmin is disabled until MCP authentication is configured.
  if (process.env.GARMIN_MCP_ENABLED === 'true' && canReadGarmin) {
    server.registerTool(
      'get_garmin_activities',
      {
        title: 'Get Garmin activities',
        description: 'List recent Garmin workouts, or supply an activityId from the list to download and decode original FIT telemetry on demand. Returns timestamp, heart rate, speed, pace, cadence, power, distance, running dynamics and native FIT laps when recorded. Sample and lap pages are independently bounded; use nextStartSeconds and nextLapStartIndex to continue.',
        inputSchema: {
          limit: z.number().int().min(1).max(50).default(20),
          activityId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional()
            .describe('When supplied, retrieve FIT telemetry for this activity instead of listing workouts.'),
          everySeconds: z.number().int().min(1).max(300).default(1)
            .describe('Minimum seconds between returned FIT samples; does not average records.'),
          maxSamples: z.number().int().min(1).max(2000).default(1000),
          startSeconds: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0)
            .describe('Return samples at or after this elapsed time, for pagination.'),
          lapStartIndex: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0)
            .describe('Zero-based FIT lap offset; use nextLapStartIndex for the next independent lap page.'),
          maxLaps: z.number().int().min(1).max(100).default(100)
            .describe('Maximum native FIT laps per response; independent of sample time and sampling interval.'),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ limit, activityId, everySeconds, maxSamples, startSeconds, lapStartIndex, maxLaps }) => {
        try {
          const activities = activityId === undefined
            ? await getGarminActivities(limit)
            : await getGarminActivityFit(activityId, everySeconds, maxSamples, startSeconds, lapStartIndex, maxLaps)
          const text = JSON.stringify(activities)
          if (Buffer.byteLength(text, 'utf8') > 512 * 1024) {
            return errorResult('Garmin response is too large. Reduce limit, maxSamples or maxLaps.')
          }
          return {
            content: [
              {
                type: 'text' as const,
                text,
              },
            ],
          }
        } catch {
          // Do not expose upstream responses, credentials, or health data in logs.
          return errorResult('Unable to retrieve Garmin data. The activity may be unavailable, the file invalid or too large, or Garmin temporarily unreachable.')
        }
      },
    )
  }

  const principal = options.trainingPrincipal
  if (process.env.STUNNA_ENABLED === 'true' && process.env.GARMIN_MCP_ENABLED === 'true' && principal?.healthScopes?.includes('garmin.read')) {
    if (principal.scopes.includes('training.read')) server.registerTool('get_workout_garmin_candidates', {
      title:'Find Garmin activity for a completed workout',
      description:'Read up to eight recent candidate IDs for an athlete-owned completed pinned workout. All matches require explicit owner selection/confirmation; dates and modalities are hints. No background polling.',
      inputSchema:{sessionId:z.uuid()},
      annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true},
    },async ({sessionId})=>{
      try {
        const result=await trainingService().sources.candidates(principal,sessionId)
        return {structuredContent:result,content:[{type:'text' as const,text:JSON.stringify(result)}]}
      } catch {return errorResult('Garmin candidates unavailable or access denied.')}
    })
    if (principal.scopes.includes('training.read') && principal.scopes.includes('training.write')) server.registerTool('confirm_workout_garmin_activity', {
      title:'Confirm Garmin evidence for a completed workout',
      description:'Only after the owner explicitly selects/confirms this exact candidate activity ID for this completed session. Fetch and store bounded native FIT evidence; no client-supplied metrics. Requires Garmin read plus training read/write, exact revisions, reason and stable idempotency key. Refresh appends history for the same activity. Replacement/relink is rejected. Never infer missing measurements or claim confirmation without owner consent.',
      inputSchema:sourceLinkInput.shape,
      annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:true},
    },async input=>{
      try {
        const result=await trainingService().sources.link(principal,input)
        return {structuredContent:result,content:[{type:'text' as const,text:JSON.stringify(result)}]}
      } catch(e) {
        if(e instanceof ApiError && e.status===409) return {...errorResult('Activity, revision or idempotency conflict. Re-read saved results before retrying.'),structuredContent:{errorCode:'REVISION_CONFLICT'}}
        return errorResult('Garmin evidence rejected or unavailable. Check explicit confirmation, permissions and saved session.')
      }
    })
  }
  if (process.env.STUNNA_ENABLED === 'true' && principal) {
    const actuals = options.actualsAdapter ?? createMcpTrainingActuals()
    if (principal.scopes.includes('training.read')) server.registerTool('get_saved_workout_results', {
      title: 'Read saved workout actuals and history',
      description: 'Read bounded saved workout results by actual session UUID or planned workout UUID from the training calendar, optionally including chronological corrections and notes. Supply exactly one identifier. Values and nulls are authoritative.',
      inputSchema: actualsPage.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async input => {
      try {
        const result = await actuals.read(principal, input)
        const data = JSON.stringify(result)
        if (Buffer.byteLength(data, 'utf8') > 128 * 1024) return errorResult('Response too large; reduce page size.')
        return { structuredContent: result, content: [{ type: 'text' as const, text: data }] }
      } catch { return errorResult('Saved workout results unavailable or access denied.') }
    })
    if (principal.scopes.includes('training.write')) {
      const publisher = options.publishingAdapter ?? createMcpTrainingPublisher()
      server.registerTool('save_weekly_training_intent', {
        title: 'Save approved high-level training week',
        description: 'After the owner approves the high-level weekly focus and intended workout dates/types, save date-only non-executable placeholders. Do not invent times or detailed exercises for the week. This is a write; confirm the proposal with the owner first.',
        inputSchema: weeklyIntentFields.shape,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      }, async input => {
        try {
          const result = await publisher.week(principal, input)
          return { structuredContent: result, content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
        } catch (error) {
          if (error instanceof ApiError && error.status === 409)
            return { ...errorResult('Weekly intent conflict. Re-read before retrying.'), structuredContent: { errorCode: 'REVISION_CONFLICT' } }
          return errorResult('Weekly intent rejected. Check scope, dates and ownership.')
        }
      })
      server.registerTool('publish_approved_workout', {
        title: 'Publish an explicitly owner-approved detailed workout',
        description: 'ONLY call AFTER showing the owner the COMPLETE proposed ordered detailed prescription (exercises, intervals, units, targets, rest, RPE, adjustments) and receiving explicit approval of THAT exact proposal in this conversation. Never auto-publish a suggestion. Include the approval note, source provenance, reason, expected current revision and stable idempotency key. Server audit records the caller assertion; it cannot independently prove conversational consent. Re-read the latest approved revision on conflict.',
        inputSchema: approvedWorkoutFields.shape,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      }, async input => {
        try {
          const result = await publisher.publish(principal, input)
          return { structuredContent: result, content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
        } catch (error) {
          if (error instanceof ApiError && error.status === 409)
            return { ...errorResult('Prescription revision or idempotency conflict. Re-read before retrying.'), structuredContent: { errorCode: 'REVISION_CONFLICT' } }
          return errorResult('Approved workout publication rejected. Check scope, plan and validated prescription.')
        }
      })
    }
    if (principal.scopes.includes('training.write')) server.registerTool('correct_saved_strength_result', {
      title: 'Save or correct strength results and notes',
      description: 'Write one validated strength set or exercise/workout note for an owned in-progress session. Requires exact revisions and a stable idempotency key; conflicting edits must be re-read.',
      inputSchema: actualsWrite.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async input => {
      try {
        const result = await actuals.write(principal, input)
        return { structuredContent: result, content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          return { ...errorResult('Workout revision or idempotency conflict. Re-read current results before retrying.'), structuredContent: { errorCode: 'REVISION_CONFLICT' } }
        }
        return errorResult('Workout write rejected. Check access and session state before retrying.')
      }
    })
  }
  if (process.env.STUNNA_ENABLED === 'true' && principal?.scopes.includes('training.read')) {
    server.registerTool('get_training_context', {
      title: 'Get training context',
      description: 'Read the saved approved training prescription and calendar for a date. Defaults to today in the athlete’s training time zone. Missing targets or previous performance remain null.',
      inputSchema: { date: contextDate.optional().describe('Training date in YYYY-MM-DD format') },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async input => {
      try {
        const context = await getTrainingContext(principal, input)
        return { structuredContent: context, content: [{ type: 'text' as const, text: JSON.stringify(context) }] }
      } catch {
        return errorResult('The saved training plan could not be loaded.')
      }
    })
  }

  return server
}
