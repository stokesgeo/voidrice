/**
 * Repair a completed, tool-free turn that is empty or starts with leaked native
 * tool markup. Never interpret or execute that markup. Quoted/fenced examples
 * and prose mentioning the protocol are not evidence of a broken tool call.
 *
 * One hidden correction per activity (reset only at agent_settled); a second
 * defect gets a visible failure notice, not another guard continuation. This
 * does not override other extensions' continuations or Pi's natural work, and
 * cannot turn the core activity outcome into an error.
 *
 * PI_DSML_GUARD=0 disables the guard. Best-effort metadata-only audit records go
 * to dsml-guard.log in Pi's configured agent directory, including test profiles.
 */

import { appendFileSync } from "node:fs";
import * as path from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MAX_RETRIES = 1;

const CORRECTION_LEAK =
  "Your previous reply printed provider tool-call markup (DSML) as plain text, so no " +
  "tool ran and the turn produced nothing usable. Do not print markup. Call the tool " +
  "through the tool interface, or answer the pending request directly in prose.";
const CORRECTION_EMPTY =
  "Your previous reply was empty: no text and no tool call. Answer the pending request " +
  "now, or call a tool if you need one.";

export type TurnDefect = "markup-in-text" | "empty-turn" | null;

/** Concatenated text blocks of an assistant message. */
export function assistantText(message: any): string {
  const blocks = message?.content ?? [];
  if (typeof blocks === "string") return blocks;
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((b) => b && b.type === "text")
    .map((b) => String(b.text ?? ""))
    .join("");
}

export function hasToolCall(message: any): boolean {
  const blocks = message?.content ?? [];
  return Array.isArray(blocks) && blocks.some((b) => b && b.type === "toolCall");
}

/**
 * Only a leading structural signature is credible: the native fullwidth-pipe
 * DSML delimiter (including an unfinished opener), or the legacy XML call tags.
 * Inspect only the first nonempty line, with at most three leading spaces:
 * Markdown's four-space/tab-indented code, fences, inline code and prose stay out.
 */
export function classifyTurn(message: any): TurnDefect {
  if (!message || message.role !== "assistant") return null;
  if (hasToolCall(message)) return null;
  const text = assistantText(message);
  const leading = text.replace(/^(?:[ \t]*\r?\n)+/, "");
  if (/^ {0,3}<\/?\uFF5cDSML\uFF5c(?:\s*(?:calls|invoke|parameter)(?=[\s>]|$)|\s*>|\s*$)/.test(leading)) {
    return "markup-in-text";
  }
  if (/^ {0,3}<\s*(?:tool_calls?|invoke|antml:invoke)(?=[\s>])/.test(leading)) {
    return "markup-in-text";
  }
  if (text.trim().length === 0) return "empty-turn";
  return null;
}

function audit(record: Record<string, unknown>): void {
  try {
    appendFileSync(path.join(getAgentDir(), "dsml-guard.log"),
      JSON.stringify({ ts: new Date().toISOString(), ...record }) + "\n", { mode: 0o600 });
  } catch {
    // Logging is best effort; never break a turn over it.
  }
}

export default function (pi: ExtensionAPI) {
  let retries = 0;

  if (process.env.PI_DSML_GUARD === "0") {
    audit({ event: "disabled" });
    return;
  }
  audit({ event: "loaded", pid: process.pid });

  pi.on("turn_end", async (event, ctx) => {
    if (event.outcome !== "completed" || ctx.signal?.aborted) return;
    if (event.toolResults.length > 0) return;
    // A prior boundary handler already owns this message's context repair.
    if (event.entries.some((entry) => entry.type === "context_edit" &&
      entry.targetId === event.messageEntryId)) return;
    const defect = classifyTurn(event.message);
    if (!defect) return;

    const canRetry = retries < MAX_RETRIES;
    audit({
      event: canRetry ? "retry" : "exhausted",
      defect,
      turnIndex: event.turnIndex,
      retries,
    });

    if (!canRetry) {
      return {
        entries: [
          ...event.entries,
          {
            type: "custom_message",
            customType: "dsml-guard",
            content: "Tool-call guard: recovery failed after one retry (" + defect + "). " +
              "The reply is still unusable. The guard will not retry again in this activity.",
            display: true,
          },
        ],
        // Omit continue: preserve other proposals without requesting more work.
      };
    }

    retries += 1;
    return {
      entries: [
        ...event.entries,
        { type: "context_edit", targetId: event.messageEntryId, replacement: null },
        {
          type: "custom_message",
          customType: "dsml-guard",
          content: defect === "markup-in-text" ? CORRECTION_LEAK : CORRECTION_EMPTY,
          display: false,
        },
      ],
      continue: true,
    };
  });

  pi.on("agent_settled", async () => {
    retries = 0;
  });
}
