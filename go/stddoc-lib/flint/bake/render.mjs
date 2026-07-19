// render.mjs — the live Flint bake (engine #3, Slice 1).
//
// Turns a Flint chart spec into a self-contained inline SVG in PURE NODE — no
// browser, no headless Chrome. Pipeline:
//
//   Flint spec {data, semantic_types, chart_spec, options}
//     -> flint-chart assembleVegaLite()   (Microsoft's MIT-licensed authoring layer)
//     -> vega-lite compile()              (Vega-Lite -> Vega)
//     -> vega View(renderer:'none').toSVG()  (headless SVG string)
//
// The emitted SVG inlines its own text/marks and reaches out to NOTHING, so the
// frozen artifact stays soul-clean (Covenant IV) exactly like a D2 or baked
// Mermaid diagram. This script is the ONLY place std-doc needs Node; the Slice-0
// embed path (a pre-rendered catalog SVG named by dtype) needs no Node at all.
//
// Usage:  node render.mjs <spec.json>   # prints SVG to stdout, errors to stderr
//         node render.mjs -             # read the spec from stdin

import { readFileSync } from 'node:fs';
import { assembleVegaLite } from 'flint-chart/vegalite';
import { compile } from 'vega-lite';
import { parse, View } from 'vega';

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    process.stderr.write('usage: node render.mjs <spec.json|->\n');
    process.exit(2);
  }
  const raw = arg === '-' ? readFileSync(0, 'utf8') : readFileSync(arg, 'utf8');
  const input = JSON.parse(raw);

  // Flint's authoring layer turns the {data, semantic_types, chart_spec} intent
  // into a full Vega-Lite spec (theme, encodings, layout).
  const vlSpec = assembleVegaLite(input);

  // Compile Vega-Lite -> Vega, then render headless to an SVG string.
  const vgSpec = compile(vlSpec).spec;
  const view = new View(parse(vgSpec), { renderer: 'none' });
  await view.runAsync();
  const svg = await view.toSVG();

  process.stdout.write(svg);
}

main().catch((err) => {
  process.stderr.write('flint-bake: ' + (err && err.stack ? err.stack : String(err)) + '\n');
  process.exit(1);
});
