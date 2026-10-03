/* ============================================================
   app.js — boot sequence
   ============================================================ */
'use strict';

(async function boot() {
    const loader = document.getElementById('boot-loader');

    // Watchdog: never strand the user on the loader
    const watchdog = setTimeout(() => {
        const l = document.getElementById('boot-loader');
        if (l && !l.classList.contains('fade')) {
            console.warn('[boot] watchdog firing — hiding loader');
            l.classList.add('fade');
            setTimeout(() => l.remove(), 400);
        }
    }, 4000);

    try {
        // ---------- theme ----------
        const theme = localStorage.getItem('elf.theme') || 'light';
        document.documentElement.setAttribute('data-theme', theme);

        // ---------- settings ----------
        await ELF.db.loadSettings();

        // ---------- wire static UI ----------
        const themeBtn = document.getElementById('theme-toggle');
        if (themeBtn) themeBtn.onclick = () => {
            const cur = document.documentElement.getAttribute('data-theme');
            const next = cur === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('elf.theme', next);
        };

        const menuBtn = document.getElementById('menu-btn');
        if (menuBtn) menuBtn.onclick = () => {
            document.getElementById('sidebar').classList.toggle('open');
        };

        const quickBtn = document.getElementById('btn-quick');
        if (quickBtn) quickBtn.onclick = () => { location.hash = 'contributions'; };

        const backupBtn = document.getElementById('btn-backup');
        if (backupBtn) backupBtn.onclick = backupNow;

        ELF.ui.updateNetPill();
        window.addEventListener('online', ELF.ui.updateNetPill);
        window.addEventListener('offline', ELF.ui.updateNetPill);

        wireGlobalSearch();
        ELF.router.init();

        // ---------- hide loader BEFORE passphrase gate ----------
        loader.classList.add('fade');
        setTimeout(() => loader.remove(), 400);
        clearTimeout(watchdog);

        // ---------- passphrase gate (now visible over the shell) ----------
        const passEnabled = ELF.settings['security.passphrase_enabled'];
        const passHash = ELF.settings['security.passphrase_hash'];

        if (passEnabled === true && passHash) {
            await gatePassphrase(passHash);
        } else if (passEnabled === undefined || passEnabled === null) {
            await offerSetPassphrase();
        }

    } catch (e) {
        console.error(e);
        clearTimeout(watchdog);
        if (loader) {
            loader.innerHTML = `
        <div class="boot-inner">
          <div class="boot-logo">!</div>
          <div class="boot-text">Failed to load: ${ELF.ui.escapeHtml(e.message)}</div>
          <div class="boot-text" style="margin-top:8px">Check your Supabase URL/key and internet connection.</div>
        </div>`;
        }
    }
})();


/* ============================================================
   PASSPHRASE GATE
   ============================================================ */
async function gatePassphrase(storedHash) {
    return new Promise(resolve => {
        const body = document.createElement('div');
        body.innerHTML = `
      <div class="field">
        <label>Passphrase</label>
        <input id="pw" type="password" autofocus>
      </div>
      <div class="hint" style="margin-top:6px">Press Enter to unlock</div>`;

        const submit = async () => {
            const pw = body.querySelector('#pw').value;
            const hash = await sha256(pw);
            if (hash === storedHash) {
                ELF.ui.closeModal();
                resolve();
            } else {
                ELF.ui.toast('Incorrect passphrase', 'error');
            }
        };

        body.querySelector('#pw').addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
        });

        ELF.ui.openModal({
            title: 'Enter Passphrase',
            body,
            actions: [
                { label: 'Unlock', kind: 'primary', close: false, onClick: submit }
            ]
        });
    });
}

