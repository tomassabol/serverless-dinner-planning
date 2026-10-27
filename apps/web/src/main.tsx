import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { configureAuth, enablePreviewAuth } from './auth';
import { loadConfig } from './config';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

async function start() {
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('preview')) {
    const { installPreview } = await import('./dev/preview');
    installPreview();
    enablePreviewAuth();
    return;
  }
  configureAuth(await loadConfig());
}

start()
  .then(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    root.render(<p className="error">Could not start the app: {String(error)}</p>);
  });
