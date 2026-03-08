/**
 * costs.js - Fuel & cost calculation module
 */
const CostsModule = {
    // Defaults
    defaults: {
        fuelRate: 12,    // L/h
        machineRate: 45,    // €/h
        dieselPrice: 1.65,  // €/L
    },

    async init() {
        this.fuelRate = parseFloat(await DB.getConfig('fuelRate', this.defaults.fuelRate));
        this.machineRate = parseFloat(await DB.getConfig('machineRate', this.defaults.machineRate));
        this.dieselPrice = parseFloat(await DB.getConfig('dieselPrice', this.defaults.dieselPrice));

        this._bindInputs();
        this.renderSummary();

        // Populate settings inputs
        document.getElementById('cfg-fuel-rate').value = this.fuelRate;
        document.getElementById('cfg-machine-rate').value = this.machineRate;
        document.getElementById('cfg-diesel-price').value = this.dieselPrice;
    },

    _bindInputs() {
        const save = async () => {
            this.fuelRate = parseFloat(document.getElementById('cfg-fuel-rate').value) || this.defaults.fuelRate;
            this.machineRate = parseFloat(document.getElementById('cfg-machine-rate').value) || this.defaults.machineRate;
            this.dieselPrice = parseFloat(document.getElementById('cfg-diesel-price').value) || this.defaults.dieselPrice;
            await DB.setConfig('fuelRate', this.fuelRate);
            await DB.setConfig('machineRate', this.machineRate);
            await DB.setConfig('dieselPrice', this.dieselPrice);
            this.renderSummary();
            Toast.show('💾 Einstellungen gespeichert', 'success');
        };
        document.getElementById('btn-save-config').addEventListener('click', save);

        document.getElementById('btn-fetch-diesel').addEventListener('click', () => this.fetchLiveDieselPrice());
    },

    async fetchLiveDieselPrice() {
        if (!navigator.geolocation) {
            Toast.show('GPS nicht verfügbar', 'error');
            return;
        }

        const btn = document.getElementById('btn-fetch-diesel');
        const prevHtml = btn.innerHTML;
        btn.innerHTML = '⏳';
        btn.disabled = true;
        Toast.show('Suche Tankstellen in der Nähe...', 'info');

        navigator.geolocation.getCurrentPosition(async (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            const apiKey = '3efaea49-bc3d-4d57-8871-25e08399af68';
            const url = `https://creativecommons.tankerkoenig.de/json/list.php?lat=${lat}&lng=${lng}&rad=15&sort=price&type=diesel&apikey=${apiKey}`;

            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error('API request failed');
                const data = await res.json();

                if (data.ok && data.stations && data.stations.length > 0) {
                    // Filter open stations that have a diesel price
                    const openStations = data.stations.filter(s => s.isOpen && typeof s.price === 'number');

                    if (openStations.length > 0) {
                        // Prices are already sorted by the API (sort=price)
                        let bestStation = openStations[0];
                        // Tankerkönig prices are usually with 3 decimals (e.g. 1.659), round to 2 for UI
                        const roundedPrice = Math.round(bestStation.price * 100) / 100;

                        document.getElementById('cfg-diesel-price').value = roundedPrice;
                        Toast.show(`📍 ${bestStation.brand || bestStation.name}: ${bestStation.price} €/L`, 'success', 5000);
                    } else {
                        Toast.show('Keine offenen Tankstellen mit Diesel gefunden', 'warning');
                    }
                } else {
                    Toast.show('Keine Tankstellen in 15km Umkreis gefunden', 'warning');
                }
            } catch (error) {
                console.error('[CostsModule] Tankerkönig API error:', error);
                Toast.show('Fehler beim Abruf der Tankstellen', 'error');
            } finally {
                btn.innerHTML = prevHtml;
                btn.disabled = false;
            }
        }, (err) => {
            Toast.show('GPS Position konnte nicht ermittelt werden', 'error');
            btn.innerHTML = prevHtml;
            btn.disabled = false;
        }, { timeout: 10000, maximumAge: 60000 });
    },

    // Calculate cost for a trip record, save to DB
    async calcTripCost(trip) {
        const hours = (trip.duration || 0) / 60;
        const fuelUsed = Math.round(this.fuelRate * hours * 10) / 10;
        const fuelCost = Math.round(fuelUsed * this.dieselPrice * 100) / 100;
        const machCost = Math.round(this.machineRate * hours * 100) / 100;
        const total = Math.round((fuelCost + machCost) * 100) / 100;

        const cost = { tripId: trip.id, fuelUsed, fuelCost, machCost, total, hours: Math.round(hours * 100) / 100 };
        await DB.put('costs', cost);
        return cost;
    },

    async renderSummary() {
        const trips = await DB.getAll('trips');
        const costs = await DB.getAll('costs');

        // Build lookup
        const costMap = {};
        costs.forEach(c => { costMap[c.tripId] = c; });

        // Totals
        let totalFuel = 0, totalCost = 0, totalHours = 0;
        costs.forEach(c => { totalFuel += c.fuelUsed || 0; totalCost += c.total || 0; totalHours += c.hours || 0; });

        document.getElementById('cost-total-value').textContent = totalCost.toFixed(2);
        document.getElementById('cost-fuel-total').textContent = totalFuel.toFixed(1) + ' L';
        document.getElementById('cost-hours-total').textContent = totalHours.toFixed(1) + ' h';

        // Per-trip breakdown list
        const list = document.getElementById('costs-list');
        const tripsWithCost = trips
            .filter(t => costMap[t.id])
            .sort((a, b) => new Date(b.date) - new Date(a.date));

        if (!tripsWithCost.length) {
            list.innerHTML = `
        <div class="empty-state">
          <div class="es-icon">💰</div>
          <h3>Noch keine Kosten</h3>
          <p>Kosten werden automatisch nach jeder Fahrt berechnet.</p>
        </div>`;
            return;
        }

        list.innerHTML = tripsWithCost.map(t => {
            const c = costMap[t.id];
            const wt = TripsModule.WORK_TYPES[t.workType] || { label: t.workType, icon: '🔧' };
            const dt = new Date(t.date).toLocaleDateString('de-DE');
            return `
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">${wt.icon} ${wt.label}</div>
              <div class="card-subtitle">${dt} · ${c.hours} h</div>
            </div>
            <span class="badge gold">${c.total.toFixed(2)} €</span>
          </div>
          <div class="card-body">
            <div class="stat-item"><label>Diesel</label><value>${c.fuelUsed.toFixed(1)} L</value></div>
            <div class="stat-item"><label>Kraftstoff</label><value>${c.fuelCost.toFixed(2)} €</value></div>
            <div class="stat-item"><label>Maschine</label><value>${c.machCost.toFixed(2)} €</value></div>
            <div class="stat-item"><label>Gesamt</label><value class="gold">${c.total.toFixed(2)} €</value></div>
          </div>
        </div>`;
        }).join('');
    },
};

window.CostsModule = CostsModule;
