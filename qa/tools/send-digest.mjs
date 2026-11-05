// The 07:00 message to the developer (docs/QA_BLUEPRINT.md): asks the portal to send ONE notification with the latest dashboard
// and kiosk reports (src/app/api/qa/digest/route.ts). The GitHub workflow runs it after waiting for 07:00 Israel time; the portal
// keeps one digest per day, so a second call the same day only answers "already sent".
//   node qa/tools/send-digest.mjs           send (GitHub identity token in Actions, else QA_REPORT_SECRET)
//   node qa/tools/send-digest.mjs --dry     only show what would be sent
import { qaCredential } from '../lib/github-token.mjs'

const base = (process.env.QA_REPORT_URL || 'https://sarcafe-portal.vercel.app/api/qa/report').replace(/\/api\/qa\/report$/, '')
const dry = process.argv.includes('--dry')
const token = await qaCredential()
if (!token) { console.log('No GitHub identity token and no QA_REPORT_SECRET: nothing was sent.'); process.exit(1) }
const res = await fetch(`${base}/api/qa/digest${dry ? '?dry=1' : ''}`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch((err) => ({ ok: false, status: 0, text: async () => String(err) }))
const text = await res.text()
console.log(`digest: HTTP ${res.status} ${text.slice(0, 600)}`)
if (process.env.GITHUB_STEP_SUMMARY) {
  const fs = await import('node:fs')
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### 07:00 digest\n\nHTTP ${res.status}\n\n\`\`\`json\n${text.slice(0, 2000)}\n\`\`\`\n`)
}
process.exit(res.ok ? 0 : 1)
