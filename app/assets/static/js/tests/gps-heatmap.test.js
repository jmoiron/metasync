const test = require('node:test');
const assert = require('node:assert/strict');
const heatmap = require('../virtual/gps-heatmap');

test('aggregates nearby points and log-scales density with a visible floor', function() {
    const entries = Array.from({ length: 1000 }, function() {
        return { latitude: 40.75, longitude: -73.98 };
    });
    entries.push({ latitude: 35.68, longitude: 139.69 });

    const points = heatmap.points(entries);
    assert.equal(points.length, 2);
    const weights = points.map(function(point) { return point[2]; }).sort(function(a, b) { return a - b; });
    assert.ok(weights[0] > 0.18 && weights[0] < 0.3);
    assert.equal(weights[1], 1);
});

test('nearby coordinates share one density cell and invalid coordinates are ignored', function() {
    const points = heatmap.points([
        { latitude: 40.75, longitude: -73.98 },
        { latitude: 40.7501, longitude: -73.9801 },
        { latitude: 'invalid', longitude: -73.98 }
    ]);

    assert.equal(points.length, 1);
    assert.equal(points[0][2], 1);
});
