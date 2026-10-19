// Ring API authentication, adapted from AmazonAppDev/ring-api-helloworld (MIT).
// 1. Access token (RING_ACCESS_TOKEN): Playground token, used as-is.
// 2. Refresh token (RING_REFRESH_TOKEN): auto-renewing, needs client credentials.

let cachedToken: { token: string; expiresAt: number } | null = null

export function isRingConfigured(): boolean {
  return Boolean(process.env.RING_ACCESS_TOKEN || process.env.RING_REFRESH_TOKEN)
}

export async function getAccessToken(): Promise<string> {
  if (process.env.RING_ACCESS_TOKEN && process.env.RING_REFRESH_TOKEN) {
    throw new Error('Both RING_ACCESS_TOKEN and RING_REFRESH_TOKEN are set. Use only one.')
  }

  if (process.env.RING_ACCESS_TOKEN) return process.env.RING_ACCESS_TOKEN

  if (process.env.RING_REFRESH_TOKEN) {
    if (!process.env.RING_CLIENT_ID || !process.env.RING_CLIENT_SECRET) {
      throw new Error('RING_CLIENT_ID and RING_CLIENT_SECRET are required with RING_REFRESH_TOKEN')
    }
    if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token

    const res = await fetch('https://oauth.ring.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: process.env.RING_REFRESH_TOKEN,
        client_id: process.env.RING_CLIENT_ID,
        client_secret: process.env.RING_CLIENT_SECRET,
      }).toString(),
    })
    if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`)

    const data = await res.json()
    cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000 - 60_000,
    }
    return data.access_token
  }

  throw new Error('Ring auth not configured. Set RING_ACCESS_TOKEN or RING_REFRESH_TOKEN.')
}
