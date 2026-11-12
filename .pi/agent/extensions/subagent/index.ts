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
import { Container, Spacer, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { type AgentConfig, type AgentScope, discoverAgents } from "./agents.ts";

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
// Labels are presentation only; exact assignments remain in details.
function assignmentLabel(task: string): string {
	const first = task.trim().split(/\n|(?<=[.!?])\s/)[0].replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ") || "(assignment pending)";
	return Array.from(first).length > 72 ? `${Array.from(first).slice(0, 69).join("")}...` : first;
}
const PER_TASK_OUTPUT_CAP = 50 * 1024;

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsageStats(
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		contextTokens?: number;
		turns?: number;
	},
	model?: string,
): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens && usage.contextTokens > 0) {
		parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
	}
	if (model) parts.push(model);
	return parts.join(" ");
}

function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	themeFg: (color: any, text: string) => string,
): string {
	const shortenPath = (p: string) => {
		const home = os.homedir();
		return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
	};

	switch (toolName) {
		case "bash": {
			const command = (args.command as string) || "...";
			const preview = command.length > 60 ? `${command.slice(0, 60)}...` : command;
			return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
		}
		case "read": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const lineRange = formatReadLineRange(args.offset, args.limit);
			let text = themeFg("accent", filePath);
			if (lineRange) {
				text += themeFg("warning", lineRange);
			}
			return themeFg("muted", "read ") + text;
		}
		case "write": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const content = (args.content || "") as string;
			const lines = content.split("\n").length;
			let text = themeFg("muted", "write ") + themeFg("accent", filePath);
			if (lines > 1) text += themeFg("dim", ` (${lines} lines)`);
			return text;
		}
		case "edit": {
			const rawPath = (args.file_path || args.path || "...") as string;
			return themeFg("muted", "edit ") + themeFg("accent", shortenPath(rawPath));
		}
		case "ls": {
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "ls ") + themeFg("accent", shortenPath(rawPath));
		}
		case "find": {
			const pattern = (args.pattern || "*") as string;
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "find ") + themeFg("accent", pattern) + themeFg("dim", ` in ${shortenPath(rawPath)}`);
		}
		case "grep": {
			const pattern = (args.pattern || "") as string;
			const rawPath = (args.path || ".") as string;
			return (
				themeFg("muted", "grep ") +
				themeFg("accent", `/${pattern}/`) +
				themeFg("dim", ` in ${shortenPath(rawPath)}`)
			);
		}
		default: {
			const argsStr = JSON.stringify(args);
			const preview = argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
			return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
		}
	}
}

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
}

interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScope;
	results: SingleResult[];
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

type DisplayItem = { type: "text"; text: string } | { type: "toolCall"; name: string; args: Record<string, any> };

function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") items.push({ type: "text", text: part.text });
				else if (part.type === "toolCall") items.push({ type: "toolCall", name: part.name, args: part.arguments });
			}
		}
	}
	return items;
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
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}

	return { command: "pi", args };
}

type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

function sendProgress(callback: OnUpdateCallback | undefined, update: AgentToolResult<SubagentDetails>): void {
	// Rendering/consumer failure must not abandon live child supervision.
	try { callback?.(update); } catch { /* final results still return normally */ }
}

