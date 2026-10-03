'use client'

import { useT } from '@/lib/pos/useT'

// The progress dots. They are NOT buttons: nothing is committed until the last step,
// so jumping around would only invite a half-filled form. "Back" in the footer is the
// one way to move, and it is always there.

export default function WizardSteps({ step, labels }: { step: number; labels: string[] }) {
  const t = useT()
  return (
    <div className="os-steps">
      <ol className="os-steps__dots" aria-label={t('owner.setup.wiz.step', { n: step + 1, total: labels.length })}>
        {labels.map((label, i) => (
          <li
            key={label}
            className="os-steps__dot"
            data-state={i < step ? 'done' : i === step ? 'current' : 'todo'}
            aria-current={i === step ? 'step' : undefined}
          >
            <span className="os-steps__vh">{label}</span>
          </li>
        ))}
      </ol>
      <p className="os-steps__label">
        {t('owner.setup.wiz.step', { n: step + 1, total: labels.length })} · {labels[step]}
      </p>
    </div>
  )
}
