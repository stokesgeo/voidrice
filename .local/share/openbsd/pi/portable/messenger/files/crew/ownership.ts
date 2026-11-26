import { crewKill } from '../crew-presence/lifecycle.mjs';
import { AsyncLocalStorage } from "node:async_hooks";
import type { ChildProcess } from "node:child_process";

// Process-local resource ownership, not a task lock or a security boundary.
const context = new AsyncLocalStorage<string>();
const children = new Map<ChildProcess, string>();
const closedOwners = new Set<string>();

export function withWorkerOwner<T>(owner: string, fn: () => T): T {
  if (closedOwners.has(owner)) throw new Error("Crew owner has shut down");
  return context.run(owner, fn);
}

export function requireWorkerOwner(): string {
  const owner = context.getStore();
  if (!owner || closedOwners.has(owner)) throw new Error("No active Crew child owner");
  return owner;
}

export function ownChildProcess(proc: ChildProcess): void {
  children.set(proc, requireWorkerOwner());
  proc.once("close", () => children.delete(proc));
}

export function ownsChildProcess(owner: string, proc: ChildProcess): boolean {
  return children.get(proc) === owner;
}

export function shutdownOwnedChildren(owner: string): void {
  closedOwners.add(owner);
  for (const [proc, childOwner] of children) {
    if (childOwner !== owner) continue;
    if (proc.exitCode === null && !proc.killed) crewKill(proc, "SIGTERM");
    // Keep ownership until close: repeated cleanup must still recognize the child.
  }
}
