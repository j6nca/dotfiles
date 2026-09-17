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
	updatedAt: number;
}

const CUSTOM_TYPE = "swarm-state";

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

function parseTaskCommand(args: string, defaultId: number | undefined): { id: number | undefined; rest: string } {
	const trimmed = args.trim();
	if (!trimmed) return { id: defaultId, rest: "" };

	const match = trimmed.match(/^(?:#)?(\d+)(?:\s+(.*))?$/);
	if (match) return { id: Number(match[1]), rest: match[2]?.trim() ?? "" };

	return { id: defaultId, rest: trimmed };
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
