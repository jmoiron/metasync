$(function() {
    var $workspace = $('[data-role="workspace"]');
    if ($workspace.length === 0) {
        return;
    }

    var pageID = String($workspace.attr('data-page-id') || '');
    if (!pageID) {
        return;
    }

    var $title = $('#app-title');
    var proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    var wsURL = proto + '//' + window.location.host + '/ws?page_id=' + encodeURIComponent(pageID);
    var ws = null;
    var reconnectTimer = 0;
    var reconnectDelay = 1000;

    function setConnectionState(connected) {
        $title.toggleClass('is-disconnected', !connected);
    }

    function clearReconnectTimer() {
        if (reconnectTimer) {
            window.clearTimeout(reconnectTimer);
            reconnectTimer = 0;
        }
    }

    function scheduleReconnect() {
        clearReconnectTimer();
        reconnectTimer = window.setTimeout(function() {
            reconnectTimer = 0;
            connect();
        }, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 10000);
    }

    function connect() {
        clearReconnectTimer();
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        setConnectionState(false);
        ws = new WebSocket(wsURL);

        ws.onopen = function() {
            reconnectDelay = 1000;
            setConnectionState(true);
        };

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

        ws.onclose = function() {
            ws = null;
            setConnectionState(false);
            scheduleReconnect();
        };

        ws.onerror = function() {
            if (ws && ws.readyState !== WebSocket.CLOSED) {
                ws.close();
            }
        };
    }

    if ($title.length > 0) {
        $title.on('click', function() {
            reconnectDelay = 1000;
            clearReconnectTimer();
            if (ws) {
                try {
                    ws.close();
                } catch (err) {
                }
                ws = null;
            }
            setConnectionState(false);
            connect();
        });
    }

    window.addEventListener('beforeunload', function() {
        clearReconnectTimer();
        if (ws) {
            try {
                ws.close();
            } catch (err) {
            }
        }
    });

    window.metasyncProgress = {
        pageID: pageID,
        reconnect: function() {
            reconnectDelay = 1000;
            clearReconnectTimer();
            connect();
        },
        connected: function() {
            return !!ws && ws.readyState === WebSocket.OPEN;
        }
    };

    connect();
});
