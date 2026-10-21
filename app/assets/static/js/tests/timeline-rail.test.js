const test = require('node:test');
const assert = require('node:assert/strict');

const { shouldShowRail } = require('../virtual/timeline-rail');

test('does not show a rail for a directory-browser pane without a timeline', function() {
    assert.equal(shouldShowRail('thumbs', false, 0), false);
});

test('shows a populated timeline rail in thumbs mode only', function() {
    assert.equal(shouldShowRail('thumbs', true, 1), true);
    assert.equal(shouldShowRail('thumbs', true, 0), false);
    assert.equal(shouldShowRail('preview', true, 1), false);
});
