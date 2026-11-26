import { instance as campaignInstance, assertCampaign } from '../candidate-instance.mjs';
/**
 * Crew - Store Operations
 * 
 * Simplified PRD-based storage: plan.json + tasks/*.json
 */

import * as fs from '../candidate-fs.mjs';
import * as path from "node:path";
import { execSync } from "node:child_process";
import type { Plan, Task, TaskApproval, TaskApprovalDecisionStatus, TaskEvidence } from "./types.ts";
import { allocateTaskId } from "./id-allocator.ts";
import { normalizeRiskLabels } from "./utils/risk-labels.ts";

// =============================================================================
// Directory Helpers
// =============================================================================

// Allocator spelling is task-N, starting at one. Never normalize caller IDs.
function assertTaskId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !/^task-[1-9][0-9]*$/.test(id)) throw new Error("invalid allocated task ID");
}

function taskPath(cwd: string, id: string, suffix: ".json" | ".md" | ".progress.md"): string {
  assertTaskId(id);
  return path.join(getTasksDir(cwd), id + suffix);
}

function blockPath(cwd: string, id: string): string {
  assertTaskId(id);
  return path.join(getBlocksDir(cwd), id + ".md");
}

function assertDependencies(value: unknown): void {
  if (!Array.isArray(value)) throw new Error("invalid task dependencies");
  for (const id of value) assertTaskId(id);
}

// Reject malformed records before normalization or any lifecycle/reporting use.
// Legacy omitted depends_on/attempt_count still receive the original defaults.
function validateTaskRecord(raw: unknown, expectedId: string): asserts raw is Task {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid persisted task record");
  const value = raw as Record<string, unknown>;
  assertTaskId(value.id);
  if (value.id !== expectedId || typeof value.title !== "string" ||
      !["todo", "in_progress", "done", "blocked"].includes(value.status as string) ||
      typeof value.created_at !== "string" || typeof value.updated_at !== "string") {
    throw new Error("invalid persisted task record identity/type");
  }
  if (value.depends_on !== undefined) assertDependencies(value.depends_on);
  for (const key of ["model", "role", "started_at", "completed_at", "base_commit", "assigned_to", "summary", "blocked_reason"]) {
    if (value[key] !== undefined && typeof value[key] !== "string") throw new Error("invalid task field type: " + key);
  }
  if (value.milestone !== undefined && typeof value.milestone !== "boolean") throw new Error("invalid task milestone");
  for (const key of ["skills", "risk_labels"]) {
    const list = value[key];
    if (list !== undefined && (!Array.isArray(list) || list.some(item => typeof item !== "string"))) throw new Error("invalid task list: " + key);
  }
  for (const key of ["attempt_count", "review_count"]) {
    const count = value[key];
    if (count !== undefined && (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0)) throw new Error("invalid task count: " + key);
  }
  for (const key of ["approval", "evidence", "last_review"]) {
    const item = value[key];
    if (item === undefined) continue;
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("invalid task metadata: " + key);
    const metadata = item as Record<string, unknown>;
    const strings = key === "approval" ? ["plan", "feedback", "decided_by", "decided_at"] : key === "last_review" ? ["summary", "reviewed_at"] : [];
    for (const field of strings) {
      if ((key === "last_review" || metadata[field] !== undefined) && typeof metadata[field] !== "string") throw new Error("invalid task metadata string");
    }
    const lists = key === "evidence" ? ["commits", "tests", "prs"] : key === "last_review" ? ["issues", "suggestions"] : [];
    for (const field of lists) {
      const list = metadata[field];
      if ((key === "last_review" || list !== undefined) && (!Array.isArray(list) || list.some(entry => typeof entry !== "string"))) throw new Error("invalid task metadata list");
    }
    if (key === "approval" && (typeof metadata.required !== "boolean" ||
        (metadata.status !== undefined && !(metadata.required ? ["pending", "approved", "rejected"] : ["not_required"]).includes(metadata.status as string)))) throw new Error("invalid task approval");
    if (key === "last_review" && !["SHIP", "NEEDS_WORK", "MAJOR_RETHINK"].includes(metadata.verdict as string)) throw new Error("invalid task review");
  }
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getCrewDir(cwd: string): string {
  assertCampaign(campaignInstance(), cwd);
  return path.join(cwd, ".pi", "messenger", "crew");
}

function getTasksDir(cwd: string): string {
  return path.join(getCrewDir(cwd), "tasks");
}

function getBlocksDir(cwd: string): string {
  return path.join(getCrewDir(cwd), "blocks");
}

export function cleanupBlockFiles(cwd: string, taskId: string): void {
  assertTaskId(taskId);
  assertCampaign(campaignInstance(), cwd);
  try { fs.unlinkSync(blockPath(cwd, taskId)); } catch {}
}

// =============================================================================
// JSON Helpers
// =============================================================================

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function writeJson(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  const temp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, filePath);
}

