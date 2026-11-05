import { TOOLS, toolVisible, type ToolEntry, type ToolRole } from './index'

// The tool finder's engine. PURE: no React, no DOM, no Supabase (scripts/check-tools.mjs runs it).
// Hebrew-aware: niqqud and quotes are dropped, final letters fold to regular ones (ם→מ), a leading ה/ב/ל/מ/ש/ו/כ is optional
// ("בסידור" finds "סידור"), small typos still match, English and synonyms work. Results rank by how well the text matches, how
// often and how recently THIS person opened the entry (their history follows them across devices, see /api/staff/tool-usage),
// their role, and the time of day (the opening checklist in the morning, the closing one at night).

const FINAL: Record<string, string> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' }
/** Length-preserving fold, used to highlight matches in the original text. */
export const fold = (s: string) => s.toLowerCase().replace(/[ךםןףץ]/g, (c) => FINAL[c] ?? c)
export const norm = (s: string) =>
  fold(s).replace(/[֑-ׇ]/g, '').replace(/["'׳״`’‘“”]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const words = (s: string) => norm(s).split(' ').filter(Boolean)
const PREFIX = /^[והבלמשכ]/
const stripPrefix = (t: string) => (t.length > 3 && PREFIX.test(t) ? t.slice(1) : t)

/** Optimal string alignment distance (insert, delete, replace, swap two letters), stopping early past `cap`. */
export function distance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0]![j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const cost = a[i - 1] === b[j - 1] ? 0 : 1
    d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost)
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1)
  }
  return d[a.length]![b.length]!
}

type Prepared = { entry: ToolEntry; label: string; labelW: string[]; kw: string[][]; kwNorm: string[]; hintW: string[] }
const PREPARED: Prepared[] = TOOLS.filter((t) => !t.soon).map((entry) => ({
  entry, label: norm(entry.label), labelW: words(entry.label), kw: entry.keywords.map(words), kwNorm: entry.keywords.map(norm), hintW: words(entry.hint),
}))

function wordScore(q: string, list: string[]): number {
  let best = 0
  for (const raw of list) {
    const stripped = stripPrefix(raw)
    for (const t of stripped === raw ? [raw] : [raw, stripped]) {
      let s = 0
      if (t === q) s = 100
      else if (t.startsWith(q)) s = 85
      else if (q.length >= 3 && t.includes(q)) s = 45
      else if (q.length >= 4) {
        const cap = q.length >= 7 ? 2 : 1
        if (distance(q, t, cap) <= cap || distance(q, t.slice(0, q.length), 1) <= 1) s = 40
      }
      if (s > best) best = s
    }
  }
  return best
}

// ── usage
export type Usage = Record<string, { n: number; t: number }>
export type Context = { roles: readonly ToolRole[]; hour: number; usage: Usage; now?: number }
export type Reason = 'now' | 'frequent' | 'recent' | 'match'
export type Hit = { entry: ToolEntry; score: number; reason?: Reason }
const DAY = 86_400_000

function priors(e: ToolEntry, c: Context): { score: number; reason?: Reason } {
  const now = c.now ?? Date.now()
  const u = c.usage[e.id]
  let usage = 0
  let reason: Reason | undefined
  if (u) {
    usage = Math.min(28, Math.log2(1 + u.n) * 7)
    const age = now - u.t
    const recent = age < 36 * 3600e3 ? 10 : age < 7 * DAY ? 5 : 0
    usage += recent
    reason = u.n >= 8 ? 'frequent' : recent ? 'recent' : undefined
  }
  const timely = e.ctx === 'morning' ? c.hour >= 5 && c.hour < 12 : e.ctx === 'evening' ? c.hour >= 15 || c.hour < 2 : false
  if (timely) reason = 'now'
  const roleBoost = e.roles.includes(c.roles[0] ?? 'staff') ? 6 : 0
  return { score: usage + (timely ? 14 : 0) + roleBoost + (e.base ?? 0), reason }
}

function run(tokens: string[], q: string, c: Context, every: boolean): Hit[] {
  const phrase = norm(q)
  const hits: Hit[] = []
  for (const p of PREPARED) {
    if (!toolVisible(p.entry, c.roles)) continue
    let sum = 0
    let ok = true
    let matched = 0
    for (const t of tokens) {
      const inLabel = wordScore(t, p.labelW)
      let inKw = 0
      for (const k of p.kw) inKw = Math.max(inKw, wordScore(t, k))
      const best = Math.max(inLabel, inKw * 0.85, wordScore(t, p.hintW) * 0.5)
      if (best === 0) { if (every) { ok = false; break } continue }
      sum += best
      matched++
    }
    if (!ok || matched === 0) continue
    let text = sum / tokens.length
    if (p.label.startsWith(phrase)) text += 18
    else if (p.label.includes(phrase)) text += 8
    if (p.kwNorm.includes(phrase)) text += 12
    const pr = priors(p.entry, c)
    hits.push({ entry: p.entry, score: text + pr.score * 0.45, reason: pr.reason && c.usage[p.entry.id] ? pr.reason : 'match' })
  }
  return hits.sort((a, b) => b.score - a.score)
}

