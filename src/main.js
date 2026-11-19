import './styles/tokens.css';
import './styles/globals.css';
import { mountApp } from './app/app.js';

const rootEl = document.getElementById('root');
if (rootEl) {
  mountApp(rootEl);
}
