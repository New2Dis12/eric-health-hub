import 'server-only'
import { inflateRawSync } from 'node:zlib'
import { Decoder, Stream } from '@garmin/fitsdk'

const MAX_FIT_BYTES = 32 * 1024 * 1024

type FitRecord = Record<string, unknown>
type NumericSample = [
  number, number | null, number | null, number | null,
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

  const count = bytes.readUInt16LE(end + 10)
  let position = bytes.readUInt32LE(end + 16)
  if (count > 100) throw new Error('Garmin ZIP has too many files')

  for (let i = 0; i < count; i++) {
    if (position + 46 > bytes.length || bytes.readUInt32LE(position) !== 0x02014b50) {
      throw new Error('Invalid Garmin ZIP directory')
    }
    const method = bytes.readUInt16LE(position + 10)
    const compressedSize = bytes.readUInt32LE(position + 20)
    const uncompressedSize = bytes.readUInt32LE(position + 24)
    const nameSize = bytes.readUInt16LE(position + 28)
    const extraSize = bytes.readUInt16LE(position + 30)
    const commentSize = bytes.readUInt16LE(position + 32)
    const localOffset = bytes.readUInt32LE(position + 42)
    const nextPosition = position + 46 + nameSize + extraSize + commentSize
    if (nextPosition > bytes.length) throw new Error('Invalid Garmin ZIP entry')
    const name = bytes.toString('utf8', position + 46, position + 46 + nameSize)
    position = nextPosition

    if (!name.toLowerCase().endsWith('.fit')) continue
    if (uncompressedSize > MAX_FIT_BYTES || compressedSize > MAX_FIT_BYTES) {
      throw new Error('Garmin FIT file is too large')
    }
    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error('Invalid Garmin ZIP file header')
    }
    const localNameSize = bytes.readUInt16LE(localOffset + 26)
    const localExtraSize = bytes.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameSize + localExtraSize
    if (dataStart + compressedSize > bytes.length) {
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
) {
  const fit = extractFitFromZip(archive)
  if (!fit) {
    return { available: false, reason: 'No FIT file in the Garmin activity archive' }
  }

  const stream = Stream.fromBuffer(fit)
  const decoder = new Decoder(stream)
  if (!decoder.isFIT() || !decoder.checkIntegrity()) {
    throw new Error('Garmin FIT integrity check failed')
  }
  const decoded = decoder.read()
  const records = (decoded.messages as unknown as { recordMesgs?: FitRecord[] }).recordMesgs ?? []
  if (records.length === 0) {
    return { available: false, reason: 'FIT file contains no recorded telemetry' }
  }

  const rows: NumericSample[] = []
  let firstTimestamp: number | null = null
  let lastIncluded: number | null = null
  let truncated = false

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
    if (lastIncluded !== null && elapsed - lastIncluded < everySeconds) continue
    if (rows.length >= maxSamples) {
      truncated = true
      break
    }

    const speed = safeNumber(record.enhancedSpeed) ?? safeNumber(record.speed)
    rows.push([
      elapsed,
      safeNumber(record.heartRate),
      speed === null ? null : Math.round(speed * 100) / 100,
      safeNumber(record.cadence),
      safeNumber(record.power),
      safeNumber(record.distance),
      speed && speed > 0 ? Math.round(1000 / speed) : null,
    ])
    lastIncluded = elapsed
  }

  return {
    available: true,
    source: 'original Garmin FIT file, downloaded and decoded on demand',
    fitRecordCount: records.length,
    sampleIntervalSeconds: everySeconds,
    columns: [
      'elapsedSeconds', 'heartRateBpm', 'speedMetersPerSecond',
      'cadenceRaw', 'powerWatts', 'distanceMeters', 'paceSecondsPerKm',
    ],
    samples: rows,
    truncated,
    note: 'All available FIT records were decoded. Samples are limited for ChatGPT response size; unavailable fields are null. Cadence units vary by activity type.',
  }
}
