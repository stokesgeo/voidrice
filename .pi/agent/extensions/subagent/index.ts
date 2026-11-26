import { randomUUID as costUUID } from "node:crypto";
/**
 * Subagent Tool - Delegate tasks to specialized agents
 *
 * Spawns a separate `pi` process for each subagent invocation,
 * giving it an isolated context window.
 *
 * Supports three modes:
 *   - Single: { agent: "name", task: "..." }
 *   - Parallel: { tasks: [{ agent: "name", task: "..." }, ...] }
 *   - Chain: { chain: [{ agent: "name", task: "... {previous} ..." }, ...] }
 *
 * Uses JSON mode to capture structured output from subagents.
 */

import { spawn } from "node:child_process";
import { childArgs, superviseCancellation } from "./child-policy.ts";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import {
	type ExtensionAPI,
	type ExtensionContext,
	formatReadLineRange,
	getAgentDir,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { Text, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { callView, resultView, inspectorLines, safeText } from "./compact-ui.ts";
import { Type } from "typebox";
import { type AgentConfig, type AgentScope, discoverAgents } from "./agents.ts";

const immutableAgentRoot = path.resolve(__dirname, '../..');
const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const PER_TASK_OUTPUT_CAP = 50 * 1024;

interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

interface SingleResult {
	agent: string;
	agentSource: "user" | "project" | "unknown";
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
	startedAt?: number;
	endedAt?: number;
	activity?: string;
	captureIncomplete?: boolean;
	processActive?: boolean;
	cancellationPending?: boolean;
	overviewState?: "skipped" | "cancelled" | "incomplete";
}

interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScope;
	results: SingleResult[];
	// Presentation metadata references results; legacy full snapshots remain readable.
	overviewResults?: (SingleResult | OverviewMetadata)[];
}

function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			const parts = msg.content.filter((part) => part.type === "text").map((part) => part.text);
			if (parts.length) return parts.join("\n");
		}
	}
	return "";
}

function isFailedResult(result: SingleResult): boolean {
	return result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
}

function getResultOutput(result: SingleResult): string {
	if (isFailedResult(result)) {
		return result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
	}
	return getFinalOutput(result.messages) || "(no output)";
}

function truncateParallelOutput(output: string): string {
	const byteLength = Buffer.byteLength(output, "utf8");
	if (byteLength <= PER_TASK_OUTPUT_CAP) return output;

	let truncated = output.slice(0, PER_TASK_OUTPUT_CAP);
	while (Buffer.byteLength(truncated, "utf8") > PER_TASK_OUTPUT_CAP) {
		truncated = truncated.slice(0, -1);
	}
	return `${truncated}\n\n[Output truncated: ${byteLength - Buffer.byteLength(truncated, "utf8")} bytes omitted. Full output preserved in tool details.]`;
}

async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			results[current] = await fn(items[current], current);
		}
	});
	await Promise.all(workers);
	return results;
}

async function writePromptToTempFile(agentName: string, prompt: string): Promise<{ dir: string; filePath: string }> {
	const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
	const safeName = agentName.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
	try {
		await withFileMutationQueue(filePath, async () => {
			await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
		});
		return { dir: tmpDir, filePath };
	} catch (error) {
		// The caller does not yet own these paths if creation rejects.
		try { fs.unlinkSync(filePath); } catch { /* absent file or cleanup failure */ }
		try { fs.rmdirSync(tmpDir); } catch { /* best effort under filesystem failure */ }
		throw error;
	}
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const selected = process.env.PI_CA_RUNTIME;
	if (!selected) throw new Error('Candidate runtime identity missing');
	const entry = fs.realpathSync(path.join(selected, 'node_modules/.bin/pi'));
	if (!process.argv[1] || fs.realpathSync(process.argv[1]) !== entry) throw new Error('Candidate worker parent entry mismatch');
	return { command: process.execPath, args: [entry, ...args] };
}

type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

