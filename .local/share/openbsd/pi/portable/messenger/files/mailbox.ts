import * as fs from './candidate-fs.mjs';
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// Same mailbox/envelope. A reader sees only a fully written final .json file.
// Publication is not recipient acknowledgement or power-loss durability.
export function publishInboxMessage(inbox: string, message: unknown): string {
  fs.mkdirSync(inbox, { recursive: true });
  const id = `${Date.now()}-${randomUUID()}`;
  const temporary = join(inbox, `.${id}.tmp`);
  const target = join(inbox, `${id}.json`);
  let fd: number | undefined;
  try {
    fd = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify(message, null, 2));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    // link gives atomic no-replace publication on the same filesystem.
    fs.publishFileSync(temporary, target);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temporary); } catch { /* orphan temp is not consumable */ }
  }
  return target;
}
