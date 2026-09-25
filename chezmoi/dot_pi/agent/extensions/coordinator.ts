import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type CoordinatorPhase = "planning" | "ready" | "dispatching" | "reviewing" | "done";
type CoordinatorTaskStatus = "todo" | "running" | "done" | "failed" | "blocked";

interface CoordinatorTask {
	id: number;
	text: string;
	status: CoordinatorTaskStatus;
	agent?: string;
	resultSummary?: string;
	error?: string;
	createdAt: number;
	updatedAt: number;
}

interface CoordinatorState {
	goal: string;
	phase: CoordinatorPhase;
	tasks: CoordinatorTask[];
	currentTaskId?: number;
	nextTaskId: number;
	createdAt: number;
	updatedAt: number;
}

interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
	source: AgentSource;
	filePath: string;
}

type AgentSource = "user" | "project";
type AgentScope = "user" | "project" | "both";

type AgentFrontmatter = {
	name?: unknown;
	description?: unknown;
	tools?: unknown;
	model?: unknown;
};

const CUSTOM_TYPE = "coordinator-state";
const NOT_IMPLEMENTED = "Coordinator command behavior will be implemented in a later task.";
const SUBAGENT_OUTPUT_CAP = 64 * 1024;
const SUBAGENT_STDERR_CAP = 16 * 1024;
const SUBAGENT_ABORT_KILL_DELAY_MS = 5000;
const PARALLEL_DISPATCH_TASK_LIMIT = 4;
const PARALLEL_DISPATCH_CONCURRENCY = 2;
const ALLOWED_AGENT_CHAINS = [
	["scout", "planner"],
	["worker", "reviewer"],
	["worker", "reviewer", "worker"],
] as const;

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
	description: "Agent discovery scope. Defaults to user. Project-local agents require explicit opt-in and confirmation.",
	default: "user",
});

const SubagentParams = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task to delegate to the agent" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process; defaults to the current workspace" })),
	agentScope: Type.Optional(AgentScopeSchema),
});

interface SubagentResult {
	agent: string;
	task: string;
	exitCode: number;
	output: string;
	stderr: string;
}

