
import 'server-only'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { ApiError } from '@/lib/private-api'
import { mcpResourceMetadataUrl } from '@/lib/mcp-resource'
import { getOuraTestResultFromStore } from '@/lib/oura-data'
import { getGarminActivities, getGarminActivityFit } from '@/lib/garmin'
import { getTrainingContext } from '@/lib/training/context'
import { createTrainingHistoryReader, historyFields } from '@/lib/training/history'
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

export function createEricHealthMcpSe¶»§q«^