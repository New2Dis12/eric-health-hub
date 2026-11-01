
import 'server-only'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getOuraTestResultFromStore } from '@/lib/oura-data'
import { getGarminActivities } from '@/lib/garmin'

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

export function createEricHealthMcpServer(canReadGarmin = false) {
  const server = new McpServer({ name: 'eric-health-hub', version: '0.1.0' })

  server.registerTool(
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
        description: 'Retrieve recent Garmin workouts.',
        inputSchema: {
          limit: z.number().int().min(1).max(50).default(20),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ limit }) => {
        try {
          const activities = await getGarminActivities(limit)
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(activities),
              },
            ],
          }
        } catch (error) {
          console.error('Garmin activity retrieval failed', error)
          return errorResult('Unable to retrieve Garmin activities.')
        }
      },
    )
  }

  return server
}
