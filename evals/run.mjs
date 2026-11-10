#!/usr/bin/env node
// Mirage original code. The repair-rate eval: give an agent CLI a broken world and what the playtest says about it,
// let it edit a copy of the world, re-run the machine check, record pass / fail, turns, tool calls and wall time.
//
// usage: node evals/run.mjs --cmd "<agent command>" [options]
//   --cmd "..."        the agent, run with /bin/sh -c in the task's world folder; the prompt goes to its stdin
//                      (claude -p and codex exec read stdin), or as the last argument with --prompt-arg. Examples:
//                        --cmd "claude -p --permission-mode acceptEdits --output-format stream-json --verbose"
//                        --cmd "codex exec --full-auto --json"
//   --mode one|multi   one: the report once, one agent call, then the check (one-turn self-repair).
//                      multi: after each call the check runs again and the agent gets the new report, up to --turns.
//   --turns N          multi mode: at most N agent calls (default 3)
//   --arms diag,raw    diag: the diagnostics (codes, messages, fixes; DIAGNOSTICS.md). raw: what the playtest said
//                      before diagnostics existed (failing checks, step errors, console errors, failed modules;
//                      REPORT.md). Default both, so the codes and fixes can be measured against the raw errors.
//   --tasks a,b        only these tasks (default all in evals/tasks)
//   --timeout S        seconds per agent call (default 900)
//   --out DIR          results (default evals/results/<timestamp>): results.json, summary.md, per run: the prompts,
//                      the agent's stdout / stderr, the check reports
//   --dry              no agent: write the prompts and run the checks of the untouched start (everything fails);
//                      proves the plumbing without a model call
//   --oracle           no agent: the "agent" copies the task's reference fix (everything should pass)
// Tool calls are counted from the agent's output when it is JSON lines (claude --output-format stream-json:
// tool_use blocks; codex exec --json: command / file-change / tool items); otherwise null.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tasks, materialize, machineCheck, closeServer, worldHash, WORK, EVALS } from './lib.mjs';

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const has = (k) => args.includes('--' + k);
const dry = has('dry'), oracle = has('oracle'), cmd = flag('cmd');
if (!dry && !oracle && !cmd) { console.error('usage: node evals/run.mjs --cmd "<agent command>" [--mode one|multi] [--turns N] [--arms diag,raw] [--tasks a,b] [--dry | --oracle]'); process.exit(2); }
const mode = flag('mode', 'one'), turns = mode === 'multi' ? +flag('turns', 3) : 1;
const arms = flag('arms', 'diag,raw').split(',');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = path.resolve(flag('out', path.join(EVALS, 'results', stamp)));
const timeout = +flag('timeout', 900) * 1000;
fs.mkdirSync(OUT, { recursive: true });

// ---- what the agent is told
const RULES = (multi, turn) => `Rules:
- The world is this folder: plan.js (the site plan), modules/*.js (one file per module), main.js, index.html. It is a
  Mirage world (three.js); it loads in a browser, you cannot run it here${multi ? '' : ', and you get one attempt'}.
- Edit only files in this folder. Do not edit scenario.json or TASK.md: the check uses its own copy of the scenario.
- Make the smallest change that fixes the problem; keep everything else as it is.
- When you are done, stop. ${multi ? `The harness re-runs the check and, if it still fails, calls you again with the new report (this is attempt ${turn} of ${turns}).` : 'The harness then runs the check once.'}`;

function diagText(report) {
  const list = report.diagnostics.filter((d) => d.severity !== 'info');
  return `# Diagnostics (${report.pass ? 'the playtest passes' : 'the playtest FAILS'})\n\n` + (list.length ? list.map((d) =>
    `- ${d.code} ${d.severity} | ${d.target}\n  problem: ${d.message}${d.at ? ` (at ${d.at.join(', ')})` : ''}\n  fix: ${d.fix}`).join('\n') : 'None.') + '\n';
}

