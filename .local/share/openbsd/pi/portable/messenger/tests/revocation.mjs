import fs from 'node:fs';
import assert from 'node:assert/strict';
import {compile,sourceRoot as root} from './support.mjs';
for(const throwing of [false,true]) {
let text=fs.readFileSync(root+'/store.ts','utf8');
text=text.slice(text.indexOf('const watcherTrust ='),text.indexOf('// Target Validation'));
let queued,debounced,closed=0,reads=0,delivered=0,unlinked=0,allowed=true;
const state={registered:true,watcher:null,watcherRetries:0,agentName:'worker'};
const fakefs={existsSync:()=>true,readdirSync:()=>['message.json'],readFileSync:()=>{reads++;return '{}'},unlinkSync:()=>unlinked++,watch:(_p,fn)=>{queued=fn;return {on(){},close(){closed++}}}};
const exported={};
new Function('exports','fs','getMyInbox','ensureDirSync','normalizeAgentMailMessage','join','setTimeout','clearTimeout','MAX_WATCHER_RETRIES','unusedDebounce','isProcessingMessages','pendingProcessArgs',compile(text))(exported,fakefs,()=>'/inbox',()=>{},x=>x,(a,b)=>a+'/'+b,fn=>{debounced=fn;return 1},()=>{},5,50,false,null);
exported.setWatcherTrust(state,()=>{if(!allowed&&throwing)throw Error('stale context');return allowed});
exported.startWatcher(state,{},()=>delivered++);
assert.equal(reads,1);assert.equal(unlinked,1);queued();assert(debounced);
allowed=false;debounced();queued();assert.equal(reads,1);assert.equal(delivered,1);assert.equal(unlinked,1);assert.equal(closed,1);assert.equal(state.watcher,null);
let event,receipt,updates=0,emits=0,appends=0,unsubscribed=0,unbound=0;
text=fs.readFileSync(root+'/crew-presence/ui.ts','utf8').split('\n').filter(l=>!l.startsWith('import ')).join('\n');
const presence={};new Function('exports','subscribe','unbindReceiptSink','bindReceiptSink','liveCount','snapshot','wrapTextWithAnsi','inspectorLines','workerState',compile(text))(presence,fn=>{event=fn;return ()=>unsubscribed++},()=>unbound++,(_id,fn)=>receipt=fn,()=>1,()=>[],x=>[x],()=>[],()=>{});
const events={};presence.installCrewPresence({on:(name,fn)=>events[name]=fn,registerShortcut(){},events:{emit(){emits++}},appendEntry(){appends++}});
allowed=true;events.session_start({}, {mode:'tui',isProjectTrusted:()=>{if(!allowed&&throwing)throw Error('stale context');return allowed},sessionManager:{getSessionId:()=> 'session'},ui:{setWidget(){updates++}}});
assert.equal(emits,1);receipt('test',{});assert.equal(appends,1);
allowed=false;event();receipt('test',{});event();assert.equal(emits,1);assert.equal(appends,1);assert.equal(updates,1);assert(unsubscribed>0);assert(unbound>0);
console.log('PASS captured watcher + queued debounce true-to-false: no mailbox read/consume/delivery; presence no emit/append after revocation, cleanup executed');

text=fs.readFileSync(root+'/index.ts','utf8');
const live=text.slice(text.indexOf('  function liveTrust('),text.indexOf('  store.setWatcherTrust('));
let stopped=0,watchStopped=0,workerUnsub=0;
const heart={};
const compiled=compile('let trustRevoked=false; let latestCtx=ctx; let recentCommitTimer=null,recentTestTimer=null,recentEditTimer=null; '+live+'; export const heartbeat=()=>liveTrust();');
allowed=true;new Function('exports','ctx','stopStatusHeartbeat','store','state','pendingEdits','unsubscribeLiveWorkers',compiled)(heart,{isProjectTrusted:()=>{if(!allowed&&throwing)throw Error('stale context');return allowed}},()=>stopped++,{stopWatcher(){watchStopped++}},{registryFlushTimer:null},new Map(),()=>workerUnsub++);
assert.equal(heart.heartbeat(),true);allowed=false;assert.equal(heart.heartbeat(),false);assert.equal(stopped,1);assert.equal(watchStopped,1);assert.equal(workerUnsub,1);
console.log('PASS heartbeat live native predicate false stops watcher/timer/subscription');

console.log(throwing ? "PASS throwing stale native predicate clean denial" : "PASS false native predicate clean denial");
}
