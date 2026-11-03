'use strict';

ELF.router.register('audit', async (view) => {
  const { ui, db } = ELF;
  const _ = ui;

  let page = 1, q = '', actionFilter = '';
  const pageSize = 50;

  view.innerHTML = `
    ${_.pageHead('Audit Log', 'Every change is preserved')}
    <div class="card mb-16">
      <div class="row wrap" style="gap:10px">
        <div class="field" style="flex:1;min-width:180px">
          <input id="au-q" placeholder="Search…">
        </div>
        <div class="field" style="min-width:140px">
          <select id="au-action">
            <option value="">All actions</option>
            <option value="CREATE">CREATE</option>
            <option value="UPDATE">UPDATE</option>
            <option value="REVERSE">REVERSE</option>
          </select>
        </div>
      </div>
    </div>
    <div id="au-list"></div>
    <div id="au-page" class="row between mt-16"></div>
  `;

  const listEl = _.$('#au-list');
  const pageEl = _.$('#au-page');

  async function load() {
    listEl.innerHTML = `<div class="muted center" style="padding:40px">Loading…</div>`;
    let query = db.sb.from('audit_log').select('*', { count: 'exact' }).order('created_at', { ascending: false });
    if (actionFilter) query = query.eq('action', actionFilter);
    if (q) query = query.or(`record_type.ilike.%${q}%,reason.ilike.%${q}%`);
    const from = (page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1);
    const { data, count, error } = await query;
    if (error) { listEl.innerHTML = `<div class="card">${_.escapeHtml(error.message)}</div>`; return; }

    listEl.innerHTML = _.table([
      { label: 'When', render: r => new Date(r.created_at).toLocaleString() },
      { label: 'Action', render: r => _.badge(r.action, r.action === 'CREATE' ? 'active' : r.action === 'REVERSE' ? 'overdue' : 'brand') },
      { label: 'Record', render: r => `<span class="mono">${_.escapeHtml(r.record_type)}</span>` },
      { label: 'Reason', render: r => _.escapeHtml((r.reason || '').substring(0, 40)) }
    ], data || [], { empty: 'No audit entries' });

    const pages = Math.max(1, Math.ceil(count / pageSize));
    pageEl.innerHTML = `
      <div class="muted">Page ${page} of ${pages}</div>
      <div class="row">
        <button class="btn-ghost btn-sm" id="prev" ${page <= 1 ? 'disabled' : ''}>‹ Prev</button>
        <button class="btn-ghost btn-sm" id="next" ${page >= pages ? 'disabled' : ''}>Next ›</button>
      </div>`;
    _.$('#prev').onclick = () => { page--; load(); };
    _.$('#next').onclick = () => { page++; load(); };
  }

  _.$('#au-q').oninput = _.debounce(e => { q = e.target.value.trim(); page = 1; load(); }, 250);
  _.$('#au-action').onchange = e => { actionFilter = e.target.value; page = 1; load(); };

  await load();
});