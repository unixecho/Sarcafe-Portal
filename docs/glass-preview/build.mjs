import { build } from 'esbuild'
import fs from 'node:fs'
const b64 = (p, mime) => `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`
const repo = process.env.SARCAFE_PUBLIC ?? '../../public'
const logo = b64(`${repo}/sarcafe-logo.png`, 'image/png')
const backdrop = b64(`${repo}/backdrops/givat-haviva-1-portrait.webp`, 'image/webp')
const out = await build({
  entryPoints: ['src/main.tsx'], bundle: true, write: false, minify: true, format: 'iife', outdir: 'out', jsx: 'automatic',
  define: { LOGO: JSON.stringify(logo), BACKDROP: JSON.stringify(backdrop), 'process.env.NODE_ENV': '"production"' },
  loader: { '.css': 'css' },
})
const js = out.outputFiles.find((f) => f.path.endsWith('.js')).text
const css = out.outputFiles.find((f) => f.path.endsWith('.css')).text
// glisse's dark tokens re-emitted on bare :root (it only applies them for [data-theme=dark] / a dark OS), so this deliberately dark-only page looks the same for every viewer.
const g = fs.readFileSync('node_modules/glisse/dist/styles.css', 'utf8')
const dark = g.match(/:where\(\[data-theme="dark"\]\)\s*\{([^}]*)\}/)[1]
const html = `<title>לוח בקרה זכוכית</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>:root{${dark}}${css}</style>
<div id="root"></div><script>${js.replace(/<\/script>/g, '<\\/script>')}</script>`
fs.writeFileSync('dashboard-glisse-preview.html', html)
console.log('bytes', html.length)
