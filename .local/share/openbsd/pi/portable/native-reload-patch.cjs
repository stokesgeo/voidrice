'use strict';
// Pi 1.6.0 qualified native adapter, modular SDK and bundled CLI.
const fs = require('node:fs');
const path = require('node:path');
const prefix = 'node_modules/@earendil-works/pi-coding-agent/dist/';
const specs = [];
function spec(target, input, replacements) { specs.push({ target: prefix + target, input, replacements }); }
// Constructor-only default Working cadence; standalone Loader/custom indicators stay native.
spec('modes/interactive/components/status-indicator.js', 'bf3ba6649b4018d3c7a795911aa6417cb9399efad56667229ef91450ec60e0d9', [
  ['        super("working", ui, colorFn ?? ((text) => theme.fg("accent", text)), colorFn ?? ((text) => theme.fg("muted", text)), message, indicator);',
   '        super("working", ui, colorFn ?? ((text) => theme.fg("accent", text)), colorFn ?? ((text) => theme.fg("muted", text)), message, indicator);\n        if (indicator === undefined) {\n            this.intervalMs = 250;\n            this.restartAnimation();\n        }'],
]);
const imported = 'import { beginOwned, finishOwned, failOwned, finalizeOwnedStartup, ownedStatus, preflightOwned, captureOwnedPaths } from "../owned-resources.mjs";\n';
const quiet = `if (options?.quiet) {
            if (this.session.isStreaming || this.session.isCompacting) throw new Error("Wait for idle before reloading");
            if (!options.resourcesOnly) throw new Error("Quiet reload requires resourcesOnly");
            preflightOwned(this.session.resourceLoader);
            this.resetExtensionUI();
            const failures = [];
            try { await this.session.reload({ resourcesOnly: true }); }
            catch (error) { failures.push(error); }
            finally {
                // Attempt every reconciliation step even if a diagnostic/theme getter throws.
                // Do not replace the editor, rebuild chat, or hide the original failure.
                for (const refresh of [
                    () => setRegisteredThemes(this.session.resourceLoader.getThemes().themes),
                    () => this.themeController.applyFromSettings(),
                    () => this.setupAutocompleteProvider(),
                    () => this.setupExtensionShortcuts(this.session.extensionRunner),
                    () => this.ui.requestRender(),
                ]) {
                    try { refresh(); } catch (error) { failures.push(error); }
                }
            }
            if (failures.length) {
                failOwned(this.session.resourceLoader);
                throw new Error(failures.map(error => error instanceof Error ? error.message : String(error)).join('; '));
            }
            return;
        }
        `;
