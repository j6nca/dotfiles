import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type SwarmPhase = "planning" | "executing" | "testing" | "reviewing" | "summarizing" | "done";
type SwarmTaskStatus = "todo" | "in_progress" | "done" | "blocked";

interface SwarmTask {
	id: number;
	text: string;
	status: SwarmTaskStatus;
	note?: string;
}

interface SwarmState {
	goal: string;
	phase: SwarmPhase;
	tasks: SwarmTask[];
	currentTaskId?: number;
	nextTaskId: number;
	lastImportTaskIds?: number[];
	updatedAt: number;
}

const CUSTOM_TYPE = "swarm-state";
const COORDINATOR_CUSTOM_TYPE = "coordinator-state";
const MAX_IMPORTED_TASKS = 100;
const MAX_TASK_LENGTH = 500;

export default function (pi: ExtensionAPI) {
	let state: SwarmState | undefined;

	const restoreState = (ctx: ExtensionContext) => {
		state = undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== CUSTOM_TYPE) continue;
			state = normalizeState(entry.data);
		}
		updateWidget(ctx, state);
	};

	const saveState = (ctx: ExtensionContext, next: SwarmState | undefined) => {
		state = next;
		pi.appendEntry(CUSTOM_TYPE, next ?? null);
		updateWidget(ctx, state);
	};

	const importTasks = (ctx: ExtensionContext, taskTexts: string[], source: string): number => {
		if (!state) {
			ctx.ui.notify("No swarm is active. Run /swarm-start <goal> first.", "error");
			return 0;
		}

		const existing = new Set(state.tasks.map((task) => normalizeTaskText(task.text)));
		const unique: string[] = [];
		let wasCapped = false;
		for (const text of taskTexts) {
			const normalized = normalizeTaskText(text);
			if (!normalized || existing.has(normalized)) continue;
			if (looksSensitive(text)) {
				ctx.ui.notify(`Skipped a ${source} task that looked like it might contain a secret.`, "warning");
				continue;
			}
			existing.add(normalized);
			unique.push(text.trim().slice(0, MAX_TASK_LENGTH));
			if (unique.length >= MAX_IMPORTED_TASKS) {
				wasCapped = true;
				break;
			}
		}

		if (unique.length === 0) {
			ctx.ui.notify(`No new swarm tasks found in ${source}.`, "warning");
			return 0;
		}

		const tasks = unique.map((text, index): SwarmTask => ({ id: state!.nextTaskId + index, text, status: "todo" }));
		const next: SwarmState = {
			...state,
			tasks: [...state.tasks, ...tasks],
			nextTaskId: state.nextTaskId + tasks.length,
			lastImportTaskIds: tasks.map((task) => task.id),
			updatedAt: Date.now(),
		};
		saveState(ctx, next);
		ctx.ui.notify(
			`Imported ${tasks.length} swarm task${tasks.length === 1 ? "" : "s"} from ${source}.${wasCapped ? ` Import capped at ${MAX_IMPORTED_TASKS}.` : ""}`,
			"info",
		);
		return tasks.length;
	};

	pi.on("session_start", async (_event, ctx) => restoreState(ctx));
	pi.on("session_tree", async (_event, ctx) => restoreState(ctx));

	pi.registerCommand("swarm-start", {
		description: "Start a swarm workflow for a goal",
		handler: async (args, ctx) => {
			const goal = args.trim();
			if (!goal) {
				ctx.ui.notify("Usage: /swarm-start <goal>", "error");
				return;
			}

			const next: SwarmState = {
				goal,
				phase: "planning",
				tasks: [],
				nextTaskId: 1,
				updatedAt: Date.now(),
			};
			saveState(ctx, next);
			ctx.ui.notify("Swarm started. Sending planner prompt...", "info");
			await sendTemplate(pi, ctx, `/swarm-plan ${goal}`);
		},
	});

	pi.registerCommand("swarm-add", {
		description: "Add a task to the current swarm",
		handler: async (args, ctx) => {
			const taskText = args.trim();
			if (!state) {
				ctx.ui.notify("No swarm is active. Run /swarm-start <goal> first.", "error");
				return;
			}
			if (!taskText) {
				ctx.ui.notify("Usage: /swarm-add <task>", "error");
				return;
			}

			const task: SwarmTask = { id: state.nextTaskId, text: taskText, status: "todo" };
			const next: SwarmState = {
				...state,
				tasks: [...state.tasks, task],
				nextTaskId: state.nextTaskId + 1,
				updatedAt: Date.now(),
			};
			saveState(ctx, next);
			ctx.ui.notify(`Added swarm task #${task.id}`, "info");
		},
	});

	pi.registerCommand("swarm-add-file", {
		description: "Import swarm tasks from a markdown or text file",
		handler: async (args, ctx) => {
			const inputPath = args.trim();
			if (!inputPath) {
				ctx.ui.notify("Usage: /swarm-add-file <path>", "error");
				return;
			}

			const filePath = path.resolve(ctx.cwd, inputPath);
			let text: string;
			try {
				text = await fs.readFile(filePath, "utf-8");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Could not read swarm task file: ${message}`, "error");
				return;
			}

			importTasks(ctx, parseSwarmTasksFromText(text), inputPath);
		},
	});

	pi.registerCommand("swarm-promote-plan", {
		description: "Import tasks from the Plan section of the latest assistant response",
		handler: async (_args, ctx) => {
			const text = getLastAssistantText(ctx);
			if (!text) {
				ctx.ui.notify("No complete assistant response found to promote.", "error");
				return;
			}

			const plan = extractMarkdownSection(text, "Plan") ?? text;
			importTasks(ctx, parseSwarmTasksFromText(plan), "latest plan");
		},
	});

	pi.registerCommand("swarm-remove", {
		description: "Remove one swarm task by id",
		handler: async (args, ctx) => {
			if (!state) {
				ctx.ui.notify("No swarm is active. Run /swarm-start <goal> first.", "error");
				return;
			}

			const id = parseTaskId(args.trim());
			if (!id) {
				ctx.ui.notify("Usage: /swarm-remove <task-id>", "error");
				return;
			}

			const next = removeTaskIds(state, [id]);
			if (next.tasks.length === state.tasks.length) {
				ctx.ui.notify(`Swarm task #${id} not found.`, "error");
				return;
			}

			saveState(ctx, next);
			ctx.ui.notify(`Removed swarm task #${id}.`, "info");
		},
	});

	pi.registerCommand("swarm-remove-range", {
		description: "Remove a contiguous range of swarm tasks by id",
		handler: async (args, ctx) => {
			if (!state) {
				ctx.ui.notify("No swarm is active. Run /swarm-start <goal> first.", "error");
				return;
			}

			const range = parseTaskIdRange(args);
			if (!range) {
				ctx.ui.notify("Usage: /swarm-remove-range <start-id> <end-id>", "error");
				return;
			}

			const ids = state.tasks.filter((task) => task.id >= range.start && task.id <= range.end).map((task) => task.id);
			if (ids.length === 0) {
				ctx.ui.notify(`No swarm tasks found in range #${range.start}-#${range.end}.`, "warning");
				return;
			}

			saveState(ctx, removeTaskIds(state, ids));
			ctx.ui.notify(`Removed ${ids.length} swarm task${ids.length === 1 ? "" : "s"} from #${range.start}-#${range.end}.`, "info");
		},
	});

	pi.registerCommand("swarm-clear-tasks", {
		description: "Remove all tasks from the current swarm",
		handler: async (_args, ctx) => {
			if (!state) {
				ctx.ui.notify("No swarm is active. Run /swarm-start <goal> first.", "error");
				return;
			}
			if (state.tasks.length === 0) {
				ctx.ui.notify("Swarm has no tasks to clear.", "info");
				return;
			}

			if (ctx.hasUI) {
				const ok = await ctx.ui.confirm("Clear swarm tasks?", "This removes all tasks from the current swarm but keeps the goal.");
				if (!ok) return;
			}

			saveState(ctx, { ...state, tasks: [], currentTaskId: undefined, lastImportTaskIds: undefined, updatedAt: Date.now() });
			ctx.ui.notify("Cleared all swarm tasks.", "info");
		},
	});

	pi.registerCommand("swarm-undo-import", {
		description: "Undo the last swarm bulk import",
		handler: async (_args, ctx) => {
			if (!state) {
				ctx.ui.notify("No swarm is active. Run /swarm-start <goal> first.", "error");
				return;
			}

			const ids = state.lastImportTaskIds ?? [];
			if (ids.length === 0) {
				ctx.ui.notify("No swarm bulk import is available to undo.", "warning");
				return;
			}

			const next = removeTaskIds(state, ids);
			const removed = state.tasks.length - next.tasks.length;
			if (removed === 0) {
				saveState(ctx, { ...state, lastImportTaskIds: undefined, updatedAt: Date.now() });
				ctx.ui.notify("Last imported swarm tasks were already removed.", "warning");
				return;
			}

			saveState(ctx, { ...next, lastImportTaskIds: undefined });
			ctx.ui.notify(`Undid last swarm bulk import and removed ${removed} task${removed === 1 ? "" : "s"}.`, "info");
		},
	});

	pi.registerCommand("swarm-status", {
		description: "Show the current swarm goal and tasks",
		handler: async (_args, ctx) => {
			if (!state) {
				ctx.ui.notify("No swarm is active. Run /swarm-start <goal> first.", "warning");
				return;
			}

			if (ctx.mode !== "tui") {
				ctx.ui.notify(formatCompactStatus(state), "info");
				return;
			}

			await ctx.ui.custom<void>((_tui, theme, _keybindings, done) => {
				return new SwarmStatusComponent(state!, theme, () => done());
			});
		},
	});

	pi.registerCommand("swarm-next", {
		description: "Advance the swarm to the next task or role",
		handler: async (_args, ctx) => {
			if (!state) {
				ctx.ui.notify("No swarm is active. Run /swarm-start <goal> first.", "error");
				return;
			}

			const inProgress = state.tasks.find((task) => task.status === "in_progress");
			if (inProgress) {
				ctx.ui.notify(`Task #${inProgress.id} is still in progress. Use /swarm-done or /swarm-block before advancing.`, "warning");
				return;
			}

			const todo = state.tasks.find((task) => task.status === "todo");
			if (todo) {
				const next = updateTask(state, todo.id, { status: "in_progress" }, "executing");
				saveState(ctx, next);
				await sendTemplate(pi, ctx, `/swarm-execute Task #${todo.id}: ${todo.text}`);
				return;
			}

			if (state.tasks.length === 0) {
				ctx.ui.notify("No swarm tasks yet. Add tasks from the plan with /swarm-add <task>.", "warning");
				return;
			}

			if (state.phase === "planning" || state.phase === "executing") {
				const next = { ...state, phase: "testing" as const, currentTaskId: undefined, updatedAt: Date.now() };
				saveState(ctx, next);
				await sendTemplate(pi, ctx, `/swarm-test ${state.goal}`);
				return;
			}

			if (state.phase === "testing") {
				const next = { ...state, phase: "reviewing" as const, updatedAt: Date.now() };
				saveState(ctx, next);
				await sendTemplate(pi, ctx, `/swarm-review ${state.goal}`);
				return;
			}

			if (state.phase === "reviewing") {
				const next = { ...state, phase: "summarizing" as const, updatedAt: Date.now() };
				saveState(ctx, next);
				await sendTemplate(pi, ctx, `/swarm-summary ${state.goal}`);
				return;
			}

			if (state.phase === "summarizing") {
				const next = { ...state, phase: "done" as const, updatedAt: Date.now() };
				saveState(ctx, next);
				ctx.ui.notify("Swarm marked done.", "info");
				return;
			}

			ctx.ui.notify("Swarm is already done.", "info");
		},
	});

	pi.registerCommand("swarm-dispatch", {
		description: "Bridge one swarm task into the coordinator and dispatch it to an agent",
		handler: async (args, ctx) => {
			if (!state) {
				ctx.ui.notify("No swarm is active. Run /swarm-start <goal> first.", "error");
				return;
			}

			const parsed = parseSwarmDispatchCommand(args);
			if (!parsed) {
				ctx.ui.notify("Usage: /swarm-dispatch <task-id> <agent> [--project|--both]", "error");
				return;
			}

			const task = state.tasks.find((item) => item.id === parsed.id);
			if (!task) {
				ctx.ui.notify(`Swarm task #${parsed.id} not found.`, "error");
				return;
			}
			if (task.status === "done" || task.status === "blocked") {
				ctx.ui.notify(`Swarm task #${task.id} is ${task.status} and cannot be dispatched.`, "error");
				return;
			}
			if (looksSensitive(task.text)) {
				ctx.ui.notify(`Swarm task #${task.id} looks like it may contain a secret and will not be dispatched.`, "error");
				return;
			}

			if (hasCoordinatorState(ctx) && ctx.hasUI) {
				const ok = await ctx.ui.confirm("Replace coordinator bridge state?", "This appends a new one-task coordinator state for the selected swarm task.");
				if (!ok) return;
			}

			const now = Date.now();
			pi.appendEntry(COORDINATOR_CUSTOM_TYPE, {
				goal: `Swarm task #${task.id}: ${state.goal}`,
				phase: "ready",
				tasks: [
					{
						id: 1,
						text: task.text,
						status: "todo",
						createdAt: now,
						updatedAt: now,
					},
				],
				nextTaskId: 2,
				createdAt: now,
				updatedAt: now,
			});

			const next = updateTask(state, task.id, { status: "in_progress", note: `Dispatched to coordinator agent ${parsed.agent}.` }, "executing");
			saveState(ctx, next);
			ctx.ui.notify(`Bridged swarm task #${task.id} to coordinator task #1 for ${parsed.agent}.`, "info");
			await sendTemplate(pi, ctx, `/coordinate-dispatch 1 ${parsed.agent}${parsed.scopeArg ? ` ${parsed.scopeArg}` : ""}`);
		},
	});

	pi.registerCommand("swarm-done", {
		description: "Mark the current or specified swarm task done",
		handler: async (args, ctx) => {
			if (!state) {
				ctx.ui.notify("No swarm is active. Run /swarm-start <goal> first.", "error");
				return;
			}

			const parsed = parseTaskCommand(args, state.currentTaskId);
			if (!parsed.id) {
				ctx.ui.notify("Usage: /swarm-done [id] [note]. No current task is selected.", "error");
				return;
			}

			const task = state.tasks.find((item) => item.id === parsed.id);
			if (!task) {
				ctx.ui.notify(`Swarm task #${parsed.id} not found.`, "error");
				return;
			}

			const next = updateTask(state, parsed.id, { status: "done", note: parsed.rest || task.note }, state.phase);
			saveState(ctx, next);
			ctx.ui.notify(`Marked swarm task #${parsed.id} done.`, "info");
		},
	});

	pi.registerCommand("swarm-block", {
		description: "Mark the current or specified swarm task blocked",
		handler: async (args, ctx) => {
			if (!state) {
				ctx.ui.notify("No swarm is active. Run /swarm-start <goal> first.", "error");
				return;
			}

			const parsed = parseTaskCommand(args, state.currentTaskId);
			if (!parsed.id || !parsed.rest) {
				ctx.ui.notify("Usage: /swarm-block [id] <reason>", "error");
				return;
			}

			const task = state.tasks.find((item) => item.id === parsed.id);
			if (!task) {
				ctx.ui.notify(`Swarm task #${parsed.id} not found.`, "error");
				return;
			}

			const next = updateTask(state, parsed.id, { status: "blocked", note: parsed.rest }, state.phase);
			saveState(ctx, next);
			ctx.ui.notify(`Marked swarm task #${parsed.id} blocked.`, "warning");
		},
	});

	pi.registerCommand("swarm-reset", {
		description: "Clear the current swarm state",
		handler: async (_args, ctx) => {
			if (!state) {
				ctx.ui.notify("No swarm is active.", "info");
				return;
			}

			if (ctx.hasUI) {
				const ok = await ctx.ui.confirm("Reset swarm?", "This clears the current swarm goal and task state.");
				if (!ok) return;
			}

			saveState(ctx, undefined);
			ctx.ui.notify("Swarm reset.", "info");
		},
	});
}

