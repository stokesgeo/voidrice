// Actual Node unit checks; no Pi/model/provider or root operation. C source test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { stripTypeScriptTypes } from "node:module";
import { compileFunction } from "node:vm";
import { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const root = process.argv[2];
assert(root, "source root required");
const policyPath = root + "/.pi/agent/extensions/subagent/child-policy.ts";
const js = stripTypeScriptTypes(readFileSync(policyPath, "utf8")).replaceAll("export function", "function");
const { childArgs, superviseCancellation } = compileFunction(js + "\nreturn { childArgs, superviseCancellation };", ["setTimeout", "clearTimeout"])(setTimeout, clearTimeout);
let checks = 0;
const args = childArgs([], "qualification/fixture", "high");
for (const flag of ["--no-session", "--offline", "--no-approve", "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files", "--no-tools"]) {
	assert(args.includes(flag), flag); checks++;
}
assert(!args.includes("--tools")); checks++;
assert.equal(args[args.indexOf("--model") + 1], "qualification/fixture"); checks++;
assert.equal(args[args.indexOf("--thinking") + 1], "high"); checks++;
assert.throws(() => childArgs([], undefined), /active parent model/); checks++;
for (const forbidden of ["subagent", "codemode", "mcp__anything", "+bash", "*"]) {
	assert.throws(() => childArgs([forbidden], "qualification/fixture"), /Unreviewed child tool/); checks++;
}
const readonly = childArgs(["read", "grep", "find", "ls"], "qualification/fixture");
assert.equal(readonly[readonly.indexOf("--tools") + 1], "read,grep,find,ls"); checks++;
assert(!readonly.includes("--no-tools")); checks++;

const agentsSource = stripTypeScriptTypes(readFileSync(root + "/.pi/agent/extensions/subagent/agents.ts", "utf8"));
const fn = agentsSource.slice(agentsSource.indexOf("export function parseToolList"), agentsSource.indexOf("function loadAgentsFromDir")).replace("export function", "function");
const parse = compileFunction(fn + "\nreturn parseToolList;")();
for (const value of [undefined, null, 10, {}, ["read", 10], ["read", "bash", "subagent"], [], ""]) {
	assert.deepEqual(parse(value), []); checks++;
}
assert.deepEqual(parse("read, grep"), ["read", "grep"]); checks++;

// Discovery must touch only the owner-provisioned role directory, never cwd
// ancestors. Stub parsing here; native fixtures exercise real frontmatter.
const touched = [];
const userDir = path.join(root, ".pi/agent/agents");
const trackedFs = new Proxy(fs, { get(target, key) {
	if (!["existsSync", "readdirSync", "readFileSync", "statSync"].includes(key)) return target[key];
	return (...args) => { touched.push(args[0]); return target[key](...args); };
} });
const discoverySource = agentsSource.replace(/^import .*;\n/gm, "").replaceAll("export function", "function");
const discover = compileFunction(discoverySource + "\nreturn discoverAgents;", ["fs", "path", "getAgentDir", "parseFrontmatter"])(
	trackedFs, path, () => path.dirname(userDir), () => ({ frontmatter: { name: "fixture", description: "fixture", tools: "read" }, body: "fixture" }));
assert.equal(discover().length, 1); checks++;
assert(touched.length > 0 && touched.every(file => file === userDir || file.startsWith(userDir + path.sep))); checks++;

const extension = stripTypeScriptTypes(readFileSync(root + "/.pi/agent/extensions/subagent/index.ts", "utf8"));
assert(extension.includes('proc.stdout.setEncoding("utf8")')); checks++;
assert(extension.includes('proc.stderr.setEncoding("utf8")')); checks++;
const progressFn = extension.slice(extension.indexOf("function sendProgress"), extension.indexOf("async function runSingleAgent"));
const sendProgress = compileFunction(progressFn + "\nreturn sendProgress;")();
assert.doesNotThrow(() => sendProgress(() => { throw new Error("owned broken render fixture"); }, {})); checks++;
const outputFn = extension.slice(extension.indexOf("function getFinalOutput"), extension.indexOf("function isFailedResult"));
const getFinalOutput = compileFunction(outputFn + "\nreturn getFinalOutput;")();
assert.equal(getFinalOutput([{ role: "assistant", content: [{ type: "text", text: "first" }, { type: "thinking", thinking: "not output" }, { type: "text", text: "second" }] }]), "first\nsecond"); checks++;
const chainStatement = extension.split("\n").find((line) => line.includes("const taskWithContext ="));
assert(chainStatement.includes("() => previousOutput")); checks++;
const interpolate = compileFunction(chainStatement + "\nreturn taskWithContext;", ["step", "previousOutput"]);
for (const value of ["$&", "$`", "$'", "$$", "multi\nline", "{previous}"]) {
	assert.equal(interpolate({ task: "before {previous} after" }, value), "before " + value + " after"); checks++;
}
const writerFn = extension.slice(extension.indexOf("async function writePromptToTempFile"), extension.indexOf("function getPiInvocation"));
const promptRoot = fs.mkdtempSync(path.join(tmpdir(), "pi-prompt-check-"));
for (const afterWrite of [false, true]) {
	const queue = async (_file, operation) => { if (afterWrite) await operation(); throw new Error("owned write-failure fixture"); };
	const writer = compileFunction(writerFn + "\nreturn writePromptToTempFile;", ["fs", "path", "os", "withFileMutationQueue"])(fs, path, { tmpdir: () => promptRoot }, queue);
	await assert.rejects(writer("reader", "synthetic prompt"), /owned write-failure fixture/); checks++;
	assert.deepEqual(fs.readdirSync(promptRoot), []); checks++;
}
fs.rmdirSync(promptRoot);

class Child extends EventEmitter {
	signals = [];
	killed = false;
	kill(signal) { this.signals.push(signal); this.killed = true; return true; }
}
{
	const child = new Child(), controller = new AbortController(); let aborted = 0;
	const handle = superviseCancellation(child, controller.signal, () => aborted++, 10);
	controller.abort(); await delay(35);
	assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]); checks++;
	assert.equal(aborted, 1); checks++;
	handle.dispose();
}
{
	const child = new Child(), controller = new AbortController();
	superviseCancellation(child, controller.signal, () => {}, 10);
	controller.abort(); child.emit("close", 1); await delay(35);
	assert.deepEqual(child.signals, ["SIGTERM"]); checks++;
}
for (const event of ["close", "error"]) {
	const child = new Child(), controller = new AbortController();
	superviseCancellation(child, controller.signal, () => {}, 10);
	child.emit(event); controller.abort(); await delay(20);
	assert.deepEqual(child.signals, []); checks++;
}
{
	const child = new Child(), controller = new AbortController(); controller.abort();
	const handle = superviseCancellation(child, controller.signal, () => {}, 10);
	assert.deepEqual(child.signals, ["SIGTERM"]); checks++; handle.dispose();
}
console.log(`PASS ${checks} policy/parser/cancellation assertions; actual timers and mocked child signals; not a native Pi loading test`);
