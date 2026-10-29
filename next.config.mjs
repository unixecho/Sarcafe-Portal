/** @type {import('next').NextConfig} */
const nextConfig = {
  // a11y-widget ships TypeScript/TSX source, not a pre-built bundle (see its
  // own README) — this is what makes Next transpile it like first-party code.
  transpilePackages: ['a11y-widget'],
  // No `X-Powered-By: Next.js` on every response: it tells a scanner which framework (and so which advisories) to try.
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        // New Supabase project (Frankfurt), replacing the old Singapore
        // project (gdoxoetrrfnensbahclc) that this rewrite retires.
        hostname: 'moiunkugxgsgbdokaxbr.supabase.co',
      },
    ],
  },

  // Baseline hardening, carried over from AyekaBar's next.config.mjs — the
  // owner dashboard performs privileged actions (publishing a menu, editing
  // staff), so it must never be frameable by another site: a transparent
  // iframe over a "publish" button is otherwise a one-click privileged
  // action (clickjacking).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          // frame-ancestors as before, plus two directives that cannot break a page here: no <base> pointing scripts
          // elsewhere, and no plugins (<object>/<embed>; the payslip viewer uses an <iframe>, which this does not
          // touch). A full script-src policy is a separate, tested change (see docs/SECURITY_AUDIT_2026-10-28.md).
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Browser features this site never uses are switched off for it and anything it embeds. The camera stays
          // available to this origin only (the /crew and order QR scanner).
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()' },
          // Keeps recovery-code / temp-order tokens (Phase 2+3) out of the
          // Referer header on cross-origin navigation.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Never speak to this host over plain HTTP again, even if an old
          // link points at it. Vercel already redirects to TLS at the edge;
          // this is the client-side backstop. 2 years, subdomains included,
          // eligible for the browser preload list.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
      // The ONE exception to "never framed": the payslip viewer shows a private document inside our own page. It is the
      // last rule so it wins for this path; only our own origin may frame it, and the route checks who may read the file.
      {
        source: '/api/staff/payslips/:id/view',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        ],
      },
    ]
  },
}

export default nextConfig
