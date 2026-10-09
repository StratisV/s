// Dev-only harness for the Item sheet (deleted at integration; never import from app code).
// /dev/item.html?demo-seed=1&frame&open=Heaters%20not%20working   edit an item by title
// /dev/item.html?demo-seed=1&frame&open=new[&area=Garden]           new item
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/global.css';
import appStyles from '../App.module.css';
import { DemoBackend } from '../lib/backend/demo';
import { applyPreviewInset } from '../lib/preview';
import { ItemSheet } from '../screens/item/ItemSheet';
import type { ItemSheetTarget } from '../screens/types';
import { HomeProvider, useHome } from '../state/HomeProvider';
import { ConfettiProvider } from '../ui/Confetti';
import { Toast } from '../ui/Toast';

applyPreviewInset();

function Harness() {
  const { phase, data } = useHome();
  const [target, setTarget] = useState<ItemSheetTarget | null>(null);
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  const auto = useRef(false);

  const openSheet = (t: ItemSheetTarget) => {
    setTarget(t);
    setKey((k) => k + 1);
    setOpen(true);
  };

  useEffect(() => {
    if (auto.current || phase.kind !== 'ready' || !data) return;
    auto.current = true;
    const params = new URLSearchParams(window.location.search);
    const want = params.get('open');
    if (!want) return;
    if (want === 'new') {
      const area = data.areas.find((a) => a.name === params.get('area'));
      openSheet({ kind: 'new', areaId: area?.id });
    } else {
      const item = data.items.find((i) => i.title === want);
      if (item) openSheet({ kind: 'edit', itemId: item.id });
    }
  }, [phase, data]);

  if (phase.kind !== 'ready' || !data) return <p style={{ padding: 80 }}>{phase.kind}</p>;

  return (
    <div className={appStyles.main} data-pushed={open || undefined}>
      <div className={appStyles.stage} aria-hidden={open || undefined}>
        <div style={{ position: 'absolute', inset: 0, background: 'var(--bg)', padding: 'calc(var(--top-inset) + 60px) 16px 0', display: 'grid', alignContent: 'start', gap: 8 }}>
          <button type="button" data-testid="new" onClick={() => openSheet({ kind: 'new' })}>
            New item
          </button>
          {data.items.map((i) => (
            <button key={i.id} type="button" data-testid="open-item" onClick={() => openSheet({ kind: 'edit', itemId: i.id })}>
              {i.title} · {i.rag} · {i.due_date ?? 'no date'} · {i.repeat} · {i.notify}
            </button>
          ))}
        </div>
        <div className={appStyles.dim} aria-hidden="true" />
      </div>
      {target ? (
        <ItemSheet
          key={key}
          target={target}
          open={open}
          onClose={() => setOpen(false)}
          onExited={() => setTarget(null)}
        />
      ) : null}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HomeProvider backend={new DemoBackend()}>
      <ConfettiProvider>
        <div className={appStyles.viewport}>
          <div className={appStyles.column}>
            <Harness />
          </div>
          <Toast />
        </div>
      </ConfettiProvider>
    </HomeProvider>
  </StrictMode>,
);