function readText(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function writeText(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  const temp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, content);
  fs.renameSync(temp, filePath);
}

// =============================================================================
// Plan Operations
// =============================================================================

export function getPlan(cwd: string): Plan | null {
  assertCampaign(campaignInstance(), cwd);
  return readJson<Plan>(path.join(getCrewDir(cwd), "plan.json"));
}

export function createPlan(cwd: string, prdPath: string, prompt?: string): Plan {
  assertCampaign(campaignInstance(), cwd);
  const now = new Date().toISOString();
  
  const plan: Plan = {
    prd: prdPath,
    ...(prompt ? { prompt } : {}),
    created_at: now,
    updated_at: now,
    task_count: 0,
    completed_count: 0,
  };

  writeJson(path.join(getCrewDir(cwd), "plan.json"), plan);
  return plan;
}

export function getPlanLabel(plan: Plan, maxLen = 60): string {
  if (!plan.prompt) return plan.prd;
  return plan.prompt.length > maxLen
    ? plan.prompt.slice(0, maxLen - 3) + "..."
    : plan.prompt;
}

export function updatePlan(cwd: string, updates: Partial<Plan>): Plan | null {
  assertCampaign(campaignInstance(), cwd);
  const plan = getPlan(cwd);
  if (!plan) return null;

  const updated: Plan = {
    ...plan,
    ...updates,
    updated_at: new Date().toISOString(),
  };

  writeJson(path.join(getCrewDir(cwd), "plan.json"), updated);
  return updated;
}

export function deletePlan(cwd: string): boolean {
  assertCampaign(campaignInstance(), cwd);
  const planPath = path.join(getCrewDir(cwd), "plan.json");
  const planMdPath = path.join(getCrewDir(cwd), "plan.md");
  const tasksDir = getTasksDir(cwd);
  
  let deleted = false;
  
  // Delete plan.json
  if (fs.existsSync(planPath)) {
    fs.unlinkSync(planPath);
    deleted = true;
  }
  
  // Delete plan.md
  if (fs.existsSync(planMdPath)) {
    fs.unlinkSync(planMdPath);
  }
  
  // Delete all task files
  if (fs.existsSync(tasksDir)) {
    for (const file of fs.readdirSync(tasksDir)) {
      fs.unlinkSync(path.join(tasksDir, file));
    }
  }

  // Delete all block files
  const blocksDir = getBlocksDir(cwd);
  if (fs.existsSync(blocksDir)) {
    for (const file of fs.readdirSync(blocksDir)) {
      fs.unlinkSync(path.join(blocksDir, file));
    }
  }
  
  return deleted;
}

// =============================================================================
// Plan Spec Operations
// =============================================================================

export function getPlanSpec(cwd: string): string | null {
  assertCampaign(campaignInstance(), cwd);
  return readText(path.join(getCrewDir(cwd), "plan.md"));
}

export function setPlanSpec(cwd: string, content: string): void {
  assertCampaign(campaignInstance(), cwd);
  writeText(path.join(getCrewDir(cwd), "plan.md"), content);
  updatePlan(cwd, {}); // Touch updated_at
}

// =============================================================================
// Task Operations
// =============================================================================

