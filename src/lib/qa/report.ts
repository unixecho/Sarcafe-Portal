import { z } from 'zod'

// The QA report contract (docs/QA_BLUEPRINT.md): written by qa/run.mjs, posted by the GitHub Actions workflow to /api/qa/report,
// stored in qa_runs, read by the developer's morning review (/staff/dev/qa). PURE: no server-only imports.
// Every string and list is bounded: a report is data from CI, never trusted to be small.

const text = (max: number) => z.string().max(max)
const status = z.enum(['pass', 'warn', 'fail'])
const testStatus = z.enum(['pass', 'fail', 'skip', 'flaky'])
export const QA_CATEGORIES = ['static', 'unit', 'sql', 'security', 'e2e', 'regression', 'survival', 'recovery', 'a11y', 'perf'] as const

export const QaTest = z.object({
  id: text(120),
  title: text(240),
  status: testStatus,
  category: z.enum(QA_CATEGORIES),
  durationMs: z.number().int().min(0).max(3_600_000),
  detail: text(600).optional(),
}).strict()

export const QaStage = z.object({
  id: text(60),
  title: text(120),
  status,
  durationMs: z.number().int().min(0).max(7_200_000),
  tests: z.array(QaTest).max(800),
}).strict()

export const QaReview = z.object({
  headline: text(200),
  verdict: text(400),
  highlights: z.array(text(300)).max(12),
  risks: z.array(text(300)).max(12),
  changes: z.object({ newlyFailing: z.array(text(240)).max(40), fixed: z.array(text(240)).max(40), newTests: z.number().int().min(0).max(5000) }).strict(),
  next: z.array(text(300)).max(10),
}).strict()

export const QaReport = z.object({
  version: z.literal(1),
  run: z.object({
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime(),
    durationMs: z.number().int().min(0).max(7_200_000),
    source: z.enum(['schedule', 'push', 'manual', 'local']),
    commit: z.string().regex(/^[0-9a-f]{7,40}$/).nullable(),
    ref: text(120).nullable(),
    host: text(60),
  }).strict(),
  status,
  totals: z.object({ tests: z.number().int().min(0), passed: z.number().int().min(0), failed: z.number().int().min(0), flaky: z.number().int().min(0), skipped: z.number().int().min(0) }).strict(),
  stages: z.array(QaStage).max(20),
  metrics: z.object({
    audit: z.object({ critical: z.number().int().min(0), high: z.number().int().min(0), moderate: z.number().int().min(0), low: z.number().int().min(0) }).strict().nullable(),
    perf: z.record(text(60), z.number()).nullable(),
    contrastLowest: z.number().nullable(),
  }).strict(),
  review: QaReview,
}).strict()

export type QaTest = z.infer<typeof QaTest>
export type QaStage = z.infer<typeof QaStage>
export type QaReview = z.infer<typeof QaReview>
export type QaReport = z.infer<typeof QaReport>
export type QaRunSummary = { id: string; createdAt: string; status: 'pass' | 'warn' | 'fail'; passed: number; tests: number; failed: number; commit: string | null }

export const passRate = (t: QaReport['totals']) => (t.tests ? Math.round((t.passed / Math.max(1, t.tests - t.skipped)) * 1000) / 10 : 0)
