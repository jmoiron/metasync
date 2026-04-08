$(function() {
    var paneMaps = new WeakMap();
    var markerIcon = null;
    var defaultMapView = [20, 0];
    var defaultMapZoom = 2;
    var selectedPhotoZoom = 15;
    var pairIDCounter = 1;
    var syncPairs = [];
    var adjustedTimesByTargetID = {};
    var gpsPreviewByTargetID = {};
    var mapPickMode = false;
    var collapsedGroups = {};

    var $workspace = $('[data-role="workspace"]');
    if ($workspace.length === 0) {
        return;
    }

    var panes = {
        target: buildPaneState($workspace.find('.pane[data-side="left"]'), 'target'),
        reference: buildPaneState($workspace.find('.pane[data-side="right"]'), 'reference')
    };

    applyTheme(localStorage.getItem('theme') || 'light');
    bindBasicControls();
    bindPhotoSelection();
    bindMetadataToggle();
    bindSyncControls();
    bindLensControls();
    renderGroups();
    refreshSyncUI();
    hideApplyResults();
    applyLensHighlightState();

    function buildPaneState($pane, sideName) {
        var cards = [];
        $pane.find('.photo-card').each(function(index) {
            var $card = $(this);
            cards.push({
                id: String($card.data('photoId') || ''),
                order: index,
                side: sideName,
                baseExifMs: parseExifTime($card.attr('data-base-exif-time')),
                $el: $card
            });
            ensureAdjustedBadge($card);
        });

        cards.sort(function(a, b) {
            return compareCardsByTimeThenOrder(a.baseExifMs, b.baseExifMs, a.order, b.order);
        });
        for (var i = 0; i < cards.length; i += 1) {
            cards[i].index = i;
        }

        return {
            side: sideName,
            $pane: $pane,
            cards: cards
        };
    }

    function bindBasicControls() {
        $('#theme-toggle').on('click', function() {
            var cur = localStorage.getItem('theme') || 'light';
            var next = cur === 'dark' ? 'light' : 'dark';
            localStorage.setItem('theme', next);
            applyTheme(next);
        });

        $('#controls-toggle').on('click', function() {
            var $button = $(this);
            var $form = $('#load-form');
            $form.toggleClass('is-collapsed');
            $button.attr('aria-expanded', $form.hasClass('is-collapsed') ? 'false' : 'true');
        });

        $('#sync-tools-toggle').on('click', function() {
            var $button = $(this);
            var $tools = $('#sync-tools');
            $tools.toggleClass('is-collapsed');
            $button.attr('aria-expanded', $tools.hasClass('is-collapsed') ? 'false' : 'true');
        });
    }

    function bindPhotoSelection() {
        $workspace.on('click', '.photo-card', function() {
            var $card = $(this);
            var $pane = $card.closest('.pane');

            $pane.find('.photo-card').removeClass('is-selected');
            $card.addClass('is-selected');
            updatePaneMetadataFromCard($pane, $card);
            if ($pane.is(panes.target.$pane) && String($('#scope').val() || 'global') === 'session') {
                renderGroupsForPane(panes.target);
            }
            syncPaneMap($pane);
            updateReferenceNeighborHighlightForSelection();
        });
    }

    function bindMetadataToggle() {
        $workspace.on('click', '.metadata-toggle-btn', function() {
            var $button = $(this);
            var mode = String($button.data('mode'));
            var $panel = $button.closest('.metadata-panel');

            setMetadataPanelMode($panel.closest('.pane'), mode);
            if (mode === 'map') {
                syncPaneMap($button.closest('.pane'));
            }
        });
    }

    function bindSyncControls() {
        $('#scope').on('change', function() {
            renderGroups();
        });

        $('#grouping-mode').on('change', function() {
            renderGroups();
        });
        $('#session-minutes').on('input change', function() {
            if (String($('#grouping-mode').val()) === 'session') {
                renderGroups();
            }
        });

        $('#add-sync-pair').on('click', function() {
            addSyncPairFromSelection();
        });
        $('#clear-sync-pairs').on('click', function() {
            syncPairs = [];
            adjustedTimesByTargetID = {};
            applyTimePreview();
            renderGroups();
            refreshSyncUI();
            applyLensHighlightState();
        });
        $('#sync-pairs').on('click', '.sync-pair-remove', function() {
            var pairID = Number($(this).attr('data-pair-id'));
            syncPairs = syncPairs.filter(function(pair) {
                return pair.id !== pairID;
            });
            refreshSyncUI();
        });

        $('#preview-all').on('click', function() {
            recomputeAdjustedTimes();
            applyTimePreview();
            clearMapPickMode();
            recomputeGPSPreview(true);
            applyGPSPreview();
            renderGroups();
            refreshSyncUI();
            applyLensHighlightState();
            updateReferenceNeighborHighlightForSelection();
        });
        $('#gps-from-reference').on('click', function() {
            clearMapPickMode();
            applyGPSFromSelectedReference();
        });
        $('#gps-from-prev-target').on('click', function() {
            clearMapPickMode();
            applyGPSFromPreviousTarget();
        });
        $('#gps-from-map').on('click', function() {
            beginMapGPSPick();
        });

        $('#apply-sync').on('click', function() {
            applyChangesToFiles();
        });

        $workspace.on('click', '.timeline-group-title', function() {
            var $title = $(this);
            var groupKey = String($title.attr('data-group-key') || '');
            if (!groupKey) {
                return;
            }
            var isCollapsed = $title.attr('data-collapsed') === '1';
            var next = !isCollapsed;
            collapsedGroups[groupKey] = next;
            $title.attr('data-collapsed', next ? '1' : '0');
            $title.attr('aria-expanded', next ? 'false' : 'true');
            $title.closest('.timeline-group').toggleClass('is-collapsed', next);
        });
    }

    function bindLensControls() {
        $('#lens-unsaved, #lens-missing-gps').on('change', function() {
            applyLensHighlightState();
        });
        $('#dismiss-apply-results').on('click', function() {
            hideApplyResults();
        });
    }

    function addSyncPairFromSelection() {
        var $target = selectedCardForPane(panes.target.$pane);
        var $reference = selectedCardForPane(panes.reference.$pane);
        if ($target.length === 0 || $reference.length === 0) {
            $('#sync-status').text('Select one target and one reference image first.');
            return;
        }

        var targetID = String($target.data('photoId') || '');
        var referenceID = String($reference.data('photoId') || '');
        var targetInfo = cardInfoByID(panes.target, targetID);
        var referenceInfo = cardInfoByID(panes.reference, referenceID);
        if (!targetInfo || !referenceInfo) {
            return;
        }
        if (!Number.isFinite(targetInfo.baseExifMs) || !Number.isFinite(referenceInfo.baseExifMs)) {
            $('#sync-status').text('Both selected images need EXIF timestamps for sync pairing.');
            return;
        }

        syncPairs.push({
            id: pairIDCounter,
            targetID: targetID,
            referenceID: referenceID,
            targetIndex: targetInfo.index,
            deltaMs: referenceInfo.baseExifMs - targetInfo.baseExifMs,
            targetLabel: String($target.data('basename') || targetID),
            referenceLabel: String($reference.data('basename') || referenceID)
        });
        pairIDCounter += 1;
        refreshSyncUI();
    }

    function recomputeAdjustedTimes() {
        adjustedTimesByTargetID = {};
        if (syncPairs.length === 0) {
            return;
        }

        var sortedPairs = syncPairs
            .slice()
            .sort(function(a, b) {
                if (a.targetIndex !== b.targetIndex) {
                    return a.targetIndex - b.targetIndex;
                }
                return a.id - b.id;
            });
        if (sortedPairs.length === 0) {
            return;
        }

        var currentPair = sortedPairs[0];
        var pairIdx = 0;
        for (var i = 0; i < panes.target.cards.length; i += 1) {
            var info = panes.target.cards[i];
            if (!Number.isFinite(info.baseExifMs)) {
                continue;
            }
            while (pairIdx + 1 < sortedPairs.length && i >= sortedPairs[pairIdx + 1].targetIndex) {
                pairIdx += 1;
                currentPair = sortedPairs[pairIdx];
            }
            adjustedTimesByTargetID[info.id] = info.baseExifMs + currentPair.deltaMs;
        }
    }

    function recomputeGPSPreview(forceGlobal) {
        gpsPreviewByTargetID = {};

        var scope = forceGlobal ? 'global' : String($('#scope').val() || 'global');
        var strategy = String($('#gps-strategy').val() || 'closest');
        var cutoffMin = Math.max(1, Number($('#gps-cutoff-minutes').val()) || 30);
        var cutoffMs = cutoffMin * 60 * 1000;
        var targetCards = targetCardsForScope(scope);

        if ((scope === 'image' || scope === 'session') && targetCards.length === 0) {
            $('#sync-status').text('Select a target image for image/session GPS preview scope.');
            return;
        }

        targetCards.forEach(function(info) {
            var curLat = parseFloat(info.$el.attr('data-gps-lat'));
            var curLon = parseFloat(info.$el.attr('data-gps-lon'));
            if (Number.isFinite(curLat) && Number.isFinite(curLon)) {
                return;
            }

            var targetMs = currentTargetMs(info);
            if (!Number.isFinite(targetMs)) {
                return;
            }

            var refs = surroundingReferences(targetMs);
            var candidate = null;
            if (strategy === 'interpolate') {
                candidate = interpolatedGPSCandidate(targetMs, refs.before, refs.after, cutoffMs);
                if (!candidate) {
                    candidate = closestGPSCandidate(targetMs, refs.before, refs.after, cutoffMs);
                }
            } else {
                candidate = closestGPSCandidate(targetMs, refs.before, refs.after, cutoffMs);
            }

            if (candidate) {
                gpsPreviewByTargetID[info.id] = candidate;
            }
        });
    }

    function setPreviewGPSForScope(lat, lon, source) {
        var scope = String($('#scope').val() || 'global');
        var targetCards = targetCardsForScope(scope);
        if ((scope === 'image' || scope === 'session') && targetCards.length === 0) {
            $('#sync-status').text('Select a target image for image/session GPS preview scope.');
            return false;
        }
        gpsPreviewByTargetID = {};
        targetCards.forEach(function(info) {
            gpsPreviewByTargetID[info.id] = { lat: lat, lon: lon, source: source || 'manual' };
        });
        applyGPSPreview();
        applyLensHighlightState();
        updateReferenceNeighborHighlightForSelection();
        $('#sync-status').text('Previewed GPS for ' + targetCards.length + ' target image' + (targetCards.length === 1 ? '' : 's') + '.');
        return true;
    }

    function applyGPSFromSelectedReference() {
        var $selectedRef = selectedCardForPane(panes.reference.$pane);
        if ($selectedRef.length === 0) {
            $('#sync-status').text('Select a reference image with GPS first.');
            return;
        }
        var lat = parseFloat($selectedRef.attr('data-gps-lat'));
        var lon = parseFloat($selectedRef.attr('data-gps-lon'));
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            $('#sync-status').text('Selected reference image has no GPS data.');
            return;
        }
        setPreviewGPSForScope(lat, lon, 'reference');
    }

    function applyGPSFromPreviousTarget() {
        var $selectedTarget = selectedCardForPane(panes.target.$pane);
        if ($selectedTarget.length === 0) {
            $('#sync-status').text('Select a target image first.');
            return;
        }
        var selectedID = String($selectedTarget.data('photoId') || '');
        var selectedInfo = cardInfoByID(panes.target, selectedID);
        if (!selectedInfo) {
            $('#sync-status').text('Selected target image not found.');
            return;
        }

        var sorted = panes.target.cards.slice().sort(function(a, b) {
            return compareCardsByTimeThenOrder(currentTargetMs(a), currentTargetMs(b), a.order, b.order);
        });
        var selectedPos = -1;
        for (var i = 0; i < sorted.length; i += 1) {
            if (sorted[i].id === selectedID) {
                selectedPos = i;
                break;
            }
        }
        if (selectedPos <= 0) {
            $('#sync-status').text('No previous target image available.');
            return;
        }

        for (var j = selectedPos - 1; j >= 0; j -= 1) {
            var $candidate = sorted[j].$el;
            var lat = parseFloat($candidate.attr('data-gps-lat'));
            var lon = parseFloat($candidate.attr('data-gps-lon'));
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
                continue;
            }
            setPreviewGPSForScope(lat, lon, 'prev-target');
            return;
        }

        $('#sync-status').text('No previous target image with GPS data found.');
    }

    function beginMapGPSPick() {
        mapPickMode = true;
        $('#gps-from-map').addClass('is-armed');
        setMetadataPanelMode(panes.target.$pane, 'map');
        var mapState = ensurePaneMap(panes.target.$pane);
        if (mapState) {
            updatePaneMap(mapState, mapState.map.getCenter(), mapState.map.getZoom());
        }
        $('#sync-status').text('Map pick armed: click the target map to set GPS for the selected scope.');
    }

    function clearMapPickMode() {
        mapPickMode = false;
        $('#gps-from-map').removeClass('is-armed');
    }

    function targetCardsForScope(scope) {
        if (scope === 'global') {
            return panes.target.cards.slice();
        }

        var $selected = selectedCardForPane(panes.target.$pane);
        if ($selected.length === 0) {
            return [];
        }
        var selectedID = String($selected.data('photoId') || '');
        var selectedInfo = cardInfoByID(panes.target, selectedID);
        if (!selectedInfo) {
            return [];
        }

        if (scope === 'image') {
            return [selectedInfo];
        }

        var sessionMin = Math.max(1, Number($('#session-minutes').val()) || 5);
        var threshold = sessionMin * 60 * 1000;
        var sessions = buildTargetSessions(threshold);
        for (var i = 0; i < sessions.length; i += 1) {
            var session = sessions[i];
            var found = session.some(function(info) {
                return info.id === selectedID;
            });
            if (found) {
                return session;
            }
        }
        return [selectedInfo];
    }

    function buildTargetSessions(thresholdMs) {
        var withTime = panes.target.cards
            .slice()
            .filter(function(info) {
                return Number.isFinite(currentTargetMs(info));
            })
            .sort(function(a, b) {
                return currentTargetMs(a) - currentTargetMs(b);
            });

        var sessions = [];
        var current = null;
        withTime.forEach(function(info) {
            var ms = currentTargetMs(info);
            if (!current || ms-current.lastMs > thresholdMs) {
                current = [];
                current.lastMs = ms;
                sessions.push(current);
            }
            current.push(info);
            current.lastMs = ms;
        });
        return sessions;
    }

    function surroundingReferences(targetMs) {
        var before = null;
        var after = null;
        panes.reference.cards.forEach(function(info) {
            var ms = parseExifTime(info.$el.attr('data-exif-time'));
            var lat = parseFloat(info.$el.attr('data-gps-lat'));
            var lon = parseFloat(info.$el.attr('data-gps-lon'));
            if (!Number.isFinite(ms) || !Number.isFinite(lat) || !Number.isFinite(lon)) {
                return;
            }
            if (ms <= targetMs && (!before || ms > before.ms)) {
                before = { ms: ms, lat: lat, lon: lon, info: info };
            }
            if (ms >= targetMs && (!after || ms < after.ms)) {
                after = { ms: ms, lat: lat, lon: lon, info: info };
            }
        });
        return { before: before, after: after };
    }

    function closestGPSCandidate(targetMs, before, after, cutoffMs) {
        var bDiff = before ? Math.abs(targetMs-before.ms) : Number.POSITIVE_INFINITY;
        var aDiff = after ? Math.abs(after.ms-targetMs) : Number.POSITIVE_INFINITY;
        var pick = bDiff <= aDiff ? before : after;
        var diff = Math.min(bDiff, aDiff);
        if (!pick || diff > cutoffMs) {
            return null;
        }
        return { lat: pick.lat, lon: pick.lon, source: 'closest' };
    }

    function interpolatedGPSCandidate(targetMs, before, after, cutoffMs) {
        if (!before || !after) {
            return null;
        }
        var bDiff = Math.abs(targetMs-before.ms);
        var aDiff = Math.abs(after.ms-targetMs);
        if (bDiff > cutoffMs || aDiff > cutoffMs) {
            return null;
        }
        if (after.ms === before.ms) {
            return { lat: before.lat, lon: before.lon, source: 'interpolate' };
        }
        var ratio = (targetMs-before.ms) / (after.ms-before.ms);
        return {
            lat: before.lat + (after.lat-before.lat) * ratio,
            lon: before.lon + (after.lon-before.lon) * ratio,
            source: 'interpolate'
        };
    }

    function applyTimePreview() {
        panes.target.cards.forEach(function(info) {
            var $card = info.$el;
            var baseExifTime = $card.attr('data-base-exif-time') || 'n/a';
            var adjustedMs = adjustedTimesByTargetID[info.id];
            if (Number.isFinite(adjustedMs)) {
                var adjustedText = formatExif(new Date(adjustedMs));
                $card.attr('data-exif-time', adjustedText);
                $card.attr('data-adjusted-exif-time', adjustedText);
                $card.addClass('has-adjusted');
                $card.find('.thumb-adjusted').text(adjustedText);
            } else {
                $card.attr('data-exif-time', baseExifTime);
                $card.removeAttr('data-adjusted-exif-time');
                $card.removeClass('has-adjusted');
                $card.find('.thumb-adjusted').text('');
            }
        });

        var $selectedTarget = selectedCardForPane(panes.target.$pane);
        if ($selectedTarget.length > 0) {
            updatePaneMetadataFromCard(panes.target.$pane, $selectedTarget);
            syncPaneMap(panes.target.$pane);
        }
        var $selectedReference = selectedCardForPane(panes.reference.$pane);
        if ($selectedReference.length > 0) {
            updatePaneMetadataFromCard(panes.reference.$pane, $selectedReference);
        }
    }

    function applyGPSPreview() {
        panes.target.cards.forEach(function(info) {
            var $card = info.$el;
            var preview = gpsPreviewByTargetID[info.id];
            if (!preview) {
                return;
            }
            var latText = formatCoord(preview.lat);
            var lonText = formatCoord(preview.lon);
            $card.attr('data-gps-lat', latText);
            $card.attr('data-gps-lon', lonText);
            $card.attr('data-exif-gps', latText + ', ' + lonText);
            $card.addClass('has-gps-adjusted');
        });

        var $selectedTarget = selectedCardForPane(panes.target.$pane);
        if ($selectedTarget.length > 0) {
            updatePaneMetadataFromCard(panes.target.$pane, $selectedTarget);
        }
        var $selectedReference = selectedCardForPane(panes.reference.$pane);
        if ($selectedReference.length > 0) {
            updatePaneMetadataFromCard(panes.reference.$pane, $selectedReference);
        }
    }

    function refreshSyncUI() {
        var $status = $('#sync-status');
        var $pairs = $('#sync-pairs');
        if (syncPairs.length === 0) {
            $status.text('No sync pairs');
            $pairs.empty();
            return;
        }

        $status.text(syncPairs.length + ' sync pair' + (syncPairs.length === 1 ? '' : 's'));
        $pairs.empty();
        syncPairs
            .slice()
            .sort(function(a, b) {
                return a.targetIndex - b.targetIndex;
            })
            .forEach(function(pair) {
                var $row = $('<div class="sync-pair"></div>');
                var $meta = $('<div class="sync-pair-meta"></div>');
                $meta.append('<span class="sync-pair-label">' + escapeHTML(pair.targetLabel) + ' -> ' + escapeHTML(pair.referenceLabel) + '</span>');
                $meta.append('<span class="sync-pair-delta">Δ ' + formatDelta(pair.deltaMs) + '</span>');
                $row.append($meta);
                $row.append('<button type="button" class="sync-pair-remove" data-pair-id="' + pair.id + '">x</button>');
                $pairs.append($row);
            });
    }

    function renderGroups() {
        renderGroupsForPane(panes.target);
        renderGroupsForPane(panes.reference);
    }

    function renderGroupsForPane(pane) {
        var $timeline = pane.$pane.find('.timeline');
        if (pane.cards.length === 0) {
            return;
        }
        var prevScrollTop = $timeline.scrollTop();

        var mode = String($('#grouping-mode').val() || 'session');
        var scope = String($('#scope').val() || 'global');
        var selectedTargetID = '';
        if (scope === 'session' && pane.side === 'target') {
            var $selectedTarget = selectedCardForPane(panes.target.$pane);
            if ($selectedTarget.length > 0) {
                selectedTargetID = String($selectedTarget.data('photoId') || '');
            }
        }
        var sessionMin = Math.max(1, Number($('#session-minutes').val()) || 5);
        var groups = buildGroups(pane.cards, mode, sessionMin);

        $timeline.empty();
        groups.forEach(function(group) {
            var $group = $('<div class="timeline-group"></div>');
            var groupKey = pane.side + '|' + mode + '|' + group.key;
            var collapsed = !!collapsedGroups[groupKey];
            var title = group.title + ' (' + group.cards.length + ')';
            var $title = $('<button type="button" class="timeline-group-title"></button>');
            $title.attr('data-group-key', groupKey);
            $title.attr('data-collapsed', collapsed ? '1' : '0');
            $title.attr('aria-expanded', collapsed ? 'false' : 'true');
            $title.text(title);
            $group.append($title);

            var $grid = $('<div class="thumb-grid"></div>');
            group.cards.forEach(function(info) {
                $grid.append(info.$el.closest('[data-lens-wrap="unsaved"]'));
            });
            $group.append($grid);

            if (pane.side === 'target' && mode === 'session' && scope === 'session' && selectedTargetID !== '') {
                var isSelectedSession = group.cards.some(function(info) {
                    return info.id === selectedTargetID;
                });
                $group.toggleClass('scope-selected', isSelectedSession);
                $group.toggleClass('scope-unselected', !isSelectedSession);
            }

            $group.toggleClass('is-collapsed', collapsed);
            $timeline.append($group);
        });
        $timeline.scrollTop(prevScrollTop);
    }

    function buildGroups(cards, mode, sessionMin) {
        var groups = [];
        var byKey = {};
        var noTime = { key: 'none', title: 'No timestamp', cards: [] };
        var sorted = cards
            .slice()
            .sort(function(a, b) {
                var aMs = currentCardExifMs(a.$el);
                var bMs = currentCardExifMs(b.$el);
                return compareCardsByTimeThenOrder(aMs, bMs, a.order, b.order);
            });

        if (mode === 'session') {
            var threshold = sessionMin * 60 * 1000;
            var current = null;
            sorted.forEach(function(info) {
                var ms = currentCardExifMs(info.$el);
                if (!Number.isFinite(ms)) {
                    noTime.cards.push(info);
                    return;
                }
                if (!current || ms-current.lastMs > threshold) {
                    current = {
                        key: 'session:' + ms,
                        title: 'Session · ' + formatGroupDate(ms),
                        lastMs: ms,
                        cards: []
                    };
                    groups.push(current);
                }
                current.cards.push(info);
                current.lastMs = ms;
            });
        } else {
            sorted.forEach(function(info) {
                var ms = currentCardExifMs(info.$el);
                if (!Number.isFinite(ms)) {
                    noTime.cards.push(info);
                    return;
                }
                var key = keyForTime(mode, ms);
                if (!byKey[key]) {
                    byKey[key] = {
                        key: key,
                        title: titleForGroup(mode, ms),
                        sortMs: groupSortTime(mode, ms),
                        cards: []
                    };
                    groups.push(byKey[key]);
                }
                byKey[key].cards.push(info);
            });
            groups.sort(function(a, b) {
                return a.sortMs - b.sortMs;
            });
        }

        if (noTime.cards.length > 0) {
            groups.push(noTime);
        }
        return groups;
    }

    function applyLensHighlightState() {
        var unsavedActive = $('#lens-unsaved').is(':checked');
        var missingActive = $('#lens-missing-gps').is(':checked');
        $('body').toggleClass('lens-unsaved-active', unsavedActive);
        $('body').toggleClass('lens-missing-gps-active', missingActive);

        allCards().forEach(function($card) {
            var hasUnsaved = cardHasUnsavedChanges($card);
            var missingGPS = cardMissingGPS($card);
            cardLensWrap($card, 'unsaved').toggleClass('is-highlighted', hasUnsaved);
            cardLensWrap($card, 'missing-gps').toggleClass('is-highlighted', missingGPS);
        });

        updateSaveButtonVisibility();
    }

    function updateReferenceNeighborHighlightForSelection() {
        panes.reference.$pane.find('.photo-card').removeClass('ref-before-highlight ref-after-highlight');
        var $selectedTarget = selectedCardForPane(panes.target.$pane);
        if ($selectedTarget.length === 0) {
            return;
        }
        if (!cardMissingGPS($selectedTarget)) {
            return;
        }
        var targetMs = currentCardExifMs($selectedTarget);
        if (!Number.isFinite(targetMs)) {
            return;
        }
        var refs = surroundingReferences(targetMs);
        if (refs.before && refs.before.info) {
            refs.before.info.$el.addClass('ref-before-highlight');
        }
        if (refs.after && refs.after.info) {
            refs.after.info.$el.addClass('ref-after-highlight');
        }
    }

    function cardHasUnsavedChanges($card) {
        var baseExif = $card.attr('data-base-exif-time') || '';
        var curExif = $card.attr('data-exif-time') || '';
        if (baseExif !== curExif) {
            return true;
        }
        var baseLat = normalizeCoordText($card.attr('data-base-gps-lat') || '');
        var baseLon = normalizeCoordText($card.attr('data-base-gps-lon') || '');
        var curLat = normalizeCoordText($card.attr('data-gps-lat') || '');
        var curLon = normalizeCoordText($card.attr('data-gps-lon') || '');
        return baseLat !== curLat || baseLon !== curLon;
    }

    function cardMissingGPS($card) {
        var lat = parseFloat($card.attr('data-gps-lat'));
        var lon = parseFloat($card.attr('data-gps-lon'));
        return !Number.isFinite(lat) || !Number.isFinite(lon);
    }

    function updatePaneMetadataFromCard($pane, $card) {
        var isTargetPane = $pane.is(panes.target.$pane);
        var originalExif = $card.attr('data-base-exif-time') || 'n/a';
        var currentExif = $card.attr('data-exif-time') || 'n/a';
        var hasTimePreview = isTargetPane && originalExif !== 'n/a' && currentExif !== originalExif;

        var originalGPS = $card.attr('data-base-exif-gps') || 'n/a';
        var currentGPS = $card.attr('data-exif-gps') || 'n/a';
        var hasGPSPreview = isTargetPane && originalGPS !== currentGPS;

        $pane.find('[data-field="basename"]').text($card.data('basename') || 'n/a');
        $pane.find('[data-field="modtime"]').text($card.data('modtime') || 'n/a');
        $pane.find('[data-field="size"]').text(formatBytes(Number($card.data('size') || 0)));
        $pane.find('[data-field="resolution"]').text($card.data('resolution') || 'n/a');
        var $exifTime = $pane.find('[data-field="exif-time"]');
        var $exifGPS = $pane.find('[data-field="exif-gps"]');
        $exifTime.text(currentExif).toggleClass('preview-unsaved', hasTimePreview);
        $exifGPS.text(currentGPS).toggleClass('preview-gps', hasGPSPreview);
        if (hasTimePreview) {
            $exifTime.attr('aria-label', 'Previous EXIF time: ' + originalExif + '. Preview value: ' + currentExif + '.');
        } else {
            $exifTime.removeAttr('aria-label');
        }
        if (hasGPSPreview) {
            $exifGPS.attr('aria-label', 'Previous EXIF GPS: ' + originalGPS + '. Preview value: ' + currentGPS + '.');
        } else {
            $exifGPS.removeAttr('aria-label');
        }
        $pane.find('[data-field="camera-model"]').text($card.data('cameraModel') || 'n/a');
        $pane.find('[data-field="iso"]').text($card.data('iso') || 'n/a');
        $pane.find('[data-field="aperture"]').text($card.data('aperture') || 'n/a');
        $pane.find('[data-field="exposure"]').text($card.data('exposure') || 'n/a');
        $pane.find('[data-field="focal-length"]').text($card.data('focalLength') || 'n/a');
        $pane.find('[data-field="metering-mode"]').text($card.data('meteringMode') || 'n/a');
    }

    function setMetadataPanelMode($pane, mode) {
        if (!$pane || $pane.length === 0) {
            return;
        }
        var $panel = $pane.find('.metadata-panel').first();
        $panel.find('.metadata-toggle-btn').removeClass('is-active');
        $panel.find('.metadata-toggle-btn[data-mode="' + mode + '"]').addClass('is-active');
        $panel.find('.metadata-secondary-panel').removeClass('is-active');
        $panel.find('.metadata-secondary-panel[data-panel="' + mode + '"]').addClass('is-active');
    }

    function syncPaneMap($pane) {
        var mapState = ensurePaneMap($pane);
        if (!mapState) {
            return;
        }
        var $selected = selectedCardForPane($pane);
        var lat = parseFloat($selected.attr('data-gps-lat'));
        var lon = parseFloat($selected.attr('data-gps-lon'));

        if (Number.isFinite(lat) && Number.isFinite(lon)) {
            var latLng = [lat, lon];
            mapState.marker.setLatLng(latLng);
            mapState.marker.addTo(mapState.map);
            updatePaneMap(mapState, latLng, selectedPhotoZoom);
        } else {
            if (mapState.map.hasLayer(mapState.marker)) {
                mapState.map.removeLayer(mapState.marker);
            }
            updatePaneMap(mapState, defaultMapView, defaultMapZoom);
        }
    }

    function ensurePaneMap($pane) {
        var paneEl = $pane.get(0);
        if (!paneEl) {
            return null;
        }
        var existing = paneMaps.get(paneEl);
        if (existing) {
            return existing;
        }
        var canvas = $pane.find('[data-map-canvas]').get(0);
        if (!canvas || typeof L === 'undefined') {
            return null;
        }

        var map = L.map(canvas, { zoomControl: false }).setView(defaultMapView, defaultMapZoom);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(map);

        if (!markerIcon) {
            markerIcon = L.icon({
                iconUrl: '/static/vendor/css/images/marker-icon.png',
                iconRetinaUrl: '/static/vendor/css/images/marker-icon-2x.png',
                shadowUrl: '/static/vendor/css/images/marker-shadow.png',
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34],
                shadowSize: [41, 41]
            });
        }
        var marker = L.marker(defaultMapView, { icon: markerIcon });
        map.on('click', function(evt) {
            handlePaneMapClick($pane, evt);
        });
        existing = { map: map, marker: marker };
        paneMaps.set(paneEl, existing);
        return existing;
    }

    function handlePaneMapClick($pane, evt) {
        if (!$pane || !$pane.is(panes.target.$pane) || !mapPickMode || !evt || !evt.latlng) {
            return;
        }
        var lat = Number(evt.latlng.lat);
        var lon = Number(evt.latlng.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            $('#sync-status').text('Invalid map coordinate selected.');
            clearMapPickMode();
            return;
        }
        var ok = setPreviewGPSForScope(lat, lon, 'map');
        clearMapPickMode();
        if (!ok) {
            return;
        }
        $('#sync-status').text('Previewed GPS from map point for selected scope.');
    }

    function updatePaneMap(mapState, center, zoom) {
        window.setTimeout(function() {
            mapState.map.invalidateSize();
            mapState.map.setView(center, zoom);
        }, 0);
    }

    function selectedCardForPane($pane) {
        return $pane.find('.photo-card.is-selected').first();
    }

    function cardInfoByID(pane, id) {
        for (var i = 0; i < pane.cards.length; i += 1) {
            if (pane.cards[i].id === id) {
                return pane.cards[i];
            }
        }
        return null;
    }

    function cardLensWrap($card, lensName) {
        return $card.closest('[data-lens-wrap="' + lensName + '"]');
    }

    function ensureAdjustedBadge($card) {
        if ($card.find('.thumb-adjusted').length === 0) {
            $card.append('<span class="thumb-adjusted"></span>');
        }
        if ($card.find('.thumb-gps-adjusted').length === 0) {
            $card.append('<span class="thumb-gps-adjusted">GPS adjusted</span>');
        }
    }

    function currentTargetMs(info) {
        if (Number.isFinite(adjustedTimesByTargetID[info.id])) {
            return adjustedTimesByTargetID[info.id];
        }
        return currentCardExifMs(info.$el);
    }

    function allCards() {
        return panes.target.cards.map(function(info) { return info.$el; })
            .concat(panes.reference.cards.map(function(info) { return info.$el; }));
    }

    function applyChangesToFiles() {
        var changes = [];
        panes.target.cards.forEach(function(info) {
            var $card = info.$el;
            var baseExif = $card.attr('data-base-exif-time') || '';
            var curExif = $card.attr('data-exif-time') || '';
            var baseLat = normalizeCoordText($card.attr('data-base-gps-lat') || '');
            var baseLon = normalizeCoordText($card.attr('data-base-gps-lon') || '');
            var curLat = normalizeCoordText($card.attr('data-gps-lat') || '');
            var curLon = normalizeCoordText($card.attr('data-gps-lon') || '');

            var change = {
                path: String($card.data('path') || '')
            };
            var changed = false;

            if (baseExif !== curExif && curExif !== '' && curExif !== 'n/a') {
                change.exif_time = curExif;
                changed = true;
            }
            if (baseLat !== curLat && curLat !== '') {
                change.gps_latitude = Number(curLat);
                changed = true;
            }
            if (baseLon !== curLon && curLon !== '') {
                change.gps_longitude = Number(curLon);
                changed = true;
            }

            if (changed && change.path !== '') {
                changes.push(change);
            }
        });

        if (changes.length === 0) {
            $('#sync-status').text('No pending EXIF changes to apply.');
            return;
        }

        $('#sync-status').text('Applying ' + changes.length + ' file changes...');
        fetch('/apply', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ changes: changes })
        }).then(function(resp) {
            if (!resp.ok) {
                return resp.text().then(function(text) {
                    throw new Error(text || ('HTTP ' + resp.status));
                });
            }
            return resp.json();
        }).then(function(resp) {
            var applied = Array.isArray(resp.applied) ? resp.applied : [];
            var errors = Array.isArray(resp.errors) ? resp.errors : [];

            var appliedSet = {};
            for (var i = 0; i < applied.length; i += 1) {
                appliedSet[applied[i]] = true;
            }

            panes.target.cards.forEach(function(info) {
                var $card = info.$el;
                var path = String($card.data('path') || '');
                if (!appliedSet[path]) {
                    return;
                }

                var curExif = $card.attr('data-exif-time') || '';
                var curGPS = $card.attr('data-exif-gps') || '';
                var curLat = $card.attr('data-gps-lat') || '';
                var curLon = $card.attr('data-gps-lon') || '';
                $card.attr('data-base-exif-time', curExif);
                $card.attr('data-base-exif-gps', curGPS);
                $card.attr('data-base-gps-lat', curLat);
                $card.attr('data-base-gps-lon', curLon);
            });

            applyLensHighlightState();
            var $selectedTarget = selectedCardForPane(panes.target.$pane);
            if ($selectedTarget.length > 0) {
                updatePaneMetadataFromCard(panes.target.$pane, $selectedTarget);
            }

            if (errors.length > 0) {
                $('#sync-status').text('Applied ' + applied.length + ' changes; ' + errors.length + ' failed.');
            } else {
                $('#sync-status').text('Applied ' + applied.length + ' EXIF updates to files.');
            }
            renderApplyResults(applied, errors);
        }).catch(function(err) {
            var msg = 'Failed to apply changes.';
            if (err && err.message) {
                msg = err.message;
            }
            $('#sync-status').text(msg);
            renderApplyResults([], [{ path: 'request', error: msg }]);
        });
    }

    function renderApplyResults(applied, errors) {
        var $panel = $('#apply-results');
        var $body = $('#apply-results-body');
        $body.empty();

        if ((!applied || applied.length === 0) && (!errors || errors.length === 0)) {
            hideApplyResults();
            return;
        }

        (applied || []).forEach(function(path) {
            var $row = $('<div class="apply-results-row"></div>');
            $row.append('<strong>Updated</strong>');
            $row.append(document.createTextNode(path));
            $body.append($row);
        });

        (errors || []).forEach(function(item) {
            var $row = $('<div class="apply-results-row error"></div>');
            $row.append('<strong>Error</strong>');
            var label = (item.path || 'unknown') + ': ' + (item.error || 'unknown error');
            $row.append(document.createTextNode(label));
            $body.append($row);
        });

        $panel.prop('hidden', false);
    }

    function hideApplyResults() {
        $('#apply-results').prop('hidden', true);
        $('#apply-results-body').empty();
    }

    function updateSaveButtonVisibility() {
        var hasUnsaved = panes.target.cards.some(function(info) {
            return cardHasUnsavedChanges(info.$el);
        });
        $('#apply-sync').prop('hidden', !hasUnsaved);
    }
});
