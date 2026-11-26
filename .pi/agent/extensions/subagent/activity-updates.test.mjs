// Targeted synthetic pipe regression: no child processes, providers, or private state.
// Run: node activity-updates.test.mjs [path/to/index.ts]
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { stripTypeScriptTypes } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const sourcePath = process.argv[2] ?? fileURLToPath(new URL("index.ts", import.meta.url));
const source = readFileSync(sourcePath, "utf8");
const policySource = readFileSync(new URL("child-policy.ts", import.meta.url), "utf8");
const guard = 'if (event.type === "tool_execution_update" && nextActivity === currentResult.activity) return;';
assert.ok(source.includes(guard), "candidate must contain the update-only activity guard");
const snapshot = (value) => JSON.parse(JSON.stringify(value));
function compile(text, globals, tail) {
	const code = stripTypeScriptTypes(text.replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];\s*$/gm, ""), { mode: "transform" })
		.replace("export default function", "function fixtureExtension").replace(/export function /g, "function ");
	const box = vm.createContext({ ...globals });
	vm.runInContext(code + "\n" + tail, box, { filename: sourcePath });
	return box;
}
// Match the production runtime/profile identity contract without reading a real
// generation, native profile, session or provider. Both compiled modules share it.
const fixtureDir = "/fixture/generation/agent/extensions/subagent";
const fixtureProcess = { env: { PI_CA_RUNTIME: "/fixture/generation",
	PI_CODING_AGENT_DIR: "/fixture/profile", PI_CA_AGENT: "/fixture/profile" },
	argv: ["/fixture/node", "/fixture/generation/node_modules/.bin/pi"], execPath: "/fixture/node" };
const policy = compile(policySource, { setTimeout, clearTimeout, path,
	process: fixtureProcess, __dirname: fixtureDir }, "globalThis.policy = { childArgs, superviseCancellation };").policy;
// Assert actual launch argv, not role descriptions or tool registration.
for (const tools of [["read", "grep", "find", "ls"], ["bash"]]) {
	const args = policy.childArgs(tools, "fixture/model");
	assert.equal(args[args.indexOf("--tools") + 1], [...tools, "context_search", "context_read"].join(","));
}
for (const tools of [["read", "write"], ["read", "edit"]]) {
	const args = policy.childArgs(tools, "fixture/model");
	assert.equal(args[args.indexOf("--tools") + 1], [...tools, "work_task", "context_search", "context_read"].join(","));
}
const toolFreeArgs = policy.childArgs([], "fixture/model");
assert.ok(toolFreeArgs.includes("--no-tools") && !toolFreeArgs.includes("--tools"));
const Type = new Proxy({}, { get: () => () => ({}) });
const fixedDate = class extends Date { static now() { return 1000; } };
const toolEvent = (type, name = "bash", id = "a", extra = {}) => ({ type: `tool_execution_${type}`, toolName: name, toolCallId: id, ...extra });
const assistant = (stopReason) => ({ role: "assistant", model: "fixture-model", stopReason,
	content: [{ type: "text", text: "first full output\n" }, { type: "text", text: "second full output" },
		{ type: "toolCall", id: "a", name: "bash", arguments: { command: "synthetic only" } }],
	usage: { input: 2, output: 3, cacheRead: 4, cacheWrite: 5, totalTokens: 14, cost: { total: 0.125 } },
	...(stopReason === "error" ? { errorMessage: "synthetic model error" } : {}) });
const toolMessage = { role: "toolResult", toolCallId: "a", toolName: "bash", content: [{ type: "text", text: "full tool evidence" }], details: { full: [1, 2, 3] } };

