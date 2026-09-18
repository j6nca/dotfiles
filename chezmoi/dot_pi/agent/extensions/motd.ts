import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const CUSTOM_TYPE = "motd";

type MotdData = {
	workspace: string;
};

const LOGO = [
	"  █████████████████  ",
	"       ███    ███   ",
	"       ███    ███   ",
	"      ███     ███   ",
	"     ███      ███   ",
	"   ▄███       ███▄  ",
	"  ███▀         ▀███ ",
];

export default function (pi: ExtensionAPI) {
	let motdShownForSession = false;

	pi.registerEntryRenderer<MotdData>(CUSTOM_TYPE, (entry, _options, _theme) => {
		return new Text(renderMotd(entry.data?.workspace), 0, 0);
	});

	pi.on("session_start", async (event, ctx) => {
		if ((event.reason !== "startup" && event.reason !== "new") || ctx.mode !== "tui" || motdShownForSession) return;
		motdShownForSession = true;
		setMotdHeader(ctx, await resolveWorkspace(pi, ctx.cwd));
	});

	pi.registerCommand("motd", {
		description: "Print the Pi message-of-the-day",
		handler: async (_args, ctx) => {
			appendMotd(pi, await resolveWorkspace(pi, ctx.cwd));
		},
	});
}

function appendMotd(pi: ExtensionAPI, workspace: string): void {
	pi.appendEntry<MotdData>(CUSTOM_TYPE, { workspace });
}

function setMotdHeader(ctx: ExtensionContext | ExtensionCommandContext, workspace: string): void {
	ctx.ui.setHeader((_tui, _theme) => ({
		render(width: number): string[] {
			return renderMotdLines(workspace, width);
		},
		invalidate() {},
	}));
}

function renderMotd(workspace = "Working directory: unknown"): string {
	return renderMotdLines(workspace).join("\n");
}

function renderMotdLines(workspace: string, width?: number): string[] {
	const logoWidth = Math.max(...LOGO.map((line) => line.length));
	const padding = width === undefined ? "" : " ".repeat(Math.max(0, Math.floor((width - logoWidth) / 2)));
	const workspacePadding = width === undefined ? "" : " ".repeat(Math.max(0, Math.floor((width - visibleLength(workspace)) / 2)));
	return ["", ...LOGO.map((line, row) => padding + gradientLogoLine(line, row)), "", workspacePadding + workspace, ""];
}

async function resolveWorkspace(pi: ExtensionAPI, cwd: string): Promise<string> {
	const remote = await pi.exec("git", ["remote", "get-url", "origin"], { cwd, timeout: 5_000 });
	if (remote.code === 0) {
		const repo = parseGitHubRepo(remote.stdout.trim());
		if (repo) return `GitHub: ${repo}`;
	}

	const root = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 5_000 });
	return root.code === 0 ? `Repository: ${root.stdout.trim()}` : `Working directory: ${cwd}`;
}

function parseGitHubRepo(remoteUrl: string): string | undefined {
	const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);
	if (sshMatch) return sshMatch[1];

	const httpsMatch = remoteUrl.match(/^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
	if (httpsMatch) return httpsMatch[1];

	return undefined;
}

function visibleLength(text: string): number {
	return [...text].length;
}

function gradientLogoLine(line: string, row: number): string {
	const stops = [
		[124, 77, 255],
		[43, 134, 255],
		[0, 214, 201],
	] as const;
	const chars = [...line];
	return chars
		.map((char, col) => {
			if (char === " ") return char;
			const t = chars.length <= 1 ? 0 : (col + row * 0.45) / (chars.length - 1 + LOGO.length * 0.45);
			const [r, g, b] = interpolateStops(stops, t);
			return `\u001b[38;2;${r};${g};${b}m${char}\u001b[0m`;
		})
		.join("");
}

function interpolateStops(stops: readonly (readonly [number, number, number])[], t: number): [number, number, number] {
	const clamped = Math.max(0, Math.min(1, t));
	const scaled = clamped * (stops.length - 1);
	const index = Math.min(stops.length - 2, Math.floor(scaled));
	const local = scaled - index;
	const start = stops[index]!;
	const end = stops[index + 1]!;
	return [
		Math.round(start[0] + (end[0] - start[0]) * local),
		Math.round(start[1] + (end[1] - start[1]) * local),
		Math.round(start[2] + (end[2] - start[2]) * local),
	];
}
