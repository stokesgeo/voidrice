import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=path.dirname(fileURLToPath(import.meta.url));
const route=JSON.parse(fs.readFileSync(root+'/route.json','utf8'));
export function parseArguments(argv) {
 let campaign=false,n=0,setup=false;
 for(;n<argv.length;n++) {if(argv[n]==='--campaign')campaign=true;else if(argv[n]==='--setup')setup=true;else break;}
 if(campaign&&setup)throw Error('mutually exclusive modes');return {campaign,argv:argv.slice(n)};
}
export function argumentsFor({campaign=false,argv=[]}={}) {
 // Recognize only an unambiguous native command/info prefix, never option
 // values or text after "--". The native parser owns everything else.
 let n=0;while(argv[n]==='--offline')n++;
 if(['install','remove','uninstall','update','list','config','auth','mcp'].includes(argv[0])||['--help','-h','--version','-v','--list-models','--export'].includes(argv[n]))return [...argv];
 const r=campaign?route.campaign:route.generic;
 return ['--no-extensions','--no-skills','--no-prompt-templates','--no-themes','--tui-mode','fullscreen','--offline',...(campaign?['--session-dir',route.messenger.sessionDir]:[]),'--append-system-prompt',root+'/agent/AGENTS.md',...['builtin:mcp','builtin:codemode','builtin:tool-search','builtin:llama.cpp',...r.extensions].flatMap(p=>['--extension',p]),...r.skills.flatMap(p=>['--skill',p]),...r.prompts.flatMap(p=>['--prompt-template',p]),...route.themes.flatMap(p=>['--theme',p]),...argv];
}
export function environment(base=process.env,{campaign=false}={}) {
 const m=route.messenger,i=campaign?m:route.instance;
 const env={...base,HOME:route.home,PI_CA_AGENT:i.agentDir,PI_CA_RUNTIME:i.runtimeRoot,PI_CA_NATIVE_AUTH_STORAGE:i.nativeAuthStorage,PI_CODING_AGENT_DIR:i.agentDir,PI_CODING_AGENT_SESSION_DIR:i.sessionDir,VERTRICE_WORK_DIR:i.workDir,AGENT_BOARD_ROOT:i.boardRoot,PI_CA_MESSENGER_CONTRACT:root+'/messenger-contract.json',PI_MESSENGER_DIR:m.transportDir,PI_MESSENGER_TEAM_PROFILE_DIR:m.teamProfileDir,PI_OFFLINE:'1',PI_SKIP_VERSION_CHECK:'1',PI_TELEMETRY:'0',PI_SELF_UPDATE_COMMAND:route.home+'/.local/bin/openbsd/vertrice-update --pi --prepare --version {version} --package {packageName}'};
 if(!campaign) {
  if(base.PI_CODING_AGENT_SESSION_DIR)env.PI_CODING_AGENT_SESSION_DIR=base.PI_CODING_AGENT_SESSION_DIR;
  if(base.VERTRICE_WORK_DIR)env.VERTRICE_WORK_DIR=base.VERTRICE_WORK_DIR;
  delete env.PI_CA_MESSENGER_CONTRACT;
 }
 delete env.PI_PACKAGE_DIR;return env;
}
export function preflightAppend() {
 const p=root+'/agent/AGENTS.md';if(route.instance.immutableResourceDir!==root+'/agent')throw Error('append route mismatch');
 for(let d=path.dirname(p);d!=='/';d=path.dirname(d))if(!fs.lstatSync(d).isDirectory())throw Error('append real ancestor required');
 const s=fs.lstatSync(p);if(!s.isFile()||s.nlink!==1||(s.mode&0o022)||!(s.mode&0o444))throw Error('safe readable append required');return p;
}
function main() {
 for(const marker of ['VERTRICE_PI_CHILD','PI_CA_CREW_CHILD'])if(Object.hasOwn(process.env,marker))throw Error('worker cannot launch root runtime');
 for(const key of ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','DYLD_INSERT_LIBRARIES'])if(process.env[key])throw Error('inherited loader injection');
 const options=parseArguments(process.argv.slice(2));if(options.campaign&&process.cwd()!==route.messenger.campaignRoot)throw Error('exact campaign cwd required');
 preflightAppend();const env=environment(process.env,options);
 const cli=fs.realpathSync(root+'/node_modules/.bin/pi');if(!cli.startsWith(root+'/node_modules/'))throw Error('native CLI route mismatch');
 const child=spawn(process.execPath,[cli,...argumentsFor(options)],{env,stdio:'inherit'});
 for(const signal of ['SIGTERM','SIGHUP'])process.on(signal,()=>child.kill(signal));
 child.on('error',e=>{console.error(e.message);process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});
}
if(process.argv[1]===fileURLToPath(import.meta.url))try{main();}catch(e){console.error('pi generation: '+e.message);process.exitCode=2;}
