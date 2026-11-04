// Wraps the built fragment the way the artifact publisher does, so the checks run against what viewers get.
import fs from 'node:fs'
const s = fs.readFileSync('dashboard-glisse-preview.html', 'utf8')
fs.writeFileSync('wrapped.html', '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}</style></head><body>' + s + '</body></html>')
