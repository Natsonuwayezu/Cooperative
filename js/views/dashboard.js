'use strict';

ELF.router.register('dashboard', async (view) => {
  const { ui, money, db } = ELF;
  const _ = ui;

  const [members, txns, loans, accounts] = await Promise.all([
    db.sb.from('members').select('id,status').then(r => r.data || []),
    db.sb.from('transactions').select('*').then(r => r.data || []),
    db.sb.from('loans').select('*').then(r => r.data || []),
    db.sb.from('financial_accounts').select('*').then(r => r.data || [])
  ]);

  const active = members.filter(m => m.status === 'ACTIVE').length;

  const accMap = {};
  accounts.forEach(a => accMap[a.id] = { code: a.code, name: a.name, opening: Number(a.opening_balance) });

  const cashFlow = {
    AIRTEL: { opening: 0, in: 0, out: 0 },
    CASH: { opening: 0, in: 0, out: 0 }
  };

  let shareValue = 0, emergencyIn = 0, emergencyOut = 0, income = 0, expense = 0;

  for (const t of txns) {
    if (t.status === 'REVERSED') continue;
    const amt = Number(t.amount) || 0;
    const accCode = accMap[t.account_id]?.code || 'CASH';

    // Money In vs Money Out Math
    const inTypes = ['loan_repayment', 'member_contribution', 'share_purchase', 'emergency_contribution', 'sponsor_income', 'other_income', 'deposit'];
    const isIn = inTypes.includes(t.txn_type);

    if (cashFlow[accCode]) {
      if (isIn) cashFlow[accCode].in += amt;
      else cashFlow[accCode].out += amt;
    }

    // Ledger Math
    switch (t.txn_type) {
      case 'share_purchase': shareValue += amt; break;
      case 'emergency_contribution': emergencyIn += amt; break;
      case 'emergency_assistance': emergencyOut += amt; break;
      case 'loan_interest':
      case 'loan_penalty':
      case 'sponsor_income':
      case 'other_income': income += amt; break;
      case 'expense':
      case 'airtel_fee': expense += amt; break;
    }
  }

  const emergencyFund = Math.max(0, emergencyIn - emergencyOut);
  const distributable = Math.max(0, income - expense);
  const openLoans = loans.filter(l => l.status === 'ACTIVE' || l.status === 'OVERDUE');
  const outstanding = openLoans.reduce((a, l) => a + Number(l.principal || 0), 0);

  function renderFlow(code, label) {
    const f = cashFlow[code];
    if (!f) return '';
    const balance = f.opening + f.in - f.out;
    return `
      <div class="card">
        <div class="card-title">${label}</div>
        <div class="mt-16">
          <div class="row between" style="padding:6px 0;border-bottom:1px solid var(--border)">
            <span class="muted">Opening Balance</span><strong>${money.fmt(f.opening)}</strong>
          </div>
          <div class="row between" style="padding:6px 0;border-bottom:1px solid var(--border)">
            <span class="muted">Total Money In</span><span style="color:var(--success)">+ ${money.fmt(f.in)}</span>
          </div>
          <div class="row between" style="padding:6px 0;border-bottom:1px solid var(--border)">
            <span class="muted">Total Money Out</span><span style="color:var(--danger)">- ${money.fmt(f.out)}</span>
          </div>
          <div class="row between" style="padding:10px 0 0 0; font-size:16px">
            <strong>Remaining Balance</strong>
            <strong style="color:${balance < 0 ? 'var(--danger)' : 'var(--brand)'}">${money.fmt(balance)}</strong>
          </div>
        </div>
      </div>
    `;
  }

  const totalCash = (cashFlow.AIRTEL.opening + cashFlow.AIRTEL.in - cashFlow.AIRTEL.out) +
    (cashFlow.CASH.opening + cashFlow.CASH.in - cashFlow.CASH.out);

  view.innerHTML = `
    ${_.pageHead('Dashboard', 'Financial position and cooperative health', `
      <button class="btn-primary" id="qa-contrib">+ Contribution</button>
      <button class="btn-ghost" id="qa-loan">+ Loan</button>
    `)}

    <div class="kpi-grid">
      ${_.kpi('Active Members', active, members.length + ' total')}
      ${_.kpi('Total Share Capital', money.fmt(shareValue), 'Member savings / shares')}
      ${_.kpi('Emergency Fund', money.fmt(emergencyFund), 'Separate from profit')}
      ${_.kpi('Outstanding Loans', money.fmt(outstanding), openLoans.length + ' active loans', openLoans.length ? 'warn' : '')}
    </div>

    <div class="grid-2 mb-16">
      ${renderFlow('AIRTEL', 'Airtel Money')}
      ${renderFlow('CASH', 'Cash on Hand')}
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-title">Net Position (Cooperative)</div>
        <div class="mt-16">
           <div class="row between" style="padding:6px 0"><span class="muted">Total Cash Available</span><strong>${money.fmt(totalCash)}</strong></div>
           <div class="row between" style="padding:6px 0"><span class="muted">Member Share Capital</span><span>${money.fmt(shareValue)}</span></div>
           <div class="row between" style="padding:6px 0"><span class="muted">Emergency Fund</span><span>${money.fmt(emergencyFund)}</span></div>
           <div class="row between" style="padding:6px 0"><span class="muted">Distributable Profit</span><span>${money.fmt(distributable)}</span></div>
           <div class="row between" style="padding:6px 0; border-top:2px solid var(--border-strong); margin-top:8px"><strong>Total Value</strong><strong>${money.fmt(shareValue + emergencyFund + distributable)}</strong></div>
        </div>
      </div>
      
      <div class="card">
        <div class="card-title">Current Distributable Profit</div>
        <div class="mt-16">
           <div class="row between" style="padding:6px 0"><span class="muted">Total Income</span><span>${money.fmt(income)}</span></div>
           <div class="row between" style="padding:6px 0"><span class="muted">Total Expenses</span><span style="color:var(--danger)">- ${money.fmt(expense)}</span></div>
           <div class="row between" style="padding:6px 0; border-top:1px dashed var(--border); margin-top:8px"><strong>Distributable</strong><strong>${money.fmt(distributable)}</strong></div>
        </div>
      </div>
    </div>
  `;

  _.$('#qa-contrib').onclick = () => location.hash = 'contributions';
  _.$('#qa-loan').onclick = () => location.hash = 'loans';
});