# Rebuilding vendor/codraw-bundle.js

codraw's runtime (`index.html`) loads Excalidraw through ONE vendored,
self-contained ESM bundle: `vendor/codraw-bundle.js`. That bundle is
generated at build time by `stddoc bundle-codraw` (esbuild-in-Go,
`go/cmd/stddoc/bundlecodraw.go`) from the single hand-authored source
`codraw-glue.js`. **Nothing at runtime touches Node or npm** — this doc is
only for a developer who needs to regenerate the bundle (e.g. bumping the
vendored Excalidraw version).

## Why a `node_modules` is needed to build (but never to run)

`@excalidraw/excalidraw`'s published `dist/prod/index.js` is not a
fully self-contained bundle — it still has bare imports of its own real
dependencies (react, react-dom, jotai, roughjs, @radix-ui/*, and others).
esbuild needs those on disk to resolve and inline them into one file.

## One-time setup

```bash
cd go/stddoc-lib/lib/codraw
mkdir -p .scratch && cd .scratch
npm init -y >/dev/null
npm install @excalidraw/excalidraw@0.18.1 react@18.3.1 react-dom@18.3.1
cd ..
ln -s .scratch/node_modules node_modules   # bundle-codraw looks for this exact path
```

`node_modules` (real or symlinked) is **gitignored** — never committed.
Only `codraw-glue.js` (source) and `vendor/codraw-bundle.js` (generated
output) are checked in.

## Rebuild

```bash
cd go
go run ./cmd/stddoc bundle-codraw --dir stddoc-lib/lib/codraw
```

Produces `stddoc-lib/lib/codraw/vendor/codraw-bundle.js` — minified ESM,
~6-7 MB (Excalidraw + React 18 + its real dependency graph; locale files
other than the vendored `en` are marked external so they aren't inlined,
saving ~1.3 MB — see the comment in `bundlecodraw.go`). This is materially
larger than the 0.17.6 UMD bundle (1.1 MB) — the original proposal's "~10%
growth" estimate undersold this; the honest number is closer to 6x, almost
entirely Excalidraw's own real dependency tree (roughjs, jotai, @radix-ui)
that the UMD build had already tree-shaken/inlined more aggressively.
Flagged here rather than glossed over — MEASURED, not claimed.

## Bumping the vendored Excalidraw version

1. `npm install @excalidraw/excalidraw@<new-version>` inside `.scratch/`.
2. Re-copy the trimmed static asset tree (fonts, index.css, en locale) from
   `.scratch/node_modules/@excalidraw/excalidraw/dist/prod/` into
   `vendor/excalidraw-0.18.1/` (rename the vendor dir to match the new
   version) — keep ONLY the font families codraw actually preloads
   (Assistant, Cascadia, Excalifont, Virgil) and the `en` locale chunk.
3. Update the `EXCALIDRAW_ASSET_PATH` and stylesheet `<link>` paths in
   `index.html` if the vendor directory name changed.
4. `go run ./cmd/stddoc bundle-codraw --dir stddoc-lib/lib/codraw`.
5. Re-run the MEASURED cold-load check (58/58 bound-text bounding boxes
   non-zero) before shipping — see the PR for this Excalidraw ESM upgrade
   for the exact devtools script used.
