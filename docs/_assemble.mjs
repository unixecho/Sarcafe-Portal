import { readFileSync, writeFileSync } from 'node:fs'
const base = readFileSync('POS_BLUEPRINT.md', 'utf8')
const marker = '<!-- §9 Screens is inserted here by the build; see the "Screens" section. -->'
const head = base.includes(marker) ? base.split(marker)[0] : base
const a = readFileSync('_part9a.md', 'utf8')
const b = readFileSync('_part9b.md', 'utf8')
const c = readFileSync('_part10.md', 'utf8')
writeFileSync('POS_BLUEPRINT.md', head.trimEnd() + '\n\n---\n\n' + a.trimEnd() + '\n\n' + b.trimEnd() + '\n\n' + c)
console.log('assembled', readFileSync('POS_BLUEPRINT.md','utf8').split('\n').length, 'lines')
