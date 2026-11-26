import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {assemble} from '../assemble.mjs';
import {prepareBoard} from '../prepare-board.mjs';
import {qualifyBoard} from '../qualify-board.mjs';
const [inputsFile,resourceRoot,trial,nativeReceipt]=process.argv.slice(2);
assert([inputsFile,resourceRoot,trial,nativeReceipt].every(p=>p?.startsWith('/')),'absolute roots.json, resource root, new trial and native receipt required');
const here=path.resolve(import.meta.dirname,'..'),inputs=JSON.parse(fs.readFileSync(inputsFile)),native=JSON.parse(fs.readFileSync(nativeReceipt));
const root=trial+'/generation',home=trial+'/home';
if(process.argv[6]!=='--assembled-disposable') {
 fs.mkdirSync(trial,{mode:0o700});fs.mkdirSync(trial+'/evidence',{mode:0o700});
 await assemble(root,trial+'/evidence',{pristineRoot:inputs.pristineRoot,boardRoot:inputs.boardRoot,messengerRoot:inputs.messengerRoot,toolRoot:inputs.toolRoot,resourceRoot,home,boardInputs:{sourceRoot:inputs.boardRoot+'/source',registryProject:native.registryProject,buildProject:native.project,nativeReceipt}});
}
console.log('PASS fresh complete assembly and mandatory callable-shape qualification');
const route=JSON.parse(fs.readFileSync(root+'/route.json')),c=route.messenger;
fs.mkdirSync(c.campaignRoot,{recursive:true,mode:0o700});
const {environment}=await import(pathToFileURL(root+'/launch.mjs'));
 const env=environment({PATH:'/usr/local/bin:/usr/bin:/bin'},{campaign:true});
Object.assign(process.env,env);process.chdir(c.campaignRoot);
const require=createRequire(root+'/package.json'),entry=root+'/messenger/messenger-runtime.cjs',messenger=require(entry),board=require(root+'/board/source/board-runtime.cjs');
assert.equal(typeof board,'object');assert.equal(typeof board.default,'function');
assert.equal(typeof messenger,'function');assert.equal(messenger.default,messenger);assert.equal(typeof messenger.reason,'string');assert.equal(typeof messenger.trusted,'function');
assert.equal(messenger.trusted({isProjectTrusted:()=>true}),true);assert.equal(messenger.trusted({}),false);assert.equal(messenger.trusted({isProjectTrusted:()=>{throw Error('denied');}}),false);
process.argv[1]=fs.realpathSync(root+'/node_modules/.bin/pi');
const {loadExtensions}=await import(pathToFileURL(root+'/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js'));
const loaded=await loadExtensions(route.campaign.extensions,c.campaignRoot);
assert.deepEqual(loaded.errors,[]);assert.equal(loaded.extensions.length,route.campaign.extensions.length);
const extension=loaded.extensions.find(e=>e.path===entry);assert(extension);assert(extension.commands.has('messenger'));assert(extension.handlers.has('session_start'));
const stateBefore=[c.transportDir,c.agentDir].map(p=>fs.existsSync(p));
const result=await extension.tools.get('pi_messenger').definition.execute('guard',{action:'status'},undefined,undefined,{});
assert.equal(result.isError,true);assert.equal(result.details.error,'project_not_trusted');
for(const handler of extension.handlers.get('session_start'))await handler({},{});
assert.deepEqual([c.transportDir,c.agentDir].map(p=>fs.existsSync(p)),stateBefore);
console.log('PASS actual campaign native loadExtensions/Jiti factory initialization, named exports, trust guards and Board default bridge');
const lock=JSON.parse(fs.readFileSync(here+'/dependencies.json')),prepared=prepareBoard(inputs.boardRoot+'/source',fs.mkdtempSync(trial+'/qualification-')+'/source',lock,here),receipt=JSON.parse(fs.readFileSync(root+'/portable-receipt.json'));
const bytes=fs.readFileSync(entry);
try {
 fs.writeFileSync(entry,bytes.toString().replace('module.exports = Object.assign(module.exports.default, module.exports);',''));
 assert.throws(()=>qualifyBoard(root,prepared.qualificationContract,receipt.runtimeDelta,lock.board.lockfileSha256,lock.board.runtimeTranslations),/Messenger runtime export must be callable/);
 console.log('PASS original plain CJS object rejected by mandatory cold qualifier');
} finally {fs.writeFileSync(entry,bytes);}
qualifyBoard(root,prepared.qualificationContract,receipt.runtimeDelta,lock.board.lockfileSha256,lock.board.runtimeTranslations);
console.log('PASS restored callable bundle passes cold qualifier without invoking factory');
fs.mkdirSync(c.agentDir,{recursive:true,mode:0o700});
fs.writeFileSync(c.nativeAuthStorage,'{}\n',{flag:'wx',mode:0o600});
try {
 const rpc=spawnSync(root+'/pi',['--campaign','--mode','rpc','--no-session'],{cwd:c.campaignRoot,env,input:JSON.stringify({id:'state',type:'get_state'})+'\n'+JSON.stringify({id:'commands',type:'get_commands'})+'\n',encoding:'utf8',timeout:45000});
 assert.equal(rpc.status,0,rpc.stderr);assert(!/valid factory|Failed to load extension/.test(rpc.stderr),rpc.stderr);
 assert(rpc.stdout.split('\n').filter(s=>s.startsWith('{')).map(s=>JSON.parse(s)).some(r=>r.id==='state'&&r.success),rpc.stdout);
 const commands=rpc.stdout.split('\n').filter(s=>s.startsWith('{')).map(s=>JSON.parse(s)).find(r=>r.id==='commands');
 assert.equal(commands?.success,true);assert(commands.data.commands.some(c=>c.name==='messenger'),JSON.stringify(commands));
 console.log('PASS actual provider-free campaign RPC startup, get_state and Messenger get_commands with synthetic empty auth');
} finally {fs.unlinkSync(c.nativeAuthStorage);}
