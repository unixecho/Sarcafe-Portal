'use client'

import { useId, useState } from 'react'
import { CalendarCheck, ChevronLeft, ChevronRight, FileText, Mail, ShoppingBag, X } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import { GoogleG } from '@/components/AuthHandoff'
import GoogleLinkButton from './GoogleLinkButton'
import './google-prompt.css'

// Shown on the staff home to a person who signed in with employee number + six-digit code and has not linked a
// Google (Gmail) account yet. It stays until they link one: a card with a small notification dot, and a short
// animated walkthrough that ends in the real linking step. The email is taken from Google, never typed, so the
// last step is the existing server-proved flow (GoogleLinkButton asks for the code, then opens Google).

const BENEFITS = [
  { icon: CalendarCheck, title: 'סידור העבודה שלך', text: 'רואים את המשמרות, מגישים בקשות וזמינות ומחליפים משמרת.' },
  { icon: ShoppingBag, title: 'הזמנות מהירות', text: 'קבלת הזמנות ומעקב בזמן אמת מהטלפון.' },
  { icon: FileText, title: 'תלושי שכר', text: 'התלוש שלך, פרטי ולמעלה מהכול — רק אתם רואים אותו.' },
]

export default function GoogleLinkPrompt() {
  const titleId = useId()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const last = 2

  function close() {
    setOpen(false)
    window.setTimeout(() => setStep(0), 300)
  }

  return (
    <>
      <button type="button" className="glp-card press" onClick={() => { setStep(0); setOpen(true) }} aria-label="יש לקשר חשבון Gmail — לחצו כדי להתחיל">
        <span className="glp-card__icon" aria-hidden="true">
          <Mail size={24} />
          <span className="glp-card__dot">1</span>
        </span>
        <span className="glp-card__copy">
          <strong>קשרו את חשבון ה־Gmail שלכם</strong>
          <small>עוד צעד קטן ופותחים סידור עבודה, הזמנות מהירות ותלושים</small>
        </span>
        <ChevronLeft size={19} aria-hidden="true" className="app-row__chevron" />
      </button>

      <SheetShell open={open} onClose={close} labelledBy={titleId} className="glp-sheet">
        <div className="glp">
          <div className="glp__top">
            <div className="glp__dots" aria-hidden="true">{[0, 1, 2].map((index) => <span key={index} className={index === step ? 'is-on' : index < step ? 'is-done' : ''} />)}</div>
            <button type="button" className="app-header__icon press" onClick={close} aria-label="סגירה"><X size={20} aria-hidden="true" /></button>
          </div>

          {/* The key restarts the entrance animation on every step. */}
          <div className="glp__stage" key={step}>
            {step === 0 && (
              <>
                <div className="glp__hero" aria-hidden="true">
                  <svg viewBox="0 0 120 96" className="glp__envelope">
                    <rect className="glp__draw" x="10" y="18" width="100" height="64" rx="12" />
                    <path className="glp__draw glp__draw--late" d="M14 26 60 58 106 26" />
                  </svg>
                  <span className="glp__g"><GoogleG /></span>
                  <i className="glp__spark glp__spark--a" /><i className="glp__spark glp__spark--b" /><i className="glp__spark glp__spark--c" />
                </div>
                <h2 id={titleId}>עוד צעד אחד — ופותחים הכול</h2>
                <p>נכנסתם עם מספר עובד וקוד, וזה מספיק לצ׳קליסטים. כשמקשרים חשבון Gmail, האפליקציה נפתחת במלואה.</p>
              </>
            )}
            {step === 1 && (
              <>
                <h2 id={titleId}>מה נפתח לכם</h2>
                <ul className="glp__benefits">
                  {BENEFITS.map((item, index) => (
                    <li key={item.title} style={{ animationDelay: `${index * 110}ms` }}>
                      <span className="glp__benefit-icon"><item.icon size={21} aria-hidden="true" /></span>
                      <span><strong>{item.title}</strong><small>{item.text}</small></span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {step === 2 && (
              <>
                <h2 id={titleId}>מקשרים בשתי לחיצות</h2>
                <ol className="glp__how">
                  <li style={{ animationDelay: '0ms' }}><b>1</b>מזינים את הקוד האישי בן 6 הספרות — כדי שנדע שזה אתם.</li>
                  <li style={{ animationDelay: '110ms' }}><b>2</b>בוחרים את חשבון ה־Gmail שלכם ב־Google ומאשרים.</li>
                </ol>
                <p className="glp__fine">את כתובת האימייל מקבלים ישירות מ־Google, לא מקלידים אותה, וכך החשבון שלכם מוגן.</p>
                <GoogleLinkButton />
              </>
            )}
          </div>

          <div className="glp__nav">
            {step > 0 ? <button type="button" className="glp__back press" onClick={() => setStep((value) => value - 1)}><ChevronRight size={18} aria-hidden="true" />חזרה</button> : <span />}
            {step < last ? <button type="button" className="glp__next press" onClick={() => setStep((value) => value + 1)}>המשך<ChevronLeft size={18} aria-hidden="true" /></button> : <button type="button" className="glp__later press" onClick={close}>אחר כך</button>}
          </div>
        </div>
      </SheetShell>
    </>
  )
}
