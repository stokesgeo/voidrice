// Native owned-child cancellation test for the experimental C profile.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { compileFunction } from "node:vm";

const code = stripTypeScriptTypes(readFileSync(process.argv[2] + "/.pi/agent/extensions/subagent/child-policy.ts", "utf8"))
	.replaceAll("export function", "function");
const supervise = compileFunction(code + "\nreturn superviseCancellation;", ["setTimeout", "clearTimeout"])(setTimeout, clearTimeout);
for (const ignoreTerm of [false, true]) {
	const program = `${ignoreTerm ? "process.on('SIGTERM',()=>{});" : ""}console.log('ready');setInterval(()=>{},1000);`;
	const child = spawn(process.execPath, ["-e", program], { stdio: ["ignore", "pipe", "ignore"] });
	const controller = new AbortController();
	let aborted = 0;
	supervise(child, controller.signal, () => aborted++, 30);
	const result = new Promise((resolve, reject) => {
		const guard = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("owned fixture did not close")); }, 3000);
		child.on("error", reject);
		child.once("close", (code, signal) => { clearTimeout(guard); resolve({ code, signal }); });
	});
	child.stdout.once("data", () => controller.abort());
	const { code: exitCode, signal } = await result;
	assert.equal(exitCode, null);
	assert.equal(signal, ignoreTerm ? "SIGKILL" : "SIGTERM");
	assert.equal(aborted, 1);
}
{
	const program = `const {spawn}=require('node:child_process');const p=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore',process.stdout,process.stderr]});console.log(p.pid);process.exit(0);`;
	const child = spawn(process.execPath, ["-e", program], { stdio: ["ignore", "pipe", "pipe"] });
	let descendant;
	let drained = false;
	child.stdout.once("data", (data) => { descendant = Number(data.toString().trim()); });
	supervise(child, undefined, () => {}, 30, () => { drained = true; });
	try {
		await new Promise((resolve, reject) => {
			const guard = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("retained pipes prevented completion")); }, 3000);
			child.once("close", () => { clearTimeout(guard); resolve(); });
			child.once("error", reject);
		});
		assert(drained, "retained output was not marked incomplete");
		assert(Number.isInteger(descendant) && descendant > 1);
	} finally {
		if (Number.isInteger(descendant) && descendant > 1) {
			try { process.kill(descendant, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
		}
	}
}
{
	const expected = "\u6e90-\u00e9-\ud83d\ude42";
	const program = `const b=Buffer.from(JSON.stringify({text:${JSON.stringify(expected)}})+'\\n');const cut=b.findIndex(x=>x>127)+1;process.stdout.write(b.subarray(0,cut));process.stderr.write(b.subarray(0,cut));setTimeout(()=>{process.stdout.write(b.subarray(cut));process.stderr.write(b.subarray(cut));},20);`;
	const child = spawn(process.execPath, ["-e", program], { stdio: ["ignore", "pipe", "pipe"] });
	let stdout = "", stderr = "";
	child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
	child.stdout.on("data", data => { stdout += data; });
	child.stderr.on("data", data => { stderr += data; });
	await new Promise((resolve, reject) => {
		const guard = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("owned UTF8 fixture did not close")); }, 3000);
		child.once("close", code => { clearTimeout(guard); code === 0 ? resolve() : reject(new Error("owned UTF8 child failed")); });
		child.once("error", reject);
	});
	assert.equal(JSON.parse(stdout).text, expected);
	assert.equal(JSON.parse(stderr).text, expected);
}
console.log("PASS native TERM cancellation, KILL escalation, retained-pipe draining and split-UTF8 stdout/stderr fidelity; owned descendant explicitly cleaned by the test, not a tree-cancellation claim");
