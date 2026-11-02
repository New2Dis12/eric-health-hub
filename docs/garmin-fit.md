# Garmin FIT telemetry through the existing MCP tool

`get_garmin_activities` keeps its existing name, authentication and listing behavior.
No new app, OAuth connection, API key, Redis key or Vercel project is required.

## Calls

List recent activities, as before:

```json
{"limit": 10}
```

Download and decode one activity's original FIT file on the server:

```json
{"activityId": 123456789, "everySeconds": 1, "maxSamples": 1000, "startSeconds": 0}
```

Use an actual `activityId` from the listing. When it is present, `limit` is ignored.
Only this activity is downloaded; listing workouts does not fetch FIT files.

The result contains `columns` and compact `samples` arrays, with UTC ISO timestamps,
elapsed seconds, heart rate in bpm, speed in m/s, cadence in cycles/minute, power in
watts, cumulative distance in meters, pace in seconds/km, and the running dynamics
below. The original eight columns retain their names, order, and meaning; dynamics
columns are appended. Clients should read `columns`, rather than require an
eight-element row. Fractional cadence is
included. For running, FIT cadence counts strides; multiply by two for steps/minute.
Unrecorded fields and pace at zero speed are `null`. GPS coordinates, identifiers,
raw files and tokens are not included in the FIT response.

Sampling selects records at least `everySeconds` apart; it does not average them.
Elapsed time includes pauses. `startTimestamp` is the first usable record timestamp,
not necessarily the activity-summary start time. When `truncated` is true, repeat
the same request with `startSeconds` set to `nextStartSeconds`. Keep the interval
unchanged to continue the same sampling sequence. A start time beyond the recording
returns an empty page. The last page has `nextStartSeconds: null`.

An original archive with no FIT file, or a FIT with neither usable telemetry nor
native laps, returns `available: false` with a reason. Lap-only FIT files return
`available: true`, `telemetryAvailable: false`, `startTimestamp: null` and empty
`samples`, while preserving their native laps. Missing lap timestamps remain null. Corrupt or oversized files and upstream failures
return an MCP tool error without exposing upstream responses or credentials.

## Running dynamics and native lap contract

Garmin SDK 21.218 applies FIT scales and offsets **once**. The decoder reads native
record and lap fields, then converts millimeters to centimeters for oscillation
and step length. No workout-summary values are copied into the time series or laps.

| Appended sample column | Native record / lap average field | FIT raw scale | SDK unit → response unit |
| --- | --- | --- | --- |
| `groundContactTimeMs` | `stanceTime` / `avgStanceTime` | 10 | ms → ms |
| `verticalOscillationCm` | `verticalOscillation` / `avgVerticalOscillation` | 10 | mm → cm (divide by 10) |
| `groundContactTimeBalancePercent` | `stanceTimeBalance` / `avgStanceTimeBalance` | 100 | percent → percent |
| `verticalRatioPercent` | `verticalRatio` / `avgVerticalRatio` | 100 | percent → percent |
| `stepLengthCm` | `stepLength` / `avgStepLength` | 10 | mm → cm (divide by 10) |
| `groundContactTimePercent` | `stanceTimePercent` / `avgStanceTimePercent` | 100 | percent → percent |

For example, raw `vertical_oscillation=1014` decodes to 101.4 mm and returns
10.14 cm; raw `stance_time=2555` returns 255.5 ms; raw balance `4750` returns
47.5%. Balance preserves the recorded percentage without inventing a left/right
complement. Contact-time percentage is a separate field, not balance. Step length
is FIT's `step_length`; it is not inferred from cadence, speed or distance.

Unavailable measurements, including FIT invalid-value sentinels, return null.
An explicitly recorded zero remains zero. No sport is required to contain running
dynamics: cycling, strength and rowing retain their existing metrics. Arbitrary
vendor/developer fields are not guessed from names or converted without a known
native field mapping.

