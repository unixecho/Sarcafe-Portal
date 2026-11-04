# glass-preview (source of the approved-in-principle glisse dashboard preview)

Not part of the app and not built by Vercel. See `docs/SARCAFE_GLASS_UI_STYLE.md` for the rules, findings and the plan to apply it.
The `.ts`/`.tsx` files end in `.txt` so the repo's `tsc` and `next build` ignore them (glisse is not a dependency here).

Rebuild it OUTSIDE the repo (a `node_modules` here would be untracked and not ignored):

```bash
cp -r docs/glass-preview /tmp/glass-preview && cd /tmp/glass-preview
for f in src/*.txt; do mv "$f" "${f%.txt}"; done
npm init -y && npm i react@19 react-dom@19 lucide-react@1 glisse@0.5.0 esbuild playwright
SARCAFE_PUBLIC=/path/to/Sarcafe-Portal/public node build.mjs   # writes dashboard-glisse-preview.html (one file, ~2 MB)
node wrap.mjs                                                  # wrapped.html = the page inside the publisher's skeleton
node checks/test-search.mjs                                    # search engine (run from this folder; needs src/search.ts)
node checks/navtest.cjs && node checks/segtest.cjs             # bottom nav and every segmented control
node checks/contrast.cjs 390                                   # text contrast against the real pixels; pass a width
node checks/perf.cjs wrapped.html                              # frame times at 4x CPU throttle
```

The sample data (names, orders, requests, rota) in `data.ts` is invented; the routes in the tool index are the real ones.
