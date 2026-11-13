import 'server-only'
import { ApiError } from '../private-api'
import type { getGarminActivityFit } from '../garmin'
import type { SourceEvidence, SourceMeasurement, GarminCandidate } from './source-evidence-models'

export type GarminClient = { list: (limit: number) => Promise<unknown>; fit: (id: number) => ReturnType<typeof getGarminActivityFit> }
export function garminModality(sport: unknown): string | null {
  return typeof sport === 'string' ? ({ running:'run', treadmill_running:'run', track_running:'run', trail_running:'run',
    cycling:'bike', indoor_cycling:'bike', virtual_ride:'bike', rowing:'row', indoor_rowing:'row' } as Record<string,string>)[sport] ?? null : null
}
const finite = (v: unknown) => typeof v==='number' && Number.isFinite(v) && v>=0 ? v : null
const utc = (v: unknown) => typeof v==='string' && /(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null
// Garmin's startTimeGMT is explicitly UTC even when the API omits its suffix.
function garminUtc(v: unknown) { return typeof v==='string' ? utc(v.replace(' ','T') + (/(?:Z|[+-]\d\d:\d\d)$/.test(v)?'':'Z')) : null }
export function candidatesFrom(raw: unknown, modalities: string[], start: Date, end: Date, linked: Set<string>): GarminCandidate[] {
  if (!Array.isArray(raw) || raw.length>20) throw new Error('Invalid Garmin activity list')
  const seen = new Set<number>()
  return raw.flatMap((r: Record<string,unknown>) => {
    if (!r || !Number.isSafeInteger(r.activityId) || Number(r.activityId)<=0 || seen.has(Number(r.activityId))) return []
    seen.add(Number(r.activityId))
    const time=garminUtc(r.startTimeGMT)
    // Small same-day/nearby window only. Unknown UTC is shown for deliberate selection.
    if (time && (Date.parse(time)<start.getTime()-86400000 || Date.parse(time)>end.getTime()+86400000)) return []
    const modality=garminModality((r.activityType as {typeKey?:unknown})?.typeKey)
    return [{activityId:Number(r.activityId),name:typeof r.activityName==='string'?r.activityName.slice(0,120):'Garmin activity',
      modality,startUtc:time,durationSeconds:finite(r.duration),distanceMeters:finite(r.distance),
      compatible:modality!==null && modalities.includes(modality),linked:linked.has(String(r.activityId))}]
  }).sort((a,b)=>Number(b.compatible)-Number(a.compatible) || (a.startUtc??'').localeCompare(b.startUtc??'')).slice(0,8)
}
const fields: [string,string,string,string?][] = [
  ['elapsedSeconds','s','totalElapsedTime'],['timerSeconds','s','totalTimerTime'],['distanceMeters','m','totalDistance'],
  ['avgHeartRateBpm','bpm','avgHeartRate'],['maxHeartRateBpm','bpm','maxHeartRate'],
  ['avgSpeedMetersPerSecond','m/s','enhancedAvgSpeed/avgSpeed'],['maxSpeedMetersPerSecond','m/s','enhancedMaxSpeed/maxSpeed'],
  ['avgCadenceCyclesPerMinute','cycles/min','avgCadence+avgFractionalCadence'],['maxCadenceCyclesPerMinute','cycles/min','maxCadence+maxFractionalCadence'],
  ['avgPowerWatts','W','avgPower'],['maxPowerWatts','W','maxPower'],['avgGroundContactTimeMs','ms','avgStanceTime'],
  ['avgVerticalOscillationCm','cm','avgVerticalOscillation','mm'],['avgGroundContactTimeBalancePercent','%','avgStanceTimeBalance'],
  ['avgVerticalRatioPercent','%','avgVerticalRatio'],['avgStepLengthCm','cm','avgStepLength','mm'],['avgGroundContactTimePercent','%','avgStanceTimePercent'],
]
function metrics(row: Record<string,unknown>): SourceMeasurement[] {
  return fields.map(([field,unit,nativeField,nativeUnit])=>({field,value:finite(row[field]),unit,nativeField,nativeUnit:nativeUnit??unit}))
}
export function normalizeGarminFit(fit: Awaited<ReturnType<typeof getGarminActivityFit>>, id: number, actor: string, retrievedAt: Date): SourceEvidence {
  if (!fit.available || fit.activityId!==id) throw new ApiError(422,'Verified Garmin FIT unavailable')
  const summary=fit.nativeSummary
  // No inferred summary from samples, lap sums, prescriptions or activity-list estimates.
  const columns=fit.columns.filter(c=>!['paceSecondsPerKm','elapsedSeconds'].includes(c))
  const units=['UTC','s','bpm','m/s','cycles/min','W','m','sec/km','ms','cm','%','%','cm','%']
  const indices=columns.map(c=>fit.columns.indexOf(c))
  const evidence: SourceEvidence = {
    version:1,provider:'garmin',sourceId:String(id),format:'FIT',retrievedAt:retrievedAt.toISOString(),contentSha256:fit.contentSha256,
    modality:garminModality(summary?.sport),startUtc:summary?.startTimestampUtc??fit.startTimestamp,
    endUtc:summary?.endTimestampUtc??null,summary:summary?metrics(summary):[],
    laps:fit.laps.map(l=>({index:l.lapIndex,startUtc:l.startTimestampUtc,endUtc:l.endTimestampUtc,metrics:metrics(l)})),
    sensors:{columns,units:indices.map(i=>units[i]),samples:fit.samples.map(row=>indices.map(i=>row[i]))},
    coverage:{records:fit.fitRecordCount,nativeLaps:fit.fitLapCount,samplesTruncated:fit.truncated,lapsTruncated:fit.lapsTruncated,
      sampleIntervalSeconds:fit.sampleIntervalSeconds,warnings:[
        'Native FIT values only; missing measurements are null. Samples are selected, never averaged. No prescription interval mapping.',
        'FIT cadence is cycles/minute, including running strides/minute. Device speed is not verified treadmill belt speed or incline.',
        ...(fit.fitSessionCount!==1?['No single native session summary; modality and summary remain unknown.']:[]),
      ]},
    match:{method:'confirmed',actor,confirmedActivityId:String(id)},
  }
  if (Buffer.byteLength(JSON.stringify(evidence))>64000) throw new ApiError(422,'FIT evidence exceeds storage limit')
  return evidence
}
