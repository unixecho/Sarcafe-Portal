'use client'

import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react'
import { Bell, Check, HelpCircle, MoreVertical, Plus, QrCode, Share } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import { haptic } from '@/lib/haptics'
import { isIosDevice, isStandaloneDisplay } from '@/lib/push/client'

/**
 * The plain-language, animated walkthrough of the whole order-tracking
 * experience — written for someone who does not think of themselves as a
 * "phone person".
 *
 * Three rules shape it:
 *
 * 1. NOTHING is conveyed by animation alone. Every illustration is
 *    aria-hidden decoration miming what the numbered text already says in
 *    full, so the guide is complete with motion disabled, with images
 *    failing, or read aloud by a screen reader. (globals.css degrades
 *    every tutorial-* class to its resting state under
 *    prefers-reduced-motion.)
 *
 * 2. The steps shown match the device in hand. iOS installs from the
 *    Share menu and Android from the browser's ⋮ menu; showing both (or
 *    the wrong one) is precisely what makes a non-technical reader give
 *    up. An already-installed visitor never sees the install step at all.
 *
 * 3. It never opens itself. A customer arriving from the QR on their
 *    receipt came to see their order, and a modal covering that on
 *    arrival would be the app talking over them — so this stays a
 *    clearly-labelled button they choose to press.
 */

type Platform = 'ios' | 'android' | 'desktop'

type Step = {
  key: string
  title: string
  /** Each line is one plain instruction. Numbered in the UI. */
  lines: ReactNode[]
  illustration: ReactNode
}

export default function HowToGuide() {
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const [platform, setPlatform] = useState<Platform>('desktop')
  const [installed, setInstalled] = useState(false)
  const ids = useId()
  const titleId = `${ids}-title`

  // Resolved after mount, never during render: both checks read
  // navigator/window, and guessing on the server would render the wrong
  // platform's steps into the HTML before hydration corrects it.
  useEffect(() => {
    setPlatform(isIosDevice() ? 'ios' : /Android/i.test(navigator.userAgent) ? 'android' : 'desktop')
    setInstalled(isStandaloneDisplay())
  }, [])

  const steps = buildSteps(platform, installed)
  // The step count shrinks when the platform resolves to an already
  // installed app, so an index from the longer list has to be clamped.
  const step = steps[Math.min(index, steps.length - 1)] ?? steps[0]
  const isLast = index >= steps.length - 1

  function close() {
    setOpen(false)
    // Reset only after the exit animation, so the content doesn't visibly
    // snap back to step 1 while the sheet is still sliding away.
    window.setTimeout(() => setIndex(0), 300)
  }

  return (
    <>
      <button
        type="button"
        className="press"
        onClick={() => {
          haptic('select')
          setOpen(true)
        }}
        style={triggerStyle}
      >
        <HelpCircle size={18} aria-hidden="true" />
        איך זה עובד? מדריך קצר
      </button>

      <SheetShell open={open} onClose={close} labelledBy={titleId}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ margin: 0, fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-faint)' }}>
            שלב {index + 1} מתוך {steps.length}
          </p>

          {/* key remounts the panel on every step change, which restarts
              the illustration's entrance animation — without it the new
              step's artwork would appear already settled. */}
          <div key={step.key} className="tutorial-slide-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h2 id={titleId} style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>
              {step.title}
            </h2>

            <div aria-hidden="true" style={illoFrameStyle}>
              {step.illustration}
            </div>

            <ol style={listStyle}>
              {step.lines.map((line, i) => (
                <li key={i} style={{ lineHeight: 1.6 }}>
                  {line}
                </li>
              ))}
            </ol>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4 }}>
            {index > 0 && (
              <button type="button" className="press" onClick={() => setIndex((v) => v - 1)} style={secondaryBtnStyle}>
                הקודם
              </button>
            )}
            <button
              type="button"
              className="press"
              onClick={() => {
                haptic('tick')
                if (isLast) close()
                else setIndex((v) => v + 1)
              }}
              style={primaryBtnStyle}
            >
              {isLast ? 'הבנתי, תודה' : 'הבא'}
            </button>
          </div>

          {/* The dots are decoration — the "שלב X מתוך Y" line above is
              the accessible version of the same information. */}
          <div aria-hidden="true" style={{ display: 'flex', justifyContent: 'center', gap: 6 }}>
            {steps.map((s, i) => (
              <span
                key={s.key}
                style={{
                  width: i === index ? 20 : 6,
                  height: 6,
                  borderRadius: 999,
                  background: i === index ? 'var(--neon)' : 'var(--line-strong)',
                  transition: 'width 0.25s var(--ease), background 0.25s var(--ease)',
                }}
              />
            ))}
          </div>
        </div>
      </SheetShell>
    </>
  )
}

