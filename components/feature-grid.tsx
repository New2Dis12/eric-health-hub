import { HeartPulse, Moon, ShieldCheck, Zap } from 'lucide-react'

const features = [
  { icon: Moon, title: 'Sleep', description: 'Nightly sleep scores, stages, and timing.' },
  { icon: Zap, title: 'Readiness', description: 'Daily recovery and readiness trends.' },
  { icon: HeartPulse, title: 'Heart rate', description: 'Resting heart rate and HRV over time.' },
  { icon: ShieldCheck, title: 'Private by design', description: 'Read-only access, revocable anytime.' },
]

export function FeatureGrid() {
  return (
    <section aria-label="Features" className="mt-16 grid gap-4 sm:grid-cols-2">
      {features.map(({ icon: Icon, title, description }) => (
        <div key={title} className="rounded-2xl border p-6">
          <Icon className="size-5 text-primary" aria-hidden="true" />
          <h3 className="mt-4 font-medium">{title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
        </div>
      ))}
    </section>
  )
}
