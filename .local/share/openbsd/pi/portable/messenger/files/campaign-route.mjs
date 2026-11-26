import { assertCampaign } from './candidate-instance.mjs';
export function preflightCampaign(c,cwd) { assertCampaign(c,cwd); return {cwd,agentDir:c.agentDir}; }
export function routeArguments(c,cwd,_store,args) { assertCampaign(c,cwd); return [...args]; }
