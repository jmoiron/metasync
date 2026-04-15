$(function() {
    var $workspace = $('[data-role="workspace"]');
    if ($workspace.length === 0) {
        return;
    }

    var pageID = String($workspace.attr('data-page-id') || '');
    if (!pageID) {
        return;
    }

    var proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    var wsURL = proto + '//' + window.location.host + '/ws?page_id=' + encodeURIComponent(pageID);
    var ws = new WebSocket(wsURL);

    ws.onmessage = function(evt) {
        var payload;
        try {
            payload = JSON.parse(evt.data);
        } catch (err) {
            return;
        }
        if (!payload || payload.type !== 'progress' || !payload.progress) {
            return;
        }
        document.dispatchEvent(new CustomEvent('metasync:progress', {
            detail: payload.progress
        }));
    };

    window.metasyncProgress = {
        pageID: pageID
    };
});
