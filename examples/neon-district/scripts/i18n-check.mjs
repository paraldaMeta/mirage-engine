#!/usr/bin/env node
// Check: the three tables of game/text.js (Traditional Chinese, English, Japanese) against each other, in Node.
//   fails on  a key missing in a table (or extra, or of another kind), an empty string where English has text,
//             a `zh` string with a Simplified-only character (a list of common ones: there is no Simplified table,
//             and Taiwan readers see these as wrong), a `ja` string with no kana or kanji where the English has
//             words (an untranslated line), a `zh` string with no Han character where the English has words, and
//             an engine key (@miragekit/game's UI_STRINGS) the game's `engine` tables lack
//   prints    strings whose display width (a CJK character counts two) exceeds the English by more than 60 %:
//             places to look at on screen for overflow; not a failure
// Function entries (a line with numbers in it) are called with sample values and checked as their result.
// usage: node scripts/i18n-check.mjs [--all] (--all prints every long string, not only the first 40)
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { TABLES, shapeProblems, pickLang } = await import(pathToFileURL(path.join(here, '../game/text.js')).href);
const { UI_STRINGS } = await import(pathToFileURL(path.join(here, '../../../packages/game/src/ui.js')).href);

// common characters that exist only in Simplified Chinese (each has a Traditional form the zh table must use)
const SIMPLIFIED = new Set([...'们这个为说时会发对开关门问间没还让进过设网软质号机车东动区图线级战枪弹击头敌装备储转换录载帧应该与样实现务给办经电视话读写请认识报传达选择节点缓据库标题页错误连亲爱学习书买卖长马鸟鱼风飞乐广产业丢两举义从仓价众优伤体侧儿兴关决减划则刚创删别剂剧劳势医华单卫历压厅参双变叶吗启员响团园围圆场坏块声处复够夺奖妈宝实审宽导将层岁岛币师带帮废张强归当彻忆态总恶惊惯户执扩扫护报担挂挡据损数断无旧显晓暂术杀杂权条来极构树档桥梦检楼欢残气汇汉测济满灭灯灵灾热献环画疗种积称稳穷竞笔简类粮纪练组细织终结络统续维绿编罗罚职联脑脚脸腾舰艺药获营虑虽补见观规觉触计订认讨训议讯记讲许论访证评诉词译试询详语误谁调谈谢贝负财责败货购贵费资赛赞赢赶跃转轮轰轻较辆输边运远违迟适递遗邮针钟钢钥钱铁银锁键镜闪闭闲闻阅队阳阴阵阶际陆险随难静韩顶项顺须顾预领频驱驾验骗鲜鸡鸣麦黄齐龄龙龟']);
const ACRONYM = /^[A-Z0-9 ·/+.-]+$/;   // BGM, EMP, ALT, key names: the same in every language
const KANA = /[぀-ヿㇰ-ㇿ]/, HAN = /[㐀-鿿豈-﫿]/, WORDS = /[A-Za-z]{2,}/;
const width = (s) => [...s].reduce((n, c) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(c) ? 2 : 1), 0);
const sample = (fn) => fn.length === 1 && /\bs\./.test(String(fn))
  ? fn({ diff: 'STANDARD', rating: 'Clean work', min: 4, sec: 12, kills: 23, acc: 41, shots: 312, heads: 7, deaths: 1, waves: 6, best: 9 })
  : fn(...[3, 'MISSION', 'NIGHT'].slice(0, Math.max(1, fn.length)).map((v, i) => (fn.length === 3 ? ['MISSION', 'STANDARD', 'NIGHT'][i] : fn.length === 2 ? [3, 12][i] : v)));
/** every leaf as [path, string] (functions called) */
function leaves(t, p = '', out = []) {
  if (typeof t === 'function') out.push([p, String(sample(t))]);
  else if (typeof t === 'string') out.push([p, t]);
  else if (Array.isArray(t)) t.forEach((v, i) => leaves(v, `${p}.${i}`, out));
  else if (t && typeof t === 'object') for (const [k, v] of Object.entries(t)) leaves(v, p ? `${p}.${k}` : k, out);
  return out;
}
const bad = [], long = [];
const EN = new Map(leaves(TABLES.en));
for (const name of ['zh', 'ja']) bad.push(...shapeProblems(TABLES[name], name));
for (const [name, table] of Object.entries(TABLES)) {
  for (const [p, s] of leaves(table)) {
    const en = EN.get(p) ?? EN.get(p.replace(/\.\d+$/, '.0')) ?? '';
    if (!s.trim() && en.trim()) bad.push(`${name}: ${p} is empty`);
    if (name === 'en') continue;
    if (name === 'zh') {
      const simp = [...s].filter((c) => SIMPLIFIED.has(c));
      if (simp.length) bad.push(`zh: ${p} has Simplified characters ${[...new Set(simp)].join('')}: "${s}"`);
      if (!HAN.test(s) && WORDS.test(en) && s !== en && WORDS.test(s.replace(/\b(K|P|M|G|RL)-\d+\b|MIRAGE|ALT|CAM|RELAY-07/g, ''))) bad.push(`zh: ${p} has no Chinese where English has words: "${s}"`);
    }
    if (name === 'ja' && !KANA.test(s) && !HAN.test(s) && WORDS.test(en) && s !== en && !ACRONYM.test(s)) bad.push(`ja: ${p} has no kana or kanji where English has words: "${s}"`);
    if (en && width(s) > width(en) * 1.6 && width(s) - width(en) > 4) long.push(`${name} ${p}: ${width(s)} vs ${width(en)} (${Math.round(100 * width(s) / width(en) - 100)} % longer): "${s}"`);
  }
}
for (const [name, table] of Object.entries(TABLES)) for (const k of Object.keys(UI_STRINGS)) if (!table.engine || typeof table.engine[k] !== 'string' || !table.engine[k]) bad.push(`${name}: engine.${k} (an @miragekit/game UI_STRINGS key) is missing`);
// the language picking: ?lang= first, the saved choice, then the browser (any zh gets Traditional: no Simplified table)
const Q = (q) => new URLSearchParams(q);
for (const [args, want] of [[[Q('lang=ja'), 'en', ['zh-TW']], 'ja'], [[Q(''), 'zh', ['ja-JP']], 'zh'], [[Q(''), null, ['ja-JP']], 'ja'], [[Q(''), null, ['zh-TW']], 'zh'],
  [[Q(''), null, ['zh-HK']], 'zh'], [[Q(''), null, ['zh-CN']], 'zh'], [[Q(''), null, ['fr-FR']], 'en'], [[Q('lang=xx'), 'nope', ['en-GB']], 'en']]) {
  const got = pickLang(...args);
  if (got !== want) bad.push(`pickLang(${args[0]}, ${args[1]}, ${args[2]}) = ${got}, want ${want}`);
}
const n = Object.fromEntries(Object.entries(TABLES).map(([k, t]) => [k, leaves(t).length]));
if (long.length) {
  console.log(`longer than the English by more than 60 % (display width, CJK counted double; look at these on screen): ${long.length}`);
  for (const l of process.argv.includes('--all') ? long : long.slice(0, 40)) console.log('  ' + l);
}
for (const b of bad) console.log('FAIL ' + b);
console.log(`neon-district i18n: ${n.en} strings in en, ${n.zh} in zh, ${n.ja} in ja; ${bad.length} problems -> ${bad.length ? 'FAIL' : 'ok'}`);
process.exit(bad.length ? 1 : 0);