`laps` contains only actual FIT `lap` messages, in file order. No laps are created
from mile/km boundaries or sample windows. Each lap contains:

- `lapIndex` (zero-based file order) and native `messageIndex` (nullable).
- `startTimestampUtc` from `start_time` and `endTimestampUtc` from `timestamp`.
  Both retain FIT timestamp precision; no fractional boundary is inferred from durations.
- `elapsedSeconds` (`total_elapsed_time`, includes pauses), `timerSeconds`
  (`total_timer_time`, excludes pauses) and `distanceMeters` (`total_distance`).
- `avgHeartRateBpm`, `maxHeartRateBpm`, `avgSpeedMetersPerSecond`,
  `maxSpeedMetersPerSecond`, `avgPaceSecondsPerKm` and `bestPaceSecondsPerKm`.
  Pace is derived from the native average/maximum speed and rounded to seconds/km.
  Enhanced speeds take precedence over legacy speeds; zero/missing speed gives null pace.
- `avgCadenceCyclesPerMinute`, `maxCadenceCyclesPerMinute` (including fractional
  cadence), `avgPowerWatts`, `maxPowerWatts`. Running cadence remains strides/minute;
  double only for running steps/minute, not for cycling or rowing cadence.
- The six dynamics above with `avg` prefixes (`avgGroundContactTimeMs`,
  `avgVerticalOscillationCm`, `avgGroundContactTimeBalancePercent`,
  `avgVerticalRatioPercent`, `avgStepLengthCm`, `avgGroundContactTimePercent`).
  These are native lap averages, never averages of downsampled records.

Lap paging is independent of sample paging. Existing parameters and defaults are
unchanged; two optional inputs are added: `lapStartIndex` (default 0) and `maxLaps`
(default 100, range 1–100). `fitLapCount` counts all native lap messages.
`lapsTruncated` and `nextLapStartIndex` describe the lap page. Offsets work even
when laps have identical/missing timestamps or repeated native message indices.
A lap offset beyond the last lap returns an empty lap page and a null cursor.

```json
{"activityId": 24873396780, "everySeconds": 1, "maxSamples": 1000, "startSeconds": 0, "lapStartIndex": 0, "maxLaps": 100}
```

Continue samples with `nextStartSeconds`, and laps with `nextLapStartIndex` as
`lapStartIndex`, retaining the activity and sampling interval. A sample time offset
or sampling interval does not filter/change lap boundaries or native lap summaries.
If the lap page is complete, set `lapStartIndex` to `fitLapCount` on subsequent
sample pages to avoid repeating laps. Each request re-downloads the original FIT
using the existing cached authentication; no raw FIT cache or permanent storage is added.

## Security and resource limits

- Existing Auth0 verification, allowed subject and Oura authorization remain intact.
  Garmin still requires both `GARMIN_MCP_ENABLED=true` and `garmin.read`.
- Existing Garmin Personal API key and Redis access-token cache/refresh are reused,
  including the existing one-time refresh/retry after HTTP 401.
- Downloads use Garmin's fixed HTTPS Personal API host and positive safe-integer
  activity IDs. No caller-provided URL or file path is accepted. Redirects are
  rejected; requests use `no-store`. Files stay in memory and are never written to disk.
- Token request: 15-second timeout, 16 KiB response cap. Activity/download request:
  30-second timeout per attempt. Actual streamed bytes are counted regardless of
  Content-Length, including when the HTTP body is decompressed by fetch.
- Original download and extracted FIT: at most 16 MiB each. ZIP extraction supports
  stored/deflated entries and data descriptors via central-directory sizes. It
  bounds decompression and rejects encrypted, multi-disk, ZIP64 and malformed archives.
  The first FIT entry is used. Non-FIT original formats are not converted.
- Garmin SDK validates FIT CRC/integrity. Decoder errors reject partial results;
  decoded messages (including laps) are capped at 200,000. Explicit enhanced-speed
  values in records and laps are preserved if SDK component expansion would otherwise
  replace them with legacy speed.
