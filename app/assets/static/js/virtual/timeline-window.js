function computeMountWindow(total, center, overscan) {
    var count = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
    if (count === 0) {
        return { start: 0, end: -1 };
    }

    var anchor = Number.isFinite(center) ? Math.floor(center) : 0;
    if (anchor < 0) {
        anchor = 0;
    }
    if (anchor > count - 1) {
        anchor = count - 1;
    }

    var pad = Number.isFinite(overscan) ? Math.max(0, Math.floor(overscan)) : 0;
    var start = anchor - pad;
    var end = anchor + pad;
    if (start < 0) {
        start = 0;
    }
    if (end > count - 1) {
        end = count - 1;
    }
    return { start: start, end: end };
}

module.exports = {
    computeMountWindow: computeMountWindow
};