export function createTask(
  cwd: string,
  title: string,
  description?: string,
  dependsOn?: string[],
  options?: Pick<Task, "role" | "risk_labels" | "approval" | "skills" | "model">
): Task {
  assertCampaign(campaignInstance(), cwd);
  assertDependencies(dependsOn ?? []);
  const id = allocateTaskId(cwd);
  assertTaskId(id);
  // Refuse occupied task artifacts before any mutation, even a faulty allocator.
  // Exclusive creates below are an additional no-replace check, not a transaction.
  for (const file of [taskPath(cwd, id, ".json"), taskPath(cwd, id, ".md"),
      taskPath(cwd, id, ".progress.md"), blockPath(cwd, id)]) {
    if (fs.existsSync(file)) throw new Error("allocated task ID collision: " + id);
  }
  const now = new Date().toISOString();
  const riskLabels = normalizeRiskLabels(options?.risk_labels);

  const task: Task = {
    id,
    title,
    status: "todo",
    depends_on: dependsOn ?? [],
    ...(options?.model ? { model: options.model } : {}),
    ...(options?.role ? { role: options.role } : {}),
    ...(riskLabels ? { risk_labels: riskLabels } : {}),
    ...(options?.approval ? { approval: options.approval } : {}),
    ...(options?.skills && options.skills.length > 0 ? { skills: options.skills } : {}),
    created_at: now,
    updated_at: now,
    attempt_count: 0,
  };

  validateTaskRecord(task, id);
  ensureDir(getTasksDir(cwd));
  fs.writeFileSync(taskPath(cwd, id, ".json"), JSON.stringify(task, null, 2) + "\n", { flag: "wx" });

  // Create task spec file
  const specContent = description
    ? `# ${title}\n\n${description}\n`
    : `# ${title}\n\n*Spec pending*\n`;
  fs.writeFileSync(taskPath(cwd, id, ".md"), specContent, { flag: "wx" });

  // Update plan task count
  const plan = getPlan(cwd);
  if (plan) {
    updatePlan(cwd, { task_count: plan.task_count + 1 });
  }

  return task;
}

function normalizeApproval(raw: unknown): TaskApproval | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const metadata = {
    ...(typeof value.plan === "string" ? { plan: value.plan } : {}),
    ...(typeof value.feedback === "string" ? { feedback: value.feedback } : {}),
    ...(typeof value.decided_by === "string" ? { decided_by: value.decided_by } : {}),
    ...(typeof value.decided_at === "string" ? { decided_at: value.decided_at } : {}),
  };
  if (value.required !== true) return { required: false, status: "not_required", ...metadata };

  const status: TaskApprovalDecisionStatus = value.status === "approved" || value.status === "rejected"
    ? value.status
    : "pending";
  return { required: true, status, ...metadata };
}

function normalizeTask(raw: Task): Task {
  const approval = normalizeApproval(raw.approval);
  return {
    ...raw,
    depends_on: Array.isArray(raw.depends_on) ? raw.depends_on : [],
    skills: Array.isArray(raw.skills) ? raw.skills.filter(s => typeof s === "string") : undefined,
    role: typeof raw.role === "string" && raw.role.trim().length > 0 ? raw.role : undefined,
    risk_labels: normalizeRiskLabels(Array.isArray(raw.risk_labels) ? raw.risk_labels.filter(s => typeof s === "string") : undefined),
    approval,
    attempt_count: typeof raw.attempt_count === "number" ? raw.attempt_count : 0,
  };
}

export function getTask(cwd: string, taskId: string): Task | null {
  assertTaskId(taskId);
  assertCampaign(campaignInstance(), cwd);
  const file = taskPath(cwd, taskId, ".json");
  if (!fs.existsSync(file)) return null;
  const raw: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
  validateTaskRecord(raw, taskId);
  return normalizeTask(raw);
}

export function updateTask(cwd: string, taskId: string, updates: Partial<Task>): Task | null {
  assertTaskId(taskId);
  assertCampaign(campaignInstance(), cwd);
  if (updates.id !== undefined && updates.id !== taskId) throw new Error("task identity update refused");
  if (updates.depends_on !== undefined) assertDependencies(updates.depends_on);
  const task = getTask(cwd, taskId);
  if (!task) return null;

  const updated: Task = {
    ...task,
    ...updates,
    updated_at: new Date().toISOString(),
  };

  validateTaskRecord(updated, taskId);
  writeJson(taskPath(cwd, taskId, ".json"), updated);
  return updated;
}

