// Native-child launch policy. Cooperative checks, not an OS sandbox.
import * as path from "node:path";
import type { ChildProcess } from "node:child_process";

const allowed = new Set(["read", "grep", "find", "ls", "bash", "edit", "write"]);

export function childArgs(tools: string[], model?: string, thinking?: string): string[] {
	if (!model) throw new Error("Cannot delegate without an active parent model");
	if (tools.some((tool) => !allowed.has(tool))) throw new Error("Unreviewed child tool");
	const args = ["--mode", "json", "-p", "--no-session", "--offline", "--no-approve",
		"--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files",
		"--model", model];
	const agent = process.env.PI_CODING_AGENT_DIR;
	if (!agent || agent !== process.env.PI_CA_AGENT) throw new Error('Generation agent identity missing');
	args.push('-e', path.resolve(__dirname, '../work.ts'));
	if (thinking) args.push("--thinking", thinking);
	if (tools.length) {
		const extra = tools.includes("write") || tools.includes("edit") ? ["work_task"] : [];
		args.push("--tools", [...tools, ...extra, "context_search", "context_read"].join(","));
	} else args.push("--no-tools");
	return args;
}

export function superviseCancellation(child: ChildProcess, signal: AbortSignal | undefined,
	onAbort: () => void, graceMs = 5000, onDrain: () => void = () => {}): { dispose: () => void } {
	let closed = false;
	let exited = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let drainTimer: ReturnType<typeof setTimeout> | undefined;
	const abort = () => {
		if (closed || exited || timer) return;
		onAbort();
		child.kill("SIGTERM");
		// child.killed only says kill(2) was sent, not that the process exited.
		timer = setTimeout(() => { if (!closed) child.kill("SIGKILL"); }, graceMs);
		timer.unref?.();
	};
	const dispose = () => {
		closed = true;
		if (timer) clearTimeout(timer);
		if (drainTimer) clearTimeout(drainTimer);
		signal?.removeEventListener("abort", abort);
	};
	child.once("exit", () => {
		exited = true;
		if (timer) clearTimeout(timer);
		signal?.removeEventListener("abort", abort);
		// A descendant can retain these pipes after the direct child exits.
		// Bound draining without claiming the descendant was stopped.
		drainTimer = setTimeout(() => {
			if (!closed) {
				onDrain();
				child.stdout?.destroy();
				child.stderr?.destroy();
			}
		}, graceMs);
		drainTimer.unref?.();
	});
	child.once("close", dispose);
	child.once("error", dispose);
	if (signal?.aborted) abort();
	else signal?.addEventListener("abort", abort, { once: true });
	return { dispose };
}
