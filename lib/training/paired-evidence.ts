import type { ReconciledMetric, ReconciledWorkout, SavedSourceEvidence, SourceEvidence } from './source-evidence-models'

function timestamp(value: string | null) {
  return value && /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN
}

// A second attachment is an explicit confirmation of two identities. In addition,
// require complementary origins and substantial coverage of the same event.
export function compatiblePair(first: SourceEvidence, second: SourceEvidence, session: {started_at: Date; completed_at: Date}, modalities: string[]) {
  const origins = new Set([first.recording?.origin, second.recording?.origin])
  if (first.contentSha256===second.contentSha256 || first.startField!=='session.startTime' || second.startField!=='session.startTime') return false
  if (!origins.has('garmin_device') || !origins.has('peloton_import') ||
      !first.modality || first.modality !== second.modality || !modalities.includes(first.modality)) return false
  const starts = [timestamp(first.startUtc), timestamp(second.startUtc)]
  const ends = [timestamp(first.endUtc), timestamp(second.endUtc)]
  for (const [index,source] of [first,second].entries()) {
    const elapsed=source.summary.find(metric=>metric.field==='elapsedSeconds')?.value
    const span=ends[index]-starts[index]
    if (elapsed!=null && Math.abs(elapsed*1000-span)>Math.max(1000,0.1*span)) return false
  }
  const overlapStart = Math.max(...starts), overlapEnd = Math.min(...ends)
  const longest = Math.max(ends[0]-starts[0], ends[1]-starts[1])
  // Allow a small start/stop delay. Never shift a clock, extrapolate, or join by date.
  return longest > 0 && overlapEnd-overlapStart >= 0.9*longest &&
    Math.min(overlapEnd, new Date(session.completed_at).getTime()) -
    Math.max(overlapStart, new Date(session.started_at).getTime()) >= 0.9*longest
}

function preferPeloton(field: string, modality: string | null) {
  if (field === 'distanceMeters') return true
  if (modality === 'run') return /speed/i.test(field)
  if (modality === 'bike') return /power|cadence/i.test(field)
  return modality === 'row' && /speed|cadence/i.test(field)
}

function intervalSamples(source: SourceEvidence, start: number, end: number, field: string) {
  const {columns, units, samples} = source.sensors
  const timeColumn = columns.indexOf('timestampUtc'), column = columns.indexOf(field)
  let sum = 0, count = 0
  for (const row of samples) {
    const time = row[timeColumn], value = row[column]
    if (typeof time !== 'string' || typeof value !== 'number' || !Number.isFinite(value)) continue
    const instant = timestamp(time)
    if (instant >= start && instant < end) { sum += value; count++ }
  }
  return count ? {field, unit: units[column], sourceId: source.sourceId, count, selectedSampleMean: sum/count} : null
}

export function reconcilePair(sources: SavedSourceEvidence[]): ReconciledWorkout | undefined {
  if (sources.length !== 2) return
  const garmin = sources.find(source => source.evidence.recording?.origin === 'garmin_device')
  const peloton = sources.find(source => source.evidence.recording?.origin === 'peloton_import')
  if (!garmin || !peloton || !garmin.evidence.modality || garmin.evidence.modality !== peloton.evidence.modality) return
  const modality = garmin.evidence.modality
  const ordered = (field: string) => preferPeloton(field, modality) ? [peloton, garmin] : [garmin, peloton]
  const summary: ReconciledMetric[] = []
  const fields = new Set(sources.flatMap(source => source.evidence.summary.map(item => item.field)))
  for (const field of fields) {
    const choices = ordered(field).flatMap(source => {
      const metric = source.evidence.summary.find(item => item.field === field && item.value !== null)
      return metric ? [{source, metric}] : []
    })
    const first = choices[0]
    if (!first) continue
    // For a confirmed machine pair, the watch distance remains comparison evidence only.
    if (field === 'distanceMeters' && (first.source !== peloton || first.metric.unit !== 'm' ||
        !Number.isFinite(first.metric.value) || first.metric.value! < 0)) continue
    summary.push({...first.metric, sourceId: first.source.evidence.sourceId, evidenceId: first.source.id, kind: 'native',
      conflict: choices.some(({metric}) => metric.unit !== first.metric.unit || metric.value !== first.metric.value)})
  }
  if (modality === 'row') {
    const speed = summary.find(item => item.field === 'avgSpeedMetersPerSecond')
    if (speed?.value && speed.value > 0) summary.push({...speed, field:'avgSplitSecondsPer500m', value:500/speed.value,
      unit:'s/500m', kind:'calculated', formula:'500 m / native average speed (m/s)'})
    const cadence = summary.find(item => item.field === 'avgCadenceCyclesPerMinute')
    if (cadence) summary.push({...cadence, field:'avgStrokeRate', unit:'strokes/min', kind:'calculated',
      formula:'One stroke per recorded rowing cadence cycle'})
  }

  const lapSource = garmin.evidence.laps.length ? garmin.evidence : peloton.evidence
  const intervals: ReconciledWorkout['intervals'] = []
  const commonStart = Math.max(...sources.map(s => timestamp(s.evidence.startUtc)))
  const commonEnd = Math.min(...sources.map(s => timestamp(s.evidence.endUtc)))
  for (const lap of lapSource.laps) {
    if (!lap.startUtc || !lap.endUtc) continue
    const start = Math.max(commonStart, timestamp(lap.startUtc)), end = Math.min(commonEnd, timestamp(lap.endUtc))
    if (!(start < end)) continue
    const samples = ['heartRateBpm','speedMetersPerSecond','powerWatts','cadenceCyclesPerMinute'].flatMap(field => {
      for (const source of ordered(field)) {
        const values = intervalSamples(source.evidence,start,end,field)
        if (values) return [values]
      }
      return []
    })
    intervals.push({lapIndex:lap.index, startUtc:new Date(start).toISOString(), endUtc:new Date(end).toISOString(), samples})
  }
  return {summary, nativeLapSourceId:lapSource.laps.length ? lapSource.sourceId : null, intervals,
    limitations:['Native workout totals are selected once per metric. Both source measurements remain in evidence.',
      'Interval means use only available selected samples in the shared UTC window of each native lap. Sparse or truncated samples cannot establish exact work-interval statistics.']}
}