export function getTasks(cwd: string): Task[] {
  assertCampaign(campaignInstance(), cwd);
  const dir = getTasksDir(cwd);
  if (!fs.existsSync(dir)) return [];

  const tasks: Task[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const id = file.slice(0, -5);
    assertTaskId(id);
    const raw = readJson<Task>(taskPath(cwd, id, ".json"));
    if (raw === null) throw new Error("unreadable persisted task record");
    validateTaskRecord(raw, id);
    tasks.push(normalizeTask(raw));
  }

  // Sort by ID number (task-1, task-2, ...)
  return tasks.sort((a, b) => {
    const aNum = BigInt(a.id.slice(5));
    const bNum = BigInt(b.id.slice(5));
    return aNum < bNum ? -1 : aNum > bNum ? 1 : 0;
  });
}

export function getTaskSpec(cwd: string, taskId: string): string | null {
  assertTaskId(taskId);
  assertCampaign(campaignInstance(), cwd);
  return readText(taskPath(cwd, taskId, ".md"));
}

export function appendTaskProgress(cwd: string, taskId: string, agent: string, message: string): void {
  assertTaskId(taskId);
  assertCampaign(campaignInstance(), cwd);
  const progressPath = taskPath(cwd, taskId, ".progress.md");
  ensureDir(path.dirname(progressPath));
  const timestamp = new Date().toISOString();
  fs.appendFileSync(progressPath, `[${timestamp}] (${agent}) ${message}\n`);
}

export function getTaskProgress(cwd: string, taskId: string): string | null {
  assertTaskId(taskId);
  assertCampaign(campaignInstance(), cwd);
  const content = readText(taskPath(cwd, taskId, ".progress.md"));
  return content && content.trim().length > 0 ? content : null;
}

export function getBlockContext(cwd: string, taskId: string): string | null {
  assertTaskId(taskId);
  assertCampaign(campaignInstance(), cwd);
  return readText(blockPath(cwd, taskId));
}

export function setTaskSpec(cwd: string, taskId: string, content: string): void {
  assertTaskId(taskId);
  assertCampaign(campaignInstance(), cwd);
  writeText(taskPath(cwd, taskId, ".md"), content);
  updateTask(cwd, taskId, {}); // Touch updated_at
}

export function deleteTask(cwd: string, taskId: string): boolean {
  assertTaskId(taskId);
  assertCampaign(campaignInstance(), cwd);
  const task = getTask(cwd, taskId);
  if (!task) return false;

  const tasksDir = getTasksDir(cwd);
  for (const ext of [".json", ".md", ".progress.md"]) {
    try { fs.unlinkSync(taskPath(cwd, taskId, ext as ".json" | ".md" | ".progress.md")); } catch {}
  }

  try { fs.unlinkSync(blockPath(cwd, taskId)); } catch {}

  const allTasks = getTasks(cwd);
  for (const t of allTasks) {
    if (t.depends_on.includes(taskId)) {
      updateTask(cwd, t.id, {
        depends_on: t.depends_on.filter(d => d !== taskId),
      });
    }
  }

  const plan = getPlan(cwd);
  if (plan) {
    const updates: Partial<Plan> = { task_count: plan.task_count - 1 };
    if (task.status === "done") {
      updates.completed_count = plan.completed_count - 1;
    }
    updatePlan(cwd, updates);
  }

  return true;
}

// =============================================================================
// Task Lifecycle Operations
// =============================================================================

export function getBaseCommit(cwd: string): string | undefined {
  assertCampaign(campaignInstance(), cwd);
  try {
    return execSync("git rev-parse HEAD", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 2000,
    }).trim();
  } catch {
    return undefined;
  }
}

