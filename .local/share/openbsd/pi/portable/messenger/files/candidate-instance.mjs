import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const revisionRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const filename = path.join(revisionRoot, 'messenger-contract.json');
const normalized = p => typeof p === 'string' && path.isAbsolute(p) && path.normalize(p) === p;
export const inside = (root, p) => normalized(root) && normalized(p) && p.startsWith(root + '/');
export function validateContract(c) {
 if (!c || c.schema !== 1 || c.revision !== revisionRoot) throw Error('Messenger generated root mismatch');
 for (const k of ['home','agentDir','nativeAuthStorage','stateRoot','campaignRoot']) if (!normalized(c[k])) throw Error('normalized explicit route required: ' + k);
 if (c.nativeAgentDir !== c.agentDir || !inside(c.home,c.agentDir) || !inside(c.agentDir,c.nativeAuthStorage)) throw Error('explicit home/profile/auth route required');
 if (c.runtimeRoot !== c.revision) throw Error('flattened native runtime root required');
 for (const k of ['packageRoot','immutableResourceDir']) if (!inside(c.revision,c[k])) throw Error('generated root boundary: ' + k);
 if (c.packageRoot !== path.dirname(fileURLToPath(import.meta.url))) throw Error('Messenger package root mismatch');
 for (const k of ['sessionDir','workDir','transportDir','teamProfileDir','boardRoot']) if (!inside(c.stateRoot,c[k])) throw Error('private state boundary: ' + k);
 if (c.campaignRoot === c.home || c.campaignRoot === '/' || c.campaignRoot === c.stateRoot) throw Error('finite campaign required');
 for (const k of ['extensions','skills','prompts','themes']) if (!Array.isArray(c[k]) || c[k].some(p => !inside(c.revision,p)) || new Set(c[k]).size !== c[k].length) throw Error('explicit resource boundary: ' + k);
 const entry = path.join(c.packageRoot,'messenger-runtime.cjs');
 if (c.extensions.filter(p => p === entry).length !== 1 || c.extensions.some(p => inside(c.packageRoot,p) && p !== entry)) throw Error('exactly one trusted Messenger entry required');
 if (!c.skills.includes(path.join(c.packageRoot,'skills'))) throw Error('Crew skill required');
 if (!c.contextExtension || !c.extensions.includes(c.contextExtension) || inside(c.packageRoot,c.contextExtension)) throw Error('native context extension required');
 if (c.extensions.some(p => /\/subagent(?:\/|\.)/.test(p))) throw Error('nested dispatcher prohibited');
 return Object.freeze({...c,...Object.fromEntries(['extensions','skills','prompts','themes'].map(k => [k,Object.freeze([...c[k]])]))});
}
let captured;
export function instance() {
 captured ??= validateContract(JSON.parse(fs.readFileSync(filename,'utf8')));
 if (process.env.PI_CA_MESSENGER_CONTRACT !== filename || process.env.PI_CODING_AGENT_DIR !== captured.agentDir || process.env.PI_CA_RUNTIME !== captured.runtimeRoot || process.env.PI_CA_NATIVE_AUTH_STORAGE !== captured.nativeAuthStorage || process.env.HOME !== captured.home) throw Error('native route environment mismatch');
 return captured;
}
export const candidateAgentDir = () => instance().agentDir;
export function childEnvironment(c,base,overrides={},flags={}) {
 for (const key of Object.keys(overrides)) if (/^(HOME|PATH|PI_|VERTRICE_|AGENT_BOARD_|NODE_|LD_|DYLD_|GIT_)/.test(key) || /(AUTH|TOKEN|SECRET|API_KEY|CREDENTIAL)/.test(key)) throw Error('protected child environment override: ' + key);
 for (const key of Object.keys(flags)) if (!['PI_COST_ORIGIN','PI_COST_INVOCATION','PI_AGENT_NAME','PI_CREW_WORKER','PI_LOBBY_ID'].includes(key)) throw Error('unsupported child flag: ' + key);
 const env = {...base,...overrides,...flags,HOME:c.home,PI_CA_MESSENGER_CONTRACT:filename,PI_CA_NATIVE_AUTH_STORAGE:c.nativeAuthStorage,PI_CA_AGENT:c.agentDir,PI_CA_RUNTIME:c.runtimeRoot,PI_CODING_AGENT_DIR:c.agentDir,PI_CODING_AGENT_SESSION_DIR:c.sessionDir,VERTRICE_WORK_DIR:c.workDir,AGENT_BOARD_ROOT:c.boardRoot,PI_MESSENGER_DIR:c.transportDir,PI_MESSENGER_TEAM_PROFILE_DIR:c.teamProfileDir,VERTRICE_PI_CHILD:'1',PI_CA_CREW_CHILD:'1',PI_OFFLINE:'1',PI_SKIP_VERSION_CHECK:'1',PI_TELEMETRY:'0',PI_SELF_UPDATE_COMMAND:'/usr/bin/false'};
 delete env.PI_PACKAGE_DIR;
 return env;
}
export function childArguments(c) {
 if (c !== instance()) throw Error('captured child instance required');
 return ['--offline','--no-extensions','--no-skills','--no-prompt-templates','--no-themes','--session-dir',c.sessionDir,'--append-system-prompt',path.join(c.immutableResourceDir,'AGENTS.md'),...c.extensions.flatMap(p => ['--extension',p]),...c.skills.flatMap(p => ['--skill',p]),...c.prompts.flatMap(p => ['--prompt-template',p]),...c.themes.flatMap(p => ['--theme',p])];
}
export function assertCampaign(c,cwd) { if (cwd !== c.campaignRoot) throw Error('exact campaign cwd required'); }
export function assertCoordinator() { if (process.env.VERTRICE_PI_CHILD === '1' || process.env.PI_CA_CREW_CHILD === '1') throw Error('Crew child cannot delegate; return to root coordinator'); }
export function assertAction(action) { if (['plan','work','review','sync'].includes(action.split('.')[0]) || ['task.revise','task.revise-tree'].includes(action)) assertCoordinator(); }
export function inheritedModel(selected,explicit) {
 const result = explicit ?? selected;
 if (typeof result !== 'string' || result.indexOf('/') < 1 || result.endsWith('/')) throw Error('complete provider/model required');
 return result;
}
let selectedModel;
export function captureSelectedModel(model) { selectedModel = model ? `${model.provider}/${model.id}` : undefined; }
export const selectedExecutionModel = () => selectedModel;
export function mainArguments(c,cwd) { if (cwd !== process.cwd()) throw Error('launch cwd mismatch'); return childArguments(c); }
export function preflightInstance() { return instance(); }
