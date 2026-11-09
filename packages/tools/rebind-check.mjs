#!/usr/bin/env node
// A pending "press a key" rebind ends when the menu leaves it (Back, Resume): the next key in play must not be
// swallowed and bound. Needs Chrome with a GPU, so it is not in npm test:
//   node packages/tools/rebind-check.mjs examples/garden-quest/dist   (main before 1.0: jump became W)
import { launch, serve, open } from './src/chrome.mjs';
const dist = process.argv[2];
const srv = await serve(dist), browser = await launch({ w: 960, h: 600 });
try {
  const { page, errors } = await open(browser, srv.url + '?quality=low');
  const ui = await page.evaluate(() => !!document.querySelector('.mg-menu'));
  await page.keyboard.press('KeyW'); await new Promise((r) => setTimeout(r, 300));          // leave the start screen
  const before = await page.evaluate(() => JSON.stringify(window.__mirage?.session?.input?.bindings || window.__game?.input?.bindings || null));
  await page.keyboard.press('Escape'); await new Promise((r) => setTimeout(r, 300));        // menu
  const opened = await page.evaluate(() => document.querySelector('.mg-menu')?.open);
  await page.click('.mg-menu [data-p="controls"]');
  await page.click('.mg-menu [data-bind="jump"]');
  const waiting = await page.evaluate(() => document.querySelector('.mg-menu [data-bind="jump"]')?.textContent);
  await page.click('.mg-menu [data-p="main"]');                                              // Back
  await page.click('.mg-menu [data-do="resume"]');
  await new Promise((r) => setTimeout(r, 200));
  await page.keyboard.down('KeyW'); await new Promise((r) => setTimeout(r, 400)); await page.keyboard.up('KeyW');
  const saved = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.endsWith(':settings')).map(([, v]) => v).join());
  console.log(JSON.stringify({ ui, opened, waiting, saved, errors }));
  const ok = opened && waiting === 'press a key…' && !/KeyW/.test(JSON.parse(saved || '{}')?.bindings?.jump?.join?.() || '');
  console.log(ok ? 'rebind check: ok (W was not bound to jump)' : 'rebind check: FAIL');
  process.exitCode = ok ? 0 : 1;
} finally { await browser.close(); srv.close(); }