export default function (pi: ExtensionAPI) {
	let state: CoordinatorState | undefined;

	const restoreState = (ctx: ExtensionContext) => {
		state = undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== CUSTOM_TYPE) continue;
			state = normalizeState(entry.data);
		}
		updateStatus(ctx, state);
	};

	const saveState = (ctx: ExtensionContext, next: CoordinatorState | undefined) => {
		state = next;
		pi.appendEntry(CUSTOM_TYPE, next ?? null);
		updateStatus(ctx, state);
	};

	pi.on("session_start", async (_event, ctx) => restoreState(ctx));
	pi.on("session_tree", async (_event, ctx) => restoreState(ctx));

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: "Delegate one task to an agent in an isolated pi --mode json -p --no-session subprocess. Defaults to user-level agents; project-local agents require opt-in and confirmation.",
		promptSnippet: "Delegate one focused task to a user-level subagent with isolated context.",
		promptGuidelines: [
			"Use subagent when a focused scout, planner, reviewer, or worker can make progress with isolated context.",
			"Keep subagent tasks specific and avoid asking subagents to handle secrets, credentials, or destructive operations.",
			"subagent defaults to user-level agents. Set agentScope to project or both only when the user explicitly asks to use project-local agents.",
		],
		parameters: SubagentParams,
		executionMode: "sequential",

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const cwd = params.cwd ? path.resolve(ctx.cwd, params.cwd) : ctx.cwd;
			const scope = params.agentScope ?? "user";
			const ok = await confirmProjectAgentUse(ctx, cwd, scope);
			if (!ok) throw new Error("Project-local agent use was not confirmed.");

			const agents = discoverAgents(cwd, scope);
			const agent = agents.find((item) => item.name === params.agent);
			if (!agent) {
				const available = agents.map((item) => `${item.name} (${item.source})`).sort().join(", ") || "none";
				throw new Error(`Unknown agent: ${params.agent}. Available agents for scope ${scope}: ${available}.`);
			}

			const result = await runSubagent(agent, params.task, cwd, signal);
			if (result.exitCode !== 0) {
				throw new Error(formatSubagentFailure(result));
			}

			return {
				content: [{ type: "text" as const, text: result.output || "Subagent completed without text output." }],
				details: result,
			};
		},
	});

	pi.registerCommand("coordinate-start", {
		description: "Start a coordinator workflow for a goal",
		handler: async (args, ctx) => {
			const goal = args.trim();
			if (!goal) {
				ctx.ui.notify("Usage: /coordinate-start <goal>", "error");
				return;
			}

			if (state && ctx.hasUI) {
				const ok = await ctx.ui.confirm("Replace coordinator workflow?", "This clears the current coordinator goal and tasks.");
				if (!ok) return;
			}

			const now = Date.now();
			saveState(ctx, {
				goal,
				phase: "planning",
				tasks: [],
				nextTaskId: 1,
				createdAt: now,
				updatedAt: now,
			});
			ctx.ui.notify("Coordinator started.", "info");
		},
	});

	pi.registerCommand("coordinate-add", {
		description: "Add a task to the current coordinator workflow",
		handler: async (args, ctx) => {
			const taskText = args.trim();
			if (!state) {
				ctx.ui.notify("No coordinator is active. Run /coordinate-start <goal> first.", "error");
				return;
			}
			if (!taskText) {
				ctx.ui.notify("Usage: /coordinate-add <task>", "error");
				return;
			}

			const now = Date.now();
			const task: CoordinatorTask = {
				id: state.nextTaskId,
				text: taskText,
				status: "todo",
				createdAt: now,
				updatedAt: now,
			};
			saveState(ctx, {
				...state,
				phase: state.phase === "planning" ? "ready" : state.phase,
				tasks: [...state.tasks, task],
				nextTaskId: state.nextTaskId + 1,
				updatedAt: now,
			});
			ctx.ui.notify(`Added coordinator task #${task.id}.`, "info");
		},
	});

	pi.registerCommand("coordinate-add-file", {
		description: "Import coordinator tasks from a markdown or text file",
		handler: async (_args, ctx) => {
			ctx.ui.notify(NOT_IMPLEMENTED, "info");
		},
	});

	pi.registerCommand("coordinate-status", {
		description: "Show the current coordinator workflow status",
		handler: async (_args, ctx) => {
			if (!state) {
				ctx.ui.notify("No coordinator is active. Run /coordinate-start <goal> first.", "warning");
				return;
			}
			ctx.ui.notify(formatStatus(state), "info");
		},
	});

	pi.registerCommand("coordinate-next", {
		description: "Advance or dispatch the next coordinator task",
		handler: async (_args, ctx) => {
			ctx.ui.notify(NOT_IMPLEMENTED, "info");
		},
	});

	pi.registerCommand("coordinate-dispatch", {
		description: "Dispatch a coordinator task to an agent",
		handler: async (args, ctx) => {
			restoreState(ctx);
			if (!state) {
				ctx.ui.notify("No coordinator is active. Run /coordinate-start <goal> first.", "error");
				return;
			}

			const parsed = parseDispatchCommand(args);
			if (!parsed) {
				ctx.ui.notify("Usage: /coordinate-dispatch <task-id> <agent> [--project|--both]", "error");
				return;
			}

			const task = state.tasks.find((item) => item.id === parsed.id);
			if (!task) {
				ctx.ui.notify(`Coordinator task #${parsed.id} not found.`, "error");
				return;
			}
			if (task.status === "running" || task.status === "done") {
				ctx.ui.notify(`Coordinator task #${task.id} is ${task.status} and cannot be dispatched.`, "error");
				return;
			}

			const ok = await confirmProjectAgentUse(ctx, ctx.cwd, parsed.scope);
			if (!ok) {
				ctx.ui.notify("Project-local agent use was not confirmed.", "warning");
				return;
			}

			const agents = discoverAgents(ctx.cwd, parsed.scope);
			const agent = agents.find((item) => item.name === parsed.agent);
			if (!agent) {
				const available = agents.map((item) => `${item.name} (${item.source})`).sort().join(", ") || "none";
				ctx.ui.notify(`Unknown agent: ${parsed.agent}. Available agents for scope ${parsed.scope}: ${available}.`, "error");
				return;
			}

			const running = updateTask(state, task.id, { status: "running", agent: agent.name, error: undefined, resultSummary: undefined });
			saveState(ctx, { ...running, phase: "dispatching" });
			ctx.ui.notify(`Dispatching coordinator task #${task.id} to ${agent.name}.`, "info");

			let result: SubagentResult;
			try {
				result = await runSubagent(agent, task.text, ctx.cwd, undefined);
			} catch (error) {
				const failed = updateTask(state ?? running, task.id, {
					status: "failed",
					agent: agent.name,
					error: error instanceof Error ? error.message : String(error),
				});
				saveState(ctx, { ...failed, phase: nextPhaseAfterDispatch(failed) });
				ctx.ui.notify(`Coordinator task #${task.id} failed before ${agent.name} completed.`, "error");
				return;
			}

			if (result.exitCode === 0) {
				const done = updateTask(state ?? running, task.id, {
					status: "done",
					agent: agent.name,
					resultSummary: summarizeSubagentResult(result),
					error: undefined,
				});
				saveState(ctx, { ...done, phase: nextPhaseAfterDispatch(done) });
				ctx.ui.notify(`Coordinator task #${task.id} completed with ${agent.name}.`, "info");
				return;
			}

			const failed = updateTask(state ?? running, task.id, {
				status: "failed",
				agent: agent.name,
				error: formatSubagentFailure(result),
			});
			saveState(ctx, { ...failed, phase: nextPhaseAfterDispatch(failed) });
			ctx.ui.notify(`Coordinator task #${task.id} failed with ${agent.name}.`, "error");
		},
	});

	pi.registerCommand("coordinate-chain", {
		description: "Run an allowlisted sequential subagent chain for one coordinator task",
		handler: async (args, ctx) => {
			if (!state) {
				ctx.ui.notify("No coordinator is active. Run /coordinate-start <goal> first.", "error");
				return;
			}

			const parsed = parseChainCommand(args);
			if (!parsed) {
				ctx.ui.notify("Usage: /coordinate-chain <task-id> scout planner|worker reviewer|worker reviewer worker [--project|--both]", "error");
				return;
			}

			const task = state.tasks.find((item) => item.id === parsed.id);
			if (!task) {
				ctx.ui.notify(`Coordinator task #${parsed.id} not found.`, "error");
				return;
			}
			if (task.status === "running" || task.status === "done") {
				ctx.ui.notify(`Coordinator task #${task.id} is ${task.status} and cannot be chained.`, "error");
				return;
			}

			const ok = await confirmProjectAgentUse(ctx, ctx.cwd, parsed.scope);
			if (!ok) {
				ctx.ui.notify("Project-local agent use was not confirmed.", "warning");
				return;
			}

			const agents = discoverAgents(ctx.cwd, parsed.scope);
			const chainAgents: AgentConfig[] = [];
			for (const name of parsed.chain) {
				const agent = agents.find((item) => item.name === name);
				if (!agent) {
					const available = agents.map((item) => `${item.name} (${item.source})`).sort().join(", ") || "none";
					ctx.ui.notify(`Unknown chain agent: ${name}. Available agents for scope ${parsed.scope}: ${available}.`, "error");
					return;
				}
				chainAgents.push(agent);
			}

			const chainLabel = parsed.chain.join(" → ");
			const running = updateTask(state, task.id, { status: "running", agent: chainLabel, error: undefined, resultSummary: undefined });
			saveState(ctx, { ...running, phase: "dispatching" });
			ctx.ui.notify(`Running coordinator task #${task.id} through ${chainLabel}.`, "info");

			let previousOutput = "";
			for (const [index, agent] of chainAgents.entries()) {
				ctx.ui.notify(`Chain step ${index + 1}/${chainAgents.length}: ${agent.name}.`, "info");
				let result: SubagentResult;
				try {
					result = await runSubagent(agent, formatChainedTaskPrompt(task.text, previousOutput, index), ctx.cwd, undefined);
				} catch (error) {
					const failed = updateTask(state ?? running, task.id, {
						status: "failed",
						agent: chainLabel,
						error: `${agent.name} failed before completion: ${error instanceof Error ? error.message : String(error)}`,
					});
					saveState(ctx, { ...failed, phase: nextPhaseAfterDispatch(failed) });
					ctx.ui.notify(`Coordinator chain failed at ${agent.name}.`, "error");
					return;
				}

				if (result.exitCode !== 0) {
					const failed = updateTask(state ?? running, task.id, {
						status: "failed",
						agent: chainLabel,
						error: `${agent.name} failed: ${formatSubagentFailure(result)}`,
					});
					saveState(ctx, { ...failed, phase: nextPhaseAfterDispatch(failed) });
					ctx.ui.notify(`Coordinator chain failed at ${agent.name}.`, "error");
					return;
				}

				previousOutput = summarizeSubagentResult(result);
			}

			const done = updateTask(state ?? running, task.id, {
				status: "done",
				agent: chainLabel,
				resultSummary: previousOutput || "Coordinator chain completed without text output.",
				error: undefined,
			});
			saveState(ctx, { ...done, phase: nextPhaseAfterDispatch(done) });
			ctx.ui.notify(`Coordinator task #${task.id} completed through ${chainLabel}.`, "info");
		},
	});

	pi.registerCommand("coordinate-dispatch-many", {
		description: "Dispatch several todo coordinator tasks to one agent with conservative concurrency",
		handler: async (args, ctx) => {
			if (!state) {
				ctx.ui.notify("No coordinator is active. Run /coordinate-start <goal> first.", "error");
				return;
			}

			const parsed = parseParallelDispatchCommand(args);
			if (!parsed) {
				ctx.ui.notify(`Usage: /coordinate-dispatch-many <agent> [count<=${PARALLEL_DISPATCH_TASK_LIMIT}] [--project|--both]`, "error");
				return;
			}

			const ok = await confirmProjectAgentUse(ctx, ctx.cwd, parsed.scope);
			if (!ok) {
				ctx.ui.notify("Project-local agent use was not confirmed.", "warning");
				return;
			}

			const agents = discoverAgents(ctx.cwd, parsed.scope);
			const agent = agents.find((item) => item.name === parsed.agent);
			if (!agent) {
				const available = agents.map((item) => `${item.name} (${item.source})`).sort().join(", ") || "none";
				ctx.ui.notify(`Unknown agent: ${parsed.agent}. Available agents for scope ${parsed.scope}: ${available}.`, "error");
				return;
			}

			const tasks = state.tasks.filter((task) => task.status === "todo").slice(0, parsed.count);
			if (tasks.length === 0) {
				ctx.ui.notify("No todo coordinator tasks are available for parallel dispatch.", "warning");
				return;
			}

			let running = state;
			for (const task of tasks) {
				running = updateTask(running, task.id, { status: "running", agent: agent.name, error: undefined, resultSummary: undefined });
			}
			saveState(ctx, { ...running, phase: "dispatching" });
			ctx.ui.notify(`Dispatching ${tasks.length} task(s) to ${agent.name} with concurrency ${PARALLEL_DISPATCH_CONCURRENCY}.`, "info");

			await runWithConcurrency(tasks, PARALLEL_DISPATCH_CONCURRENCY, async (task) => {
				let patch: Partial<CoordinatorTask>;
				try {
					const result = await runSubagent(agent, task.text, ctx.cwd, undefined);
					patch =
						result.exitCode === 0
							? { status: "done", agent: agent.name, resultSummary: summarizeSubagentResult(result), error: undefined }
							: { status: "failed", agent: agent.name, error: formatSubagentFailure(result) };
				} catch (error) {
					patch = { status: "failed", agent: agent.name, error: error instanceof Error ? error.message : String(error) };
				}

				const next = updateTask(state ?? running, task.id, patch);
				saveState(ctx, { ...next, phase: nextPhaseAfterDispatch(next) });
			});

			const counts = state ? countTasks(state) : countTasks(running);
			ctx.ui.notify(`Parallel dispatch complete: ${counts.done} done, ${counts.failed} failed, ${counts.todo} todo remaining.`, "info");
		},
	});

	pi.registerCommand("coordinate-done", {
		description: "Mark a coordinator task done",
		handler: async (args, ctx) => {
			if (!state) {
				ctx.ui.notify("No coordinator is active. Run /coordinate-start <goal> first.", "error");
				return;
			}

			const parsed = parseTaskCommand(args, state.currentTaskId);
			if (!parsed.id) {
				ctx.ui.notify("Usage: /coordinate-done [task-id] [summary]. No current task is selected.", "error");
				return;
			}

			const task = state.tasks.find((item) => item.id === parsed.id);
			if (!task) {
				ctx.ui.notify(`Coordinator task #${parsed.id} not found.`, "error");
				return;
			}

			saveState(ctx, updateTask(state, parsed.id, { status: "done", resultSummary: parsed.rest || task.resultSummary }));
			ctx.ui.notify(`Marked coordinator task #${parsed.id} done.`, "info");
		},
	});

	pi.registerCommand("coordinate-block", {
		description: "Mark a coordinator task blocked",
		handler: async (args, ctx) => {
			if (!state) {
				ctx.ui.notify("No coordinator is active. Run /coordinate-start <goal> first.", "error");
				return;
			}

			const parsed = parseTaskCommand(args, state.currentTaskId);
			if (!parsed.id || !parsed.rest) {
				ctx.ui.notify("Usage: /coordinate-block [task-id] <reason>", "error");
				return;
			}

			const task = state.tasks.find((item) => item.id === parsed.id);
			if (!task) {
				ctx.ui.notify(`Coordinator task #${parsed.id} not found.`, "error");
				return;
			}

			saveState(ctx, updateTask(state, parsed.id, { status: "blocked", error: parsed.rest }));
			ctx.ui.notify(`Marked coordinator task #${parsed.id} blocked.`, "warning");
		},
	});

	pi.registerCommand("coordinate-reset", {
		description: "Clear the current coordinator workflow state",
		handler: async (_args, ctx) => {
			if (!state) {
				ctx.ui.notify("No coordinator is active.", "info");
				return;
			}

			if (ctx.hasUI) {
				const ok = await ctx.ui.confirm("Reset coordinator?", "This clears the current coordinator goal and task state.");
				if (!ok) return;
			}

			saveState(ctx, undefined);
			ctx.ui.notify("Coordinator reset.", "info");
		},
	});

	pi.registerCommand("agents", {
		description: "List available coordinator/subagent definitions",
		handler: async (args, ctx) => {
			const scope = parseAgentScope(args.trim());
			const ok = await confirmProjectAgentUse(ctx, ctx.cwd, scope);
			if (!ok) {
				ctx.ui.notify("Project-local agent listing was not confirmed.", "warning");
				return;
			}
			ctx.ui.notify(formatAgentList(discoverAgents(ctx.cwd, scope), scope), "info");
		},
	});
}

