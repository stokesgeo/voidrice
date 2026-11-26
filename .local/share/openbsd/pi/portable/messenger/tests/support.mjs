import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
export const sourceRoot=fileURLToPath(new URL('../files/',import.meta.url)).replace(/\/$/,'');
const toolchain=process.env.MESSENGER_TYPESCRIPT;
if(!toolchain || !path.isAbsolute(toolchain))throw Error('MESSENGER_TYPESCRIPT must name an absolute installed TypeScript module path');
const ts=createRequire(import.meta.url)(toolchain);
export function compile(text) {
 const result=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
 if(result.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error))throw Error('TypeScript test source failed compilation');
 return result.outputText;
}
