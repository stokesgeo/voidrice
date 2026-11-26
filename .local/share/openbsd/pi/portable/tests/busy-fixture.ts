// Isolated native test only: synthetic stream + long-running tool, no transport/auth.
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { Type } from 'typebox';

export default function(pi: any) {
 const root = process.env.BOARD_BUSY_FIXTURE!;
 if (!root) throw Error('fixture needs isolated control directory');
 // Hosted peer has no provider. It only edits locally and asks a native decision.
 if (process.env.AGENT_BOARD_VIEW_ID) {
  const peer: any = { pid: process.pid, ppid: process.ppid, entry: process.argv[1], keys: [], decisionDone: false };
  let tick: any;
  pi.on('before_provider_request', () => { throw Error('Peer fixture forbids provider calls'); });
  pi.on('session_start', (_e: any, ctx: any) => {
   ctx.ui.onTerminalInput((d: string) => { peer.keys.push(d); });
   for (let i = 0; i < 60; i++) pi.sendMessage({customType:'fixture-line',content:`PEER HISTORY ${i}`,display:true});
   let outputSequence = 0;
   tick = setInterval(() => {
    if (existsSync(join(root, 'peer-output'))) {
     const output = JSON.parse(readFileSync(join(root, 'peer-output'), 'utf8'));
     if (output.sequence > outputSequence) {
      outputSequence = output.sequence;
      pi.sendMessage({ customType: 'fixture-response', content: output.text, display: true });
     }
    }
    if (existsSync(join(root, 'peer-decision')) && !peer.decisionStarted) {
     peer.decisionStarted = true;
     void ctx.ui.confirm('PEER FIXTURE DECISION', 'Answer the peer explicitly.').then((answer: boolean) => {peer.answer=answer;peer.decisionDone=true;});
    }
    writeFileSync(join(root,'peer-probe.tmp'), JSON.stringify({...peer, draft:ctx.ui.getEditorText(), idle:ctx.isIdle()}));
    renameSync(join(root,'peer-probe.tmp'),join(root,'peer-probe.json'));
   }, 40);
  });
  pi.on('session_shutdown', () => clearInterval(tick));
  return;
 }
 const state: any = { phase: 'startup', prompts: [], aborted: false, settled: false, opens: 0 };
 let timer: any, commandBusy = false, sequence = 0;
 pi.registerProvider('board-fixture', {
  api: 'board-fixture-api', apiKey: 'fixture-not-a-credential', baseUrl: 'http://invalid.invalid',
  models: [{ id: 'fake', name: 'Board fixture', reasoning: false, input: ['text'], cost: {input:0, output:0, cacheRead:0, cacheWrite:0}, contextWindow: 128000, maxTokens: 1024 }],
  streamSimple(model: any, _context: any, options: any) {
   const stream = createAssistantMessageEventStream();
   void (async () => {
    const msg: any = { role:'assistant', api:model.api, provider:model.provider, model:model.id, content:[], stopReason:'toolUse', timestamp:Date.now(), usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}} };
    state.phase = 'stream'; stream.push({type:'start',partial:msg});
    while (!existsSync(join(root,'stream-release')) && Date.now() - msg.timestamp < 120000) {
     if (options?.signal?.aborted) { state.aborted = true; break; }
     await new Promise(r=>setTimeout(r,30));
    }
    msg.content = [{type:'toolCall',id:'fixture-long-tool',name:'board_fixture_wait',arguments:{}}];
    stream.push({type:'toolcall_start',contentIndex:0,partial:msg});
    stream.push({type:'toolcall_end',contentIndex:0,toolCall:msg.content[0],partial:msg});
    stream.push({type:'done',reason:'toolUse',message:msg}); stream.end();
   })();
   return stream;
  }
 });
 pi.registerTool({name:'board_fixture_wait',label:'Fixture wait',description:'Synthetic fixture wait',parameters:Type.Object({}),
  async execute(_id: any,_args: any,signal: any,_update: any,ctx: any) {
   state.phase = 'tool';
   const deadline = Date.now() + 120000;
   while (!existsSync(join(root,'tool-release')) && Date.now() < deadline) {
    if (signal?.aborted) { state.aborted = true; break; }
    if (existsSync(join(root,'prompt')) && !state.promptDone) {
     state.phase = 'prompt';
     state.answer = await ctx.ui.confirm('OWNER FIXTURE APPROVAL', 'Choose explicitly; Board must yield.');
     state.promptDone = true; state.phase = 'tool';
    }
    if (existsSync(join(root,'custom-prompt')) && !state.customDone) {
     state.phase = 'custom-prompt';
     state.customAnswer = await ctx.ui.custom((_t: any,_theme: any,_k: any,done: any)=>({render:()=>['OWNER CUSTOM FIXTURE: y answers'],invalidate(){},handleInput(d: string){if(d==='y')done('explicit-y');}}));
     state.customDone = true; state.phase = 'tool';
    }
    await new Promise(r=>setTimeout(r,30));
   }
   return {content:[{type:'text',text:'Synthetic tool completed'}],details:{},terminate:true};
  }
 });
 pi.on('ui_prompt_start',(e: any)=>{state.prompts.push({event:'start',kind:e.kind});});
 pi.on('ui_prompt_end',()=>{state.prompts.push({event:'end'});});
 pi.on('agent_settled',(e: any)=>{state.settled=true;state.aborted ||= e.aborted;state.phase='settled';});
 pi.registerCommand('fixture-start',{handler:async(_a: any,ctx: any)=>{
  const model=ctx.modelRegistry.find('board-fixture','fake');
  await pi.setModel(model);
  ctx.ui.setEditorText('UNSENT busy fixture draft');
  pi.sendUserMessage('Synthetic local fixture only');
 }});
 pi.on('session_start',(_e: any,ctx: any)=>{
  timer=setInterval(()=>{
   if (existsSync(join(root,'overlap-prompt')) && !state.overlapStarted) {
    state.overlapStarted=true;
    void ctx.ui.confirm('PARENT OVER PEER DECISION', 'Only the top parent decision may receive input.').then((answer: boolean)=>{state.overlapAnswer=answer;state.overlapDone=true;});
   }
   if (existsSync(join(root,'standalone-prompt')) && !state.standaloneStarted) {
    state.standaloneStarted=true;
    void ctx.ui.confirm('PROMPT FIRST FIXTURE', 'Board must not cover this.').then((answer: boolean)=>{state.standaloneAnswer=answer;state.standaloneDone=true;});
   }
   const control=join(root,'open');
   if(existsSync(control)) {
    const n=Number(readFileSync(control,'utf8'));
    if(n>sequence && !commandBusy) {
     sequence=n;commandBusy=true;state.opens++;
     // The native command path, not a call to Board's exported helper.
     const command = existsSync(join(root,'attach-open')) ? readFileSync(join(root,'attach-open'),'utf8') : '/agent-board';
     Promise.resolve(pi.sendUserMessage(command,{expandPromptTemplates:true})).finally(()=>{commandBusy=false;});
    }
   }
   const data={...state,entry:process.argv[1],idle:ctx.isIdle(),draft:ctx.ui.getEditorText(),session:ctx.sessionManager.getSessionFile(),entries:ctx.sessionManager.getEntries().map((e:any)=>({type:e.type,role:e.message?.role,toolName:e.message?.toolName}))};
   writeFileSync(join(root,'probe.tmp'),JSON.stringify(data));renameSync(join(root,'probe.tmp'),join(root,'probe.json'));
  },40);
 });
 pi.on('session_shutdown',()=>clearInterval(timer));
}
