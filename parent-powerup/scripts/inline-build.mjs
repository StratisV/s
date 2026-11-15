// Turns the `--mode single` build into one self-contained HTML page (the preview, README
// "Previews"): the stylesheet and the script go inline, the icon becomes a data URI, and the
// manifest link is dropped (an inline page has nowhere to fetch it from).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] || 'dist-single';
const out = process.argv[3] || join(dir, 'parent-powerup.html');
let html = readFileSync(join(dir, 'index.html'), 'utf8');

const local = (href) => join(dir, href.replace(/^\.?\//, ''));

html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_, href) => `<style>${readFileSync(local(href), 'utf8')}</style>`);
html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g, (_, src) => {
  const code = readFileSync(local(src), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script type="module">${code}</script>`;
});
html = html.replace(/<link rel="manifest"[^>]*>\s*/g, '');
const icon = `data:image/svg+xml;base64,${readFileSync(join(dir, 'icons/icon.svg')).toString('base64')}`;
html = html.replace(/href="[^"]*icons\/icon\.svg"/g, `href="${icon}"`);

writeFileSync(out, html);
console.log(`${out}: ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
