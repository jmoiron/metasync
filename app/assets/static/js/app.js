$(function() {
    var paneMaps = new WeakMap();
    var markerIcon = null;
    var modalMapState = null;
    var defaultMapView = [20, 0];
    var defaultMapZoom = 2;
    var selectedPhotoZoom = 15;
    var geoLookupStorageKey = 'geo-lookup-recent-results';
    var pairIDCounter = 1;
    var syncPairs = [];
    var adjustedTimesByTargetID = {};
    var gpsPreviewByTargetID = {};
    var mapPickMode = false;
    var modalBackdropPointerDown = false;
    var collapsedGroups = {};
    var activeHeaderMenu = '';
    var workPanelState = {
        time: false,
        gps: false
    };
    var applyTaskState = null;
    var geoLookupRequestSeq = 0;
    var displayTimelineMsCallCount = 0;
    var initialDisplayTimelineMsReported = false;
    var targetSelectionAnchorID = '';
    var metadataPanelState = {
        target: localStorage.getItem('metadata-panel-target') !== 'closed',
        reference: localStorage.getItem('metadata-panel-reference') !== 'closed'
    };
    var lensSettings = {
        unsaved: { highlight: true, hide: false },
        'missing-gps': { highlight: true, hide: false },
        'missing-gps-time': { highlight: true, hide: false }
    };
    var paneViewMode = {
        target: localStorage.getItem('pane-view-target') || 'thumbs',
        reference: localStorage.getItem('pane-view-reference') || 'thumbs'
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
    initializeTimezoneSelectors();
    initializeScopeControl();
    bindBasicControls();
    bindHeaderMenus();
    bindPaneViewControls();
    bindPhotoSelection();
    bindMetadataToggle();
    bindSyncControls();
    bindLensControls();
    bindProgressTracking();
    renderGroups();
    reportInitialDisplayTimelineMsUsage();
    refreshSyncUI();
    hideApplyResults();
    applyLensHighlightState();
    syncMetadataPanelState();
    syncPaneViews();
    window.metasyncUI = window.metasyncUI || {};
    window.metasyncUI.loadPane = loadPane;
    window.metasyncUI.renderGroups = renderGroups;
    window.metasyncUI.staticRenderGroups = renderGroupsStatic;
    window.metasyncUI.getDisplayTimelineMsCallCount = function() {
        return displayTimelineMsCallCount;
    };
    window.metasyncUI.getPane = function(side) {
        return side === 'reference' ? panes.reference : panes.target;
    };
    window.metasyncUI.getPanes = function() {
        return {
            target: panes.target,
            reference: panes.reference
        };
    };
    window.metasyncUI.setPaneViewMode = function(side, mode) {
        var resolvedSide = side === 'reference' ? 'reference' : 'target';
        var nextMode = mode === 'preview' ? 'preview' : 'thumbs';
        paneViewMode[resolvedSide] = nextMode;
        localStorage.setItem('pane-view-' + resolvedSide, nextMode);
        syncPaneViews();
    };

    function buildPaneState($pane, sideName) {
        var photoModelByID = parsePanePhotoModel($pane);
        var cards = [];
        $pane.find('.photo-card').each(function(index) {
            var $card = $(this);
            var photoID = String($card.data('photoId') || '');
            cards.push({
                id: photoID,
                order: index,
                side: sideName,
                baseExifMs: parseExifTime($card.attr('data-base-exif-time')),
                model: photoModelByID[photoID] || null,
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
            cards: cards,
            photoModelByID: photoModelByID,
            $timezoneSelect: $pane.find('[data-timezone-select]').first()
        };
    }

    function parsePanePhotoModel($pane) {
        var $script = $pane.find('[data-pane-model-json]').first();
        if ($script.length === 0) {
            return {};
        }
        try {
            var parsed = JSON.parse(String($script.text() || '{}'));
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return {};
            }
            return parsed;
        } catch (err) {
            return {};
        }
    }

    function initializeTimezoneSelectors() {
        [panes.target, panes.reference].forEach(function(pane) {
            populateTimezoneSelector(pane);
        });
    }

    function populateTimezoneSelector(pane) {
        var $select = pane.$timezoneSelect;
        if ($select.length === 0) {
            return;
        }
        var currentValue = String($select.val() || 'local');

        var offsets = {};
        pane.cards.forEach(function(info) {
            var offset = normalizeOffsetString(info.$el.attr('data-exif-offset') || '');
            if (offset) {
                offsets[offset] = true;
            }
        });

        var values = Object.keys(offsets).sort(compareOffsetStrings);
        $select.empty();
        $select.append('<option value="local">Local</option>');
        $select.append('<option value="utc">UTC</option>');
        values.forEach(function(offset) {
            if (offset === '+00:00') {
                return;
            }
            $select.append($('<option></option>').attr('value', offset).text('UTC' + offset));
        });
        if ($select.find('option[value="' + currentValue + '"]').length > 0) {
            $select.val(currentValue);
        } else {
            $select.val('local');
        }
    }

    function bindBasicControls() {
        $('#theme-toggle').on('click', function() {
            var cur = localStorage.getItem('theme') || 'light';
            var next = cur === 'dark' ? 'light' : 'dark';
            localStorage.setItem('theme', next);
            applyTheme(next);
        });

        $('#scope').on('change', function() {
            var value = String($(this).val() || 'global');
            localStorage.setItem('scope', value);
            syncScopeUI();
            if (value !== 'image') {
                collapseTargetSelectionToAnchor();
            }
            renderGroups();
        });

        $(document).on('click', '.scope-menu-item', function() {
            setScopeValue(String($(this).attr('data-scope-value') || 'global'));
        });

        $workspace.on('change', '[data-timezone-select]', function() {
            var $pane = $(this).closest('.pane');
            var pane = $pane.is(panes.target.$pane) ? panes.target : panes.reference;
            var $selected = pane.side === 'target' ? activeTargetCard() : selectedCardForPane($pane);
            if ($selected.length > 0) {
                updatePaneMetadataFromCard($pane, $selected);
            }
        });

        $workspace.on('click', '.pane-directory-link', function(evt) {
            if (!window.metasyncUI || typeof window.metasyncUI.loadPane !== 'function') {
                return;
            }
            evt.preventDefault();
            var $pane = $(this).closest('.pane');
            var side = $pane.is(panes.target.$pane) ? 'target' : 'reference';
            var href = String($(this).attr('href') || '');
            if (!href) {
                return;
            }
            loadPane(side, href);
        });
    }

    function initializeScopeControl() {
        var stored = localStorage.getItem('scope');
        var current = String($('#scope').val() || 'global');
        setScopeValue(isValidScopeValue(stored) ? stored : current, false);
    }

    function setScopeValue(value, triggerChange) {
        var next = isValidScopeValue(value) ? value : 'global';
        var $scope = $('#scope');
        $scope.val(next);
        localStorage.setItem('scope', next);
        syncScopeUI();
        if (triggerChange !== false) {
            $scope.trigger('change');
        }
    }

    function isValidScopeValue(value) {
        return value === 'global' || value === 'session' || value === 'image';
    }

    function syncScopeUI() {
        var value = String($('#scope').val() || 'global');
        $('.scope-menu-item').each(function() {
            var $item = $(this);
            $item.toggleClass('is-selected', String($item.attr('data-scope-value') || '') === value);
        });
        var iconClass = scopeIconClass(value);
        $('#scope-toggle-icon')
            .removeClass('fa-crosshairs fa-star-of-life fa-object-group fa-image fa-regular fa-solid')
            .addClass(iconClass);
    }

    function scopeIconClass(value) {
        switch (value) {
        case 'session':
            return 'fa-regular fa-object-group';
        case 'image':
            return 'fa-solid fa-image';
        default:
            return 'fa-solid fa-star-of-life';
        }
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
                hideExifModal();
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
            syncPaneViews();
        });
    }

    function bindPaneViewControls() {
        $('[data-pane-view-toggle]').on('click', function() {
            var $toggle = $(this);
            var side = String($toggle.attr('data-pane-view-side') || '');
            if (!side) {
                return;
            }
            paneViewMode[side] = paneViewMode[side] === 'preview' ? 'thumbs' : 'preview';
            localStorage.setItem('pane-view-' + side, paneViewMode[side]);
            syncPaneViews();
        });
        syncPaneViewToggleUI();
    }

    function syncPaneViewToggleUI() {
        $('[data-pane-view-toggle]').each(function() {
            var $toggle = $(this);
            var side = String($toggle.attr('data-pane-view-side') || '');
            var mode = paneViewMode[side] === 'preview' ? 'preview' : 'thumbs';
            $toggle.attr('data-pane-view-mode', mode);
            $toggle.attr('aria-pressed', mode === 'preview' ? 'true' : 'false');
        });
    }

    function syncPaneViews() {
        syncPaneViewToggleUI();
        syncPaneViewFor(panes.target, panes.reference, 'reference image');
        syncPaneViewFor(panes.reference, panes.target, 'target image');
    }

    function syncPaneViewFor(pane, oppositePane, oppositeLabel) {
        if (!pane || !pane.$pane || pane.$pane.length === 0) {
            return;
        }
        var mode = paneViewMode[pane.side] === 'preview' ? 'preview' : 'thumbs';
        var $thumbs = pane.$pane.find('[data-pane-media="thumbs"]').first();
        var $preview = pane.$pane.find('[data-pane-media="preview"]').first();
        if ($thumbs.length === 0 || $preview.length === 0) {
            return;
        }

        $thumbs.prop('hidden', mode !== 'thumbs');
        $preview.prop('hidden', mode !== 'preview');
        pane.$pane.find('[data-pane-title-default]').prop('hidden', mode === 'preview');
        pane.$pane.find('[data-pane-title-preview]').prop('hidden', mode !== 'preview');
        pane.$pane.find('[data-pane-title-path]').prop('hidden', mode === 'preview');
        pane.$pane.find('.pane-header-meta').prop('hidden', mode === 'preview');
        pane.$pane.find('.metadata-panel').prop('hidden', mode === 'preview');
        if (mode !== 'preview') {
            return;
        }

        var $source = oppositePane.side === 'target' ? activeTargetCard() : selectedCardForPane(oppositePane.$pane);
        var $empty = $preview.find('[data-pane-preview-empty]');
        var $image = $preview.find('[data-pane-preview-image]');
        if ($source.length === 0) {
            $empty.text('Select a ' + oppositeLabel + ' to preview it here.').prop('hidden', false);
            $image.prop('hidden', true).attr('src', '').attr('alt', '');
            return;
        }

        var path = String($source.attr('data-path') || '');
        var basename = String($source.attr('data-basename') || 'selected image');
        if (!path) {
            $empty.text('Selected ' + oppositeLabel + ' path is missing.').prop('hidden', false);
            $image.prop('hidden', true).attr('src', '').attr('alt', '');
            return;
        }
        $image.attr('src', '/image?path=' + encodeURIComponent(path));
        $image.attr('alt', basename);
        $image.prop('hidden', false);
        $empty.prop('hidden', true);
    }

    function bindMetadataToggle() {
        $workspace.on('click', '[data-action="toggle-metadata-panel"]', function() {
            var $pane = $(this).closest('.pane');
            var pane = $pane.is(panes.reference.$pane) ? panes.reference : panes.target;
            setMetadataPanelCollapsed(pane, metadataPanelState[pane.side]);
        });
        $workspace.on('click', '.metadata-toggle-btn', function() {
            var $button = $(this);
            if ($button.is('[data-action="inspect-exif"]')) {
                return;
            }
            var mode = String($button.data('mode'));
            var $panel = $button.closest('.metadata-panel');

            setMetadataPanelMode($panel.closest('.pane'), mode);
            if (mode === 'map') {
                syncPaneMap($button.closest('.pane'));
            }
        });

        $workspace.on('click', '[data-action="inspect-exif"]', function() {
            var $pane = $(this).closest('.pane');
            var $selected = $pane.is(panes.target.$pane) ? activeTargetCard() : selectedCardForPane($pane);
            if ($selected.length === 0) {
                $('#sync-status').text('Select an image first.');
                return;
            }
            inspectExifForCard($selected);
        });
        $workspace.on('click', '[data-action="expand-map"]', function(evt) {
            evt.preventDefault();
            openGeoLookupModal($(this).closest('.pane'));
        });

        $(document).on('click', '[data-action="show-set-gps-time-info"]', function(evt) {
            evt.preventDefault();
            showInfoModal('Set GPS Time', [
                'Cameras and Phones often set the primary EXIF timestamp in localtime witha timezone offset, but the GPS metadata section\'s timestamp is saved in UTC.',
                'For photos that were saved without GPS coordinate info, this timestamp is usually absent, but it useful in large collections of images as UTC is always the same and has no DST. The more metadata you can have in a consistent format across your images, the better.',
                'Setting the GPS time requires that the photo has an accurate EXIF timestamp with an accurate offset, because the UTC timestamp will be calculated based off of these.',
                'If the timestamps are not accurate, you should fix those first and then set the GPS timestamp last.',
            ]);
        });
        $(document).on('click', '[data-action="show-timezone-fix-info"]', function(evt) {
            evt.preventDefault();
            showInfoModal('Timezone', [
                'The timezone editor has a form which is represented as ACTION from SOURCE',
                'Action can be either <i>set</i> or <i>adjust</i>.',
                'Set writes the chosen timezone offset without changing the local EXIF timestamp.',
                'Adjust changes both the timezone offset and the local EXIF timestamp. Adjust requires that the image already has a timestamp and a timezone offset.',
                'A common problem with Canon cameras is that they will always use the locale that is configured in the settings, regardless of where the GPS says it is. If the timestamp and offset are valid, but you want to change the timezone, choose <i>adjust</i>. If the timezone offset is missing or if the time is just busted, use <i>set</i>.',
                'The source can be <i>ref</i>, <i>gps coordinate</i>, or <i>manual</i>',
                'Ref uses the selected reference image\'s timezone offset.',
                'GPS Coordinate uses each target image timezone derived from each target\'s GPS coordinates, including daylight saving changes based on the EXIF timestamp where applicable.',
                'Manual allows you to specify an offset.',
            ]);
        });

        $('#dismiss-exif-modal').on('click', function() {
            hideExifModal();
        });
        $('#expand-all-exif').on('click', function() {
            setAllExifTreeNodesExpanded(true);
        });
        $('#collapse-all-exif').on('click', function() {
            setAllExifTreeNodesExpanded(false);
        });

        $('#exif-modal').on('pointerdown', function(evt) {
            modalBackdropPointerDown = $(evt.target).is('#exif-modal');
        });
        $('#exif-modal').on('click', function(evt) {
            var shouldDismiss = modalBackdropPointerDown && $(evt.target).is('#exif-modal');
            modalBackdropPointerDown = false;
            if (shouldDismiss) {
                hideExifModal();
            }
        });
    }

    function bindSyncControls() {
        $('#grouping-mode').on('change', function() {
            renderGroups();
        });
        $('#session-minutes').on('change blur', function() {
            if (String($('#grouping-mode').val()) === 'session') {
                renderGroups();
            }
        });
        $('#session-minutes').on('keydown', function(evt) {
            if (evt.key !== 'Enter') {
                return;
            }
            evt.preventDefault();
            $(this).trigger('blur');
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
        $('#set-gps-time').on('click', function() {
            setGPSTimeFromLocalTime();
        });
        $('#timezone-fix-source').on('change', function() {
            syncTimezoneFixControls();
        });
        $('#apply-timezone-fix').on('click', function() {
            applyTimezoneFix();
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

        syncTimezoneFixControls();
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

    function bindProgressTracking() {
        $(document).on('metasync:progress', function(evt) {
            var snap = evt.originalEvent && evt.originalEvent.detail ? evt.originalEvent.detail : evt.detail;
            if (!snap || !snap.task_id || !applyTaskState || String(applyTaskState.taskID || '') !== String(snap.task_id || '')) {
                return;
            }
            handleApplyTaskProgress(snap);
        });
    }

    function loadPane(side, nextURL) {
        var resolvedSide = side === 'reference' ? 'reference' : 'target';
        var url = new URL(nextURL, window.location.origin);
        if (url.pathname === '/pane') {
            url.pathname = '/';
            url.searchParams.delete('side');
        }
        var paneURL = new URL('/pane', window.location.origin);
        paneURL.search = url.search;
        paneURL.searchParams.set('side', resolvedSide);

        return fetch(paneURL.toString(), {
            method: 'GET',
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            }
        }).then(function(resp) {
            if (!resp.ok) {
                return resp.text().then(function(text) {
                    throw new Error(text || ('HTTP ' + resp.status));
                });
            }
            return resp.text();
        }).then(function(html) {
            replacePane(resolvedSide, html);
            window.history.replaceState({}, '', url.toString());
        }).catch(function() {
            window.location.href = url.toString();
        });
    }

    function replacePane(side, html) {
        var pane = side === 'reference' ? panes.reference : panes.target;
        if (!pane || !pane.$pane || pane.$pane.length === 0) {
            return;
        }

        teardownPane(pane.$pane);
        var $nextPane = $(html.trim());
        pane.$pane.replaceWith($nextPane);
        panes[side] = buildPaneState($nextPane, side);
        if (side === 'target') {
            targetSelectionAnchorID = '';
        }

        if (window.metasyncDirectoryBrowser && typeof window.metasyncDirectoryBrowser.init === 'function') {
            window.metasyncDirectoryBrowser.init($nextPane);
        }
        resetDerivedStateForPaneChange();
        initializeTimezoneSelectors();
        renderGroups();
        applyLensHighlightState();
        updateReferenceNeighborHighlightForSelection();
        syncMetadataPanelState();
        syncPaneViews();
    }

    function teardownPane($pane) {
        var paneEl = $pane && $pane.length > 0 ? $pane.get(0) : null;
        if (!paneEl) {
            return;
        }
        var mapState = paneMaps.get(paneEl);
        if (mapState && mapState.map && typeof mapState.map.remove === 'function') {
            mapState.map.remove();
        }
        paneMaps.delete(paneEl);
    }

    function resetDerivedStateForPaneChange() {
        syncPairs = [];
        adjustedTimesByTargetID = {};
        gpsPreviewByTargetID = {};
        targetSelectionAnchorID = '';
        refreshSyncUI();
        hideApplyResults();
        updateSaveButtonVisibility();
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
        closeFloatingMenus();
        activeHeaderMenu = menuID;
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
        $('[data-menu-target]').removeClass('is-active').attr('aria-expanded', 'false');
        syncWorkPanelState();
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
            var adjustedMs = adjustedTimesByTargetID[info.id];
            if (Number.isFinite(adjustedMs)) {
                var adjustedText = formatExif(new Date(adjustedMs));
                $card.attr('data-exif-time', adjustedText);
                $card.attr('data-adjusted-exif-time', adjustedText);
                $card.addClass('has-adjusted');
                $card.find('.thumb-adjusted').text(adjustedText);
            } else if (($card.attr('data-exif-time') || '') === ($card.attr('data-base-exif-time') || '')) {
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
                $row.append(
                    '<button type="button" class="sync-pair-remove dismiss-btn" data-pair-id="' + pair.id + '" aria-label="Remove sync pair">' +
                    '<span class="fa-solid fa-circle-xmark" aria-hidden="true"></span>' +
                    '</button>'
                );
                $pairs.append($row);
            });
    }

    function renderGroups() {
        renderGroupsForPane(panes.target);
        renderGroupsForPane(panes.reference);
        syncPaneViews();
    }

    function renderGroupsStatic() {
        renderGroupsStaticForPane(panes.target);
        renderGroupsStaticForPane(panes.reference);
        syncPaneViews();
    }

    function renderGroupsForPane(pane) {
        var $timeline = pane.$pane.find('.timeline');
        if (pane.cards.length === 0) {
            return;
        }
        var prevScrollTop = 0; // $timeline.scrollTop();
        pane.view = paneTimeView(pane.$pane);

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
        var groups = buildGroups(pane, pane.cards, mode, sessionMin);
        renderGroupListIntoTimeline($timeline, pane, groups, mode, scope, selectedTargetID, prevScrollTop);
    }

    function renderGroupsStaticForPane(pane) {
        var $timeline = pane.$pane.find('.timeline');
        if (pane.cards.length === 0) {
            return;
        }
        var prevScrollTop = 0; // $timeline.scrollTop();
        pane.view = paneTimeView(pane.$pane);
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
        var groups = buildGroupsStatic(pane, pane.cards, mode, sessionMin);
        renderGroupListIntoTimeline($timeline, pane, groups, mode, scope, selectedTargetID, prevScrollTop);
    }

    function renderGroupListIntoTimeline($timeline, pane, groups, mode, scope, selectedTargetID, prevScrollTop) {
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
        // $timeline.scrollTop(prevScrollTop || 0);
    }

    function buildGroups(pane, cards, mode, sessionMin) {
        var groups = [];
        var byKey = {};
        var noTime = { key: 'none', title: 'No timestamp', cards: [] };
        var sorted = cards
            .slice()
            .sort(function(a, b) {
                var aMs = displayTimelineMsForPane(pane, a.$el);
                var bMs = displayTimelineMsForPane(pane, b.$el);
                return compareCardsByTimeThenOrder(aMs, bMs, a.order, b.order);
            });

        if (mode === 'session') {
            var threshold = sessionMin * 60 * 1000;
            var current = null;
            sorted.forEach(function(info) {
                var ms = displayTimelineMsForPane(pane, info.$el);
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
                var ms = displayTimelineMsForPane(pane, info.$el);
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

    function buildGroupsStatic(pane, cards, mode, sessionMin) {
        var groups = [];
        var byKey = {};
        var noTime = { key: 'none', title: 'No timestamp', cards: [] };
        var sorted = cards
            .slice()
            .sort(function(a, b) {
                var aMs = displayTimelineMsForInfoModel(pane, a);
                var bMs = displayTimelineMsForInfoModel(pane, b);
                return compareCardsByTimeThenOrder(aMs, bMs, a.order, b.order);
            });

        if (mode === 'session') {
            var threshold = sessionMin * 60 * 1000;
            var current = null;
            sorted.forEach(function(info) {
                var ms = displayTimelineMsForInfoModel(pane, info);
                if (!Number.isFinite(ms)) {
                    noTime.cards.push(info);
                    return;
                }
                if (!current || ms - current.lastMs > threshold) {
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
                var ms = displayTimelineMsForInfoModel(pane, info);
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
        syncPaneViews();
        var cardEl = $card.get(0);
        if (cardEl && typeof cardEl.scrollIntoView === 'function') {
            cardEl.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
    }

    function applyLensHighlightState() {
        $('body')
            .toggleClass('lens-unsaved-highlight-active', !!lensSettings.unsaved.highlight)
            .toggleClass('lens-missing-gps-highlight-active', !!lensSettings['missing-gps'].highlight)
            .toggleClass('lens-missing-gps-time-highlight-active', !!lensSettings['missing-gps-time'].highlight)
            .toggleClass('lens-unsaved-hide-active', !!lensSettings.unsaved.hide)
            .toggleClass('lens-missing-gps-hide-active', !!lensSettings['missing-gps'].hide)
            .toggleClass('lens-missing-gps-time-hide-active', !!lensSettings['missing-gps-time'].hide);

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
            var missingGPSTime = cardMissingGPSTime($card);
            cardLensWrap($card, 'unsaved').toggleClass('is-highlighted', lensSettings.unsaved.highlight && hasUnsaved);
            cardLensWrap($card, 'missing-gps').toggleClass('is-highlighted', lensSettings['missing-gps'].highlight && missingGPS);
            cardLensWrap($card, 'missing-gps-time').toggleClass('is-highlighted', lensSettings['missing-gps-time'].highlight && missingGPSTime);

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
                if (lensSettings['missing-gps-time'].hide) {
                    activeHideLensCount += 1;
                    matchesActiveHideLens = matchesActiveHideLens || missingGPSTime;
                }
                if (activeHideLensCount > 0) {
                    visible = matchesActiveHideLens;
                }
                cardOuterWrap($card).toggle(visible);
            }
        });

        syncSelectionOutlineState();
        updateSaveButtonVisibility();
    }

    function updatePaneSummaries() {
        $('.pane-summary').each(function() {
            var $summary = $(this);
            var $pane = $summary.closest('.pane');
            var pane = $pane.is(panes.target.$pane) ? panes.target : panes.reference;
            var total = pane.cards.length;
            var selected = $pane.find('.photo-card.is-selected').length;
            var visible = 0;
            pane.cards.forEach(function(info) {
                if (cardOuterWrap(info.$el).is(':visible')) {
                    visible += 1;
                }
            });
            if (selected > 1) {
                $summary.text(selected + ' of ' + total + ' selected');
                return;
            }
            $summary.text(visible + ' of ' + total);
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
        var baseOffset = normalizeOffsetString($card.attr('data-base-exif-offset') || '');
        var curOffset = normalizeOffsetString($card.attr('data-exif-offset') || '');
        var baseGPSTime = String($card.attr('data-base-gps-time') || '');
        var curGPSTime = String($card.attr('data-gps-time') || '');
        if (baseExif !== curExif || baseOffset !== curOffset || baseGPSTime !== curGPSTime) {
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

    function cardMissingGPSTime($card) {
        return String($card.attr('data-gps-time') || '').trim() === '';
    }

    function updatePaneMetadataFromCard($pane, $card) {
        var isTargetPane = $pane.is(panes.target.$pane);
        var originalExif = $card.attr('data-base-exif-time') || 'n/a';
        var currentExif = $card.attr('data-exif-time') || 'n/a';
        var hasTimePreview = isTargetPane && originalExif !== 'n/a' && currentExif !== originalExif;
        var displayExif = displayExifTimeForPane($pane, $card);
        var gpsHover = displayGPSTime($card);

        var originalGPS = $card.attr('data-base-exif-gps') || 'n/a';
        var currentGPS = $card.attr('data-exif-gps') || 'n/a';
        var hasGPSPreview = isTargetPane && originalGPS !== currentGPS;

        $pane.find('[data-field="basename"]').text($card.data('basename') || 'n/a');
        $pane.find('[data-field="modtime"]').text($card.data('modtime') || 'n/a');
        $pane.find('[data-field="size"]').text(formatBytes(Number($card.data('size') || 0)));
        $pane.find('[data-field="resolution"]').text($card.data('resolution') || 'n/a');
        var $exifTime = $pane.find('[data-field="exif-time"]');
        var $exifGPS = $pane.find('[data-field="exif-gps"]');
        $exifTime
            .empty()
            .append($('<span class="exif-time-text"></span>').text(displayExif).attr('title', 'GPS: ' + gpsHover))
            .toggleClass('preview-unsaved', hasTimePreview);
        $exifGPS
            .empty()
            .append($('<span class="exif-gps-text"></span>').text(currentGPS).attr('title', gpsTimeZoneHover($card)))
            .toggleClass('preview-gps', hasGPSPreview);
        if (hasTimePreview) {
            $exifTime.attr('aria-label', 'Previous EXIF time: ' + formatLocalExifDisplay(originalExif, $card.attr('data-base-exif-offset') || '') + '. Preview value: ' + displayExif + '.');
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

    function setMetadataPanelCollapsed(pane, collapsed) {
        if (!pane || !pane.$pane || pane.$pane.length === 0) {
            return;
        }
        var side = pane.side === 'reference' ? 'reference' : 'target';
        metadataPanelState[side] = !collapsed;
        localStorage.setItem('metadata-panel-' + side, collapsed ? 'closed' : 'open');
        var $panel = pane.$pane.find('.metadata-panel').first();
        $panel.toggleClass('is-collapsed', !!collapsed);
        $panel.find('.metadata-panel-handle')
            .attr('aria-expanded', collapsed ? 'false' : 'true')
            .attr('aria-label', collapsed ? 'Expand metadata panel' : 'Collapse metadata panel');
    }

    function syncMetadataPanelState() {
        setMetadataPanelCollapsed(panes.target, !metadataPanelState.target);
        setMetadataPanelCollapsed(panes.reference, !metadataPanelState.reference);
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
        var marker = L.marker(defaultMapView, { icon: getMarkerIcon() });
        map.on('click', function(evt) {
            handlePaneMapClick($pane, evt);
        });
        existing = { map: map, marker: marker };
        paneMaps.set(paneEl, existing);
        return existing;
    }

    function getMarkerIcon() {
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
        return markerIcon;
    }

    function openGeoLookupModal($pane) {
        var bodyHTML = [
            '<div class="geo-lookup-modal">',
            '<form class="geo-lookup-search" id="geo-lookup-form">',
            '<input type="text" id="geo-lookup-input" spellcheck="false" autocomplete="off" placeholder="Search for a place">',
            '<button type="submit" class="sync-btn">Search</button>',
            '</form>',
            '<div class="geo-lookup-status" id="geo-lookup-status">Click anywhere on the map or choose a result to stage GPS for the current scope.</div>',
            '<div class="geo-lookup-layout">',
            '<div class="geo-lookup-results" id="geo-lookup-results"></div>',
            '<div class="geo-lookup-map-wrap"><div class="geo-lookup-map" id="geo-lookup-map"></div></div>',
            '</div>',
            '</div>'
        ].join('');
        showModalFrame('Map Search', '', bodyHTML, false, false, 'is-map-browser');
        initializeGeoLookupModal($pane);
    }

    function initializeGeoLookupModal($pane) {
        destroyGeoLookupModalMap();
        var selected = selectedGeoLookupPoint($pane);
        var center = selected ? [selected.lat, selected.lon] : defaultMapView;
        var zoom = selected ? selectedPhotoZoom : defaultMapZoom;
        var map = L.map('geo-lookup-map', { zoomControl: true }).setView(center, zoom);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(map);

        modalMapState = {
            map: map,
            selectionMarker: L.marker(center, { icon: getMarkerIcon() }),
            candidateLayer: L.layerGroup().addTo(map),
            selectedIndex: -1,
            candidates: []
        };
        if (selected) {
            modalMapState.selectionMarker.addTo(map);
            $('#geo-lookup-status').text('Showing current staged GPS for ' + selected.label + '. Search or click the map to adjust it.');
        }
        renderStoredGeoLookupResults();

        map.on('click', function(evt) {
            if (!evt || !evt.latlng) {
                return;
            }
            applyGeoLookupSelection(Number(evt.latlng.lat), Number(evt.latlng.lng), 'map point');
        });

        $('#geo-lookup-form').on('submit', function(evt) {
            evt.preventDefault();
            runGeoLookupSearch();
        });
        $('#geo-lookup-results').on('click', '.geo-lookup-result', function() {
            var storedIndex = $(this).attr('data-stored-geo-index');
            if (storedIndex !== undefined) {
                var storedEntries = loadStoredGeoLookupResults();
                var storedEntry = storedEntries[Number(storedIndex)];
                if (!storedEntry) {
                    return;
                }
                $('#geo-lookup-input').val(String(storedEntry.query || ''));
                renderGeoLookupResults(Array.isArray(storedEntry.candidates) ? storedEntry.candidates : [], String(storedEntry.query || ''));
                return;
            }
            var index = Number($(this).attr('data-candidate-index'));
            var candidate = modalMapState && modalMapState.candidates ? modalMapState.candidates[index] : null;
            if (!candidate) {
                return;
            }
            focusGeoLookupCandidate(index);
            applyGeoLookupSelection(candidate.latitude, candidate.longitude, candidate.label);
            if (Array.isArray(candidate.bounding_box) && candidate.bounding_box.length === 4) {
                modalMapState.map.fitBounds([
                    [candidate.bounding_box[0], candidate.bounding_box[2]],
                    [candidate.bounding_box[1], candidate.bounding_box[3]]
                ]);
            } else {
                modalMapState.map.setView([candidate.latitude, candidate.longitude], selectedPhotoZoom);
            }
        });

        window.setTimeout(function() {
            if (modalMapState && modalMapState.map) {
                modalMapState.map.invalidateSize();
            }
            $('#geo-lookup-input').trigger('focus');
        }, 0);
    }

    function selectedGeoLookupPoint($pane) {
        var $selected = $pane && $pane.is(panes.reference.$pane) ? selectedCardForPane($pane) : activeTargetCard();
        if (!$selected || $selected.length === 0) {
            return null;
        }
        var lat = parseFloat($selected.attr('data-gps-lat'));
        var lon = parseFloat($selected.attr('data-gps-lon'));
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            return null;
        }
        return {
            lat: lat,
            lon: lon,
            label: String($selected.attr('data-basename') || 'selected image')
        };
    }

    function runGeoLookupSearch() {
        var query = String($('#geo-lookup-input').val() || '').trim();
        if (!query) {
            $('#geo-lookup-status').text('Enter a place search first.');
            return;
        }

        var requestID = geoLookupRequestSeq + 1;
        geoLookupRequestSeq = requestID;
        $('#geo-lookup-status').text('Searching for place candidates…');

        fetch('/geolookup', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                query: query,
                limit: 8
            })
        }).then(function(resp) {
            if (!resp.ok) {
                return resp.text().then(function(text) {
                    throw new Error(text || ('HTTP ' + resp.status));
                });
            }
            return resp.json();
        }).then(function(resp) {
            if (requestID !== geoLookupRequestSeq) {
                return;
            }
            var candidates = resp && Array.isArray(resp.candidates) ? resp.candidates : [];
            storeGeoLookupResults(query, candidates);
            renderGeoLookupResults(candidates, query);
        }).catch(function(err) {
            if (requestID !== geoLookupRequestSeq) {
                return;
            }
            $('#geo-lookup-status').text(err && err.message ? err.message : 'Failed to search places.');
        });
    }

    function renderGeoLookupResults(candidates, queryLabel) {
        if (!modalMapState || !modalMapState.map) {
            return;
        }
        modalMapState.candidates = candidates.slice();
        modalMapState.selectedIndex = -1;
        modalMapState.candidateLayer.clearLayers();

        var $results = $('#geo-lookup-results');
        $results.empty();
        if (candidates.length === 0) {
            $results.append('<div class="geo-lookup-empty">No place candidates found.</div>');
            $('#geo-lookup-status').text('No place candidates found.');
            return;
        }
        if (queryLabel) {
            $results.append(
                $('<div class="geo-lookup-results-head"></div>')
                    .append($('<span></span>').text(queryLabel))
                    .append(
                        $('<button type="button" class="geo-lookup-history-btn" title="Show recent searches" aria-label="Show recent searches"></button>')
                            .append('<span class="fa-solid fa-clock-rotate-left" aria-hidden="true"></span>')
                            .on('click', function() {
                                renderStoredGeoLookupResults();
                            })
                    )
            );
        }

        var bounds = [];
        candidates.forEach(function(candidate, index) {
            var marker = L.marker([candidate.latitude, candidate.longitude], { icon: getMarkerIcon() });
            marker.on('click', function() {
                focusGeoLookupCandidate(index);
                applyGeoLookupSelection(candidate.latitude, candidate.longitude, candidate.label);
            });
            marker.addTo(modalMapState.candidateLayer);
            bounds.push([candidate.latitude, candidate.longitude]);

            var meta = [];
            if (candidate.class) {
                meta.push(candidate.class);
            }
            if (candidate.type) {
                meta.push(candidate.type);
            }
            meta.push(candidate.latitude.toFixed(5) + ', ' + candidate.longitude.toFixed(5));

            $results.append(
                $('<button type="button" class="geo-lookup-result"></button>')
                    .attr('data-candidate-index', index)
                    .append($('<span class="geo-lookup-result-title"></span>').text(candidate.label || 'Unnamed result'))
                    .append($('<span class="geo-lookup-result-meta"></span>').text(meta.join(' • ')))
            );
        });
        if (bounds.length > 1) {
            modalMapState.map.fitBounds(bounds, { padding: [18, 18] });
        } else {
            modalMapState.map.setView(bounds[0], selectedPhotoZoom);
        }
        $('#geo-lookup-status').text('');
    }

    function renderStoredGeoLookupResults() {
        var entries = loadStoredGeoLookupResults();
        var $results = $('#geo-lookup-results');
        $results.empty();
        if (entries.length === 0) {
            $results.append('<div class="geo-lookup-empty">Search for a place to see candidates here.</div>');
            $('#geo-lookup-status').text('');
            return;
        }
        entries.forEach(function(entry, idx) {
            var label = String(entry.query || '').trim();
            var count = Array.isArray(entry.candidates) ? entry.candidates.length : 0;
            if (!label) {
                return;
            }
            $results.append(
                $('<button type="button" class="geo-lookup-result"></button>')
                    .attr('data-stored-geo-index', idx)
                    .append($('<span class="geo-lookup-result-title"></span>').text(label))
                    .append($('<span class="geo-lookup-result-meta"></span>').text(count + ' cached candidate' + (count === 1 ? '' : 's')))
            );
        });
        $('#geo-lookup-status').text('');
    }

    function loadStoredGeoLookupResults() {
        var raw = localStorage.getItem(geoLookupStorageKey);
        if (!raw) {
            return [];
        }
        try {
            var parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                return [];
            }
            return parsed.filter(function(entry) {
                return entry && typeof entry.query === 'string' && Array.isArray(entry.candidates);
            }).slice(0, 20);
        } catch (err) {
            return [];
        }
    }

    function storeGeoLookupResults(query, candidates) {
        var trimmedQuery = String(query || '').trim();
        if (!trimmedQuery || !Array.isArray(candidates) || candidates.length === 0) {
            return;
        }
        var entry = {
            query: trimmedQuery,
            candidates: candidates.map(function(candidate) {
                return {
                    label: String(candidate.label || ''),
                    latitude: Number(candidate.latitude),
                    longitude: Number(candidate.longitude),
                    bounding_box: Array.isArray(candidate.bounding_box) ? candidate.bounding_box.slice(0, 4) : [],
                    class: String(candidate.class || ''),
                    type: String(candidate.type || '')
                };
            }).filter(function(candidate) {
                return Number.isFinite(candidate.latitude) && Number.isFinite(candidate.longitude);
            })
        };
        if (entry.candidates.length === 0) {
            return;
        }
        var entries = loadStoredGeoLookupResults().filter(function(existing) {
            return String(existing.query || '').trim().toLowerCase() !== trimmedQuery.toLowerCase();
        });
        entries.unshift(entry);
        localStorage.setItem(geoLookupStorageKey, JSON.stringify(entries.slice(0, 20)));
    }

    function focusGeoLookupCandidate(index) {
        modalMapState.selectedIndex = index;
        $('#geo-lookup-results .geo-lookup-result').each(function() {
            var $result = $(this);
            $result.toggleClass('is-active', Number($result.attr('data-candidate-index')) === index);
        });
    }

    function applyGeoLookupSelection(lat, lon, label) {
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            $('#geo-lookup-status').text('Invalid map coordinate selected.');
            return;
        }
        if (!setPreviewGPSForScope(lat, lon, 'map-search')) {
            return;
        }
        if (modalMapState && modalMapState.map) {
            modalMapState.selectionMarker.setLatLng([lat, lon]);
            modalMapState.selectionMarker.addTo(modalMapState.map);
        }
        $('#geo-lookup-status').text('Previewed GPS from ' + (label || 'selected map location') + '.');
    }

    function destroyGeoLookupModalMap() {
        geoLookupRequestSeq += 1;
        if (!modalMapState || !modalMapState.map) {
            modalMapState = null;
            return;
        }
        modalMapState.map.remove();
        modalMapState = null;
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
        syncPaneViews();
    }

    function updateTargetImageScopeSelection($card, evt) {
        var $pane = panes.target.$pane;
        var clickedID = String($card.data('photoId') || '');
        var useRange = !!(evt && evt.shiftKey);
        var useAdd = !!(evt && (evt.ctrlKey || evt.metaKey));

        if (useRange) {
            var clickedInfo = cardInfoByID(panes.target, clickedID);
            var anchorInfo = null;
            if (!clickedInfo) {
                return;
            }
            if (targetSelectionAnchorID) {
                anchorInfo = cardInfoByID(panes.target, targetSelectionAnchorID);
            }

            if (!useAdd) {
                $pane.find('.photo-card').removeClass('is-selected is-selection-anchor');
            }
            if (!anchorInfo) {
                $card.addClass('is-selected');
                setTargetSelectionAnchor($card);
                return;
            }

            var start = Math.min(anchorInfo.index, clickedInfo.index);
            var end = Math.max(anchorInfo.index, clickedInfo.index);
            panes.target.cards.forEach(function(info) {
                if (info.index >= start && info.index <= end) {
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
        updatePaneSummaries();
    }

    function ensureAdjustedBadge($card) {
        if ($card.find('.thumb-adjusted').length === 0) {
            $card.append('<span class="thumb-adjusted"></span>');
        }
        if ($card.find('.thumb-gps-adjusted').length === 0) {
            $card.append('<span class="thumb-gps-adjusted">GPS adjusted</span>');
        }
    }

    function paneTimeView($pane) {
        return String($pane.find('[data-timezone-select]').val() || 'local');
    }

    function displayTimelineMsForPane(pane, $card) {
        displayTimelineMsCallCount += 1;
        var localMs = currentCardExifMs($card);
        var view = String(pane.view || 'local');
        if (view === 'local') {
            return localMs;
        }
        var instantMs = instantMsForCard($card, $card.attr('data-exif-time') || '', $card.attr('data-exif-offset') || '');
        if (!Number.isFinite(instantMs)) {
            return localMs;
        }
        if (view === 'utc') {
            return instantMs;
        }
        var offsetMin = offsetMinutes(view);
        if (!Number.isFinite(offsetMin)) {
            return localMs;
        }
        return instantMs + (offsetMin * 60 * 1000);
    }

    function displayTimelineMsForInfoModel(pane, info) {
        var model = info && info.model ? info.model : null;
        var localMs = currentExifMsForInfoModel(info);
        var view = String(pane.view || 'local');
        if (view === 'local') {
            return localMs;
        }
        var instantMs = instantMsForModel(model);
        if (!Number.isFinite(instantMs)) {
            return localMs;
        }
        if (view === 'utc') {
            return instantMs;
        }
        var offsetMin = offsetMinutes(view);
        if (!Number.isFinite(offsetMin)) {
            return localMs;
        }
        return instantMs + (offsetMin * 60 * 1000);
    }

    function currentExifMsForInfoModel(info) {
        if (!info || !info.model) {
            return NaN;
        }
        return parseExifTime(info.model.exif_time);
    }

    function reportInitialDisplayTimelineMsUsage() {
        if (initialDisplayTimelineMsReported) {
            return;
        }
        initialDisplayTimelineMsReported = true;
        var imageCount = panes.target.cards.length + panes.reference.cards.length;
        console.info('displayTimelineMsForPane initial load:', {
            calls: displayTimelineMsCallCount,
            images: imageCount,
            calls_per_image: imageCount > 0 ? displayTimelineMsCallCount / imageCount : 0
        });
    }

    function displayExifTimeForPane($pane, $card) {
        var currentExif = String($card.attr('data-exif-time') || 'n/a');
        var currentOffset = String($card.attr('data-exif-offset') || '');
        var view = paneTimeView($pane);
        if (currentExif === '' || currentExif === 'n/a') {
            return 'n/a';
        }
        if (view === 'local') {
            return formatLocalExifDisplay(currentExif, currentOffset);
        }

        var instantMs = instantMsForCard($card, currentExif, currentOffset);
        if (!Number.isFinite(instantMs)) {
            return formatLocalExifDisplay(currentExif, currentOffset);
        }
        if (view === 'utc') {
            return formatTimeAtOffset(instantMs, 0, true);
        }

        var offsetMin = offsetMinutes(view);
        if (!Number.isFinite(offsetMin)) {
            return formatLocalExifDisplay(currentExif, currentOffset);
        }
        return formatTimeAtOffset(instantMs, offsetMin, false);
    }

    function displayGPSTime($card) {
        var gpsTime = String($card.attr('data-gps-time') || '');
        var ms = gpsTime ? Date.parse(gpsTime) : NaN;
        if (!Number.isFinite(ms)) {
            return 'n/a';
        }
        return formatTimeAtOffset(ms, 0, true);
    }

    function gpsTimeZoneHover($card) {
        var timezone = String($card.attr('data-gps-timezone') || '').trim();
        if (timezone) {
            return 'Timezone: ' + timezone;
        }
        return 'Timezone: n/a';
    }

    function formatLocalExifDisplay(timeText, offsetText) {
        if (!timeText || timeText === 'n/a') {
            return 'n/a';
        }
        var offset = normalizeOffsetString(offsetText);
        if (!offset) {
            return timeText;
        }
        return timeText + ' ' + offset;
    }

    function instantMsForCard($card, timeText, offsetText) {
        var offset = normalizeOffsetString(offsetText);
        if (timeText && timeText !== 'n/a' && offset) {
            var parts = parseExifParts(timeText);
            var offsetMin = offsetMinutes(offset);
            if (parts && Number.isFinite(offsetMin)) {
                return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0) - (offsetMin * 60 * 1000);
            }
        }

        var gpsTime = String($card.attr('data-gps-time') || '');
        if (!gpsTime) {
            return NaN;
        }
        return Date.parse(gpsTime);
    }

    function instantMsForModel(model) {
        if (!model) {
            return NaN;
        }
        var timeText = String(model.exif_time || '');
        var offsetText = String(model.exif_offset || '');
        var offset = normalizeOffsetString(offsetText);
        if (timeText && timeText !== 'n/a' && offset) {
            var parts = parseExifParts(timeText);
            var offsetMin = offsetMinutes(offset);
            if (parts && Number.isFinite(offsetMin)) {
                return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0) - (offsetMin * 60 * 1000);
            }
        }

        var gpsTime = String(model.gps_time || '');
        if (!gpsTime) {
            return NaN;
        }
        return Date.parse(gpsTime);
    }

    function parseExifParts(value) {
        var m = String(value).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
        if (!m) {
            return null;
        }
        return {
            year: Number(m[1]),
            month: Number(m[2]),
            day: Number(m[3]),
            hour: Number(m[4]),
            minute: Number(m[5]),
            second: Number(m[6])
        };
    }

    function offsetMinutes(offset) {
        var normalized = normalizeOffsetString(offset);
        if (!normalized) {
            return NaN;
        }
        var sign = normalized.charAt(0) === '-' ? -1 : 1;
        var hour = Number(normalized.slice(1, 3));
        var minute = Number(normalized.slice(4, 6));
        return sign * ((hour * 60) + minute);
    }

    function normalizeOffsetString(offset) {
        var text = String(offset || '').trim();
        return /^[+-]\d{2}:\d{2}$/.test(text) ? text : '';
    }

    function compareOffsetStrings(a, b) {
        return offsetMinutes(a) - offsetMinutes(b);
    }

    function formatTimeAtOffset(ms, offsetMin, useUTCLabel) {
        var shifted = new Date(ms + (offsetMin * 60 * 1000));
        var text = shifted.getUTCFullYear() + '-' + pad2(shifted.getUTCMonth() + 1) + '-' + pad2(shifted.getUTCDate()) +
            ' ' + pad2(shifted.getUTCHours()) + ':' + pad2(shifted.getUTCMinutes()) + ':' + pad2(shifted.getUTCSeconds());
        if (useUTCLabel) {
            return text + ' UTC';
        }
        var sign = offsetMin >= 0 ? '+' : '-';
        var total = Math.abs(offsetMin);
        return text + ' ' + sign + pad2(Math.floor(total / 60)) + ':' + pad2(total % 60);
    }

    function currentTargetMs(info) {
        if (Number.isFinite(adjustedTimesByTargetID[info.id])) {
            return adjustedTimesByTargetID[info.id];
        }
        return currentCardExifMs(info.$el);
    }

    function selectedReferenceOffset() {
        var $reference = selectedCardForPane(panes.reference.$pane);
        if ($reference.length === 0) {
            return '';
        }
        return normalizeOffsetString($reference.attr('data-exif-offset') || '');
    }

    function syncTimezoneFixControls() {
        var source = String($('#timezone-fix-source').val() || 'ref');
        $('#timezone-fix-manual').prop('hidden', source !== 'manual');
    }

    function applyTimezoneFix() {
        var scope = String($('#scope').val() || 'global');
        var targetCards = targetCardsForScope(scope);
        if ((scope === 'image' || scope === 'session') && targetCards.length === 0) {
            $('#sync-status').text('Select a target image for image/session time scope.');
            return;
        }

        var mode = String($('#timezone-fix-mode').val() || 'set');
        var source = String($('#timezone-fix-source').val() || 'ref');
        if (source === 'ref') {
            var refOffset = selectedReferenceOffset();
            if (!refOffset) {
                $('#sync-status').text('Select a reference image with a timezone offset first.');
                return;
            }
            applyTimezoneOffsetToTargets(targetCards, mode, function() {
                return { offset: refOffset };
            });
            return;
        }
        if (source === 'manual') {
            var manualOffset = normalizeOffsetString($('#timezone-fix-manual').val() || '');
            if (!manualOffset) {
                $('#sync-status').text('Manual timezone offset must match +/-NN:NN.');
                return;
            }
            applyTimezoneOffsetToTargets(targetCards, mode, function() {
                return { offset: manualOffset };
            });
            return;
        }
        applyTimezoneFromGPSCoordinates(targetCards, mode);
    }

    function applyTimezoneOffsetToTargets(targetCards, mode, resolver) {
        var changed = 0;
        targetCards.forEach(function(info) {
            var $card = info.$el;
            var resolved = resolver(info);
            if (!resolved || !resolved.offset) {
                return;
            }
            if (mode === 'set') {
                if (($card.attr('data-exif-time') || 'n/a') === 'n/a') {
                    return;
                }
                if (normalizeOffsetString($card.attr('data-exif-offset') || '') === resolved.offset) {
                    return;
                }
                $card.attr('data-exif-offset', resolved.offset);
                changed += 1;
                return;
            }
            if (!resolved.localTime) {
                var instantMs = instantMsForCard($card, $card.attr('data-exif-time') || '', $card.attr('data-exif-offset') || '');
                var resolvedOffsetMin = offsetMinutes(resolved.offset);
                if (!Number.isFinite(instantMs) || !Number.isFinite(resolvedOffsetMin)) {
                    return;
                }
                resolved.localTime = localTimePartsAtOffset(instantMs, resolvedOffsetMin).text;
            }
            if (!resolved.localTime) {
                return;
            }
            if (($card.attr('data-exif-time') || '') === resolved.localTime &&
                normalizeOffsetString($card.attr('data-exif-offset') || '') === resolved.offset) {
                return;
            }
            $card.attr('data-exif-time', resolved.localTime);
            $card.attr('data-exif-offset', resolved.offset);
            $card.attr('data-adjusted-exif-time', resolved.localTime);
            $card.addClass('has-adjusted');
            $card.find('.thumb-adjusted').text(resolved.localTime);
            changed += 1;
        });
        afterTimeAction(changed, mode === 'set' ? 'Set timezone for ' : 'Adjusted timezone for ');
    }

    function applyTimezoneFromGPSCoordinates(targetCards, mode) {
        var entries = [];
        targetCards.forEach(function(info) {
            var $card = info.$el;
            var lat = parseFloat($card.attr('data-gps-lat'));
            var lon = parseFloat($card.attr('data-gps-lon'));
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
                return;
            }
            var entry = {
                id: String($card.data('photoId') || info.id),
                latitude: lat,
                longitude: lon
            };
            if (mode === 'set') {
                var localTime = String($card.attr('data-exif-time') || '');
                if (!localTime || localTime === 'n/a') {
                    return;
                }
                entry.local_time = localTime;
            } else {
                var instantMs = instantMsForCard($card, $card.attr('data-exif-time') || '', $card.attr('data-exif-offset') || '');
                if (!Number.isFinite(instantMs)) {
                    return;
                }
                entry.instant = new Date(instantMs).toISOString();
            }
            entries.push(entry);
        });
        if (entries.length === 0) {
            $('#sync-status').text(mode === 'set'
                ? 'No target images have valid staged GPS coordinates and EXIF timestamps.'
                : 'Adjust from GPS coordinate requires valid staged GPS coordinates plus accurate EXIF time and offset.');
            return;
        }
        fetch('/timezone-offsets', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ entries: entries })
        }).then(function(resp) {
            if (!resp.ok) {
                return resp.text().then(function(text) {
                    throw new Error(text || ('HTTP ' + resp.status));
                });
            }
            return resp.json();
        }).then(function(resp) {
            var results = {};
            (resp && Array.isArray(resp.results) ? resp.results : []).forEach(function(result) {
                results[String(result.id || '')] = result;
            });
            applyTimezoneOffsetToTargets(targetCards, mode, function(info) {
                var result = results[String(info.$el.data('photoId') || info.id)];
                if (!result || result.error || !result.offset) {
                    return null;
                }
                return {
                    offset: String(result.offset || ''),
                    localTime: String(result.local_time || '')
                };
            });
        }).catch(function(err) {
            $('#sync-status').text(err && err.message ? err.message : 'Failed to resolve GPS coordinate timezones.');
        });
    }

    function setGPSTimeFromLocalTime() {
        var scope = String($('#scope').val() || 'global');
        var targetCards = targetCardsForScope(scope);
        if ((scope === 'image' || scope === 'session') && targetCards.length === 0) {
            $('#sync-status').text('Select a target image for image/session time scope.');
            return;
        }

        var changed = 0;
        targetCards.forEach(function(info) {
            var $card = info.$el;
            var instantMs = instantMsForCard($card, $card.attr('data-exif-time') || '', $card.attr('data-exif-offset') || '');
            if (!Number.isFinite(instantMs)) {
                return;
            }
            var gpsTime = new Date(instantMs).toISOString();
            if (($card.attr('data-gps-time') || '') === gpsTime) {
                return;
            }
            $card.attr('data-gps-time', gpsTime);
            changed += 1;
        });
        afterTimeAction(changed, 'Set GPS time for ');
    }

    function afterTimeAction(changed, prefix) {
        populateTimezoneSelector(panes.target);
        applyLensHighlightState();
        renderGroups();
        var $selectedTarget = activeTargetCard();
        if ($selectedTarget.length > 0) {
            updatePaneMetadataFromCard(panes.target.$pane, $selectedTarget);
        }
        if (changed === 0) {
            $('#sync-status').text('No target images changed.');
            return;
        }
        $('#sync-status').text(prefix + changed + ' target image' + (changed === 1 ? '' : 's') + '.');
    }

    function localTimePartsAtOffset(ms, offsetMin) {
        var shifted = new Date(ms + (offsetMin * 60 * 1000));
        return {
            text: shifted.getUTCFullYear() + '-' + pad2(shifted.getUTCMonth() + 1) + '-' + pad2(shifted.getUTCDate()) +
                ' ' + pad2(shifted.getUTCHours()) + ':' + pad2(shifted.getUTCMinutes()) + ':' + pad2(shifted.getUTCSeconds())
        };
    }

    function allCards() {
        return panes.target.cards.map(function(info) { return info.$el; })
            .concat(panes.reference.cards.map(function(info) { return info.$el; }));
    }

    function applyChangesToFiles() {
        var pageID = window.metasyncProgress && window.metasyncProgress.pageID ? String(window.metasyncProgress.pageID) : '';
        var changes = [];
        panes.target.cards.forEach(function(info) {
            var $card = info.$el;
            var baseExif = $card.attr('data-base-exif-time') || '';
            var curExif = $card.attr('data-exif-time') || '';
            var baseOffset = normalizeOffsetString($card.attr('data-base-exif-offset') || '');
            var curOffset = normalizeOffsetString($card.attr('data-exif-offset') || '');
            var baseGPSTime = String($card.attr('data-base-gps-time') || '');
            var curGPSTime = String($card.attr('data-gps-time') || '');
            var baseLat = normalizeCoordText($card.attr('data-base-gps-lat') || '');
            var baseLon = normalizeCoordText($card.attr('data-base-gps-lon') || '');
            var curLat = normalizeCoordText($card.attr('data-gps-lat') || '');
            var curLon = normalizeCoordText($card.attr('data-gps-lon') || '');

            var change = {
                path: String($card.data('path') || '')
            };
            var changed = false;

            if ((baseExif !== curExif || baseOffset !== curOffset) && curExif !== '' && curExif !== 'n/a') {
                change.exif_time = curExif;
                if (curOffset !== '') {
                    change.exif_offset = curOffset;
                }
                changed = true;
            }
            if (baseGPSTime !== curGPSTime && curGPSTime !== '') {
                change.gps_time = curGPSTime;
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
            body: JSON.stringify({ page_id: pageID, changes: changes })
        }).then(function(resp) {
            if (!resp.ok) {
                return resp.text().then(function(text) {
                    throw new Error(text || ('HTTP ' + resp.status));
                });
            }
            return resp.json();
        }).then(function(resp) {
            applyTaskState = {
                taskID: String(resp && resp.task_id || ''),
                changes: changes
            };
            if (!applyTaskState.taskID) {
                throw new Error('missing task id');
            }
        }).catch(function(err) {
            var msg = 'Failed to apply changes.';
            if (err && err.message) {
                msg = err.message;
            }
            $('#sync-status').text(msg);
            renderApplyResults([], [{ path: 'request', error: msg }]);
        });
    }

    function handleApplyTaskProgress(snap) {
        if (snap.fatal) {
            var fatalMsg = String(snap.fatal || 'Failed to apply changes.');
            $('#sync-status').text(fatalMsg);
            renderApplyResults([], [{ path: 'request', error: fatalMsg }]);
            applyTaskState = null;
            return;
        }

        $('#sync-status').text(formatApplyProgressText(snap));
        if (!snap.done) {
            return;
        }

        finalizeApplyTask(snap);
        applyTaskState = null;
    }

    function formatApplyProgressText(snap) {
        var parts = ['Saving files'];
        if (Number(snap.total || 0) > 0) {
            parts.push(String(snap.progress || 0) + ' of ' + String(snap.total || 0));
            parts.push(String(Number(snap.progress_pct || 0).toFixed(1)) + '%');
        } else {
            parts.push(String(snap.progress || 0));
        }
        if (Number(snap.rate || 0) > 0) {
            parts.push(String(Number(snap.rate || 0).toFixed(1)) + '/s');
        }
        if (Number(snap.eta_seconds || 0) > 0) {
            parts.push('ETA ' + formatETASeconds(Number(snap.eta_seconds || 0)));
        }
        return parts.join(' ');
    }

    function formatETASeconds(seconds) {
        var total = Math.max(0, Math.round(seconds));
        var mins = Math.floor(total / 60);
        var secs = total % 60;
        if (mins <= 0) {
            return secs + 's';
        }
        return mins + 'm' + secs + 's';
    }

    function finalizeApplyTask(snap) {
        var task = applyTaskState || { changes: [] };
        var failedSet = {};
        var errors = [];
        (Array.isArray(snap.errors) ? snap.errors : []).forEach(function(item) {
            var path = String(item.path || '');
            if (path) {
                failedSet[path] = true;
            }
            errors.push({
                path: path || 'unknown',
                error: String(item.error || 'unknown error')
            });
        });

        var applied = [];
        (task.changes || []).forEach(function(change) {
            var path = String(change.path || '');
            if (!path || failedSet[path]) {
                return;
            }
            applied.push(path);
        });

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
            var curOffset = $card.attr('data-exif-offset') || '';
            var curGPSTime = $card.attr('data-gps-time') || '';
            var curGPS = $card.attr('data-exif-gps') || '';
            var curLat = $card.attr('data-gps-lat') || '';
            var curLon = $card.attr('data-gps-lon') || '';
            $card.attr('data-base-exif-time', curExif);
            $card.attr('data-base-exif-offset', curOffset);
            $card.attr('data-base-gps-time', curGPSTime);
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
        populateTimezoneSelector(panes.target);
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

    function inspectExifForCard($card) {
        var path = String($card.data('path') || '');
        var basename = String($card.data('basename') || path || 'selected image');
        if (!path) {
            $('#sync-status').text('Selected image path is missing.');
            return;
        }

        showExifModalLoading(basename, path);
        fetch('/exif?path=' + encodeURIComponent(path), {
            method: 'GET'
        }).then(function(resp) {
            if (!resp.ok) {
                return resp.text().then(function(text) {
                    throw new Error(text || ('HTTP ' + resp.status));
                });
            }
            return resp.json();
        }).then(function(resp) {
            renderExifModal(basename, path, resp && resp.data ? resp.data : {});
        }).catch(function(err) {
            renderExifModalError(basename, path, err && err.message ? err.message : 'Failed to load EXIF data.');
        });
    }

    function showExifModalLoading(label, path) {
        showModalFrame('Full EXIF Data', path, '<div class="exif-modal-status">Loading EXIF data…</div>', true, false);
    }

    function renderExifModal(label, path, data) {
        var keys = Object.keys(data || {});
        if (keys.length === 0) {
            showModalFrame('Full EXIF Data', path, '<div class="exif-modal-status">No EXIF data found.</div>', true, false);
            return;
        }

        showModalFrame('Full EXIF Data', path, '', true, false);
        $('#exif-modal-body').append(renderExifTree(data, 0));
    }

    function renderExifModalError(label, path, message) {
        showModalFrame('Full EXIF Data', path, '<div class="exif-modal-status"></div>', true, false);
        $('#exif-modal-body .exif-modal-status').text(message || 'Failed to load EXIF data.');
    }

    function showInfoModal(title, paragraphs) {
        var html = (paragraphs || []).map(function() {
            return '<p></p>';
        }).join('');
        showModalFrame(title, '', html, false, true);
        $('#exif-modal-body p').each(function(idx) {
            $(this).html(paragraphs[idx] || '');
        });
    }

    function showModalFrame(title, path, bodyHTML, showTreeActions, compact, extraClass) {
        var $modal = $('#exif-modal .exif-modal');
        $('#exif-modal-title').text(title || '');
        $('#exif-modal-path').text(path || '').prop('hidden', !path);
        $('#exif-modal-body').html(bodyHTML || '');
        $('#expand-all-exif, #collapse-all-exif').prop('hidden', !showTreeActions);
        $modal.removeClass('is-map-browser');
        $modal.toggleClass('is-compact', !!compact);
        if (extraClass) {
            $modal.addClass(extraClass);
        }
        $('#exif-modal').prop('hidden', false);
    }

    function hideExifModal() {
        modalBackdropPointerDown = false;
        destroyGeoLookupModalMap();
        $('#exif-modal').prop('hidden', true);
        $('#exif-modal .exif-modal').removeClass('is-compact is-map-browser');
        $('#exif-modal-path').text('');
        $('#exif-modal-body').empty();
        $('#expand-all-exif, #collapse-all-exif').prop('hidden', false);
    }

    function setAllExifTreeNodesExpanded(expanded) {
        $('#exif-modal-body .exif-tree-toggle').each(function() {
            setExifTreeToggleState($(this), expanded);
        });
    }

    function renderExifTree(value, depth) {
        var $container = $('<div class="exif-tree"></div>');
        eachExifEntry(value, function(key, childValue) {
            $container.append(renderExifNode(String(key), childValue, depth));
        });
        return $container;
    }

    function renderExifNode(key, value, depth) {
        var hasChildren = exifValueHasChildren(value);
        var expanded = depth === 0;
        var $node = $('<div class="exif-tree-node"></div>');
        var $row = $('<div class="exif-tree-row"></div>');

        if (hasChildren) {
            var $toggle = $('<button type="button" class="exif-tree-toggle" aria-expanded="' + (expanded ? 'true' : 'false') + '"></button>');
            $toggle.append('<span class="fa-regular ' + (expanded ? 'fa-square-minus' : 'fa-square-plus') + '" aria-hidden="true"></span>');
            $toggle.on('click', function() {
                expanded = $toggle.attr('aria-expanded') !== 'true';
                setExifTreeToggleState($toggle, expanded);
            });
            $row.append($toggle);
        } else {
            $row.append('<span class="exif-tree-spacer"></span>');
        }

        $row.append($('<div class="exif-tree-key"></div>').text(key));
        $row.append(renderExifValue(value, hasChildren));
        $node.append($row);

        var $children = $('<div class="exif-tree-children"></div>');
        if (hasChildren) {
            eachExifEntry(value, function(childKey, childValue) {
                $children.append(renderExifNode(String(childKey), childValue, depth + 1));
            });
            $children.prop('hidden', !expanded);
            $node.append($children);
        }

        return $node;
    }

    function setExifTreeToggleState($toggle, expanded) {
        $toggle.attr('aria-expanded', expanded ? 'true' : 'false');
        $toggle.find('.fa-regular')
            .toggleClass('fa-square-minus', expanded)
            .toggleClass('fa-square-plus', !expanded);
        $toggle.data('expanded', expanded);
        $toggle.closest('.exif-tree-node').children('.exif-tree-children').prop('hidden', !expanded);
    }

    function renderExifValue(value, hasChildren) {
        if (hasChildren) {
            if (Array.isArray(value)) {
                return $('<div class="exif-tree-value"></div>').text(value.length + ' item' + (value.length === 1 ? '' : 's'));
            }
            return $('<div class="exif-tree-value"></div>').text('Object');
        }
        if (value === null || typeof value === 'undefined' || value === '') {
            return $('<div class="exif-tree-value is-empty"></div>').text('empty');
        }
        if (typeof value === 'object') {
            return $('<div class="exif-tree-value"></div>').text(JSON.stringify(value));
        }
        return $('<div class="exif-tree-value"></div>').text(String(value));
    }

    function exifValueHasChildren(value) {
        if (!value || typeof value !== 'object') {
            return false;
        }
        if (Array.isArray(value)) {
            return value.length > 0;
        }
        return Object.keys(value).length > 0;
    }

    function eachExifEntry(value, fn) {
        if (Array.isArray(value)) {
            value.forEach(function(item, idx) {
                fn('[' + idx + ']', item);
            });
            return;
        }
        Object.keys(value).sort().forEach(function(key) {
            fn(key, value[key]);
        });
    }

    function updateSaveButtonVisibility() {
        var hasUnsaved = panes.target.cards.some(function(info) {
            return cardHasUnsavedChanges(info.$el);
        });
        $('#apply-sync').prop('disabled', !hasUnsaved);
    }
});