/** Typed non-empty so the caller can index it without a defensive branch
 *  for a list that is never actually empty. */
function buildSteps(platform: Platform, installed: boolean): [Step, ...Step[]] {
  const intro: Step = {
    key: 'track',
    title: 'העמוד הזה עוקב אחרי ההזמנה',
    lines: [
      'אין צורך לרענן או ללחוץ על כלום — העמוד מתעדכן לבד.',
      'תמיד תראו באיזה שלב ההזמנה נמצאת: התקבלה, בהכנה, ומוכנה לאיסוף.',
    ],
    illustration: <TrackingIllo />,
  }

  const steps: Step[] = []

  if (!installed && platform !== 'desktop') {
    steps.push({
      key: 'install',
      title: 'שמרו את שרקפה במסך הבית',
      lines:
        platform === 'ios'
          ? [
              <>
                הקישו על כפתור השיתוף <InlineGlyph icon={<Share size={13} />} /> בתחתית המסך.
              </>,
              'גללו למטה ברשימה עד ״הוספה למסך הבית״.',
              'הקישו ״הוספה״ — וזהו, יש לכם אייקון של שרקפה בטלפון.',
            ]
          : [
              <>
                הקישו על שלוש הנקודות <InlineGlyph icon={<MoreVertical size={13} />} /> בפינת הדפדפן.
              </>,
              'בחרו ״התקנת אפליקציה״ או ״הוספה למסך הבית״.',
              'אשרו — וזהו, יש לכם אייקון של שרקפה בטלפון.',
            ],
      illustration: <InstallIllo platform={platform} />,
    })
  }

  steps.push({
    key: 'notify',
    title: 'קבלו הודעה כשהקפה מוכן',
    lines: [
      'הקישו על ״הפעלת התראות״ בעמוד ההזמנה.',
      'הטלפון ישאל אם לאשר — הקישו ״אפשר״.',
      'נודיע לכם כשמתחילים להכין, ושוב כשההזמנה מחכה בדלפק. אפשר לשים את הטלפון בכיס.',
    ],
    illustration: <NotifyIllo />,
  })

  steps.push({
    key: 'return',
    title: 'איך חוזרים להזמנה?',
    lines: [
      'שמרו את הקבלה — יש עליה ריבוע ברקוד וקוד בן 6 ספרות.',
      'אפשר לסרוק את הברקוד עם המצלמה, או להקליד את הקוד.',
      'שתי הדרכים מחזירות אתכם בדיוק לאותו מסך מעקב.',
    ],
    illustration: <ReturnIllo />,
  })

  return [intro, ...steps]
}

function InlineGlyph({ icon }: { icon: ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', verticalAlign: 'middle', padding: '0 2px', color: 'var(--neon-soft)' }}>{icon}</span>
  )
}

// ---------------------------------------------------------------------------
// Illustrations. All decorative (the parent marks them aria-hidden) and
// built from plain elements rather than images so they inherit the theme
// and the accessibility widget's contrast modes like everything else.
// ---------------------------------------------------------------------------

function PhoneMock({ children }: { children: ReactNode }) {
  return (
    <div style={phoneStyle}>
      <span style={notchStyle} />
      <div style={screenStyle}>{children}</div>
    </div>
  )
}

