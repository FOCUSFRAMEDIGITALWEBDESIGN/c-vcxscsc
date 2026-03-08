/**
 * gps.js - GPS tracking and accuracy management
 */
class GPSManager {
    constructor() {
        this.watchId = null;
        this.currentPos = null;
        this.trackPoints = [];
        this.isTracking = false;
        this.listeners = {};
        this.accuracyCircle = null;
    }

    // Register event listeners
    on(event, fn) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(fn);
    }

    emit(event, data) {
        (this.listeners[event] || []).forEach(fn => fn(data));
    }

    // Start watching position
    start() {
        if (!navigator.geolocation) {
            Toast.show('GPS nicht verfügbar', 'error');
            return;
        }
        this.watchId = navigator.geolocation.watchPosition(
            (pos) => this._onPosition(pos),
            (err) => this._onError(err),
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 1000 }
        );
        Toast.show('🛰️ GPS aktiv', 'success');
    }

    // Stop watching
    stop() {
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
    }

    // Start trip tracking (saves points)
    startTracking(resumePoints = null) {
        this.trackPoints = resumePoints ? [...resumePoints] : [];
        this.isTracking = true;
        if (!this.watchId) this.start();
        this.emit('trackingStarted', {});
    }

    // Stop trip tracking, return points
    stopTracking() {
        this.isTracking = false;
        const points = [...this.trackPoints];
        this.emit('trackingStopped', { points });
        return points;
    }

    async _onPosition(pos) {
        const { latitude, longitude, speed, heading, accuracy } = pos.coords;
        let point = {
            lat: latitude,
            lng: longitude,
            speed: speed !== null ? Math.round(speed * 3.6) : 0, // m/s → km/h
            heading: heading !== null ? Math.round(heading) : 0,
            accuracy: Math.round(accuracy),
            timestamp: pos.timestamp,
        };

        // Ignore points with wildly high inaccuracy (> 50m) during tracking to prevent route jumping
        if (this.isTracking && point.accuracy > 50) {
            this._updateBadge(point);
            return;
        }

        // Snap to road if accuracy is poor and we are tracking a transport trip
        if (this.isTracking && point.accuracy > 15) {
            const trip = window.TripsModule && window.TripsModule.activeTrip;
            if (trip && trip.workType === 'transport') {
                point = await this._snapPointToRoad(point);
            }
        }

        this.currentPos = point;

        if (this.isTracking) {
            this.trackPoints.push(point);
        }

        this._updateBadge(point);
        this.emit('position', point);
    }

    async _snapPointToRoad(point) {
        try {
            const url = `https://router.project-osrm.org/nearest/v1/driving/${point.lng},${point.lat}?number=1`;
            const res = await fetch(url);
            if (!res.ok) return point;
            const data = await res.json();
            if (data.code === 'Ok' && data.waypoints && data.waypoints.length > 0) {
                const match = data.waypoints[0];
                if (match.distance < 200) {
                    return { ...point, lat: match.location[1], lng: match.location[0], snapped: true };
                }
            }
        } catch (e) {
            console.warn('[GPS] Snap error', e);
        }
        return point;
    }

    _onError(err) {
        console.warn('[GPS] Error:', err.message);
        const msgs = {
            1: 'GPS-Zugriff verweigert',
            2: 'Position nicht verfügbar',
            3: 'GPS-Timeout',
        };
        Toast.show(msgs[err.code] || 'GPS-Fehler', 'error');
        this._setBadge('--', 'Kein Signal', 'poor');
    }

    _updateBadge(point) {
        const acc = point.accuracy;
        let cls, label;
        if (acc <= 3) { cls = 'excellent'; label = `±${acc}m`; }
        else if (acc <= 10) { cls = 'good'; label = `±${acc}m`; }
        else if (acc <= 20) { cls = 'medium'; label = `±${acc}m`; }
        else { cls = 'poor'; label = `±${acc}m`; }
        this._setBadge(label, this._qualityText(cls), cls);
    }

    _qualityText(cls) {
        return { excellent: 'Sehr gut', good: 'Gut', medium: 'Mittel', poor: 'Schwach' }[cls] || '';
    }

    _setBadge(label, title, cls) {
        const dot = document.getElementById('gps-dot');
        const text = document.getElementById('gps-text');
        if (dot) { dot.className = ''; dot.classList.add(cls); }
        if (text) text.textContent = label;
        // tooltip
        const badge = document.getElementById('gps-badge');
        if (badge) badge.title = title;
    }

    // Get quality level string
    getQuality(accuracy) {
        if (accuracy <= 3) return 'excellent';
        if (accuracy <= 10) return 'good';
        if (accuracy <= 20) return 'medium';
        return 'poor';
    }

    // Calculate total distance of a track (km)
    static calcDistance(points) {
        let dist = 0;
        for (let i = 1; i < points.length; i++) {
            dist += GPSManager.haversine(points[i - 1], points[i]);
        }
        return Math.round(dist * 1000) / 1000; // km
    }

    // Haversine formula
    static haversine(a, b) {
        const R = 6371;
        const dLat = (b.lat - a.lat) * Math.PI / 180;
        const dLng = (b.lng - a.lng) * Math.PI / 180;
        const sin2 = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.asin(Math.sqrt(sin2));
    }
}

window.GPS = new GPSManager();
