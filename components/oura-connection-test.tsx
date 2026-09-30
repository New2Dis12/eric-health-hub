import { CircleAlert, CircleCheck, CircleDashed } from 'lucide-react'
import type { OuraSample, OuraTestResult } from '@/lib/oura-data'

function formatDay(day: string | null) {
  if (!day) return 'No recent data'
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function metrics(sample: OuraSample) {
  return [
    { label: 'Readiness score', value: sample.readinessScore, unit: '', day: sample.readinessDay },
    { label: 'Sleep score', value: sample.sleepScore, unit: '', day: sample.sleepDay },
    { label: 'Resting heart rate', value: sample.restingHeartRate, unit: 'bpm', day: sample.restingHeartRateDay },
    { label: 'Activity score', value: sample.activityScore, unit: '', day: sample.activityDay },
  ]
}

const statusCopy = {
  not_connected: 'Connect Oura above to run the connection test.',
  unauthorized: 'The Oura access token was rejected or has expired. Reconnect Oura to try again.',
} as const

export function OuraConnectionTest({ result }: { result: OuraTestResult }) {
  const isSuccess = result.status === 'success'
  const isIdle = result.status === 'not_connected'
  const Icon = isSuccess ? CircleCheck : isIdle ? CircleDashed : CircleAlert
  const failedEndpoints = isSuccess ? result.endpoints.filter((endpoint) => !endpoint.ok) : []

  return (
    <section aria-labelledby="oura-test-heading" className="mt-10 rounded-2xl border bg-card p-6 md:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="oura-test-heading" className="text-lg font-semibold">
          Oura Connection Test
        </h2>
        <p
          className={`flex items-center gap-2 text-sm font-medium ${
            isSuccess ? 'text-primary' : isIdle ? 'text-muted-foreground' : 'text-destructive'
          }`}
        >
          <Icon className="size-4" aria-hidden="true" />
          {isSuccess ? 'API call succeeded' : isIdle ? 'Not connected' : 'API call failed'}
        </p>
      </div>

      {result.status === 'success' ? (
        <>
          <dl className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            {metrics(result.sample).map((metric) => (
              <div key={metric.label} className="rounded-xl bg-muted/60 p-4">
                <dt className="text-xs font-medium text-muted-foreground">{metric.label}</dt>
                <dd className="mt-2 text-2xl font-semibold tabular-nums">
                  {metric.value ?? '—'}
                  {metric.value != null && metric.unit ? (
                    <span className="ml-1 text-sm font-normal text-muted-foreground">{metric.unit}</span>
                  ) : null}
                </dd>
                <dd className="mt-1 text-xs text-muted-foreground">{formatDay(metric.day)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            {'Last 7 days queried. Resting heart rate uses the lowest heart rate from the latest main sleep.'}
            {failedEndpoints.length > 0
              ? ` Unavailable: ${failedEndpoints.map((e) => `${e.name} (${e.httpStatus})`).join(', ')}.`
              : null}
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          {result.status === 'error' ? result.message : statusCopy[result.status]}
        </p>
      )}
    </section>
  )
}
