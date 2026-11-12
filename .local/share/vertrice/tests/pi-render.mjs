// Exercise the registered renderer, not a copied implementation. No Pi/provider/child launch.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stripTypeScriptTypes } from "node:module";
import { compileFunction } from "node:vm";

const root = process.argv[2];
assert(root, "source root required");
const source = stripTypeScriptTypes(readFileSync(path.join(root, ".pi/agent/extensions/subagent/index.ts"), "utf8"))
	.replace(/^import[\s\S]*?;\r?\n/gm, "").replace("export default function", "function extension");
class Text {
	constructor(text) { this.text = text; }
}
class Markdown extends Text {
	constructor(text, _x, _y, theme) { super(text); assert.equal(theme, markdownTheme); }
}
class Spacer extends Text {
	constructor() { super(""); }
}
class Container {
	children = [];
	addChild(child) { this.children.push(child); }
}
const markdownTheme = {}, theme = { fg: (_color, text) => text, bold: text => text };
const types = new Proxy({}, { get: () => () => ({}) });
let tool;
compileFunction(source + "\nreturn extension;", [
	"os", "path", "Type", "StringEnum", "getAgentDir", "getMarkdownTheme",
	"formatReadLineRange", "Container", "Markdown", "Spacer", "Text",
])(os, path, types, () => ({}), () => "/fixture/agent", () => markdownTheme,
	() => "", Container, Markdown, Spacer, Text)({ registerTool: value => { tool = value; } });
const nodes = component => component instanceof Container ? component.children.flatMap(nodes) : [component];
const render = (mode, results, expanded) => {
	const parts = nodes(tool.renderResult({ content: [{ type: "text", text: "fallback" }],
		details: { mode, agentScope: "user", results } }, { expanded }, theme, {}));
	return { text: parts.map(part => part.text).join("\n"), markdown: parts.filter(part => part instanceof Markdown).map(part => part.text) };
};
let checks = 0;
const check = fn => { fn(); checks++; };
const has = (text, value) => check(() => assert(text.includes(value), `missing ${JSON.stringify(value)} in ${text}`));
const lacks = (text, value) => check(() => assert(!text.includes(value), `unexpected ${JSON.stringify(value)} in ${text}`));
const equal = (actual, expected) => check(() => assert.deepEqual(actual, expected));
const final = "# Final 源-é\nline two\nline three\nline four\nline five\nFINAL-END";
const message = content => ({ role: "assistant", content });
const child = (state, agent = "worker") => ({
	agent, agentSource: "user", task: `Exact task for ${agent}\nsecond task line`, step: 2,
	exitCode: { queued: -2, running: -1, success: 0, failure: 1 }[state],
	messages: state === "queued" ? [] : [message([
		{ type: "thinking", thinking: "PRIVATE-THINKING" },
		{ type: "toolCall", name: "read", arguments: { path: "/fixture/artifact.md" } },
	]), { role: "toolResult", content: [{ type: "text", text: "RAW-TOOL-RESULT" }] }, message([{ type: "text", text: final }])],
	stderr: state === "failure" ? "Child failed to start: ENOENT." : "",
	errorMessage: state === "failure" ? "Provider stopped unexpectedly." : undefined,
	stopReason: state === "failure" ? "error" : undefined,
	usage: { input: 1200, output: 50, cacheRead: 20, cacheWrite: 30, cost: 0.125, contextTokens: 1500, turns: 2 },
	model: "fixture/model",
});

