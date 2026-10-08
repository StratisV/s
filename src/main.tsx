import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/figtree';
import '@fontsource/nunito/700.css';
import './styles/global.css';
import App from './App';
import { createBackend } from './lib/backend';
import { registerServiceWorker } from './lib/sw-register';
import { HomeProvider } from './state/HomeProvider';
import { ConfettiProvider } from './ui/Confetti';

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
