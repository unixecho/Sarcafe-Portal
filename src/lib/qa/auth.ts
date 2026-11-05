import 'server-only'

import { createPublicKey, verify } from 'node:crypto'
import { bearerMatches } from '@/lib/http/cron'

// Who may post QA reports and ask for the 07:00 digest (docs/QA_BLUEPRINT.md): the shared secret (QA_REPORT_SECRET, for a manual
// `npm run qa -- --post`), or — what the GitHub workflow uses, so GitHub needs no stored secret at all — GitHub Actions' own short-lived
// identity token (OIDC): signed by GitHub, for THIS repository, THIS workflow file, the main branch, and the audience below.
// QA_OIDC_ISSUER only exists for the QA suite (it points the check at a test key); production never sets it.
export const QA_OIDC_AUDIENCE = 'sarcafe-qa'
const issuer = () => process.env.QA_OIDC_ISSUER || 'https://token.actions.githubusercontent.com'
const repository = () => process.env.QA_GITHUB_REPOSITORY || 'unixecho/Sarcafe-Portal'

type Jwk = import('node:crypto').JsonWebKey & { kid?: string }
let cached: { at: number; iss: string; keys: Jwk[] } | null = null

async function signingKeys(force: boolean): Promise<Jwk[]> {
  const iss = issuer()
  if (!force && cached && cached.iss === iss && Date.now() - cached.at < 3_600_000) return cached.keys
  const res = await fetch(`${iss}/.well-known/jwks`, { cache: 'no-store' })
  if (!res.ok) throw new Error('jwks unavailable')
  const keys = ((await res.json()) as { keys?: Jwk[] }).keys ?? []
  cached = { at: Date.now(), iss, keys }
  return keys
}

const part = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as Record<string, unknown>

/** True only for a valid GitHub Actions token of this repository's QA workflow on main, for our audience, not expired. */
export async function verifyGithubToken(token: string, now = Date.now()): Promise<boolean> {
  const pieces = token.split('.')
  if (pieces.length !== 3) return false
  const [h, p, sig] = pieces as [string, string, string]
  let header: Record<string, unknown>, claims: Record<string, unknown>
  try { header = part(h); claims = part(p) } catch { return false }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return false
  let keys = await signingKeys(false)
  let jwk = keys.find((k) => k.kid === header.kid)
  if (!jwk) { keys = await signingKeys(true); jwk = keys.find((k) => k.kid === header.kid) }
  if (!jwk) return false
  let signed = false
  try { signed = verify('RSA-SHA256', Buffer.from(`${h}.${p}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(sig, 'base64url')) } catch { return false }
  if (!signed) return false
  const t = Math.floor(now / 1000)
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  const repo = repository()
  return claims.iss === issuer()
    && aud.includes(QA_OIDC_AUDIENCE)
    && typeof claims.exp === 'number' && claims.exp > t - 30
    && (typeof claims.nbf !== 'number' || claims.nbf <= t + 60)
    && claims.repository === repo
    && claims.ref === 'refs/heads/main'
    && typeof claims.workflow_ref === 'string' && claims.workflow_ref.startsWith(`${repo}/.github/workflows/qa.yml@`)
}

/** A QA post is allowed with the shared secret or a valid GitHub token. */
export async function qaCallerAllowed(authorization: string | null): Promise<boolean> {
  if (bearerMatches(authorization, process.env.QA_REPORT_SECRET)) return true
  const token = authorization?.match(/^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/)?.[1]
  if (!token) return false
  try { return await verifyGithubToken(token) } catch { return false }
}
