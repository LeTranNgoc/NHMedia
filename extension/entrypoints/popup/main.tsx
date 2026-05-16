import { createRoot } from 'react-dom/client';
import App from './App';
import '../../src/popup/popup.css';
import { initSentry } from '../../src/shared/observability';

initSentry('popup');

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(<App />);
