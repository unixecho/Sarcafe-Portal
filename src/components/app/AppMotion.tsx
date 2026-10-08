'use client'
import { useRef } from 'react'
import { usePathname } from 'next/navigation'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(useGSAP, ScrollTrigger)

/** Short, interruptible app reveals; every control stays usable during travel. */
export default function AppMotion({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const scope = useRef<HTMLDivElement>(null)
  const pathname = usePathname()
  useGSAP(() => {
    const media = gsap.matchMedia()
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo('.app-welcome, .sr-profile', { y: 8, opacity: .7 }, { y: 0, opacity: 1, duration: .3, ease: 'power3.out', clearProps: 'transform,opacity' })
      scope.current?.querySelectorAll('.app-categories .app-section, .sr-summary, .sr-content').forEach((section) => {
        gsap.fromTo(section, { y: 10, opacity: .75 }, { y: 0, opacity: 1, duration: .34, ease: 'power3.out', clearProps: 'transform,opacity', scrollTrigger: { trigger: section, start: 'top 95%', once: true } })
      })
    })
    return () => media.revert()
  }, { scope, dependencies: [pathname], revertOnUpdate: true })
  return <div ref={scope} className={`native-app ${className}`}>{children}</div>
}
