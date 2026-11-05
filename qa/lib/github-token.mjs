// GitHub Actions' own identity token (OIDC) for the portal's QA endpoints (src/lib/qa/auth.ts). It lives a few minutes, so it is
// asked for right before each post, never at the start of a 30-minute run. Outside GitHub Actions (or without `id-token: write`)
// there is none and the caller falls back to QA_REPORT_SECRET.
export const QA_AUDIENCE = 'sarcafe-qa'

export async function githubToken(audience = QA_AUDIENCE) {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL
  const bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  if (!url || !bearer) return null
  const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}audience=${encodeURIComponent(audience)}`, { headers: { authorization: `bearer ${bearer}` } }).catch(() => null)
  if (!res?.ok) { console.log(`GitHub did not hand out an identity token (HTTP ${res?.status ?? 0}).`); return null }
  const value = (await res.json().catch(() => ({}))).value
  return typeof value === 'string' && value.split('.').length === 3 ? value : null
}

/** The credential for a QA post: a fresh GitHub token in Actions, else the shared secret, else null. */
export async function qaCredential() {
  return process.env.QA_OIDC_TOKEN || (await githubToken()) || process.env.QA_REPORT_SECRET || null
}
