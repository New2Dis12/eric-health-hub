import { timingSafeEqual } from 'node:crypto'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createEricHealthMcpServer } from '@/lib/mcp-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Temporary gate until MCP OAuth is added: the endpoint stays closed unless
// MCP_ACCESS_TOKEN is configured and the request presents it as a bearer token.
function isAuthorized(request: Request) {
  const expected = process.env.MCP_ACCESS_TOKEN
  if (!expected) return false

  const header = request.headers.get('authorization') ?? ''
  const [scheme, provided] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !provided) return false

  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function unauthorized() {
  return Response.json(
    { jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null },
    { status: 401, headers: { 'WWW-Authenticate': 'Bearer', 'Cache-Control': 'no-store' } },
  )
}

async function handle(request: Request) {
  if (!isAuthorized(request)) return unauthorized()

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
      { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null },
      { status: 500 },
    )
  } finally {
    await transport.close()
    await server.close()
  }
}

export { handle as GET, handle as POST, handle as DELETE }
