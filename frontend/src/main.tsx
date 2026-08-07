import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import { AppToaster } from './components/AppToaster';
import { ForcePasswordChangeModal } from './components/ForcePasswordChangeModal';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { queryClient } from './lib/queryClient';
import 'sonner/dist/styles.css';
import './index.css';
import 'highlight.js/styles/vs2015.min.css';

// После деплоя старый main-бандл может тянуть несуществующие lazy-чанки.
// Один раз перезагружаем страницу, чтобы подтянуть новый index.html с актуальными хэшами.
const CHUNK_RELOAD_KEY = "mess-chunk-reload";
function isChunkLoadError(reason: unknown): boolean {
  const msg = String(
    reason instanceof Error ? reason.message : (reason as { message?: string })?.message ?? reason ?? "",
  );
  return /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk \d+ failed|Expected a JavaScript-or-Wasm module script/i.test(
    msg,
  );
}
window.addEventListener("unhandledrejection", (event) => {
  if (!isChunkLoadError(event.reason)) return;
  if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    return;
  }
  sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/mes">
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <App />
            <ForcePasswordChangeModal />
            <AppToaster />
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>
);
