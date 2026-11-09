
import 'server-only'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createEricHealthMcpServer } from '@/lib/mcp-server'
import { verifyHealthToken } from '@/lib/auth0'
import { verifyTrainingBearer } from '@/lib/training/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RESOURCE = 'https://eric-health-hub.vercel.app/mcp'
const METADATA = `${RESOURCE.replace(/\/mcp$/, '')}/.well-known/oauth-protected-resource`

function unauthorized() {
  const advertisedScopes = process.env.STUNNA_ENABLED === 'true'
    ? 'oura.read training.read training.write'
    : 'oura.read'

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
        'WWW-Authenticate': `Bearer resource_metadata="${METADATA}", scope="${advertisedScopes}"`,
        'Cache-Control': 'no-store',
      },
    },
  )
}

async function handle(request: Request) {
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
