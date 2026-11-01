
import 'server-only'

export const dynamic = 'force-dynamic'

export function GET() {
  const domain = process.env.AUTH0_DOMAIN

  if (!domain) {
    return Response.json(
      { error: 'OAuth provider not configured' },
      { status: 503 },
    )
  }

  const issuer = `https://${domain.replace(/^https?:\/\//, '').replace(/\/$/, '')}`

  return Response.json(
    {
      resource: 'https://eric-health-hub.vercel.app/mcp',
      authorization_servers: [issuer],
      scopes_supported: ['oura.read', 'garmin.read'],
    },
    {
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}
