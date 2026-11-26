// Runtime compatibility is shape/ABI/routing, not recursive build qualification.
import {readFileSync,realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
const source=new URL('../../',import.meta.url);
const json=p=>JSON.parse(readFileSync(p,'utf8'));
export const compatibility=json(new URL('./compatibility.json',import.meta.url));
const instance=json(new URL('./instance.json',import.meta.url));
export function assertCompatibility(home,{hostPackage,hostEntry,runtimeRoot=instance.runtimeRoot,contract=compatibility}={}) {
 const c=contract,fail=s=>{throw Error('Board compatibility: '+s);};
 if(process.platform!==c.platform||process.arch!==c.arch||process.versions.modules!==c.nodeABI||Number(process.versions.node.split('.')[0])!==c.nodeMajor)fail('platform/Node ABI mismatch');
 const generation=realpathSync(runtimeRoot),modules=join(generation,'node_modules');
 const piPackage=realpathSync(join(modules,'@earendil-works/pi-coding-agent'));
 const cli=realpathSync(join(modules,c.executedRuntime.bin));
 if(realpathSync(join(modules,'.bin/pi'))!==cli)fail('native bin route mismatch');
 if(hostPackage!==undefined&&(realpathSync(hostPackage)!==piPackage||!hostEntry||realpathSync(hostEntry)!==cli))fail('host/child runtime mismatch');
 for(const [name,version] of Object.entries(c.packages))if(json(join(modules,name,'package.json')).version!==version)fail('package version mismatch: '+name);
 // dlopen performs real native ABI validation. It starts no PTY or daemon.
 require(new URL('node_modules/node-pty/build/Release/pty.node',source).pathname);
 return {generation,piPackage,cli,node:process.version,nodeABI:process.versions.modules};
}
