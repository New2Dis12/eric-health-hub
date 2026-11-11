import 'server-only'
export const PRODUCTION_MCP_RESOURCE = 'https://eric-health-hub.vercel.app/mcp'
export function mcpResourceUrl(): string | null {
  if (process.env.STUNNA_ENABLED !== 'true') return PRODUCTION_MCP_RESOURCE
  const raw = process.env.MCP_RESOURCE_URL
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/mcp' || raw !== url.href) return null
    return url.href
  } catch { return null }
}
export function mcpResourceMetadataUrl(): string | null {
  const resource = mcpResourceUrl()
  return resource ? `${new URL(resource).origin}/.well-known/oauth-protected-resource` : null
}
