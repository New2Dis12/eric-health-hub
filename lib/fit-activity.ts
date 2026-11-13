import 'server-only'
import { createHash } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import { Decoder, Stream } from '@garmin/fitsdk'

const MAX_FIT_BYTES = 16 * 1024 * 1024
const MAX_MESSAGES = 200_000
// Leave at least 32 KiB for columns, metadata and the activity ID under the
// existing 512 KiB MCP cap. Both budgets include array separators.
const MAX_SAMPLE_JSON_BYTES = 384 * 1024
const MAX_LAP_JSON_BYTES = 96 * 1024

type FitRecord = Record<string, unknown>
type NumericSample = [
  string, number, number | null, number | null, number | null,
  number | null, number | null, number | null,
  number | null, number | null, number | null,
  number | null, number | null, number | null,
]

function safeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function timestampMs(value: unknown): number | null {
  const time = value instanceof Date ? value.getTime()
    : typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(time) ? time : null
}

function isoTimestamp(value: unknown): string | null {
  const time = timestampMs(value)
  return time === null ? null : new Date(time).toISOString()
}

function cadence(value: unknown, fractional: unknown): number | null {
  const whole = safeNumber(value)
  return whole === null ? null : whole + (safeNumber(fractional) ?? 0)
}

function pace(speed: number | null): number | null {
  return speed !== null && speed > 0 ? Math.round(1000 / speed) : null
}

function millimetersToCm(value: unknown): number | null {
  const millimeters = safeNumber(value)
  // FIT scale is already applied by the SDK. Round only conversion noise;
  // these native fields have 0.1 mm resolution (0.01 cm).
  return millimeters === null ? null : Math.round(millimeters * 10) / 100
}

function nativeLap(lap: FitRecord, index: number) {
  const avgSpeed = safeNumber(lap.enhancedAvgSpeed) ?? safeNumber(lap.avgSpeed)
  const maxSpeed = safeNumber(lap.enhancedMaxSpeed) ?? safeNumber(lap.maxSpeed)
  return {
    // Keep file order and the native message index separately. Neither implies
    // a distance-based split, and multisport files can reset messageIndex.
    lapIndex: index,
    messageIndex: safeNumber(lap.messageIndex),
    startTimestampUtc: isoTimestamp(lap.startTime),
    endTimestampUtc: isoTimestamp(lap.timestamp),
    elapsedSeconds: safeNumber(lap.totalElapsedTime),
    timerSeconds: safeNumber(lap.totalTimerTime),
    distanceMeters: safeNumber(lap.totalDistance),
    avgHeartRateBpm: safeNumber(lap.avgHeartRate),
    maxHeartRateBpm: safeNumber(lap.maxHeartRate),
    avgSpeedMetersPerSecond: avgSpeed,
    maxSpeedMetersPerSecond: maxSpeed,
    avgPaceSecondsPerKm: pace(avgSpeed),
    bestPaceSecondsPerKm: pace(maxSpeed),
    avgCadenceCyclesPerMinute: cadence(lap.avgCadence, lap.avgFractionalCadence),
    maxCadenceCyclesPerMinute: cadence(lap.maxCadence, lap.maxFractionalCadence),
    avgPowerWatts: safeNumber(lap.avgPower),
    maxPowerWatts: safeNumber(lap.maxPower),
    avgGroundContactTimeMs: safeNumber(lap.avgStanceTime),
    avgVerticalOscillationCm: millimetersToCm(lap.avgVerticalOscillation),
    avgGroundContactTimeBalancePercent: safeNumber(lap.avgStanceTimeBalance),
    avgVerticalRatioPercent: safeNumber(lap.avgVerticalRatio),
    avgStepLengthCm: millimetersToCm(lap.avgStepLength),
    avgGroundContactTimePercent: safeNumber(lap.avgStanceTimePercent),
  }
}

