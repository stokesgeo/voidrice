// Synthetic native selection events and cache watches; no runtime or real I/O.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('./desktop-theme-controller.mjs', import.meta.url), 'utf8');
let active = 0, subscriptions = 0, mode = 'night';
const watches = new Set();
const fs = {
 statSync: () => ({ dev: 1, ino: 2 }), readFileSync: () => mode,
 watch(_file, callback) {
  active++;
  const watcher = { callback, on() {}, close() { if(watches.delete(watcher))active--; } };
  watches.add(watcher); return watcher;
 },
};
const box = vm.createContext({ fs, os: { homedir: () => '/fixture' },
 path: { join: (...parts) => parts.join('/'), dirname: file => file.slice(0,file.lastIndexOf('/')), basename: file => file.slice(file.lastIndexOf('/')+1) }, process: { env: {} },
 setImmediate: () => 1, clearImmediate() {} });
vm.runInContext(source.replace(/^import .*;\n/gm, '').replace('export function ', 'function ')
 .replace('export default function ', 'function ') + '\nglobalThis.factory=desktopTheme;', box);
const events = new Map();
box.factory({ on: (name, handler) => events.set(name, handler) });
let selection = 'vertrice-day', listener, applied = [];
const ui = {
 theme: { name: 'vertrice-day' }, getThemeSelection: () => selection,
 onThemeSelectionChange(fn) { listener=fn;subscriptions++;return ()=>{listener=undefined;subscriptions--;}; },
 getTheme: name => ({ name }), setTheme(theme) { applied.push(theme.name);ui.theme=theme;return {success:true}; },
 notify() { assert.fail('unexpected warning'); },
};
const start = () => events.get('session_start')({}, {mode:'tui',ui});
const choose = value => {selection=value;listener();};
const repaint = value => {mode=value;for(const watcher of [...watches])watcher.callback('change','theme');};
start();
assert.equal(active,0);assert.equal(subscriptions,1);assert.deepEqual(applied,[]);
choose('vertrice-day/vertrice-night');
assert.equal(active,2);assert.deepEqual(applied,['vertrice-night']);
repaint('day');assert.equal(ui.theme.name,'vertrice-day');
choose('vertrice-night');assert.equal(active,0);
const count=applied.length;repaint('night');assert.equal(applied.length,count);
choose('vertrice-day/vertrice-night');assert.equal(active,2);assert.equal(ui.theme.name,'vertrice-night');
// Re-entry claims ownership even when active name already matches the cache.
assert.equal(applied.length,count+1);
start();assert.equal(active,2);assert.equal(subscriptions,1);
events.get('session_shutdown')();assert.equal(active,0);assert.equal(subscriptions,0);
// Older hosts without native selection APIs must not override a fixed choice.
events.get('session_start')({}, {mode:'tui',ui:{theme:{name:'vertrice-day'}}});assert.equal(active,0);
console.log('PASS synthetic fixed pair-member startup, fixed->auto, cache repaint, auto->fixed, re-entry, restart/shutdown cleanup and absent-API refusal');