export function startTask(cwd: string, taskId: string, agentName: string): Task | null {
  assertTaskId(taskId);
  assertCampaign(campaignInstance(), cwd);
  const task = getTask(cwd, taskId);
  if (!task || task.status !== "todo") return null;

  return updateTask(cwd, taskId, {
    status: "in_progress",
    started_at: new Date().toISOString(),
    base_commit: getBaseCommit(cwd),
    assigned_to: agentName,
    attempt_count: task.attempt_count + 1,
  });
}

export function completeTask(
  cwd: string,
  taskId: string,
  summary: string,
  evidence?: TaskEvidence
): Task | null {
  assertTaskId(taskId);
  assertCampaign(campaignInstance(), cwd);
  const task = getTask(cwd, taskId);
  if (!task || task.status !== "in_progress") return null;

  const updated = updateTask(cwd, taskId, {
    status: "done",
    completed_at: new Date().toISOString(),
    summary,
    evidence,
    assigned_to: undefined,
  });

  // Update plan completed count
  if (updated) {
    const plan = getPlan(cwd);
    if (plan) {
      updatePlan(cwd, { completed_count: plan.completed_count + 1 });
    }
  }

  autoCompleteMilestones(cwd);

  return updated;
}

export function blockTask(cwd: string, taskId: string, reason: string): Task | null {
  assertTaskId(taskId);
  assertCampaign(campaignInstance(), cwd);
  const task = getTask(cwd, taskId);
  if (!task) return null;

  // Write block context to blocks directory
  const contextPath = blockPath(cwd, taskId);
  writeText(contextPath, `# Blocked: ${task.title}\n\n**Reason:** ${reason}\n\n**Blocked at:** ${new Date().toISOString()}\n`);

  return updateTask(cwd, taskId, {
    status: "blocked",
    blocked_reason: reason,
    assigned_to: undefined,
  });
}

export function unblockTask(cwd: string, taskId: string): Task | null {
  assertTaskId(taskId);
  assertCampaign(campaignInstance(), cwd);
  const task = getTask(cwd, taskId);
  if (!task || task.status !== "blocked") return null;

  cleanupBlockFiles(cwd, taskId);

  return updateTask(cwd, taskId, {
    status: "todo",
    blocked_reason: undefined,
  });
}

export function resetTask(cwd: string, taskId: string, cascade: boolean = false): Task[] {
  assertTaskId(taskId);
  assertCampaign(campaignInstance(), cwd);
  const task = getTask(cwd, taskId);
  if (!task) return [];

  const resetTasks: Task[] = [];
  const wasDone = task.status === "done";

  // Reset this task
  const updated = updateTask(cwd, taskId, {
    status: "todo",
    started_at: undefined,
    completed_at: undefined,
    base_commit: undefined,
    assigned_to: undefined,
    summary: undefined,
    evidence: undefined,
    blocked_reason: undefined,
    // Keep attempt_count for tracking
  });
  if (updated) resetTasks.push(updated);

  cleanupBlockFiles(cwd, taskId);

  // If cascade, reset all tasks that depend on this one
  if (cascade) {
    const allTasks = getTasks(cwd);
    for (const t of allTasks) {
      if (t.depends_on.includes(taskId) && t.status !== "todo") {
        const cascaded = resetTask(cwd, t.id, true);
        resetTasks.push(...cascaded);
      }
    }
  }

  // Update plan completed count if needed
  if (wasDone && resetTasks.length > 0) {
    const plan = getPlan(cwd);
    if (plan) {
      const doneTasks = getTasks(cwd).filter(t => t.status === "done");
      updatePlan(cwd, { completed_count: doneTasks.length });
    }
  }

  return resetTasks;
}

// =============================================================================
// Ready Tasks (Dependency Resolution)
// =============================================================================

export function getReadyTasksFrom(tasks: Task[], options?: { advisory?: boolean }): Task[] {
  if (options?.advisory) {
    return tasks.filter(t => t.status === "todo" && !t.milestone);
  }
  const doneIds = new Set(tasks.filter(t => t.status === "done").map(t => t.id));

  return tasks.filter(task => {
    if (task.status !== "todo" || task.milestone) return false;
    return task.depends_on.every(depId => doneIds.has(depId));
  });
}