function lapPage(laps: FitRecord[], startIndex: number, maxLaps: number) {
  const page: ReturnType<typeof nativeLap>[] = []
  let bytes = 2
  let index = startIndex
  for (; index < laps.length; index++) {
    const lap = nativeLap(laps[index], index)
    const size = Buffer.byteLength(JSON.stringify(lap), 'utf8') + 1
    if (page.length >= maxLaps || bytes + size > MAX_LAP_JSON_BYTES) break
    page.push(lap)
    bytes += size
  }
  return {
    fitLapCount: laps.length,
    lapStartIndex: startIndex,
    laps: page,
    lapsTruncated: index < laps.length,
    nextLapStartIndex: index < laps.length ? index : null,
  }
}

function extractFitFromZip(bytes: Buffer): Buffer | null {
  // The ZIP central directory gives reliable file sizes even if local
  // headers use data descriptors.
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error('Garmin returned an invalid ZIP archive')
  if (end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length ||
      bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0 ||
      bytes.readUInt16LE(end + 8) !== bytes.readUInt16LE(end + 10)) {
    throw new Error('Unsupported Garmin ZIP archive')
  }

  const count = bytes.readUInt16LE(end + 10)
  let position = bytes.readUInt32LE(end + 16)
  const directoryEnd = position + bytes.readUInt32LE(end + 12)
  if (directoryEnd !== end) throw new Error('Invalid Garmin ZIP directory size')
  if (count > 100) throw new Error('Garmin ZIP has too many files')

  for (let i = 0; i < count; i++) {
    if (position + 46 > directoryEnd || bytes.readUInt32LE(position) !== 0x02014b50) {
      throw new Error('Invalid Garmin ZIP directory')
    }
    const method = bytes.readUInt16LE(position + 10)
    const flags = bytes.readUInt16LE(position + 8)
    const diskNumber = bytes.readUInt16LE(position + 34)
    const compressedSize = bytes.readUInt32LE(position + 20)
    const uncompressedSize = bytes.readUInt32LE(position + 24)
    const nameSize = bytes.readUInt16LE(position + 28)
    const extraSize = bytes.readUInt16LE(position + 30)
    const commentSize = bytes.readUInt16LE(position + 32)
    const localOffset = bytes.readUInt32LE(position + 42)
    const nextPosition = position + 46 + nameSize + extraSize + commentSize
    if (nextPosition > directoryEnd) throw new Error('Invalid Garmin ZIP entry')
    const name = bytes.toString('utf8', position + 46, position + 46 + nameSize)
    position = nextPosition

    if (!name.toLowerCase().endsWith('.fit')) continue
    if ((flags & 1) || diskNumber !== 0) {
      throw new Error('Unsupported Garmin ZIP entry')
    }
    if (uncompressedSize > MAX_FIT_BYTES || compressedSize > MAX_FIT_BYTES) {
      throw new Error('Garmin FIT file is too large')
    }
    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error('Invalid Garmin ZIP file header')
    }
    const localNameSize = bytes.readUInt16LE(localOffset + 26)
    const localExtraSize = bytes.readUInt16LE(localOffset + 28)
    if (bytes.readUInt16LE(localOffset + 8) !== method ||
        bytes.readUInt16LE(localOffset + 6) !== flags) {
      throw new Error('Inconsistent Garmin ZIP file header')
    }
    const dataStart = localOffset + 30 + localNameSize + localExtraSize
    if (dataStart + compressedSize > bytes.readUInt32LE(end + 16)) {
      throw new Error('Truncated Garmin FIT file')
    }
    const data = bytes.subarray(dataStart, dataStart + compressedSize)
    const fit = method === 0
      ? data
      : method === 8
        ? inflateRawSync(data, { maxOutputLength: MAX_FIT_BYTES })
        : null
    if (!fit) throw new Error('Unsupported Garmin ZIP compression')
    if (fit.length !== uncompressedSize || fit.length < 12 || fit.toString('ascii', 8, 12) !== '.FIT') {
      throw new Error('Garmin activity does not contain a valid FIT file')
    }
    return fit
  }
  return null
}

