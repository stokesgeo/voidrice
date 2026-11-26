import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {hash,sourceIdentity,inventory} from './integrity.mjs';
const git=(root,args)=>execFileSync('/usr/local/bin/git',['--no-optional-locks','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','core.autocrlf=false','-C',root,...args],{env:{PATH:'/usr/bin:/bin:/usr/local/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_CEILING_DIRECTORIES:path.dirname(root)},maxBuffer:32*1024*1024});
export function prepareBoard(boardRoot,scratch,lock,here) {
 assert.equal(git(boardRoot,['rev-parse','HEAD']).toString().trim(),lock.board.commit,'Board commit');
 assert.equal(git(boardRoot,['diff','HEAD','--']).length,0,'dirty Board tracked source');
 assert.equal(sourceIdentity(boardRoot+'/package-lock.json').sha256,lock.board.lockfileSha256,'Board dependency lock');
 for(const [n,digest] of Object.entries(lock.board.companions))assert.equal(sourceIdentity(here+'/board/'+n).sha256,digest,'Board companion drift');
 const files=git(boardRoot,['ls-tree','-r','--name-only',lock.board.commit]).toString().trim().split('\n');
 fs.mkdirSync(scratch,{mode:0o700});
 for(const name of files) {
  const bytes=git(boardRoot,['show',lock.board.commit+':'+name]);assert.equal(sourceIdentity(boardRoot+'/'+name).sha256,hash(bytes),'Board upstream source drift');
  const p=scratch+'/'+name;fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});fs.writeFileSync(p,bytes,{mode:0o600});
 }
 git(scratch,['apply','--check','--whitespace=nowarn',here+'/board/local.patch']);git(scratch,['apply','--whitespace=nowarn',here+'/board/local.patch']);
 const command=scratch+'/src/commands/agent-board.ts';let text=fs.readFileSync(command,'utf8');
 const replace=(a,b)=>{assert.equal(text.split(a).length,2,'Board transform drift');text=text.replace(a,b);};
 replace('import { DashboardComponent, type DashboardResult } from "../ui/dashboard.js";','import type { DashboardComponent as DashboardComponentType, DashboardResult } from "../ui/dashboard.js";');
 replace('import { PtyAttachComponent, type PtyAttachResult } from "../ui/pty-attach.js";','import type { PtyAttachResult } from "../ui/pty-attach.js";');
 replace('): Promise<DashboardResult> {','): Promise<DashboardResult> {\n const { DashboardComponent } = await import("../ui/dashboard.js");');
 replace('): Promise<PtyAttachResult> {','): Promise<PtyAttachResult> {\n const { PtyAttachComponent } = await import("../ui/pty-attach.js");');
 replace('comp as DashboardComponent &','comp as DashboardComponentType &');fs.writeFileSync(command,text);
 for(const n of ['inline.mjs','compatibility.mjs'])fs.copyFileSync(here+'/board/'+n,scratch+'/src/core/'+n);
 const compatibility=JSON.parse(fs.readFileSync(scratch+'/src/core/compatibility.json'));assert.equal(compatibility.piVersion,'1.6.0');
 for(const v of Object.values(compatibility.packages))assert.equal(v,'1.6.0');
 fs.writeFileSync(scratch+'/src/core/compatibility.json',JSON.stringify({platform:compatibility.platform,arch:compatibility.arch,nodeABI:compatibility.nodeABI,nodeMajor:compatibility.nodeMajor,packages:compatibility.packages,executedRuntime:{bin:compatibility.executedRuntime.bin}},null,2)+'\n');
 const paths=scratch+'/src/core/paths.mjs',before=fs.readFileSync(paths,'utf8');assert.equal(before.split('"control.sock"').length,2);fs.writeFileSync(paths,before.replace('"control.sock"','"c"'));
 return {members:inventory(scratch),qualificationContract:compatibility};
}