async function sendTemplate(pi: ExtensionAPI, ctx: ExtensionCommandContext, command: string): Promise<void> {
	const options = ctx.isIdle()
		? { expandPromptTemplates: true }
		: { expandPromptTemplates: true, deliverAs: "followUp" as const };
	pi.sendUserMessage(command, options);
}

function normalizeState(data: unknown): SwarmState | undefined {
	if (!data || typeof data !== "object") return undefined;
	const raw = data as Partial<SwarmState>;
	if (typeof raw.goal !== "string" || !Array.isArray(raw.tasks)) return undefined;

	const tasks = raw.tasks
		.filter((task): task is SwarmTask => {
			return (
				task !== null &&
				typeof task === "object" &&
				typeof task.id === "number" &&
				typeof task.text === "string" &&
				["todo", "in_progress", "done", "blocked"].includes(task.status)
			);
		})
		.map((task) => ({ ...task }));

	const maxId = tasks.reduce((max, task) => Math.max(max, task.id), 0);
	const phase = ["planning", "executing", "testing", "reviewing", "summarizing", "done"].includes(raw.phase ?? "")
		? raw.phase!
		: "planning";

	return {
		goal: raw.goal,
		phase,
		tasks,
		currentTaskId: typeof raw.currentTaskId === "number" ? raw.currentTaskId : undefined,
		nextTaskId: typeof raw.nextTaskId === "number" ? raw.nextTaskId : maxId + 1,
		lastImportTaskIds: Array.isArray(raw.lastImportTaskIds) ? raw.lastImportTaskIds.filter((id): id is number => typeof id === "number") : undefined,
		updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
	};
}

