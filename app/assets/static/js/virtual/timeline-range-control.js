(function(root, factory) {
    var api = factory(root);
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.metasyncTimelineRangeControl = api.TimelineRangeControl;
    }
})(typeof window !== 'undefined' ? window : globalThis, function(root) {
    var math = root.metasyncTimelineRange;

    function TimelineRangeControl(canvas, options) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.options = options || {};
        this.timestamps = [];
        this.fullDomain = null;
        this.domain = null;
        this.selection = null;
        this.playhead = null;
        this.playbackRange = null;
        this.playbackMode = false;
        this.colorMode = 'default';
        this.drag = null;
        this.drawRAF = 0;
        this._bind();
    }

    TimelineRangeControl.prototype._bind = function() {
        var self = this;
        this.canvas.addEventListener('pointerdown', function(event) { self._pointerDown(event); });
        this.canvas.addEventListener('pointermove', function(event) { self._pointerMove(event); });
        this.canvas.addEventListener('pointerup', function(event) { self._pointerUp(event); });
        this.canvas.addEventListener('pointercancel', function(event) { self._pointerUp(event); });
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(function() { self.draw(); });
            this.resizeObserver.observe(this.canvas);
        } else {
            window.addEventListener('resize', function() { self.draw(); });
        }
    };

    TimelineRangeControl.prototype.setData = function(timestamps) {
        this.timestamps = (timestamps || []).map(Number).filter(Number.isFinite).sort(function(a, b) { return a - b; });
        if (this.timestamps.length === 0) {
            this.fullDomain = null;
            this.domain = null;
        } else {
            this.fullDomain = math.expandDomain({ start: this.timestamps[0], end: this.timestamps[this.timestamps.length - 1] }, 6 * 60 * 60 * 1000);
            this.domain = { start: this.fullDomain.start, end: this.fullDomain.end };
        }
        this.playhead = null;
        this.playbackRange = null;
        this.selection = null;
        this.draw();
        this._notify();
    };

    TimelineRangeControl.prototype.getDomain = function() {
        return this.domain ? { start: this.domain.start, end: this.domain.end } : null;
    };

    TimelineRangeControl.prototype.getSelection = function() {
        return this.selection ? { start: this.selection.start, end: this.selection.end } : null;
    };

    TimelineRangeControl.prototype.setSelection = function(range) {
        if (!this.domain) {
            return;
        }
        this.selection = range ? math.clampRange(range, this.domain, 1) : null;
        this.draw();
        this._notify();
    };

    TimelineRangeControl.prototype.setPlaybackMode = function(enabled) {
        this.playbackMode = !!enabled;
        if (this.playbackMode) {
            this.selection = null;
        } else {
            this.playhead = null;
            this.playbackRange = null;
        }
        this.draw();
        if (!this.playbackMode) {
            this._notify();
        }
    };

    TimelineRangeControl.prototype.setPlayhead = function(timestamp, range) {
        if (!this.fullDomain) {
            return;
        }
        this.playhead = Math.max(this.fullDomain.start, Math.min(this.fullDomain.end, Number(timestamp)));
        this.playbackRange = range ? math.clampRange(range, this.fullDomain, 1) : null;
        this.draw();
        this._notify();
    };

    TimelineRangeControl.prototype.setColorMode = function(mode) {
        this.colorMode = mode || 'default';
        this.draw();
    };

    TimelineRangeControl.prototype.zoomToSelection = function() {
        if (!this.selection) {
            return;
        }
        this.domain = math.clampRange(this.selection, this.fullDomain, 1);
        this.selection = null;
        this.draw();
        this._notify();
    };

    TimelineRangeControl.prototype.resetZoom = function() {
        if (!this.fullDomain) {
            return;
        }
        this.domain = { start: this.fullDomain.start, end: this.fullDomain.end };
        this.selection = null;
        this.draw();
        this._notify();
    };

    TimelineRangeControl.prototype._pointerDown = function(event) {
        if (!this.domain || this.timestamps.length === 0) {
            return;
        }
        var x = this._x(event);
        if (this.playbackMode) {
            this.drag = { pointerID: event.pointerId, mode: 'seek' };
            this.canvas.setPointerCapture(event.pointerId);
            this._seek(x);
            event.preventDefault();
            return;
        }
        var time = math.timeAtPosition(x, this._width(), this.domain);
        var inside = this.selection && time >= this.selection.start && time <= this.selection.end;
        this.drag = {
            pointerID: event.pointerId,
            startX: x,
            lastX: x,
            startTime: time,
            initialDomain: this.getDomain(),
            initialSelection: inside ? this.getSelection() : null,
            mode: inside ? 'pan' : 'select'
        };
        this.canvas.setPointerCapture(event.pointerId);
        if (!inside) {
            this.selection = { start: time, end: time };
            this._notify();
            this.draw();
        }
        event.preventDefault();
    };

    TimelineRangeControl.prototype._pointerMove = function(event) {
        if (!this.drag || event.pointerId !== this.drag.pointerID) {
            return;
        }
        if (this.drag.mode === 'seek') {
            this._seek(this._x(event));
            event.preventDefault();
            return;
        }
        var x = this._x(event);
        var width = this._width();
        if (this.drag.mode === 'pan' && this.drag.initialSelection) {
            var deltaTime = (x - this.drag.startX) / Math.max(1, width) * (this.domain.end - this.domain.start);
            this.selection = math.panRange(this.drag.initialSelection, deltaTime, this.fullDomain);
            var actualDelta = this.selection.start - this.drag.initialSelection.start;
            this.domain = math.panDomain(this.drag.initialDomain, actualDelta, this.fullDomain);
        } else {
            var current = math.timeAtPosition(x, width, this.domain);
            this.selection = math.clampRange({ start: this.drag.startTime, end: current }, this.domain, 1);
        }
        this.drag.lastX = x;
        this.draw();
        this._notify();
        event.preventDefault();
    };

    TimelineRangeControl.prototype._seek = function(x) {
        var timestamp = math.timeAtPosition(x, this._width(), this.domain);
        this.playhead = timestamp;
        this.draw();
        if (typeof this.options.onSeek === 'function') {
            this.options.onSeek(timestamp);
        }
    };

    TimelineRangeControl.prototype._pointerUp = function(event) {
        if (!this.drag || event.pointerId !== this.drag.pointerID) {
            return;
        }
        this.drag = null;
        this.draw();
        this._notify();
    };

    TimelineRangeControl.prototype._x = function(event) {
        var rect = this.canvas.getBoundingClientRect();
        return Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    };

    TimelineRangeControl.prototype._width = function() {
        return Math.max(1, this.canvas.getBoundingClientRect().width);
    };

    TimelineRangeControl.prototype._notify = function() {
        if (typeof this.options.onChange !== 'function' || !this.domain) {
            return;
        }
        this.options.onChange({
            domain: this.getDomain(),
            selection: this.getSelection(),
            playhead: this.playhead,
            playbackRange: this.playbackRange ? { start: this.playbackRange.start, end: this.playbackRange.end } : null,
            isZoomed: !!(this.fullDomain && (this.domain.start > this.fullDomain.start || this.domain.end < this.fullDomain.end))
        });
    };

    TimelineRangeControl.prototype.draw = function() {
        if (this.drawRAF) {
            return;
        }
        var self = this;
        this.drawRAF = window.requestAnimationFrame(function() {
            self.drawRAF = 0;
            self._draw();
        });
    };

    TimelineRangeControl.prototype._draw = function() {
        var rect = this.canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            return;
        }
        var ratio = Math.max(1, window.devicePixelRatio || 1);
        this.canvas.width = Math.round(rect.width * ratio);
        this.canvas.height = Math.round(rect.height * ratio);
        var ctx = this.ctx;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, rect.width, rect.height);
        if (!this.domain) {
            return;
        }

        var style = getComputedStyle(document.documentElement);
        var accent = style.getPropertyValue('--accent').trim() || '#2389ca';
        var border = style.getPropertyValue('--border').trim() || '#999';
        var muted = style.getPropertyValue('--muted').trim() || '#777';
        var trackTop = 8;
        var trackBottom = rect.height - 22;
        var trackHeight = Math.max(1, trackBottom - trackTop);
        ctx.strokeStyle = border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, trackBottom + 0.5);
        ctx.lineTo(rect.width, trackBottom + 0.5);
        ctx.stroke();

        var bins = new Uint32Array(Math.max(1, Math.ceil(rect.width)));
        var span = this.domain.end - this.domain.start;
        this.timestamps.forEach(function(timestamp) {
            if (timestamp < this.domain.start || timestamp > this.domain.end) {
                return;
            }
            var x = Math.floor((timestamp - this.domain.start) / span * (bins.length - 1));
            bins[x] += 1;
        }, this);
        var maxBin = 1;
        bins.forEach(function(value) { maxBin = Math.max(maxBin, value); });
        ctx.lineWidth = 1;
        for (var i = 0; i < bins.length; i += 1) {
            if (!bins[i]) {
                continue;
            }
            var height = Math.max(2, Math.sqrt(bins[i] / maxBin) * trackHeight);
            var binTime = this.domain.start + (i / Math.max(1, bins.length - 1)) * span;
            ctx.strokeStyle = this.colorMode === 'rainbow' ? rainbowColor(binTime, this.fullDomain) : accent;
            ctx.globalAlpha = 0.78;
            ctx.beginPath();
            ctx.moveTo(i + 0.5, trackBottom);
            ctx.lineTo(i + 0.5, trackBottom - height);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;

        if (this.selection) {
            var x1 = (this.selection.start - this.domain.start) / span * rect.width;
            var x2 = (this.selection.end - this.domain.start) / span * rect.width;
            var left = Math.max(0, Math.min(x1, x2));
            var width = Math.max(2, Math.min(rect.width - left, Math.abs(x2 - x1)));
            ctx.fillStyle = accent;
            ctx.globalAlpha = 0.2;
            ctx.fillRect(left, trackTop, width, trackHeight);
            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = accent;
            ctx.strokeRect(left + 0.5, trackTop + 0.5, Math.max(1, width - 1), trackHeight - 1);
            ctx.globalAlpha = 1;
        }

        if (this.playhead !== null && this.playhead >= this.domain.start && this.playhead <= this.domain.end) {
            var playheadX = (this.playhead - this.domain.start) / span * rect.width;
            ctx.strokeStyle = accent;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(playheadX + 0.5, trackTop);
            ctx.lineTo(playheadX + 0.5, trackBottom);
            ctx.stroke();
        }

        ctx.fillStyle = muted;
        ctx.font = '11px Figtree, sans-serif';
        ctx.textBaseline = 'bottom';
        for (var tick = 0; tick <= 4; tick += 1) {
            var ratioAtTick = tick / 4;
            var xAtTick = ratioAtTick * rect.width;
            var timeAtTick = this.domain.start + ratioAtTick * span;
            ctx.strokeStyle = border;
            ctx.beginPath();
            ctx.moveTo(xAtTick + 0.5, trackBottom + 1);
            ctx.lineTo(xAtTick + 0.5, trackBottom + 4);
            ctx.stroke();
            ctx.fillStyle = muted;
            ctx.textAlign = tick === 0 ? 'left' : tick === 4 ? 'right' : 'center';
            ctx.fillText(formatUTC(timeAtTick, span), xAtTick, rect.height - 2);
        }
    };

    function rainbowColor(timestamp, domain) {
        var fraction = domain && domain.end > domain.start ? (timestamp - domain.start) / (domain.end - domain.start) : 0;
        return 'hsl(' + Math.round((1 - Math.max(0, Math.min(1, fraction))) * 300) + ', 78%, 52%)';
    }

    function formatUTC(ms, span) {
        var options = { timeZone: 'UTC' };
        if (span < 60 * 24 * 60 * 60 * 1000) {
            options.hour = '2-digit';
            options.minute = '2-digit';
            options.month = 'short';
            options.day = 'numeric';
        } else if (span < 2 * 365 * 24 * 60 * 60 * 1000) {
            options.month = 'short';
            options.day = 'numeric';
            if (span >= 300 * 24 * 60 * 60 * 1000) {
                options.year = 'numeric';
            }
        } else {
            options.month = 'short';
            options.year = 'numeric';
        }
        return new Date(ms).toLocaleString('en-US', options);
    }

    return { TimelineRangeControl: TimelineRangeControl, formatUTC: formatUTC };
});
