/**
 * map.js - Leaflet.js map integration
 * Satellite tiles: ESRI World Imagery (free, no API key)
 */
class MapManager {
    constructor() {
        this.map = null;
        this.tractorMarker = null;
        this.accuracyCircle = null;
        this.livePolyline = null;
        this.livePoints = [];
        this.fieldLayers = {};   // fieldId → LayerGroup
        this.perimeterLayer = null;
        this.perimeterPoints = [];
        this.drawingMode = null;
        this.manualPoints = [];
        this.manualMarkers = [];
        this.previewPolygon = null;
        this.initialized = false;
        this.satelliteLayer = null;
        this.roadLayer = null;
    }

    async init() {
        if (this.initialized) return;
        const mapEl = document.getElementById('map');
        if (!mapEl) return;

        this.map = L.map('map', {
            center: [51.1657, 10.4515],
            zoom: 13,
            zoomControl: false,
            attributionControl: true,
        });

        // ── Tile layers ──────────────────────────────────────────
        this.satelliteLayer = L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            { attribution: 'Tiles © Esri', maxZoom: 20 }
        );

        this.labelsLayer = L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
            { attribution: '', maxZoom: 20, opacity: 0.8 }
        );

        this.roadLayer = L.tileLayer(
            'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            { attribution: '© OpenStreetMap', maxZoom: 19 }
        );

        // Default: satellite + labels
        this.satelliteLayer.addTo(this.map);
        this.labelsLayer.addTo(this.map);
        this._isSatellite = true;

        // ── Custom zoom controls ─────────────────────────────────
        L.control.zoom({ position: 'bottomleft' }).addTo(this.map);

        // ── Locate button ────────────────────────────────────────
        const locateBtn = L.control({ position: 'bottomleft' });
        locateBtn.onAdd = () => {
            const btn = L.DomUtil.create('button', 'leaflet-locate-btn');
            btn.innerHTML = '⊕';
            btn.title = 'Auf Traktor zentrieren';
            btn.onclick = (e) => { L.DomEvent.stopPropagation(e); this.centerOnTractor(); };
            return btn;
        };
        locateBtn.addTo(this.map);

        this.initialized = true;

        // Try GPS center
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(pos => {
                this.map.setView([pos.coords.latitude, pos.coords.longitude], 16);
            }, () => { }, { timeout: 5000 });
        }

        // Render saved fields
        this.renderAllFields();
    }

    // ── Layer toggle ─────────────────────────────────────────
    toggleMapType() {
        if (this._isSatellite) {
            this.map.removeLayer(this.satelliteLayer);
            this.map.removeLayer(this.labelsLayer);
            this.roadLayer.addTo(this.map);
            this._isSatellite = false;
            return 'Satellit';
        } else {
            this.map.removeLayer(this.roadLayer);
            this.satelliteLayer.addTo(this.map);
            this.labelsLayer.addTo(this.map);
            this._isSatellite = true;
            return 'Karte';
        }
    }

    // ── Tractor marker ───────────────────────────────────────
    updateTractorPosition(point) {
        const latlng = [point.lat, point.lng];

        if (!this.tractorMarker) {
            const icon = this._tractorIcon(point.heading || 0);
            this.tractorMarker = L.marker(latlng, { icon, zIndexOffset: 1000 }).addTo(this.map);
        } else {
            this.tractorMarker.setLatLng(latlng);
            this.tractorMarker.setIcon(this._tractorIcon(point.heading || 0));
        }

        // Accuracy circle
        if (this.accuracyCircle) {
            this.accuracyCircle.setLatLng(latlng).setRadius(point.accuracy);
        } else {
            this.accuracyCircle = L.circle(latlng, {
                radius: point.accuracy,
                color: '#4caf50',
                weight: 1,
                fillColor: '#4caf50',
                fillOpacity: 0.1,
                opacity: 0.5,
            }).addTo(this.map);
        }
    }

    _tractorIcon(heading) {
        return L.divIcon({
            className: '',
            html: `<div style="
        width:32px;height:32px;
        display:flex;align-items:center;justify-content:center;
        transform:rotate(${heading}deg);
        filter:drop-shadow(0 2px 4px rgba(0,0,0,0.8));
        font-size:28px;
        transition:transform 0.3s;
      ">🚜</div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16],
        });
    }

    centerOnTractor() {
        if (this.tractorMarker) {
            this.map.setView(this.tractorMarker.getLatLng(), this.map.getZoom());
        } else if (GPS.currentPos) {
            this.map.setView([GPS.currentPos.lat, GPS.currentPos.lng], 16);
        } else {
            Toast.show('Noch keine GPS-Position', 'warning');
        }
    }

    // ── Live route ───────────────────────────────────────────
    addLivePoint(point) {
        this.livePoints.push([point.lat, point.lng]);
        if (!this.livePolyline) {
            this.livePolyline = L.polyline(this.livePoints, {
                color: '#ff7043',
                weight: 5,
                opacity: 0.9,
            }).addTo(this.map);
        } else {
            this.livePolyline.setLatLngs(this.livePoints);
        }
    }

    clearLiveRoute() {
        if (this.livePolyline) { this.livePolyline.remove(); this.livePolyline = null; }
        this.livePoints = [];
    }

    drawTripRoute(points, color = '#42a5f5') {
        const latlngs = points.map(p => [p.lat, p.lng]);
        return L.polyline(latlngs, { color, weight: 4, opacity: 0.8 }).addTo(this.map);
    }

    // ── Field polygons ───────────────────────────────────────
    renderAllFields() {
        DB.getAll('fields').then(fields => fields.forEach(f => this.renderField(f)));
    }

    renderField(field) {
        if (this.fieldLayers[field.id]) {
            this.fieldLayers[field.id].remove();
        }
        if (!field.coords || field.coords.length < 3) return;

        const colors = ['#4caf50', '#42a5f5', '#ff7043', '#ab47bc', '#ffee58', '#26c6da'];
        const idx = Object.keys(this.fieldLayers).length % colors.length;
        const color = colors[idx];

        const latlngs = field.coords.map(c => [c.lat, c.lng]);
        const poly = L.polygon(latlngs, {
            color,
            weight: 2,
            fillColor: color,
            fillOpacity: 0.2,
        });

        const label = L.tooltip({ permanent: true, direction: 'center', className: 'field-label' })
            .setContent(`<b>${field.name}</b><br>${field.area} ha`);

        const group = L.layerGroup([poly]).addTo(this.map);
        poly.bindTooltip(label, { permanent: true, direction: 'center', className: 'field-label' });
        poly.on('click', () => { window.FieldsModule && FieldsModule.showFieldDetail(field.id); });

        this.fieldLayers[field.id] = group;
    }

    removeField(fieldId) {
        if (this.fieldLayers[fieldId]) {
            this.fieldLayers[fieldId].remove();
            delete this.fieldLayers[fieldId];
        }
    }

    // ── Perimeter recording ──────────────────────────────────
    startPerimeterRecording() {
        this.perimeterPoints = [];
        this.perimeterCornerMarkers = [];
        this.perimeterLayer = L.polygon([], {
            color: '#fb8c00',
            weight: 3,
            fillColor: '#fb8c00',
            fillOpacity: 0.2,
        }).addTo(this.map);
        document.getElementById('perimeter-badge').style.display = 'flex';
        document.getElementById('btn-perimeter-corner').style.display = 'flex';
    }

    addPerimeterCorner() {
        if (!GPS.currentPos) {
            Toast.show('Lokalisierung läuft...', 'warning');
            return;
        }
        const point = GPS.currentPos;
        this.perimeterPoints.push([point.lat, point.lng]);

        // Add a marker to show the corner
        const cornerMarker = L.circleMarker([point.lat, point.lng], {
            radius: 6,
            color: '#fff',
            weight: 2,
            fillColor: '#fb8c00',
            fillOpacity: 1,
        }).addTo(this.map);

        this.perimeterCornerMarkers.push(cornerMarker);

        if (this.perimeterLayer) {
            this.perimeterLayer.setLatLngs(this.perimeterPoints);
        }

        Toast.show(`📍 Ecke ${this.perimeterPoints.length} markiert`, 'info');
    }

    addPerimeterPoint(point) {
        // Disabled: we only want manual corners now, not continuous line recording
    }

    stopPerimeterRecording() {
        document.getElementById('perimeter-badge').style.display = 'none';
        document.getElementById('btn-perimeter-corner').style.display = 'none';

        if (this.perimeterLayer) { this.perimeterLayer.remove(); this.perimeterLayer = null; }
        if (this.perimeterCornerMarkers) {
            this.perimeterCornerMarkers.forEach(m => m.remove());
            this.perimeterCornerMarkers = [];
        }
        return this.perimeterPoints.map(p => ({ lat: p[0], lng: p[1] }));
    }

    // ── Manual polygon drawing ───────────────────────────────
    startManualDraw() {
        this.drawingMode = 'manual';
        this.manualPoints = [];
        this.manualMarkers = [];
        if (this.previewPolygon) { this.previewPolygon.remove(); this.previewPolygon = null; }

        this.previewPolygon = L.polygon([], {
            color: '#4caf50',
            weight: 2,
            dashArray: '8 4',
            fillColor: '#4caf50',
            fillOpacity: 0.15,
        }).addTo(this.map);

        this._mapClickFn = (e) => this._addManualPoint(e.latlng);
        this.map.on('click', this._mapClickFn);
        Toast.show('Punkte auf Karte tippen → Abschliessen drücken', 'warning');
    }

    _addManualPoint(latlng) {
        this.manualPoints.push([latlng.lat, latlng.lng]);
        const marker = L.circleMarker(latlng, {
            radius: 8,
            color: '#fff',
            weight: 2,
            fillColor: '#4caf50',
            fillOpacity: 1,
        }).addTo(this.map);
        this.manualMarkers.push(marker);
        this.previewPolygon.setLatLngs(this.manualPoints);
    }

    finishManualDraw() {
        this.map.off('click', this._mapClickFn);
        this._mapClickFn = null;
        this.drawingMode = null;
        this.manualMarkers.forEach(m => m.remove());
        this.manualMarkers = [];
        if (this.previewPolygon) { this.previewPolygon.remove(); this.previewPolygon = null; }
        return this.manualPoints.map(p => ({ lat: p[0], lng: p[1] }));
    }

    cancelManualDraw() {
        const pts = this.finishManualDraw();
        this.manualPoints = [];
        return null;
    }

    // ── Area calculation (spherical, no Google dependency) ───
    static calcArea(coords) {
        if (!coords || coords.length < 3) return 0;
        const R = 6371000; // Earth radius in meters
        const toRad = d => d * Math.PI / 180;
        let area = 0;
        const n = coords.length;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const xi = toRad(coords[i].lng);
            const yi = toRad(coords[i].lat);
            const xj = toRad(coords[j].lng);
            const yj = toRad(coords[j].lat);
            area += (xj - xi) * (2 + Math.sin(yi) + Math.sin(yj));
        }
        area = Math.abs(area * R * R / 2);
        return Math.round(area / 10000 * 100) / 100; // m² → ha
    }

    // ── Fit map to coords ────────────────────────────────────
    fitToCoords(coords) {
        const latlngs = coords.map(c => [c.lat || c[0], c.lng || c[1]]);
        this.map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] });
    }
}

window.MapMgr = new MapManager();
