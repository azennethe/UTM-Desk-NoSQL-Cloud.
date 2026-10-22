import {createRoot} from 'react-dom/client';import './index.css';import App from './App';
createRoot(document.getElementById('root')!).render(<App/>);
if('serviceWorker' in navigator&&import.meta.env.PROD)addEventListener('load',()=>navigator.serviceWorker.register('/sw.js'));
