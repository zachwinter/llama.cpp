// Cliff harness: reproduces "silky smooth -> choppy in one tool invocation".
//
// Each scenario streams two phases in ONE run: phase A before an injected
// event (completed tool call with parameterized result size, expand, turn
// crossing), phase B after. The B/A mean ratio is the verdict: ~1.0 denies
// the hypothesis, >>1 confirms it. See tests/client/README-perf.md.
//
// Unlike agentic-stream.perf.svelte.test.ts, tokens are applied by mutating
// message fields in place, matching conversations.svelte.ts
// updateMessageAtIndex - the message object identity is stable per chunk.
//
// Run: npx vitest --project=client --run tests/client/agentic-cliff.perf.svelte.test.ts --reporter=verbose

import { describe, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import AgenticPerfWrapper from './components/AgenticPerfWrapper.svelte';
import ChatMessagesPerfWrapper from './components/ChatMessagesPerfWrapper.svelte';
import { perfState } from './components/agentic-perf-state.svelte';
import { conversationsStore } from '$lib/stores/conversations.svelte';
import type { DatabaseMessage } from '$lib/types';
import { MessageRole } from '$lib/enums';

const CHUNK = 'The quick brown fox jumps over the lazy dog. ';
const PHASE_TOKENS = 40;

let msgSeq = 0;

function baseMessage(overrides: Partial<DatabaseMessage>): DatabaseMessage {
	return {
		id: `m${msgSeq++}`,
		convId: 'cliff-conv',
		type: 'text',
		timestamp: 0,
		role: MessageRole.ASSISTANT,
		content: '',
		parent: null,
		children: [],
		...overrides
	} as DatabaseMessage;
}

function blob(bytes: number, seed: string): string {
	const line = `${seed} output line with some representative width to it`;
	const n = Math.max(1, Math.ceil(bytes / (line.length + 1)));
	const out: string[] = [];
	for (let i = 0; i < n; i++) out.push(`${line} ${i}`);
	return out.join('\n');
}

function nextFrame(): Promise<void> {
	return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

interface PhaseStats {
	tokens: number;
	mean: number;
	p95: number;
	max: number;
}

function toStats(durations: number[]): PhaseStats {
	const sorted = [...durations].sort((a, b) => a - b);
	const total = sorted.reduce((a, b) => a + b, 0);
	return {
		tokens: sorted.length,
		mean: total / sorted.length,
		p95: sorted[Math.floor(sorted.length * 0.95)],
		max: sorted[sorted.length - 1]
	};
}

interface Row {
	label: string;
	a: PhaseStats | null;
	b: PhaseStats;
	/** b.mean / a.mean; filled across rows for cross-run scenarios (S5). */
	ratio: number | null;
}

const rows: Row[] = [];

/** Streams `tokens` chunks through `write`, measuring the sync window each. */
async function streamTokens(write: (acc: string) => void, tokens: number): Promise<number[]> {
	let acc = '';
	const durations: number[] = [];

	for (let i = 0; i < tokens; i++) {
		acc += CHUNK;

		const t0 = performance.now();
		write(acc);
		await tick();
		void document.body.offsetHeight;
		durations.push(performance.now() - t0);

		await nextFrame();
	}

	return durations;
}

/** Appends a completed tool call + its result message to the live fixture. */
function injectCompletedToolCall(name: string, args: string, result: string) {
	const message = perfState.message!;
	const calls: unknown[] = message.toolCalls ? JSON.parse(message.toolCalls) : [];
	const id = `call_${calls.length}`;

	calls.push({ id, type: 'function', function: { name, arguments: args } });
	message.toolCalls = JSON.stringify(calls);

	perfState.toolMessages.push(
		baseMessage({ role: MessageRole.TOOL, toolCallId: id, content: result })
	);
}

/**
 * Two phases around `event`, both streaming into the same message subtree.
 * `phaseBWrite` overrides where phase B tokens land (default: same content
 * field as phase A).
 */
async function measureCliff(
	label: string,
	event: () => Promise<void> | void,
	phaseBWrite?: (acc: string) => void
) {
	perfState.message = baseMessage({});
	perfState.toolMessages = [];
	perfState.isStreaming = true;

	const { unmount } = render(AgenticPerfWrapper);
	await tick();

	const writeContent = (acc: string) => {
		perfState.message!.content = acc;
	};

	const aDurations = await streamTokens(writeContent, PHASE_TOKENS);

	await event();
	await tick();
	await nextFrame();

	const bDurations = await streamTokens(phaseBWrite ?? writeContent, PHASE_TOKENS);

	await nextFrame();
	await nextFrame();
	await unmount();

	const a = toStats(aDurations);
	const b = toStats(bDurations);
	rows.push({ label, a, b, ratio: b.mean / a.mean });
}

/**
 * S5: conversation-level. No in-run event - the "before" is a sibling run
 * with a small prior result; ratio is filled across the pair in the matrix.
 */
async function measureFanout(label: string, priorResultBytes: number): Promise<PhaseStats> {
	const callId = `prior_${msgSeq}`;
	const history: DatabaseMessage[] = [
		baseMessage({ role: MessageRole.USER, content: 'Run the tool.' }),
		baseMessage({
			role: MessageRole.ASSISTANT,
			content: 'Running it.',
			toolCalls: JSON.stringify([
				{
					id: callId,
					type: 'function',
					function: {
						name: 'exec_shell_command',
						arguments: JSON.stringify({ command: 'cat big_file.txt' })
					}
				}
			])
		}),
		baseMessage({
			role: MessageRole.TOOL,
			toolCallId: callId,
			content: `${blob(priorResultBytes, 'prior')}\n[exit code: 0]`
		}),
		baseMessage({ role: MessageRole.USER, content: 'Now summarize.' })
	];

	const streaming = baseMessage({ role: MessageRole.ASSISTANT, content: '' });
	history.push(streaming);

	conversationsStore.activeMessages = history;

	const { unmount } = render(ChatMessagesPerfWrapper);
	await tick();

	const idx = conversationsStore.findMessageIndex(streaming.id);
	const durations = await streamTokens(
		(acc) => conversationsStore.updateMessageAtIndex(idx, { content: acc }),
		PHASE_TOKENS
	);

	await nextFrame();
	await nextFrame();
	await unmount();
	conversationsStore.activeMessages = [];

	const b = toStats(durations);
	rows.push({ label, a: null, b, ratio: null });
	return b;
}

function report() {
	const pad = (s: string, n: number) => s.padEnd(n);
	const num = (n: number) => n.toFixed(2).padStart(8);

	const header = `${pad('scenario', 44)}${'A mean'.padStart(8)}${'A p95'.padStart(8)}${'B mean'.padStart(8)}${'B p95'.padStart(8)}${'B max'.padStart(8)}${'B/A'.padStart(7)}`;
	const lines = [
		'',
		'=== Cliff harness: per-token ms before (A) vs after (B) the event ===',
		'B/A ~1.0 denies the hypothesis; >>1 confirms it.',
		'S3: the crossing remount lands in the first B token - read B max.',
		'S5 rows have no in-run event; the ratio compares the 512KB row to',
		'its 1KB sibling.',
		'',
		header,
		'-'.repeat(header.length)
	];

	for (const r of rows) {
		lines.push(
			`${pad(r.label, 44)}${r.a ? num(r.a.mean) : ' '.repeat(8)}${r.a ? num(r.a.p95) : ' '.repeat(8)}${num(r.b.mean)}${num(r.b.p95)}${num(r.b.max)}${r.ratio ? r.ratio.toFixed(1).padStart(7) : ' '.repeat(7)}`
		);
	}

	lines.push('');
	console.log(lines.join('\n'));
}

// --- the matrix -----------------------------------------------------------

describe('agentic cliff perf', () => {
	it('locates the step change', { timeout: 600_000 }, async () => {
		// S1: completed exec call lands mid-stream, block stays collapsed.
		// Scaling of B/A with result size = the always-on tier (router-level
		// extractSearchResults scan + meta JSON.parse on every token).
		for (const kb of [1, 64, 512]) {
			await measureCliff(`S1 collapsed exec result ${kb}KB`, () => {
				injectCompletedToolCall(
					'exec_shell_command',
					JSON.stringify({ command: 'cat big_file.txt' }),
					`${blob(kb * 1024, 's1')}\n[exit code: 0]`
				);
			});
		}

		// S2: same as S1 @512KB but the block is expanded before phase B -
		// the state the auto-expand effect leaves a finished call in. Adds the
		// open-block tier (parseToolResultWithImages + large-DOM layout).
		await measureCliff('S2 expanded exec result 512KB', async () => {
			injectCompletedToolCall(
				'exec_shell_command',
				JSON.stringify({ command: 'cat big_file.txt' }),
				`${blob(512 * 1024, 's2')}\n[exit code: 0]`
			);
			await tick();

			const trigger = document.querySelector<HTMLElement>('button[data-slot="collapsible-trigger"]');
			if (!trigger) {
				throw new Error('S2: no collapsible trigger rendered - fixture is not exercising a tool block');
			}
			trigger.click();
			await tick();
		});

		// S3: turn crossing. A continuation assistant message appears and
		// phase B streams into it; the first B token flips turnGroups 1 -> 2,
		// swapping the whole subtree branch (remount cost shows in B max).
		{
			let continuation: DatabaseMessage;
			await measureCliff(
				'S3 turn crossing (small results)',
				() => {
					injectCompletedToolCall(
						'exec_shell_command',
						JSON.stringify({ command: 'ls' }),
						`${blob(1024, 's3')}\n[exit code: 0]`
					);
					perfState.toolMessages.push(
						baseMessage({ role: MessageRole.ASSISTANT, content: '' })
					);
					// Mutate through the $state proxy the array holds - writes to
					// the raw pushed object are invisible to reactivity.
					continuation = perfState.toolMessages[perfState.toolMessages.length - 1];
				},
				(acc) => {
					continuation.content = acc;
				}
			);
		}

		// S4: big ARGS, tiny result - write_file with the whole file embedded
		// in toolArgs. Isolates the JSON.parse-per-token paths from S1's
		// result-size paths.
		await measureCliff('S4 write_file args 256KB', () => {
			injectCompletedToolCall(
				'write_file',
				JSON.stringify({ path: '/src/generated.ts', content: blob(256 * 1024, 's4') }),
				JSON.stringify({ result: 'ok' })
			);
		});

		// S5: does the cliff outlive the tool turn's own message? A PRIOR
		// message holds the big result while a NEW message streams.
		const small = await measureFanout('S5 fan-out, prior result 1KB', 1024);
		const big = await measureFanout('S5 fan-out, prior result 512KB', 512 * 1024);
		rows[rows.length - 1].ratio = big.mean / small.mean;

		report();
	});
});
