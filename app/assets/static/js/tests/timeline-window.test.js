const test = require('node:test');
const assert = require('node:assert/strict');

const { computeMountWindow } = require('../virtual/timeline-window');

test('returns empty window for empty collections', function() {
    assert.deepEqual(computeMountWindow(0, 0, 100), { start: 0, end: -1 });
});

test('clamps center and overscan to collection bounds', function() {
    assert.deepEqual(computeMountWindow(10, 5, 2), { start: 3, end: 7 });
    assert.deepEqual(computeMountWindow(10, -9, 2), { start: 0, end: 2 });
    assert.deepEqual(computeMountWindow(10, 99, 2), { start: 7, end: 9 });
});

test('tolerates non-finite inputs', function() {
    assert.deepEqual(computeMountWindow(NaN, NaN, NaN), { start: 0, end: -1 });
    assert.deepEqual(computeMountWindow(5, NaN, 1), { start: 0, end: 1 });
});