function TrackingIllo() {
  return (
    <PhoneMock>
      <div style={{ padding: '18px 12px 12px', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
        <span style={{ fontSize: '0.6rem', color: 'var(--text-faint)' }}>הזמנה מספר</span>
        <span style={{ fontSize: '1.3rem', fontWeight: 800, lineHeight: 1 }}>#42</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 4 }}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span
                className={i === 1 ? 'tutorial-tap' : undefined}
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: i <= 1 ? 'var(--neon)' : 'transparent',
                  border: `1.5px solid ${i <= 1 ? 'var(--neon)' : 'var(--line-strong)'}`,
                }}
              />
              {i < 3 && <span style={{ width: 14, height: 2, background: i < 1 ? 'var(--neon)' : 'var(--line-strong)' }} />}
            </span>
          ))}
        </div>
        <span style={{ fontSize: '0.58rem', color: 'var(--text-dim)', marginTop: 2 }}>בהכנה…</span>
      </div>
    </PhoneMock>
  )
}

function InstallIllo({ platform }: { platform: Platform }) {
  const ios = platform === 'ios'
  return (
    <PhoneMock>
      <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Android's menu lives at the top, iOS's share button at the
            bottom — the mock puts the tap target where the real one is. */}
        {!ios && (
          <div style={browserBarStyle}>
            <span style={{ flex: 1 }} />
            <MoreVertical size={12} aria-hidden="true" style={{ color: 'var(--text-dim)' }} />
            <span className="tutorial-tap" style={{ ...tapDotStyle, top: 4, insetInlineEnd: 2 }} />
          </div>
        )}

        <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
          <span style={{ fontSize: '0.62rem', color: 'var(--text-faint)' }}>SarCafe</span>
        </div>

        {/* The menu/share sheet sliding up, with the row to look for. */}
        <div className="tutorial-sheet" style={sheetMockStyle}>
          <span style={{ width: 22, height: 3, borderRadius: 2, background: 'var(--line-strong)', margin: '0 auto 6px' }} />
          <div style={sheetRowStyle}>
            <Plus size={11} aria-hidden="true" style={{ color: 'var(--neon)' }} />
            <span style={{ fontSize: '0.55rem', fontWeight: 700 }}>{ios ? 'הוספה למסך הבית' : 'התקנת אפליקציה'}</span>
          </div>
        </div>

        {ios && (
          <div style={browserBarStyle}>
            <Share size={12} aria-hidden="true" style={{ color: 'var(--neon-soft)' }} />
            <span style={{ flex: 1 }} />
            <span className="tutorial-tap" style={{ ...tapDotStyle, bottom: 4, insetInlineStart: 2 }} />
          </div>
        )}
      </div>
    </PhoneMock>
  )
}

function NotifyIllo() {
  return (
    <PhoneMock>
      {/* paddingTop clears the absolutely-positioned banner so the bell
          centres in the space BELOW it rather than underneath it. */}
      <div style={{ position: 'relative', height: '100%', display: 'grid', placeItems: 'center', paddingTop: 46 }}>
        {/* The banner drops in from the status bar, the way a real one does. */}
        <div className="tutorial-sheet" style={bannerStyle}>
          <Bell size={11} aria-hidden="true" style={{ color: 'var(--bg)', flexShrink: 0 }} />
          <span style={{ fontSize: '0.52rem', fontWeight: 800, color: 'var(--bg)' }}>ההזמנה מוכנה!</span>
        </div>
        <Bell className="tutorial-bell" size={30} aria-hidden="true" style={{ color: 'var(--neon-soft)' }} />
      </div>
    </PhoneMock>
  )
}