async function offerSetPassphrase() {
    const set = await ELF.ui.confirm(
        'Protect this app with a passphrase? (Recommended — you can change it later in Settings.)',
        { title: 'Set a Passphrase?', okLabel: 'Set one' }
    );

    await ELF.db.saveSetting('security.passphrase_enabled', !!set, 'Initial setup');
    if (!set) return;

    const body = document.createElement('div');
    body.innerHTML = `
    <div class="field">
      <label>Choose a passphrase (min 4 chars)</label>
      <input id="pw1" type="password" autofocus>
    </div>
    <div class="field" style="margin-top:10px">
      <label>Confirm passphrase</label>
      <input id="pw2" type="password">
    </div>`;

    await new Promise(resolve => {
        ELF.ui.openModal({
            title: 'Set Passphrase',
            body,
            actions: [
                {
                    label: 'Save', kind: 'primary', close: false, onClick: async () => {
                        const a = body.querySelector('#pw1').value;
                        const b = body.querySelector('#pw2').value;
                        if (a.length < 4) return ELF.ui.toast('Too short', 'error');
                        if (a !== b) return ELF.ui.toast('Passwords do not match', 'error');
                        const hash = await sha256(a);
                        await ELF.db.saveSetting('security.passphrase_hash', hash, 'Set passphrase');
                        ELF.ui.toast('Passphrase set');
                        ELF.ui.closeModal();
                        resolve();
                    }
                }
            ]
        });
    });
}

async function sha256(str) {
    const buf = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}


/* ============================================================
   GLOBAL SEARCH
   ============================================================ */
function wireGlobalSearch() {
    const input = document.getElementById('global-search');
    const box = document.getElementById('search-results');
    if (!input || !box) return;

    input.oninput = ELF.ui.debounce(async (e) => {
        const q = e.target.value.trim();
        if (q.length < 2) { box.classList.add('hidden'); return; }

        const [members, txns] = await Promise.all([
            ELF.db.listMembers({ q, pageSize: 6 }).then(r => r.rows).catch(() => []),
            ELF.db.listTransactions({ q, pageSize: 6 }).then(r => r.rows).catch(() => [])
        ]);

        const items = [
            ...members.map(m => ({
                kind: 'Member', label: m.full_name, sub: m.member_number, go: `#members/${m.id}`
            })),
            ...txns.map(t => ({
                kind: 'Transaction', label: t.txn_number,
                sub: (t.description || '').slice(0, 60), go: `#transactions`
            }))
        ];

        if (!items.length) { box.classList.add('hidden'); return; }

        box.innerHTML = items.map(i => `
      <div class="sr-item" data-go="${i.go}">
        <span class="sr-kind">${i.kind}</span>
        <span class="sr-label">${ELF.ui.escapeHtml(i.label)}</span>
        <span class="sr-sub">${ELF.ui.escapeHtml(i.sub)}</span>
      </div>`).join('');

        box.classList.remove('hidden');
        box.querySelectorAll('[data-go]').forEach(el => {
            el.onclick = () => {
                location.hash = el.dataset.go.replace(/^#/, '');
                box.classList.add('hidden');
                input.value = '';
            };
        });
    }, 220);

    document.addEventListener('click', e => {
        if (!e.target.closest('.search-wrap')) box.classList.add('hidden');
    });
}


/* ============================================================
   BACKUP — downloads full JSON of all tables
   ============================================================ */
async function backupNow() {
    try {
        ELF.ui.toast('Preparing backup…', 'success');

        const tables = [
            'settings', 'setting_versions', 'categories', 'financial_accounts',
            'members', 'member_participation_periods',
            'transactions',
            'sponsors', 'borrowers',
            'loans', 'loan_interest_entries', 'loan_penalties', 'loan_repayments',
            'emergency_assistance',
            'profit_periods', 'profit_allocations',
            'settlements', 'audit_log', 'notes', 'number_sequences'
        ];

        const dump = {
            exported_at: new Date().toISOString(),
            version: 1,
            tables: {}
        };

        for (const t of tables) {
            const { data, error } = await ELF.sb.from(t).select('*');
            if (error) {
                console.warn('[backup] skipping', t, error.message);
                continue;
            }
            dump.tables[t] = data || [];
        }

        const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `elf-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        ELF.ui.toast('Backup downloaded');
    } catch (e) {
        console.error(e);
        ELF.ui.toast('Backup failed: ' + e.message, 'error');
    }
}