function discoverUserAgents(): AgentConfig[] {
	return loadAgentsFromDir(path.join(getAgentDir(), "agents"), "user");
}

function discoverAgents(cwd: string, scope: AgentScope): AgentConfig[] {
	const userAgents = scope === "project" ? [] : discoverUserAgents();
	const projectDir = findNearestProjectAgentsDir(cwd);
	const projectAgents = scope === "user" || !projectDir ? [] : loadAgentsFromDir(projectDir, "project");
	const agents = new Map<string, AgentConfig>();

	for (const agent of userAgents) agents.set(agent.name, agent);
	for (const agent of projectAgents) agents.set(agent.name, agent);
	return [...agents.values()];
}

function findNearestProjectAgentsDir(cwd: string): string | undefined {
	let current = cwd;
	while (true) {
		const candidate = path.join(current, CONFIG_DIR_NAME, "agents");
		try {
			if (fs.statSync(candidate).isDirectory()) return candidate;
		} catch {
			// Keep walking upward.
		}

		const parent = path.dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

function loadAgentsFromDir(dir: string, source: AgentSource): AgentConfig[] {
	const agents: AgentConfig[] = [];
	let entries: fs.Dirent[];

	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		let parsed: { frontmatter: AgentFrontmatter; body: string };
		try {
			parsed = parseFrontmatter<AgentFrontmatter>(content);
		} catch {
			continue;
		}

		const { frontmatter, body } = parsed;
		if (typeof frontmatter.name !== "string" || typeof frontmatter.description !== "string") continue;

		agents.push({
			name: frontmatter.name,
			description: frontmatter.description,
			tools: parseToolList(frontmatter.tools),
			model: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
			systemPrompt: body,
			source,
			filePath,
		});
	}

	return agents;
}

function parseToolList(value: unknown): string[] | undefined {
	const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
	const tools = raw
		.filter((tool): tool is string => typeof tool === "string")
		.map((tool) => tool.trim())
		.filter(Boolean);
	return tools.length > 0 ? tools : undefined;
}

function formatAgentList(agents: AgentConfig[], scope: AgentScope = "user"): string {
	if (agents.length === 0) return `No agents found for scope ${scope}. User agents live under ~/.pi/agent/agents/*.md; project agents live under .pi/agents/*.md.`;

	const lines = [`Discovered ${agents.length} agent${agents.length === 1 ? "" : "s"} for scope ${scope}:`];
	for (const agent of agents.sort((a, b) => a.name.localeCompare(b.name))) {
		lines.push(
			[
				`- ${agent.name}`,
				`source: ${agent.source}`,
				`tools: ${agent.tools?.join(", ") ?? "default"}`,
				`model: ${agent.model ?? "default"}`,
				`description: ${agent.description}`,
			].join(" | "),
		);
	}
	return lines.join("\n");
}

async function runSubagent(
	agent: AgentConfig,
	task: string,
	cwd: string,
	signal: AbortSignal | undefined,
): Promise<SubagentResult> {
	const args = ["--mode", "json", "-p", "--no-session"];
	if (agent.model) args.push("--model", agent.model);
	if (agent.tools && agent.tools.length > 0) args.push("--tools", agent.tools.join(","));

	let tmpPromptDir: string | undefined;
	try {
		if (agent.systemPrompt.trim()) {
			const tmp = await writeSystemPromptToTempFile(agent);
			tmpPromptDir = tmp.dir;
			args.push("--append-system-prompt", tmp.filePath);
		}
		args.push(`Task: ${task}`);

		return await spawnPiSubprocess(agent.name, task, args, cwd, signal);
	} finally {
		if (tmpPromptDir) {
			try {
				fs.rmSync(tmpPromptDir, { recursive: true, force: true });
			} catch {
				// Ignore cleanup errors.
			}
		}
	}
}

async function writeSystemPromptToTempFile(agent: AgentConfig): Promise<{ dir: string; filePath: string }> {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
	try {
		await fs.promises.chmod(dir, 0o700);
		const safeName = agent.name.replace(/[^\w.-]+/g, "_");
		const filePath = path.join(dir, `prompt-${safeName}.md`);
		await fs.promises.writeFile(filePath, agent.systemPrompt, { encoding: "utf-8", mode: 0o600, flag: "wx" });
		await fs.promises.chmod(filePath, 0o600);
		return { dir, filePath };
	} catch (error) {
		await fs.promises.rm(dir, { recursive: true, force: true });
		throw error;
	}
}

async function spawnPiSubprocess(
	agentName: string,
	task: string,
	args: string[],
	cwd: string,
	signal: AbortSignal | undefined,
): Promise<SubagentResult> {
	return new Promise((resolve) => {
		const invocation = getPiInvocation(args);
		const proc = spawn(invocation.command, invocation.args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		let buffer = "";
		let output = "";
		let aborted = false;
		let settled = false;
		let killTimer: NodeJS.Timeout | undefined;

		const appendCapped = (current: string, chunk: string, cap: number) => {
			const next = current + chunk;
			return next.length <= cap ? next : next.slice(next.length - cap);
		};

		const processLine = (line: string) => {
			if (!line.trim()) return;
			let event: any;
			try {
				event = JSON.parse(line);
			} catch {
				return;
			}

			if (event.type === "message_end" && event.message?.role === "assistant") {
				const text = truncateText(extractMessageText(event.message), SUBAGENT_OUTPUT_CAP);
				if (text) output = text;
			}
		};

		const abort = () => {
			aborted = true;
			proc.kill("SIGTERM");
			killTimer = setTimeout(() => {
				if (proc.exitCode === null) proc.kill("SIGKILL");
			}, SUBAGENT_ABORT_KILL_DELAY_MS);
		};

		const finish = (result: SubagentResult) => {
			if (settled) return;
			settled = true;
			if (killTimer) clearTimeout(killTimer);
			if (signal) signal.removeEventListener("abort", abort);
			resolve(result);
		};

		proc.stdout.on("data", (data) => {
			const chunk = data.toString();
			stdout = appendCapped(stdout, chunk, SUBAGENT_OUTPUT_CAP);
			buffer = appendCapped(buffer, chunk, SUBAGENT_OUTPUT_CAP);
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) processLine(line);
		});

		proc.stderr.on("data", (data) => {
			stderr = appendCapped(stderr, data.toString(), SUBAGENT_STDERR_CAP);
		});

		proc.on("close", (code, closeSignal) => {
			if (buffer.trim()) processLine(buffer);
			finish({
				agent: agentName,
				task,
				exitCode: aborted ? 130 : code ?? 1,
				output: truncateText(output || stdout.trim(), SUBAGENT_OUTPUT_CAP),
				stderr: truncateText(formatProcessStderr(stderr, closeSignal, aborted), SUBAGENT_STDERR_CAP),
			});
		});

		proc.on("error", (error) => {
			finish({ agent: agentName, task, exitCode: 1, output: "", stderr: `Failed to start pi subprocess: ${error.message}` });
		});

		if (signal) {
			if (signal.aborted) abort();
			else signal.addEventListener("abort", abort, { once: true });
		}
	});
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

function formatSubagentFailure(result: SubagentResult): string {
	const parts = [`Subagent ${result.agent} failed with exit code ${result.exitCode}.`];
	if (result.stderr) parts.push(`stderr: ${result.stderr}`);
	if (result.output) parts.push(`output: ${truncateText(result.output, 2048)}`);
	return parts.join("\n");
}

function formatProcessStderr(stderr: string, closeSignal: NodeJS.Signals | null, aborted: boolean): string {
	const parts = [];
	if (aborted) parts.push("Subagent aborted by caller.");
	if (closeSignal) parts.push(`Subprocess terminated by signal ${closeSignal}.`);
	if (stderr.trim()) parts.push(stderr.trim());
	return parts.join("\n");
}

function truncateText(text: string, cap: number): string {
	if (text.length <= cap) return text;
	return `${text.slice(0, cap)}\n...[truncated ${text.length - cap} bytes]`;
}

function extractMessageText(message: any): string {
	const content = message.content;
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (typeof part === "string") return part;
			if (part && typeof part === "object" && typeof part.text === "string") return part.text;
			return "";
		})
		.join("\n")
		.trim();
}

