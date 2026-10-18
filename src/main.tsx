import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './ui/App';
import { offerUpdate } from './ui/pwa';
import './styles.css';

const updateSW = registerSW({
  onNeedRefresh() {
    offerUpdate(() => updateSW(true));
  },
});

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
