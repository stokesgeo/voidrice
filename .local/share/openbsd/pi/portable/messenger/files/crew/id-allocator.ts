import { instance, assertCampaign } from '../candidate-instance.mjs';
/**
 * Crew - ID Allocator
 * 
 * Simple task ID allocation: task-1, task-2, ...
 */

import * as fs from '../candidate-fs.mjs';
import * as path from "node:path";

/**
 * Scans existing tasks to determine the next sequence number.
 * Returns task ID in format: task-N
 */
export function allocateTaskId(cwd: string): string {
  assertCampaign(instance(), cwd);
  const tasksDir = path.join(cwd, ".pi", "messenger", "crew", "tasks");

  let maxN = 0n;
  if (fs.existsSync(tasksDir)) {
    for (const file of fs.readdirSync(tasksDir)) {
      const match = file.match(/^task-([1-9][0-9]*)\.json$/);
      if (match) {
        const n = BigInt(match[1]);
        if (n > maxN) maxN = n;
      }
    }
  }

  return `task-${maxN + 1n}`;
}

