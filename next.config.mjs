/** @type {import('next').NextConfig} */
const nextConfig = {
  // a11y-widget ships TypeScript/TSX source, not a pre-built bundle (see its
  // own README) — this is what makes Next transpile it like first-party code.
  transpilePackages: ['a11y-widget'],
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
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
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
    ]
  },
}

export default nextConfig