function normalizeState(data: unknown): CoordinatorState | undefined {
	if (!data || typeof data !== "object") return undefined;
	const raw = data as Partial<CoordinatorState>;
	if (typeof raw.goal !== "string" || !Array.isArray(raw.tasks)) return undefined;

	const now = Date.now();
	const tasks = raw.tasks
		.filter((task): task is Partial<CoordinatorTask> => task !== null && typeof task === "object")
		.filter((task) => typeof task.id === "number" && typeof task.text === "string" && isTaskStatus(task.status))
		.map((task): CoordinatorTask => {
			const createdAt = typeof task.createdAt === "number" ? task.createdAt : now;
			return {
				id: task.id!,
				text: task.text!,
				status: task.status!,
				agent: typeof task.agent === "string" ? task.agent : undefined,
				resultSummary: typeof task.resultSummary === "string" ? task.resultSummary : undefined,
				error: typeof task.error === "string" ? task.error : undefined,
				createdAt,
				updatedAt: typeof task.updatedAt === "number" ? task.updatedAt : createdAt,
			};
		});

	const maxId = tasks.reduce((max, task) => Math.max(max, task.id), 0);
	return {
		goal: raw.goal,
		phase: isPhase(raw.phase) ? raw.phase : "planning",
		tasks,
		currentTaskId: typeof raw.currentTaskId === "number" ? raw.currentTaskId : undefined,
		nextTaskId: typeof raw.nextTaskId === "number" ? raw.nextTaskId : maxId + 1,
		createdAt: typeof raw.createdAt === "number" ? raw.createdAt : now,
		updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : now,
	};
}

