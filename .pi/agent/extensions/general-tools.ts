import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";

// Show argument boundaries; escape terminal controls and directional overrides.
function quoted(value: string): string {
	return JSON.stringify(value).replace(/[\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g,
		(char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function reply(text: string) {
	return { content: [{ type: "text" as const, text }], details: {} };
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "ask_user",
		label: "Ask owner",
		description: "Ask an owner decision in native Pi UI. Always offers a free answer. Answers enter the model transcript: never request passwords or secrets.",
		parameters: Type.Object({
			question: Type.String({ minLength: 1 }),
			options: Type.Array(Type.String({ minLength: 1 })),
		}),
		executionMode: "sequential",
		async execute(_id, params, signal, _update, ctx) {
			if (ctx.mode !== "tui" || !ctx.hasUI || signal?.aborted) return reply("Decision cancelled; no interactive owner decision.");
			const options = params.options.map((option, index) => `${index + 1}. ${quoted(option)}`);
			const free = "Write a different answer";
			const choice = await ctx.ui.select(quoted(params.question), [...options, free], { signal });
			if (signal?.aborted || choice === undefined) return reply("Decision cancelled.");
			if (choice === free) {
				// Native full editor preserves capitals in the tested xterm; input did not.
				const answer = await ctx.ui.editor(`${quoted(params.question)} (not a secret)`);
				if (signal?.aborted || answer === undefined) return reply("Decision cancelled.");
				return reply(`Owner answered: ${quoted(answer)}`);
			}
			const index = options.indexOf(choice);
			return index < 0 ? reply("Decision cancelled.") : reply(`Owner selected: ${quoted(params.options[index])}`);
		},
	});

	pi.registerTool({
		name: "admin_step",
		label: "Approve admin step",
		description: "Run ONE explicit OpenBSD admin executable with argv through /usr/bin/doas after fresh native owner approval (default No). Use direct system utilities, not shell/interpreter payloads or hidden scripts. Never put secrets in arguments or goal. Terminal output stays local; only exit status returns. Each separate admin step needs its own call and approval.",
		parameters: Type.Object({
			goal: Type.String({ minLength: 1, description: "Plain-language change and why it is needed" }),
			executable: Type.String({ minLength: 1, description: "Absolute executable path; no shell command string" }),
			argv: Type.Array(Type.String(), { description: "Exact individual arguments; no shell expansion" }),
		}),
		executionMode: "sequential",
		async execute(_id, params, signal, _update, ctx) {
			const interactive = () => ctx.mode === "tui" && ctx.hasUI && process.stdin.isTTY && process.stdout.isTTY && process.stderr.isTTY;
			if (!interactive() || signal?.aborted) return reply("Admin step cancelled; interactive local terminal required.");
			if (!params.executable.startsWith("/") || params.executable.includes("\0") ||
				params.argv.some((arg) => arg.includes("\0")) || !params.goal.trim()) {
				return reply("Admin step cancelled; invalid executable, argv, or goal.");
			}
			// Snapshot every execution field before awaiting approval.
			const cwd = ctx.cwd;
			const argv = [params.executable, ...params.argv];
			const title = [
				"Approve one admin step?",
				`Goal: ${quoted(params.goal)}`,
				`Cwd: ${quoted(cwd)}`,
				`Run: "/usr/bin/doas" ${quoted(argv[0])}`,
				`Argv: [${argv.slice(1).map(quoted).join(", ")}]`,
				"Root via existing doas policy.",
				"Local OS password/output; model gets exit code only.",
			].join("\n");
			// Native selector has no scrolling. Retain the baseline's conservative reserve.
			const fits = () => {
				const { columns, rows } = process.stdout;
				return !!columns && !!rows && columns >= 40 &&
					new Text(title, 1, 0).render(columns).length + 14 <= rows;
			};
			if (!fits()) return reply("Admin step cancelled; enlarge the terminal to display the full approval, then retry.");
			// Pi's installed native selector starts on item zero. confirm starts on Yes.
			const choice = await ctx.ui.select(title, ["No", "Yes"], { signal });
			if (choice !== "Yes" || signal?.aborted || !interactive() || !fits()) return reply("Admin step cancelled; not executed.");

			const exitCode = await ctx.ui.custom<number | null>(async (tui, _theme, _keys, done) => {
				let code: number | null = null;
				const originalSigint = process.rawListeners("SIGINT");
				const ignoreSigint = () => {};
				// Install the shield FIRST: never briefly restore Node's default exit action.
				// rawListeners preserves once wrappers, identity and listener order.
				process.on("SIGINT", ignoreSigint);
				for (const listener of originalSigint) process.removeListener("SIGINT", listener);
				try {
					if (!signal?.aborted && interactive() && fits()) {
						tui.stop();
						// stop() can expose an abort; recheck before starting a child.
						if (!signal?.aborted) {
							code = await new Promise<number | null>((resolve) => {
								// Same foreground process group/controlling tty: terminal Ctrl+C
								// reaches doas directly. Do NOT detach or forward it a second time.
								const child = spawn("/usr/bin/doas", argv, { stdio: "inherit", cwd });
								let failed = false;
								const abort = () => {
									try { child.kill("SIGINT"); } catch { /* wait for close */ }
								};
								// Node emits close after exit OR a spawn error. Never restore the
								// terminal merely on error/exit while the child may still own it.
								child.on("error", () => { failed = true; });
								child.once("close", (status) => {
									signal?.removeEventListener("abort", abort);
									resolve(failed ? null : status);
								});
								signal?.addEventListener("abort", abort, { once: true });
								if (signal?.aborted) abort();
							});
						}
					}
				} catch {
					// Do not forward child buffers or exception text.
				} finally {
					try {
						try { tui.start(); } catch { code = null; }
						try { tui.requestRender(true); } catch { code = null; }
						// Keep the shield through raw-mode restoration and a live loop turn,
						// letting already-pending terminal SIGINT drain before old handlers.
						await new Promise<void>((resolve) => setImmediate(resolve));
					} finally {
						// Prepend in reverse to preserve originals ahead of listeners that
						// other code added during the handoff; never remove those additions.
						for (let i = originalSigint.length - 1; i >= 0; i--) process.prependListener("SIGINT", originalSigint[i]);
						process.removeListener("SIGINT", ignoreSigint);
						done(code);
					}
				}
				return { render: () => [], invalidate: () => {} };
			});
			return reply(exitCode === null
				? "Admin step ended without an exit code (cancelled, failed to start, or interrupted); completion is unverified."
				: `Admin step completed; exit code ${exitCode}.`);
		},
	});
}