// the playtest's report as it was before diagnostics: the failing checks with values, step errors, `see` reasons,
// screenshot warnings, failed modules with their error, console errors; nothing from the world checks
function rawText(report) {
  const lines = [`# Playtest report (${report.pass ? 'PASS' : 'FAIL'})`, ''];
  if (report.build && report.build.failed.length) lines.push('Failed modules: ' + report.build.failed.map((f) => `${f.name} (${f.phase}): ${f.error}`).join('; '), '');
  for (const [i, s] of report.steps.entries()) {
    const bad = s.checks.filter((c) => !c.ok).map((c) => `${c.k} ${c.e} (got ${JSON.stringify(c.v)})${c.why ? ': ' + c.why : ''}`);
    lines.push(`${i + 1}. ${s.step}: ${s.pass ? 'pass' : 'FAIL'}${s.err ? ' -- ' + s.err : ''}${bad.length ? ' -- ' + bad.join('; ') : ''}; feet at end [${(s.to || []).join(', ')}]${(s.warn || []).map((w) => ' -- warning: ' + w).join('')}`);
  }
  if (report.errors && report.errors.length) lines.push('', 'Console errors:', ...report.errors.slice(0, 10).map((e) => '- ' + e.split('\n')[0]));
  return lines.join('\n') + '\n';
}

function prompt(task, arm, report, turn) {
  const multi = mode === 'multi', file = arm === 'diag' ? 'DIAGNOSTICS.md' : 'REPORT.md';
  const what = arm === 'diag' ? diagText(report) : rawText(report);
  return `${turn > 1 ? `Your last change was checked and the world still fails. ` : ''}Fix this Mirage world.\n\n# Task: ${task.title}\n\n${task.prompt}\n\n` +
    (arm === 'diag' ? `The check is the playtest scenario in scenario.json; it must pass with no error diagnostics${task.forbid.length ? ` and none of ${task.forbid.join(', ')}` : ''}. `
      : 'The check is the playtest scenario in scenario.json plus the engine\'s own load-time checks of the world; both must pass. ') +
    `Here is what the playtest reports (also in ${file}):\n\n${what}\n${RULES(multi, turn)}\n`;
}

// ---- running the agent
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
function runAgent(dir, text, logBase) {
  return new Promise((resolve) => {
    const full = has('prompt-arg') ? `${cmd} ${shq(text)}` : cmd;
    const t0 = Date.now(), child = spawn('/bin/sh', ['-c', full], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, MIRAGE_EVAL: '1' } });
    let out = '', err = '';
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { err += b; });
    const kill = setTimeout(() => child.kill('SIGTERM'), timeout);
    child.on('close', (code, signal) => {
      clearTimeout(kill);
      fs.writeFileSync(logBase + '.stdout', out); fs.writeFileSync(logBase + '.stderr', err);
      resolve({ code, signal, ms: Date.now() - t0, ...countTools(out) });
    });
    if (!has('prompt-arg')) child.stdin.end(text); else child.stdin.end();
  });
}

/** Tool calls and turns from an agent's JSON-lines output (claude stream-json / json, codex --json); nulls otherwise. */
export function countTools(out) {
  let tools = 0, json = false, agentTurns = null, cost = null, agentError = null;
  for (const line of out.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    json = true;
    if (e.type === 'assistant' && e.message && Array.isArray(e.message.content)) tools += e.message.content.filter((c) => c.type === 'tool_use').length;
    if (e.type === 'result') { agentTurns = e.num_turns ?? agentTurns; cost = e.total_cost_usd ?? cost; if (e.is_error) agentError = String(e.result || e.subtype || 'error'); }
    if (e.type === 'turn.failed' || e.type === 'error') agentError = String((e.error && e.error.message) || e.message || 'error');
    if (e.type === 'item.completed' && e.item && /command_execution|file_change|mcp_tool_call|web_search/.test(e.item.type || e.item.item_type || '')) tools++;
  }
  return { toolCalls: json ? tools : null, agentTurns, costUsd: cost, agentError };
}

// ---- the loop
const checks = new Map();   // world hash -> check result (an untouched world is not checked twice)
async function check(task, dir, out) {
  const h = task.id + ':' + worldHash(dir);
  if (!checks.has(h)) checks.set(h, await machineCheck(task, dir, { out }));
  return checks.get(h);
}

