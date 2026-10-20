const assert = require('node:assert/strict');
const test = require('node:test');
const {
    groupSortTime,
    keyForTime,
    localExifTimelineMs
} = require('../../js/utils');

test('local EXIF wall time keeps its written calendar date', () => {
    const localWallTime = localExifTimelineMs('2026-02-11 07:00:00');
    assert.equal(new Date(localWallTime).toISOString(), '2026-02-11T07:00:00.000Z');
    assert.equal(keyForTime('day', localWallTime), '2026-02-11');
});

test('UTC grouping follows the instant date', () => {
    const japanPhotoInstant = Date.parse('2026-02-10T22:00:00Z');
    const newYorkPhotoInstant = Date.parse('2026-02-12T02:00:00Z');

    assert.equal(keyForTime('day', japanPhotoInstant), '2026-02-10');
    assert.equal(keyForTime('day', newYorkPhotoInstant), '2026-02-12');
});

test('fixed offset grouping uses the shifted calendar date', () => {
    const instant = Date.parse('2026-02-10T22:00:00Z');
    const japanWallTime = instant + (9 * 60 * 60 * 1000);

    assert.equal(keyForTime('day', japanWallTime), '2026-02-11');
    assert.equal(groupSortTime('day', japanWallTime), Date.parse('2026-02-11T00:00:00Z'));
});
