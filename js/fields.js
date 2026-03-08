/**
 * fields.js - Field boundary management module
 */
const FieldsModule = {
    isPerimeterRecording: false,
    perimeterInterval: null,
    currentFieldId: null,

    init() {
        document.getElementById('btn-field-gps').addEventListener('click', () => this.startPerimeterMode());
        document.getElementById('btn-field-manual').addEventListener('click', () => this.startManualMode());
        document.getElementById('btn-perimeter-stop').addEventListener('click', () => this.stopPerimeterRecording());
        document.getElementById('btn-manual-finish').addEventListener('click', () => this.finishManualDraw());
        document.getElementById('btn-manual-cancel').addEventListener('click', () => this.cancelManualDraw());
        document.getElementById('btn-save-field').addEventListener('click', () => this.saveFieldForm());
        document.getElementById('btn-new-field').addEventListener('click', () => this.showNewFieldOptions());
        document.getElementById('overlay-field-form').addEventListener('click', (e) => {
            if (e.target.id === 'overlay-field-form') this.closeFieldForm();
        });
        this.renderList();
    },

    async renderList() {
        const fields = await DB.getAll('fields');
        const list = document.getElementById('fields-list');
        if (!fields.length) {
            list.innerHTML = `
        <div class="empty-state">
          <div class="es-icon">🌾</div>
          <h3>Noch keine Felder</h3>
          <p>Lege dein erstes Feld per GPS-Perimeterfahrt oder manuell auf der Karte an.</p>
        </div>`;
            return;
        }
        list.innerHTML = fields.map(f => this._fieldCard(f)).join('');
        // attach events
        list.querySelectorAll('[data-field-id]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = btn.dataset.fieldId;
                const action = btn.dataset.action;
                if (action === 'view') this.showFieldOnMap(id);
                if (action === 'delete') this.deleteField(id);
            });
        });
    },

    _fieldCard(f) {
        const cropBadge = f.crop ? `<span class="badge green">🌱 ${f.crop}</span>` : '';
        const date = f.createdAt ? new Date(f.createdAt).toLocaleDateString('de-DE') : '';
        return `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">📍 ${f.name}</div>
            <div class="card-subtitle">${date} ${cropBadge}</div>
          </div>
          <span class="badge gold">${f.area ?? 0} ha</span>
        </div>
        <div class="card-body">
          <div class="stat-item"><label>Punkte</label><value>${f.coords?.length ?? 0}</value></div>
          <div class="stat-item"><label>Fläche</label><value class="accent">${f.area ?? 0} ha</value></div>
        </div>
        <div class="card-actions">
          <button class="btn btn-secondary btn-sm" data-field-id="${f.id}" data-action="view">🗺️ Karte</button>
          <button class="btn btn-danger btn-sm"    data-field-id="${f.id}" data-action="delete">🗑️ Löschen</button>
        </div>
      </div>`;
    },

    showNewFieldOptions() {
        document.getElementById('field-options-panel').style.display = 'flex';
    },

    // ── GPS Perimeter Mode ──────────────────────────────────
    startPerimeterMode() {
        if (!GPS.watchId) GPS.start();

        document.getElementById('field-options-panel').style.display = 'none';
        this.isPerimeterRecording = true;
        MapMgr.startPerimeterRecording();

        // Record a point every 2 seconds from GPS
        this.perimeterInterval = setInterval(() => {
            if (GPS.currentPos) {
                MapMgr.addPerimeterPoint(GPS.currentPos);
            }
        }, 2000);

        document.getElementById('btn-perimeter-stop').style.display = 'flex';
        Toast.show('🚜 Fahre jetzt um den Feldrand...', 'warning');
    },

    stopPerimeterRecording() {
        clearInterval(this.perimeterInterval);
        this.isPerimeterRecording = false;
        const coords = MapMgr.stopPerimeterRecording();
        document.getElementById('btn-perimeter-stop').style.display = 'none';

        if (coords.length < 3) {
            Toast.show('Zu wenige Punkte (min. 3)', 'error');
            return;
        }
        this._openFieldForm(coords, 'GPS-Perimeterfahrt');
    },

    // ── Manual Draw Mode ────────────────────────────────────
    startManualMode() {
        App.navigate('map');
        document.getElementById('field-options-panel').style.display = 'none';
        MapMgr.startManualDraw();
        document.getElementById('manual-draw-controls').style.display = 'flex';
    },

    finishManualDraw() {
        const coords = MapMgr.finishManualDraw();
        document.getElementById('manual-draw-controls').style.display = 'none';
        if (!coords || coords.length < 3) { Toast.show('Mindestens 3 Punkte setzen', 'error'); return; }
        this._openFieldForm(coords, 'Manuelle Eingabe');
    },

    cancelManualDraw() {
        MapMgr.cancelManualDraw();
        document.getElementById('manual-draw-controls').style.display = 'none';
    },

    // ── Save field form ─────────────────────────────────────
    _openFieldForm(coords, source) {
        const area = MapMgr.calcArea ? MapMgr.calcArea(coords) : MapManager.calcArea(coords);
        document.getElementById('field-form-coords').value = JSON.stringify(coords);
        document.getElementById('field-form-area').value = area;
        document.getElementById('field-form-source').value = source;
        document.getElementById('field-form-area-disp').textContent = area + ' ha';
        document.getElementById('field-name-input').value = '';
        document.getElementById('field-crop-input').value = '';
        document.getElementById('overlay-field-form').classList.add('open');
    },

    closeFieldForm() {
        document.getElementById('overlay-field-form').classList.remove('open');
    },

    async saveFieldForm() {
        const name = document.getElementById('field-name-input').value.trim();
        const crop = document.getElementById('field-crop-input').value.trim();
        const coords = JSON.parse(document.getElementById('field-form-coords').value || '[]');
        const area = parseFloat(document.getElementById('field-form-area').value) || 0;

        if (!name) { Toast.show('Bitte Feldname eingeben', 'error'); return; }

        const field = await DB.put('fields', { name, crop, coords, area });
        this.closeFieldForm();
        MapMgr.renderField(field);
        this.renderList();
        Toast.show(`✅ Feld "${name}" (${area} ha) gespeichert`, 'success');
        App.navigate('fields');
    },

    async showFieldOnMap(id) {
        const field = await DB.get('fields', id);
        if (!field || !field.coords?.length) return;
        App.navigate('map');
        MapMgr.fitToCoords(field.coords);
    },

    async showFieldDetail(id) {
        const field = await DB.get('fields', id);
        if (!field) return;
        Toast.show(`📍 ${field.name} – ${field.area} ha`, 'success');
    },

    async deleteField(id) {
        await DB.delete('fields', id);
        MapMgr.removeField(id);
        this.renderList();
        Toast.show('Feld gelöscht', 'warning');
    },
};

window.FieldsModule = FieldsModule;
