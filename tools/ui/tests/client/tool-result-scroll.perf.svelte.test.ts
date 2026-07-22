// Scroll-weight harness for large EXPANDED tool results.
//
// Streaming cost of big results is fixed (see agentic-cliff.perf), but an
// expanded 512KB result is still ~10k line divs inside the terminal clamp.
// This measures whether that DOM weight actually janks scrolling - the open
// question behind "cap rendered lines vs virtualize vs do nothing".
//
// Per result size: the one-time expand hitch, the subtree node count, then
// scrollTop driven across the clamp over N animation frames recording
// frame-to-frame deltas (captures style+layout+paint, the thing the user
// feels) and the forced-layout probe cost per step (script-visible part).
// Compare rows against the smallest size, not against absolute numbers -
// the harness floor is one rAF (~16.7ms) per frame delta.
//
// Run: npx vitest --project=client --run tests/client/tool-result-scroll.perf.svelte.test.ts --reporter=verbose

import { describe, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import AgenticPerfWrapper from './components/AgenticPerfWrapper.svelte';
import { perfState } from './components/agentic-perf-state.svelte';
import type { DatabaseMessage } from '$lib/types';
import { MessageRole } from '$lib/enums';

const SCROLL_FRAMES = 60;

let msgSeq = 0;

function baseMessage(overrides: Partial<DatabaseMessage>): DatabaseMessage {
	return {
		id: `m${msgSeq++}`,
		convId: 'scroll-conv',
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

interface Row {
	label: string;
	nodes: number;
	expandMs: number;
	frameMean: number;
	frameP95: number;
	frameMax: number;
	probeMean: number;
	probeMax: number;
}

const rows: Row[] = [];

function pct(sorted: number[], p: number): number {
	return sorted[Math.floor(sorted.length * p)];
}

async function measureScroll(label: string, resultBytes: number) {
	const callId = `call_${msgSeq}`;

	perfState.message = baseMessage({
		content: 'Ran the command.',
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
	});
	perfState.toolMessages = [
		baseMessage({
			role: MessageRole.TOOL,
			toolCallId: callId,
			content: `${blob(resultBytes, 'scroll')}\n[exit code: 0]`
		})
	];
	perfState.isStreaming = false;

	const { unmount } = render(AgenticPerfWrapper);
	await tick();
	await nextFrame();

	const trigger = document.querySelector<HTMLElement>('button[data-slot="collapsible-trigger"]');
	if (!trigger) throw new Error('no collapsible trigger rendered');

	const t0 = performance.now();
	trigger.click();
	await tick();
	void document.body.offsetHeight;
	const expandMs = performance.now() - t0;

	await nextFrame();

	const scroller = document.querySelector<HTMLElement>('.terminal-output');
	if (!scroller) throw new Error('no .terminal-output rendered after expand');

	const nodes = scroller.querySelectorAll('*').length;
	const range = scroller.scrollHeight - scroller.clientHeight;

	const frameDeltas: number[] = [];
	const probes: number[] = [];
	let last = performance.now();

	for (let i = 1; i <= SCROLL_FRAMES; i++) {
		const p0 = performance.now();
		scroller.scrollTop = (i / SCROLL_FRAMES) * range;
		void scroller.offsetHeight;
		probes.push(performance.now() - p0);

		await nextFrame();
		const now = performance.now();
		frameDeltas.push(now - last);
		last = now;
	}

	await unmount();

	frameDeltas.sort((a, b) => a - b);
	probes.sort((a, b) => a - b);

	rows.push({
		label,
		nodes,
		expandMs,
		frameMean: frameDeltas.reduce((a, b) => a + b, 0) / frameDeltas.length,
		frameP95: pct(frameDeltas, 0.95),
		frameMax: frameDeltas[frameDeltas.length - 1],
		probeMean: probes.reduce((a, b) => a + b, 0) / probes.length,
		probeMax: probes[probes.length - 1]
	});
}

function report() {
	const pad = (s: string, n: number) => s.padEnd(n);
	const num = (n: number) => n.toFixed(2).padStart(9);

	const header = `${pad('result size', 16)}${'nodes'.padStart(7)}${'expand'.padStart(9)}${'f mean'.padStart(9)}${'f p95'.padStart(9)}${'f max'.padStart(9)}${'pr mean'.padStart(9)}${'pr max'.padStart(9)}`;
	const lines = [
		'',
		'=== Scroll weight: expanded exec result, scrollTop across the clamp ===',
		'expand   = one-time click-to-layout hitch, ms.',
		'f *      = frame-to-frame delta while scrolling (floor ~16.7ms/frame).',
		'pr *     = sync scrollTop + forced layout probe per step.',
		'Compare rows against the 16KB row, not against absolute numbers.',
		'',
		header,
		'-'.repeat(header.length)
	];

	for (const r of rows) {
		lines.push(
			`${pad(r.label, 16)}${String(r.nodes).padStart(7)}${num(r.expandMs)}${num(r.frameMean)}${num(r.frameP95)}${num(r.frameMax)}${num(r.probeMean)}${num(r.probeMax)}`
		);
	}

	lines.push('');
	console.log(lines.join('\n'));
}

describe('tool result scroll weight', () => {
	it('scales with result size', { timeout: 600_000 }, async () => {
		for (const kb of [16, 128, 512, 2048]) {
			await measureScroll(`${kb}KB`, kb * 1024);
		}

		report();
	});
});