function sendProgress(callback: OnUpdateCallback | undefined, update: AgentToolResult<SubagentDetails>): void {
	// Rendering/consumer failure must not abandon live child supervision.
	try { callback?.(update); } catch { /* final results still return normally */ }
}

interface DispatchDefaults {
 costOrigin?: string;
	model?: string;
	thinkingLevel?: ThinkingLevel;
}

async function runSingleAgent(
	defaultCwd: string,
	dispatchDefaults: DispatchDefaults,
	agents: AgentConfig[],
	agentName: string,
	task: string,
	cwd: string | undefined,
	step: number | undefined,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdateCallback | undefined,
	makeDetails: (results: SingleResult[]) => SubagentDetails,
): Promise<SingleResult> {
	const agent = agents.find((a) => a.name === agentName);

	if (!agent) {
		const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
		return {
			agent: agentName,
			agentSource: "unknown",
			task,
			exitCode: 1,
			messages: [],
			stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
			step,
		};
	}

	let args: string[] = [];
	const model = agent.model ?? dispatchDefaults.model;

	let tmpPromptDir: string | null = null;
	let tmpPromptPath: string | null = null;
	let captureIncomplete = false;

	const currentResult: SingleResult = {
		agent: agentName,
		agentSource: agent.source,
		task,
		exitCode: -1,
		messages: [],
		stderr: "",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
		model,
		step,
		startedAt: Date.now(),
		activity: "starting",
	};

	const emitUpdate = () => {
		if (onUpdate) {
			sendProgress(onUpdate, {
				content: [{ type: "text", text: getFinalOutput(currentResult.messages) || "(running...)" }],
				details: makeDetails([currentResult]),
			});
		}
	};

	try {
		if (signal?.aborted) {
			currentResult.exitCode = 130;
			currentResult.stderr = "Subagent aborted before launch.";
			return currentResult;
		}
		args = childArgs(agent.tools ?? [], model, agent.model ? undefined : dispatchDefaults.thinkingLevel);
		if (agent.systemPrompt.trim()) {
			const shared = fs.readFileSync(path.join(immutableAgentRoot, 'AGENTS.md'), "utf8");
			const tmp = await writePromptToTempFile(agent.name, `${shared}\n\n${agent.systemPrompt}`);
			tmpPromptDir = tmp.dir;
			tmpPromptPath = tmp.filePath;
			args.push("--append-system-prompt", tmpPromptPath);
		}

		args.push(`Task: ${task}`);
		let wasAborted = false;

		const exitCode = await new Promise<number>((resolve) => {
			if (signal?.aborted) { wasAborted = true; resolve(1); return; }
			const invocation = getPiInvocation(args);
			const env: NodeJS.ProcessEnv = { ...process.env, VERTRICE_PI_CHILD: "1", PI_COST_ORIGIN: dispatchDefaults.costOrigin, PI_COST_INVOCATION: costUUID(), PI_SELF_UPDATE_COMMAND: '/usr/bin/false' };
			delete env.SSH_AUTH_SOCK;
			const proc = spawn(invocation.command, invocation.args, {
				cwd: cwd ?? defaultCwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
				env,
			});
			currentResult.processActive = proc.pid !== undefined;
			emitUpdate();
			proc.once("exit", () => { currentResult.processActive = false; emitUpdate(); });
			const cancel = superviseCancellation(proc, signal, () => {
				wasAborted = true;
				currentResult.cancellationPending = true;
				emitUpdate();
			}, 5000, () => {
				captureIncomplete = true;
				currentResult.captureIncomplete = true;
				currentResult.stderr += "Output pipes remained open after child exit; capture truncated, descendant cleanup unverified.";
			});
			let buffer = "";
			// Preserve characters split across arbitrary pipe chunk boundaries.
			proc.stdout.setEncoding("utf8");
			proc.stderr.setEncoding("utf8");

			const processLine = (line: string) => {
				if (!line.trim()) return;
				let event: any;
				try {
					event = JSON.parse(line);
				} catch {
					return;
				}

				if (["tool_execution_start", "tool_execution_update", "tool_execution_end"].includes(event.type)) {
					// Never persist arguments, paths, output, or arbitrary tool names in the widget.
					const name = ["read", "write", "edit", "bash", "ls", "find", "grep"].includes(event.toolName) ? event.toolName : "tool";
					const nextActivity = `${name} ${event.type === "tool_execution_end" ? (event.isError ? "failed" : "finished") : "active"}`;
					// Updates carry only activity here; keep lifecycle and message publications unconditional.
					if (event.type === "tool_execution_update" && nextActivity === currentResult.activity) return;
					currentResult.activity = nextActivity;
					emitUpdate();
				}

				if (event.type === "message_end" && event.message) {
					const msg = event.message as Message;
					currentResult.messages.push(msg);

					if (msg.role === "assistant") {
						currentResult.usage.turns++;
						const usage = msg.usage;
						if (usage) {
							currentResult.usage.input += usage.input || 0;
							currentResult.usage.output += usage.output || 0;
							currentResult.usage.cacheRead += usage.cacheRead || 0;
							currentResult.usage.cacheWrite += usage.cacheWrite || 0;
							currentResult.usage.cost += usage.cost?.total || 0;
							currentResult.usage.contextTokens = usage.totalTokens || 0;
						}
						if (!currentResult.model && msg.model) currentResult.model = msg.model;
						if (msg.stopReason) currentResult.stopReason = msg.stopReason;
						if (msg.errorMessage) currentResult.errorMessage = msg.errorMessage;
					}
					emitUpdate();
				}

				if (event.type === "tool_result_end" && event.message) {
					currentResult.messages.push(event.message as Message);
					emitUpdate();
				}
			};

			proc.stdout.on("data", (data) => {
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) processLine(line);
			});

			proc.stderr.on("data", (data) => {
				currentResult.stderr += data.toString();
			});

			proc.on("close", (code, childSignal) => {
				cancel.dispose();
				if (buffer.trim()) processLine(buffer);
				if (childSignal) currentResult.stderr += `Child terminated by ${childSignal}.`;
				resolve(code ?? 1);
			});

			proc.on("error", (error: NodeJS.ErrnoException) => {
				currentResult.processActive = false;
				cancel.dispose();
				currentResult.stderr += `Child failed to start: ${error.code ?? "unknown error"}.`;
				resolve(1);
			});
		});

		currentResult.exitCode = captureIncomplete ? 1 : exitCode;
		if (wasAborted) {
			currentResult.exitCode = 130;
			currentResult.stderr += "Subagent aborted; task completion unverified.";
		}
		return currentResult;
	} catch (error) {
		currentResult.exitCode = 1;
		currentResult.stderr += `Child setup failed: ${error instanceof Error ? error.message : "unknown error"}.`;
		return currentResult;
	} finally {
		currentResult.processActive = false;
		currentResult.endedAt = Date.now();
		emitUpdate();
		if (tmpPromptPath)
			try {
				fs.unlinkSync(tmpPromptPath);
			} catch {
				/* ignore */
			}
		if (tmpPromptDir)
			try {
				fs.rmdirSync(tmpPromptDir);
			} catch {
				/* ignore */
			}
	}
}

const TaskItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task to delegate to the agent" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

const ChainItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task with optional {previous} placeholder for prior output" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
	description: 'Only "user" is supported in this profile. Other values return an explicit refusal.',
	default: "user",
});

const SubagentParams = Type.Object({
	agent: Type.Optional(Type.String({ description: "Name of the agent to invoke (for single mode)" })),
	task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })),
	tasks: Type.Optional(Type.Array(TaskItem, { description: "Array of {agent, task} for parallel execution" })),
	chain: Type.Optional(Type.Array(ChainItem, { description: "Array of {agent, task} for sequential execution" })),
	agentScope: Type.Optional(AgentScopeSchema),
	confirmProjectAgents: Type.Optional(
		Type.Boolean({ description: "Compatibility field; project-local agents are refused regardless of this value.", default: true }),
	),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process (single mode)" })),
});

// Session-local overview, not a detached job manager. Details stay in the tool row.
type OverviewRow = SingleResult & { goalTask?: string };
interface OverviewMetadata {
	resultIndex?: number;
	agent: string;
	task: string;
	step?: number;
	endedAt?: number;
	overviewState?: SingleResult["overviewState"];
}

function presentationResults(details: SubagentDetails): OverviewRow[] {
	return details.overviewResults?.map((meta, i) => {
		const executed = "messages" in meta
			? details.results.find((r, index) => details.mode === "chain" ? (r.step ?? index + 1) === (meta.step ?? i + 1) : index === i)
			: meta.resultIndex === undefined ? undefined : details.results[meta.resultIndex];
		if (executed) return { ...executed, goalTask: meta.task, endedAt: executed.endedAt ?? meta.endedAt };
		if ("messages" in meta) return meta;
		return { agent: meta.agent, task: meta.task, step: meta.step, endedAt: meta.endedAt,
			overviewState: meta.overviewState, agentSource: "unknown", exitCode: -2, messages: [], stderr: "",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 } };
	}) ?? details.results;
}
const OVERVIEW_CLEAR = "subagent-overview-clear";
const INSPECT_KEY = "alt+w";

