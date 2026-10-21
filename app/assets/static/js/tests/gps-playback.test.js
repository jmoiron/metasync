const test = require('node:test');
const assert = require('node:assert/strict');
const playback = require('../virtual/gps-playback');

test('parses common playback window units', function() {
    assert.equal(playback.parseDuration('6 hours'), 6 * 60 * 60 * 1000);
    assert.equal(playback.parseDuration('1 day'), 24 * 60 * 60 * 1000);
    assert.equal(playback.parseDuration('1 week'), 7 * 24 * 60 * 60 * 1000);
    assert.equal(playback.parseDuration('invalid'), 0);
});

test('playback windows advance and wrap at the domain end', function() {
    const domain = { start: 0, end: 100 };
    assert.deepEqual(playback.nextRange(20, 30, domain), {
        range: { start: 20, end: 50 }, next: 50
    });
    assert.deepEqual(playback.nextRange(90, 30, domain), {
        range: { start: 90, end: 100 }, next: 120
    });
    assert.deepEqual(playback.nextRange(120, 30, domain), {
        range: { start: 0, end: 30 }, next: 30
    });
});

test('playback dots fade one stop per 100ms and disappear after ten stops', function() {
    assert.equal(playback.fadeAlpha(0), 1);
    assert.equal(playback.fadeAlpha(100), 0.9);
    assert.equal(playback.fadeAlpha(900), 0.1);
    assert.equal(playback.fadeAlpha(1000), 0);
});

