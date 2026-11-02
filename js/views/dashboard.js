'use strict';

ELF.router.register('dashboard', async (view) => {
  const { ui, money, db } = ELF;
  const _ = ui;

  // Load everything we need
  const [members, txns, loans, accounts] = await Promise.all([
    db.sb.from('members').select('id,status').then(r => r.data || []),
    db.sb.from('transactions').select('*').then(r => r.data || []),
    db.sb.from('loans').select('*').then(r => r.data || []),
    db.sb.from('financial_accounts').select('*').then(r => r.data || [])
  ]);

  const active = members.filter(m => m.status === 'ACTIVE').length;

  // Calculate actual cash position based on the ledger
  const accMap = {};
  accounts.forEach(a => accMap[a.id] = a.code);
  const cashByAccount = { AIRTEL: 0, CASH: 0, BANK: 0 };

  let shareValue = 0, emergencyIn = 0, emergencyOut = 0, income = 0, expense = 0;
  const monthlyIncome = {};
  const emergencySeries = {};

  for (const t of txns) {
    if (t.status === 'REVERSED') continue;
    const amt = Number(t.amount) || 0;
    const ym = (t.txn_date || '').slice(0, 7);
    const accCode = accMap[t.account_id] || 'CASH';

    // Cash Flow Math
    const inTypes = ['loan_repayment', 'member_contribution', 'share_purchase', 'emergency_contribution', 'sponsor_income', 'other_income', 'deposit'];
    const isIn = inTypes.includes(t.txn_type);
    if (cashByAccount[accCode] !== undefined) {
      cashByAccount[accCode] += isIn ? amt : -amt;
    }

    // Ledger Math
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

  // Total Liquid Cash = Airtel + Cash + Bank
  const totalCash = cashByAccount.AIRTEL + cashByAccount.CASH + cashByAccount.BANK;

  view.innerHTML = `
    ${_.pageHead('Dashboard', 'Financial position and cooperative health', `
      <button class="btn-primary" id="qa-contrib">+ Contribution</button>
      <button class="btn-ghost" id="qa-loan">+ Loan</button>
    `)}

    <div class="kpi-grid">
      ${_.kpi('Available Cash (Liquid)', money.fmt(totalCash), 'Physical cash + Mobile money', 'info')}
      ${_.kpi('Airtel Money', money.fmt(cashByAccount.AIRTEL), 'Current balance')}
      ${_.kpi('Cash on Hand', money.fmt(cashByAccount.CASH), 'Current balance')}
      ${_.kpi('Bank Account', money.fmt(cashByAccount.BANK), 'Current balance')}
    </div>

    <div class="kpi-grid">
      ${_.kpi('Active Members', active, members.length + ' total')}
      ${_.kpi('Total Share Capital', money.fmt(shareValue), 'Member savings / shares')}
      ${_.kpi('Emergency Fund', money.fmt(emergencyFund), 'Separate from profit')}
      ${_.kpi('Outstanding Loans (Lent out)', money.fmt(outstanding), openLoans.length + ' active loans', openLoans.length ? 'warn' : '')}
      ${_.kpi('Current Distributable Profit', money.fmt(distributable), 'Income - Expenses')}
      ${_.kpi('Overdue Loans', overdue.length, overdue.length ? 'Attention required' : 'All clear', overdue.length ? 'danger' : '')}
    </div>

    <div class="grid-2 mb-16">
      <div class="card"><div class="card-title">Income Over Time</div><div style="height:260px;margin-top:14px"><canvas id="ch-income"></canvas></div></div>
      <div class="card"><div class="card-title">Emergency Fund Movement</div><div style="height:260px;margin-top:14px"><canvas id="ch-emergency"></canvas></div></div>
    </div>
  `;

  _.$('#qa-contrib').onclick = () => location.hash = 'contributions';
  _.$('#qa-loan').onclick = () => location.hash = 'loans';

  const months = Object.keys({ ...monthlyIncome, ...emergencySeries }).sort();
  const incomeData = months.map(m => monthlyIncome[m] || 0);
  const emgData = months.map(m => emergencySeries[m] || 0);
  ELF.charts.line('ch-income', months, [{ label: 'Income (RWF)', data: incomeData, fill: true }]);
  ELF.charts.line('ch-emergency', months, [{ label: 'Emergency contributions', data: emgData, fill: true }]);
});