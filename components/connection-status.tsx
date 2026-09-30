import { CircleAlert, CircleCheck } from 'lucide-react'

const messages: Record<string, string> = {
  connected: 'Your Oura account is connected.',
  denied: 'Oura access was not granted.',
  invalid_state: 'The authorization request expired or was invalid. Please try again.',
  not_configured: 'The Oura integration is not configured yet.',
  error: 'Something went wrong connecting to Oura. Please try again.',
}

export function ConnectionStatus({ status }: { status: string }) {
  const isSuccess = status === 'connected'
  const message = messages[status] ?? messages.error
  const Icon = isSuccess ? CircleCheck : CircleAlert

  return (
    <div
      role="status"
      className={`mb-10 flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${
        isSuccess ? 'border-primary/30 bg-primary/10 text-foreground' : 'border-destructive/30 bg-destructive/10'
      }`}
    >
      <Icon className={`size-4 shrink-0 ${isSuccess ? 'text-primary' : 'text-destructive'}`} aria-hidden="true" />
      {message}
    </div>
  )
}
