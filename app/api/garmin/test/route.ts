import { requireHealthAccess, apiError } from '@/lib/private-api'

import 'server-only'
import { getGarminActivities } from '@/lib/garmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  // Never expose the test endpoint to the public.
  const secret = process.env.GARMIN_TEST_SECRET

  if (!secret || request.headers.get('x-garmin-test-secret') !== secret) {
    return new Response('Not found', { status: 404 })
  }

  try { await requireHealthAccess(request, 'garmin.read') } catch (error) { return apiError(error) }

  try {
    const result = await getGarminActivities(1)

    return Response.json(
      {
        status: 'success',
        authenticated: true,
        receivedActivities: Array.isArray(result),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('Garmin API test failed', error)

    return Response.json(
      { status: 'error', message: 'Garmin API test failed' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
