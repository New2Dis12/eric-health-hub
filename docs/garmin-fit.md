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
watts, cumulative distance in meters, and pace in seconds/km. Fractional cadence is
included. For running, FIT cadence counts strides; multiply by two for steps/minute.
Unrecorded fields and pace at zero speed are `null`. GPS coordinates, identifiers,
raw files and tokens are not included in the FIT response.

Sampling selects records at least `everySeconds` apart; it does not average them.
Elapsed time includes pauses. `startTimestamp` is the first usable record timestamp,
not necessarily the activity-summary start time. When `truncated` is true, repeat
the same request with `startSeconds` set to `nextStartSeconds`. Keep the interval
unchanged to continue the same sampling sequence. A start time beyond the recording
returns an empty page. The last page has `nextStartSeconds: null`.

An original archive with no FIT file, or a FIT with no telemetry records or usable timestamps, returns
`available: false` with a reason. Corrupt or oversized files and upstream failures
return an MCP tool error without exposing upstream responses or credentials.

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
  decoded messages are capped at 200,000. Explicit enhanced-speed values are preserved
  if SDK component expansion would otherwise replace them with legacy speed.
- At most 2,000 returned samples (default 1,000), interval 1–300 seconds (default 1).
  JSON activity responses and serialized MCP payloads are capped at 512 KiB.
  Reduce `limit` for very large listings. Files exceeding download/decode limits
  are rejected before sampling, even with a small `maxSamples`.

`vercel.json` disables automatic Git deployments for `feature/garmin-fit-details`
only. Other branches retain their existing deployment behavior. This branch is
intended for review; merging or deploying requires a separate decision.

## Verification

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

Tests generate a synthetic, CRC-valid FIT workout using Garmin's SDK encoder;
there is no personal health data in the repository. They cover stored/deflated ZIP,
raw FIT, missing metrics, units, timestamps, enhanced-speed precedence, stopped pace,
pagination, invalid CRC and decode errors, decompression limits, cached-token reuse,
401 refresh, activity listing, streamed byte limits and MCP scope/feature gating.
Network responses (Garmin and Redis) are mocked; they do not prove live-account
connectivity. Type checking runs separately because the existing Next configuration
skips build-time type validation.

Before any production rollout, verify a recent running/cycling activity and an
activity with missing sensors against Garmin Connect, through a separately approved
local or staging run using the existing credentials. Confirm unprivileged MCP calls
remain unauthorized. Do not commit credentials or personal FIT files. This PR does
not change or deploy the existing production app.

## Primary references

- [Garmin Personal API Python client: endpoints and ZIP download](https://github.com/garmin/connect-personal-api-python)
- [Garmin FIT JavaScript SDK](https://github.com/garmin/fit-javascript-sdk)
- [Vercel branch deployment configuration](https://vercel.com/docs/project-configuration/git-configuration)
