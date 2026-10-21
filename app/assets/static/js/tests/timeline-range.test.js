const test = require('node:test');
const assert = require('node:assert/strict');

const range = require('../virtual/timeline-range');

test('normalizes reversed and zero-length domains', function() {
    assert.deepEqual(range.normalizeDomain({ start: 10, end: 2 }), { start: 2, end: 10 });
    assert.deepEqual(range.normalizeDomain({ start: 5, end: 5 }), { start: -495, end: 505 });
});

test('expands short collections to a useful minimum visible time range', function() {
    const expanded = range.expandDomain({ start: 1000, end: 1000 }, 6000);
    assert.deepEqual(expanded, { start: -2000, end: 4000 });
    assert.deepEqual(range.expandDomain({ start: 0, end: 8000 }, 6000), { start: 0, end: 8000 });
});

test('clamps selected ranges within the full time domain', function() {
    assert.deepEqual(range.clampRange({ start: -5, end: 4 }, { start: 0, end: 20 }, 1), { start: 0, end: 4 });
    assert.deepEqual(range.clampRange({ start: 18, end: 40 }, { start: 0, end: 20 }, 1), { start: 18, end: 20 });
});

test('pans a range while preserving its duration and respecting bounds', function() {
    assert.deepEqual(range.panRange({ start: 20, end: 30 }, 5, { start: 0, end: 40 }), { start: 25, end: 35 });
    assert.deepEqual(range.panRange({ start: 20, end: 30 }, 50, { start: 0, end: 40 }), { start: 30, end: 40 });
});

test('pans a zoomed viewport along with its selected range', function() {
    assert.deepEqual(range.panDomain({ start: 20, end: 40 }, 5, { start: 0, end: 100 }), { start: 25, end: 45 });
    assert.deepEqual(range.panDomain({ start: 80, end: 100 }, 20, { start: 0, end: 100 }), { start: 80, end: 100 });
});

test('maps pointer positions to timestamps', function() {
    assert.equal(range.timeAtPosition(25, 100, { start: 0, end: 1000 }), 250);
    assert.equal(range.timeAtPosition(200, 100, { start: 0, end: 1000 }), 1000);
});
