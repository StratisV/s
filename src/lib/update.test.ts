// @vitest-environment jsdom
import { busy, newVersionDeployed, runningScript, scriptIn } from './update';

function page(src: string | null): Document {
  const doc = document.implementation.createHTMLDocument('home.os');
  if (src) {
    const s = doc.createElement('script');
    s.type = 'module';
    s.setAttribute('src', src);
    doc.head.append(s);
  }
  return doc;
}

const html = (src: string) =>
  `<!doctype html><html><head><script type="module" crossorigin src="${src}"></script></head><body></body></html>`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('update check', () => {
  it('reads the main script of this page and of an index page', () => {
    expect(runningScript(page('/assets/index-AAAA.js'))).toBe('/assets/index-AAAA.js');
    expect(runningScript(page(null))).toBeNull();
    expect(scriptIn(html('/assets/index-BBBB.js'))).toBe('/assets/index-BBBB.js');
    expect(scriptIn('<html></html>')).toBeNull();
  });

  it('says a new version is deployed when the index page names another script', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html('/assets/index-BBBB.js'))));
    expect(await newVersionDeployed('/', page('/assets/index-AAAA.js'))).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/', expect.objectContaining({ cache: 'no-store' }));
  });

  it('is quiet when it is the same version, offline, or the server fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html('/assets/index-AAAA.js'))));
    expect(await newVersionDeployed('/', page('/assets/index-AAAA.js'))).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
    expect(await newVersionDeployed('/', page('/assets/index-AAAA.js'))).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })));
    expect(await newVersionDeployed('/', page('/assets/index-AAAA.js'))).toBe(false);
    // Dev server: no hashed script, nothing to compare.
    expect(await newVersionDeployed('/', page(null))).toBe(false);
  });

  it('does not reload over unsent words, a failed send or a toast', () => {
    const doc = page(null);
    const draft = doc.createElement('textarea');
    draft.value = 'Bin day tomorrow';
    doc.body.append(draft);
    expect(busy(doc)).toBe(true);
    draft.value = '  ';
    expect(busy(doc)).toBe(false);
    const failed = doc.createElement('div');
    failed.dataset.state = 'failed';
    doc.body.append(failed);
    expect(busy(doc)).toBe(true);
    failed.remove();
    const toast = doc.createElement('div');
    toast.setAttribute('role', 'status');
    doc.body.append(toast);
    expect(busy(doc)).toBe(false);
    toast.textContent = 'Marked as done';
    expect(busy(doc)).toBe(true);
  });

  it('does not reload over an open sheet or a focused field', () => {
    const doc = page(null);
    expect(busy(doc)).toBe(false);
    const dialog = doc.createElement('div');
    dialog.setAttribute('role', 'dialog');
    doc.body.append(dialog);
    expect(busy(doc)).toBe(true);
    dialog.remove();
    const field = doc.createElement('textarea');
    doc.body.append(field);
    field.focus();
    expect(busy(doc)).toBe(doc.activeElement === field);
  });
});
