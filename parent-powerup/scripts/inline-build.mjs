// Turns the `--mode single` build into one self-contained page (README "Previews"): the title,
// the stylesheet, the root element and the script, all inline, with no document wrapper of its
// own (the host page that shows a preview supplies the <html>, <head> and safe-area padding).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] || 'dist-single';
const out = process.argv[3] || join(dir, 'parent-powerup.html');
const html = readFileSync(join(dir, 'index.html'), 'utf8');

const local = (href) => join(dir, href.replace(/^\.?\//, ''));
const all = (re) => [...html.matchAll(re)].map((m) => m[1]);

const css = all(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)
  .map((href) => readFileSync(local(href), 'utf8'))
  .join('\n');
const js = all(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g)
  .map((src) => readFileSync(local(src), 'utf8').replace(/<\/script/gi, '<\\/script'))
  .join('\n');
if (!css || !js) throw new Error('No stylesheet or script found in the build');

const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? 'Parent Powerup';

// The host pads the page top and bottom by the safe areas already; the tab bar, fixed to the
// bottom edge, still adds its own.
const host = ':root{--top-inset:0px}';

const page = `<title>${title}</title>
<style>${css}
${host}</style>
<div id="root"></div>
<script type="module">${js}</script>
`;

writeFileSync(out, page);
console.log(`${out}: ${(Buffer.byteLength(page) / 1024).toFixed(0)} KB`);
