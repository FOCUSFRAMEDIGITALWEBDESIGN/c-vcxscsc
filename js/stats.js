/**
 * stats.js - Statistics and reporting module
 */
const StatsModule = {
    charts: {},

    async init() {
        await this.render();
    },

    async render() {
        const [trips, fields, costs] = await Promise.all([
            DB.getAll('trips'),
            DB.getAll('fields'),
            DB.getAll('costs'),
        ]);

        // Summary stats
        const totalDist = trips.reduce((s, t) => s + (t.distance || 0), 0);
        const totalHours = costs.reduce((s, c) => s + (c.hours || 0), 0);
        const totalFuel = costs.reduce((s, c) => s + (c.fuelUsed || 0), 0);
        const totalCost = costs.reduce((s, c) => s + (c.total || 0), 0);
        const totalHa = fields.reduce((s, f) => s + (f.area || 0), 0);

        document.getElementById('st-fields').textContent = fields.length;
        document.getElementById('st-trips').textContent = trips.length;
        document.getElementById('st-dist').textContent = totalDist.toFixed(1);
        document.getElementById('st-hours').textContent = totalHours.toFixed(1);
        document.getElementById('st-fuel').textContent = totalFuel.toFixed(1);
        document.getElementById('st-cost').textContent = totalCost.toFixed(2);
        document.getElementById('st-ha').textContent = totalHa.toFixed(2);

        // Work type chart
        this._drawWorkTypeChart(trips);
        // Monthly trips chart
        this._drawMonthlyChart(trips);
    },

    _drawWorkTypeChart(trips) {
        const ctx = document.getElementById('chart-worktype');
        if (!ctx) return;

        const labels = Object.entries(TripsModule.WORK_TYPES).map(([, v]) => v.label);
        const keys = Object.keys(TripsModule.WORK_TYPES);
        const colors = ['#42a5f5', '#ff7043', '#66bb6a', '#f0b429', '#ab47bc'];
        const data = keys.map(k => trips.filter(t => t.workType === k).length);

        // Destroy previous
        if (this.charts.worktype) this.charts.worktype = null;

        const W = ctx.offsetWidth || 400, H = 160;
        ctx.width = W;
        ctx.height = H;
        const c = ctx.getContext('2d');
        c.clearRect(0, 0, W, H);

        const barW = Math.min(60, (W / data.length) - 16);
        const maxVal = Math.max(...data, 1);
        const padX = (W - data.length * (barW + 16)) / 2;
        const padY = 20;

        data.forEach((val, i) => {
            const x = padX + i * (barW + 16);
            const barH = val ? ((val / maxVal) * (H - padY - 30)) : 0;
            const y = H - 30 - barH;

            // Bar
            c.fillStyle = colors[i];
            c.globalAlpha = 0.85;
            c.beginPath();
            c.roundRect ? c.roundRect(x, y, barW, barH, [4, 4, 0, 0]) : c.rect(x, y, barW, barH);
            c.fill();
            c.globalAlpha = 1;

            // Value
            if (val > 0) {
                c.fillStyle = '#e8f5e9';
                c.font = 'bold 13px Inter,sans-serif';
                c.textAlign = 'center';
                c.fillText(val, x + barW / 2, y - 5);
            }

            // Label
            c.fillStyle = '#5a8c5e';
            c.font = '11px Inter,sans-serif';
            c.textAlign = 'center';
            const lbl = labels[i].length > 8 ? labels[i].slice(0, 7) + '…' : labels[i];
            c.fillText(lbl, x + barW / 2, H - 10);
        });
    },

    _drawMonthlyChart(trips) {
        const ctx = document.getElementById('chart-monthly');
        if (!ctx) return;

        // Last 6 months
        const now = new Date();
        const months = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleString('de-DE', { month: 'short' }) });
        }
        const data = months.map(m => trips.filter(t => t.date?.startsWith(m.key)).length);

        const W = ctx.offsetWidth || 400, H = 160;
        ctx.width = W;
        ctx.height = H;
        const c = ctx.getContext('2d');
        c.clearRect(0, 0, W, H);

        const barW = Math.min(50, (W / months.length) - 14);
        const maxVal = Math.max(...data, 1);
        const padX = (W - months.length * (barW + 14)) / 2;

        data.forEach((val, i) => {
            const x = padX + i * (barW + 14);
            const barH = val ? ((val / maxVal) * 110) : 5;
            const y = 130 - barH;

            // Bar gradient
            const grad = c.createLinearGradient(x, y, x, y + barH);
            grad.addColorStop(0, '#4caf50');
            grad.addColorStop(1, '#1a3a14');
            c.fillStyle = grad;
            c.globalAlpha = 0.9;
            c.beginPath();
            c.roundRect ? c.roundRect(x, y, barW, barH, [4, 4, 0, 0]) : c.rect(x, y, barW, barH);
            c.fill();
            c.globalAlpha = 1;

            // Value
            if (val > 0) {
                c.fillStyle = '#e8f5e9';
                c.font = 'bold 12px Inter,sans-serif';
                c.textAlign = 'center';
                c.fillText(val, x + barW / 2, y - 4);
            }

            // Month label
            c.fillStyle = '#5a8c5e';
            c.font = '11px Inter,sans-serif';
            c.textAlign = 'center';
            c.fillText(months[i].label, x + barW / 2, 148);
        });
    },
};

window.StatsModule = StatsModule;
