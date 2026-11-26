// Optional adopting-owner check: actual Pi 1.6.0 parser/loader/hook, no provider.
// Not a replacement for a fresh generation receipt, launch or persistence test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

if (!process.argv[2]) {
  console.error('SKIP: installed Pi 1.6.0 package directory required; no acquisition attempted');
  process.exit(77);
}
const pkg = path.resolve(process.argv[2]);
const metadata = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json')));
assert.equal(metadata.name, '@earendil-works/pi-coding-agent');
assert.equal(metadata.version, '1.6.0', 'old Pi 1.5.0 is not new-generation evidence');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const generated = path.join(repo, '.pi/agent/extensions/shared-instructions.mjs');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agents-native-')));
const home = path.join(tmp, 'home'), cwd = path.join(home, 'project'), agentDir = path.join(home, 'native-profile');
const keys = ['HOME', 'PI_CODING_AGENT_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME'];
const saved = Object.fromEntries(keys.map(key => [key, process.env[key]])), savedFetch = globalThis.fetch;
let checks = 0;
const check = fn => { fn(); checks++; };
const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, text, { mode: 0o600 }); };
try {
  fs.mkdirSync(cwd, { recursive: true, mode: 0o700 });
  Object.assign(process.env, { HOME: home, PI_CODING_AGENT_DIR: agentDir,
    XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local/share'), XDG_CACHE_HOME: path.join(home, '.cache') });
  globalThis.fetch = () => { throw Error('Network forbidden in native loader smoke'); };
  const { DefaultResourceLoader, SettingsManager, SessionManager, ExtensionRunner, parseArgs } =
    await import(pathToFileURL(path.resolve(pkg, metadata.main)));
  for (const args of [['--offline', '--version'], ['--help']]) {
    const result = spawnSync(process.execPath, [path.join(pkg, metadata.bin.pi), ...args],
      { env: { PATH: process.env.PATH, HOME: home, PI_CODING_AGENT_DIR: agentDir,
        XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local/share'),
        XDG_CACHE_HOME: path.join(home, '.cache'), PI_OFFLINE: '1' },
        encoding: 'utf8', timeout: 30000 });
    check(() => assert.equal(result.status, 0, result.stderr));
  }
  check(() => assert(!fs.existsSync(path.join(home, '.agents'))));
  put(path.join(agentDir, 'AGENTS.md'), 'NATIVE-GLOBAL-FIXTURE\n');
  put(path.join(cwd, 'AGENTS.md'), 'NATIVE-PROJECT-FIXTURE\n');
  put(path.join(agentDir, 'APPEND_SYSTEM.md'), 'NATIVE-IMPLICIT-APPEND\n');
  const sealedAppend = path.join(tmp, 'sealed-append.md');
  put(sealedAppend, 'BASELINE-SEALED-APPEND\n');
  const ownerFile = path.join(home, '.agents/AGENTS.md');
  for (const present of [false, true]) {
    if (present) put(ownerFile, 'SHARED-NATIVE-SENTINEL\n');
    for (const append of [[], ['--append-system-prompt', sealedAppend]]) {
      const parsed = parseArgs(['--extension', generated, ...append]);
      check(() => assert.equal(parsed.diagnostics.length, 0));
      const loader = new DefaultResourceLoader({
        cwd, agentDir, settingsManager: SettingsManager.inMemory({}, { projectTrusted: true }),
        additionalExtensionPaths: parsed.extensions, noSkills: true, noThemes: true, noPromptTemplates: true,
        appendSystemPrompt: parsed.appendSystemPrompt,
      });
      await loader.reload();
      const loaded = loader.getExtensions();
      check(() => assert.deepEqual(loaded.errors, []));
      check(() => assert.equal(loaded.extensions.length, 1));
      const agents = loader.getAgentsFiles().agentsFiles;
      const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, cwd, SessionManager.inMemory(cwd), {});
      const options = { cwd, contextFiles: agents, skills: [], customPrompt: loader.getSystemPrompt(),
        appendSystemPrompt: loader.getAppendSystemPrompt().join('\n\n') };
      for (let i = 0; i < 2; i++) {
        const result = await runner.emitBeforeAgentStart({ messageType: 'user', prompt: 'fixture' }, options);
        const rendered = result.systemPromptOptions.forceSystemPrompt;
        // With no shared input the runner may retain its native options instead
        // of constructing forceSystemPrompt. Native context remains in options.
        if (present) {
          check(() => assert.equal(rendered.split('SHARED-NATIVE-SENTINEL').length - 1, 1));
          check(() => assert(rendered.includes('NATIVE-GLOBAL-FIXTURE') && rendered.includes('NATIVE-PROJECT-FIXTURE')));
          check(() => assert(rendered.includes(append.length ? 'BASELINE-SEALED-APPEND' : 'NATIVE-IMPLICIT-APPEND')));
        } else check(() => assert(!rendered?.includes('SHARED-NATIVE-SENTINEL')));
      }
    }
  }
  console.log(`PASS ${checks} actual Pi 1.6.0 native metadata/parser/extension-loader/before_agent_start checks; generation launch, sessions and providers untested`);
} finally {
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  globalThis.fetch = savedFetch;
  fs.rmSync(tmp, { recursive: true, force: true });
}
