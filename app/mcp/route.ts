
import 'server-only'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { isJSONRPCRequest } from '@modelcontextprotocol/sdk/types.js'
import { createEricHealthMcpServer } from '@/lib/mcp-server'
import { verifyHealthToken } from '@/lib/auth0'
import { verifyTrainingBearer } from '@/lib/training/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { mcpResourceMetadataUrl, mcpResourceUrl } from '@/lib/mcp-resource'

function unauthorized() {
  const metadata = mcpResourceMetadataUrl()
  if (!metadata) return Response.json({ error: 'MCP resource not configured' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  const advertisedScopes = process.env.STUNNA_ENABLED === 'true' ? 'training.read' : 'oura.read'
  return Response.json(
    {
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: 'Unauthorized',
      },
      id: null,
    },
    {
      status: 401,
      headers: {
        'WWW-Authenticate': `Bearer resource_metadata="${metadata}", scope="${advertisedScopes}"`,
        'Cache-Control': 'no-store',
      },
    },
  )
}

async function handle(request: Request) {
  if (!mcpResourceUrl()) return Response.json({ error: 'MCP resource not configured' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  const authorization = request.headers.get('authorization')
  const token = await verifyHealthToken(authorization)
  const canReadOura = token?.scopes.includes('oura.read') ?? false
  const trainingToken = process.env.STUNNA_ENABLED === 'true' ? await verifyTrainingBearer(authorization) : null
  const trainingPrincipal = trainingToken?.scopes.some(scope => scope === 'training.read' || scope === 'training.write') ? trainingToken : undefined
  if (!canReadOura && !trainingPrincipal) {
    return unauthorized()
  }

  const server = createEricHealthMcpServer(
    canReadOura && (token?.scopes.includes('garmin.read') ?? false),
    { canReadOura, trainingPrincipal },
  )

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })

  const diagnosticExpiry = process.env.STUNNA_MCP_DISCOVERY_DIAGNOSTIC_UNTIL
  const diagnosticUntil = new Date(diagnosticExpiry ?? '')
  const diagnosticRemaining = diagnosticUntil.getTime() - Date.now()
  if (process.env.STUNNA_ENABLED === 'true' && diagnosticRemaining > 0 && diagnosticRemaining <= 24 * 60 * 60 * 1000 &&
      diagnosticExpiry === diagnosticUntil.toISOString()) {
    transport.onmessage = message => {
      if (isJSONRPCRequest(message) && message.method === 'tools/list') {
        console.info('stunna.mcp_discovery', {
          trainingTokenVerified: trainingToken !== null,
          trainingRead: trainingToken?.scopes.includes('training.read') ?? false,
          trainingWrite: trainingToken?.scopes.includes('training.write') ?? false,
        })
      }
    }
  }

  try {
    await server.connect(transport)

    const response = await transport.handleRequest(request)
    response.headers.set('Cache-Control', 'no-store')

    return response
  } catch (error) {
    console.error('MCP request failed', error)

    return Response.json(
      {
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      },
      { status: 500 },
    )
  } finally {
    await transport.close()
    await server.close()
  }
}

export { handle as GET, handle as POST, handle as DELETE }
