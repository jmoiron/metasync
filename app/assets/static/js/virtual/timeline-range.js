(function(root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.metasyncTimelineRange = api;
    }
})(typeof window !== 'undefined' ? window : globalThis, function() {
    function normalizeDomain(domain) {
        var start = Number(domain && domain.start);
        var end = Number(domain && domain.end);
        if (!Number.isFinite(start) || !Number.isFinite(end)) {
            return null;
        }
        if (end < start) {
            var swap = start;
            start = end;
            end = swap;
        }
        if (end === start) {
            start -= 500;
            end += 500;
        }
        return { start: start, end: end };
    }

    function expandDomain(domain, minSpan) {
        var normalized = normalizeDomain(domain);
        var minimum = Math.max(1, Number(minSpan) || 1);
        if (!normalized || normalized.end - normalized.start >= minimum) {
            return normalized;
        }
        var center = (normalized.start + normalized.end) / 2;
        return { start: center - minimum / 2, end: center + minimum / 2 };
    }

    function clampRange(range, bounds, minSpan) {
        var domain = normalizeDomain(bounds);
        var selected = normalizeDomain(range);
        if (!domain || !selected) {
            return null;
        }
        var start = Math.max(domain.start, Math.min(selected.start, domain.end));
        var end = Math.max(domain.start, Math.min(selected.end, domain.end));
        var minimum = Math.max(1, Number(minSpan) || 1);
        if (end - start < minimum) {
            end = Math.min(domain.end, start + minimum);
            start = Math.max(domain.start, end - minimum);
        }
        return { start: start, end: end };
    }

    function panRange(range, delta, bounds) {
        var domain = normalizeDomain(bounds);
        var selected = normalizeDomain(range);
        if (!domain || !selected) {
            return null;
        }
        var span = Math.min(selected.end - selected.start, domain.end - domain.start);
        var start = Math.max(domain.start, Math.min(selected.start + Number(delta || 0), domain.end - span));
        return { start: start, end: start + span };
    }

    function panDomain(domain, delta, bounds) {
        var full = normalizeDomain(bounds);
        var visible = normalizeDomain(domain);
        if (!full || !visible) {
            return null;
        }
        var span = Math.min(visible.end - visible.start, full.end - full.start);
        var start = Math.max(full.start, Math.min(visible.start + Number(delta || 0), full.end - span));
        return { start: start, end: start + span };
    }

    function timeAtPosition(x, width, domain) {
        var normalized = normalizeDomain(domain);
        if (!normalized || !(width > 0)) {
            return NaN;
        }
        var ratio = Math.max(0, Math.min(1, Number(x) / width));
        return normalized.start + ratio * (normalized.end - normalized.start);
    }

    return {
        normalizeDomain: normalizeDomain,
        expandDomain: expandDomain,
        clampRange: clampRange,
        panRange: panRange,
        panDomain: panDomain,
        timeAtPosition: timeAtPosition
    };
});
