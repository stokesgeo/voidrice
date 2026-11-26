import fs from 'node:fs';
import path from 'node:path';
import { inside } from './candidate-instance.mjs';
export const {existsSync,readFileSync,readdirSync,statSync,realpathSync,mkdirSync,writeFileSync,appendFileSync,unlinkSync,rmdirSync,rmSync,mkdtempSync,renameSync,constants,openSync,closeSync,writeSync,readSync,fstatSync,fsyncSync,watch}=fs;
export function checkedPath(c,p,_write=false) {
 if (typeof p !== 'string' || !path.isAbsolute(p) || path.normalize(p) !== p || ![c.campaignRoot,c.stateRoot,c.agentDir].some(root => inside(root,p))) throw Error('checked path outside explicit routes');
 return p;
}
export function publishFileSync(a,b) { fs.linkSync(a,b); fs.unlinkSync(a); }
