#!/usr/bin/env node
// Mirage original code. Part of the Capacitor scaffold written by `mirage-ship` (template). Run it once after
// `npx cap add ios` / `npx cap add android` (and again after you delete and re-add a platform): it puts the
// settings in native/ into the native project Capacitor made. It edits text, shows what it changed and changes
// nothing twice. It never touches signing: that stays yours, in Xcode and in your own keystore.
//   node scripts/apply-native.mjs            (both platforms, whichever exist)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** the top-level <key>…</key><value/> pairs of a plist's root <dict>, as source text */
export function plistEntries(xml) {
  const body = xml.slice(xml.indexOf('<dict>') + 6, xml.lastIndexOf('</dict>'));
  const out = [];
  const re = /<key>([^<]+)<\/key>\s*/g;
  let m;
  while ((m = re.exec(body))) {
    const start = re.lastIndex;
    const open = /^<(\w+)(\s*\/)?>/.exec(body.slice(start));
    if (!open) throw new Error(`plist: no value after <key>${m[1]}</key>`);
    let end;
    if (open[2]) end = start + open[0].length;                         // <true/> <false/>
    else {                                                             // matching close tag, nesting counted
      const tag = open[1], re2 = new RegExp(`<${tag}>|</${tag}>`, 'g');
      re2.lastIndex = start;
      let depth = 0, t;
      while ((t = re2.exec(body))) { depth += t[0][1] === '/' ? -1 : 1; if (depth === 0) break; }
      if (!t) throw new Error(`plist: <${tag}> of ${m[1]} is not closed`);
      end = t.index + t[0].length;
    }
    out.push({ key: m[1], from: m.index, to: end, value: body.slice(start, end) });
    re.lastIndex = end;
  }
  return out;
}

/** Info.plist text with every key of `additions` set (replaced when present, added before the last </dict>) */
export function mergePlist(target, additions) {
  let out = target;
  const changed = [];
  for (const add of plistEntries(additions)) {
    const off = out.indexOf('<dict>') + 6;
    const have = plistEntries(out).find((e) => e.key === add.key);
    if (have) {
      if (have.value.replace(/\s+/g, '') === add.value.replace(/\s+/g, '')) continue;
      out = out.slice(0, off + have.from) + `<key>${add.key}</key>\n\t${add.value}` + out.slice(off + have.to);
    } else {
      const at = out.lastIndexOf('</dict>');
      out = out.slice(0, at) + `\t<key>${add.key}</key>\n\t${add.value}\n` + out.slice(at);
    }
    changed.push(add.key);
  }
  return { text: out, changed };
}

/** AndroidManifest.xml text with the attributes of `attrs` set on the first <activity> and the <uses-feature>
 *  lines of `features` present before <application */
export function patchManifest(xml, { attrs = {}, features = [] } = {}) {
  const changed = [];
  let out = xml.replace(/<activity\b[^>]*>/, (tag) => {
    let t = tag;
    for (const [k, v] of Object.entries(attrs)) {
      const re = new RegExp(`\\s${k}="[^"]*"`);
      if (re.test(t)) { if (!t.includes(` ${k}="${v}"`)) { t = t.replace(re, ` ${k}="${v}"`); changed.push(k); } }
      else { t = t.replace(/\s*\/?>$/, (end) => ` ${k}="${v}"${end.trim() === '/>' ? ' />' : '>'}`); changed.push(k); }
    }
    return t;
  });
  for (const f of features) {
    const id = /android:(?:name|glEsVersion)="([^"]+)"/.exec(f)?.[1];
    if (id && out.includes(`"${id}"`)) continue;
    out = out.replace(/(\n?[ \t]*)<application\b/, (m, indent) => `${indent}${f}${indent || '\n'}<application`);
    changed.push(id || f);
  }
  return { text: out, changed };
}

/** styles.xml with the <item>s of `items` set inside the style named `style` */
export function patchStyle(xml, style, items) {
  const changed = [];
  const re = new RegExp(`(<style\\b[^>]*name="${style.replace(/\./g, '\\.')}"[^>]*>)([\\s\\S]*?)(</style>)`);
  if (!re.test(xml)) return { text: xml, changed, missing: true };
  const out = xml.replace(re, (all, open, body, close) => {
    for (const [name, value] of Object.entries(items)) {
      const item = new RegExp(`<item name="${name.replace(/\./g, '\\.')}">[^<]*</item>`);
      const next = `<item name="${name}">${value}</item>`;
      if (item.test(body)) { if (!body.includes(next)) { body = body.replace(item, next); changed.push(name); } }
      else { body = body.replace(/\s*$/, '') + `\n        ${next}\n    `; changed.push(name); }
    }
    return open + body + close;
  });
  return { text: out, changed };
}

function run() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'native', 'mirage-native.json'), 'utf8'));
  const say = (what, changed) => console.log(`[apply-native] ${what}: ${changed.length ? 'set ' + changed.join(', ') : 'already up to date'}`);
  let did = false;
  const plist = path.join(ROOT, 'ios', 'App', 'App', 'Info.plist');
  if (fs.existsSync(plist)) {
    did = true;
    const r = mergePlist(fs.readFileSync(plist, 'utf8'), fs.readFileSync(path.join(ROOT, 'native', 'ios', 'Info.additions.plist'), 'utf8'));
    if (r.changed.length) fs.writeFileSync(plist, r.text);
    say('ios Info.plist', r.changed);
    const privacy = path.join(ROOT, 'ios', 'App', 'App', 'PrivacyInfo.xcprivacy');
    if (!fs.existsSync(privacy)) {
      fs.copyFileSync(path.join(ROOT, 'native', 'ios', 'PrivacyInfo.xcprivacy'), privacy);
      console.log('[apply-native] ios PrivacyInfo.xcprivacy copied. In Xcode: add it to the App target (File > Add Files to "App"), or it is not shipped.');
    }
  }
  const manifest = path.join(ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  if (fs.existsSync(manifest)) {
    did = true;
    const r = patchManifest(fs.readFileSync(manifest, 'utf8'), cfg.android.manifest);
    if (r.changed.length) fs.writeFileSync(manifest, r.text);
    say('android AndroidManifest.xml', r.changed);
    const styles = path.join(ROOT, 'android', 'app', 'src', 'main', 'res', 'values', 'styles.xml');
    if (fs.existsSync(styles)) {
      const s = patchStyle(fs.readFileSync(styles, 'utf8'), cfg.android.style, cfg.android.styleItems);
      if (s.missing) console.log(`[apply-native] android styles.xml has no style "${cfg.android.style}": add the items of native/android/styles.additions.xml to your activity theme by hand`);
      else { if (s.changed.length) fs.writeFileSync(styles, s.text); say('android styles.xml', s.changed); }
    }
  }
  if (!did) console.log('[apply-native] no ios/ or android/ folder yet: run `npx cap add ios` or `npx cap add android` first');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