export function getReadyTasks(cwd: string, options?: { advisory?: boolean }): Task[] {
  assertCampaign(campaignInstance(), cwd);
  return getReadyTasksFrom(getTasks(cwd), options);
}

export function autoCompleteMilestones(cwd: string): void {
  assertCampaign(campaignInstance(), cwd);
  let changed = true;
  while (changed) {
    changed = false;
    const tasks = getTasks(cwd);
    for (const task of tasks) {
      if (!task.milestone || task.status !== "todo") continue;
      const allDepsDone = task.depends_on.every(depId => {
        const dep = getTask(cwd, depId);
        return dep?.status === "done";
      });
      if (allDepsDone) {
        updateTask(cwd, task.id, {
          status: "done",
          completed_at: new Date().toISOString(),
          summary: "All subtasks completed",
        });
        const doneCount = getTasks(cwd).filter(t => t.status === "done").length;
        const plan = getPlan(cwd);
        if (plan) updatePlan(cwd, { completed_count: doneCount });
        changed = true;
      }
    }
  }
}

// =============================================================================
// Validation
// =============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validatePlan(cwd: string): ValidationResult {
  assertCampaign(campaignInstance(), cwd);
  const errors: string[] = [];
  const warnings: string[] = [];

  const plan = getPlan(cwd);
  if (!plan) {
    return { valid: false, errors: ["No plan found"], warnings: [] };
  }

  const tasks = getTasks(cwd);

  // Check for orphan dependencies
  const taskIds = new Set(tasks.map(t => t.id));
  for (const task of tasks) {
    for (const depId of task.depends_on) {
      if (!taskIds.has(depId)) {
        errors.push(`Task ${task.id} depends on non-existent task ${depId}`);
      }
    }
  }

  // Check for circular dependencies
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function hasCycle(taskId: string): boolean {
    if (recursionStack.has(taskId)) return true;
    if (visited.has(taskId)) return false;

    visited.add(taskId);
    recursionStack.add(taskId);

    const task = tasks.find(t => t.id === taskId);
    if (task) {
      for (const depId of task.depends_on) {
        if (hasCycle(depId)) return true;
      }
    }

    recursionStack.delete(taskId);
    return false;
  }

  for (const task of tasks) {
    visited.clear();
    recursionStack.clear();
    if (hasCycle(task.id)) {
      errors.push(`Circular dependency detected involving task ${task.id}`);
    }
  }

  // Check for tasks without specs
  for (const task of tasks) {
    const spec = getTaskSpec(cwd, task.id);
    if (!spec || spec.includes("*Spec pending*")) {
      warnings.push(`Task ${task.id} has no detailed spec`);
    }
  }

  // Check plan spec
  const planSpec = getPlanSpec(cwd);
  if (!planSpec || planSpec.includes("*Spec pending*")) {
    warnings.push("Plan has no detailed spec");
  }

  // Check task counts
  if (plan.task_count !== tasks.length) {
    warnings.push(`Plan task_count (${plan.task_count}) doesn't match actual tasks (${tasks.length})`);
  }

  const actualDone = tasks.filter(t => t.status === "done").length;
  if (plan.completed_count !== actualDone) {
    warnings.push(`Plan completed_count (${plan.completed_count}) doesn't match actual (${actualDone})`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// =============================================================================
// Dependency Graph
// =============================================================================

export function getTransitiveDependents(cwd: string, targetId: string): Task[] {
  assertTaskId(targetId);
  assertCampaign(campaignInstance(), cwd);
  const tasks = getTasks(cwd);
  const collected = new Set<string>();
  const queue = [targetId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const task of tasks) {
      if (collected.has(task.id) || task.id === targetId) continue;
      if (task.depends_on.includes(current)) {
        collected.add(task.id);
        queue.push(task.id);
      }
    }
  }

  return tasks.filter(t => collected.has(t.id));
}

// =============================================================================
// Plan Existence Check
// =============================================================================

export function hasPlan(cwd: string): boolean {
  assertCampaign(campaignInstance(), cwd);
  return getPlan(cwd) !== null;
}
