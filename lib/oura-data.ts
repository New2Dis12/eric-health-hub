import 'server-only'

const OURA_API_BASE = 'https://api.ouraring.com/v2/usercollection'
const LOOKBACK_DAYS = 7

type DailyScoreDoc = { day: string; score: number | null }
type DailyActivityDoc = DailyScoreDoc & { steps?: number | null }
type SleepPeriodDoc = { day: string; type?: string; lowest_heart_rate?: number | null }

type EndpointResult<T> = { ok: true; data: T[] } | { ok: false; status: number }

export type OuraSample = {
  readinessScore: number | null
  readinessDay: string | null
  sleepScore: number | null
  sleepDay: string | null
  activityScore: number | null
  steps: number | null
  activityDay: string | null
  restingHeartRate: number | null
  restingHeartRateDay: string | null
}

export type OuraTestResult =
  | { status: 'not_connected' }
  | { status: 'unauthorized' }
  | { status: 'error'; message: string }
  | {
      status: 'success'
      checkedAt: string
      endpoints: { name: string; ok: boolean; httpStatus?: number }[]
      sample: OuraSample
    }

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10)
}

async function fetchCollection<T>(path: string, accessToken: string): Promise<EndpointResult<T>> {
  const end = new Date()
  end.setUTCDate(end.getUTCDate() + 1)
  const start = new Date()
  start.setUTCDate(start.getUTCDate() - LOOKBACK_DAYS)

  const url = new URL(`${OURA_API_BASE}/${path}`)
  url.searchParams.set('start_date', isoDay(start))
  url.searchParams.set('end_date', isoDay(end))

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })

  if (!response.ok) return { ok: false, status: response.status }
  const body = (await response.json()) as { data?: T[] }
  return { ok: true, data: body.data ?? [] }
}

function latestByDay<T extends { day: string }>(items: T[]) {
  return items.reduce<T | null>((latest, item) => (!latest || item.day > latest.day ? item : latest), null)
}

export async function getOuraTestResult(accessToken: string | undefined): Promise<OuraTestResult> {
  if (!accessToken) return { status: 'not_connected' }

  try {
    const [readiness, sleep, activity, sleepPeriods] = await Promise.all([
      fetchCollection<DailyScoreDoc>('daily_readiness', accessToken),
      fetchCollection<DailyScoreDoc>('daily_sleep', accessToken),
      fetchCollection<DailyActivityDoc>('daily_activity', accessToken),
      fetchCollection<SleepPeriodDoc>('sleep', accessToken),
    ])

    const results = { readiness, sleep, activity, sleepPeriods }
    const endpoints = Object.entries(results).map(([name, result]) => ({
      name,
      ok: result.ok,
      httpStatus: result.ok ? undefined : result.status,
    }))

    if (endpoints.every((endpoint) => endpoint.httpStatus === 401)) {
      return { status: 'unauthorized' }
    }

    const latestReadiness = readiness.ok ? latestByDay(readiness.data) : null
    const latestSleep = sleep.ok ? latestByDay(sleep.data) : null
    const latestActivity = activity.ok ? latestByDay(activity.data) : null
    const latestLongSleep = sleepPeriods.ok
      ? latestByDay(sleepPeriods.data.filter((period) => period.type === 'long_sleep' && period.lowest_heart_rate))
      : null

    return {
      status: 'success',
      checkedAt: new Date().toISOString(),
      endpoints,
      sample: {
        readinessScore: latestReadiness?.score ?? null,
        readinessDay: latestReadiness?.day ?? null,
        sleepScore: latestSleep?.score ?? null,
        sleepDay: latestSleep?.day ?? null,
        activityScore: latestActivity?.score ?? null,
        steps: latestActivity?.steps ?? null,
        activityDay: latestActivity?.day ?? null,
        restingHeartRate: latestLongSleep?.lowest_heart_rate ?? null,
        restingHeartRateDay: latestLongSleep?.day ?? null,
      },
    }
  } catch (error) {
    console.error('Oura API test request failed', error)
    return { status: 'error', message: 'Could not reach the Oura API.' }
  }
}