function cleanOverviewText(text: string): string {
	// Remove complete terminal sequences before stripping leftover controls.
	return text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
		.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
		.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
}

function observedActivity(activity?: string): string {
	return activity && /^(starting|not dispatched|not completed|(?:read|write|edit|bash|ls|find|grep|tool) (?:active|finished|failed))$/.test(activity)
		? activity : "";
}

function isActiveRow(r: OverviewRow): boolean {
	return Boolean(r.processActive) || ["queued", "running"].includes(workerState(r));
}

function workerState(r: OverviewRow): string {
	if (r.overviewState) return r.overviewState;
	if (r.exitCode === -2) return "queued";
	if (r.exitCode < 0) return "running";
	if (r.exitCode === 130 || r.stopReason === "aborted") return "cancelled";
	if (r.captureIncomplete) return "incomplete";
	if (isFailedResult(r)) return "failed";
	if (!getFinalOutput(r.messages).trim() ||
		(r.stopReason && !["stop", "end"].includes(r.stopReason))) return "incomplete";
	return "done";
}

export default function (pi: ExtensionAPI) {
	const batches = new Map<string, OverviewRow[]>();
	// Live view leases, not child ownership. Detaching a lease never stops execution.
	const live = new Map<string, { rows: OverviewRow[]; sessionId: string; anchorId: string | null }>();
	let closed = false;
	const cleared = new Set<string>();
	let inspectorOpen = false;
	let redrawInspector: (() => void) | undefined;
	const visibleRows = () => [...batches].flatMap(([id, rows]) => rows.filter((r, i) =>
		!cleared.has(`${id}:${i}`)));
	// Only live leases can establish process liveness; queued assignments and history cannot.
	const activeCount = () => [...live.values()].flatMap((lease) => lease.rows).filter((r) => r.processActive).length;
	const inspect = async (ctx: ExtensionContext) => {
		if (inspectorOpen || closed || !ctx.hasUI || ctx.mode !== "tui") return;
		inspectorOpen = true;
		try {
			await ctx.ui.custom<void>((tui, theme, keys, done) => {
				let offset = 0, page = 1, lineCount = 0, raw = false, history = false;
				redrawInspector = () => tui.requestRender();
				return {
					invalidate() {},
					render(width: number) {
						const rows = history ? [...batches.values()].flat() : visibleRows();
						const lines = inspectorLines(rows, workerState, raw, width);
						const wrap = (line: string) => wrapTextWithAnsi(line, Math.max(1, width));
						const chrome = [theme.fg("accent", `Workers · ${activeCount()} live`),
							`r: ${raw ? "details" : "raw"} · h: ${history ? "visible" : "all"} · ↑↓ PgUp/PgDn · Esc`].flatMap(wrap);
						// One scrollable stream: even wrapped chrome cannot exhaust a short
						// viewport or permanently hide an identity behind fixed headers.
						const stream = [...chrome, ...lines];
						lineCount = stream.length;
						page = Math.max(1, Math.floor(tui.terminal.rows) - 1);
						offset = Math.min(offset, Math.max(0, lineCount - page));
						return stream.slice(offset, offset + page);
					},
					handleInput(data: string) {
						if (keys.matches(data, "tui.select.cancel")) { done(); return; }
						if (data === "r") { raw = !raw; offset = 0; }
						else if (data === "h") { history = !history; offset = 0; }
						else if (keys.matches(data, "tui.select.up")) offset = Math.max(0, offset - 1);
						else if (keys.matches(data, "tui.select.down")) offset = Math.min(Math.max(0, lineCount - page), offset + 1);
						else if (keys.matches(data, "tui.select.pageUp")) offset = Math.max(0, offset - page);
						else if (keys.matches(data, "tui.select.pageDown")) offset = Math.min(Math.max(0, lineCount - page), offset + page);
						tui.requestRender();
					},
				};
			});
		} finally { inspectorOpen = false; redrawInspector = undefined; }
	};
	pi.registerShortcut(INSPECT_KEY, { description: "Inspect subagents (read-only)", handler: inspect });
	const refresh = (ctx: ExtensionContext) => {
		if (closed || !ctx.hasUI || ctx.mode !== "tui") return;
		try {
			redrawInspector?.();
			const count = activeCount();
			if (!count) {
				ctx.ui.setWidget("subagent-workers", undefined);
				return;
			}
			ctx.ui.setWidget("subagent-workers", () => ({
				invalidate() {},
				render(width: number) {
					return wrapTextWithAnsi(`${count} running workers`, Math.max(1, width));
				},
			}));
		} catch { /* UI failure must not interfere with child supervision. */ }
	};
	const restore = (_event: unknown, ctx: ExtensionContext) => {
		closed = false;
		batches.clear();
		cleared.clear();
		const branch = ctx.sessionManager.getBranch();
		for (const [id, lease] of live) {
			// Preserve same-branch/descendant work, but never reattach a detached invocation.
			if (lease.sessionId !== ctx.sessionManager.getSessionId() || !lease.anchorId ||
				!branch.some((entry) => entry.id === lease.anchorId)) live.delete(id);
		}
		for (const entry of branch) {
			if (entry.type === "custom" && entry.customType === OVERVIEW_CLEAR) {
				const ids = (entry.data as { rowIds?: unknown })?.rowIds;
				if (Array.isArray(ids)) for (const id of ids) if (typeof id === "string") cleared.add(id);
			}
			if (entry.type !== "message" || entry.message.role !== "toolResult" || entry.message.toolName !== "subagent") continue;
			const details = entry.message.details as SubagentDetails | undefined;
			const results = details && presentationResults(details);
			if (!Array.isArray(results)) continue;
			// A persisted tool result is historical, never evidence of a live process.
			batches.set(entry.message.toolCallId, results.filter((r) => r && typeof r.agent === "string" && typeof r.task === "string" && Array.isArray(r.messages)).map((r) => ({
				...r, processActive: false, cancellationPending: false, endedAt: r.endedAt ?? entry.message.timestamp,
				overviewState: r.overviewState ?? (r.exitCode < 0 ? "incomplete" : undefined),
			})));
		}
		for (const [id, lease] of live) batches.set(id, lease.rows);
		refresh(ctx);
	};
	pi.on("session_start", restore);
	pi.on("session_tree", restore);
	pi.registerCommand("workers", {
		description: "Inspect workers; /workers clear clears ended rows on this branch only",
		handler: async (args, ctx) => {
			if (args.trim() === "inspect" || !args.trim()) { await inspect(ctx); return; }
			if (args.trim() !== "clear") {
				ctx.ui.notify("Alt+W or /workers inspect: read-only inspector. /workers clear: hide ended rows on this branch; tool history remains.", "info");
				return;
			}
			const rowIds: string[] = [];
			for (const [id, rows] of batches) rows.forEach((r, i) => {
				if (!isActiveRow(r) && !cleared.has(`${id}:${i}`)) rowIds.push(`${id}:${i}`);
			});
			if (rowIds.length) {
				pi.appendEntry(OVERVIEW_CLEAR, { rowIds });
				for (const id of rowIds) cleared.add(id);
			}
			refresh(ctx);
		},
	});
	pi.on("session_shutdown", (_event, ctx) => {
		closed = true;
		live.clear();
		batches.clear();
		if (ctx.hasUI) ctx.ui.setWidget("subagent-workers", undefined);
	});
	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate tasks to specialized subagents with isolated context.",
			"Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).",
			`Default agent scope is "user" (from ${path.join(immutableAgentRoot, 'agents')}).`,
				"This setup accepts reviewed user-level agents only; project scope is refused.",
		].join(" "),
		parameters: SubagentParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const outerUpdate = onUpdate;
			const assignments = params.chain?.length ? params.chain : params.tasks?.length ? params.tasks : (params.agent && params.task ? [{ agent: params.agent, task: params.task }] : []);
			const rows: OverviewRow[] = assignments.map((t, i) => ({
				agent: t.agent, task: t.task, agentSource: "unknown", exitCode: -2,
				messages: [], stderr: "", step: params.chain?.length ? i + 1 : undefined,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
			}));
			let finalized = false;
			const ownsView = () => !closed && live.get(_toolCallId)?.rows === rows;
			const observe = (details?: SubagentDetails) => {
				// Always collect invocation-local evidence for the returned/persisted details.
				if (finalized || !details) return;
				for (let i = 0; i < details.results.length; i++) {
					const r = details.results[i];
					const index = details.mode === "chain" ? (r.step ?? i + 1) - 1 : i;
					if (index < rows.length) rows[index] = { ...r, goalTask: rows[index].goalTask ?? rows[index].task,
						endedAt: r.endedAt ?? rows[index].endedAt ?? (r.exitCode >= 0 ? Date.now() : undefined) };
				}
				if (ownsView()) refresh(ctx);
			};
			onUpdate = (partial) => { observe(partial.details); sendProgress(outerUpdate, partial); };
			const executeWorkers = async () => {
			if (process.env.VERTRICE_PI_CHILD === "1") {
				return { content: [{ type: "text", text: "Nested delegation is disabled in this profile." }], isError: true };
			}
			if (signal?.aborted) throw new Error("Subagent was aborted before launch");
			if (params.agentScope && params.agentScope !== "user") {
				return { content: [{ type: "text", text: "This profile loads user-level roles only; review is an owner provisioning responsibility." }], isError: true };
			}
			const agentScope: AgentScope = params.agentScope ?? "user";
			const dispatchDefaults: DispatchDefaults = {
 costOrigin: ctx.sessionManager.getSessionId(),
				model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
				thinkingLevel: ctx.thinkingLevel,
			};
			const agents = discoverAgents();

			const hasChain = (params.chain?.length ?? 0) > 0;
			const hasTasks = (params.tasks?.length ?? 0) > 0;
			const hasSingle = Boolean(params.agent && params.task);
			const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);

			const makeDetails =
				(mode: "single" | "parallel" | "chain") =>
				(results: SingleResult[]): SubagentDetails => ({
					mode,
					agentScope,
					results,
				});

			if (modeCount !== 1) {
				const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
				return {
					content: [
						{
							type: "text",
							text: `Invalid parameters. Provide exactly one mode.\nAvailable agents: ${available}`,
						},
					],
					details: makeDetails("single")([]),
					isError: true,
				};
			}

			if (params.chain && params.chain.length > 0) {
				const results: SingleResult[] = [];
				let previousOutput = "";

				for (let i = 0; i < params.chain.length; i++) {
					const step = params.chain[i];
					const taskWithContext = step.task.replace(/\{previous\}/g, () => previousOutput);

					// Create update callback that includes all previous results
					const chainUpdate: OnUpdateCallback | undefined = onUpdate
						? (partial) => {
								// Combine completed results with current streaming result
								const currentResult = partial.details?.results[0];
								if (currentResult) {
									const allResults = [...results, currentResult];
									sendProgress(onUpdate, {
										content: partial.content,
										details: makeDetails("chain")(allResults),
									});
								}
							}
						: undefined;

					const result = await runSingleAgent(
						ctx.cwd,
						dispatchDefaults,
						agents,
						step.agent,
						taskWithContext,
						step.cwd,
						i + 1,
						signal,
						chainUpdate,
						makeDetails("chain"),
					);
					results.push(result);

					const isError = isFailedResult(result);
					if (isError) {
						const errorMsg = getResultOutput(result);
						return {
							content: [{ type: "text", text: `Chain stopped at step ${i + 1} (${step.agent}): ${errorMsg}` }],
							details: makeDetails("chain")(results),
							isError: true,
						};
					}
					previousOutput = getFinalOutput(result.messages);
				}
				return {
					content: [{ type: "text", text: getFinalOutput(results[results.length - 1].messages) || "(no output)" }],
					details: makeDetails("chain")(results),
				};
			}

			if (params.tasks && params.tasks.length > 0) {
				if (params.tasks.length > MAX_PARALLEL_TASKS)
					return {
						content: [
							{
								type: "text",
								text: `Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
							},
						],
							details: makeDetails("parallel")([]),
							isError: true,
					};

				// Track all results for streaming updates
				const allResults: SingleResult[] = new Array(params.tasks.length);

				// Initialize placeholder results
				for (let i = 0; i < params.tasks.length; i++) {
					allResults[i] = {
						agent: params.tasks[i].agent,
						agentSource: "unknown",
						task: params.tasks[i].task,
						exitCode: -2, // queued; -1 means a child has started
						messages: [],
						stderr: "",
						usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
					};
				}

				const emitParallelUpdate = () => {
					if (onUpdate) {
						const running = allResults.filter((r) => r.exitCode === -1).length;
						const done = allResults.filter((r) => r.exitCode >= 0).length;
						const queued = allResults.filter((r) => r.exitCode === -2).length;
						sendProgress(onUpdate, {
							content: [
								{ type: "text", text: `Parallel: ${done}/${allResults.length} done, ${running} running, ${queued} queued...` },
							],
							details: makeDetails("parallel")([...allResults]),
						});
					}
				};

				const results = await mapWithConcurrencyLimit(params.tasks, MAX_CONCURRENCY, async (t, index) => {
					const result = await runSingleAgent(
						ctx.cwd,
						dispatchDefaults,
						agents,
						t.agent,
						t.task,
						t.cwd,
						undefined,
						signal,
						// Per-task update callback
						(partial) => {
							if (partial.details?.results[0]) {
								allResults[index] = partial.details.results[0];
								emitParallelUpdate();
							}
						},
						makeDetails("parallel"),
					);
					allResults[index] = result;
					emitParallelUpdate();
					return result;
				});

				const successCount = results.filter((r) => !isFailedResult(r)).length;
				const summaries = results.map((r) => {
					const output = truncateParallelOutput(getResultOutput(r));
					const status = isFailedResult(r)
						? `failed${r.stopReason && r.stopReason !== "end" ? ` (${r.stopReason})` : ""}`
						: "process returned";
					return `### [${r.agent}] ${status}\n\n${output}`;
				});
				return {
					content: [
						{
							type: "text",
							text: `Parallel: ${successCount}/${results.length} returned without process failure (outcomes unverified)\n\n${summaries.join("\n\n---\n\n")}`,
						},
					],
						details: makeDetails("parallel")(results),
						isError: successCount !== results.length,
				};
			}

			if (params.agent && params.task) {
				const result = await runSingleAgent(
					ctx.cwd,
					dispatchDefaults,
					agents,
					params.agent,
					params.task,
					params.cwd,
					undefined,
					signal,
					onUpdate,
					makeDetails("single"),
				);
				const isError = isFailedResult(result);
				if (isError) {
					const errorMsg = getResultOutput(result);
					return {
						content: [{ type: "text", text: `Agent ${result.stopReason || "failed"}: ${errorMsg}` }],
						details: makeDetails("single")([result]),
						isError: true,
					};
				}
				return {
					content: [{ type: "text", text: getFinalOutput(result.messages) || "(no output)" }],
					details: makeDetails("single")([result]),
				};
			}

			const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
			return {
				content: [{ type: "text", text: `Invalid parameters. Available agents: ${available}` }],
				details: makeDetails("single")([]),
				isError: true,
			};
			};
			// Validation refusals do not create workers, and never change dispatch policy.
			const valid = process.env.VERTRICE_PI_CHILD !== "1" && !signal?.aborted &&
				(!params.agentScope || params.agentScope === "user") &&
				Number(Boolean(params.chain?.length)) + Number(Boolean(params.tasks?.length)) + Number(Boolean(params.agent && params.task)) === 1 &&
				(!params.tasks || params.tasks.length <= MAX_PARALLEL_TASKS);
			if (valid && !closed) {
				live.set(_toolCallId, { rows, sessionId: ctx.sessionManager.getSessionId(), anchorId: ctx.sessionManager.getLeafId() });
				batches.set(_toolCallId, rows);
				refresh(ctx);
			}
			let finalDetails: SubagentDetails | undefined;
			try {
				const result = await executeWorkers();
				finalDetails = result.details;
				if (valid) observe(result.details);
				return result;
			} finally {
				finalized = true;
				if (valid) {
					for (const r of rows) {
						if (r.exitCode === -2) {
							r.overviewState = signal?.aborted ? "cancelled" : "skipped";
							r.activity = "not dispatched";
							r.endedAt = Date.now();
						} else if (r.exitCode < 0) { r.exitCode = signal?.aborted ? 130 : 1; r.activity = "not completed"; r.endedAt = Date.now(); }
					}
					if (finalDetails) finalDetails.overviewResults = rows.map((r, i) => {
						const resultIndex = finalDetails!.results.findIndex((result, index) =>
							finalDetails!.mode === "chain" ? (result.step ?? index + 1) === i + 1 : index === i);
						return { resultIndex: resultIndex < 0 ? undefined : resultIndex, agent: r.agent,
							task: r.goalTask ?? r.task, step: r.step, endedAt: r.endedAt, overviewState: r.overviewState };
					});
					if (ownsView()) {
						batches.set(_toolCallId, rows);
						live.delete(_toolCallId);
						refresh(ctx);
					}
				}
			}
		},

		renderCall(args, theme, context) {
			return callView(args, theme, context);
		},
		renderResult(result, { expanded, isPartial }, theme, context) {
			const details = result.details as SubagentDetails | undefined;
			if (!details || !Array.isArray(details.results) || details.results.length === 0) {
				const text = result.content.filter(p => p.type === "text").map(p => p.text).join("\n");
				return resultView([], "single", workerState, expanded, theme, { ...context, isPartial }, text);
			}
			const rows = presentationResults(details).map(r =>
				!isPartial && r.exitCode < 0 && !r.overviewState ? { ...r, overviewState: "incomplete" as const } : r);
			return resultView(rows, details.mode, workerState, expanded, theme, context);
		},
	});
}
