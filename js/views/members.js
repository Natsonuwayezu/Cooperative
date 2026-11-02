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
        <button class="btn-primary" id="new-member">+ Register Member</button>
      `)}
      <div class="card mb-16">
        <div class="row wrap" style="gap:10px">
          <div class="field" style="flex:1;min-width:200px">
            <input id="m-search" placeholder="Search name, number, phone…">
          </div>
          <div class="field" style="min-width:160px">
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
        { label: 'Member #', render: r => `<span class="mono">${_.escapeHtml(r.member_number)}</span>` },
        { label: 'Name', render: r => `<a href="#members/${r.id}" style="font-weight:600">${_.escapeHtml(r.full_name)}</a>` },
        { label: 'Phone', render: r => _.escapeHtml(r.phone || '—') },
        { label: 'Registered', render: r => new Date(r.registration_date).toLocaleDateString() },
        { label: 'Status', render: r => _.badge(r.status, r.status === 'ACTIVE' ? 'active' : 'deactivated') },
        { label: '', align: 'right', render: r => `<a class="btn-ghost btn-sm" href="#members/${r.id}">Open</a>` }
      ], rows, { empty: 'No members yet. Click “Register Member” to begin.' });

      const pages = Math.max(1, Math.ceil(count / pageSize));
      pageEl.innerHTML = `
        <div class="muted">Page ${page} of ${pages} — ${count} member(s)</div>
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
      { name: 'national_id', label: 'National ID' },
      { name: 'address', label: 'Address' },
      { name: 'registration_date', label: 'Registration date', type: 'date', required: true, default: new Date().toISOString().slice(0, 10) },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true }
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
              _.toast('Member registered: ' + created.member_number);
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

    // 1. Calculate Balances
    const shareInfo = ELF.engine.computeShareBalance(txns);
    const emergency = ELF.engine.computeEmergencyBalance(txns);
    const shareValue = shareInfo.shares * Number(ELF.settings['finance.share_price'] || 0);
    const loanBalance = loans.filter(l => l.status === 'ACTIVE' || l.status === 'OVERDUE')
      .reduce((a, l) => a + Number(l.principal), 0);

    // 2. Calculate Profit Share (Magic Balance)
    // Get all finalized profit periods and all member shares to find their cut
    const { data: allocs } = await db.sb.from('profit_allocations')
      .select('allocated_profit, profit_period_id, profit_periods(status)')
      .eq('member_id', id);

    let totalProfit = 0;
    (allocs || []).forEach(a => {
      if (a.profit_periods && a.profit_periods.status === 'FINALIZED') {
        totalProfit += Number(a.allocated_profit);
      }
    });

    // If the member has shares, calculate their live share of current distributable profit
    const { data: allShares } = await db.sb.from('transactions').select('metadata').eq('txn_type', 'share_purchase');
    let totalCoopShares = 0;
    (allShares || []).forEach(t => totalCoopShares += Number(t.metadata?.shares || 0));

    // Live current profit (not yet finalized)
    const { data: allTxns } = await db.sb.from('transactions').select('txn_type, amount, status');
    let currentIncome = 0, currentExpense = 0;
    (allTxns || []).forEach(t => {
      if (t.status === 'REVERSED') return;
      if (['loan_interest', 'loan_penalty', 'sponsor_income', 'other_income'].includes(t.txn_type)) currentIncome += Number(t.amount);
      if (['expense', 'airtel_fee'].includes(t.txn_type)) currentExpense += Number(t.amount);
    });
    const liveDistributable = Math.max(0, currentIncome - currentExpense);
    const liveProfitShare = (shareInfo.shares > 0 && totalCoopShares > 0)
      ? Math.floor((liveDistributable * shareInfo.shares) / totalCoopShares)
      : 0;

    const totalAvailable = shareValue + emergency + totalProfit + liveProfitShare;
    const isActive = member.status === 'ACTIVE';

    view.innerHTML = `
      ${_.pageHead(member.full_name, `Member ${member.member_number} • Joined ${new Date(member.registration_date).toLocaleDateString()}`,
      isActive
        ? `<button class="btn-ghost" id="act-edit">Edit</button>
             <button class="btn-ghost" id="act-statement">Print Statement</button>
             <button class="btn-danger" id="act-deact">Deactivate</button>`
        : `<button class="btn-ghost" id="act-edit">Edit</button>
             <button class="btn-ghost" id="act-statement">Print Statement</button>
             <button class="btn-success" id="act-react">Reactivate</button>`)}

      <div class="grid-3 mb-16">
        ${_.kpi('Shares', shareInfo.shares, money.fmt(shareValue) + ' value')}
        ${_.kpi('Emergency Balance', money.fmt(emergency), 'Separate from profit', 'info')}
        ${_.kpi('Total Profit Earned', money.fmt(totalProfit + liveProfitShare), 'From finalized & current periods', 'info')}
      </div>

      <div class="card mb-16" style="background:var(--brand-soft); border-color:var(--brand);">
        <div class="card-title" style="color:var(--brand)">Total Available Balance (Shares + Emergency + Profit)</div>
        <div class="card-sub">If this member left today, this is their total cash value.</div>
        <div style="font-size:32px; font-weight:700; color:var(--brand); margin-top:10px">
          ${money.fmt(totalAvailable)}
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-title">Identity</div>
          <div class="mt-16">
            <div class="row between" style="padding:6px 0;border-bottom:1px solid var(--border)">
              <span class="muted">Status</span>
              ${_.badge(member.status, isActive ? 'active' : 'deactivated')}
            </div>
            <div class="row between" style="padding:6px 0;border-bottom:1px solid var(--border)">
              <span class="muted">Phone</span><span>${_.escapeHtml(member.phone || '—')}</span>
            </div>
            <div class="row between" style="padding:6px 0">
              <span class="muted">Loan Balance</span>
              <span style="${loanBalance > 0 ? 'color:var(--danger);font-weight:bold' : ''}">${money.fmt(loanBalance)}</span>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Participation Periods</div>
          <div class="mt-16">
            ${_.table([
          { label: 'Start', render: r => new Date(r.start_date).toLocaleDateString() },
          { label: 'End', render: r => r.end_date ? new Date(r.end_date).toLocaleDateString() : '<span class="badge active">Current</span>' },
          { label: 'Reason', render: r => _.escapeHtml(r.reason_end || r.reason_start || '—') }
        ], periods, { empty: 'No periods' })}
          </div>
        </div>
      </div>

            <div class="card mt-16">
        <div class="card-title">Transaction History</div>
        <div class="mt-16">
          ${_.table([
          { label: 'Date', render: r => new Date(r.txn_date).toLocaleDateString() },
          { label: 'Type', render: r => _.badge(r.txn_type.replace(/_/g, ' '), 'brand') },
          { label: 'Description', render: r => _.escapeHtml(r.description || '—') },
          { label: 'Amount', align: 'right', render: r => money.fmt(r.amount) }
        ], txns.filter(t => t.txn_type !== 'share_purchase' && t.txn_type !== 'emergency_contribution').slice().reverse(), { empty: 'No transactions yet' })}
        </div>
      </div>
    `;

    _.$('#act-edit').onclick = () => editMember(member, () => renderProfile(view, id));

    _.$('#act-statement').onclick = async () => {
      const { data: allocs } = await db.sb.from('profit_allocations').select('allocated_profit, profit_periods(period_number)').eq('member_id', id);

      const statementRows = txns.map(t => ({
        date: new Date(t.txn_date).toLocaleDateString(),
        type: t.txn_type.replace(/_/g, ' '),
        desc: t.description || '',
        amount: money.fmt(t.amount, false)
      }));

      await ELF.pdf.present({
        title: 'Member Statement - ' + member.full_name,
        period: `Joined: ${new Date(member.registration_date).toLocaleDateString()}`,
        columns: [
          { header: 'Date', dataKey: 'date' },
          { header: 'Type', dataKey: 'type' },
          { header: 'Description', dataKey: 'desc' },
          { header: 'Amount (RWF)', dataKey: 'amount', align: 'right' }
        ],
        rows: statementRows,
        summary: [
          { label: 'Total Shares Owned', value: shareInfo.shares.toString() },
          { label: 'Share Value', value: money.fmt(shareValue) },
          { label: 'Emergency Balance', value: money.fmt(emergency) },
          { label: 'Total Profit Earned', value: money.fmt(totalProfit + liveProfitShare) },
          { label: 'TOTAL AVAILABLE BALANCE', value: money.fmt(totalAvailable) }
        ]
      }, `statement-${member.member_number}.pdf`);
    };

    if (isActive) {
      _.$('#act-deact').onclick = async () => {
        if (loanBalance > 0) return _.toast('Cannot deactivate: Member has an active loan.', 'error');

        const reason = prompt('Reason for deactivation?') || 'Deactivated';
        const ok = await _.confirm(
          `Deactivate ${member.full_name}? Their final settlement is ${money.fmt(totalAvailable)} (Shares + Emergency + Profit). This will end their participation.`,
          { danger: true, okLabel: 'Deactivate' }
        );
        if (!ok) return;
        try {
          const snap = { shares: shareInfo.shares, shareValue, emergency, profit: totalProfit + liveProfitShare, totalAvailable, capturedAt: new Date().toISOString() };
          await db.deactivateMember(member.id, reason, snap);
          await audit.log('UPDATE', 'member', member.id, { status: 'ACTIVE' }, { status: 'DEACTIVATED' }, reason);
          _.toast('Member deactivated. Settlement snapshot saved.');
          renderProfile(view, id);
        } catch (e) { _.toast(e.message, 'error'); }
      };
    } else {
      _.$('#act-react').onclick = async () => {
        const reason = prompt('Reason for reactivation?') || 'Reactivated';
        try {
          await db.reactivateMember(member.id, reason);
          await audit.log('UPDATE', 'member', member.id, { status: 'DEACTIVATED' }, { status: 'ACTIVE' }, reason);
          _.toast('Member reactivated');
          renderProfile(view, id);
        } catch (e) { _.toast(e.message, 'error'); }
      };
    }
  }

  function editMember(member, onDone) {
    const schema = [
      { name: 'full_name', label: 'Full name', required: true, full: true },
      { name: 'phone', label: 'Phone' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'national_id', label: 'National ID' },
      { name: 'address', label: 'Address' },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true }
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