function updateTask(state: SwarmState, id: number, patch: Partial<SwarmTask>, phase: SwarmPhase): SwarmState {
	const status = patch.status;
	return {
		...state,
		phase,
		currentTaskId: status === "in_progress" ? id : state.currentTaskId === id ? undefined : state.currentTaskId,
		tasks: state.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)),
		updatedAt: Date.now(),
	};
}

function removeTaskIds(state: SwarmState, ids: number[]): SwarmState {
	const remove = new Set(ids);
	const remainingImportIds = state.lastImportTaskIds?.filter((id) => !remove.has(id));
	return {
		...state,
		tasks: state.tasks.filter((task) => !remove.has(task.id)),
		currentTaskId: state.currentTaskId && remove.has(state.currentTaskId) ? undefined : state.currentTaskId,
		lastImportTaskIds: remainingImportIds && remainingImportIds.length > 0 ? remainingImportIds : undefined,
		updatedAt: Date.now(),
	};
}

function parseTaskId(args: string): number | undefined {
	const match = args.match(/^(?:#)?(\d+)$/);
	return match ? Number(match[1]) : undefined;
}

function parseTaskIdRange(args: string): { start: number; end: number } | undefined {
	const parts = args.trim().split(/\s+/).filter(Boolean);
	if (parts.length !== 2) return undefined;
	const first = parseTaskId(parts[0]!);
	const second = parseTaskId(parts[1]!);
	if (!first || !second) return undefined;
	return { start: Math.min(first, second), end: Math.max(first, second) };
}

function parseSwarmDispatchCommand(args: string): { id: number; agent: string; scopeArg?: string } | undefined {
	const parts = args.trim().split(/\s+/).filter(Boolean);
	if (parts.length < 2 || parts.length > 3) return undefined;
	const idMatch = parts[0]!.match(/^(?:#)?(\d+)$/);
	if (!idMatch) return undefined;
	if (parts[2] && !isAgentScopeArg(parts[2])) return undefined;
	return { id: Number(idMatch[1]), agent: parts[1]!, scopeArg: parts[2] };
}

function isAgentScopeArg(value: string): boolean {
	return ["project", "--project", "both", "--both"].includes(value);
}

function hasCoordinatorState(ctx: ExtensionContext): boolean {
	const branch = ctx.sessionManager.getBranch();
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type === "custom" && entry.customType === COORDINATOR_CUSTOM_TYPE) return entry.data !== null;
	}
	return false;
}

function parseTaskCommand(args: string, defaultId: number | undefined): { id: number | undefined; rest: string } {
	const trimmed = args.trim();
	if (!trimmed) return { id: defaultId, rest: "" };

	const match = trimmed.match(/^(?:#)?(\d+)(?:\s+(.*))?$/);
	if (match) return { id: Number(match[1]), rest: match[2]?.trim() ?? "" };

	return { id: defaultId, rest: trimmed };
}

function parseSwarmTasksFromText(text: string): string[] {
	const tasks: string[] = [];
	let inFence = false;

	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.startsWith("```")) {
			inFence = !inFence;
			continue;
		}
		if (!line) continue;

		// Allow explicit /swarm-add commands anywhere, including fenced command blocks.
		const commandMatch = line.match(/^\/swarm-add\s+(.+)$/);
		if (commandMatch) {
			tasks.push(cleanTaskText(commandMatch[1]));
			continue;
		}

		// Only import top-level markdown list items. Nested bullets in a plan are
		// details, not separate swarm tasks. Fenced non-command content is ignored.
		if (!inFence && !/^\s/.test(rawLine)) {
			const markdownMatch = rawLine.match(/^(?:[-*+]\s+|\d+[.)]\s+|\[[ xX-]\]\s+)(.+)$/);
			if (markdownMatch) tasks.push(cleanTaskText(markdownMatch[1]));
		}
	}

	const seen = new Set<string>();
	return tasks.filter((task) => {
		const normalized = normalizeTaskText(task);
		if (!normalized || seen.has(normalized)) return false;
		seen.add(normalized);
		return true;
	});
}

function cleanTaskText(text: string): string {
	return text
		.trim()
		.replace(/^`\/swarm-add\s+(.+)`$/, "$1")
		.replace(/^\*\*(.+)\*\*$/, "$1")
		.trim();
}

function extractMarkdownSection(text: string, heading: string): string | undefined {
	const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(`^#{1,6}\\s+${escaped}\\s*$`, "im");
	const match = pattern.exec(text);
	if (!match) return undefined;

	const start = match.index + match[0].length;
	const rest = text.slice(start);
	const nextHeading = rest.search(/^#{1,6}\s+\S/m);
	return (nextHeading >= 0 ? rest.slice(0, nextHeading) : rest).trim();
}

function getLastAssistantText(ctx: ExtensionContext): string | undefined {
	const branch = ctx.sessionManager.getBranch();
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (!("role" in message) || message.role !== "assistant") continue;
		if ("stopReason" in message && message.stopReason && message.stopReason !== "stop") continue;
		const textParts = Array.isArray(message.content)
			? message.content
					.filter((content): content is { type: "text"; text: string } => content.type === "text" && typeof content.text === "string")
					.map((content) => content.text)
			: [];
		if (textParts.length > 0) return textParts.join("\n");
	}
	return undefined;
}

function normalizeTaskText(text: string): string {
	return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function looksSensitive(text: string): boolean {
	return /(sk-|ghp_|AKIA|xoxb-|-----BEGIN [^-]+ PRIVATE KEY-----|\b(api[_-]?key|password|token|secret|credential)\s*[:=])/i.test(text);
}

function updateWidget(ctx: ExtensionContext, state: SwarmState | undefined): void {
	if (!ctx.hasUI) return;
	if (!state) {
		ctx.ui.setWidget("swarm", undefined);
		ctx.ui.setStatus("swarm", undefined);
		return;
	}

	const counts = countTasks(state);
	ctx.ui.setStatus("swarm", `swarm: ${state.phase} ${counts.done}/${state.tasks.length}`);
	ctx.ui.setWidget("swarm", (_tui, theme) => ({
		render(width: number): string[] {
			const current = state.currentTaskId ? state.tasks.find((task) => task.id === state.currentTaskId) : undefined;
			const line = current
				? `swarm ${state.phase} • #${current.id} ${current.text}`
				: `swarm ${state.phase} • ${counts.done}/${state.tasks.length} done • ${state.goal}`;
			return [truncateToWidth(theme.fg("dim", line), width)];
		},
		invalidate() {},
	}));
}

function countTasks(state: SwarmState): Record<SwarmTaskStatus, number> {
	return state.tasks.reduce(
		(counts, task) => {
			counts[task.status] += 1;
			return counts;
		},
		{ todo: 0, in_progress: 0, done: 0, blocked: 0 } as Record<SwarmTaskStatus, number>,
	);
}

function formatCompactStatus(state: SwarmState): string {
	const counts = countTasks(state);
	return `Swarm ${state.phase}: ${state.goal} (${counts.done}/${state.tasks.length} done, ${counts.blocked} blocked)`;
}

class SwarmStatusComponent {
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		private readonly state: SwarmState,
		private readonly theme: Theme,
		private readonly onClose: () => void,
	) {}

	handleInput(data: string): void {
		if (data === "q" || matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.onClose();
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

		const th = this.theme;
		const counts = countTasks(this.state);
		const lines: string[] = [];
		lines.push(heading("Swarm", width, th));
		lines.push(truncateToWidth(`Goal: ${this.state.goal}`, width));
		lines.push(truncateToWidth(`Phase: ${this.state.phase}`, width));
		lines.push(
			truncateToWidth(
				`Tasks: ${counts.todo} todo, ${counts.in_progress} in progress, ${counts.done} done, ${counts.blocked} blocked`,
				width,
			),
		);
		lines.push("");

		if (this.state.tasks.length === 0) {
			lines.push(th.fg("dim", "No tasks yet. Add tasks with /swarm-add <task>."));
		} else {
			for (const task of this.state.tasks) {
				const marker = task.status === "done" ? "✓" : task.status === "blocked" ? "!" : task.status === "in_progress" ? "▶" : "○";
				const color = task.status === "done" ? "success" : task.status === "blocked" ? "warning" : task.status === "in_progress" ? "accent" : "dim";
				let line = `${th.fg(color, marker)} ${th.fg("accent", `#${task.id}`)} ${task.text}`;
				if (task.note) line += th.fg("dim", ` — ${task.note}`);
				lines.push(truncateToWidth(line, width));
			}
		}

		lines.push("");
		lines.push(truncateToWidth(th.fg("dim", "q/esc close • /swarm-next advance • /swarm-done complete task"), width));

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	dispose(): void {}
}

function heading(title: string, width: number, theme: Theme): string {
	const text = ` ${theme.fg("accent", theme.bold(title))} `;
	const remaining = Math.max(0, width - visibleWidth(text));
	return truncateToWidth(text + theme.fg("borderMuted", "─".repeat(remaining)), width);
}
