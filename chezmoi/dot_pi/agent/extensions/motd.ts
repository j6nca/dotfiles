import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const CUSTOM_TYPE = "motd";

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

	pi.registerEntryRenderer(CUSTOM_TYPE, (_entry, _options, _theme) => {
		return new Text(renderLogo(), 0, 0);
	});

	pi.on("session_start", async (event, ctx) => {
		if ((event.reason !== "startup" && event.reason !== "new") || ctx.mode !== "tui" || motdShownForSession) return;
		motdShownForSession = true;
		setMotdHeader(ctx);
	});

	pi.registerCommand("motd", {
		description: "Print the Pi message-of-the-day logo",
		handler: async () => {
			appendMotd(pi);
		},
	});
}

function appendMotd(pi: ExtensionAPI): void {
	pi.appendEntry(CUSTOM_TYPE, { timestamp: Date.now() });
}

function setMotdHeader(ctx: ExtensionContext | ExtensionCommandContext): void {
	ctx.ui.setHeader((_tui, _theme) => ({
		render(width: number): string[] {
			return renderLogoLines(width);
		},
		invalidate() {},
	}));
}

function renderLogo(): string {
	return renderLogoLines().join("\n");
}

function renderLogoLines(width?: number): string[] {
	const logoWidth = Math.max(...LOGO.map((line) => line.length));
	const padding = width === undefined ? "" : " ".repeat(Math.max(0, Math.floor((width - logoWidth) / 2)));
	return ["", ...LOGO.map((line, row) => padding + gradientLogoLine(line, row)), ""];
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
