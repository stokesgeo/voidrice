// Native parent + Board-hosted peer, local synthetic stream/tool only; no transport/auth/admin.
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,symlinkSync,readFileSync,writeFileSync,rmSync,realpathSync,renameSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const [runtime, tmp] = process.argv.slice(2);
assert(runtime?.startsWith('/')&&tmp?.startsWith('/'),'usage: busy-test.mjs /absolute/test-generation /absolute/new-short-scratch');
assert(process.env.PORTABLE_MUTABLE_TEST_GENERATION===runtime,'explicit disposable mutable test-generation authorization required');
const source=runtime+'/board/source';
mkdirSync(tmp,{mode:0o700});
const home=join(tmp,'home'),agent=join(home,'.local/share/vertrice-pi/profile');
mkdirSync(agent,{recursive:true,mode:0o700});
writeFileSync(join(agent,'auth.json'),'{}\n',{mode:0o600,flag:'wx'});
writeFileSync(join(agent,'AGENTS.md'),readFileSync(runtime+'/agent/native-context.md'),{mode:0o600,flag:'wx'});
writeFileSync(join(agent,'settings.json'),'{}\n',{mode:0o600,flag:'wx'});
const {routes}=await import('../routes.mjs');
const {prepareRuntime}=await import('../patch-runtime.mjs');
const recipeRoot=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
const lock=JSON.parse(readFileSync(recipeRoot+'/dependencies.json'));
const pristine=process.env.PORTABLE_TEST_PRISTINE;
assert(pristine?.startsWith('/'),'PORTABLE_TEST_PRISTINE explicit public source required for test auth binding');
for(const item of prepareRuntime(pristine,lock,JSON.parse(readFileSync(recipeRoot+'/runtime-patches.json')),agent+'/auth.json',recipeRoot).filter(e=>e.binding==='nativeAuthStorage'))writeFileSync(runtime+'/'+item.path,item.bytes);
const resources=JSON.parse(readFileSync(runtime+'/agent/resources.json'));
resources.extensions=['extensions/agent-board.ts','extensions/busy-fixture.ts'];
const selected=[...resources.files,{path:'extensions/busy-fixture.ts'}];
writeFileSync(runtime+'/agent/extensions/busy-fixture.ts',readFileSync(new URL('./busy-fixture.ts',import.meta.url)));
const {route,bindings,messengerContract}=routes(runtime,home,resources,selected);
for(const [name,value]of Object.entries({'route.json':route,'instance.json':bindings,'board/source/src/core/instance.json':bindings,'messenger-contract.json':messengerContract}))writeFileSync(runtime+'/'+name,JSON.stringify(value));
writeFileSync(runtime+'/launch.mjs',readFileSync(new URL('../launch.mjs',import.meta.url)));
writeFileSync(runtime+'/pi','#!/bin/sh\nexec /usr/local/bin/node '+JSON.stringify(runtime+'/launch.mjs')+' \"$@\"\n',{mode:0o700});
const {assertCompatibility}=await import(source+'/src/core/compatibility.mjs');
const pty=(await import(source+'/node_modules/node-pty/lib/index.js')).default;
const require=createRequire(source+'/package.json');
const {Terminal}=require('@xterm/headless');
const screen=new Terminal({cols:100,rows:35,allowProposedApi:true,scrollback:2000});
const env={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:home,PI_CODING_AGENT_DIR:agent,PI_OFFLINE:'1',PI_SKIP_VERSION_CHECK:'1',TERM:'xterm-256color',BOARD_BUSY_FIXTURE:tmp};
const {inlineOptions}=await import(source+'/src/core/inline.mjs');
const opts=inlineOptions(home,env,runtime+'/node_modules/@earendil-works/pi-coding-agent',assertCompatibility(home).cli,bindings);
const {createService}=await import(source+'/src/runtime/service.mjs');
const store=await import(source+'/src/core/store.mjs');
const service=createService({...opts,...opts.invocation,defaultCwd:tmp,runnerScript:source+'/runner/job-runner.mjs',ptyRunnerScript:source+'/runner/pty-runner.mjs'});
let terminal,output='',exit,peerPid,runnerPid;
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
// Total fixture deadline leaves cleanup time before the caller's 180s limit.
const deadline=Date.now()+140000;
const wait=async(fn,label,ms=30000)=>{const until=Math.min(deadline,Date.now()+ms);while(Date.now()<until){if(fn())return; if(exit)throw Error('early exit '+JSON.stringify(exit)); await new Promise(r=>setTimeout(r,40));}throw Error('timeout '+label);};
const json=name=>{try{return JSON.parse(readFileSync(join(tmp,name),'utf8'));}catch{return {};}};
const probe=()=>json('probe.json'), peer=()=>json('peer-probe.json');
const view=()=>Array.from({length:35},(_,i)=>screen.buffer.active.getLine(screen.buffer.active.baseY+i)?.translateToString(true)??'').join('\n');
const control=(name,text='')=>writeFileSync(join(tmp,name),text);
const pause=()=>new Promise(r=>setTimeout(r,200));
const unseen=()=>!store.readAcknowledgement(opts.root,'busy-peer');
let responseSequence=0;
function offerResponse(text) {
 service.syncHostedEvent('busy-peer',{type:'message_end',message:{role:'assistant',content:[{type:'text',text}],stopReason:'stop'}});
 const marker=store.readState(opts.root,'busy-peer').response;
 control('peer-output',JSON.stringify({sequence:++responseSequence,text}));
 return marker;
}
let n=0;
async function open(command='/agent-board') {
 control('attach-open',command);control('open',String(++n));
 await wait(()=>view().includes(command.includes('--attach')&&!command.includes('--stop')?'ctrl+] detach':'inspect or attach'),'Board/attach current screen');
 assert.equal(probe().aborted,false);
}
async function detach() {
 terminal.write('\x1d');await wait(()=>view().includes('enter attach/launch')&&!view().includes('ctrl+] detach'),'Ctrl+] to Board');
 terminal.write('\x1b');await pause();
}
try {
 // Only one owned hosted peer; no prewarm fan-out or model task dispatch.
 const meta=store.createView(opts.root,{id:'busy-peer',name:'Busy fixture peer',cwd:tmp});
 writeFileSync(meta.sessionFile,'');assert.equal(service.ensureHost(meta.id).ok,true);
 terminal=pty.spawn(runtime+'/pi',[],{cwd:tmp,env,name:'xterm-256color',cols:100,rows:35});
 terminal.onData(d=>{output+=d;screen.write(d);});terminal.onExit(e=>exit=e);
 await wait(()=>peer().idle,'peer startup',60000);peerPid=peer().pid;runnerPid=peer().ppid;
 await wait(()=>probe().phase==='startup','parent startup',60000);await pause();
 assert.equal(realpathSync(peer().entry),realpathSync(runtime+'/node_modules/.bin/pi'),'child executes reviewed bundled route');
 assert.equal(realpathSync(probe().entry),realpathSync(runtime+'/node_modules/.bin/pi'),'native parent and child share reviewed entry');
 terminal.write('/fixture-start\r');await wait(()=>probe().phase==='stream'&&!probe().idle,'held parent stream');
 const session=probe().session;
 await open();terminal.write('i');await wait(()=>view().includes('changes require idle'),'busy mutation guard');
 // Use dashboard keyboard attach while the parent is still streaming.
 terminal.write('\x1b[C');await wait(()=>view().includes('ctrl+] detach'),'dashboard busy attach');
 terminal.write('PEER draft');await wait(()=>peer().draft==='PEER draft','peer typing');
 assert.equal(probe().phase,'stream');assert.equal(probe().draft,'UNSENT busy fixture draft');
 await detach();assert.equal(probe().phase,'stream');
 // The stop-first flag remains destructive even if its row is missing.
 const from=output.length;await open('/agent-board --attach fixture-missing --stop');
 await wait(()=>output.slice(from).includes('Stop requires idle'),'direct busy stop guard');
 terminal.write('\x1b');await pause();
 control('stream-release');await wait(()=>probe().phase==='tool','held parent tool');
 await open('/agent-board --attach busy-peer');
 assert.equal(peer().pid,peerPid);assert.equal(peer().draft,'PEER draft');
 // Local peer scrollback is separate from the parent transcript.
 terminal.write('\x1b[5~');
 await wait(()=>view().includes('Jump to latest message')&&view().includes('PEER HISTORY 54'),'peer native viewport scrolled');
 const history=()=>view().match(/PEER HISTORY \d+/g);
 const scrolled=history();
 control('prompt');await wait(()=>probe().phase==='prompt'&&view().includes('OWNER FIXTURE APPROVAL'),'parent decision on top');
 const keys=peer().keys.length;await pause();assert.equal(probe().promptDone,undefined);
 terminal.write('\x1b[B\r');await wait(()=>probe().promptDone,'parent explicit No');assert.equal(probe().answer,false);
 await wait(()=>view().includes('ctrl+] detach'),'same attach restored');
 assert.equal(peer().keys.length,keys,'parent approval keys never reach peer');
 assert.deepEqual(history(),scrolled,'same peer viewport restored after parent approval');
 terminal.write('\x1b[6~');await wait(()=>view().includes('PEER HISTORY 59'),'peer back to bottom');
 terminal.write('\x1b[<64;30;12M');await wait(()=>view().includes('Jump to latest message'),'inline native wheel scrolls peer');
 assert(!view().split('\n')[0].includes('Jump to latest'),'peer wheel does not scroll parent');
 terminal.write(' after-parent');await wait(()=>peer().draft==='PEER draft after-parent','peer input ownership restored');
 terminal.write('\x1b[1;5F'); // peer native Ctrl+End: leave its historical viewport
 const firstResponse=offerResponse('VISIBLE RESPONSE FIXTURE ONE');
 await wait(()=>view().includes('VISIBLE RESPONSE FIXTURE ONE'),'actual attached response content');
 await wait(()=>!unseen(),'focused native visit');
 assert(!view().includes('mark r'),'no action/revision banner');
 assert.deepEqual(store.readAcknowledgement(opts.root,'busy-peer'),firstResponse);
 control('custom-prompt');await wait(()=>view().includes('OWNER CUSTOM FIXTURE'),'parent custom on top');
 const hiddenResponse=offerResponse('HIDDEN LATE RESPONSE FIXTURE TWO');
 await pause();assert.equal(unseen(),true,'later response behind parent modal stays unseen');
 assert(!view().includes('HIDDEN LATE RESPONSE FIXTURE TWO'));
 const acknowledgements=join(opts.root,'views','busy-peer','acknowledgements');
 renameSync(acknowledgements,acknowledgements+'.fixture-save');
 writeFileSync(acknowledgements,'fixture writer obstruction');
 const keys2=peer().keys.length;terminal.write('y');await wait(()=>probe().customDone,'parent custom response');
 await wait(()=>view().includes('ctrl+] detach')&&view().includes('HIDDEN LATE RESPONSE FIXTURE TWO'),'attach restored after custom');assert.equal(peer().keys.length,keys2);
 await pause();assert.equal(unseen(),true,'failed native writer cannot clear new response');
 rmSync(acknowledgements);renameSync(acknowledgements+'.fixture-save',acknowledgements);
 // Trigger ordinary presentation by a parent resize, not a mark action.
 terminal.resize(101,35);await wait(()=>!unseen(),'focused restored presentation retries failed acknowledgement');
 assert.deepEqual(store.readAcknowledgement(opts.root,'busy-peer'),hiddenResponse);
 const decisionResponse=offerResponse('DECISION RESPONSE FIXTURE THREE');
 await wait(()=>view().includes('DECISION RESPONSE FIXTURE THREE'),'response before peer decision');
 // Overlapping native child decision is retained across Ctrl+] detach/reattach.
 control('peer-decision');await wait(()=>peer().decisionStarted&&view().includes('PEER FIXTURE DECISION'),'peer native decision');
 assert.equal(peer().decisionDone,false);
 await wait(()=>!unseen(),'live focused arrival visited independently of peer decision');
 assert.deepEqual(store.readAcknowledgement(opts.root,'busy-peer'),decisionResponse);
 assert.equal(peer().decisionDone,false,'focused visit is not a peer decision answer');
 control('overlap-prompt');await wait(()=>view().includes('PARENT OVER PEER DECISION'),'parent above pending peer decision');
 const overlapKeys=peer().keys.length;
 terminal.write('\x1b[B\r');await wait(()=>probe().overlapDone,'explicit overlapping parent No');
 assert.equal(probe().overlapAnswer,false);assert.equal(peer().decisionDone,false);
 assert.equal(peer().keys.length,overlapKeys,'overlapping parent input never answers child decision');
 await wait(()=>view().includes('PEER FIXTURE DECISION'),'pending peer decision restored after parent');
 await detach();assert.equal(peer().decisionDone,false);
 await open('/agent-board --attach busy-peer');await wait(()=>view().includes('PEER FIXTURE DECISION'),'same peer decision on reattach');
 terminal.write('\r');await wait(()=>peer().decisionDone,'peer explicit Yes');assert.equal(peer().answer,true);
 assert.equal(peer().draft,'PEER draft after-parent');assert.equal(probe().draft,'UNSENT busy fixture draft');
 assert.equal(probe().entries.filter(e=>e.role==='user').length,1,'no peer draft/decision submitted into parent');
 // Parent completes while still attached; subsequent input must remain in peer.
 control('tool-release');await wait(()=>probe().settled,'parent completion under attach');
 assert.equal(probe().aborted,false);assert.equal(probe().session,session);
 assert(probe().entries.some(e=>e.role==='toolResult'&&e.toolName==='board_fixture_wait'));
 terminal.write(' settled');await wait(()=>peer().draft==='PEER draft after-parent settled','typing after parent completion');
 await detach();assert.equal(probe().draft,'UNSENT busy fixture draft');assert.equal(peer().pid,peerPid);
 control('standalone-prompt');await wait(()=>view().includes('PROMPT FIRST FIXTURE'),'prompt first');
 const before=output.length;control('attach-open','/agent-board');control('open',String(++n));
 await wait(()=>output.slice(before).includes('no other owner prompt open'),'prompt-first refuses Board');
 assert.equal(probe().standaloneDone,undefined);terminal.write('\x1b[B\r');await wait(()=>probe().standaloneDone,'prompt first answer');
 assert(!output.includes('Failed to load extension'));
 console.log('PASS native response lifecycle: focused visit with rendered output, hidden late revision stays new under parent modal, restored focus retries failed writer, live arrival visited independently of retained peer decision; no mark keys');
 console.log('PASS native two-session busy switching: stream/tool held, dashboard/direct attach, Ctrl+] return, parent confirm/custom on top, peer decision detach/reattach, independent drafts, peer viewport restored after approval, parent completes attached without abort');
 console.log('PASS explicit test-generation launcher and full route bindings: '+runtime);
} catch(error){writeFileSync(join(tmp,'failure.ansi'),output);console.error({tmp,parent:probe(),peer:peer(),screen:view()});throw error;}
finally {
 control('stream-release');control('tool-release');
 const host=store.readHost(opts.root,'busy-peer');
 peerPid ??= host?.childPid;runnerPid ??= host?.runnerPid;
 service.terminateHost('busy-peer');
 terminal?.kill();
 const until=Date.now()+10000;
 while(Date.now()<until&&((terminal&&!exit)||(peerPid&&alive(peerPid))||(runnerPid&&alive(runnerPid))))await new Promise(r=>setTimeout(r,50));
 const remaining=[peerPid,runnerPid].filter(pid=>pid&&alive(pid));
 screen.dispose();
 if(remaining.length||(terminal&&!exit))throw Error('Owned fixture cleanup incomplete: '+JSON.stringify({tmp,remaining,parent:terminal?.pid}));
 rmSync(tmp,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 console.log('PASS owned parent/peer/runner exited; isolated fixture tree removed');
}
