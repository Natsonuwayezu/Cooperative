'use strict';

ELF.router.register('audit', async (view) => {
  const { ui, db } = ELF;
  const _ = ui;

  let page = 1, q = '', actionFilter = '';
  const pageSize = 50;

  view.innerHTML = `
    ${_.pageHead('Audit Log', 'Every significant change is preserved', `
      <button class="btn-ghost" id="restore-btn">Restore from Backup</button>
    `)}

    <div class="card mb-16">
      <div class="row wrap" style="gap:10px">
        <div class="field" style="flex:1;min-width:220px">
          <input id="au-q" placeholder="Search record type, id, reason…">
        </div>
        <div class="field" style="min-width:180px">
          <select id="au-action">
            <option value="">All actions</option>
            <option>CREATE</option>
            <option>UPDATE</option>
            <option>DELETE</option>
            <option>REVERSE</option>
          </select>
        </div>
      </div>
    </div>

    <div id="au-list"></div>
    <div id="au-page" class="row between mt-16"></div>
  `;

  const listEl = _. $ ('#au-list');
  const pageEl = _. $ ('#au-page');

  async function load() {
    listEl.innerHTML = `<div class="muted center" style="padding:40px">Loading…</div>`;
    let query = db.sb.from('audit_log').select('*', { count:'exact' }).order('created_at',{ascending:false});
    if (actionFilter) query = query.eq('action', actionFilter);
    if (q) query = query.or(`record_type.ilike.%${q}%,record_id.ilike.%${q}%,reason.ilike.%${q}%`);
    const from = (page-1)*pageSize;
    query = query.range(from, from + pageSize - 1);
    const { data, count, error } = await query;
    if (error) { listEl.innerHTML = `<div class="card">${_.escapeHtml(error.message)}</div>`; return; }

    listEl.innerHTML = _.table([
      { label:'When', render: r => new Date(r.created_at).toLocaleString() },
      { label:'Action', render: r => _.badge(r.action, r.action === 'REVERSE' ? 'overdue' : r.action === 'CREATE' ? 'active' : 'brand') },
      { label:'Record', render: r => `<span class="mono">${_.escapeHtml(r.record_type)}</span>` },
      { label:'ID', render: r => `<span class="mono">${_.escapeHtml((r.record_id||'').slice(0,8))}</span>` },
      { label:'Reason', render: r => _.escapeHtml((r.reason || '').slice(0,60)) },
      { label:'', align:'right', render: r => `<button class="btn-ghost btn-sm" data-aud="${r.id}">Details</button>` }
    ], data||[], { empty:'No audit entries' });

    listEl.querySelectorAll('[data-aud]').forEach(b => {
      b.onclick = async () => {
        const row = (data||[]).find(x => x.id === b.dataset.aud);
        const body = document.createElement('div');
        body.innerHTML = `
          <div class="preview" style="background:var(--surface-2);color:var(--text)">
            <div class="row between"><span class="muted">Action</span><strong>${_.escapeHtml(row.action)}</strong></div>
            <div class="row between"><span class="muted">Record type</span><strong>${_.escapeHtml(row.record_type)}</strong></div>
            <div class="row between"><span class="muted">Record ID</span><strong class="mono">${_.escapeHtml(row.record_id || '')}</strong></div>
            <div class="row between"><span class="muted">When</span><strong>${new Date(row.created_at).toLocaleString()}</strong></div>
            <div class="row between"><span class="muted">Actor</span><strong>${_.escapeHtml(row.actor || 'secretary')}</strong></div>
            ${row.reason ? `<div class="row between"><span class="muted">Reason</span><strong>${_.escapeHtml(row.reason)}</strong></div>` : ''}
          </div>
          <div class="mt-16"><div class="muted">Old value</div><pre style="white-space:pre-wrap;background:var(--surface-2);padding:10px;border-radius:8px;font-size:11px">${_.escapeHtml(JSON.stringify(row.old_value, null, 2))}</pre></div>
          <div class="mt-16"><div class="muted">New value</div><pre style="white-space:pre-wrap;background:var(--surface-2);padding:10px;border-radius:8px;font-size:11px">${_.escapeHtml(JSON.stringify(row.new_value, null, 2))}</pre></div>
        `;
        _.openModal({ title:'Audit Entry', body, actions:[{ label:'Close' }] });
      };
    });

    const pages = Math.max(1, Math.ceil(count/pageSize));
    pageEl.innerHTML = `
      <div class="muted">Page ${page} of ${pages} — ${count} entries</div>
      <div class="row">
        <button class="btn-ghost btn-sm" id="prev" ${page<=1?'disabled':''}>‹ Prev</button>
        <button class="btn-ghost btn-sm" id="next" ${page>=pages?'disabled':''}>Next ›</button>
      </div>`;
    _. $ ('#prev').onclick = () => { page--; load(); };
    _. $ ('#next').onclick = () => { page++; load(); };
  }

  _. $ ('#au-q').oninput = _.debounce(e => { q = e.target.value.trim(); page = 1; load(); }, 250);
  _. $ ('#au-action').onchange = e => { actionFilter = e.target.value; page = 1; load(); };

  _. $ ('#restore-btn').onclick = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/json';
    input.onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      const ok = await _.confirm(
        'Restore will INSERT rows from the backup. Existing rows with the same IDs will not be modified. Continue?',
        { danger:true, okLabel:'Restore' }
      );
      if (!ok) return;
      try {
        const text = await file.text();
        const dump = JSON.parse(text);
        let inserted = 0, errors = 0;
        for (const [table, rows] of Object.entries(dump.tables || {})) {
          if (!rows.length) continue;
          const { error } = await db.sb.from(table).insert(rows);
          if (error) { errors++; console.warn('Restore failed for', table, error.message); }
          else inserted += rows.length;
        }
        _.toast(`Restored ${inserted} rows (${errors} table errors — see console)`);
        load();
      } catch (err) { _.toast('Restore failed: ' + err.message, 'error'); }
    };
    input.click();
  };

  await load();
});