async function run(text, events, outcome, mode) {
	let tool;
	let widgets = 0;
	let spawned = 0;
	const updates = [];
	const killed = [];
	const controller = new AbortController();
	const spawn = (command, args, options) => {
		assert.equal(command, fixtureProcess.execPath);
		assert.equal(args[0], fixtureProcess.argv[1]);
		assert.equal(args[args.indexOf("-e") + 1], path.resolve(fixtureDir, "../work.ts"));
		assert.ok(args.includes("--no-context-files") && args.includes("--no-session"));
		assert.equal(options.env.VERTRICE_PI_CHILD, "1");
		assert.equal(options.env.PI_COST_ORIGIN, "fixture");
		assert.equal(options.env.PI_SELF_UPDATE_COMMAND, "/usr/bin/false");
		assert.equal(options.shell, false);
		spawned++;
		if (outcome === "setup-error") throw new Error("synthetic spawn throw");
		const child = new EventEmitter();
		child.pid = 42; // Synthetic liveness, never a real process handle.
		child.stdout = new EventEmitter();
		child.stderr = new EventEmitter();
		child.stdout.setEncoding = child.stderr.setEncoding = () => {};
		child.kill = (signal) => { killed.push(signal); return true; };
		queueMicrotask(() => {
			// Exercise the real JSON framing, including an unterminated last line.
			const wire = events.map((event) => JSON.stringify(event)).join("\n");
			child.stdout.emit("data", wire.slice(0, 17));
			child.stdout.emit("data", wire.slice(17));
			child.stderr.emit("data", "full synthetic stderr\n");
			if (outcome === "cancel") controller.abort();
			if (outcome === "spawn-error") {
				child.emit("error", Object.assign(new Error("fixture"), { code: "ENOENT" }));
			} else {
				child.emit("exit", outcome === "nonzero" ? 7 : 0);
				child.emit("close", outcome === "nonzero" ? 7 : 0, outcome === "cancel" ? "SIGTERM" : null);
			}
		});
		return child;
	};
	const box = compile(text, {
		process: fixtureProcess, __dirname: fixtureDir, Buffer, Date: fixedDate,
		costUUID: () => "fixture-cost-invocation",
		spawn, fs: { realpathSync: (file) => file }, os, path, Type, StringEnum: () => ({}),
		getAgentDir: () => "/fixture/agent", discoverAgents: () => [{ name: "fixture", source: "user", systemPrompt: "", tools: [] }],
		...policy, truncateToWidth: (s) => s,
	}, "globalThis.factory = fixtureExtension;");
	box.factory({ on() {}, registerCommand() {}, registerShortcut() {}, registerTool(t) { tool = t; } });
	const ctx = { cwd: "/fixture", mode: "tui", hasUI: true, model: { provider: "fixture", id: "fixture" },
		sessionManager: { getSessionId: () => "fixture", getLeafId: () => "anchor" }, ui: { setWidget() { widgets++; } } };
	const item = { agent: "fixture", task: "Exact assignment.\nPreserve this too." };
	const params = mode === "single" ? item : { [mode === "parallel" ? "tasks" : "chain"]: [item, item] };
	const result = await tool.execute("fixture", params, controller.signal, (update) => updates.push(snapshot(update)), ctx);
	return { result: snapshot(result), updates, widgets, spawned, killed };
}

