/**
 * app.js - Main application bootstrap and router
 */

// ── Toast Notification System ─────────────────────────────
window.Toast = {
    show(msg, type = 'success', duration = 3000) {
        const container = document.getElementById('toast-container');
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
        el.innerHTML = `<span>${icons[type] || ''}</span><span>${msg}</span>`;
        container.appendChild(el);
        setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.4s'; setTimeout(() => el.remove(), 400); }, duration);
    },
};

// ── Clock ─────────────────────────────────────────────────
function startClock() {
    const el = document.getElementById('clock');
    const tick = () => {
        const now = new Date();
        el.textContent = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    };
    tick();
    setInterval(tick, 1000);
}

// ── App Router ────────────────────────────────────────────
window.App = {
    currentView: 'map',

    navigate(viewId) {
        // Hide standard views and remove active state from nav
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

        // Manage floating map widget
        const mapWidget = document.getElementById('map-widget');
        if (viewId === 'map') {
            mapWidget.style.display = 'block';
            mapWidget.classList.remove('map-minimized');
            mapWidget.classList.add('map-expanded');
            document.getElementById('btn-toggle-map-size').innerHTML = '➖ Minimieren';

            // Show fields view underneath the map to prevent a black screen
            const fieldsView = document.getElementById('view-fields');
            if (fieldsView) fieldsView.classList.add('active');
        } else {
            mapWidget.style.display = 'none';
            mapWidget.classList.remove('map-expanded');
            mapWidget.classList.add('map-minimized');
            document.getElementById('btn-toggle-map-size').innerHTML = '🔲 Vergrößern';

            // Show the actual target view underneath the minimized map
            const view = document.getElementById('view-' + viewId);
            if (view) view.classList.add('active');
        }

        const navItem = document.querySelector(`.nav-item[data-view="${viewId}"]`);
        if (navItem) navItem.classList.add('active');

        this.currentView = viewId;
        setTimeout(() => MapMgr.map.invalidateSize(), 300);

        // Refresh data on navigation
        if (viewId === 'fields') FieldsModule.renderList();
        if (viewId === 'trips') TripsModule.renderList();
        if (viewId === 'costs') CostsModule.renderSummary();
        if (viewId === 'stats') StatsModule.render();
    },
};

// ── Settings Panel ────────────────────────────────────────
function initSettings() {
    const btn = document.getElementById('btn-settings');
    const panel = document.getElementById('settings-panel');
    const close = document.getElementById('btn-settings-close');

    btn.addEventListener('click', () => panel.classList.toggle('open'));
    close.addEventListener('click', () => panel.classList.remove('open'));

    // Tractor name
    DB.getConfig('tractorName', 'Mein Traktor').then(name => {
        document.getElementById('cfg-tractor-name').value = name;
    });
}

// ── Install PWA prompt ────────────────────────────────────
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    document.getElementById('btn-install').style.display = 'flex';
});
window.addEventListener('appinstalled', () => {
    document.getElementById('btn-install').style.display = 'none';
    Toast.show('App installiert!', 'success');
});

// ── Init Map (Leaflet - no callback needed) ────────────────
async function initMapLeaflet() {
    await MapMgr.init();

    // Wire GPS → Map
    GPS.on('position', (pt) => {
        MapMgr.updateTractorPosition(pt);
        if (GPS.isTracking) MapMgr.addLivePoint(pt);
    });

    // Auto-start GPS watch (position only, not tracking)
    GPS.start();
}

// ── Main init ─────────────────────────────────────────────
async function initApp() {
    // Open DB
    await DB.open();

    // Clock
    startClock();

    // Register service worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./service-worker.js')
            .then(() => console.log('[App] Service Worker registered'))
            .catch(e => console.warn('[App] SW failed:', e));
    }

    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => App.navigate(item.dataset.view));
    });

    // Default view
    App.navigate('map');

    // Init map (Leaflet)
    await initMapLeaflet();

    // Init modules
    FieldsModule.init();
    TripsModule.init();
    await CostsModule.init();
    await StatsModule.init();
    initSettings();

    // Install button
    document.getElementById('btn-install').addEventListener('click', async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const result = await deferredPrompt.userChoice;
            deferredPrompt = null;
        }
    });

    // GPS badge click → center on tractor
    document.getElementById('gps-badge').addEventListener('click', () => MapMgr.centerOnTractor());

    // Save tractor name
    document.getElementById('btn-save-settings').addEventListener('click', async () => {
        const name = document.getElementById('cfg-tractor-name').value.trim();
        if (name) { await DB.setConfig('tractorName', name); Toast.show('💾 Einstellungen gespeichert', 'success'); }
    });

    console.log('[App] Trecker Manager ready 🚜');
}

// Wait for DOM
document.addEventListener('DOMContentLoaded', initApp);
