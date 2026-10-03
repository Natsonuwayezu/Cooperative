/* ============================================================
   router.js — hash-based routing
   ============================================================ */
'use strict';

ELF.router = (function () {
    const routes = {};

    function register(name, renderFn) { routes[name] = renderFn; }

    async function go(route, params = {}) {
        const [name, ...rest] = route.split('/');
        const view = ELF.ui.$('#view');
        // nav highlight
        ELF.ui.$$('.nav-item').forEach(a => a.classList.toggle('active', a.dataset.route === name));
        ELF.ui.$$('.bn-item').forEach(a => a.classList.toggle('active', a.dataset.route === name));
        // close mobile sidebar
        document.getElementById('sidebar').classList.remove('open');

        const fn = routes[name] || routes['dashboard'];
        try {
            view.innerHTML = `<div class="muted center" style="padding:60px 0">Loading…</div>`;
            await fn(view, { id: rest[0], ...params });
        } catch (e) {
            console.error(e);
            view.innerHTML = `<div class="card"><div class="card-title">Something went wrong</div><div class="card-sub">${ELF.ui.escapeHtml(e.message)}</div></div>`;
        }
        window.scrollTo({ top: 0, behavior: 'instant' });
    }

    function parse() {
        const h = (location.hash || '#dashboard').replace(/^#/, '');
        return h || 'dashboard';
    }

    function init() {
        window.addEventListener('hashchange', () => go(parse()));
        document.addEventListener('click', e => {
            const a = e.target.closest('[data-route]');
            if (a && a.dataset.route) {
                e.preventDefault();
                location.hash = a.dataset.route;
            }
        });
        go(parse());
    }

    return { register, go, init, parse };
})();