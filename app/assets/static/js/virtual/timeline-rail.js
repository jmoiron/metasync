(function(root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.metasyncTimelineRail = api;
    }
})(typeof window !== 'undefined' ? window : globalThis, function() {
    function shouldShowRail(mode, hasTimeline, markerCount) {
        return mode === 'thumbs' && hasTimeline && markerCount > 0;
    }

    return {
        shouldShowRail: shouldShowRail
    };
});
