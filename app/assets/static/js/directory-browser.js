$(function() {
    var $workspace = $('[data-role="workspace"]');
    if ($workspace.length === 0) {
        return;
    }

    $workspace.find('[data-directory-selector]').each(function() {
        var $selector = $(this);
        var initialPath = String($selector.attr('data-initial-path') || '');
        var initialError = String($selector.attr('data-initial-error') || '');

        $selector.data('currentPath', initialPath);
        $selector.data('filterText', '');
        $selector.data('entries', []);
        $selector.data('activeEntryPath', '');
        $selector.data('editingPath', false);

        $selector.on('click', function() {
            selectDirectorySelector($selector);
        });

        $selector.on('dblclick', '.directory-selector-topline', function(evt) {
            if ($(evt.target).closest('[data-directory-set], [data-directory-options-toggle], [data-directory-options-menu], [data-directory-path-input]').length > 0) {
                return;
            }
            selectDirectorySelector($selector);
            beginPathEdit($selector);
        });

        $selector.on('click', '[data-directory-options-toggle]', function(evt) {
            evt.stopPropagation();
            selectDirectorySelector($selector);
            toggleOptionsMenu($selector);
        });

        $selector.on('click', '[data-directory-options-menu]', function(evt) {
            evt.stopPropagation();
        });

        $selector.on('change', '[data-browser-show-files], [data-browser-show-hidden]', function() {
            loadDirectory($selector, String($selector.data('currentPath') || ''), '');
        });

        $selector.on('click', '[data-directory-path]', function(evt) {
            selectDirectorySelector($selector);
            if ($(this).is('a')) {
                evt.preventDefault();
            }
            openDirectory($selector, String($(this).attr('data-directory-path') || ''));
        });

        $selector.on('click', '[data-directory-set]', function() {
            selectDirectorySelector($selector);
            applyDirectorySelection($selector);
        });

        $selector.on('input', '[data-directory-search-input]', function() {
            updateFilterText($selector, String($(this).val() || ''));
        });

        $selector.on('keydown', '[data-directory-search-input]', function(evt) {
            selectDirectorySelector($selector);

            if (evt.key === 'Escape') {
                evt.preventDefault();
                closeAllOptionsMenus();
                clearSearch($selector);
                return;
            }

            if (evt.key === 'ArrowUp' && evt.shiftKey) {
                if (openParentDirectory($selector)) {
                    evt.preventDefault();
                }
                return;
            }

            if (evt.key === 'ArrowDown' || evt.key === 'ArrowUp') {
                evt.preventDefault();
                moveActiveEntry($selector, evt.key === 'ArrowDown' ? 1 : -1);
                return;
            }

            if (evt.key === 'Enter') {
                if (openActiveEntry($selector)) {
                    evt.preventDefault();
                }
            }
        });

        $selector.on('keydown', '[data-directory-path-input]', function(evt) {
            if (evt.key === 'Enter') {
                evt.preventDefault();
                commitPathEdit($selector);
                return;
            }
            if (evt.key === 'Escape') {
                evt.preventDefault();
                endPathEdit($selector, false);
            }
        });

        $selector.on('blur', '[data-directory-path-input]', function() {
            if (isPathEditing($selector)) {
                endPathEdit($selector, false);
            }
        });

        loadDirectory($selector, initialPath, initialError);
    });

    $(document).on('click', function(evt) {
        var $target = $(evt.target);
        var inOptionsMenu = $target.closest('[data-directory-options-menu]').length > 0;
        var inOptionsToggle = $target.closest('[data-directory-options-toggle]').length > 0;
        if (!inOptionsMenu && !inOptionsToggle) {
            closeAllOptionsMenus();
        }
    });

    $(document).on('keydown', function(evt) {
        if (evt.key === 'Escape') {
            closeAllOptionsMenus();
            if (endActivePathEdit()) {
                evt.preventDefault();
                return;
            }
            if (clearActiveSearch()) {
                evt.preventDefault();
            }
            return;
        }

        var $selected = activeDirectorySelector();
        if ($selected.length === 0 || isTypingTarget(evt.target) || isPathEditing($selected) || evt.metaKey || evt.ctrlKey || evt.altKey) {
            return;
        }

        if (evt.key === 'ArrowUp' && evt.shiftKey) {
            if (openParentDirectory($selected)) {
                evt.preventDefault();
            }
            return;
        }

        if (evt.key === 'ArrowDown' || evt.key === 'ArrowUp') {
            evt.preventDefault();
            moveActiveEntry($selected, evt.key === 'ArrowDown' ? 1 : -1);
            return;
        }

        if (evt.key === 'Enter') {
            if (openActiveEntry($selected)) {
                evt.preventDefault();
            }
            return;
        }

        if (evt.key === 'Backspace') {
            var current = String($selected.data('filterText') || '');
            if (current === '') {
                return;
            }
            evt.preventDefault();
            showSearch($selected, current.slice(0, -1));
            return;
        }

        if (evt.key.length === 1) {
            evt.preventDefault();
            showSearch($selected, String($selected.data('filterText') || '') + evt.key);
        }
    });

    function loadDirectory($selector, path, fallbackError) {
        var nextPath = String(path || '');
        setDirectoryLoadingState($selector, true);
        var options = currentBrowseOptions($selector);
        var url = new URL('/browse', window.location.origin);
        url.searchParams.set('path', nextPath);
        if (options.showFiles) {
            url.searchParams.set('show_files', 'true');
        }
        if (options.showHidden) {
            url.searchParams.set('show_hidden', 'true');
        }

        fetch(url.toString(), {
            method: 'GET'
        }).then(function(resp) {
            return resp.json().catch(function() {
                return {};
            }).then(function(body) {
                if (!resp.ok && !body.error) {
                    body.error = 'HTTP ' + resp.status;
                }
                return body;
            });
        }).then(function(data) {
            renderDirectorySelector($selector, data || {}, fallbackError);
        }).catch(function(err) {
            renderDirectorySelector($selector, {
                path: nextPath,
                separator: '/',
                segments: [],
                entries: [],
                error: err && err.message ? err.message : fallbackError || 'Failed to load directories.'
            }, fallbackError);
        }).finally(function() {
            setDirectoryLoadingState($selector, false);
        });
    }

    function renderDirectorySelector($selector, data, fallbackError) {
        var path = String(data.path || $selector.data('currentPath') || '');
        var separator = String(data.separator || '/');
        var segments = Array.isArray(data.segments) ? data.segments : [];
        var entries = Array.isArray(data.entries) ? data.entries : [];
        var error = String(data.error || fallbackError || '');
        var label = String($selector.attr('data-label') || 'directory');
        var filterText = String($selector.data('filterText') || '');

        $selector.data('currentPath', path);
        $selector.data('entries', entries);
        ensureActiveEntry($selector, entries, filterText);
        renderDirectoryBreadcrumbs($selector.find('[data-directory-breadcrumbs]'), segments, separator);
        syncPathEditUI($selector);
        renderDirectoryEntries($selector.find('[data-directory-entries]'), entries, filterText);
        syncSearchUI($selector);

        var $status = $selector.find('[data-directory-status]');
        var matchCount = filterEntries(entries, filterText).length;
        if (filterText && matchCount === 0) {
            $status.text('No matches in this ' + label + ' location.');
        } else if (entries.length === 0) {
            $status.text('No subdirectories in this ' + label + ' location.');
        } else {
            $status.text('Choose a ' + label + ' directory to load images.');
        }

        var $error = $selector.find('[data-directory-error]');
        if (error) {
            $error.text(error).prop('hidden', false);
        } else {
            $error.text('').prop('hidden', true);
        }
    }

    function renderDirectoryBreadcrumbs($container, segments, separator) {
        $container.empty();
        if (!Array.isArray(segments) || segments.length === 0) {
            return;
        }

        segments.forEach(function(segment, idx) {
            if (shouldRenderSeparator(segments, idx, separator)) {
                $container.append(
                    $('<span class="directory-path-separator"></span>').text(separator)
                );
            }

            var label = String(segment.name || segment.Name || segment.path || segment.Path || '');
            var path = String(segment.path || segment.Path || '');
            var $link = $('<a href="#" class="directory-segment"></a>');
            $link.text(label);
            $link.attr('data-directory-path', path);
            if (idx === segments.length - 1) {
                $link.addClass('is-current');
            }
            $container.append($link);
        });
    }

    function shouldRenderSeparator(segments, idx, separator) {
        if (idx <= 0) {
            return false;
        }
        var previous = segments[idx - 1] || {};
        return !(separator === '/' && previous.path === '/' && previous.name === '/');
    }

    function renderDirectoryEntries($container, entries, filterText) {
        $container.empty();
        var visibleEntries = filterEntries(entries, filterText);
        var activePath = String($container.closest('[data-directory-selector]').data('activeEntryPath') || '');
        if (!Array.isArray(visibleEntries) || visibleEntries.length === 0) {
            return;
        }

        visibleEntries.forEach(function(entry) {
            var label = String(entry.name || entry.Name || entry.path || entry.Path || '');
            var path = String(entry.path || entry.Path || '');
            var isDir = !!(entry.is_dir || entry.IsDir);
            var $entry = $(isDir
                ? '<button type="button" class="directory-entry"></button>'
                : '<div class="directory-entry is-file" aria-disabled="true"></div>');
            if (isDir) {
                $entry.attr('data-directory-path', path);
                if (path === activePath) {
                    $entry.addClass('is-active');
                }
            }
            $entry.append('<span class="' + (isDir ? 'fa-regular fa-folder-open' : 'fa-solid fa-file') + '" aria-hidden="true"></span>');
            $entry.append($('<span class="directory-entry-name"></span>').text(label));
            $container.append($entry);
        });
    }

    function setDirectoryLoadingState($selector, loading) {
        $selector.toggleClass('is-loading', loading);
        $selector.find('[data-directory-set]').prop('disabled', loading);
    }

    function applyDirectorySelection($selector) {
        var queryName = String($selector.attr('data-query-name') || '');
        var currentPath = String($selector.data('currentPath') || '');
        if (!queryName || !currentPath) {
            return;
        }

        var url = new URL(window.location.href);
        url.searchParams.delete(queryName);
        url.searchParams.append(queryName, currentPath);
        window.location.href = url.toString();
    }

    function currentBrowseOptions($selector) {
        return {
            showFiles: selectorCheckbox($selector, '[data-browser-show-files]'),
            showHidden: selectorCheckbox($selector, '[data-browser-show-hidden]')
        };
    }

    function selectorCheckbox($selector, selector) {
        return $selector.find(selector).prop('checked');
    }

    function toggleOptionsMenu($selector) {
        var $menu = $selector.find('[data-directory-options-menu]').first();
        var $toggle = $selector.find('[data-directory-options-toggle]').first();
        var open = $toggle.attr('aria-expanded') === 'true';
        closeAllOptionsMenus();
        if (!open) {
            $menu.prop('hidden', false);
            $toggle.attr('aria-expanded', 'true').addClass('is-active');
        }
    }

    function closeAllOptionsMenus() {
        $workspace.find('[data-directory-options-menu]').prop('hidden', true);
        $workspace.find('[data-directory-options-toggle]').attr('aria-expanded', 'false').removeClass('is-active');
    }

    function selectDirectorySelector($selector) {
        $workspace.find('[data-directory-selector]').removeClass('is-selected');
        $selector.addClass('is-selected');
    }

    function activeDirectorySelector() {
        return $workspace.find('[data-directory-selector].is-selected').first();
    }

    function isPathEditing($selector) {
        return !!$selector.data('editingPath');
    }

    function showSearch($selector, value) {
        updateFilterText($selector, value);
        var $search = $selector.find('[data-directory-search]');
        var $input = $selector.find('[data-directory-search-input]');
        $search.prop('hidden', false);
        $input.val(String(value || ''));
        $input.trigger('focus');
        var input = $input.get(0);
        if (input && typeof input.setSelectionRange === 'function') {
            var len = input.value.length;
            input.setSelectionRange(len, len);
        }
    }

    function syncSearchUI($selector) {
        var value = String($selector.data('filterText') || '');
        var $search = $selector.find('[data-directory-search]');
        var $input = $selector.find('[data-directory-search-input]');
        $input.val(value);
        $search.prop('hidden', value === '');
    }

    function syncPathEditUI($selector) {
        var editing = isPathEditing($selector);
        $selector.find('[data-directory-breadcrumbs]').prop('hidden', editing);
        $selector.find('[data-directory-path-input]').prop('hidden', !editing);
    }

    function updateFilterText($selector, value) {
        var next = String(value || '');
        $selector.data('filterText', next);
        ensureActiveEntry($selector, $selector.data('entries') || [], next);
        renderDirectoryEntries($selector.find('[data-directory-entries]'), $selector.data('entries') || [], next);
        syncSearchUI($selector);

        var label = String($selector.attr('data-label') || 'directory');
        var entries = $selector.data('entries') || [];
        var matches = filterEntries(entries, next).length;
        var $status = $selector.find('[data-directory-status]');
        if (next && matches === 0) {
            $status.text('No matches in this ' + label + ' location.');
        } else if (entries.length === 0) {
            $status.text('No subdirectories in this ' + label + ' location.');
        } else {
            $status.text('Choose a ' + label + ' directory to load images.');
        }
    }

    function clearActiveSearch() {
        var $selected = activeDirectorySelector();
        if ($selected.length === 0) {
            return false;
        }
        var current = String($selected.data('filterText') || '');
        if (current === '') {
            return false;
        }
        clearSearch($selected);
        return true;
    }

    function clearSearch($selector) {
        updateFilterText($selector, '');
    }

    function beginPathEdit($selector) {
        $selector.data('editingPath', true);
        syncPathEditUI($selector);
        var $input = $selector.find('[data-directory-path-input]');
        $input.val(String($selector.data('currentPath') || ''));
        $input.trigger('focus');
        var input = $input.get(0);
        if (input && typeof input.setSelectionRange === 'function') {
            var len = input.value.length;
            input.setSelectionRange(len, len);
        }
    }

    function commitPathEdit($selector) {
        var value = String($selector.find('[data-directory-path-input]').val() || '').trim();
        endPathEdit($selector, false);
        if (value !== '') {
            openDirectory($selector, value);
        }
    }

    function endPathEdit($selector, keepValue) {
        if (!isPathEditing($selector)) {
            return false;
        }
        $selector.data('editingPath', false);
        if (!keepValue) {
            $selector.find('[data-directory-path-input]').val('');
        }
        syncPathEditUI($selector);
        return true;
    }

    function endActivePathEdit() {
        var $selected = activeDirectorySelector();
        if ($selected.length === 0) {
            return false;
        }
        return endPathEdit($selected, false);
    }

    function openDirectory($selector, path) {
        if (!path) {
            return;
        }
        endPathEdit($selector, false);
        updateFilterText($selector, '');
        $selector.data('activeEntryPath', '');
        loadDirectory($selector, path, '');
    }

    function moveActiveEntry($selector, delta) {
        var dirs = navigableEntries($selector);
        if (dirs.length === 0) {
            return;
        }

        var activePath = String($selector.data('activeEntryPath') || '');
        var idx = -1;
        for (var i = 0; i < dirs.length; i += 1) {
            if (entryPath(dirs[i]) === activePath) {
                idx = i;
                break;
            }
        }

        if (idx < 0) {
            idx = delta > 0 ? 0 : dirs.length - 1;
        } else {
            idx = Math.max(0, Math.min(dirs.length - 1, idx + delta));
        }

        $selector.data('activeEntryPath', entryPath(dirs[idx]));
        renderDirectoryEntries($selector.find('[data-directory-entries]'), $selector.data('entries') || [], String($selector.data('filterText') || ''));
        scrollActiveEntryIntoView($selector);
    }

    function openActiveEntry($selector) {
        var activePath = String($selector.data('activeEntryPath') || '');
        if (!activePath) {
            var dirs = navigableEntries($selector);
            if (dirs.length === 0) {
                return false;
            }
            activePath = entryPath(dirs[0]);
        }
        openDirectory($selector, activePath);
        return true;
    }

    function openParentDirectory($selector) {
        var currentPath = String($selector.data('currentPath') || '');
        if (!currentPath) {
            return false;
        }
        var parentPath = parentDirectoryPath(currentPath);
        if (!parentPath || parentPath === currentPath) {
            return false;
        }
        openDirectory($selector, parentPath);
        return true;
    }

    function ensureActiveEntry($selector, entries, filterText) {
        var dirs = navigableEntriesFrom(entries, filterText);
        var activePath = String($selector.data('activeEntryPath') || '');
        var stillVisible = false;
        for (var i = 0; i < dirs.length; i += 1) {
            if (entryPath(dirs[i]) === activePath) {
                stillVisible = true;
                break;
            }
        }
        if (stillVisible) {
            return;
        }
        $selector.data('activeEntryPath', dirs.length > 0 ? entryPath(dirs[0]) : '');
    }

    function navigableEntries($selector) {
        return navigableEntriesFrom($selector.data('entries') || [], String($selector.data('filterText') || ''));
    }

    function navigableEntriesFrom(entries, filterText) {
        return filterEntries(entries, filterText).filter(function(entry) {
            return !!(entry.is_dir || entry.IsDir);
        });
    }

    function scrollActiveEntryIntoView($selector) {
        var $active = $selector.find('.directory-entry.is-active').first();
        if ($active.length === 0) {
            return;
        }
        var el = $active.get(0);
        if (el && typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ block: 'nearest' });
        }
    }

    function filterEntries(entries, filterText) {
        if (!Array.isArray(entries)) {
            return [];
        }
        var needle = normalizeFilterText(filterText);
        if (needle === '') {
            return entries;
        }
        var matches = [];
        entries.forEach(function(entry, idx) {
            var label = String(entry.name || entry.Name || entry.path || entry.Path || '');
            var normalized = normalizeFilterText(label);
            if (!fuzzyMatch(normalized, needle)) {
                return;
            }
            matches.push({
                entry: entry,
                idx: idx,
                startsWith: normalized.indexOf(needle) === 0
            });
        });

        matches.sort(function(a, b) {
            if (a.startsWith !== b.startsWith) {
                return a.startsWith ? -1 : 1;
            }
            return a.idx - b.idx;
        });

        return matches.map(function(match) {
            return match.entry;
        });
    }

    function normalizeFilterText(value) {
        return String(value || '').toLowerCase().trim();
    }

    function entryPath(entry) {
        return String(entry.path || entry.Path || '');
    }

    function parentDirectoryPath(path) {
        var value = String(path || '');
        if (value === '') {
            return '';
        }

        var trimmed = value.replace(/[\\/]+$/, '');
        if (trimmed === '') {
            return value;
        }

        var idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
        if (idx < 0) {
            return trimmed;
        }
        if (idx === 0) {
            return trimmed.charAt(0);
        }
        return trimmed.slice(0, idx);
    }

    function fuzzyMatch(haystack, needle) {
        var idx = 0;
        for (var i = 0; i < haystack.length && idx < needle.length; i += 1) {
            if (haystack.charAt(i) === needle.charAt(idx)) {
                idx += 1;
            }
        }
        return idx === needle.length;
    }

    function isTypingTarget(target) {
        var $target = $(target);
        return $target.is('input, textarea, select') || $target.closest('[contenteditable="true"]').length > 0;
    }
});
