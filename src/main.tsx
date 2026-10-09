import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/figtree';
import '@fontsource/nunito/700.css';
import './styles/global.css';
import App from './App';
import { createBackend } from './lib/backend';
import { applyPreviewInset } from './lib/preview';
import { captureSharedLink } from './lib/sharedLink';
import { registerServiceWorker } from './lib/sw-register';
import { watchForUpdates } from './lib/update';
import { HomeProvider } from './state/HomeProvider';
import { ConfettiProvider } from './ui/Confetti';

applyPreviewInset();
// A shared ?item= or ?area= link: kept until the household has loaded (through sign-in if need be).
captureSharedLink();

const root = createRoot(document.getElementById('root')!);

createBackend().then((backend) => {
  root.render(
    <StrictMode>
      <HomeProvider backend={backend}>
        <ConfettiProvider>
          <App />
        </ConfettiProvider>
      </HomeProvider>
    </StrictMode>,
  );
});

registerServiceWorker();
watchForUpdates();
