import { z } from 'zod'

// Provider-independent storage/readback envelope. Only Garmin ingestion is implemented.
export type SourceMeasurement = { field: string; value: number | null; unit: string; nativeField: string; nativeUnit: string }
export type RecordingOrigin = 'garmin_device' | 'peloton_import' | 'unknown'
export type SourceEvidence = {
  version: 1; provider: string; sourceId: string; format: string; retrievedAt: string; contentSha256: string
  recording?: { origin: RecordingOrigin; fitManufacturer: string | number | null; listManufacturer: string | number | null }
  startField?: 'session.startTime' | 'record.timestamp' | null
  modality: string | null; startUtc: string | null; endUtc: string | null
  summary: SourceMeasurement[]
  laps: { index: number; startUtc: string | null; endUtc: string | null; metrics: SourceMeasurement[] }[]
  sensors: { columns: string[]; units: string[]; nativeFields?: string[]; nativeUnits?: string[]
    sampleFields?: { speed: string | null; cadence: string | null }[]; samples: (string | number | null)[][] }
  coverage: { records: number; nativeLaps: number; samplesTruncated: boolean; lapsTruncated: boolean; sampleIntervalSeconds: number; warnings: string[] }
  match: { method: 'confirmed'; actor: string; confirmedActivityId: string; pairedWithEvidenceId?: string }
}
export type SavedSourceEvidence = { id: string; revision: number; evidence: SourceEvidence; recordedAt: string }
export type ReconciledMetric = SourceMeasurement & {
  sourceId: string; evidenceId: string; kind: 'native' | 'calculated'; conflict: boolean
  formula?: string
}
export type ReconciledWorkout = {
  summary: ReconciledMetric[]
  nativeLapSourceId: string | null
  intervals: { lapIndex: number; startUtc: string; endUtc: string; samples: {
    field: string; unit: string; sourceId: string; count: number; selectedSampleMean: number
  }[] }[]
  limitations: string[]
}
export type SourceResult = { status: 'matched' | 'unavailable'; evidence: SavedSourceEvidence[]; reconciled?: ReconciledWorkout }
export const sourceLinkInput = z.strictObject({
  sessionId: z.uuid(), activityId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  expectedSessionRevision: z.number().int().min(1).max(2147483646),
  expectedEvidenceRevision: z.number().int().min(0).max(2147483646),
  pairedWithEvidenceId: z.uuid().optional(),
  confirmed: z.literal(true), idempotencyKey: z.uuid(), reason: z.string().trim().min(1).max(500),
})
export const sourceLinkReceipt = z.strictObject({evidenceId:z.uuid(),evidenceRevision:z.number().int().min(1).max(2147483647),actualSessionId:z.uuid()})
export type SourceLinkInput = z.infer<typeof sourceLinkInput>
export type GarminCandidate = { activityId: number; name: string; modality: string | null; startUtc: string | null; durationSeconds: number | null; distanceMeters: number | null; compatible: boolean; linked: boolean; origin?: RecordingOrigin; manufacturer?: string | number | null; evidenceRevision?: number; linkedElsewhere?: boolean }
export type CandidateResult = { status: 'matched' | 'needs_confirmation' | 'unavailable'; candidates: GarminCandidate[]; reason: string; sessionRevision: number; evidenceRevision: number; verifiedPairs?: number[][]; suggestedPair?: number[]; pairAnchor?: { evidenceId: string; sourceId: string } }
