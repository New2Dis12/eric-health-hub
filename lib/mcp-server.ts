import 'server-only'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getOuraTestResultFromStore } from '@/lib/oura-data'

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

export function createEricHealthMcpServer() {
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

  return server
}
