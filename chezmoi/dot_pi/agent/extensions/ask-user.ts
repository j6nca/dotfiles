import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

interface AskOption {
	label: string;
	value?: string;
	description?: string;
}

interface AskQuestion {
	id?: string;
	question: string;
	details?: string;
	options?: AskOption[];
	allowCustom?: boolean;
	inputKind?: "short" | "long";
	defaultValue?: string;
	required?: boolean;
}

interface AskAnswer {
	id?: string;
	question: string;
	value: string | null;
	label?: string;
	wasCustom: boolean;
	cancelled: boolean;
	skipped: boolean;
}

interface AskResult {
	answers: AskAnswer[];
	cancelled: boolean;
}

const AskOptionSchema = Type.Object({
	label: Type.String({ description: "Human-readable option label shown to the user" }),
	value: Type.Optional(Type.String({ description: "Machine-readable value returned to the model; defaults to label" })),
	description: Type.Optional(Type.String({ description: "Optional extra context shown in the prompt" })),
});

const AskQuestionSchema = Type.Object({
	id: Type.Optional(Type.String({ description: "Stable identifier for this question, especially useful in ask_user_form" })),
	question: Type.String({ description: "Question to ask the user" }),
	details: Type.Optional(Type.String({ description: "Optional context explaining why this question is needed" })),
	options: Type.Optional(Type.Array(AskOptionSchema, { description: "Optional choices for the user" })),
	allowCustom: Type.Optional(Type.Boolean({ description: "Allow the user to type a custom answer when options are provided; defaults to true" })),
	inputKind: Type.Optional(StringEnum(["short", "long"] as const, { description: "Use short for one-line input, long for a multi-line editor; defaults to short" })),
	defaultValue: Type.Optional(Type.String({ description: "Optional prefilled value for freeform input" })),
	required: Type.Optional(Type.Boolean({ description: "Whether this answer is required; defaults to true" })),
});

export default function askUser(pi: ExtensionAPI) {
	pi.registerTool({
		name: "ask_user",
		label: "Ask User",
		description:
			"Ask the user one structured question using the UI. Use when clarification is needed before proceeding. Do not use for secrets or credentials.",
		promptSnippet: "Ask the user a structured clarification question with options or freeform input.",
		promptGuidelines: [
			"Use ask_user when a task has meaningful ambiguity and guessing could waste work or cause the wrong outcome.",
			"Prefer ask_user over making assumptions for product decisions, destructive actions, missing requirements, unclear scope, or user preferences.",
			"Do not use ask_user for secrets, passwords, API keys, tokens, or credentials; ask the user to provide those through their normal secret-management flow instead.",
			"Keep ask_user questions concise, provide sensible options when possible, and continue with the user's answer once provided.",
		],
		parameters: AskQuestionSchema,
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const answer = await askOne(ctx, params);
			return resultFor([answer]);
		},

		renderCall(args, theme) {
			const question = typeof args.question === "string" ? args.question : "question";
			return new Text(theme.fg("toolTitle", theme.bold("ask_user ")) + theme.fg("muted", question), 0, 0);
		},

		renderResult(result, _options, theme) {
			return new Text(renderAnswers(result.details as AskResult | undefined, theme), 0, 0);
		},
	});

	pi.registerTool({
		name: "ask_user_form",
		label: "Ask User Form",
		description:
			"Ask the user multiple structured questions in one flow. Use when several clarifications are needed before proceeding. Do not use for secrets or credentials.",
		promptSnippet: "Ask the user a short structured form with multiple questions.",
		promptGuidelines: [
			"Use ask_user_form when multiple related clarifications are needed before continuing, instead of asking a long unstructured chat question.",
			"Keep ask_user_form short; ask only questions that affect the next action or outcome.",
			"Do not use ask_user_form for secrets, passwords, API keys, tokens, or credentials.",
		],
		parameters: Type.Object({
			questions: Type.Array(AskQuestionSchema, { description: "Questions to ask the user, in order" }),
		}),
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (params.questions.length === 0) {
				return {
					content: [{ type: "text" as const, text: "No questions were provided." }],
					details: { answers: [], cancelled: true } satisfies AskResult,
				};
			}

			const answers: AskAnswer[] = [];
			for (const question of params.questions) {
				const answer = await askOne(ctx, question);
				answers.push(answer);
				if (answer.cancelled) break;
			}

			return resultFor(answers);
		},

		renderCall(args, theme) {
			const count = Array.isArray(args.questions) ? args.questions.length : 0;
			return new Text(
				theme.fg("toolTitle", theme.bold("ask_user_form ")) +
					theme.fg("muted", `${count} question${count === 1 ? "" : "s"}`),
				0,
				0,
			);
		},

		renderResult(result, _options, theme) {
			return new Text(renderAnswers(result.details as AskResult | undefined, theme), 0, 0);
		},
	});
}