/** Ranked results. Every word typed must match something; if nothing matches every word ("משלוח חלב"), entries matching some. */
export function searchTools(q: string, c: Context, limit = 7): Hit[] {
  const tokens = words(q)
  if (!tokens.length) return []
  const all = run(tokens, q, c, true)
  return (all.length || tokens.length < 2 ? all : run(tokens, q, c, false)).slice(0, limit)
}

/** Before anything is typed: timely things, then the most used, then the most recent. */
export function suggestTools(c: Context, limit = 6): Hit[] {
  return TOOLS.filter((e) => !e.soon && toolVisible(e, c.roles) && e.action !== 'signout')
    .map((entry) => ({ entry, ...priors(entry, c) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

export function recentTools(c: Context, limit = 3): Hit[] {
  return TOOLS.filter((e) => !e.soon && toolVisible(e, c.roles) && c.usage[e.id])
    .sort((a, b) => c.usage[b.id]!.t - c.usage[a.id]!.t)
    .slice(0, limit)
    .map((entry) => ({ entry, score: 0, reason: 'recent' as Reason }))
}

/** Phrases that start with what was typed, best first: "סיד" → "סידור עבודה". Labels first, then what people call it. */
export function completeTools(q: string, c: Context, limit = 4): string[] {
  const nq = norm(q)
  if (!nq) return []
  const single = !nq.includes(' ')
  const last = nq.split(' ').pop() ?? ''
  const out: { text: string; score: number }[] = []
  for (const p of PREPARED) {
    if (!toolVisible(p.entry, c.roles)) continue
    const pr = priors(p.entry, c).score
    if (p.label.startsWith(nq)) out.push({ text: p.entry.label, score: 100 + pr })
    else if (single && last.length >= 2 && p.labelW.some((w) => w.startsWith(last))) out.push({ text: p.entry.label, score: 60 + pr })
    p.entry.keywords.forEach((k, i) => { const kn = p.kwNorm[i]!; if (kn.startsWith(nq) && kn !== nq && !/^[a-z]/.test(kn)) out.push({ text: k, score: 50 + pr * 0.5 }) })
  }
  const seen = new Set<string>()
  const res: string[] = []
  for (const o of out.sort((a, b) => b.score - a.score)) {
    const n = norm(o.text)
    if (n !== nq && !seen.has(n)) { seen.add(n); res.push(o.text) }
    if (res.length >= limit) break
  }
  return res
}

/** "Did you mean" when nothing matched: the closest label or keyword. */
export function didYouMean(q: string, c: Context): string | null {
  const t = norm(q)
  if (t.length < 3) return null
  let best: { text: string; d: number } | null = null
  for (const p of PREPARED) {
    if (!toolVisible(p.entry, c.roles)) continue
    for (const cand of [p.entry.label, ...p.entry.keywords]) {
      const d = distance(t, norm(cand), 3)
      if (d <= 3 && (!best || d < best.d)) best = { text: cand, d }
    }
  }
  return best && best.d <= Math.max(2, Math.floor(t.length / 3)) ? best.text : null
}

/** Splits a label into plain and matched parts for highlighting. */
export function highlight(text: string, q: string): { t: string; m: boolean }[] {
  const f = fold(text)
  const ranges: [number, number][] = []
  for (const w of fold(q).split(/\s+/).filter(Boolean)) {
    const clean = w.replace(/["'׳״]/g, '')
    if (!clean) continue
    let from = 0
    for (;;) {
      const i = f.indexOf(clean, from)
      if (i < 0 || ranges.length > 6) break
      ranges.push([i, i + clean.length])
      from = i + clean.length
    }
  }
  if (!ranges.length) return [{ t: text, m: false }]
  ranges.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([r[0], r[1]])
  }
  const parts: { t: string; m: boolean }[] = []
  let at = 0
  for (const [a, b] of merged) {
    if (a > at) parts.push({ t: text.slice(at, a), m: false })
    parts.push({ t: text.slice(a, b), m: true })
    at = b
  }
  if (at < text.length) parts.push({ t: text.slice(at), m: false })
  return parts
}

// ── the shape the API speaks (bounded and validated on both sides)
export const MAX_USAGE_ENTRIES = 60
export const MAX_QUERY_LENGTH = 60
export const MAX_QUERIES = 5
/** A search the person typed, cleaned: no control or direction-override characters, collapsed spaces, at most 60 characters. */
export function cleanQuery(q: unknown): string | null {
  if (typeof q !== 'string') return null
  const s = q.replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH)
  return s.length >= 2 ? s : null
}