interface DispatchDefaults {
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
			const shared = fs.readFileSync(path.join(getAgentDir(), "AGENTS.md"), "utf8");
			const tmp = await writePromptToTempFile(agent.name, `${shared}\n\n${agent.systemPrompt}`);
			tmpPromptDir = tmp.dir;
			tmpPromptPath = tmp.filePath;
			args.push("--append-system-prompt", tmpPromptPath);
		}

		args.push(`Task: ${task}`);
		let wasAborted = false;
		emitUpdate();

		const exitCode = await new Promise<number>((resolve) => {
			if (signal?.aborted) { wasAborted = true; resolve(1); return; }
			const invocation = getPiInvocation(args);
			const env: NodeJS.ProcessEnv = { ...process.env, VERTRICE_PI_CHILD: "1" };
			delete env.SSH_AUTH_SOCK;
			const proc = spawn(invocation.command, invocation.args, {
				cwd: cwd ?? defaultCwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
				env,
			});
			const cancel = superviseCancellation(proc, signal, () => { wasAborted = true; }, 5000, () => {
				captureIncomplete = true;
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
					currentResult.activity = `${name} ${event.type === "tool_execution_end" ? (event.isError ? "failed" : "finished") : "active"}`;
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
type OverviewRow = SingleResult & { overviewState?: "skipped" | "cancelled" };

function workerState(r: OverviewRow): string {
	if (r.overviewState) return r.overviewState;
	if (r.exitCode === -2) return "queued";
	if (r.exitCode < 0) return "running";
	if (r.exitCode === 130 || r.stopReason === "aborted") return "cancelled";
	if (isFailedResult(r)) return "failed";
	if (!getFinalOutput(r.messages).trim() || /incomplete|truncated|unverified/i.test(r.stderr) ||
		(r.stopReason && !["stop", "end"].includes(r.stopReason))) return "incomplete";
	return "done";
}

export default function (pi: ExtensionAPI) {
	const batches = new Map<string, OverviewRow[]>();
	let closed = false;
	const refresh = (ctx: ExtensionContext) => {
		if (closed || !ctx.hasUI || ctx.mode !== "tui") return;
		try {
			const pending = [...batches.values()].flat().filter((r) => workerState(r) !== "done");
			if (!pending.length) {
				ctx.ui.setWidget("subagent-workers", undefined);
				return;
			}
			ctx.ui.setWidget("subagent-workers", () => ({
				invalidate() {},
				render(width: number) {
					const lines = pending.slice(-8).map((r) =>
						`[${workerState(r)}] ${r.agent} | ${r.activity ?? "waiting"} | ${assignmentLabel(r.task)}`,
					);
					if (pending.length > 8) lines.unshift(`${pending.length - 8} earlier unresolved workers; expand tool rows for details`);
					// Strip controls before measuring, including terminal escape sequences from task text.
					return lines.map((line) => truncateToWidth(line.replace(/[\x00-\x1f\x7f-\x9f]/g, " "), Math.max(0, Math.min(width, 120))));
				},
			}));
		} catch { /* UI failure must not interfere with child supervision. */ }
	};
	pi.on("session_shutdown", (_event, ctx) => {
		closed = true;
		batches.clear();
		if (ctx.hasUI) ctx.ui.setWidget("subagent-workers", undefined);
	});
	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate tasks to specialized subagents with isolated context.",
			"Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).",
			`Default agent scope is "user" (from ${path.join(getAgentDir(), "agents")}).`,
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
			const observe = (details?: SubagentDetails) => {
				if (closed || !details) return;
				for (let i = 0; i < details.results.length; i++) {
					const r = details.results[i];
					const index = details.mode === "chain" ? (r.step ?? i + 1) - 1 : i;
					if (index < rows.length) rows[index] = { ...r, task: rows[index].task };
				}
				refresh(ctx);
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
						: "completed";
					return `### [${r.agent}] ${status}\n\n${output}`;
				});
				return {
					content: [
						{
							type: "text",
							text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n---\n\n")}`,
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
			if (valid && !closed) { batches.set(_toolCallId, rows); refresh(ctx); }
			try {
				const result = await executeWorkers();
				if (valid) observe(result.details);
				return result;
			} finally {
				if (valid && !closed) {
					for (const r of rows) {
						if (r.exitCode === -2) {
							r.overviewState = signal?.aborted ? "cancelled" : "skipped";
							r.activity = "not dispatched";
							r.endedAt = Date.now();
						} else if (r.exitCode < 0) { r.exitCode = signal?.aborted ? 130 : 1; r.activity = "not completed"; r.endedAt = Date.now(); }
					}
					const remaining = rows.filter((r) => workerState(r) !== "done");
					if (remaining.length) batches.set(_toolCallId, remaining);
					else batches.delete(_toolCallId);
					refresh(ctx);
				}
			}
		},

		renderCall(args, theme, _context) {
			const scope: AgentScope = args.agentScope ?? "user";
			if (args.chain && args.chain.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `chain (${args.chain.length} steps)`) +
					theme.fg("muted", ` [${scope}]`);
				for (let i = 0; i < Math.min(args.chain.length, 3); i++) {
					const step = args.chain[i];
					// Clean up {previous} placeholder for display
					const cleanTask = step.task.replace(/\{previous\}/g, "").trim();
					const preview = assignmentLabel(cleanTask);
					text +=
						"\n  " +
						theme.fg("muted", `${i + 1}.`) +
						" " +
						theme.fg("accent", step.agent) +
						theme.fg("dim", ` ${preview}`);
				}
				if (args.chain.length > 3) text += `\n  ${theme.fg("muted", `... +${args.chain.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}
			if (args.tasks && args.tasks.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `parallel (${args.tasks.length} tasks)`) +
					theme.fg("muted", ` [${scope}]`);
				for (const t of args.tasks.slice(0, 3)) {
					const preview = assignmentLabel(t.task);
					text += `\n  ${theme.fg("accent", t.agent)}${theme.fg("dim", ` ${preview}`)}`;
				}
				if (args.tasks.length > 3) text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}
			const agentName = args.agent || "...";
			const preview = assignmentLabel(args.task ?? "");
			let text =
				theme.fg("toolTitle", theme.bold("subagent ")) +
				theme.fg("accent", agentName) +
				theme.fg("muted", ` [${scope}]`);
			text += `\n  ${theme.fg("dim", preview)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme, _context) {
			const details = result.details as SubagentDetails | undefined;
			if (!details || details.results.length === 0) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
			}

			const results = details.results;
			const running = results.filter((r) => r.exitCode === -1).length;
			const queued = results.filter((r) => r.exitCode === -2).length;
			const finished = results.filter((r) => r.exitCode >= 0);
			const succeeded = finished.filter((r) => !isFailedResult(r)).length;
			const active = running + queued > 0;
			const state = active ? "running" : succeeded === results.length ? "done" : "failed";
			const badge = (value: string) => theme.fg(value === "done" ? "success" : value === "failed" ? "error" : "warning", `[${value}]`);
			const status = active
				? `${finished.length}/${results.length} done, ${running} running, ${queued} queued`
				: `${succeeded}/${results.length} ${details.mode === "chain" ? "steps" : "tasks"}`;
			const container = new Container();
			const addText = (text: string) => container.addChild(new Text(text, 0, 0));
			addText(`${badge(state)} ${theme.fg("toolTitle", theme.bold(details.mode))} ${theme.fg("accent", status)}`);
			const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };

			// One child presentation for every mode; only labels and preview limits differ.
			for (const r of results) {
				const failed = r.exitCode >= 0 && isFailedResult(r);
				const childState = r.exitCode === -2 ? "queued" : r.exitCode < 0 ? "running" : failed ? "failed" : "done";
				const step = details.mode === "chain" ? `Step ${r.step}: ` : "";
				if (!expanded) {
					const cancelled = r.exitCode === 130 || r.stopReason === "aborted";
					const incomplete = r.exitCode >= 0 && (!getFinalOutput(r.messages).trim() || /incomplete|truncated|unverified/i.test(r.stderr) || (r.stopReason && !["stop", "end", "error", "aborted"].includes(r.stopReason)));
					addText(`${badge(cancelled ? "cancelled" : childState)} ${theme.fg("accent", `${step}${r.agent}`)} - ${theme.fg("dim", assignmentLabel(r.task))}`);
					if (incomplete) addText(theme.fg("warning", "[incomplete result]"));
					if (failed) {
						const diagnostic = r.errorMessage || r.stderr || getFinalOutput(r.messages) || "No diagnostic output";
						addText(theme.fg("error", `exit ${r.exitCode}${r.stopReason ? ` [${r.stopReason}]` : ""}: ${assignmentLabel(diagnostic)}`));
					}
					continue;
				}
				container.addChild(new Spacer(1));
				addText(`${theme.fg("muted", `─── ${step}`)}${theme.fg("accent", r.agent)} ${badge(childState)}${theme.fg("muted", ` (${r.agentSource})`)}${failed && r.stopReason ? ` ${theme.fg("error", `[${r.stopReason}]`)}` : ""}`);
				if (expanded) addText(theme.fg("muted", "Task: ") + theme.fg("dim", r.task));
				// Diagnostics supplement output, never replace this child or its siblings.
				if (failed) {
					const diagnostics = [r.errorMessage, r.stderr].filter(Boolean).join("\n");
					if (diagnostics) addText(theme.fg("error", expanded ? diagnostics : truncateParallelOutput(diagnostics)));
				}
				const items = getDisplayItems(r.messages);
				for (const item of items) {
					if (item.type === "toolCall") {
						addText(theme.fg("muted", "-> ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)));
						addText(theme.fg("dim", JSON.stringify(item.args, null, 2)));
					} else {
						addText(theme.fg("toolOutput", item.text));
					}
				}
				// Captured tool results and metadata remain recoverable on expansion.
				for (const message of r.messages) {
					if (message.role !== "assistant") addText(theme.fg("dim", JSON.stringify(message, null, 2)));
				}
				if (!failed && r.stderr) addText(theme.fg("warning", r.stderr));
				if (!items.length) addText(theme.fg("muted", childState === "queued" || childState === "running" ? `(${childState}...)` : "(no output)"));
				const usage = formatUsageStats(r.usage, r.model);
				if (usage) addText(theme.fg("dim", usage));
				for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] += r.usage[key];
			}
			if (expanded && details.mode !== "single") {
				const usage = formatUsageStats(total);
				if (usage) addText(theme.fg("dim", `Total: ${usage}`));
			}
			if (!expanded) addText(theme.fg("muted", "(Ctrl+O to expand)"));
			return container;
		},
	});
}
