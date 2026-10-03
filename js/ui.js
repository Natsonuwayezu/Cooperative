/* ============================================================
   ui.js — toasts, modals, tables, forms, validation, confirm
   ============================================================ */
'use strict';

ELF.ui = (function () {
    const $ = (s, r) => (r || document).querySelector(s);
    const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

    // ---------- TOASTS ----------
    function toast(msg, kind = 'success', timeout = 3200) {
        const host = $('#toast-host');
        const el = document.createElement('div');
        el.className = 'toast ' + kind;
        el.textContent = msg;
        host.appendChild(el);
        setTimeout(() => {
            el.style.transition = 'opacity .25s, transform .25s';
            el.style.opacity = '0';
            el.style.transform = 'translateX(20px)';
            setTimeout(() => el.remove(), 260);
        }, timeout);
    }

    // ---------- MODAL ----------
    let modalResolve = null;
    function openModal({ title, body, actions = [], wide = false }) {
        $('#modal-title').textContent = title || 'Dialog';
        $('#modal-body').innerHTML = '';
        if (typeof body === 'string') $('#modal-body').innerHTML = body;
        else if (body instanceof Node) $('#modal-body').appendChild(body);
        const foot = $('#modal-foot');
        foot.innerHTML = '';
        actions.forEach(a => {
            const b = document.createElement('button');
            b.className = a.kind === 'primary' ? 'btn-primary'
                : a.kind === 'danger' ? 'btn-danger'
                    : a.kind === 'success' ? 'btn-success'
                        : 'btn-ghost';
            b.textContent = a.label;
            b.type = 'button';
            b.onclick = () => { if (a.onClick) a.onClick(); if (a.close !== false) closeModal(a.value); };
            foot.appendChild(b);
        });
        $('#modal-host').classList.remove('hidden');
        return new Promise(res => { modalResolve = res; });
    }
    function closeModal(value) {
        $('#modal-host').classList.add('hidden');
        if (modalResolve) { modalResolve(value); modalResolve = null; }
    }
    document.addEventListener('click', e => {
        if (e.target.matches('[data-close]')) closeModal(null);
        if (e.target.matches('.modal-backdrop')) closeModal(null);
    });

    function confirm(msg, { title = 'Are you sure?', okLabel = 'Confirm', danger = false } = {}) {
        return openModal({
            title,
            body: `<p style="margin:0;color:var(--text-2)">${escapeHtml(msg)}</p>`,
            actions: [
                { label: 'Cancel', value: false },
                { label: okLabel, kind: danger ? 'danger' : 'primary', value: true }
            ]
        });
    }

    async function prompt(title, label, { type = 'text', placeholder = '', required = false, multiline = false } = {}) {
        const id = 'pmt_' + Math.random().toString(36).slice(2);
        const body = `
      <div class="field">
        <label for="${id}">${escapeHtml(label)}${required ? ' *' : ''}</label>
        ${multiline
                ? `<textarea id="${id}" placeholder="${escapeHtml(placeholder)}"></textarea>`
                : `<input id="${id}" type="${type}" placeholder="${escapeHtml(placeholder)}">`}
      </div>`;
        const res = await openModal({
            title,
            body,
            actions: [
                { label: 'Cancel', value: null },
                { label: 'OK', kind: 'primary', value: '__ok__' }
            ]
        });
        if (res !== '__ok__') return null;
        // modal already closed, read before? We read after close from a temp var:
        // simpler: reopen not needed — we captured value via listener below
        return window.__lastPromptValue ?? null;
    }

    // ---------- ESCAPE ----------
    function escapeHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    // ---------- TABLES ----------
    function table(columns, rows, opts = {}) {
        const cols = columns.map(c => `<th class="${c.align === 'right' ? 'num' : ''}">${escapeHtml(c.label)}</th>`).join('');
        let body = '';
        if (!rows || !rows.length) {
            body = `<tr class="empty-row"><td colspan="${columns.length}">${escapeHtml(opts.empty || 'No records')}</td></tr>`;
        } else {
            body = rows.map(r => `<tr>${columns.map(c => {
                const v = c.render ? c.render(r) : r[c.key];
                const cls = (c.align === 'right' ? 'num ' : '') + (c.mono ? 'mono' : '');
                return `<td class="${cls}">${v === null || v === undefined ? '' : v}</td>`;
            }).join('')
                }</tr>`).join('');
        }
        return `<div class="table-wrap"><table class="data"><thead><tr>${cols}</tr></thead><tbody>${body}</tbody></table></div>`;
    }

    // ---------- FORM ----------
    /**
     * buildForm(schema, values) -> { html, read }
     * schema: [{ name, label, type, required, options?, hint?, full?, placeholder? }]
     */
    function buildForm(schema, values = {}) {
        const html = schema.map(f => {
            const v = values[f.name] ?? f.default ?? '';
            const id = 'f_' + f.name;
            let input;
            if (f.type === 'select') {
                input = `<select id="${id}" name="${f.name}" ${f.required ? 'required' : ''}>
          ${(f.options || []).map(o => {
                    const val = typeof o === 'object' ? o.value : o;
                    const lbl = typeof o === 'object' ? o.label : o;
                    return `<option value="${escapeHtml(val)}" ${String(v) === String(val) ? 'selected' : ''}>${escapeHtml(lbl)}</option>`;
                }).join('')}
        </select>`;
            } else if (f.type === 'textarea') {
                input = `<textarea id="${id}" name="${f.name}" placeholder="${escapeHtml(f.placeholder || '')}" ${f.required ? 'required' : ''}>${escapeHtml(v)}</textarea>`;
            } else {
                input = `<input id="${id}" name="${f.name}" type="${f.type || 'text'}"
                 value="${escapeHtml(v)}" placeholder="${escapeHtml(f.placeholder || '')}"
                 ${f.required ? 'required' : ''} ${f.step ? `step="${f.step}"` : ''}>`;
            }
            return `<div class="field ${f.full ? 'full' : ''}">
        <label for="${id}">${escapeHtml(f.label)}${f.required ? ' *' : ''}</label>
        ${input}
        ${f.hint ? `<div class="hint">${escapeHtml(f.hint)}</div>` : ''}
      </div>`;
        }).join('');

        function read(root) {
            const out = {};
            for (const f of schema) {
                const el = root.querySelector('[name="' + f.name + '"]');
                if (!el) continue;
                let v = el.value;
                if (f.type === 'number') v = v === '' ? null : Number(v);
                out[f.name] = v;
            }
            return out;
        }

        return { html: `<div class="form-grid">${html}</div>`, read };
    }

    function validateRequired(data, schema) {
        const errs = {};
        for (const f of schema) {
            if (f.required) {
                const v = data[f.name];
                if (v === null || v === undefined || v === '') errs[f.name] = 'Required';
            }
        }
        return errs;
    }

    // ---------- NET PILL ----------
    function updateNetPill() {
        const pill = document.getElementById('net-pill');
        if (!pill) return;
        const online = ELF.isOnline();
        pill.classList.toggle('offline', !online);
        pill.querySelector('span:last-child').textContent = online ? 'Online' : 'Offline';
    }

    // ---------- PAGE HELPERS ----------
    function pageHead(title, sub, actionsHtml = '') {
        return `<div class="page-head">
      <div>
        <div class="page-title">${escapeHtml(title)}</div>
        ${sub ? `<div class="page-sub">${escapeHtml(sub)}</div>` : ''}
      </div>
      <div class="page-actions">${actionsHtml}</div>
    </div>`;
    }

    function kpi(label, value, sub, kind = '') {
        return `<div class="kpi ${kind}">
      <div class="kpi-label">${escapeHtml(label)}</div>
      <div class="kpi-value">${value}</div>
      ${sub ? `<div class="kpi-sub">${escapeHtml(sub)}</div>` : ''}
    </div>`;
    }

    function badge(text, kind = 'active') {
        return `<span class="badge ${kind}">${escapeHtml(text)}</span>`;
    }

    // ---------- DEBOUNCE ----------
    function debounce(fn, ms = 250) {
        let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    }

    return {
        $, $$, toast, openModal, closeModal, confirm, prompt,
        escapeHtml, table, buildForm, validateRequired, updateNetPill,
        pageHead, kpi, badge, debounce
    };
})();