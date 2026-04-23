# Building the Google Photos Web UI (2018) - Summary for Metasync

Source: https://medium.com/google-design/google-photos-45b714dfbed1

## Article Summary

The post explains how Google Photos Web handled very large libraries while keeping the grid fast, scrubbable, and visually high quality.

Core problem framing:

- Metadata is large at scale, so sending full image metadata for whole libraries hurts startup.
- Thumbnails are also expensive; loading/rendering too many at once degrades browser performance and can crash tabs.
- A normal infinite scroll does not support true "jump anywhere" behavior well.

Their main approach:

1. Use hierarchical data loading:
- Send lightweight section metadata first (counts/buckets), not full per-image metadata.
- Fetch full metadata only for sections near the viewport.

2. Keep scrollbar/scrubbing stable with estimates:
- Pre-allocate section heights using rough estimates.
- Correct estimates after real section layout is computed by shifting sections below.
- Accuracy of estimate is less important than stable perceived scrubbing behavior.

3. Compute justified layout efficiently:
- Preserve aspect ratio and fill row width.
- Model row breaks as an optimization problem (DAG shortest-path style) to choose better line breaks across a section, not just greedy row-by-row.

4. Maintain 60fps by limiting active work:
- Avoid keeping too many real nodes/images active in the DOM.
- Prioritize visible content and incremental updates.

5. Optimize perceived speed:
- Use placeholders/loading patterns while assets resolve.
- Prioritize requests for visible items first.
- Batch thumbnail requests to avoid waste during fast scroll.
- Reuse already-loaded nearby-size thumbnails where possible (e.g. after resize).

6. Instrument everything:
- Continuously measure frame rate, load times, and behavior under heavy usage.

## Top Learnings for Metasync

1. Stop treating the full image set as renderable DOM.
- For 20k images, full DOM grids are the bottleneck even if grouping code is fast.
- Move to windowed rendering (virtualized list/grid) with an explicit viewport model.

2. Separate "global structure" from "local detail" data.
- Return coarse section summaries first (day/month/session buckets and counts).
- Fetch per-image detail only for visible/nearby sections.
- This directly addresses large initial HTML/JSON payloads and slow first render.

3. Support scrubbing via estimated section heights + correction.
- Pre-allocate scroll space using count-based estimates.
- When real layout is known, patch section offsets and scroll position in one frame.
- This gives "jump anywhere" behavior without loading everything.

4. Prefer incremental patching over full regroup/rebuild.
- Avoid clearing and rebuilding entire timelines on each change.
- Patch affected sections/cards only; keep stable nodes and cached geometry where possible.

5. Prioritize visible work and network.
- Load/refresh thumbnails for visible rows first.
- Batch/offscreen requests so quick user scrolls do not waste bandwidth/CPU.

6. Treat placeholders as a first-class state.
- For fast scrubbing, show lightweight placeholders immediately and resolve progressively.
- This improves perceived responsiveness under heavy data.

7. Instrument rendering phases in-app.
- Track timing for: grouping, DOM patch, lens filtering, summary updates, and image decode/display.
- Add thresholds for "large set mode" so behavior automatically shifts (e.g., collapsed groups + virtualization).

## Concrete Metasync Direction

Short term:

- Remove forced layout reads (`:visible`, repeated geometry reads) in hot paths.
- Keep pane state in JS model (`pane.cards`) and derive visibility there.

Near term:

- Add virtualized rendering for timeline groups/cards.
- Render only rows intersecting viewport + overscan.

Medium term:

- Introduce section-first API/HTML model (counts/anchors first, details on demand).
- Keep scrubbable scrollbar semantics via estimated heights and corrections.
