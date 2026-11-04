// Extra cold-start probe. Import the browser helper from the isolated, pinned engine installation.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
export async function inspectOffline(root, html, handoff) {
  const { launch } = await import(pathToFileURL(path.join(root, 'packages/tools/src/chrome.mjs')).href);
  const browser = await launch(), blocked = [], errors = [];
  try {
    const page = await browser.newPage();
    const url = pathToFileURL(html); url.search = 'quality=medium&start=1';
    await page.setCacheEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', req => {
      const u = new URL(req.url());
      if (req.url() === url.href || ['data:', 'blob:', 'about:'].includes(u.protocol)) return req.continue();
      blocked.push(req.url()); return req.abort();
    });
    page.on('pageerror', error => errors.push(error.message));
    await page.setOfflineMode(true);
    await page.goto(url.href, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction('window.__READY === true', { timeout: 120000, polling: 100 });
    const facts = await page.evaluate(({ signalAnchor, railEye, railLook }) => {
      const { built, world } = window.__mirage, plan = built.plan;
      const providers = [...new Set((built.anchors[signalAnchor] || []).map(a => a.from))];
      const consumers = built.report.modules.filter(m => m.consumes?.some(a => a.key === signalAnchor && a.count > 0)).map(m => m.name);
      const [x0,z0,x1,z1] = plan.bounds, dx = railLook[0]-railEye[0], dz = railLook[2]-railEye[2], span = Math.hypot(dx,dz);
      const interior = t => {
        const x = railEye[0] + t * dx / span, z = railEye[2] + t * dz / span;
        return x > x0 + 0.3 && x < x1 - 0.3 && z > z0 + 0.3 && z < z1 - 0.3;
      };
      return { quality: world.ctx.quality, providers, consumers, names: plan.viewpoints.map(v => v.name),
        railInside: interior(0) && interior(3) };
    }, handoff);
    const names = new Set(facts.names.slice(0, 3).filter(n => typeof n === 'string' && n.trim()));
    return { ...facts, blocked, errors, browser: await browser.version(),
      pass: !blocked.length && !errors.length && facts.quality === 'medium' && facts.railInside && names.size >= 3 &&
        facts.providers.some(producer => facts.consumers.some(consumer => producer !== consumer)) };
  } catch (error) {
    throw new Error(error.message + '; blocked requests=' + JSON.stringify(blocked) + '; page errors=' + JSON.stringify(errors));
  } finally { await browser.close(); }
}
