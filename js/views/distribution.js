'use strict';

ELF.router.register('distribution', async (view) => {
    const { ui, money, db } = ELF;
    const _ = ui;

    // 1. Fetch all data
    const [members, txns, loans, accounts, interest, penalties, repayments] = await Promise.all([
        db.sb.from('members').select('*').eq('status', 'ACTIVE').order('full_name').then(r => r.data || []),
        db.sb.from('transactions').select('*').neq('status', 'REVERSED').then(r => r.data || []),
        db.sb.from('loans').select('*').eq('status', 'ACTIVE').then(r => r.data || []),
        db.sb.from('financial_accounts').select('*').then(r => r.data || []),
        db.sb.from('loan_interest_entries').select('*').then(r => r.data || []),
        db.sb.from('loan_penalties').select('*').then(r => r.data || []),
        db.sb.from('loan_repayments').select('*').then(r => r.data || [])
    ]);

    // 2. Calculate Total Cash Available (matching Dashboard logic)
    const airtelAcc = accounts.find(a => a.code === 'AIRTEL');
    const cashInTypes = ['share_purchase', 'emergency_contribution', 'sponsor_income', 'other_income', 'deposit', 'loan_repayment'];
    const cashOutTypes = ['loan_disbursement', 'airtel_fee', 'expense', 'withdrawal', 'member_settlement', 'emergency_assistance'];

    let totalCash = airtelAcc ? Number(airtelAcc.opening_balance) : 0;
    txns.forEach(t => {
        if (t.account_id !== airtelAcc?.id) return;
        if (cashInTypes.includes(t.txn_type)) totalCash += Number(t.amount);
        else if (cashOutTypes.includes(t.txn_type)) totalCash -= Number(t.amount);
    });

    // 3. Distributable profit
    let totalIncome = 0, totalExpense = 0;
    txns.forEach(t => {
        if (['loan_interest', 'loan_penalty', 'sponsor_income', 'other_income'].includes(t.txn_type)) totalIncome += Number(t.amount);
        if (['expense', 'airtel_fee'].includes(t.txn_type)) totalExpense += Number(t.amount);
    });
    const distributableProfit = Math.max(0, totalIncome - totalExpense);

    // 4. Build Member Balances
    const totalShares = txns
        .filter(t => t.txn_type === 'share_purchase')
        .reduce((a, t) => a + Number(t.metadata?.shares || 0), 0);

    const memberData = members.map(m => {
        const mTxns = txns.filter(t => t.member_id === m.id);
        const shares = mTxns.filter(t => t.txn_type === 'share_purchase').reduce((a, t) => a + Number(t.metadata?.shares || 0), 0);
        const shareValue = shares * Number(ELF.settings['finance.share_price'] || 0);
        const emergency = mTxns.filter(t => t.txn_type === 'emergency_contribution').reduce((a, t) => a + Number(t.amount), 0)
            - mTxns.filter(t => t.txn_type === 'emergency_assistance').reduce((a, t) => a + Number(t.amount), 0);
        const profitShare = totalShares > 0 ? Math.floor((distributableProfit * shares) / totalShares) : 0;

        // Loan Debt
        let loanBalance = 0;
        const mLoans = loans.filter(l => l.member_id === m.id);
        mLoans.forEach(l => {
            const principal = Number(l.principal);
            const paidPrincipal = repayments.filter(r => r.loan_id === l.id).reduce((a, r) => a + Number(r.principal_portion), 0);
            const outPrincipal = Math.max(0, principal - paidPrincipal);
            const totalInt = interest.filter(i => i.loan_id === l.id).reduce((a, i) => a + Number(i.interest_amount), 0);
            const paidInt = repayments.filter(r => r.loan_id === l.id).reduce((a, r) => a + Number(r.interest_portion), 0);
            const outInterest = Math.max(0, totalInt - paidInt);
            const totalPen = penalties.filter(p => p.loan_id === l.id).reduce((a, p) => a + Number(p.amount), 0);
            const paidPen = repayments.filter(r => r.loan_id === l.id).reduce((a, r) => a + Number(r.penalty_portion), 0);
            const outPenalty = Math.max(0, totalPen - paidPen);
            loanBalance += outPrincipal + outInterest + outPenalty;
        });

        return {
            id: m.id,
            full_name: m.full_name,
            shares,
            shareValue,
            emergency,
            profitShare,
            loanBalance,
            totalBalance: shareValue + emergency + profitShare,
            netNow: (shareValue + emergency + profitShare) - loanBalance
        };
    });

    const sumShares = memberData.reduce((a, m) => a + m.shareValue, 0);
    const sumEmergency = memberData.reduce((a, m) => a + m.emergency, 0);
    const sumProfit = memberData.reduce((a, m) => a + m.profitShare, 0);
    const sumLoans = memberData.reduce((a, m) => a + m.loanBalance, 0);
    const sumTotalWealth = sumShares + sumEmergency + sumProfit;

    view.innerHTML = `
    ${_.pageHead('Distribution & Settlement', 'Compare distributing cash today vs waiting for loans to be repaid', `
      <button class="btn-primary" id="btn-distribute" ${totalCash <= 0 ? 'disabled' : ''}>Distribute Cash</button>
    `)}

    <div class="kpi-grid mb-16">
      ${_.kpi('Total Cash Available Now', money.fmt(totalCash), 'Actual money in Airtel')}
      ${_.kpi('Money Lent Out (Unpaid)', money.fmt(sumLoans), 'Principal + Interest + Penalties')}
      ${_.kpi('Total Cooperative Wealth', money.fmt(sumTotalWealth), 'If all loans were paid back today', 'info')}
      ${_.kpi('Cash to Distribute Right Now', money.fmt(totalCash), 'What we can actually hand out', 'warn')}
    </div>

    <div class="card">
      <div class="card-title">Distribution Table</div>
      <div class="card-sub">See exactly what everyone gets today vs what they get if they pay back their loans.</div>
      <div class="mt-16" style="overflow-x:auto">
        ${_.table([
        { label: 'Name', render: r => `<strong>${_.escapeHtml(r.full_name)}</strong>` },
        { label: 'Shares', align: 'right', render: r => `${r.shares} (${money.fmt(r.shareValue, false)})` },
        { label: 'Emerg', align: 'right', render: r => money.fmt(r.emergency, false) },
        { label: 'Profit', align: 'right', render: r => money.fmt(r.profitShare, false) },
        { label: 'Loan Owed', align: 'right', render: r => `<span style="color:var(--danger)">${money.fmt(r.loanBalance, false)}</span>` },
        { label: 'Payout If Distributed TODAY', align: 'right', render: r => `<strong style="color:${r.netNow < 0 ? 'var(--danger)' : 'var(--brand)'}">${money.fmt(r.netNow, false)}</strong>` },
        { label: 'Payout IF LOANS PAID', align: 'right', render: r => `<strong style="color:var(--success)">${money.fmt(r.totalBalance, false)}</strong>` }
    ], memberData, { empty: 'No active members' })}
      </div>
      
      <div class="row between mt-16" style="padding-top:12px; border-top:2px solid var(--border-strong); font-size:16px">
        <strong>TOTALS</strong>
        <div style="display:flex; gap:20px">
          <div>Shares: ${money.fmt(sumShares)}</div>
          <div>Emerg: ${money.fmt(sumEmergency)}</div>
          <div>Profit: ${money.fmt(sumProfit)}</div>
          <div style="color:var(--danger)">Loans: ${money.fmt(sumLoans)}</div>
          <div style="color:var(--brand)">Pay Now: ${money.fmt(totalCash)}</div>
          <div style="color:var(--success)">Pay Later: ${money.fmt(sumTotalWealth)}</div>
        </div>
      </div>
    </div>
  `;

    _.$('#btn-distribute').onclick = async () => {
        const ok = await _.confirm(
            `This will distribute ${money.fmt(totalCash)} from the Airtel account. Members with loans will have their payouts deducted by their loan balance. Proceed?`,
            { danger: true, okLabel: 'Distribute Now' }
        );
        if (!ok) return;

        try {
            const account = await db.getAccountByCode('AIRTEL');

            const gen = await db.nextNumber('report.prefix');
            await db.sb.from('transactions').insert({
                txn_number: gen, txn_type: 'withdrawal',
                amount: totalCash, account_id: account?.id || null,
                description: 'Distribution of available cash',
                status: 'POSTED'
            });

            for (const m of memberData) {
                if (m.netNow <= 0) continue;
                const gen2 = await db.nextNumber('report.prefix');
                await db.sb.from('transactions').insert({
                    txn_number: gen2, txn_type: 'member_settlement',
                    amount: m.netNow, account_id: account?.id || null,
                    member_id: m.id,
                    description: `Distribution payout to ${m.full_name}`,
                    status: 'POSTED'
                });
            }

            _.toast('Distribution completed successfully', 'success');
            ELF.router.go('distribution');
        } catch (e) { _.toast(e.message, 'error'); }
    };
});