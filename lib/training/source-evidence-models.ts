import { z } from 'zod'

// Provider-independent storage/readback envelope. Only Garmin ingestion is implemented.
export type SourceMeasurement = { field: string; value: number | null; unit: string; nativeField: string; nativeUnit: string }
export type SourceEvidence = {
  version: 1; provider: string; sourceId: string; format: string; retrievedAt: string; contentSha256: string
  modality: string | null; startUtc: string | null; endUtc: string | null
  summary: SourceMeasurement[]
  laps: { index: number; startUtc: string | null; endUtc: string | null; metrics: SourceMeasurement[] }[]
  sensors: { columns: string[]; units: string[]; samples: (string | number | null)[][] }
  coverage: { records: number; nativeLaps: number; samplesTruncated: boolean; lapsTruncated: boolean; sampleIntervalSeconds: number; warnings: string[] }
  match: { method: 'confirmed'; actor: string; confirmedActivityId: string }
}
export type SavedSourceEvidence = { id: string; revision: number; evidence: SourceEvidence; recordedAt: string }
export type SourceResult = { status: 'matched' | 'unavailable'; evidence: SavedSourceEvidence[] }
export const sourceLinkInput = z.strictObject({
  sessionId: z.uuid(), activityId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  expectedSessionRevision: z.number().int().min(1).max(2147483646),
  expectedEvidenceRevision: z.number().int().min(0).max(2147483646),
  confirmed: z.literal(true), idempotencyKey: z.uuid(), reason: z.string().trim().min(1).max(500),
})
export type SourceLinkInput = z.infer<typeof sourceLinkInput>
export type GarminCandidate = { activityId: number; name: string; modality: string | null; startUtc: string | null; durationSeconds: number | null; distanceMeters: number | null; compatible: boolean; linked: boolean }
export type CandidateResult = { status: 'matched' | 'needs_confirmation' | 'unavailable'; candidates: GarminCandidate[]; reason: string; sessionRevision: number; evidenceRevision: number }
