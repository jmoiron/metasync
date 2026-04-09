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
    var activeHeaderMenu = '';
    var workPanelState = {
        time: false,
        gps: false
    };
    var targetSelectionAnchorID = '';
    var lensSettings = {
        unsaved: { highlight: true, hide: false },
        'missing-gps': { highlight: true, hide: false }
    };

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
    bindHeaderMenus();
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
    }

    function bindHeaderMenus() {
        $('[data-menu-target]').on('click', function(evt) {
            evt.stopPropagation();
            var menuID = String($(this).attr('data-menu-target') || '');
            if (menuID === 'time-menu' || menuID === 'gps-menu') {
                toggleWorkPanel(menuID === 'time-menu' ? 'time' : 'gps');
                return;
            }
            toggleHeaderMenu(menuID);
        });

        $(document).on('click', function(evt) {
            var $target = $(evt.target);
            var inTopbarActions = $target.closest('.topbar-actions').length > 0;
            var inFloatingMenu = $target.closest('.header-dropdown-menu').length > 0;
            if (!inTopbarActions && !inFloatingMenu) {
                closeFloatingMenus();
            }
        });

        $(document).on('keydown', function(evt) {
            if (evt.key === 'Escape') {
                closeFloatingMenus();
            }
        });

        $(window).on('resize', function() {
            if (activeHeaderMenu) {
                positionFloatingMenu(activeHeaderMenu);
            }
        });
    }

    function bindPhotoSelection() {
        $workspace.on('click', '.photo-card', function(evt) {
            var $card = $(this);
            var $pane = $card.closest('.pane');

            if ($pane.is(panes.target.$pane) && String($('#scope').val() || 'global') === 'image') {
                updateTargetImageScopeSelection($card, evt);
            } else {
                $pane.find('.photo-card').removeClass('is-selected is-selection-anchor');
                $card.addClass('is-selected');
                if ($pane.is(panes.target.$pane)) {
                    setTargetSelectionAnchor($card);
                }
            }
            updatePaneMetadataFromCard($pane, $card);
            if ($pane.is(panes.target.$pane) && String($('#scope').val() || 'global') === 'session') {
                renderGroupsForPane(panes.target);
            }
            syncSelectionOutlineState();
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
            if (String($(this).val() || 'global') !== 'image') {
                collapseTargetSelectionToAnchor();
            }
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

        $('#apply-time').on('click', function() {
            if (syncPairs.length === 0) {
                $('#sync-status').text('No sync pairs to apply.');
                return;
            }
            recomputeAdjustedTimes();
            applyTimePreview();
            renderGroups();
            refreshSyncUI();
            applyLensHighlightState();
            updateReferenceNeighborHighlightForSelection();
            $('#sync-status').text('Applied time preview from ' + syncPairs.length + ' sync pair' + (syncPairs.length === 1 ? '' : 's') + '.');
            closeHeaderMenus();
        });
        $('#gps-from-reference').on('click', function() {
            clearMapPickMode();
            applyGPSFromSelectedReference();
        });
        $('#gps-from-prev-target').on('click', function() {
            clearMapPickMode();
            applyGPSFromPreviousTarget();
        });
        $('#gps-from-next-target').on('click', function() {
            clearMapPickMode();
            applyGPSFromNextTarget();
        });
        $('#gps-from-map').on('click', function() {
            beginMapGPSPick();
        });
        $('#apply-gps').on('click', function() {
            clearMapPickMode();
            var changed = recomputeGPSPreview(false);
            applyGPSPreview();
            applyLensHighlightState();
            updateReferenceNeighborHighlightForSelection();
            if (changed) {
                closeHeaderMenus();
            }
        });

        $('#apply-sync').on('click', function() {
            if ($(this).prop('disabled')) {
                return;
            }
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
        $workspace.on('click', '.timeline-group-jump', function(evt) {
            evt.preventDefault();
            evt.stopPropagation();
            var targetMs = Number($(this).attr('data-target-ms'));
            if (!Number.isFinite(targetMs)) {
                return;
            }
            selectClosestReferenceForTimestamp(targetMs);
        });
    }

    function bindLensControls() {
        $('.lens-icon-toggle').on('click', function() {
            var $button = $(this);
            var lensName = String($button.attr('data-lens') || '');
            var action = String($button.attr('data-lens-action') || '');
            if (!lensSettings[lensName] || (action !== 'highlight' && action !== 'hide')) {
                return;
            }
            lensSettings[lensName][action] = !lensSettings[lensName][action];
            applyLensHighlightState();
        });
        $('#dismiss-apply-results').on('click', function() {
            hideApplyResults();
        });
    }

    function toggleHeaderMenu(menuID) {
        if (!menuID) {
            closeFloatingMenus();
            return;
        }
        if (activeHeaderMenu === menuID) {
            closeFloatingMenus();
            return;
        }
        activeHeaderMenu = menuID;
        closeFloatingMenus();
        $('#' + menuID).prop('hidden', false).addClass('is-open');
        $('[data-menu-target="' + menuID + '"]').addClass('is-active').attr('aria-expanded', 'true');
        positionFloatingMenu(menuID);
    }

    function closeHeaderMenus() {
        activeHeaderMenu = '';
        workPanelState.time = false;
        workPanelState.gps = false;
        syncWorkPanelState();
        closeFloatingMenus();
    }

    function closeFloatingMenus() {
        activeHeaderMenu = '';
        $('.header-dropdown-menu').prop('hidden', true).removeClass('is-open');
        $('[data-menu-target="scope-menu"], [data-menu-target="group-menu"], [data-menu-target="view-menu"]').removeClass('is-active').attr('aria-expanded', 'false');
    }

    function toggleWorkPanel(panelName) {
        if (panelName !== 'time' && panelName !== 'gps') {
            return;
        }
        activeHeaderMenu = '';
        closeFloatingMenus();

        workPanelState[panelName] = !workPanelState[panelName];
        syncWorkPanelState();
    }

    function syncWorkPanelState() {
        var showTime = !!workPanelState.time;
        var showGPS = !!workPanelState.gps;
        var showDrawer = showTime || showGPS;
        var $workMenu = $('#work-menu');

        $workMenu.prop('hidden', !showDrawer).toggleClass('is-open', showDrawer);
        $('#time-panel').prop('hidden', !showTime);
        $('#gps-panel').prop('hidden', !showGPS);
        $workMenu
            .toggleClass('show-time', showTime)
            .toggleClass('show-gps', showGPS)
            .toggleClass('split-panels', showTime && showGPS);

        $('[data-menu-target="time-menu"]')
            .toggleClass('is-active', showTime)
            .attr('aria-expanded', showTime ? 'true' : 'false');
        $('[data-menu-target="gps-menu"]')
            .toggleClass('is-active', showGPS)
            .attr('aria-expanded', showGPS ? 'true' : 'false');
    }

    function positionFloatingMenu(menuID) {
        var $menu = $('#' + menuID);
        var $trigger = $('[data-menu-target="' + menuID + '"]').first();
        var isFloating = $menu.hasClass('header-dropdown-menu');
        if ($menu.length === 0) {
            return;
        }
        if (!isFloating || $trigger.length === 0) {
            $menu.css({ left: '', top: '', minWidth: '' });
            return;
        }

        var $container = $('#header-menus');
        var triggerOffset = $trigger.offset();
        var containerOffset = $container.offset();
        if (!triggerOffset || !containerOffset) {
            return;
        }
        var left = triggerOffset.left - containerOffset.left;
        var top = triggerOffset.top - containerOffset.top + $trigger.outerHeight() + 8;

        $menu.css({
            left: left + 'px',
            top: top + 'px',
            minWidth: Math.max($trigger.outerWidth(), 0) + 'px'
        });

        var containerWidth = $container.innerWidth();
        var menuOuterWidth = $menu.outerWidth();
        if (menuOuterWidth && containerWidth) {
            left = triggerOffset.left - containerOffset.left + $trigger.outerWidth() - menuOuterWidth;
            left = Math.max(0, Math.min(left, containerWidth - menuOuterWidth));
            $menu.css('left', left + 'px');
        }
    }

    function addSyncPairFromSelection() {
        var $target = activeTargetCard();
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
        var scope = forceGlobal ? 'global' : String($('#scope').val() || 'global');
        var strategy = String($('#gps-strategy').val() || 'closest');
        var cutoffMin = Math.max(1, Number($('#gps-cutoff-minutes').val()) || 30);
        var cutoffMs = cutoffMin * 60 * 1000;
        var targetCards = targetCardsForScope(scope);
        var previewCount = 0;

        if ((scope === 'image' || scope === 'session') && targetCards.length === 0) {
            $('#sync-status').text('Select a target image for image/session GPS preview scope.');
            return false;
        }

        targetCards.forEach(function(info) {
            delete gpsPreviewByTargetID[info.id];
        });

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
                previewCount += 1;
            }
        });
        $('#sync-status').text('Applied GPS preview for ' + previewCount + ' target image' + (previewCount === 1 ? '' : 's') + '.');
        return true;
    }

    function setPreviewGPSForScope(lat, lon, source) {
        var scope = String($('#scope').val() || 'global');
        var targetCards = targetCardsForScope(scope);
        if ((scope === 'image' || scope === 'session') && targetCards.length === 0) {
            $('#sync-status').text('Select a target image for image/session GPS preview scope.');
            return false;
        }
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
        var $selectedTarget = activeTargetCard();
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

    function applyGPSFromNextTarget() {
        var $selectedTarget = activeTargetCard();
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
        if (selectedPos < 0 || selectedPos >= sorted.length - 1) {
            $('#sync-status').text('No next target image available.');
            return;
        }

        for (var j = selectedPos + 1; j < sorted.length; j += 1) {
            var $candidate = sorted[j].$el;
            var lat = parseFloat($candidate.attr('data-gps-lat'));
            var lon = parseFloat($candidate.attr('data-gps-lon'));
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
                continue;
            }
            setPreviewGPSForScope(lat, lon, 'next-target');
            return;
        }

        $('#sync-status').text('No next target image with GPS data found.');
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

        var $selected = activeTargetCard();
        if ($selected.length === 0) {
            return [];
        }
        var selectedID = String($selected.data('photoId') || '');
        var selectedInfo = cardInfoByID(panes.target, selectedID);
        if (!selectedInfo) {
            return [];
        }

        if (scope === 'image') {
            return selectedTargetInfos();
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

        var $selectedTarget = activeTargetCard();
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
                var baseLat = normalizeCoordText($card.attr('data-base-gps-lat') || '');
                var baseLon = normalizeCoordText($card.attr('data-base-gps-lon') || '');
                if (baseLat !== '' && baseLon !== '') {
                    $card.attr('data-gps-lat', baseLat);
                    $card.attr('data-gps-lon', baseLon);
                    $card.attr('data-exif-gps', baseLat + ', ' + baseLon);
                } else {
                    $card.attr('data-gps-lat', '');
                    $card.attr('data-gps-lon', '');
                    $card.attr('data-exif-gps', 'n/a');
                }
                $card.removeClass('has-gps-adjusted');
                return;
            }
            var latText = formatCoord(preview.lat);
            var lonText = formatCoord(preview.lon);
            $card.attr('data-gps-lat', latText);
            $card.attr('data-gps-lon', lonText);
            $card.attr('data-exif-gps', latText + ', ' + lonText);
            $card.addClass('has-gps-adjusted');
        });

        var $selectedTarget = activeTargetCard();
        if ($selectedTarget.length > 0) {
            updatePaneMetadataFromCard(panes.target.$pane, $selectedTarget);
            syncPaneMap(panes.target.$pane);
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
            var $selectedTarget = activeTargetCard();
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
            var $header = $('<div class="timeline-group-header"></div>');
            var $left = $('<div class="timeline-group-meta"></div>');
            var $title = $('<button type="button" class="timeline-group-title"></button>');
            var label = group.title;
            $title.attr('data-group-key', groupKey);
            $title.attr('data-collapsed', collapsed ? '1' : '0');
            $title.attr('aria-expanded', collapsed ? 'false' : 'true');
            $title.text(label);
            $left.append($title);
            if (Number.isFinite(group.anchorMs)) {
                var $jump = $('<a href="#" class="timeline-group-jump"></a>');
                $jump.attr('data-target-ms', String(group.anchorMs));
                $jump.text(formatGroupDate(group.anchorMs));
                $left.append($jump);
            }
            $header.append($left);
            $header.append($('<div class="timeline-group-count"></div>').text(group.cards.length + ' image' + (group.cards.length === 1 ? '' : 's')));
            $group.append($header);

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
                        title: 'Session',
                        anchorMs: ms,
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
                        title: modeLabel(mode),
                        anchorMs: groupSortTime(mode, ms),
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

    function modeLabel(mode) {
        if (mode === 'day') {
            return 'Day';
        }
        if (mode === 'hour') {
            return 'Hour';
        }
        if (mode === 'session') {
            return 'Session';
        }
        return mode;
    }

    function selectClosestReferenceForTimestamp(targetMs) {
        if (!Number.isFinite(targetMs) || !panes.reference || panes.reference.cards.length === 0) {
            return;
        }
        var best = null;
        panes.reference.cards.forEach(function(info) {
            var ms = currentCardExifMs(info.$el);
            if (!Number.isFinite(ms)) {
                return;
            }
            var diff = Math.abs(ms - targetMs);
            if (!best || diff < best.diff || (diff === best.diff && info.order < best.info.order)) {
                best = { info: info, diff: diff };
            }
        });
        if (!best || !best.info || !best.info.$el) {
            return;
        }
        var $card = best.info.$el;
        panes.reference.$pane.find('.photo-card').removeClass('is-selected');
        $card.addClass('is-selected');
        updatePaneMetadataFromCard(panes.reference.$pane, $card);
        syncSelectionOutlineState();
        syncPaneMap(panes.reference.$pane);
        var cardEl = $card.get(0);
        if (cardEl && typeof cardEl.scrollIntoView === 'function') {
            cardEl.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
    }

    function applyLensHighlightState() {
        $('body')
            .toggleClass('lens-unsaved-highlight-active', !!lensSettings.unsaved.highlight)
            .toggleClass('lens-missing-gps-highlight-active', !!lensSettings['missing-gps'].highlight)
            .toggleClass('lens-unsaved-hide-active', !!lensSettings.unsaved.hide)
            .toggleClass('lens-missing-gps-hide-active', !!lensSettings['missing-gps'].hide);

        $('.lens-icon-toggle').each(function() {
            var $button = $(this);
            var lensName = String($button.attr('data-lens') || '');
            var action = String($button.attr('data-lens-action') || '');
            var isActive = !!(lensSettings[lensName] && lensSettings[lensName][action]);
            $button.attr('aria-pressed', isActive ? 'true' : 'false');
            $button.toggleClass('is-active', isActive);
        });

        allCards().forEach(function($card) {
            var hasUnsaved = cardHasUnsavedChanges($card);
            var missingGPS = cardMissingGPS($card);
            cardLensWrap($card, 'unsaved').toggleClass('is-highlighted', lensSettings.unsaved.highlight && hasUnsaved);
            cardLensWrap($card, 'missing-gps').toggleClass('is-highlighted', lensSettings['missing-gps'].highlight && missingGPS);

            var isTargetCard = String($card.data('side') || '') === 'target';
            if (isTargetCard) {
                var visible = true;
                var activeHideLensCount = 0;
                var matchesActiveHideLens = false;

                if (lensSettings.unsaved.hide) {
                    activeHideLensCount += 1;
                    matchesActiveHideLens = matchesActiveHideLens || hasUnsaved;
                }
                if (lensSettings['missing-gps'].hide) {
                    activeHideLensCount += 1;
                    matchesActiveHideLens = matchesActiveHideLens || missingGPS;
                }
                if (activeHideLensCount > 0) {
                    visible = matchesActiveHideLens;
                }
                cardOuterWrap($card).toggle(visible);
            }
        });

        syncSelectionOutlineState();
        updatePaneSummaries();
        updateSaveButtonVisibility();
    }

    function updatePaneSummaries() {
        $('.pane-summary').each(function() {
            var $summary = $(this);
            var baseSummary = String($summary.attr('data-base-summary') || '').trim();
            if (!$summary.closest('.pane').is(panes.target.$pane)) {
                $summary.text(baseSummary);
                return;
            }

            var total = panes.target.cards.length;
            if (total === 0) {
                $summary.text(baseSummary);
                return;
            }

            var visible = 0;
            panes.target.cards.forEach(function(info) {
                if (cardOuterWrap(info.$el).is(':visible')) {
                    visible += 1;
                }
            });

            var hideActive = !!lensSettings.unsaved.hide || !!lensSettings['missing-gps'].hide;
            if (hideActive && visible < total) {
                $summary.text(total + ' images loaded, ' + visible + ' shown');
                return;
            }

            $summary.text(baseSummary);
        });
    }

    function updateReferenceNeighborHighlightForSelection() {
        panes.reference.$pane.find('.photo-card').removeClass('ref-before-highlight ref-after-highlight');
        var $selectedTarget = activeTargetCard();
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
        var $selected = $pane.is(panes.target.$pane) ? activeTargetCard() : selectedCardForPane($pane);
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

    function activeTargetCard() {
        if (targetSelectionAnchorID) {
            var $anchor = panes.target.$pane.find('.photo-card[data-photo-id="' + targetSelectionAnchorID + '"]').first();
            if ($anchor.length > 0 && $anchor.hasClass('is-selected')) {
                return $anchor;
            }
        }
        var $selected = selectedCardForPane(panes.target.$pane);
        if ($selected.length > 0) {
            setTargetSelectionAnchor($selected);
        }
        return $selected;
    }

    function selectedTargetInfos() {
        var selectedIDs = {};
        panes.target.$pane.find('.photo-card.is-selected').each(function() {
            selectedIDs[String($(this).data('photoId') || '')] = true;
        });
        return panes.target.cards.filter(function(info) {
            return !!selectedIDs[info.id];
        });
    }

    function setTargetSelectionAnchor($card) {
        if (!$card || $card.length === 0) {
            targetSelectionAnchorID = '';
            panes.target.$pane.find('.photo-card').removeClass('is-selection-anchor');
            return;
        }
        targetSelectionAnchorID = String($card.data('photoId') || '');
        panes.target.$pane.find('.photo-card').removeClass('is-selection-anchor');
        $card.addClass('is-selection-anchor');
    }

    function collapseTargetSelectionToAnchor() {
        var $anchor = activeTargetCard();
        panes.target.$pane.find('.photo-card').removeClass('is-selected is-selection-anchor');
        if ($anchor.length > 0) {
            $anchor.addClass('is-selected');
            setTargetSelectionAnchor($anchor);
        } else {
            targetSelectionAnchorID = '';
        }
    }

    function updateTargetImageScopeSelection($card, evt) {
        var $pane = panes.target.$pane;
        var clickedID = String($card.data('photoId') || '');
        var useRange = !!(evt && evt.shiftKey);
        var useAdd = !!(evt && (evt.ctrlKey || evt.metaKey));

        if (useRange) {
            var selectedInfos = selectedTargetInfos();
            var clickedInfo = cardInfoByID(panes.target, clickedID);
            var nearestPrev = null;
            if (!clickedInfo) {
                return;
            }

            selectedInfos.forEach(function(info) {
                if (info.index < clickedInfo.index && (!nearestPrev || info.index > nearestPrev.index)) {
                    nearestPrev = info;
                }
            });

            if (!useAdd) {
                $pane.find('.photo-card').removeClass('is-selected is-selection-anchor');
            }
            if (!nearestPrev) {
                $card.addClass('is-selected');
                setTargetSelectionAnchor($card);
                return;
            }

            panes.target.cards.forEach(function(info) {
                if (info.index >= nearestPrev.index && info.index <= clickedInfo.index) {
                    info.$el.addClass('is-selected');
                }
            });
            setTargetSelectionAnchor($card);
            return;
        }

        if (useAdd) {
            $card.addClass('is-selected');
            setTargetSelectionAnchor($card);
            return;
        }

        $pane.find('.photo-card').removeClass('is-selected is-selection-anchor');
        $card.addClass('is-selected');
        setTargetSelectionAnchor($card);
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

    function cardSelectionWrap($card) {
        return cardLensWrap($card, 'selected');
    }

    function cardOuterWrap($card) {
        return cardLensWrap($card, 'unsaved');
    }

    function syncSelectionOutlineState() {
        allCards().forEach(function($card) {
            cardSelectionWrap($card).toggleClass('is-highlighted', $card.hasClass('is-selected'));
        });
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
                if (($card.attr('data-base-exif-time') || '') === curExif) {
                    $card.removeAttr('data-adjusted-exif-time');
                    $card.removeClass('has-adjusted');
                    $card.find('.thumb-adjusted').text('');
                }
                if (normalizeCoordText(curLat) === normalizeCoordText($card.attr('data-base-gps-lat') || '') &&
                    normalizeCoordText(curLon) === normalizeCoordText($card.attr('data-base-gps-lon') || '')) {
                    $card.removeClass('has-gps-adjusted');
                }
            });

            applyLensHighlightState();
            var $selectedTarget = activeTargetCard();
            if ($selectedTarget.length > 0) {
                updatePaneMetadataFromCard(panes.target.$pane, $selectedTarget);
                syncPaneMap(panes.target.$pane);
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
        $('#apply-sync').prop('disabled', !hasUnsaved);
    }
});
