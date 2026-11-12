// The installable app: the service worker (public/sw.js) and the browser's install offer. Only for the hosted build:
// it registers where the page links its manifest (vite.config.js adds the link at build time), over https or on
// localhost, in the top window; never from file:// (the single-file package), the dev server or a sandboxed frame.
let offer = null;
const listeners = new Set();
const tell = () => { for (const f of listeners) try { f(); } catch { /* a listener's own trouble */ } };

try {
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.hostname.endsWith('.localhost');
  if (window.top === window && (location.protocol === 'https:' || (location.protocol === 'http:' && local))
    && document.querySelector('link[rel=manifest]') && 'serviceWorker' in navigator) {
    const go = () => { try { navigator.serviceWorker.register('./sw.js').catch(() => {}); } catch { /* blocked here */ } };
    if (document.readyState === 'complete') go(); else addEventListener('load', go, { once: true });
  }
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); offer = e; tell(); });
  addEventListener('appinstalled', () => { offer = null; tell(); });
} catch { /* no service workers here */ }

/** the browser offers to install the game (beforeinstallprompt came) */
export const canInstall = () => !!offer;
/** show the browser's own install prompt (once per offer) */
export async function install() {
  const e = offer;
  if (!e) return false;
  offer = null; tell();
  try { await e.prompt(); return (await e.userChoice)?.outcome === 'accepted'; } catch { return false; }
}
/** fn() when the offer comes or goes */
export const onInstallChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
