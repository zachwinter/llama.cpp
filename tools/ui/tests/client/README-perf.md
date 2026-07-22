# Agentic thread perf harness

Two tiers, both reusing the existing vitest projects (see `vite.config.ts`),
plus a cliff harness for step changes (below).

## Tier 1 - `agentic-stream.perf.svelte.test.ts` (project: `client`, real Chromium)

Mounts `ChatMessageAgenticContent` and replays a stream, replacing the message
object on each chunk exactly as the real pipeline does:

- `chat.svelte.ts` `updateStreamingUI()` runs per SSE chunk
- `conversations.svelte.ts` `updateMessageAtIndex` does `{ ...old, ...updates }`

That new object identity is the thing under test: it cascades through
`deriveAgenticSections` (which returns fresh `AgenticSection` objects) into every
tool-call block in the message, including completed ones.

```
npx vitest --project=client --run tests/client/agentic-stream.perf.svelte.test.ts
```

### Reading the output

- `mean` / `p95` / `max` - the synchronous window per token: prop write,
  `await tick()`, then a forced `offsetHeight` read so style and layout are
  included rather than deferred.
- `sync` - sum of those windows. This is the number to optimize.
- `wall` - the whole run including work `MarkdownContent` defers into its own
  `requestAnimationFrame`. It carries a ~16.7ms/token idle floor because the
  harness yields a frame each iteration, so compare `wall` **across fixtures**,
  never against `sync`.

### The knobs, and what each one discriminates

The point of the harness is the _scaling curve_, not any single number.

| Knob                        | Reads on                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `priorToolCalls` (0/1/5/20) | the reactive fan-out. Flat => no fan-out. Linear => confirmed.                                       |
| `toolResultBytes`           | whole-blob string scans (`extractSearchResults`, `parseToolResultWithImages`, `classifyToolResult`). |
| `editFileEdits`             | `computeLineDiff`, the O(m\*n) LCS.                                                                  |
| `openCodeFence`             | `hljs.highlightAuto` on partial code.                                                                |

Deliberately no hard assertions: CI timing is noisy and the value here is the
before/after delta, not a gate.

### Caveat

This measures one message's subtree. In the real app `ChatMessages.svelte`
rebuilds its whole `displayMessages` list per token, so multiply by the number
of rendered messages to get the conversation-level cost.

## Tier 2 - `../unit/agentic-hotpath.bench.ts` (project: `unit`, node)

Per-call costs for the pure functions the curve implicates.

```
npx vitest bench --project=unit --run tests/unit/agentic-hotpath.bench.ts
```

## Cliff harness - `agentic-cliff.perf.svelte.test.ts` (project: `client`)

For step changes rather than scaling curves: each scenario streams two phases
in one run around an injected event (a completed tool call of parameterized
result size, an expand, a turn crossing) and reports per-token cost before (A)
and after (B) plus the B/A ratio. ~1.0 denies the hypothesis; >>1 confirms it.

```
npx vitest --project=client --run tests/client/agentic-cliff.perf.svelte.test.ts --reporter=verbose
```

Historical note: this harness located the post-tool-turn cliff (S2: an expanded
512KB result cost ~100ms/token, 100x phase A, while the statically-suspected
always-on scan was only 1.8x). Fixed by `reuseStableSections` keeping section
object identity stable across tokens; all ratios now sit at ~1.0.

## Scroll weight - `tool-result-scroll.perf.svelte.test.ts` (project: `client`)

Measures the DOM weight of an EXPANDED large tool result: the one-time expand
hitch, subtree node count, and frame deltas while driving scrollTop across the
terminal clamp.

```
npx vitest --project=client --run tests/client/tool-result-scroll.perf.svelte.test.ts --reporter=verbose
```

Historical note: this refuted virtual scrolling for tool results. Frame deltas
are flat from 16KB (297 nodes) to 2MB (37k nodes) - clamp scrolling is
composited, so node count does not affect it. The only size-scaling cost is the
one-time expand hitch (4ms @ 16KB, 81ms @ 512KB, 275ms @ 2MB); line-capping
would address that if it ever matters, virtualization buys nothing.
