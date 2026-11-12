import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = path.join(process.env.HOME, '.pi/agent');
const { ContextPack } = await import(pathToFileURL(path.join(root, 'work-store.mjs')));
const pack = new ContextPack(root);
for (const file of pack.files) pack.read(file.path);
console.log(`Local Pi context verified: ${pack.files.length} files. Runtime task records/settings untouched.`);
