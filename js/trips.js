/**
 * trips.js - Work trip documentation module
 */
const TripsModule = {
    activeTrip: null,
    startTime: null,
    timerInterval: null,
    shownRouteLayer: null,  // currently displayed saved route

    WORK_TYPES: {
        transport: { label: 'Transport', icon: '🚛', cls: 'wt-transport', color: '#42a5f5' },
        bodenbearbeitung: { label: 'Bodenbearbeitung', icon: '🔄', cls: 'wt-bodenbearbeitung', color: '#ff7043' },
        aussaat: { label: 'Aussaat', icon: '🌱', cls: 'wt-aussaat', color: '#66bb6a' },
        ernte: { label: 'Ernte', icon: '🌾', cls: 'wt-ernte', color: '#f0b429' },
        duengung: { label: 'Düngung', icon: '💧', cls: 'wt-duengung', color: '#ab47bc' },
    },

    async init() {
        document.getElementById('btn-trip-start').addEventListener('click', () => this.showTripStart());
        document.getElementById('btn-trip-save').addEventListener('click', () => this.saveTripForm());
        document.getElementById('btn-trip-cancel').addEventListener('click', () => this.cancelTripForm());
        document.getElementById('btn-track-start').addEventListener('click', () => this.startTracking());
        document.getElementById('btn-track-stop').addEventListener('click', () => this.stopTracking());
        document.getElementById('overlay-trip-form').addEventListener('click', (e) => {
            if (e.target.id === 'overlay-trip-form') this.closeTripForm();
        });
        this.renderList();
        this._populateFields();
        await this._checkBufferedTrip();
    },

    async _checkBufferedTrip() {
        const buffered = await DB.getConfig('activeTripBuffer', null);
        if (buffered) {
            this.activeTrip = {
                workType: buffered.workType,
                fieldId: buffered.fieldId,
                material: buffered.material,
                route: []
            };
            this.startTime = buffered.startTime;

            App.navigate('map');
            this.startTracking(buffered.route || []);
            Toast.show('Fahrt wiederhergestellt', 'info');
        }
    },

    async _populateFields() {
        const sel = document.getElementById('trip-field-select');
        const fields = await DB.getAll('fields');
        sel.innerHTML = '<option value="">— Kein Feld —</option>' +
            fields.map(f => `<option value="${f.id}">${f.name} (${f.area} ha)</option>`).join('');
    },

    showTripStart() {
        this._populateFields();
        document.getElementById('trip-material-input').value = '';
        document.getElementById('overlay-trip-form').classList.add('open');
    },

    closeTripForm() {
        document.getElementById('overlay-trip-form').classList.remove('open');
    },

    cancelTripForm() { this.closeTripForm(); },

    async saveTripForm() {
        const workType = document.getElementById('trip-worktype-select').value;
        const fieldId = document.getElementById('trip-field-select').value;
        const material = document.getElementById('trip-material-input').value.trim();
        this.activeTrip = { workType, fieldId, material, route: [] };
        this.closeTripForm();
        // Switch to map so user sees the live route
        App.navigate('map');
        setTimeout(() => this.startTracking(), 300);
    },

    startTracking(resumePoints = null) {
        if (!this.activeTrip) {
            this.activeTrip = { workType: 'transport', fieldId: '', material: '', route: [] };
        }
        if (!resumePoints) {
            this.startTime = Date.now();
        }
        MapMgr.clearLiveRoute();

        // Clear any previously shown saved route
        this._clearShownRoute();

        GPS.startTracking(resumePoints);
        if (!GPS.watchId) GPS.start();

        if (resumePoints && resumePoints.length > 0) {
            resumePoints.forEach(p => MapMgr.addLivePoint(p));
        }

        // Timer
        this.timerInterval = setInterval(() => this._updateTimer(), 1000);

        // Auto-save
        this.autoSaveInterval = setInterval(async () => {
            if (GPS.isTracking && this.activeTrip) {
                const bufferedTrip = {
                    ...this.activeTrip,
                    startTime: this.startTime,
                    route: GPS.trackPoints
                };
                await DB.setConfig('activeTripBuffer', bufferedTrip);
            }
        }, 5000);

        // Show tracking bar, hide start button
        const bar = document.getElementById('tracking-bar');
        bar.classList.remove('hidden');
        document.getElementById('btn-track-start').style.display = 'none';
        document.getElementById('btn-track-stop').style.display = 'flex';
        document.getElementById('btn-quick-track').style.display = 'none';

        // Wire GPS → live route on map
        this._gpsListener = (pt) => {
            if (!GPS.isTracking) return;
            MapMgr.updateTractorPosition(pt);
            MapMgr.addLivePoint(pt);
            document.getElementById('trk-speed').textContent = `${pt.speed} km/h`;
            document.getElementById('trk-dist').textContent = `${GPSManager.calcDistance(GPS.trackPoints).toFixed(2)} km`;
        };
        GPS.on('position', this._gpsListener);

        const wt = this.WORK_TYPES[this.activeTrip.workType] || { label: this.activeTrip.workType, icon: '🔧' };
        if (!resumePoints) {
            Toast.show(`${wt.icon} Fahrt gestartet – Linie wird gezeichnet`, 'success');
        }
    },

    async stopTracking() {
        clearInterval(this.timerInterval);
        clearInterval(this.autoSaveInterval);
        await DB.delete('config', 'activeTripBuffer');

        // Remove live GPS listener
        if (this._gpsListener) {
            GPS.listeners['position'] = (GPS.listeners['position'] || []).filter(f => f !== this._gpsListener);
            this._gpsListener = null;
        }

        let points = GPS.stopTracking();

        if (this.activeTrip && this.activeTrip.workType === 'transport' && points.length > 1) {
            Toast.show('Route wird optimiert (Snap to Road)...', 'info');
            points = await this._snapToRoad(points);
        }

        const duration = Math.round((Date.now() - this.startTime) / 60000);
        const distance = GPSManager.calcDistance(points);

        const trip = {
            ...this.activeTrip,
            date: new Date().toISOString(),
            duration,
            distance,
            route: points,
        };

        const saved = await DB.put('trips', trip);
        await CostsModule.calcTripCost(saved);

        // Reset tracking UI
        const bar = document.getElementById('tracking-bar');
        bar.classList.add('hidden');
        document.getElementById('btn-track-start').style.display = 'flex';
        document.getElementById('btn-track-stop').style.display = 'none';
        document.getElementById('btn-quick-track').style.display = 'flex';
        document.getElementById('trk-time').textContent = '00:00';
        document.getElementById('trk-speed').textContent = '0 km/h';
        document.getElementById('trk-dist').textContent = '0 km';

        // Show the completed route on map
        MapMgr.clearLiveRoute();
        if (points.length > 1) {
            const wt = this.WORK_TYPES[saved.workType] || { color: '#4caf50' };
            this.shownRouteLayer = MapMgr.drawTripRoute(points, wt.color);
            MapMgr.fitToCoords(points.map(p => ({ lat: p.lat, lng: p.lng })));
        }

        this.activeTrip = null;
        this.renderList();

        Toast.show(`✅ Fahrt gespeichert – ${duration} min, ${distance.toFixed(1)} km`, 'success');
    },

    _updateTimer() {
        const elapsed = Date.now() - this.startTime;
        const m = Math.floor(elapsed / 60000);
        const s = Math.floor((elapsed % 60000) / 1000);
        document.getElementById('trk-time').textContent =
            `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    },

    async _snapToRoad(points) {
        // We can't send thousands of points to OSRM easily due to URL length limits.
        // We will take a max of ~100 evenly distributed points.
        if (points.length < 2) return points;

        const maxPoints = 90;
        let sampled = points;
        if (points.length > maxPoints) {
            sampled = [];
            const step = points.length / maxPoints;
            for (let i = 0; i < maxPoints; i++) {
                sampled.push(points[Math.floor(i * step)]);
            }
            sampled.push(points[points.length - 1]); // Always include start & end
        }

        const coordsStr = sampled.map(p => `${p.lng},${p.lat}`).join(';');
        const url = `https://router.project-osrm.org/match/v1/driving/${coordsStr}?steps=false&geometries=geojson&overview=full`;

        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error('OSRM API request failed');
            const data = await res.json();

            if (data.code === 'Ok' && data.matchings && data.matchings.length > 0) {
                // Return the matched geometry as our new route points
                const snappedCoords = data.matchings[0].geometry.coordinates;
                // snappedCoords is [[lng, lat], [lng, lat], ...]
                return snappedCoords.map(c => ({ lat: c[1], lng: c[0] }));
            } else {
                return points; // Fallback to raw points if matching couldn't find a path
            }
        } catch (e) {
            console.warn('[SnapToRoad] Failed or offline, using raw GPS points:', e);
            return points; // Fallback to raw points if entirely offline
        }
    },

    _clearShownRoute() {
        if (this.shownRouteLayer) {
            this.shownRouteLayer.remove();
            this.shownRouteLayer = null;
        }
    },

    async renderList() {
        const trips = await DB.getAll('trips');
        trips.sort((a, b) => new Date(b.date) - new Date(a.date));
        const list = document.getElementById('trips-list');
        if (!trips.length) {
            list.innerHTML = `
        <div class="empty-state">
          <div class="es-icon">🚜</div>
          <h3>Noch keine Fahrten</h3>
          <p>Starte eine neue Fahrt über den Button oben.</p>
        </div>`;
            return;
        }
        list.innerHTML = trips.map(t => this._tripCard(t)).join('');
        list.querySelectorAll('[data-trip-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.tripId;
                const action = btn.dataset.action;
                if (action === 'delete') this.deleteTrip(id);
                if (action === 'map') this.showTripOnMap(id);
            });
        });
    },

    _tripCard(t) {
        const wt = this.WORK_TYPES[t.workType] || { label: t.workType, icon: '🔧', cls: '', color: '#888' };
        const date = new Date(t.date).toLocaleString('de-DE', {
            day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'
        });
        const hasRoute = t.route && t.route.length > 1;
        return `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title ${wt.cls}">${wt.icon} ${wt.label}</div>
            <div class="card-subtitle">${date}${t.material ? ' · ' + t.material : ''}</div>
          </div>
          <span class="badge green">${(t.distance || 0).toFixed(1)} km</span>
        </div>
        <div class="card-body">
          <div class="stat-item"><label>Dauer</label><value>${t.duration ?? 0} min</value></div>
          <div class="stat-item"><label>Strecke</label><value class="accent">${(t.distance || 0).toFixed(1)} km</value></div>
          <div class="stat-item"><label>GPS-Punkte</label><value>${t.route?.length ?? 0}</value></div>
        </div>
        <div class="card-actions">
          ${hasRoute
                ? `<button class="btn btn-secondary btn-sm" data-trip-id="${t.id}" data-action="map"
                 style="border-color:${wt.color};color:${wt.color}">
                 🗺️ Auf Karte zeigen
               </button>`
                : '<span style="font-size:12px;color:var(--text-muted)">Keine GPS-Route</span>'
            }
          <button class="btn btn-danger btn-sm" data-trip-id="${t.id}" data-action="delete">🗑️</button>
        </div>
      </div>`;
    },

    async showTripOnMap(id) {
        const trip = await DB.get('trips', id);
        if (!trip || !trip.route?.length) { Toast.show('Keine Route gespeichert', 'warning'); return; }

        // Clear previous route
        this._clearShownRoute();

        App.navigate('map');

        const wt = this.WORK_TYPES[trip.workType] || { color: '#4caf50', label: 'Fahrt' };
        this.shownRouteLayer = MapMgr.drawTripRoute(trip.route, wt.color);

        // Fit map to route
        MapMgr.fitToCoords(trip.route.map(p => ({ lat: p.lat, lng: p.lng })));

        const dt = new Date(trip.date).toLocaleDateString('de-DE');
        Toast.show(`${wt.icon || '🗺️'} Route vom ${dt} – ${(trip.distance || 0).toFixed(1)} km`, 'success', 4000);
    },

    async deleteTrip(id) {
        await DB.delete('trips', id);
        this.renderList();
        Toast.show('Fahrt gelöscht', 'warning');
    },
};

window.TripsModule = TripsModule;
