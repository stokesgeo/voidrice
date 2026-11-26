import assert from 'node:assert/strict';
import {absolute,memberName} from './integrity.mjs';
export function routes(dest,home,resources,selected) {
 absolute(dest);absolute(home);
 const stateRoot=home+'/.local/share/vertrice-pi/state',agentDir=home+'/.local/share/vertrice-pi/profile';
 const bindings={agentDir,nativeAgentDir:agentDir,nativeAuthStorage:agentDir+'/auth.json',runtimeRoot:dest,immutableResourceDir:dest+'/agent',launcher:dest+'/pi',sessionDir:home+'/.agents/sessions/pi',workDir:home+'/.agents',boardRoot:stateRoot+'/board'};
 assert(Buffer.byteLength(bindings.boardRoot+'/views/view_0123456789/c')+1<=104,'Board socket path too long');
 const resolveResource=p=>{memberName(p);assert(selected.some(e=>e.path===p||e.path.startsWith(p+'/')),'unlisted route resource');return dest+'/agent/'+p;};
 const list=k=>{assert(Array.isArray(resources[k]));return resources[k].map(resolveResource);};
 const generic={extensions:list('extensions'),skills:list('skills'),prompts:list('prompts')},themes=list('themes');
 assert(Array.isArray(resources.crew?.extensions),'explicit Crew extension selection');
 const campaign={extensions:[...resources.crew.extensions.map(resolveResource),dest+'/messenger/messenger-runtime.cjs'],skills:[...generic.skills,dest+'/messenger/skills'],prompts:generic.prompts};
 const messenger={schema:1,revision:dest,home,...bindings,sessionDir:stateRoot+'/sessions',workDir:stateRoot+'/work',stateRoot,packageRoot:dest+'/messenger',campaignRoot:stateRoot+'/campaign',transportDir:stateRoot+'/messenger',teamProfileDir:stateRoot+'/team',...campaign,themes,contextExtension:resolveResource(resources.contextExtension)};
 if(resources.extensions.includes('extensions/shared-instructions.mjs')) {
  assert(resources.ownerContext?.relativeTo==='HOME'&&resources.ownerContext.path==='.agents/AGENTS.md'&&resources.ownerContext.optional===true,'explicit shared owner-data contract required');
  assert(!resources.crew.extensions.includes('extensions/shared-instructions.mjs'),'shared task/instruction adapter is generic only');
 }
 const ownerContext={path:home+'/.agents/AGENTS.md',optional:true,role:'external owner instructions, not sealed generation bytes',capture:'once per extension instance; SHA256 and visible status at native session boundary'};
 return {bindings,route:{schema:1,home,instance:bindings,generic,campaign,themes,messenger,ownerContext},messengerContract:messenger};
}