function ReturnIllo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
      {/* No colour overrides inside: the receipt mock is deliberately
          light paper, so both the code icon and its label must inherit
          receiptStyle's dark ink. Theme tokens here are all tuned for the
          dark UI and would come out invisible on it. */}
      <div style={receiptStyle}>
        <QrCode size={34} aria-hidden="true" />
        <span style={{ fontSize: '0.52rem', opacity: 0.6 }}>קוד שחזור</span>
        <span style={{ fontSize: '0.78rem', fontWeight: 800, letterSpacing: '0.16em', direction: 'ltr', fontVariantNumeric: 'tabular-nums' }}>
          408215
        </span>
      </div>
      <Check size={20} aria-hidden="true" style={{ color: 'var(--neon-2)' }} />
      <PhoneMock>
        <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
          <span style={{ fontSize: '0.95rem', fontWeight: 800 }}>#42</span>
        </div>
      </PhoneMock>
    </div>
  )
}

const triggerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  width: '100%',
  minHeight: 'var(--tap-min)',
  borderRadius: 14,
  border: '1px dashed var(--line-interactive)',
  background: 'transparent',
  color: 'var(--neon-soft)',
  fontSize: '0.88rem',
  fontWeight: 700,
  cursor: 'pointer',
}

const illoFrameStyle: CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  padding: '18px 12px',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg)',
  border: '1px solid var(--line)',
  minHeight: 190,
  overflow: 'hidden',
}

const phoneStyle: CSSProperties = {
  position: 'relative',
  width: 108,
  height: 158,
  borderRadius: 18,
  border: '2px solid var(--line-strong)',
  background: 'var(--bg-elev)',
  overflow: 'hidden',
  flexShrink: 0,
}

const notchStyle: CSSProperties = {
  position: 'absolute',
  top: 4,
  insetInline: '50%',
  transform: 'translateX(50%)',
  width: 32,
  height: 4,
  borderRadius: 999,
  background: 'var(--line-strong)',
  zIndex: 2,
}

const screenStyle: CSSProperties = { position: 'relative', height: '100%', paddingTop: 10 }

const browserBarStyle: CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 8px',
  borderBlock: '1px solid var(--line)',
  background: 'var(--bg)',
}

const tapDotStyle: CSSProperties = {
  position: 'absolute',
  width: 18,
  height: 18,
  borderRadius: '50%',
  background: 'rgba(255,122,69,0.45)',
  border: '1.5px solid var(--neon)',
  pointerEvents: 'none',
}

const sheetMockStyle: CSSProperties = {
  position: 'absolute',
  insetInline: 0,
  bottom: 0,
  padding: '6px 8px 10px',
  borderRadius: '12px 12px 0 0',
  background: 'var(--bg-elev-2)',
  borderTop: '1px solid var(--line-strong)',
}

const sheetRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '5px 7px',
  borderRadius: 8,
  background: 'var(--bg-elev)',
  border: '1px solid var(--line-interactive)',
}

const bannerStyle: CSSProperties = {
  position: 'absolute',
  top: 8,
  insetInline: 6,
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  padding: '6px 7px',
  borderRadius: 9,
  background: 'var(--neon-2)',
}

const receiptStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 3,
  padding: '12px 14px',
  borderRadius: 10,
  background: '#fff8ef',
  color: '#150f0c',
  border: '1px solid var(--line-strong)',
}

const listStyle: CSSProperties = {
  margin: 0,
  paddingInlineStart: 22,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  fontSize: '0.92rem',
  color: 'var(--text-dim)',
}

const primaryBtnStyle: CSSProperties = {
  flex: 1,
  minHeight: 'var(--tap-min)',
  borderRadius: 14,
  border: 'none',
  background: 'var(--neon)',
  color: 'var(--bg)',
  fontSize: '0.95rem',
  fontWeight: 800,
  cursor: 'pointer',
}

const secondaryBtnStyle: CSSProperties = {
  minHeight: 'var(--tap-min)',
  padding: '0 18px',
  borderRadius: 14,
  border: '1px solid var(--line-strong)',
  background: 'transparent',
  color: 'var(--text-dim)',
  fontSize: '0.9rem',
  fontWeight: 700,
  cursor: 'pointer',
}