- At most 2,000 returned samples (default 1,000), interval 1–300 seconds (default 1).
  At most 100 returned laps. Sample arrays have a 384 KiB JSON budget and lap arrays
  a separate 96 KiB budget; a budget-limited page returns the appropriate continuation
  cursor, leaving room for metadata. JSON activity responses and serialized MCP
  payloads retain the existing 512 KiB cap.
  Reduce `limit` for very large listings. Files exceeding download/decode limits
  are rejected before sampling, even with a small `maxSamples`.

`vercel.json` disables automatic Git deployments for this feature branch,
`feature/garmin-running-dynamics-laps`, as well as the earlier FIT feature branch.
This change is for review and has not been merged or deployed.

## Verification

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

All 28 automated tests pass, along with standalone type checking and the production
build. The lockfile installs successfully with `--frozen-lockfile`; no dependency
changes are needed because the existing Garmin SDK supports these native fields.
The Next configuration skips build-time type validation, so `pnpm typecheck` is
required separately and was run successfully.

Tests generate CRC-valid synthetic FIT files with Garmin's encoder, plus independent
hand-encoded integer fields/sentinels to validate scaling without relying on encoder
round trips. Coverage includes record/lap dynamics units, missing/zero values, native
and partial lap boundaries, paused durations, enhanced-speed precedence, lap-only
files, cycling/strength/rowing, sample/lap pagination, repeated lap indices/times,
maximum pages below 512 KiB, and the existing corruption/download/authentication,
Oura exposure, Garmin listing and MCP scope/feature checks. Garmin and Redis network
responses in automated tests are mocked. No original personal FIT file is committed.

### Live target: October 27, 2026 Oak Park Running (`24873396780`)

The connected Eric Health Hub_v2 activity listing successfully returned the target
from Garmin during implementation. These are **Garmin summary readings**, rounded
only for display, not measurements decoded by this feature branch:

| Garmin summary field | Observed value | Original FIT comparison |
| --- | --- | --- |
| `avgGroundContactTime` | 255.5 ms | Pending original FIT access |
| `avgVerticalOscillation` | 10.14 cm | Pending original FIT access |
| `avgGroundContactBalance` | 47.5% | Pending original FIT access |
| `avgVerticalRatio` | 8.45% | Pending original FIT access |
| `avgStrideLength` | 117.13 cm | Pending original FIT access |
| `lapCount` | 4 | Native FIT lap messages/boundaries not yet verified |

The session's installed hub connector advertises only the `limit` input; it cannot
send `activityId`, `everySeconds`, `maxSamples` or `startSeconds` to retrieve FIT
telemetry. No server credentials were available in the local environment. A direct
Garmin Connect check reached the activity's private/access-denied page with a sign-in
link, so no authenticated Connect chart/lap comparison was possible. No new login,
authentication connection, app, plugin or deployment was created to work around this.

Consequently, this verification does **not** confirm which native record/lap dynamics
are encoded in that activity's original FIT file, its native lap values, or agreement
between this decoder and Connect. Summary availability does not prove time-series or
lap-field availability. No differences can be established from the available access;
missing original data has not been inferred or filled from the summary.

The remaining release check is an authorized execution of this branch against that
original FIT through the existing server access, inspecting all `nextStartSeconds`
pages and native laps and comparing with authenticated Connect. Check field presence,
255.5 ms versus centimeter units, raw balance semantics, native timestamp precision,
full/partial lap distances, and stride/step cadence conventions before rollout.

## Primary references

- [Garmin Personal API Python client: endpoints and ZIP download](https://github.com/garmin/connect-personal-api-python)
- [Garmin FIT JavaScript SDK](https://github.com/garmin/fit-javascript-sdk)
- [Vercel branch deployment configuration](https://vercel.com/docs/project-configuration/git-configuration)

- [Garmin SDK native field profile and scales](https://github.com/garmin/fit-javascript-sdk/blob/main/src/profile.js)
