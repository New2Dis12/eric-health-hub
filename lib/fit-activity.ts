import 'server-only'
import { inflateRawSync } from 'node:zlib'
import { Decoder, Stream } from '@garmin/fitsdk'

const MAX_FIT_BYTES = 16 * 1024 * 1024
const MAX_MESSAGES = 200_000

type FitRecord = Record<string, unknown>
type NumericSample = [
  string, number, number | null, number | null, number | null,
  number | null, number | null, number | null,
]

function safeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
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
) {
  if (!Number.isInteger(everySeconds) || everySeconds < 1 || everySeconds > 300 ||
      !Number.isInteger(maxSamples) || maxSamples < 1 || maxSamples > 2000 ||
      !Number.isSafeInteger(startSeconds) || startSeconds < 0) {
    throw new Error('Invalid Garmin FIT sampling options')
  }
  if (archive.length > MAX_FIT_BYTES) throw new Error('Garmin FIT archive is too large')
  const fit = archive.length >= 12 && archive.toString('ascii', 8, 12) === '.FIT'
    ? archive : extractFitFromZip(archive)
  if (!fit) {
    return { available: false, reason: 'No FIT file in the Garmin activity archive' }
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
      if (definition.globalMessageNumber === 20 &&
          definition.fieldDefinitions.some(field => field.fieldDefinitionNumber === 6) &&
          definition.fieldDefinitions.some(field => field.fieldDefinitionNumber === 73)) {
        overlappingSpeedFields = true
      }
    },
  })
  // The SDK reports decoding errors separately; never return partial corrupt data.
  if (decoded.errors.length) throw new Error('Garmin FIT decoding failed')
  const records = (decoded.messages as unknown as { recordMesgs?: FitRecord[] }).recordMesgs ?? []
  if (overlappingSpeedFields) {
    // SDK component expansion can overwrite explicit enhancedSpeed with speed.
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
    const explicitRecords = explicit.messages.recordMesgs ?? []
    explicitRecords.forEach((record, index) => {
      if (records[index] && safeNumber(record.enhancedSpeed) !== null) {
        records[index].enhancedSpeed = record.enhancedSpeed
      }
    })
  }
  if (records.length === 0) {
    return { available: false, reason: 'FIT file contains no recorded telemetry' }
  }

  const rows: NumericSample[] = []
  let firstTimestamp: number | null = null
  let lastIncluded: number | null = null
  let truncated = false
  let nextStartSeconds: number | null = null

  for (const record of records) {
    const rawTime = record.timestamp
    const time = rawTime instanceof Date
      ? rawTime.getTime()
      : typeof rawTime === 'string'
        ? Date.parse(rawTime)
        : NaN
    if (!Number.isFinite(time)) continue
    if (firstTimestamp === null) firstTimestamp = time
    const elapsed = Math.max(0, Math.round((time - firstTimestamp) / 1000))
    if (elapsed < startSeconds) continue
    if (lastIncluded !== null && elapsed - lastIncluded < everySeconds) continue
    if (rows.length >= maxSamples) {
      truncated = true
      nextStartSeconds = elapsed
      break
    }

    const speed = safeNumber(record.enhancedSpeed) ?? safeNumber(record.speed)
    rows.push([
      new Date(time).toISOString(),
      elapsed,
      safeNumber(record.heartRate),
      speed === null ? null : Math.round(speed * 100) / 100,
      safeNumber(record.cadence) === null ? null
        : (record.cadence as number) + (safeNumber(record.fractionalCadence) ?? 0),
      safeNumber(record.power),
      safeNumber(record.distance),
      speed && speed > 0 ? Math.round(1000 / speed) : null,
    ])
    lastIncluded = elapsed
  }

  if (firstTimestamp === null) {
    return { available: false, reason: 'FIT records contain no usable timestamps' }
  }

  return {
    available: true,
    source: 'original Garmin FIT file, downloaded and decoded on demand',
    fitRecordCount: records.length,
    sampleIntervalSeconds: everySeconds,
    startTimestamp: new Date(firstTimestamp).toISOString(),
    startSeconds,
    columns: [
      'timestampUtc', 'elapsedSeconds', 'heartRateBpm', 'speedMetersPerSecond',
      'cadenceCyclesPerMinute', 'powerWatts', 'distanceMeters', 'paceSecondsPerKm',
    ],
    samples: rows,
    truncated,
    nextStartSeconds,
    note: 'Samples are selected, not averaged. Missing fields and pace at zero speed are null. FIT cadence is cycles/minute (running strides/minute; double for steps/minute). Use nextStartSeconds with the same everySeconds for the next page. No GPS coordinates are returned.',
  }
}