spec('core/resource-loader.js', '86a7f4c1112f11a198ce2f23b4abfd1fb534a003ce0afa226b2b6de655a32295', [
  ['    async reload(options) {', `    getOwnedResourceSnapshot() { return ownedStatus(this); }
    async reload(options) {
        if (options?.resourcesOnly && options?.resolveProjectTrust) throw new Error("Resources-only reload cannot resolve project trust");
        beginOwned(this, options?.resourcesOnly);
        try {`],
  ['        await this.settingsManager.reload();\n        const resolvedPaths = await this.packageManager.resolve();\n        const cliExtensionPaths = await this.packageManager.resolveExtensionSources(this.additionalExtensionPaths, {\n            temporary: true,\n        });', `        if (!options?.resourcesOnly) await this.settingsManager.reload();
        const resolvedPaths = options?.resourcesOnly ? this._ownedPaths.resolvedPaths : await this.packageManager.resolve();
        const cliExtensionPaths = options?.resourcesOnly ? this._ownedPaths.cliExtensionPaths : await this.packageManager.resolveExtensionSources(this.additionalExtensionPaths, { temporary: true });
        this._ownedPaths = { resolvedPaths, cliExtensionPaths };
        captureOwnedPaths(this);`],
  ['        this.loaded = true;\n    }', '        this.loaded = true;\n        if (!options?.deferOwnedCompletion) finishOwned(this);\n        } catch (error) { failOwned(this); throw error; }\n    }'],
]);
spec('core/agent-session.js', 'cd1c9fc3139e6dcd5320b55414aa5fdf12dbea32d4fd38da2c9a57be0d3677c3', [
  ['            getSystemPrompt: () => this.systemPrompt,', '            getOwnedResourceSnapshot: () => ownedStatus(this._resourceLoader),\n            getSystemPrompt: () => this.systemPrompt,'],
  ['        const oldRunner = this._extensionRunner;\n        const previousFlagValues', '        beginOwned(this._resourceLoader, options?.resourcesOnly);\n        try {\n        const oldRunner = this._extensionRunner;\n        const oldErrorBaseline = oldRunner._ownedReloadErrorCount ?? 0;\n        const previousFlagValues'],
  ['        await emitSessionShutdownEvent(oldRunner, { type: "session_shutdown", reason: "reload" });', '        await emitSessionShutdownEvent(oldRunner, { type: "session_shutdown", reason: "reload" });\n        const shutdownErrors = oldRunner._ownedReloadErrorCount > oldErrorBaseline ? oldRunner._ownedReloadErrors.slice(-Math.min(100, oldRunner._ownedReloadErrorCount - oldErrorBaseline)) : [];'],
  ['        await this.settingsManager.reload();\n        this.syncQueueModesFromSettings();\n        resetApiProviders();\n        await this._resourceLoader.reload();', '        if (!options?.resourcesOnly) await this.settingsManager.reload();\n        this.syncQueueModesFromSettings();\n        resetApiProviders();\n        await this._resourceLoader.reload({ resourcesOnly: options?.resourcesOnly, deferOwnedCompletion: true });'],
  ['            await this.extendResourcesFromExtensions("reload");\n        }\n    }', '            await this.extendResourcesFromExtensions("reload");\n        }\n        finishOwned(this._resourceLoader, true, [...shutdownErrors, ...(this._extensionRunner._ownedReloadErrors ?? [])]);\n        } catch (error) { failOwned(this._resourceLoader); throw error; }\n    }'],
]);
spec('core/extensions/runner.js', '9066e23749ee3c07757bce70f293003281a180df5e7c8bc9dc829721769dfadc', [
  ['    emitError(error) {', '    emitError(error) {\n        this._ownedReloadErrorCount = (this._ownedReloadErrorCount ?? 0) + 1;\n        (this._ownedReloadErrors ??= []).push(`${error.extensionPath}: ${error.error}`);\n        if (this._ownedReloadErrors.length > 100) this._ownedReloadErrors.shift();'],
  ['        context.reload = () => {\n            this.assertActive();\n            return this.reloadHandler();', '        context.reload = (options) => {\n            this.assertActive();\n            if (options?.resourcesOnly && this.mode !== "tui") throw new Error("Automatic resource reload requires TUI mode");\n            return this.reloadHandler(options);'],
  ['        this.getModel = contextActions.getModel;', '        this.getOwnedResourceSnapshot = contextActions.getOwnedResourceSnapshot;\n        this.getModel = contextActions.getModel;'],
  ['            get cwd() {', '            get ownedResources() { runner.assertActive(); return runner.getOwnedResourceSnapshot?.(); },\n            get cwd() {'],
]);
spec('modes/interactive/interactive-mode.js', '8c98aa79a90070c5df772b308fcfe3643656ebcd6fc909b52c25a6aa98153129', [
  ['                reload: async () => {\n                    await this.handleReloadCommand();', '                reload: async (options) => {\n                    await this.handleReloadCommand(options);'],
  ['            this.showStatus(savedImplicitProjectTrust', '            if (!this.session.resourceLoader.getOwnedResourceSnapshot().failed) this.showStatus(savedImplicitProjectTrust'],
  ['    async run() {\n        await this.init();', '    async run() {\n        await this.init();\n        await this.settingsManager.flush();\n        finalizeOwnedStartup(this.session.resourceLoader);'],
  ['            this.showError(`Reload failed: ${error instanceof Error ? error.message : String(error)}`);', `            failOwned(this.session.resourceLoader);
            for (const refresh of [
                () => setRegisteredThemes(this.session.resourceLoader.getThemes().themes),
                () => this.themeController.applyFromSettings(),
                () => this.setupAutocompleteProvider(),
                () => this.setupExtensionShortcuts(this.session.extensionRunner),
                () => this.ui.requestRender(),
            ]) {
                try { refresh(); } catch (refreshError) { this.showError(String(refreshError)); }
            }
            this.showError(\`Reload failed: \${error instanceof Error ? error.message : String(error)}\`);`],
  ['    async handleReloadCommand() {', '    async handleReloadCommand(options) {\n        ' + quiet],
]);
spec('core/extensions/types.d.ts', '3c1728cdf8f9255273047cb260fddb6827637c55eb4edfe06f78f3e18823afd7', [
  ['    reload(): Promise<void>;', '    reload(options?: { quiet?: boolean; resourcesOnly?: boolean }): Promise<void>;'],
  ['    reload: () => Promise<void>;', '    reload: (options?: { quiet?: boolean; resourcesOnly?: boolean }) => Promise<void>;'],
  ['export interface ExtensionContext {', 'export interface ExtensionContext {\n    /** Best-effort native load baseline; absent on unpatched runtimes. */\n    readonly ownedResources?: { baseline?: string; current?: string; blocked?: string; failed?: boolean; dirty?: boolean };'],
]);
spec('bundle/chunks/chunk-KSDI5FD4.js', '5558c943edf1c00ca788788bc6b041d6a70a50ae7e646be2192ad399f1df7e34', [
  ['super("working",ui,colorFn??(text=>theme.fg("accent",text)),colorFn??(text=>theme.fg("muted",text)),message,indicator)', 'super("working",ui,colorFn??(text=>theme.fg("accent",text)),colorFn??(text=>theme.fg("muted",text)),message,indicator);if(indicator===undefined){this.intervalMs=250;this.restartAnimation()}'],
  ['async reload(options){resetTimings("extensions")', 'getOwnedResourceSnapshot(){return ownedStatus(this)}async reload(options){if(options?.resourcesOnly&&options?.resolveProjectTrust)throw new Error("Resources-only reload cannot resolve project trust");beginOwned(this,options?.resourcesOnly);try{resetTimings("extensions")'],
  ['await this.settingsManager.reload();let resolvedPaths=await this.packageManager.resolve(),cliExtensionPaths=await this.packageManager.resolveExtensionSources(this.additionalExtensionPaths,{temporary:!0}),installWarnings=', 'if(!options?.resourcesOnly)await this.settingsManager.reload();let resolvedPaths=options?.resourcesOnly?this._ownedPaths.resolvedPaths:await this.packageManager.resolve(),cliExtensionPaths=options?.resourcesOnly?this._ownedPaths.cliExtensionPaths:await this.packageManager.resolveExtensionSources(this.additionalExtensionPaths,{temporary:!0});this._ownedPaths={resolvedPaths,cliExtensionPaths};captureOwnedPaths(this);let installWarnings='],
  ['this.loaded=!0}async loadCurrentExtensionSet', 'this.loaded=!0;if(!options?.deferOwnedCompletion)finishOwned(this)}catch(error){failOwned(this);throw error}}async loadCurrentExtensionSet'],
  ['getSystemPrompt:()=>this.systemPrompt,', 'getOwnedResourceSnapshot:()=>ownedStatus(this._resourceLoader),getSystemPrompt:()=>this.systemPrompt,'],
  ['let oldRunner=this._extensionRunner,previousFlagValues=oldRunner.getFlagValues();', 'beginOwned(this._resourceLoader,options?.resourcesOnly);try{let oldRunner=this._extensionRunner,oldErrorBaseline=oldRunner._ownedReloadErrorCount??0,previousFlagValues=oldRunner.getFlagValues();'],
  ['await emitSessionShutdownEvent(oldRunner,{type:"session_shutdown",reason:"reload"}),oldRunner.invalidate();', 'await emitSessionShutdownEvent(oldRunner,{type:"session_shutdown",reason:"reload"});let shutdownErrors=oldRunner._ownedReloadErrorCount>oldErrorBaseline?oldRunner._ownedReloadErrors.slice(-Math.min(100,oldRunner._ownedReloadErrorCount-oldErrorBaseline)):[];oldRunner.invalidate();'],
  ['await this.settingsManager.reload(),this.syncQueueModesFromSettings(),resetApiProviders(),await this._resourceLoader.reload();', 'if(!options?.resourcesOnly)await this.settingsManager.reload();this.syncQueueModesFromSettings(),resetApiProviders(),await this._resourceLoader.reload({resourcesOnly:options?.resourcesOnly,deferOwnedCompletion:true});'],
  ['await this.extendResourcesFromExtensions("reload"))}_isRetryableError', 'await this.extendResourcesFromExtensions("reload"));finishOwned(this._resourceLoader,true,[...shutdownErrors,...(this._extensionRunner._ownedReloadErrors??[])])}catch(error){failOwned(this._resourceLoader);throw error}}_isRetryableError'],
  ['context.reload=()=>(this.assertActive(),this.reloadHandler())', 'context.reload=options=>{this.assertActive();if(options?.resourcesOnly&&this.mode!=="tui")throw new Error("Automatic resource reload requires TUI mode");return this.reloadHandler(options)}'],
  ['emitError(error){', 'emitError(error){this._ownedReloadErrorCount=(this._ownedReloadErrorCount??0)+1;(this._ownedReloadErrors??=[]).push(`${error.extensionPath}: ${error.error}`);if(this._ownedReloadErrors.length>100)this._ownedReloadErrors.shift();'],
  ['this.getModel=contextActions.getModel,', 'this.getOwnedResourceSnapshot=contextActions.getOwnedResourceSnapshot,this.getModel=contextActions.getModel,'],
  ['get cwd(){return runner.assertActive(),runner.cwd}', 'get ownedResources(){return runner.assertActive(),runner.getOwnedResourceSnapshot?.()},get cwd(){return runner.assertActive(),runner.cwd}'],
  ['reload:async()=>{await this.handleReloadCommand()}', 'reload:async options=>{await this.handleReloadCommand(options)}'],
  ['this.showStatus(savedImplicitProjectTrust?', 'this.session.resourceLoader.getOwnedResourceSnapshot().failed||this.showStatus(savedImplicitProjectTrust?'],
  ['async run(){if(await this.init(),', 'async run(){if(await this.init(),await this.settingsManager.flush(),finalizeOwnedStartup(this.session.resourceLoader),'],
  ['reloadBoxDismissed||dismissReloadBox(previousEditor),this.showError(`Reload failed: ${error instanceof Error?error.message:String(error)}`)', 'reloadBoxDismissed||dismissReloadBox(previousEditor);failOwned(this.session.resourceLoader);for(const refresh of [()=>setRegisteredThemes(this.session.resourceLoader.getThemes().themes),()=>this.themeController.applyFromSettings(),()=>this.setupAutocompleteProvider(),()=>this.setupExtensionShortcuts(this.session.extensionRunner),()=>this.ui.requestRender()]){try{refresh()}catch(refreshError){this.showError(String(refreshError))}}this.showError(`Reload failed: ${error instanceof Error?error.message:String(error)}`)'],
  ['async handleReloadCommand(){', 'async handleReloadCommand(options){' + quiet],
]);
for (const s of specs) {
  if (s.target.endsWith('/runner.js') || s.target.endsWith('/status-indicator.js') || s.target.endsWith('.d.ts')) continue;
  const levels = s.target.includes('/modes/interactive/') || s.target.includes('/bundle/chunks/') ? '../../' : '../';
  // Import at the beginning without depending on upstream import order.
  s.prepend = imported.replace('../owned-resources.mjs', levels + 'owned-resources.mjs');
}
module.exports = { specs, helperTarget: prefix + 'owned-resources.mjs', helper: fs.readFileSync(path.join(__dirname, 'owned-resources.mjs')) };