function updateTask(state: CoordinatorState, id: number, patch: Partial<CoordinatorTask>): CoordinatorState {
	const now = Date.now();
	const status = patch.status;
	return {
		...state,
		currentTaskId: status === "running" ? id : state.currentTaskId === id ? undefined : state.currentTaskId,
		tasks: state.tasks.map((task) => (task.id === id ? { ...task, ...patch, updatedAt: now } : task)),
		updatedAt: now,
	};
}

function parseTaskCommand(args: string, defaultId: number | undefined): { id: number | undefined; rest: string } {
	const trimmed = args.trim();
	if (!trimmed) return { id: defaultId, rest: "" };

	const match = trimmed.match(/^(?:#)?(\d+)(?:\s+(.*))?$/);
	if (match) return { id: Number(match[1]), rest: match[2]?.trim() ?? "" };

	return { id: defaultId, rest: trimmed };
}

function parseDispatchCommand(args: string): { id: number; agent: string; scope: AgentScope } | undefined {
	const parts = args.trim().split(/\s+/).filter(Boolean);
	if (parts.length < 2 || parts.length > 3) return undefined;
	const idMatch = parts[0]!.match(/^(?:#)?(\d+)$/);
	if (!idMatch) return undefined;
	if (parts[2] && !isAgentScopeArg(parts[2])) return undefined;
	const scope = parts[2] ? parseAgentScope(parts[2]) : "user";
	return { id: Number(idMatch[1]), agent: parts[1]!, scope };
}

function parseChainCommand(args: string): { id: number; chain: string[]; scope: AgentScope } | undefined {
	const parts = args.trim().split(/\s+/).filter(Boolean);
	if (parts.length < 3 || parts.length > 5) return undefined;

	const idMatch = parts[0]!.match(/^(?:#)?(\d+)$/);
	if (!idMatch) return undefined;

	let scope: AgentScope = "user";
	let chain = parts.slice(1);
	const last = chain[chain.length - 1];
	if (last && isAgentScopeArg(last)) {
		scope = parseAgentScope(last);
		chain = chain.slice(0, -1);
	}

	if (!isAllowedAgentChain(chain)) return undefined;
	return { id: Number(idMatch[1]), chain, scope };
}

function isAllowedAgentChain(chain: string[]): boolean {
	return ALLOWED_AGENT_CHAINS.some((allowed) => allowed.length === chain.length && allowed.every((agent, index) => agent === chain[index]));
}

function formatChainedTaskPrompt(taskText: string, previousOutput: string, stepIndex: number): string {
	if (stepIndex === 0 || !previousOutput.trim()) return taskText;
	return `${taskText}\n\nPrevious chain output:\n${previousOutput}`;
}

function parseParallelDispatchCommand(args: string): { agent: string; count: number; scope: AgentScope } | undefined {
	const parts = args.trim().split(/\s+/).filter(Boolean);
	if (parts.length < 1 || parts.length > 3) return undefined;

	let count = PARALLEL_DISPATCH_TASK_LIMIT;
	let scope: AgentScope = "user";
	for (const part of parts.slice(1)) {
		if (/^\d+$/.test(part)) count = Number(part);
		else if (isAgentScopeArg(part)) scope = parseAgentScope(part);
		else return undefined;
	}

	if (count < 1 || count > PARALLEL_DISPATCH_TASK_LIMIT) return undefined;
	return { agent: parts[0]!, count, scope };
}

async function runWithConcurrency<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
	let index = 0;
	const workerCount = Math.min(concurrency, items.length);
	await Promise.all(
		Array.from({ length: workerCount }, async () => {
			while (true) {
				const item = items[index++];
				if (item === undefined) return;
				await fn(item);
			}
		}),
	);
}

function isAgentScopeArg(value: string): boolean {
	return ["user", "--user", "project", "--project", "both", "--both"].includes(value);
}

function parseAgentScope(value: string): AgentScope {
	switch (value) {
		case "project":
		case "--project":
			return "project";
		case "both":
		case "--both":
			return "both";
		default:
			return "user";
	}
}

async function confirmProjectAgentUse(ctx: ExtensionContext, cwd: string, scope: AgentScope): Promise<boolean> {
	if (scope === "user") return true;
	const dir = findNearestProjectAgentsDir(cwd) ?? path.join(cwd, CONFIG_DIR_NAME, "agents");
	if (!ctx.hasUI) return false;
	return ctx.ui.confirm(
		"Trust project-local agents?",
		`This will load agent definitions from ${dir}. Only continue if you trust this repository's .pi/agents/*.md files.`,
	);
}

function summarizeSubagentResult(result: SubagentResult): string {
	return truncateText(result.output.trim() || "Subagent completed without text output.", 2048);
}

function nextPhaseAfterDispatch(state: CoordinatorState): CoordinatorPhase {
	if (state.tasks.some((task) => task.status === "running")) return "dispatching";
	if (state.tasks.some((task) => task.status === "todo" || task.status === "blocked")) return "ready";
	return "reviewing";
}

function isPhase(value: unknown): value is CoordinatorPhase {
	return ["planning", "ready", "dispatching", "reviewing", "done"].includes(String(value));
}

function isTaskStatus(value: unknown): value is CoordinatorTaskStatus {
	return ["todo", "running", "done", "failed", "blocked"].includes(String(value));
}

function formatStatus(state: CoordinatorState): string {
	const counts = countTasks(state);
	const current = state.currentTaskId ? state.tasks.find((task) => task.id === state.currentTaskId) : undefined;
	const assignedAgents = [...new Set(state.tasks.map((task) => task.agent).filter((agent): agent is string => Boolean(agent)))].sort();
	const recentResults = state.tasks.filter((task) => task.resultSummary).slice(-3);
	const failures = state.tasks.filter((task) => task.status === "failed" || task.error).slice(-3);

	const lines = [
		`Coordinator ${state.phase}: ${state.goal}`,
		`Tasks: ${counts.todo} todo, ${counts.running} running, ${counts.done} done, ${counts.failed} failed, ${counts.blocked} blocked`,
		`Active: ${current ? formatTaskLine(current) : "none"}`,
		`Assigned agents: ${assignedAgents.length > 0 ? assignedAgents.join(", ") : "none"}`,
	];

	lines.push("Latest results:");
	if (recentResults.length === 0) lines.push("- none");
	else recentResults.forEach((task) => lines.push(`- #${task.id}${task.agent ? ` @${task.agent}` : ""}: ${truncateText(task.resultSummary ?? "", 240)}`));

	lines.push("Failures / blockers:");
	if (failures.length === 0) lines.push("- none");
	else failures.forEach((task) => lines.push(`- #${task.id} [${task.status}]${task.agent ? ` @${task.agent}` : ""}: ${truncateText(task.error ?? "", 240)}`));

	lines.push("Recent tasks:");
	for (const task of state.tasks.slice(-10)) lines.push(formatTaskLine(task));
	if (state.tasks.length > 10) lines.push(`... ${state.tasks.length - 10} earlier task(s) omitted`);

	lines.push(`Next: ${suggestNextAction(state)}`);
	return lines.join("\n");
}

function formatTaskLine(task: CoordinatorTask): string {
	const detail = task.resultSummary ?? task.error;
	return `#${task.id} [${task.status}]${task.agent ? ` @${task.agent}` : ""} ${task.text}${detail ? ` — ${truncateText(detail, 160)}` : ""}`;
}

function suggestNextAction(state: CoordinatorState): string {
	const running = state.tasks.find((task) => task.status === "running");
	if (running) return `wait for #${running.id} or inspect its subprocess result`;

	const failed = state.tasks.find((task) => task.status === "failed");
	if (failed) return `review failure on #${failed.id}, then retry with /coordinate-dispatch ${failed.id} <agent> or block it`;

	const todo = state.tasks.find((task) => task.status === "todo");
	if (todo) return `dispatch #${todo.id} with /coordinate-dispatch ${todo.id} <agent>`;

	const blocked = state.tasks.find((task) => task.status === "blocked");
	if (blocked) return `resolve blocker on #${blocked.id} or add follow-up tasks`;

	if (state.tasks.length === 0) return "add tasks with /coordinate-add <task>";
	return "review completed results or run /coordinate-reset when done";
}

function updateStatus(ctx: ExtensionContext, state: CoordinatorState | undefined): void {
	if (!ctx.hasUI) return;
	if (!state) {
		ctx.ui.setStatus("coordinator", undefined);
		return;
	}

	const counts = countTasks(state);
	ctx.ui.setStatus("coordinator", `coord: ${state.phase} ${counts.done}/${state.tasks.length}`);
}

function countTasks(state: CoordinatorState): Record<CoordinatorTaskStatus, number> {
	return state.tasks.reduce(
		(counts, task) => {
			counts[task.status] += 1;
			return counts;
		},
		{ todo: 0, running: 0, done: 0, failed: 0, blocked: 0 } as Record<CoordinatorTaskStatus, number>,
	);
}
