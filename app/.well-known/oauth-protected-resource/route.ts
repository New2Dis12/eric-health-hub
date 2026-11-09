
import 'server-only'

import { mcpResourceUrl } from '@/lib/mcp-resource'
export const dynamic = 'force-dynamic'

export function GET() {
  const resource = mcpResourceUrl()
  if (!resource) return Response.json({ error: 'MCP resource not configured' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  const domain = process.env.AUTH0_DOMAIN

  if (!domain) {
    return Response.json(
      { error: 'OAuth provider not configured' },
      { status: 503 },
    )
  }

  const issuer = `https://${domain.replace(/^https?:\/\//, '').replace(/\/$/, '')}`

  const scopesSupported = ['oura.read', 'garmin.read']
  if (process.env.STUNNA_ENABLED === 'true') {
    scopesSupported.push('training.read', 'training.write')
  }

  return Response.json(
    {
      resource,
      authorization_servers: [issuer],
      scopes_supported: scopesSupported,
    },
    {
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}