for (const mode of ["single", "parallel", "chain"]) {
	for (const state of ["queued", "running", "success", "failure"]) {
		for (const expanded of [false, true]) {
			const row = child(state), view = render(mode, [row], expanded);
			has(view.text, mode);
			has(view.text, `worker [${{ success: "done", failure: "failed" }[state] ?? state}]`);
			has(view.text, "(user)");
			has(view.text, "2 turns ↑1.2k ↓50 R20 W30 $0.1250 ctx:1.5k fixture/model");
			if (mode === "chain") has(view.text, "Step 2:");
			if (state === "queued" || state === "running") {
				has(view.text, `0/1 done, ${state === "running" ? 1 : 0} running, ${state === "queued" ? 1 : 0} queued`);
			} else has(view.text, `${state === "success" ? 1 : 0}/1 ${mode === "chain" ? "steps" : "tasks"}`);
			if (state === "failure") {
				has(view.text, "[error]");
				has(view.text, row.errorMessage);
				has(view.text, row.stderr);
			}
			if (state === "queued") has(view.text, "(queued...)");
			else has(view.text, "-> read /fixture/artifact.md");
			if (expanded) {
				has(view.text, row.task);
				equal(view.markdown, state === "queued" ? [] : [final]);
			} else {
				lacks(view.text, row.task);
				lacks(view.text, "FINAL-END");
				has(view.text, "Ctrl+O to expand");
				equal(view.markdown, []);
			}
			lacks(view.text, "PRIVATE-THINKING");
			lacks(view.text, "RAW-TOOL-RESULT");
		}
	}
}

// A failed child must not erase siblings, streamed counts, output, tools or usage.
for (const expanded of [false, true]) {
	const rows = [child("failure", "broken"), child("success", "finished"), child("running", "working"), child("queued", "waiting")];
	const view = render("parallel", rows, expanded);
	has(view.text, "2/4 done, 1 running, 1 queued");
	for (const [name, state] of [["broken", "failed"], ["finished", "done"], ["working", "running"], ["waiting", "queued"]]) has(view.text, `${name} [${state}]`);
	has(view.text, rows[0].errorMessage);
	has(view.text, rows[0].stderr);
	has(view.text, "-> read /fixture/artifact.md");
	has(view.text, "Total: 8 turns ↑4.8k ↓200 R80 W120 $0.5000");
	equal(view.markdown, expanded ? [final, final, final] : []);
}
for (const mode of ["single", "parallel", "chain"]) {
	const row = child("success");
	row.messages = [message(Array.from({ length: 12 }, (_, i) => ({ type: "toolCall", name: "bash", arguments: { command: `preview-${i}` } })))];
	const collapsed = render(mode, [row], false), expanded = render(mode, [row], true);
	has(collapsed.text, `${mode === "single" ? 2 : 7} earlier items`);
	lacks(collapsed.text, "$ preview-0\n");
	has(collapsed.text, "$ preview-11");
	for (let i = 0; i < 12; i++) has(expanded.text, `$ preview-${i}`);
	// No operator-side cap on expanded final Markdown, even beside a failed sibling.
	const long = "# Full output\n" + "é".repeat(30000) + "\nLONG-END";
	row.messages.push(message([{ type: "text", text: long }]));
	const rows = mode === "single" ? [row] : [child("failure", "broken"), row];
	const view = render(mode, rows, true);
	equal(view.markdown.at(-1), long);
	for (let i = 0; i < 12; i++) has(view.text, `$ preview-${i}`);
}
// Signal/setup/drain diagnostics and model-level failure with process exit zero.
for (const diagnostic of ["Child terminated by SIGTERM.", "Child setup failed: fixture.", "Output pipes remained open after child exit; capture truncated, descendant cleanup unverified."]) {
	for (const expanded of [false, true]) {
		const row = { ...child("failure"), messages: [], errorMessage: undefined, stderr: diagnostic };
		has(render("parallel", [row, child("success", "sibling")], expanded).text, diagnostic);
	}
}
for (const stopReason of ["error", "aborted"]) {
	const row = { ...child("failure"), exitCode: 0, stopReason };
	const view = render("single", [row], true);
	has(view.text, "worker [failed]");
	has(view.text, `[${stopReason}]`);
	equal(view.markdown, [final]);
}
for (const state of ["running", "success"]) {
	const row = { ...child(state), messages: [] };
	has(render("single", [row], false).text, state === "running" ? "(running...)" : "(no output)");
}
for (const details of [undefined, { mode: "single", results: [] }]) {
	const result = tool.renderResult({ content: [{ type: "text", text: "Invalid parameters: explicit refusal" }], details }, { expanded: false }, theme, {});
	equal(nodes(result).map(node => node.text).join("\n"), "Invalid parameters: explicit refusal");
}
console.log(`PASS ${checks} registered-renderer behavioral assertions; 24 mode/state/expansion cases plus mixed failures, full Markdown, tools, usage and diagnostics; native terminal rendering untested`);
