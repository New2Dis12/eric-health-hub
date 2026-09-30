export const OURA_AUTHORIZE_URL = 'https://cloud.ouraring.com/oauth/authorize'
export const OURA_TOKEN_URL = 'https://api.ouraring.com/oauth/token'
export const OURA_SCOPES = ['personal', 'daily', 'heartrate', 'workout', 'session', 'spo2']

export const OAUTH_STATE_COOKIE = 'oura_oauth_state'
export const ACCESS_TOKEN_COOKIE = 'oura_access_token'
export const REFRESH_TOKEN_COOKIE = 'oura_refresh_token'

export function getRedirectUri(origin: string) {
  return process.env.OURA_REDIRECT_URI ?? `${origin}/api/oura/callback`
}

export type OuraTokenResponse = {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
}
