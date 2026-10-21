(function(root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.metasyncGPSHeatmap = api;
    }
})(typeof window !== 'undefined' ? window : globalThis, function() {
    var earthRadiusMeters = 6371008.8;

    function points(entries, cellSizeMeters, minimumWeight) {
        cellSizeMeters = cellSizeMeters || 500;
        minimumWeight = minimumWeight === undefined ? 0.18 : minimumWeight;

        var cells = new Map();
        entries.forEach(function(entry) {
            var latitude = Number(entry.latitude);
            var longitude = Number(entry.longitude);
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
                return;
            }
            var latRadians = latitude * Math.PI / 180;
            var x = earthRadiusMeters * longitude * Math.PI / 180;
            var y = earthRadiusMeters * Math.log(Math.tan(Math.PI / 4 + latRadians / 2));
            var key = Math.floor(x / cellSizeMeters) + ':' + Math.floor(y / cellSizeMeters);
            var cell = cells.get(key);
            if (!cell) {
                cell = { latitude: 0, longitude: 0, count: 0 };
                cells.set(key, cell);
            }
            cell.latitude += latitude;
            cell.longitude += longitude;
            cell.count += 1;
        });

        var maxCount = 0;
        cells.forEach(function(cell) { maxCount = Math.max(maxCount, cell.count); });
        var logMax = Math.log1p(maxCount);
        var result = [];
        cells.forEach(function(cell) {
            var density = logMax ? Math.log1p(cell.count) / logMax : 0;
            var weight = minimumWeight + (1 - minimumWeight) * density;
            result.push([
                cell.latitude / cell.count,
                cell.longitude / cell.count,
                weight
            ]);
        });
        return result;
    }

    return { points: points };
});
