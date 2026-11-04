// The secret that signs the /loyaltysignup form token and keys the daily caller hash. Read in one place so the page and the endpoint
// can never disagree. It is a server-only value that already exists on the host (nothing new to configure); empty means the page
// and the endpoint refuse to work rather than sign with nothing.
export const loyaltySecret = (): string => process.env.RATE_LIMIT_KEY_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
