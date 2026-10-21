const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.metasyncTimelineRange = require('../virtual/timeline-range');
const { TimelineRangeControl, formatUTC } = require('../virtual/timeline-range-control');

test('timeline labels scale detail with the displayed timeframe', function() {
    const timestamp = Date.UTC(2013, 7, 4, 15, 30);
    assert.equal(formatUTC(timestamp, 10 * 365 * 24 * 60 * 60 * 1000), 'Aug 2013');
    assert.equal(formatUTC(timestamp, 365 * 24 * 60 * 60 * 1000), 'Aug 4, 2013');
    assert.equal(formatUTC(timestamp, 7 * 24 * 60 * 60 * 1000), 'Aug 4, 03:30 PM');
});

test('playback timeline dragging seeks the playhead without selecting a range', function() {
    const sought = [];
    const control = Object.create(TimelineRangeControl.prototype);
    control.domain = { start: 0, end: 1000 };
    control.fullDomain = { start: 0, end: 1000 };
    control.timestamps = [0, 1000];
    control.selection = null;
    control.playhead = null;
    control.playbackRange = null;
    control.playbackMode = true;
    control.options = { onSeek: function(timestamp) { sought.push(timestamp); } };
    control.canvas = { setPointerCapture: function() {} };
    control._x = function(event) { return event.clientX; };
    control._width = function() { return 100; };
    control.draw = function() {};

    control._pointerDown({ pointerId: 1, clientX: 20, preventDefault: function() {} });
    control._pointerMove({ pointerId: 1, clientX: 50, preventDefault: function() {} });

    assert.deepEqual(sought, [200, 500]);
    assert.equal(control.selection, null);
    assert.equal(control.playhead, 500);
});
