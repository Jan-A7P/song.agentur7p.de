import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '../css/app.css';
import '@/i18n';
import '@/lib/accent-color';
import '@/lib/carmine-mode';

const el = document.getElementById('root');

if (el) {
    createRoot(el).render(
        <StrictMode>
            <App />
        </StrictMode>,
    );
}
