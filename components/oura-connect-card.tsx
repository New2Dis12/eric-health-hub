import { CircleCheck, Link2 } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'

export function OuraConnectCard({ isConnected }: { isConnected: boolean }) {
  return (
    <section
      aria-labelledby="oura-heading"
      className="mt-12 flex flex-col gap-6 rounded-2xl border bg-card p-6 sm:flex-row sm:items-center sm:justify-between md:p-8"
    >
      <div className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full border-4 border-foreground/80">
          <span className="sr-only">Oura</span>
        </span>
        <div>
          <h2 id="oura-heading" className="font-semibold">
            Oura Ring
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {isConnected
              ? 'Connected. Sleep, readiness, and activity data are available.'
              : 'Securely connect with OAuth to import sleep, readiness, and activity data.'}
          </p>
        </div>
      </div>
      {isConnected ? (
        <span className="inline-flex items-center gap-2 text-sm font-medium text-primary">
          <CircleCheck className="size-4" aria-hidden="true" />
          Connected
        </span>
      ) : (
        <a href="/api/oura/authorize" className={buttonVariants({ size: 'lg' })}>
          <Link2 aria-hidden="true" />
          Connect Oura
        </a>
      )}
    </section>
  )
}
