'use strict';

ELF.router.register('transactions', async (view) => {
    const { ui, money, db, audit } = ELF;
    const _ = ui;

    let page = 1, typeFilter = '', q = '', fromDate = '', toDate = '';
    const pageSize = 40;

    const allTypes = [
        'member_contribution', 'share_purchase', 'emergency_contribution', 'emergency_assistance',
        'loan_disbursement', 'loan_repayment', 'loan_interest', 'loan_penalty',
        'sponsor_income', 'other_income', 'expense', 'airtel_fee',
        'withdrawal', 'deposit', 'profit_allocation', 'member_settlement',
        'adjustment', 'reversal'
    ];

    view.innerHTML = `
    ${_.pageHead('Transaction Ledger', 'Every financial event in one place')}

    <div class="card mb-16">
      <div class="row wrap" style="gap:10px">
        <div class="field" style="flex:1;min-width:200px">
          <input id="tx-q" placeholder="Search number, description, reference…">
        </div>
        <div class="field" style="min-width:200px">
          <select id="tx-type">
            <option value="">All types</option>
            ${allTypes.map(t => `<option value="${t}">${t.replace(/_/g, ' ')}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>From</label>
          <input id="tx-from" type="date">
        </div>
        <div class="field">
          <label>To</label>
          <input id="tx-to" type="date">
        </div>
        <div class="field">
          <label>&nbsp;</label>
          <button class="btn-ghost" id="tx-clear">Clear</button>
        </div>
      </div>
    </div>

    <div id="tx-list"></div>
    <div id="tx-page" class="row between mt-16"></div>
  `;

    const listEl = _.$('#tx-list');
    const pageEl = _.$('#tx-page');

    async function load() {
        listEl.innerHTML = `<div class="muted center" style="padding:40px">Loading…</div>`;
        const { rows, count } = await db.listTransactions({
            q, type: typeFilter, from: fromDate || undefined, to: toDate || undefined, page, pageSize
        });

        // Resolve member names
        const memberIds = Array.from(new Set(rows.map(r => r.member_id).filter(Boolean)));
        const members = memberIds.length
            ? await db.sb.from('members').select('id,full_name,member_number').in('id', memberIds).then(r => r.data || [])
            : [];
        const nameMap = {};
        members.forEach(m => nameMap[m.id] = m);

        listEl.innerHTML = _.table([
            { label: 'Date', render: r => new Date(r.txn_date).toLocaleDateString() },
            { label: 'Number', render: r => `<span class="mono">${_.escapeHtml(r.txn_number)}</span>` },
            {
                label: 'Type', render: r => {
                    const kind = r.status === 'REVERSED' ? 'deactivated'
                        : r.txn_type === 'reversal' ? 'overdue'
                            : r.txn_type.includes('loan') ? 'warn'
                                : 'brand';
                    return _.badge(r.txn_type.replace(/_/g, ' '), kind);
                }
            },
            {
                label: 'Member', render: r => {
                    const m = nameMap[r.member_id];
                    return m ? _.escapeHtml(m.full_name) : '—';
                }
            },
            { label: 'Description', render: r => _.escapeHtml((r.description || '').slice(0, 60)) },
            { label: 'Amount', align: 'right', render: r => money.fmt(r.amount) },
            {
                label: '', align: 'right', render: r => `
        ${r.status === 'REVERSED' ? '<span class="muted">Reversed</span>'
                        : r.txn_type === 'reversal' ? '<span class="muted">Reversal</span>'
                            : `<button class="btn-ghost btn-sm" data-rev="${r.id}">Reverse</button>`}
      `}
        ], rows, { empty: 'No transactions match' });

        listEl.querySelectorAll('[data-rev]').forEach(btn => {
            btn.onclick = () => reverseFlow(btn.dataset.rev);
        });

        const pages = Math.max(1, Math.ceil(count / pageSize));
        pageEl.innerHTML = `
      <div class="muted">Page ${page} of ${pages} — ${count} transaction(s)</div>
      <div class="row">
        <button class="btn-ghost btn-sm" id="prev" ${page <= 1 ? 'disabled' : ''}>‹ Prev</button>
        <button class="btn-ghost btn-sm" id="next" ${page >= pages ? 'disabled' : ''}>Next ›</button>
      </div>`;
        _.$('#prev').onclick = () => { page--; load(); };
        _.$('#next').onclick = () => { page++; load(); };
    }

    async function reverseFlow(id) {
        const reason = prompt('Reason for reversal (recommended):') || null;
        const ok = await _.confirm('Reverse this transaction? A matching reversal entry will be created and the original will be marked REVERSED.', { danger: true, okLabel: 'Reverse' });
        if (!ok) return;
        try {
            const rev = await db.reverseTransaction(id, reason);
            await audit.log('REVERSE', 'transaction', id, { status: 'POSTED' }, { status: 'REVERSED', reversed_by: rev.txn_number }, reason);
            _.toast('Reversed: ' + rev.txn_number);
            load();
        } catch (e) { _.toast(e.message, 'error'); }
    }

    _.$('#tx-q').oninput = _.debounce(e => { q = e.target.value.trim(); page = 1; load(); }, 250);
    _.$('#tx-type').onchange = e => { typeFilter = e.target.value; page = 1; load(); };
    _.$('#tx-from').onchange = e => { fromDate = e.target.value; page = 1; load(); };
    _.$('#tx-to').onchange = e => { toDate = e.target.value; page = 1; load(); };
    _.$('#tx-clear').onclick = () => {
        q = typeFilter = fromDate = toDate = ''; page = 1;
        _.$('#tx-q').value = ''; _.$('#tx-type').value = '';
        _.$('#tx-from').value = ''; _.$('#tx-to').value = '';
        load();
    };

    await load();
});