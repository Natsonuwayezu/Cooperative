'use strict';

ELF.router.register('members', async (view, params) => {
  const { ui, money, db, audit } = ELF;
  const _ = ui;

  if (params.id) return renderProfile(view, params.id);
  return renderList(view);

  // ---------- LIST ----------
  async function renderList(view) {
    let page = 1, q = '', status = '';
    const pageSize = 25;

    view.innerHTML = `
      ${_.pageHead('Members', 'Register and manage cooperative members', `
        <button class="btn-primary" id="new-member">+ Register</button>
      `)}
      <div class="card mb-16">
        <div class="row wrap" style="gap:10px">
          <div class="field" style="flex:1;min-width:200px">
            <input id="m-search" placeholder="Search name, number, phone…">
          </div>
          <div class="field" style="min-width:140px">
            <select id="m-status">
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="DEACTIVATED">Deactivated</option>
            </select>
          </div>
        </div>
      </div>
      <div id="m-list"></div>
      <div id="m-page" class="row between mt-16"></div>
    `;

    const listEl = _.$('#m-list');
    const pageEl = _.$('#m-page');

    async function load() {
      listEl.innerHTML = `<div class="muted center" style="padding:40px">Loading…</div>`;
      const { rows, count } = await db.listMembers({ q, status, page, pageSize });

      listEl.innerHTML = _.table([
        { label: 'Name', render: r => `<a href="#members/${r.id}" style="font-weight:600">${_.escapeHtml(r.full_name)}</a>` },
        { label: 'Phone', render: r => _.escapeHtml(r.phone || '—') },
        { label: 'Status', render: r => _.badge(r.status, r.status === 'ACTIVE' ? 'active' : 'deactivated') },
        { label: '', align: 'right', render: r => `<a class="btn-ghost btn-sm" href="#members/${r.id}">Open</a>` }
      ], rows, { empty: 'No members yet. Click "Register" to begin.' });

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

    _.$('#m-search').oninput = _.debounce(e => { q = e.target.value.trim(); page = 1; load(); }, 250);
    _.$('#m-status').onchange = e => { status = e.target.value; page = 1; load(); };
    _.$('#new-member').onclick = () => newMemberModal(load);

    await load();
  }

  // ---------- NEW MEMBER ----------
  function newMemberModal(onDone) {
    const schema = [
      { name: 'full_name', label: 'Full name', type: 'text', required: true, full: true },
      { name: 'phone', label: 'Phone', type: 'text' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'registration_date', label: 'Registration date', type: 'date', required: true, default: new Date().toISOString().slice(0, 10) }
    ];
    const { html, read } = _.buildForm(schema);
    const body = document.createElement('div');
    body.innerHTML = html;
    _.openModal({
      title: 'Register New Member',
      body,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Register', kind: 'primary', close: false, onClick: async () => {
            const data = read(body);
            const errs = _.validateRequired(data, schema);
            if (Object.keys(errs).length) return _.toast('Please fill required fields', 'error');
            try {
              const created = await db.createMember(data);
              await audit.log('CREATE', 'member', created.id, null, created, 'Registered new member');
              _.toast('Member registered');
              _.closeModal();
              onDone && onDone();
            } catch (e) { _.toast(e.message, 'error'); }
          }
        }
      ]
    });
  }

  // ---------- PROFILE ----------
  async function renderProfile(view, id) {
    const member = await db.getMember(id);
    const [periods, txns, loans] = await Promise.all([
      db.listParticipationPeriods(id),
      db.getMemberTransactions(id),
      db.sb.from('loans').select('*').eq('member_id', id).then(r => r.data || [])
    ]);

    const shareInfo = ELF.engine.computeShareBalance(txns);
    const emergency = ELF.engine.computeEmergencyBalance(txns);
    const shareValue = shareInfo.shares * Number(ELF.settings['finance.share_price'] || 0);
    const loanBalance = loans.filter(l => l.status === 'ACTIVE' || l.status === 'OVERDUE').reduce((a, l) => a + Number(l.principal), 0);

    // Calculate Profit
    const { data: allocs } = await db.sb.from('profit_allocations').select('allocated_profit, profit_periods(status)').eq('member_id', id);
    let totalProfit = 0;
    (allocs || []).forEach(a => { if (a.profit_periods && a.profit_periods.status === 'FINALIZED') totalProfit += Number(a.allocated_profit); });

    const { data: allShares } = await db.sb.from('transactions').select('metadata').eq('txn_type', 'share_purchase');
    let totalCoopShares = 0;
    (allShares || []).forEach(t => totalCoopShares += Number(t.metadata?.shares || 0));

    const { data: allTxns } = await db.sb.from('transactions').select('txn_type, amount, status').neq('status', 'REVERSED');
    let currentIncome = 0, currentExpense = 0;
    (allTxns || []).forEach(t => {
      if (['loan_interest', 'loan_penalty', 'sponsor_income', 'other_income'].includes(t.txn_type)) currentIncome += Number(t.amount);
      if (['expense', 'airtel_fee'].includes(t.txn_type)) currentExpense += Number(t.amount);
    });
    const liveDistributable = Math.max(0, currentIncome - currentExpense);
    const liveProfitShare = (shareInfo.shares > 0 && totalCoopShares > 0) ? Math.floor((liveDistributable * shareInfo.shares) / totalCoopShares) : 0;
    const totalAvailable = shareValue + emergency + totalProfit + liveProfitShare;
    const isActive = member.status === 'ACTIVE';

    view.innerHTML = `
      ${_.pageHead(member.full_name, `Member since ${new Date(member.registration_date).toLocaleDateString()}`,
      `<div class="row wrap" style="gap:8px">
          <button class="btn-ghost btn-sm" id="act-edit">Edit</button>
          <button class="btn-ghost btn-sm" id="act-statement">Statement</button>
          ${isActive
        ? `<button class="btn-danger btn-sm" id="act-deact">Deactivate</button>`
        : `<button class="btn-success btn-sm" id="act-react">Reactivate</button>`}
        </div>`)}

      <div class="grid-3 mb-16">
        ${_.kpi('Shares', shareInfo.shares, money.fmt(shareValue) + ' value')}
        ${_.kpi('Emergency', money.fmt(emergency), 'Fund balance', 'info')}
        ${_.kpi('Profit', money.fmt(totalProfit + liveProfitShare), 'Earned profit', 'info')}
      </div>

      <div class="card mb-16" style="background:var(--brand-soft); border-color:var(--brand);">
        <div class="card-title" style="color:var(--brand)">Total Available Balance</div>
        <div class="card-sub">If this member left today, this is their total cash value.</div>
        <div style="font-size:26px; font-weight:700; color:var(--brand); margin-top:8px">${money.fmt(totalAvailable)}</div>
      </div>

      <div class="card mb-16">
        <div class="card-title">Details</div>
        <div class="mt-16" style="display:flex; flex-direction:column; gap:8px">
          <div class="row between"><span class="muted">Status</span>${_.badge(member.status, isActive ? 'active' : 'deactivated')}</div>
          <div class="row between"><span class="muted">Phone</span><span>${_.escapeHtml(member.phone || '—')}</span></div>
          <div class="row between"><span class="muted">Loan Balance</span><span style="${loanBalance > 0 ? 'color:var(--danger);font-weight:bold' : ''}">${money.fmt(loanBalance)}</span></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Transaction History</div>
        <div class="mt-16" style="overflow-x:auto">
          ${_.table([
          { label: 'Date', render: r => new Date(r.txn_date).toLocaleDateString() },
          { label: 'Type', render: r => _.badge(r.txn_type.replace(/_/g, ' '), 'brand') },
          { label: 'Description', render: r => _.escapeHtml((r.description || '').substring(0, 40)) },
          { label: 'Amount', align: 'right', render: r => money.fmt(r.amount) }
        ], txns.filter(t => !['share_purchase', 'emergency_contribution'].includes(t.txn_type)).reverse(), { empty: 'No transactions' })}
        </div>
      </div>
    `;

    _.$('#act-edit').onclick = () => editMember(member, () => renderProfile(view, id));

    _.$('#act-statement').onclick = async () => {
      const statementRows = txns.map(t => ({
        date: new Date(t.txn_date).toLocaleDateString(),
        type: t.txn_type.replace(/_/g, ' '),
        desc: (t.description || '').substring(0, 30),
        amount: money.fmt(t.amount, false)
      }));

      await ELF.pdf.present({
        title: 'Statement: ' + member.full_name,
        period: `Member since ${new Date(member.registration_date).toLocaleDateString()}`,
        columns: [
          { header: 'Date', dataKey: 'date' },
          { header: 'Type', dataKey: 'type' },
          { header: 'Description', dataKey: 'desc' },
          { header: 'Amount', dataKey: 'amount', align: 'right' }
        ],
        rows: statementRows,
        summary: [
          { label: 'Shares', value: `${shareInfo.shares} (${money.fmt(shareValue)})` },
          { label: 'Emergency', value: money.fmt(emergency) },
          { label: 'Profit', value: money.fmt(totalProfit + liveProfitShare) },
          { label: 'Loan Balance', value: money.fmt(loanBalance) },
          { label: 'TOTAL AVAILABLE', value: money.fmt(totalAvailable) }
        ]
      }, `statement-${member.member_number}.pdf`);
    };

    if (isActive) {
      _.$('#act-deact').onclick = async () => {
        if (loanBalance > 0) return _.toast('Cannot deactivate: Member has an active loan.', 'error');
        const reason = prompt('Reason for deactivation?') || 'Deactivated';
        const ok = await _.confirm(`Deactivate ${member.full_name}? Their settlement is ${money.fmt(totalAvailable)}.`, { danger: true, okLabel: 'Deactivate' });
        if (!ok) return;
        try {
          await db.deactivateMember(member.id, reason, { totalAvailable });
          await audit.log('UPDATE', 'member', member.id, { status: 'ACTIVE' }, { status: 'DEACTIVATED' }, reason);
          _.toast('Deactivated');
          renderProfile(view, id);
        } catch (e) { _.toast(e.message, 'error'); }
      };
    } else {
      _.$('#act-react').onclick = async () => {
        const reason = prompt('Reason for reactivation?') || 'Reactivated';
        try {
          await db.reactivateMember(member.id, reason);
          await audit.log('UPDATE', 'member', member.id, { status: 'DEACTIVATED' }, { status: 'ACTIVE' }, reason);
          _.toast('Reactivated');
          renderProfile(view, id);
        } catch (e) { _.toast(e.message, 'error'); }
      };
    }
  }

  function editMember(member, onDone) {
    const schema = [
      { name: 'full_name', label: 'Full name', required: true, full: true },
      { name: 'phone', label: 'Phone' },
      { name: 'email', label: 'Email', type: 'email' }
    ];
    const { html, read } = _.buildForm(schema, member);
    const body = document.createElement('div');
    body.innerHTML = html;
    _.openModal({
      title: 'Edit Member',
      body,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Save', kind: 'primary', close: false, onClick: async () => {
            const data = read(body);
            if (!data.full_name) return _.toast('Name required', 'error');
            try {
              await db.updateMember(member.id, data);
              await audit.log('UPDATE', 'member', member.id, member, data, 'Edited member');
              _.toast('Saved');
              _.closeModal();
              onDone && onDone();
            } catch (e) { _.toast(e.message, 'error'); }
          }
        }
      ]
    });
  }
});