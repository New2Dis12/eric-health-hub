
import 'server-only'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getOuraTestResultFromStore } from '@/lib/oura-data'
import { getGarminActivities, getGarminActivityFit } from '@/lib/garmin'
import { getTrainingContext } from '@/lib/training/context'
import { contextDate } from '@/lib/training/context-models'
import type { TrainingPrincipal } from '@/lib/training/auth'

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