export function decodeGarminFitArchive(
  archive: Buffer,
  everySeconds: number,
  maxSamples: number,
  startSeconds = 0,
  lapStartIndex = 0,
  maxLaps = 100,
) {
  if (!Number.isInteger(everySeconds) || everySeconds < 1 || everySeconds > 300 ||
      !Number.isInteger(maxSamples) || maxSamples < 1 || maxSamples > 2000 ||
      !Number.isSafeInteger(startSeconds) || startSeconds < 0 ||
      !Number.isSafeInteger(lapStartIndex) || lapStartIndex < 0 ||
      !Number.isInteger(maxLaps) || maxLaps < 1 || maxLaps > 100) {
    throw new Error('Invalid Garmin FIT sampling options')
  }
  if (archive.length > MAX_FIT_BYTES) throw new Error('Garmin FIT archive is too large')
  const fit = archive.length >= 12 && archive.toString('ascii', 8, 12) === '.FIT'
    ? archive : extractFitFromZip(archive)
  if (!fit) {
    return { available: false as const, reason: 'No FIT file in the Garmin activity archive' }
  }

  const stream = Stream.fromBuffer(fit)
  const decoder = new Decoder(stream)
  if (!decoder.isFIT() || !decoder.checkIntegrity()) {
    throw new Error('Garmin FIT integrity check failed')
  }
  let messageCount = 0
  let overlappingSpeedFields = false
  const decoded = decoder.read({
    mesgListener: () => {
      if (++messageCount > MAX_MESSAGES) throw new Error('Garmin FIT has too many messages')
    },
    mesgDefinitionListener: definition => {
      const fields = new Set(definition.fieldDefinitions.map(field => field.fieldDefinitionNumber))
      if ((definition.globalMessageNumber === 20 && fields.has(6) && fields.has(73)) ||
          (definition.globalMessageNumber === 18 &&
            ((fields.has(14) && fields.has(124)) || (fields.has(15) && fields.has(125)))) ||
          (definition.globalMessageNumber === 19 &&
            ((fields.has(13) && fields.has(110)) || (fields.has(14) && fields.has(111))))) {
        overlappingSpeedFields = true
      }
    },
  })
  // The SDK reports decoding errors separately; never return partial corrupt data.
  if (decoded.errors.length) throw new Error('Garmin FIT decoding failed')
  const messages = decoded.messages as unknown as { recordMesgs?: FitRecord[]; lapMesgs?: FitRecord[]; sessionMesgs?: FitRecord[] }
  const records = messages.recordMesgs ?? []
  const laps = messages.lapMesgs ?? []
  if (overlappingSpeedFields) {
    // SDK component expansion can overwrite explicit enhanced speed fields.
    // Restore explicitly encoded values in a second pass only for affected files;
    // retain component expansion and HR merging for all other decoded fields.
    messageCount = 0
    const explicit = new Decoder(Stream.fromBuffer(fit)).read({
      expandComponents: false,
      mergeHeartRates: false,
      mesgListener: () => {
        if (++messageCount > MAX_MESSAGES) throw new Error('Garmin FIT has too many messages')
      },
    })
    if (explicit.errors.length) throw new Error('Garmin FIT decoding failed')
    for (const [expanded, native, fields] of [
      [records, explicit.messages.recordMesgs ?? [], ['enhancedSpeed']],
      [laps, explicit.messages.lapMesgs ?? [], ['enhancedAvgSpeed', 'enhancedMaxSpeed']],
      [messages.sessionMesgs ?? [], explicit.messages.sessionMesgs ?? [], ['enhancedAvgSpeed', 'enhancedMaxSpeed']],
    ] as [FitRecord[], FitRecord[], string[]][]) {
      native.forEach((message, index) => {
        for (const field of fields) {
          if (expanded[index] && safeNumber(message[field]) !== null) {
            expanded[index][field] = message[field]
          }
        }
      })
    }
  }
  if (records.length === 0 && laps.length === 0 && !messages.sessionMesgs?.length) {
    return { available: false as const, reason: 'FIT file contains no recorded telemetry' }
  }

  const rows: NumericSample[] = []
  let sampleBytes = 2
  let firstTimestamp: number | null = null
  let lastIncluded: number | null = null
  let truncated = false
  let nextStartSeconds: number | null = null

  for (const record of records) {
    const time = timestampMs(record.timestamp)
    if (time === null) continue
    if (firstTimestamp === null) firstTimestamp = time
    const elapsed = Math.max(0, Math.round((time - firstTimestamp) / 1000))
    if (elapsed < startSeconds) continue
    if (lastIncluded !== null && elapsed - lastIncluded < everySeconds) continue
    const speed = safeNumber(record.enhancedSpeed) ?? safeNumber(record.speed)
    const row: NumericSample = [
      new Date(time).toISOString(),
      elapsed,
      safeNumber(record.heartRate),
      speed === null ? null : Math.round(speed * 100) / 100,
      cadence(record.cadence, record.fractionalCadence),
      safeNumber(record.power),
      safeNumber(record.distance),
      pace(speed),
      safeNumber(record.stanceTime),
      millimetersToCm(record.verticalOscillation),
      safeNumber(record.stanceTimeBalance),
      safeNumber(record.verticalRatio),
      millimetersToCm(record.stepLength),
      safeNumber(record.stanceTimePercent),
    ]
    const size = Buffer.byteLength(JSON.stringify(row), 'utf8') + 1
    if (rows.length >= maxSamples || sampleBytes + size > MAX_SAMPLE_JSON_BYTES) {
      truncated = true
      nextStartSeconds = elapsed
      break
    }
    rows.push(row)
    sampleBytes += size
    lastIncluded = elapsed
  }

  if (firstTimestamp === null && laps.length === 0 && !messages.sessionMesgs?.length) {
    return { available: false as const, reason: 'FIT records contain no usable timestamps' }
  }

  return {
    available: true as const,
    source: 'original Garmin FIT file, downloaded and decoded on demand',
    contentSha256: createHash('sha256').update(fit).digest('hex'),
    fitSessionCount: messages.sessionMesgs?.length ?? 0,
    // Multisport summaries must not be silently collapsed into one activity.
    nativeSummary: messages.sessionMesgs?.length === 1 ? {
      ...nativeLap(messages.sessionMesgs[0], 0),
      sport: typeof messages.sessionMesgs[0].sport === 'string' ? messages.sessionMesgs[0].sport : null,
    } : null,
    fitRecordCount: records.length,
    sampleIntervalSeconds: everySeconds,
    startTimestamp: firstTimestamp === null ? null : new Date(firstTimestamp).toISOString(),
    telemetryAvailable: firstTimestamp !== null,
    startSeconds,
    columns: [
      'timestampUtc', 'elapsedSeconds', 'heartRateBpm', 'speedMetersPerSecond',
      'cadenceCyclesPerMinute', 'powerWatts', 'distanceMeters', 'paceSecondsPerKm',
      'groundContactTimeMs', 'verticalOscillationCm', 'groundContactTimeBalancePercent',
      'verticalRatioPercent', 'stepLengthCm', 'groundContactTimePercent',
    ],
    samples: rows,
    truncated,
    nextStartSeconds,
    ...lapPage(laps, lapStartIndex, maxLaps),
    lapNote: 'Native FIT lap messages in file order; boundaries and summaries are never estimated from samples or distance. Timer time excludes pauses; elapsed time includes them. Missing lap values are null. Lap pagination is independent of sample pagination: use nextLapStartIndex as lapStartIndex.',
    note: 'Samples are selected, not averaged. Missing fields and pace at zero speed are null. FIT cadence is cycles/minute (running strides/minute; double for steps/minute). Use nextStartSeconds with the same everySeconds for the next page. Dynamics use SDK-scaled native fields; oscillation and step length are converted from mm to cm. Balance is the recorded FIT percentage without inferring a complementary side. No GPS coordinates are returned.',
  }
}
