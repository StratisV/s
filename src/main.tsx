import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/figtree';
import '@fontsource/nunito/700.css';
import './styles/global.css';
import App from './App';
import { BACKEND_MODE, createBackend } from './lib/backend';
import { applyPreviewInset } from './lib/preview';
import { goalsTokenIn } from './lib/logic/goals';
import { captureServerLinks } from './lib/serverLinks';
import { captureSharedLink } from './lib/sharedLink';
import { registerServiceWorker } from './lib/sw-register';
import { watchForUpdates } from './lib/update';
import { PublicGoalsPage } from './screens/goals/PublicGoalsPage';
import { HomeProvider } from './state/HomeProvider';
import { ConfettiProvider } from './ui/Confetti';

applyPreviewInset();
// A shared ?item= or ?area= link: kept until the household has loaded (through sign-in if need be).
captureSharedLink();
// Server mode: a ?setup= or ?code= link is kept until the Welcome screen uses it.
if (BACKEND_MODE === 'server') captureServerLinks();

const root = createRoot(document.getElementById('root')!);
// The public goals link (?goals=<token>): its own page for anyone, signed in or not.
const goalsToken = goalsTokenIn(window.location.search);

createBackend().then((backend) => {
  root.render(
    goalsToken !== null ? (
      <StrictMode>
        <PublicGoalsPage token={goalsToken} read={(token) => backend.publicGoals(token)} />
      </StrictMode>
    ) : (
      <StrictMode>
        <HomeProvider backend={backend}>
          <ConfettiProvider>
            <App />
          </ConfettiProvider>
        </HomeProvider>
      </StrictMode>
    ),
  );
});

registerServiceWorker();
watchForUpdates();
