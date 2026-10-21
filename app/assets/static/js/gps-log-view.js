(function(root, factory) {
    var api = factory(root);
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.metasyncGPSLogView = api;
    }
})(typeof window !== 'undefined' ? window : globalThis, function(root) {
    function create(options) {
        var $ = root.jQuery;
        var map = null;
        var pointLayer = null;
        var heatLayer = null;
        var entries = [];
        var timeline = null;
        var activeRange = null;
        var hasFitBounds = false;
        var displayMode = 'timeline';
        var playbackTimer = null;
        var playbackSpeed = 100;
        var playbackCursor = null;
        var playbackRunning = false;
        var playbackTrail = [];
        var playbackTrailEntries = new Set();
        var playbackFadeTimer = null;

        function status(message, isError) {
            $('[data-gps-log-status]').text(message || '').toggleClass('is-error', !!isError);
            if (typeof options.onStatus === 'function') {
                options.onStatus(message || '', !!isError);
            }
        }

        function initialize() {
            if (map || typeof root.L === 'undefined') {
                return;
            }
            map = root.L.map(document.querySelector('[data-gps-log-map]'), { zoomControl: true }).setView([20, 0], 2);
            root.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            }).addTo(map);
            pointLayer = new GPSLogCanvasLayer([]).addTo(map);
            heatLayer = root.L.heatLayer([], {
                radius: 28,
                blur: 22,
                minOpacity: 0.06,
                maxZoom: 12,
                max: 1,
                gradient: {
                    0.1: '#7774b8',
                    0.3: '#789bd0',
                    0.5: '#8dc9c2',
                    0.7: '#e6d48f',
                    0.85: '#e7a08b',
                    1: '#dc777d'
                }
            });
            map.on('zoomend', function() {
                if (displayMode === 'playback' && heatLayer) {
                    heatLayer.setOptions({ maxZoom: map.getZoom() });
                }
            });
            pointLayer.on('delete-entry', function(event) {
                deleteEntry(event.entry);
            });
            window.setTimeout(function() {
                if (map) {
                    map.invalidateSize();
                }
            }, 0);
        }

        function initializeTimeline() {
            if (timeline) {
                return;
            }
            var Control = root.metasyncTimelineRangeControl;
            if (!Control) {
                return;
            }
            timeline = new Control(document.querySelector('[data-gps-log-timeline]'), {
                onChange: function(state) {
                    activeRange = state.playbackRange || state.selection || state.domain;
                    updateMapPoints();
                    updateRangeLabel(state);
                },
                onSeek: function(timestamp) {
                    if (playbackRunning) {
                        playbackCursor = timestamp;
                        advancePlayback(parseDuration($('[data-gps-log-window]').val()), timeline.fullDomain);
                    }
                }
            });
            $('[data-gps-log-zoom]').on('click', function() {
                timeline.zoomToSelection();
            });
            $('[data-gps-log-reset]').on('click', function() {
                timeline.resetZoom();
            });
            $('[data-gps-log-play]').on('click', togglePlayback);
            $('[data-gps-log-faster]').on('click', function() { setPlaybackSpeed(playbackSpeed - 10); });
            $('[data-gps-log-slower]').on('click', function() { setPlaybackSpeed(playbackSpeed + 10); });
            $('[data-gps-log-window]').on('change', function() {
                status(parseDuration(this.value) ? '' : 'Enter a duration such as 6 hours, 1 day, or 1 week.', !parseDuration(this.value));
            });
            $('[data-gps-log-mode-toggle]').on('click', function(event) {
                event.stopPropagation();
                var menu = $('[data-gps-log-mode-menu]');
                var open = menu.prop('hidden');
                menu.prop('hidden', !open);
                $(this).attr('aria-expanded', open ? 'true' : 'false');
            });
            $('[data-gps-log-mode-menu]').on('click', '[data-gps-log-mode]', function() {
                setDisplayMode(String($(this).attr('data-gps-log-mode')));
                $('[data-gps-log-mode-menu]').prop('hidden', true);
                $('[data-gps-log-mode-toggle]').attr('aria-expanded', 'false');
            });
            $(document).on('click.gps-log-mode', function(event) {
                if (!$(event.target).closest('[data-gps-log-mode-menu], [data-gps-log-mode-toggle]').length) {
                    $('[data-gps-log-mode-menu]').prop('hidden', true);
                    $('[data-gps-log-mode-toggle]').attr('aria-expanded', 'false');
                }
            }).on('keydown.gps-log-mode', function(event) {
                if (event.key === 'Escape') {
                    $('[data-gps-log-mode-menu]').prop('hidden', true);
                    $('[data-gps-log-mode-toggle]').attr('aria-expanded', 'false');
                }
            });
            setDisplayMode(displayMode);
        }

        function enter() {
            initialize();
            initializeTimeline();
            if (map) {
                window.setTimeout(function() { map.invalidateSize(); }, 0);
            }
            load();
        }

        function leave() {
            stopPlayback();
        }

        function load(successMessage) {
            status(successMessage || 'Loading GPS log…');
            fetch('/api/gps-log').then(function(response) {
                if (!response.ok) {
                    throw new Error('Failed to load GPS log (' + response.status + ').');
                }
                return response.json();
            }).then(function(data) {
                entries = (Array.isArray(data) ? data : []).map(normalizeEntry).filter(Boolean);
                entries.sort(function(a, b) { return a.timestamp - b.timestamp; });
                render();
                status(successMessage || '');
            }).catch(function(error) {
                status(error.message || 'Failed to load GPS log.', true);
            });
        }

        function addEntries(selection, description) {
            if (!selection.entries.length) {
                status(selection.message || 'No images have usable GPS coordinates and timestamps.', true);
                return;
            }
            status('Adding ' + selection.entries.length + ' ' + description + '…');
            return fetch('/api/gps-log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entries: selection.entries })
            }).then(function(response) {
                if (!response.ok) {
                    return response.text().then(function(message) {
                        throw new Error(message || 'Failed to add GPS log entries.');
                    });
                }
                return response.json();
            }).then(function(result) {
                var skipped = selection.skipped ? ' ' + selection.skipped + ' image' + (selection.skipped === 1 ? ' was' : 's were') + ' skipped.' : '';
                var message = 'Added or updated ' + result.written + ' GPS log entr' + (result.written === 1 ? 'y.' : 'ies.') + skipped;
                hasFitBounds = false;
                return load(message);
            }).catch(function(error) {
                status(error.message || 'Failed to add GPS log entries.', true);
            });
        }

        function addSelected() {
            var selection = options.collectEntries();
            return addEntries(selection, 'selected image' + (selection.entries.length === 1 ? '' : 's'));
        }

        function addAllReference() {
            var selection = options.collectAllReferenceEntries();
            return addEntries(selection, 'reference image' + (selection.entries.length === 1 ? '' : 's'));
        }

        function deleteEntry(entry) {
            if (!entry || !window.confirm('Delete this GPS log point?')) {
                return;
            }
            status('Deleting GPS log point…');
            fetch('/api/gps-log', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source_path: entry.sourcePath })
            }).then(function(response) {
                if (!response.ok) {
                    return response.text().then(function(message) {
                        throw new Error(message || 'Failed to delete GPS log point.');
                    });
                }
                return response.json();
            }).then(function(result) {
                if (!result.deleted) {
                    throw new Error('GPS log point was not found.');
                }
                hasFitBounds = false;
                return load('Deleted GPS log point.');
            }).catch(function(error) {
                status(error.message || 'Failed to delete GPS log point.', true);
            });
        }

        function normalizeEntry(entry) {
            if (!entry || !Number.isFinite(Number(entry.latitude)) || !Number.isFinite(Number(entry.longitude))) {
                return null;
            }
            var timestamp = Date.parse(entry.utc_datetime);
            if (!Number.isFinite(timestamp) || timestamp < Date.UTC(1975, 0, 1)) {
                return null;
            }
            return {
                sourcePath: String(entry.source_path || ''),
                localDateTime: String(entry.local_datetime || ''),
                offset: String(entry.offset || ''),
                timestamp: timestamp,
                latitude: Number(entry.latitude),
                longitude: Number(entry.longitude)
            };
        }

        function render() {
            initializeTimeline();
            if (!timeline) {
                return;
            }
            var timestamps = entries.map(function(entry) { return entry.timestamp; });
            timeline.setData(timestamps);
            timeline.setColorMode(displayMode === 'rainbow' ? 'rainbow' : 'default');
            activeRange = timeline.getSelection() || timeline.getDomain();
            updateMapPoints();
            var domain = timeline.getDomain();
            if (domain) {
                updateRangeLabel({ domain: domain, selection: timeline.getSelection(), isZoomed: false });
            } else {
                $('[data-gps-log-range-label]').text('No GPS timestamps yet');
                $('[data-gps-log-zoom]').prop('disabled', true);
            }
            $('[data-gps-log-summary]').text(entries.length.toLocaleString() + ' GPS log entr' + (entries.length === 1 ? 'y' : 'ies'));
            if (map && entries.length && !hasFitBounds) {
                var bounds = [[90, 180], [-90, -180]];
                entries.forEach(function(entry) {
                    bounds[0][0] = Math.min(bounds[0][0], entry.latitude);
                    bounds[0][1] = Math.min(bounds[0][1], entry.longitude);
                    bounds[1][0] = Math.max(bounds[1][0], entry.latitude);
                    bounds[1][1] = Math.max(bounds[1][1], entry.longitude);
                });
                map.fitBounds(bounds, { padding: [24, 24], maxZoom: 12 });
                hasFitBounds = true;
            }
        }

        function updateMapPoints() {
            if (!pointLayer) {
                return;
            }
            var mode = displayMode === 'rainbow' ? 'rainbow' : displayMode === 'heatmap' ? 'hidden' : displayMode === 'playback' ? 'playback' : 'points';
            pointLayer.setMode(mode);
            pointLayer.setEntries(entries, activeRange, timeline && timeline.fullDomain);

            if (displayMode === 'heatmap') {
                clearPlaybackTrail();
                heatLayer.setOptions({ maxZoom: 12 });
                var heatEntries = entriesInActiveRange();
                heatLayer.setLatLngs(root.metasyncGPSHeatmap.points(heatEntries));
                if (!map.hasLayer(heatLayer)) { heatLayer.addTo(map); }
                return;
            }

            if (displayMode === 'playback') {
                if (map.hasLayer(heatLayer)) { map.removeLayer(heatLayer); }
                if (playbackRunning && activeRange) {
                    var now = Date.now();
                    entriesInActiveRange().forEach(function(entry) {
                        if (!playbackTrailEntries.has(entry)) {
                            playbackTrail.push({ entry: entry, seenAt: now });
                            playbackTrailEntries.add(entry);
                        }
                    });
                }
                drawPlaybackDots();
                return;
            }

            clearPlaybackTrail();
            if (map.hasLayer(heatLayer)) { map.removeLayer(heatLayer); }
        }

        function entriesInActiveRange() {
            if (!activeRange) { return entries; }
            return entries.slice(lowerBound(entries, activeRange.start), upperBound(entries, activeRange.end));
        }

        function drawPlaybackDots() {
            if (!pointLayer || displayMode !== 'playback') { return; }
            var now = Date.now();
            playbackTrail = playbackTrail.filter(function(point) { return now - point.seenAt < 1000; });
            playbackTrailEntries = new Set(playbackTrail.map(function(point) { return point.entry; }));
            pointLayer.setPlaybackTrail(playbackTrail.map(function(point) {
                return {
                    entry: point.entry,
                    alpha: root.metasyncGPSPlayback.fadeAlpha(now - point.seenAt)
                };
            }));
            if (playbackTrail.length && !playbackFadeTimer) {
                playbackFadeTimer = window.setTimeout(function() {
                    playbackFadeTimer = null;
                    drawPlaybackDots();
                }, 100);
            }
        }

        function clearPlaybackTrail() {
            playbackTrail = [];
            playbackTrailEntries.clear();
            if (pointLayer) {
                pointLayer.setPlaybackTrail([]);
            }
            window.clearTimeout(playbackFadeTimer);
            playbackFadeTimer = null;
        }

        function setDisplayMode(mode) {
            var labels = { timeline: 'Timeline', rainbow: 'Rainbow', heatmap: 'Heatmap', playback: 'Playback' };
            displayMode = Object.prototype.hasOwnProperty.call(labels, mode) ? mode : 'timeline';
            $('[data-gps-log-mode-label]').text(labels[displayMode]);
            $('[data-gps-log-mode]').each(function() {
                $(this).toggleClass('is-active', String($(this).attr('data-gps-log-mode')) === displayMode);
            });
            $('[data-gps-log-playback-controls]').prop('hidden', displayMode !== 'playback');
            if (displayMode !== 'playback') {
                stopPlayback();
            }
            if (timeline) {
                timeline.setColorMode(displayMode === 'rainbow' ? 'rainbow' : 'default');
            }
            updateMapPoints();
        }

        function togglePlayback() {
            if (playbackTimer) {
                stopPlayback(true);
                return;
            }
            var windowSize = parseDuration($('[data-gps-log-window]').val());
            var domain = timeline && timeline.fullDomain;
            if (!windowSize || !domain) {
                status('Enter a valid playback window and load GPS log points.', true);
                return;
            }
            playbackCursor = activeRange && activeRange.start >= domain.start && activeRange.start < domain.end ? activeRange.start : domain.start;
            playbackRunning = true;
            timeline.setPlaybackMode(true);
            $('[data-gps-log-play]').removeClass('is-paused').attr('aria-label', 'Pause').attr('title', 'Pause').find('.fa-solid').removeClass('fa-play').addClass('fa-pause');
            status('');
            advancePlayback(windowSize, domain);
            playbackTimer = window.setInterval(function() { advancePlayback(windowSize, domain); }, playbackSpeed);
        }

        function advancePlayback(windowSize, domain) {
            var step = root.metasyncGPSPlayback.nextRange(playbackCursor, windowSize, domain);
            timeline.setPlayhead(step.range.start, step.range);
            playbackCursor = step.next;
        }

        function stopPlayback(isPaused) {
            if (playbackTimer) {
                window.clearInterval(playbackTimer);
                playbackTimer = null;
            }
            playbackRunning = false;
            if (timeline) {
                timeline.setPlaybackMode(false);
            }
            $('[data-gps-log-play]')
                .toggleClass('is-paused', !!isPaused)
                .attr('aria-label', 'Play')
                .attr('title', 'Play')
                .find('.fa-solid').removeClass('fa-pause').addClass('fa-play');
        }

        function setPlaybackSpeed(speed) {
            playbackSpeed = Math.max(10, speed);
            $('[data-gps-log-speed]').text(playbackSpeed + ' ms/window');
            if (playbackTimer) {
                stopPlayback();
                togglePlayback();
            }
        }

        function parseDuration(value) {
            return root.metasyncGPSPlayback.parseDuration(value);
        }

        function updateRangeLabel(state) {
            if (!state || !state.domain) {
                return;
            }
            var range = state.playbackRange || state.selection || state.domain;
            var suffix = state.selection ? ' · selected' : state.playbackRange ? ' · playing' : '';
            $('[data-gps-log-range-label]').text(formatTime(range.start) + ' – ' + formatTime(range.end) + suffix);
            $('[data-gps-log-zoom]').prop('disabled', !state.selection);
            $('[data-gps-log-reset]').prop('disabled', false);
        }

        return { enter: enter, leave: leave, refresh: load, addSelected: addSelected, addAllReference: addAllReference };
    }

    function formatTime(timestamp) {
        if (!Number.isFinite(Number(timestamp))) {
            return '';
        }
        return new Date(Number(timestamp)).toLocaleString(undefined, {
            timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
        });
    }

    var GPSLogCanvasLayer = root.L && root.L.Layer ? root.L.Layer.extend({
        initialize: function() {
            this._entries = [];
            this._range = null;
            this._timeDomain = null;
            this._mode = 'points';
            this._playbackTrail = [];
            this._startIndex = 0;
            this._endIndex = 0;
        },
        onAdd: function(map) {
            this._map = map;
            this._canvas = root.L.DomUtil.create('canvas', 'gps-log-map-canvas', map.getPanes().overlayPane);
            this._ctx = this._canvas.getContext('2d');
            map.on('moveend zoomend resize', this._draw, this);
            map.on('click', this._onClick, this);
            this._draw();
        },
        onRemove: function(map) {
            map.off('moveend zoomend resize', this._draw, this);
            map.off('click', this._onClick, this);
            root.L.DomUtil.remove(this._canvas);
        },
        setMode: function(mode) {
            this._mode = mode || 'points';
            this._draw();
        },
        setEntries: function(entries, range, timeDomain) {
            this._entries = entries || [];
            this._range = range;
            this._timeDomain = timeDomain || null;
            this._startIndex = range ? lowerBound(this._entries, range.start) : 0;
            this._endIndex = range ? upperBound(this._entries, range.end) : this._entries.length;
            this._draw();
        },
        setPlaybackTrail: function(trail) {
            this._playbackTrail = trail || [];
            this._draw();
        },
        _draw: function() {
            if (!this._map || !this._canvas || !this._ctx) {
                return;
            }
            var map = this._map;
            var size = map.getSize();
            var ratio = Math.max(1, window.devicePixelRatio || 1);
            this._canvas.width = Math.max(1, Math.round(size.x * ratio));
            this._canvas.height = Math.max(1, Math.round(size.y * ratio));
            this._canvas.style.width = size.x + 'px';
            this._canvas.style.height = size.y + 'px';
            var topLeft = map.containerPointToLayerPoint([0, 0]);
            root.L.DomUtil.setPosition(this._canvas, topLeft);
            var ctx = this._ctx;
            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            ctx.clearRect(0, 0, size.x, size.y);
            var accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2389ca';
            if (this._mode === 'hidden') {
                return;
            }
            if (this._mode === 'playback') {
                this._playbackTrail.forEach(function(item) {
                    var entry = item.entry;
                    var point = map.latLngToContainerPoint([entry.latitude, entry.longitude]);
                    if (point.x < -6 || point.y < -6 || point.x > size.x + 6 || point.y > size.y + 6 || item.alpha <= 0) {
                        return;
                    }
                    ctx.fillStyle = playbackColor(item.alpha);
                    ctx.globalAlpha = item.alpha * 0.9;
                    ctx.beginPath();
                    ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
                    ctx.fill();
                });
                ctx.globalAlpha = 1;
                return;
            }
            for (var i = this._startIndex; i < this._endIndex; i += 1) {
                var entry = this._entries[i];
                var point = map.latLngToContainerPoint([entry.latitude, entry.longitude]);
                if (point.x < -3 || point.y < -3 || point.x > size.x + 3 || point.y > size.y + 3) {
                    continue;
                }
                if (this._mode === 'rainbow' && this._timeDomain && this._timeDomain.end > this._timeDomain.start) {
                    var fraction = (entry.timestamp - this._timeDomain.start) / (this._timeDomain.end - this._timeDomain.start);
                    ctx.fillStyle = 'hsl(' + Math.round((1 - Math.max(0, Math.min(1, fraction))) * 300) + ', 78%, 52%)';
                } else {
                    ctx.fillStyle = accent;
                }
                ctx.globalAlpha = 0.75;
                ctx.beginPath();
                ctx.arc(point.x, point.y, 2.7, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
        },
        _onClick: function(event) {
            if (this._mode === 'hidden' || this._mode === 'playback' || !event || !event.latlng) {
                return;
            }
            var clickPoint = this._map.latLngToContainerPoint(event.latlng);
            var closest = null;
            var closestDistance = 10;
            for (var i = this._startIndex; i < this._endIndex; i += 1) {
                var entry = this._entries[i];
                var point = this._map.latLngToContainerPoint([entry.latitude, entry.longitude]);
                var distance = point.distanceTo(clickPoint);
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closest = entry;
                }
            }
            if (!closest) {
                return;
            }
            var content = document.createElement('div');
            var name = document.createElement('strong');
            name.textContent = closest.sourcePath.split(/[\\/]/).pop() || closest.sourcePath;
            content.appendChild(name);
            var local = document.createElement('div');
            local.textContent = closest.localDateTime + (closest.offset ? ' ' + closest.offset : '');
            content.appendChild(local);
            var utc = document.createElement('div');
            utc.textContent = formatTime(closest.timestamp);
            content.appendChild(utc);
            var path = document.createElement('small');
            path.textContent = closest.sourcePath;
            content.appendChild(path);
            var deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.className = 'gps-log-point-delete';
            deleteButton.textContent = 'Delete point';
            var layer = this;
            deleteButton.addEventListener('click', function(clickEvent) {
                clickEvent.preventDefault();
                clickEvent.stopPropagation();
                layer.fire('delete-entry', { entry: closest });
                layer._map.closePopup();
            });
            content.appendChild(deleteButton);
            root.L.popup().setLatLng(event.latlng).setContent(content).openOn(this._map);
        }
    }) : function() {};

    function lowerBound(entries, timestamp) {
        var lo = 0;
        var hi = entries.length;
        while (lo < hi) {
            var mid = (lo + hi) >> 1;
            if (entries[mid].timestamp < timestamp) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        return lo;
    }

    function upperBound(entries, timestamp) {
        var lo = 0;
        var hi = entries.length;
        while (lo < hi) {
            var mid = (lo + hi) >> 1;
            if (entries[mid].timestamp <= timestamp) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        return lo;
    }

    function playbackColor(alpha) {
        var stops = ['#dc777d', '#e7a08b', '#e6d48f', '#8dc9c2', '#789bd0', '#7774b8'];
        var position = (1 - Math.max(0.1, Math.min(1, alpha))) / 0.9 * (stops.length - 1);
        var index = Math.min(stops.length - 2, Math.floor(position));
        var fraction = position - index;
        var from = stops[index].match(/[\da-f]{2}/gi).map(function(value) { return parseInt(value, 16); });
        var to = stops[index + 1].match(/[\da-f]{2}/gi).map(function(value) { return parseInt(value, 16); });
        var rgb = from.map(function(value, channel) {
            return Math.round(value + (to[channel] - value) * fraction);
        });
        return 'rgb(' + rgb.join(',') + ')';
    }

    return { create: create };
});
