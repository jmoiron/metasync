function applyTheme(theme) {
    if (theme === 'dark') {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
}

function currentCardExifMs($card) {
    return parseExifTime($card.attr('data-exif-time'));
}

function parseExifTime(value) {
    if (!value || value === 'n/a') {
        return NaN;
    }
    var m = String(value).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
    if (!m) {
        return NaN;
    }
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), 0).getTime();
}

function compareCardsByTimeThenOrder(aMs, bMs, aOrder, bOrder) {
    var aHas = Number.isFinite(aMs);
    var bHas = Number.isFinite(bMs);
    if (aHas && bHas) {
        if (aMs !== bMs) {
            return aMs - bMs;
        }
        return aOrder - bOrder;
    }
    if (aHas) {
        return -1;
    }
    if (bHas) {
        return 1;
    }
    return aOrder - bOrder;
}

function keyForTime(mode, ms) {
    var d = new Date(ms);
    var yyyy = d.getFullYear();
    var mm = pad2(d.getMonth() + 1);
    var dd = pad2(d.getDate());
    if (mode === 'hour') {
        return yyyy + '-' + mm + '-' + dd + ' ' + pad2(d.getHours());
    }
    return yyyy + '-' + mm + '-' + dd;
}

function groupSortTime(mode, ms) {
    var d = new Date(ms);
    if (mode === 'hour') {
        d.setMinutes(0, 0, 0);
    } else {
        d.setHours(0, 0, 0, 0);
    }
    return d.getTime();
}

function titleForGroup(mode, ms) {
    var d = new Date(ms);
    if (mode === 'hour') {
        return d.toLocaleString(undefined, {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        weekday: 'short'
    });
}

function formatGroupDate(ms) {
    return new Date(ms).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatExif(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

function formatDelta(ms) {
    var sign = ms >= 0 ? '+' : '-';
    var rest = Math.abs(ms);
    var totalSec = Math.floor(rest / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    return sign + h + 'h ' + m + 'm ' + s + 's';
}

function formatCoord(value) {
    return Number(value).toFixed(6);
}

function normalizeCoordText(value) {
    if (!value) {
        return '';
    }
    var n = Number(value);
    if (!Number.isFinite(n)) {
        return '';
    }
    return n.toFixed(6);
}

function pad2(num) {
    return num < 10 ? '0' + num : String(num);
}

function escapeHTML(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function formatBytes(bytes) {
    if (!bytes) {
        return '0 B';
    }
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var value = bytes;
    var unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value = value / 1024;
        unit += 1;
    }
    if (unit === 0) {
        return String(value) + ' ' + units[unit];
    }
    return value.toFixed(1) + ' ' + units[unit];
}
