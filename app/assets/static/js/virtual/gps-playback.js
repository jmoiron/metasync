(function(root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.metasyncGPSPlayback = api;
    }
})(typeof window !== 'undefined' ? window : globalThis, function() {
    function parseDuration(value) {
        var match = String(value || '').trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(ms|msec|milliseconds?|s|sec|seconds?|m|min|minutes?|h|hr|hours?|d|days?|w|weeks?)$/);
        if (!match) { return 0; }
        var amount = Number(match[1]);
        var unit = match[2];
        var factor = /^(ms|msec|millisecond)/.test(unit) ? 1 : /^(s|sec|second)/.test(unit) ? 1000 : /^(m|min|minute)/.test(unit) ? 60000 : /^(h|hr|hour)/.test(unit) ? 3600000 : /^d/.test(unit) ? 86400000 : 604800000;
        return amount > 0 ? amount * factor : 0;
    }

    function nextRange(cursor, windowSize, domain) {
        var start = cursor >= domain.end ? domain.start : cursor;
        var end = Math.min(domain.end, start + windowSize);
        return { range: { start: start, end: end }, next: start + windowSize };
    }

    function fadeAlpha(ageMs) {
        return Math.max(0, Math.round((1 - Math.floor(Math.max(0, ageMs) / 100) / 10) * 10) / 10);
    }

    return { parseDuration: parseDuration, nextRange: nextRange, fadeAlpha: fadeAlpha };
});
