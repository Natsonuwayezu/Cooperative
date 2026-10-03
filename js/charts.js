/* ============================================================
   charts.js — Chart.js wrappers
   ============================================================ */
'use strict';

ELF.charts = (function () {
    const instances = {};

    function themeColor() {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        return {
            text: isDark ? '#a4b8ad' : '#4a5a52',
            grid: isDark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.06)',
            brand: isDark ? '#6ee7b7' : '#0f5132',
            brandFade: isDark ? 'rgba(110,231,183,.15)' : 'rgba(15,81,50,.12)'
        };
    }

    function mount(id, config) {
        destroy(id);
        const el = document.getElementById(id);
        if (!el || !window.Chart) return;
        const t = themeColor();
        Chart.defaults.color = t.text;
        Chart.defaults.borderColor = t.grid;
        Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
        instances[id] = new Chart(el.getContext('2d'), config);
    }

    function destroy(id) { if (instances[id]) { instances[id].destroy(); delete instances[id]; } }
    function destroyAll() { Object.keys(instances).forEach(destroy); }

    function line(id, labels, datasets) {
        const t = themeColor();
        return mount(id, {
            type: 'line',
            data: {
                labels, datasets: datasets.map(ds => ({
                    ...ds, borderColor: ds.color || t.brand,
                    backgroundColor: ds.fill ? t.brandFade : 'transparent',
                    fill: !!ds.fill, tension: .32, borderWidth: 2, pointRadius: 2
                }))
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: datasets.length > 1, position: 'bottom' } },
                scales: { x: { grid: { color: t.grid } }, y: { grid: { color: t.grid }, ticks: { callback: v => Number(v).toLocaleString() } } }
            }
        });
    }

    function bar(id, labels, datasets) {
        const t = themeColor();
        return mount(id, {
            type: 'bar',
            data: {
                labels, datasets: datasets.map(ds => ({
                    ...ds, backgroundColor: ds.color || t.brand, borderRadius: 6
                }))
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: datasets.length > 1, position: 'bottom' } },
                scales: { x: { grid: { display: false } }, y: { grid: { color: t.grid }, ticks: { callback: v => Number(v).toLocaleString() } } }
            }
        });
    }

    function doughnut(id, labels, values, colors) {
        return mount(id, {
            type: 'doughnut',
            data: { labels, datasets: [{ data: values, backgroundColor: colors || ['#0f5132', '#b7791f', '#0369a1', '#b91c1c', '#7c3aed'] }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
        });
    }

    return { line, bar, doughnut, destroy, destroyAll };
})();