// Control retains every publication, but otherwise executes exactly the same source.
const control = source.replace(guard, "/* duplicate publications enabled for comparison */");
let cases = 0;
async function compare(events, outcome = "success", mode = "single", suppressed = 0) {
	const before = await run(control, events, outcome, mode);
	const after = await run(source, events, outcome, mode);
	assert.deepEqual(after.result, before.result, "complete returned content/details must match control");
	assert.equal(before.updates.length - after.updates.length, suppressed, "only duplicate updates are suppressed");
	assert.equal(before.widgets - after.widgets, suppressed, "suppression precedes overview refresh");
	assert.deepEqual(after.killed, before.killed);
	assert.equal(after.spawned, before.spawned);
	const final = after.updates.at(-1)?.details.results.at(-1);
	assert.ok(final && final.exitCode >= 0 && final.endedAt === 1000, "final publication survives unchanged activity");
	assert.deepEqual(final, after.result.details.results.at(-1), "final publication keeps complete evidence");
	cases++;
	return after;
}
const messages = [
	{ type: "message_end", message: toolMessage },
	{ type: "tool_result_end", message: { ...toolMessage, toolCallId: "legacy" } },
	{ type: "message_end", message: assistant("stop") },
];
for (const mode of ["single", "parallel", "chain"]) {
	const workers = mode === "single" ? 1 : 2;
	const storm = [toolEvent("start"), ...Array.from({ length: 32 }, (_, i) => toolEvent("update", "bash", "a", { partialResult: { changing: i } })), toolEvent("end"), ...messages];
	const result = await compare(storm, "success", mode, 32 * workers);
	for (const row of result.result.details.results) {
		assert.deepEqual(row.messages, messages.map((event) => event.message));
		assert.deepEqual(row.usage, { input: 2, output: 3, cacheRead: 4, cacheWrite: 5, cost: 0.125, contextTokens: 14, turns: 1 });
		assert.equal(row.task, "Exact assignment.\nPreserve this too.");
		assert.equal(row.stderr, "full synthetic stderr\n");
	}
	// Start/end must publish even when identical; interleaved/nested IDs are not per-tool caches.
	const lifecycle = [toolEvent("start"), toolEvent("start"), toolEvent("end"), toolEvent("end"), ...messages];
	const lifecycleResult = await compare(lifecycle, "success", mode, 0);
	// Direct child exit publishes liveness separately, before the final close result.
	if (mode === "single") assert.deepEqual(lifecycleResult.updates.map((u) => u.details.results[0].activity),
		["starting", "bash active", "bash active", "bash finished", "bash finished", "bash finished", "bash finished", "bash finished", "bash finished", "bash finished"]);
	await compare(messages, "success", mode, 0);
}
const interleaved = [toolEvent("update", "read"), toolEvent("update", "read"),
	toolEvent("start", "bash", "parent"), toolEvent("update", "read", "parent/1", { parentToolCallId: "parent" }),
	toolEvent("update", "bash", "parent"), toolEvent("update", "bash", "other"),
	toolEvent("update", "private-name-one"), toolEvent("update", "private-name-two"),
	toolEvent("end", "read", "parent/1", { isError: true }), toolEvent("update", "read"), ...messages];
const interleavedResult = await compare(interleaved, "success", "single", 3);
assert.deepEqual(interleavedResult.updates.map((u) => u.details.results[0].activity),
	["starting", "read active", "bash active", "read active", "bash active", "tool active", "read failed", "read active",
		"read active", "read active", "read active", "read active", "read active"]);
// Even byte-identical messages must still be ingested and published, regardless of activity.
const repeatedMessages = [toolEvent("start"), toolEvent("update"), ...messages, ...messages];
const repeatedResult = await compare(repeatedMessages, "success", "single", 1);
assert.equal(repeatedResult.result.details.results[0].messages.length, 6);
assert.equal(repeatedResult.result.details.results[0].usage.turns, 2);
for (const outcome of ["success", "nonzero", "cancel", "spawn-error", "setup-error"]) {
	const events = [toolEvent("start"), toolEvent("update"), ...messages];
	const result = await compare(events, outcome, "single", outcome === "setup-error" ? 0 : 1);
	assert.equal(result.result.details.results[0].exitCode, outcome === "success" ? 0 : outcome === "cancel" ? 130 : outcome === "nonzero" ? 7 : 1);
	if (outcome === "cancel") assert.deepEqual(result.killed, ["SIGTERM"]);
}
for (const reason of ["error", "aborted"]) {
	const events = [toolEvent("start"), toolEvent("update"), { type: "message_end", message: assistant(reason) }];
	const result = await compare(events, "success", "single", 1);
	assert.equal(result.result.isError, true);
	assert.equal(result.result.details.results[0].stopReason, reason);
}
console.log(`PASS: ${cases} targeted activity/lifecycle/final-evidence comparisons`);
