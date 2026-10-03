'use strict';

ELF.router.register('dashboard', async (view) => {
    const { ui, money, db } = ELF;
    const _ = ui;

    const [members, txns, loans] = await Promise.all([
        db.sb.from('members').select('id,status').then(r => r.data || []),
        db.sb.from('transactions').select('*').then(r => r.data || []),
        db.sb.from('loans').select('*').then(r => r.data || [])
    ]);

    const active = members.filter(m => m.status === 'ACTIVE').length;
    let shareValue = 0, emergencyIn = 0, emergencyOut = 0, income = 0, expense = 0;
    const monthlyIncome = {};
    const emergencySeries = {};

    for (const t of txns) {
        if (t.status === 'REVERSED') continue;
        const amt = Number(t.amount) || 0;
        const ym = (t.txn_date || '').slice(0, 7);
        switch (t.txn_type) {
            case 'share_purchase': shareValue += amt; break;
            case 'emergency_contribution': emergencyIn += amt; emergencySeries[ym] = (emergencySeries[ym] || 0) + amt; break;
            case 'emergency_assistance': emergencyOut += amt; break;
            case 'loan_interest':
            case 'loan_penalty':
            case 'sponsor_income':
            case 'other_income': income += amt; monthlyIncome[ym] = (monthlyIncome[ym] || 0) + amt; break;
            case 'expense':
            case 'airtel_fee': expense += amt; break;
        }
    }
    const emergencyFund = Math.max(0, emergencyIn - emergencyOut);
    const distributable = Math.max(0, income - expense);
    const openLoans = loans.filter(l => l.status === 'ACTIVE' || l.status === 'OVERDUE');
    const outstanding = openLoans.reduce((a, l) => a + Number(l.principal || 0), 0);
    const overdue = openLoans.filter(l => l.expected_due_date && new Date(l.expected_due_date) < new Date());

    view.innerHTML = `
    ${_.pageHead('Dashboard', 'Cooperative at a glance', `
      <button class="btn-primary" id="qa-contrib">+ Contribution</button>
      <button class="btn-ghost" id="qa-loan">+ Loan</button>
    `)}

    <div class="kpi-grid">
      ${_.kpi('Active Members', active, members.length + ' total')}
      ${_.kpi('Share Capital', money.fmt(shareValue), 'Member savings', 'info')}
      ${_.kpi('Emergency Fund', money.fmt(emergencyFund), 'Separate from profit', 'info')}
      ${_.kpi('Outstanding Loans', money.fmt(outstanding), openLoans.length + ' active', openLoans.length ? 'warn' : '')}
      ${_.kpi('Total Income', money.fmt(income))}
      ${_.kpi('Total Expenses', money.fmt(expense))}
      ${_.kpi('Distributable Profit', money.fmt(distributable))}
      ${_.kpi('Overdue Loans', overdue.length, overdue.length ? 'Attention needed' : 'All clear', overdue.length ? 'danger' : '')}
    </div>

    <div class="grid-2 mb-16">
      <div class="card"><div class="card-title">Income Over Time</div><div style="height:260px;margin-top:14px"><canvas id="ch-income"></canvas></div></div>
      <div class="card"><div class="card-title">Emergency Fund Movement</div><div style="height:260px;margin-top:14px"><canvas id="ch-emergency"></canvas></div></div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-title">Recent Activity</div>
        <div class="mt-16">
          ${_.table([
        { label: 'Date', render: r => new Date(r.txn_date).toLocaleDateString() },
        { label: 'Type', render: r => _.badge(r.txn_type.replace(/_/g, ' '), 'brand') },
        { label: 'Amount', align: 'right', render: r => money.fmt(r.amount) }
    ], txns.slice().sort((a, b) => new Date(b.txn_date) - new Date(a.txn_date)).slice(0, 8), { empty: 'No activity yet' })}
        </div>
      </div>
      <div class="card">
        <div class="card-title">Alerts</div>
        <div class="mt-16">
          ${overdue.length ? `<div class="badge overdue">${overdue.length} overdue loan(s)</div><br><br>` : ''}
          ${distributable <= 0 ? `<div class="badge warn">No distributable profit yet</div><br><br>` : ''}
          ${active === 0 ? `<div class="badge warn">No active members yet</div>` : ''}
        </div>
      </div>
    </div>
  `;

    _.$('#qa-contrib').onclick = () => location.hash = 'contributions';
    _.$('#qa-loan').onclick = () => location.hash = 'loans';

    // Charts
    const months = Object.keys({ ...monthlyIncome, ...emergencySeries }).sort();
    const incomeData = months.map(m => monthlyIncome[m] || 0);
    const emgData = months.map(m => emergencySeries[m] || 0);
    ELF.charts.line('ch-income', months, [{ label: 'Income (RWF)', data: incomeData, fill: true }]);
    ELF.charts.line('ch-emergency', months, [{ label: 'Emergency contributions', data: emgData, fill: true }]);
});