async function askOne(ctx: ExtensionContext, question: AskQuestion): Promise<AskAnswer> {
	const required = question.required !== false;
	const options = question.options ?? [];
	const allowCustom = question.allowCustom !== false;

	if (!ctx.hasUI) {
		return {
			id: question.id,
			question: question.question,
			value: null,
			wasCustom: false,
			cancelled: true,
			skipped: false,
		};
	}

	if (options.length === 0) {
		const value = await askFreeform(ctx, question);
		if (value === undefined) return cancelledAnswer(question);
		if (!required && value.trim() === "") return skippedAnswer(question);
		return {
			id: question.id,
			question: question.question,
			value,
			label: value,
			wasCustom: true,
			cancelled: false,
			skipped: false,
		};
	}

	const choices = options.map((option, index) => `${index + 1}. ${option.label}`);
	if (allowCustom) choices.push("Type a custom answer");
	if (!required) choices.push("Skip this question");

	const choice = await ctx.ui.select(promptTitle(question), choices);
	if (choice === undefined) return cancelledAnswer(question);

	const optionIndex = choices.findIndex((item) => item === choice);
	if (optionIndex >= 0 && optionIndex < options.length) {
		const option = options[optionIndex]!;
		return {
			id: question.id,
			question: question.question,
			value: option.value ?? option.label,
			label: option.label,
			wasCustom: false,
			cancelled: false,
			skipped: false,
		};
	}

	if (choice === "Skip this question") return skippedAnswer(question);

	const value = await askFreeform(ctx, question);
	if (value === undefined) return cancelledAnswer(question);
	if (!required && value.trim() === "") return skippedAnswer(question);
	return {
		id: question.id,
		question: question.question,
		value,
		label: value,
		wasCustom: true,
		cancelled: false,
		skipped: false,
	};
}

async function askFreeform(ctx: ExtensionContext, question: AskQuestion): Promise<string | undefined> {
	const title = promptTitle(question);
	const initial = question.defaultValue ?? "";
	return question.inputKind === "long" ? ctx.ui.editor(title, initial) : ctx.ui.input(title, initial);
}

function promptTitle(question: AskQuestion): string {
	const parts = [question.question];
	if (question.details) parts.push("", question.details);
	const optionsWithDescriptions = (question.options ?? []).filter((option) => option.description);
	if (optionsWithDescriptions.length > 0) {
		parts.push(
			"",
			"Options:",
			...optionsWithDescriptions.map((option, index) => `${index + 1}. ${option.label}: ${option.description}`),
		);
	}
	return parts.join("\n");
}

function cancelledAnswer(question: AskQuestion): AskAnswer {
	return {
		id: question.id,
		question: question.question,
		value: null,
		wasCustom: false,
		cancelled: true,
		skipped: false,
	};
}

function skippedAnswer(question: AskQuestion): AskAnswer {
	return {
		id: question.id,
		question: question.question,
		value: null,
		wasCustom: false,
		cancelled: false,
		skipped: true,
	};
}

function resultFor(answers: AskAnswer[]) {
	const details: AskResult = { answers, cancelled: answers.some((answer) => answer.cancelled) };
	return {
		content: [{ type: "text" as const, text: summarizeForModel(details) }],
		details,
	};
}

function summarizeForModel(result: AskResult): string {
	if (result.answers.length === 0) return "No answers were collected.";
	return result.answers
		.map((answer) => {
			const key = answer.id ?? answer.question;
			if (answer.cancelled) return `${key}: user cancelled`;
			if (answer.skipped) return `${key}: skipped`;
			const prefix = answer.wasCustom ? "user wrote" : "user selected";
			return `${key}: ${prefix}: ${answer.value ?? ""}`;
		})
		.join("\n");
}

function renderAnswers(result: AskResult | undefined, theme: Theme): string {
	if (!result) return "No answer details.";
	if (result.answers.length === 0) return theme.fg("warning", "No answers collected");
	return result.answers
		.map((answer) => {
			const key = answer.id ?? answer.question;
			if (answer.cancelled) return `${theme.fg("warning", "✗")} ${theme.fg("muted", key)}: cancelled`;
			if (answer.skipped) return `${theme.fg("dim", "○")} ${theme.fg("muted", key)}: skipped`;
			const marker = answer.wasCustom ? "wrote" : "selected";
			return `${theme.fg("success", "✓")} ${theme.fg("muted", key)}: ${theme.fg("dim", `(${marker}) `)}${answer.value ?? ""}`;
		})
		.join("\n");
}
