# Timeline Scroll Control Implementation Plan

## Goals

- Support very large panes (target up to `100k` photos) without full DOM rendering.
- Preserve current editing model: all modifications apply to `pane.cards` model objects, including unmounted images.
- Add a right-side timeline scroll control ("time rail") with:
  - major labeled divisions,
  - minor dot divisions where space permits,
  - a current-position marker.
- Keep user experience consistent across small and large collections.

## Functional Requirements

1. **Virtualized thumbs rendering**
- In thumbs mode, mount only a bounded DOM subset.
- Mount window policy:
  - at least `100` images above and `100` below viewport anchor,
  - plus full `current`, `previous`, and `next` session ranges,
  - effective mounted set is whichever is larger.

2. **Scroll continuity**
- Native scroll remains smooth and continuous.
- Unmounted regions are represented by virtual spacing so total scroll height remains stable.
- As user scrolls:
  - append needed items/groups on the bottom when advancing,
  - prepend needed items/groups on the top when reversing,
  - remove items/groups beyond retention window.

3. **Time rail control**
- Right-aligned control in pane thumbs view.
- Markers:
  - major: labeled boundaries (dynamic granularity),
  - minor: unlabeled dots between majors when density permits.
- Clicking rail jumps to nearby content/time boundary.
- Current marker tracks viewport position during normal scroll.

4. **Dynamic granularity**
- Granularity selected by visible timespan and available rail pixel height.
- Examples:
  - wide spans: `year` majors with `month` or `quarter` minors,
  - medium spans: `month` majors with `week` or `day` minors,
  - short vacation spans: `Sunday` majors with `day` minors.

5. **Model-first correctness**
- Selection, lens visibility, staged metadata changes, timezone adjustments, and apply/save operate over model objects, not mounted node presence.
- Mount/unmount is purely a rendering concern.

6. **Small set behavior**
- Keep behavior consistent for smaller sets.
- Initial `small set` threshold: `250` images.
- Same rendering pipeline should work for both; only virtualization window size differs.

7. **Loading feedback**
- On expensive pane build/regroup (`>100` photos), show pane-local spinner while building initial groups/nodes.
- Avoid spinner flash for trivial work.

## Non-Functional Requirements

- No full timeline re-render on every scroll tick.
- Scroll handlers must stay lightweight; heavy updates scheduled by `requestAnimationFrame`.
- Keep mounted photo count roughly bounded (target ~`200-400`, session-size dependent).
- Preserve existing pane modes and controls (preview mode, directory browser mode, metadata panel).

## Architecture Plan

### 1. Data structures

Add pane-scoped virtual state:

- `pane.cards` (existing): canonical model objects
- `pane.virtual`:
  - `ordered`: cards sorted for current timeline view
  - `sessions`: list of `{startIndex, endIndex, anchorMs}`
  - `mounted`: `{startIndex, endIndex}`
  - `spacers`: `{topPx, bottomPx}`
  - `anchor`: current viewport anchor index/time
  - `rail`: computed major/minor marker set for current view

### 2. Precompute phase

When pane data or grouping view changes:

- Recompute sorted order and session boundaries.
- Build cumulative height estimate/index mapping needed for scroll-to-index and spacer sizing.
- Build rail marker candidates at multiple granularities.

### 3. Virtual renderer

Timeline DOM structure:

- top spacer element
- mounted groups/cards
- bottom spacer element

On scroll:

- compute desired mount window from current anchor index and policy
- if outside hysteresis threshold, patch mounted range incrementally
- update spacer sizes

### 4. Time rail

Per pane thumbs view:

- render right rail overlay
- choose major/minor granularity based on marker collision and available height
- map click Y position -> target time/index -> `scrollToIndex(...)`
- update current marker from visible anchor during scroll

### 5. Interaction integration

- Selection remains ID-based; mounted nodes mirror selection class when present.
- Lens filtering sets `info.isVisible` on model for all cards; mounted nodes mirror hidden/show state.
- Metadata edits update model first; mounted nodes patched if present.

### 6. Performance instrumentation

Expose debug stats (via `window.metasyncUI`) for:

- mounted card count
- mount/unmount operations per scroll cycle
- render pass duration
- rail recompute duration

## Rollout Phases

### Phase 1

- Keep current grouping and full render behavior.
- Introduce model-first render pipeline and templates (done/in-progress).
- Ensure no DOM-derived correctness dependencies remain.

### Phase 2

- Add virtualization with spacers and mount window policy.
- Keep native scroll.
- Verify correctness for selections/lens/edits across unmounted items.

### Phase 3

- Add time rail markers and click-to-jump.
- Add dynamic major/minor granularity.

### Phase 4

- Tuning: hysteresis, marker density, mounted set size, scroll-jump precision.
- Add stress testing on large fixtures.

## Acceptance Criteria

1. Large panes (`>=20k`) remain interactive during scroll.
2. Mounted `.photo-card` count remains bounded by policy.
3. Edits/lens/selection on unmounted items are preserved and visible when remounted.
4. Time rail marker tracks scroll position and supports click jumps.
5. `make test` and `make build` pass.
