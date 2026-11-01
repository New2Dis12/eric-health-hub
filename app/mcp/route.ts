
import 'server-only'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createEricHealthMcpServer } from '@/lib/mcp-server'
import { verifyHealthToken } from '@/lib/auth0'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RESOURCE = 'https://eric-health-hub.vercel.app/mcp'
const METADATA = `${RESOURCE.replace(/\/mcp$/, '')}/.well-known/oauth-protected-resource`

function unauthorized() {
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
        'WWW-Authenticate': `Bearer resource_metadata="${METADATA}", scope="oura.read"`,
        'Cache-Control': 'no-store',
      },
    },
  )
}

async function handle(request: Request) {
  const token = await verifyHealthToken(
    request.headers.get('authorization'),
  )

  if (!token || !token.scopes.includes('oura.read')) {
    return unauthorized()
  }

  const server = createEricHealthMcpServer()

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
