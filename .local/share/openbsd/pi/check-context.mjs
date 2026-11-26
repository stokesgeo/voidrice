import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, ...extra] = process.argv.slice(2);
if (!root || !path.isAbsolute(root) || path.normalize(root) !== root || extra.length)
  throw new Error('usage: check-context.mjs /absolute/agent-root');
const { ContextPack } = await import(pathToFileURL(path.join(root, 'work-store.mjs')));
const pack = new ContextPack(root);
for (const file of pack.files) pack.read(file.path);
console.log(`Local Pi context verified: ${pack.files.length} files. Runtime task records/settings untouched.`);
