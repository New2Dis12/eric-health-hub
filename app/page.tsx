import { cookies } from 'next/headers'
import { ConnectionStatus } from '@/components/connection-status'
import { FeatureGrid } from '@/components/feature-grid'
import { OuraConnectCard } from '@/components/oura-connect-card'
import { ACCESS_TOKEN_COOKIE } from '@/lib/oura'

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ oura?: string }>
}) {
  const [{ oura }, cookieStore] = await Promise.all([searchParams, cookies()])
  const isConnected = cookieStore.has(ACCESS_TOKEN_COOKIE)

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-16 md:py-24">
      {oura ? <ConnectionStatus status={oura} /> : null}
      <section className="max-w-2xl">
        <p className="text-sm font-medium text-primary">Personal health dashboard</p>
        <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight md:text-5xl">
          All of Eric&apos;s health data, in one calm place.
        </h1>
        <p className="mt-5 text-pretty text-lg leading-relaxed text-muted-foreground">
          Eric Health Hub brings together sleep, readiness, and activity data from connected wearables so trends are
          easy to see and act on.
        </p>
      </section>
      <OuraConnectCard isConnected={isConnected} />
      <FeatureGrid />
    </main>
  )
}