const results = [];
// errors no task can get past: stop instead of burning the rest of the runs
const STOP_ON = /on hold|restricted|not logged in|log ?in|unauthori[sz]ed|invalid api key|credit|quota|billing/i;
let stop = false;
try {
  for (const task of tasks(flag('tasks') ? flag('tasks').split(',') : null)) {
    if (stop) break;
    for (const arm of arms) {
      const runDir = path.join(OUT, `${task.id}-${arm}`);
      fs.mkdirSync(runDir, { recursive: true });
      const dir = materialize(task, 'start', path.join(WORK, `run-${stamp}`, `${task.id}-${arm}`));
      const t0 = Date.now();
      let r = await check(task, dir, path.join(runDir, 'check-0'));
      const first = r.codes;
      const row = { task: task.id, arm, mode, pass: false, turns: 0, toolCalls: null, agentMs: 0, checkMs: 0, wallMs: 0, codesAtStart: first, codesAtEnd: first, why: r.why, agent: dry ? 'dry' : oracle ? 'oracle' : cmd };
      if (r.pass) { row.pass = true; row.why = 'the start already passes (a broken task)'; }
      for (let turn = 1; turn <= turns && !r.pass; turn++) {
        const text = prompt(task, arm, r.report, turn);
        fs.writeFileSync(path.join(dir, arm === 'diag' ? 'DIAGNOSTICS.md' : 'REPORT.md'), arm === 'diag' ? diagText(r.report) : rawText(r.report));
        fs.writeFileSync(path.join(runDir, `prompt-${turn}.md`), text);
        row.turns = turn;
        if (dry) break;
        if (oracle) fs.cpSync(path.join(task.dir, 'fix'), dir, { recursive: true });
        else {
          const a = await runAgent(dir, text, path.join(runDir, `agent-${turn}`));
          row.agentMs += a.ms;
          if (a.toolCalls !== null) row.toolCalls = (row.toolCalls || 0) + a.toolCalls;
          if (a.costUsd !== null) row.costUsd = (row.costUsd || 0) + a.costUsd;
          row.exit = a.signal ? a.signal : a.code;
          // the agent never worked on the task (account, auth, quota, crash): not a repair failure
          if (a.agentError) { row.agentError = a.agentError; row.why = 'agent error: ' + a.agentError; break; }
        }
        const tc = Date.now();
        r = await check(task, dir, path.join(runDir, `check-${turn}`));
        row.checkMs += Date.now() - tc;
        Object.assign(row, { pass: r.pass, codesAtEnd: r.codes, why: r.why });
      }
      row.wallMs = Date.now() - t0;
      results.push(row);
      if (row.agentError && STOP_ON.test(row.agentError)) { fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1)); console.log(`agent error, stopping: ${row.agentError}`); stop = true; break; }
      console.log(`${row.agentError ? 'AGENT ERROR' : row.pass ? 'pass' : 'fail'} ${task.id} [${arm}] turns ${row.turns}${row.toolCalls !== null ? `, tools ${row.toolCalls}` : ''}, ${(row.wallMs / 1000).toFixed(0)} s${row.pass ? '' : ' -- ' + row.why}`);
      fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
    }
  }
} finally { closeServer(); }

// ---- summary
const by = (arm) => results.filter((r) => r.arm === arm);
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const lines = [`# Repair-rate eval ${stamp}`, '', `agent: \`${dry ? '(dry run: no agent)' : oracle ? '(oracle: the reference fixes)' : cmd}\`; mode ${mode}${mode === 'multi' ? ` (up to ${turns} turns)` : ''}`, '',
  '| arm | tasks | agent errors (not counted) | pass | rate | mean turns (passing) | mean tool calls | mean wall s |', '|---|---|---|---|---|---|---|---|',
  ...arms.map((a) => { const all = by(a), r = all.filter((x) => !x.agentError), p = r.filter((x) => x.pass), tc = r.filter((x) => x.toolCalls !== null).map((x) => x.toolCalls);
    return `| ${a} | ${all.length} | ${all.length - r.length} | ${p.length} | ${r.length ? Math.round((100 * p.length) / r.length) + ' %' : '-'} | ${p.length ? mean(p.map((x) => x.turns)).toFixed(2) : '-'} | ${tc.length ? mean(tc).toFixed(1) : '-'} | ${all.length ? mean(all.map((x) => x.wallMs / 1000)).toFixed(0) : '-'} |`; }),
  '', '| task | ' + arms.join(' | ') + ' |', '|---|' + arms.map(() => '---|').join(''),
  ...[...new Set(results.map((r) => r.task))].map((t) => `| ${t} | ` + arms.map((a) => { const r = results.find((x) => x.task === t && x.arm === a); return r ? (r.agentError ? 'agent error' : `${r.pass ? 'pass' : 'fail'} (${r.turns})`) : ''; }).join(' | ') + ' |')];
fs.writeFileSync(path.join(OUT, 'summary.md'), lines.join('\n') + '\n');
console.log(lines.slice(0, 4 + arms.length + 2).join('\n'));
console.log(`results: ${path.join(OUT, 'summary.md')}`);
