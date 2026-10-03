'use strict';

ELF.router.register('repayments', async (view, params) => {
    const { ui, money, db, engine, audit } = ELF;
    const _ = ui;

    // If no loan id, show a picker
    if (!params.id) return renderPicker(view);
    return renderRepayment(view, params.id);

    // ---------- PICKER ----------
    async function renderPicker(view) {
        const { rows } = await db.listLoans({ status: 'ACTIVE', pageSize: 200 });
        const memberIds = rows.map(r => r.member_id).filter(Boolean);
        const borrowerIds = rows.map(r => r.borrower_id).filter(Boolean);
        const [members, borrowers] = await Promise.all([
            memberIds.length ? db.sb.from('members').select('id,full_name,member_number').in('id', memberIds).then(r => r.data || []) : [],
            borrowerIds.length ? db.sb.from('borrowers').select('id,name,borrower_number').in('id', borrowerIds).then(r => r.data || []) : []
        ]);
        const nameMap = {};
        members.forEach(m => nameMap[m.id] = m.full_name + ' — ' + m.member_number);
        borrowers.forEach(b => nameMap[b.id] = b.name + ' — ' + b.borrower_number + ' (external)');

        view.innerHTML = `
      ${_.pageHead('Record Repayment', 'Pick an active loan to record a repayment against')}
      ${_.table([
            { label: 'Loan #', render: r => `<a href="#repayments/${r.id}" class="mono">${_.escapeHtml(r.loan_number)}</a>` },
            {
                label: 'Borrower', render: r => {
                    const id = r.member_id || r.borrower_id || r.sponsor_id;
                    return _.escapeHtml(nameMap[id] || '—');
                }
            },
            { label: 'Principal', align: 'right', render: r => money.fmt(r.principal) },
            { label: 'Issued', render: r => new Date(r.issue_date).toLocaleDateString() },
            { label: '', align: 'right', render: r => `<a class="btn-primary btn-sm" href="#repayments/${r.id}">Record</a>` }
        ], rows, { empty: 'No active loans' })}
    `;
    }

    // ---------- REPAYMENT ----------
    async function renderRepayment(view, loanId) {
        const loan = await db.getLoan(loanId);
        const [interest, penalties, repayments] = await Promise.all([
            db.listLoanInterest(loanId),
            db.listLoanPenalties(loanId),
            db.listLoanRepayments(loanId)
        ]);
        const bal = engine.computeLoanBalance(loan, interest, penalties, repayments);

        // Determine emergency due for this member this month
        let emergencyDue = 0;
        if (loan.member_id) {
            const monthly = Number(ELF.settings['finance.emergency_monthly']) || 1000;
            const curMonth = new Date().toISOString().slice(0, 7);
            const paidThisMonth = await db.sb.from('transactions')
                .select('amount').eq('member_id', loan.member_id).eq('txn_type', 'emergency_contribution')
                .gte('txn_date', curMonth + '-01').then(r => r.data || []);
            emergencyDue = paidThisMonth.length ? 0 : monthly;
        }

        view.innerHTML = `
      ${_.pageHead('Repayment — ' + loan.loan_number, 'Total received will be allocated automatically', `
        <a class="btn-ghost" href="#loans/${loan.id}">Loan Details</a>
      `)}

      <div class="grid-3 mb-16">
        ${_.kpi('Principal Outstanding', money.fmt(bal.principalOutstanding))}
        ${_.kpi('Interest Outstanding', money.fmt(bal.interestOutstanding))}
        ${_.kpi('Penalty Outstanding', money.fmt(bal.penaltyOutstanding), '', bal.penaltyOutstanding ? 'warn' : '')}
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-title">Payment Entry</div>
          <div class="mt-16" id="r-form"></div>
          <div class="row mt-16">
            <button class="btn-primary btn-block" id="r-save">Save Repayment</button>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Allocation Preview</div>
          <div class="card-sub">Money flows in the configured order: emergency → interest → penalty → principal → savings</div>
          <div class="mt-16" id="r-preview"></div>
        </div>
      </div>
    `;

        const schema = [
            { name: 'total_received', label: 'Total Received (RWF)', type: 'number', required: true, placeholder: 'e.g. 25000' },
            { name: 'payment_date', label: 'Payment date', type: 'date', required: true, default: new Date().toISOString().slice(0, 10) },
            {
                name: 'method', label: 'Method', type: 'select', options: [
                    { value: 'airtel', label: 'Airtel Money' },
                    { value: 'cash', label: 'Cash' },
                    { value: 'bank', label: 'Bank Transfer' }
                ]
            },
            { name: 'notes', label: 'Notes', type: 'textarea', full: true }
        ];
        const form = _.buildForm(schema);
        const formEl = _.$('#r-form');
        formEl.innerHTML = form.html;
        const previewEl = _.$('#r-preview');

        function renderPreview() {
            const d = form.read(formEl);
            const total = Number(d.total_received) || 0;
            if (!total) { previewEl.innerHTML = `<div class="muted">Enter amount to see allocation</div>`; return null; }
            const buckets = {
                emergency: emergencyDue,
                interest: bal.interestOutstanding,
                penalty: bal.penaltyOutstanding,
                principal: bal.principalOutstanding,
                savings: 999999999   // unlimited
            };
            const split = engine.allocateRepayment(total, buckets);
            previewEl.innerHTML = `
        <div class="preview">
          <div class="row"><span>Total received</span><strong>${money.fmt(total)}</strong></div>
          <div class="row"><span>Emergency due</span><strong>${money.fmt(split.emergency)}</strong></div>
          <div class="row"><span>Interest</span><strong>${money.fmt(split.interest)}</strong></div>
          <div class="row"><span>Penalty</span><strong>${money.fmt(split.penalty)}</strong></div>
          <div class="row"><span>Principal</span><strong>${money.fmt(split.principal)}</strong></div>
          <div class="row"><span>Savings (extra)</span><strong>${money.fmt(split.savings)}</strong></div>
          <div class="row total"><span>Remaining after</span><strong>${money.fmt(Math.max(0, bal.totalOutstanding + emergencyDue - total))}</strong></div>
        </div>`;
            return split;
        }
        formEl.addEventListener('input', renderPreview);
        renderPreview();

        _.$('#r-save').onclick = async () => {
            const d = form.read(formEl);
            const errs = _.validateRequired(d, schema);
            if (Object.keys(errs).length) return _.toast('Please complete required fields', 'error');
            const total = Number(d.total_received);
            if (!total || total <= 0) return _.toast('Amount must be > 0', 'error');

            const buckets = {
                emergency: emergencyDue,
                interest: bal.interestOutstanding,
                penalty: bal.penaltyOutstanding,
                principal: bal.principalOutstanding,
                savings: 999999999
            };
            const split = engine.allocateRepayment(total, buckets);

            try {
                const res = await db.recordRepayment({
                    loan_id: loan.id,
                    member_id: loan.member_id,
                    borrower_id: loan.borrower_id,
                    sponsor_id: loan.sponsor_id,
                    total_received: total,
                    payment_date: d.payment_date,
                    method: d.method,
                    split,
                    notes: d.notes
                });
                await audit.log('CREATE', 'loan_repayment', res.txn.id, null, res.txn, 'Repayment recorded');

                // Auto-complete loan if fully paid
                const newInts = await db.listLoanInterest(loan.id);
                const newPens = await db.listLoanPenalties(loan.id);
                const newReps = await db.listLoanRepayments(loan.id);
                const newBal = engine.computeLoanBalance(loan, newInts, newPens, newReps);
                if (newBal.totalOutstanding === 0 && loan.status === 'ACTIVE') {
                    await db.updateLoanStatus(loan.id, 'COMPLETED');
                }

                _.toast('Repayment saved: ' + res.txn.txn_number);
                // reset
                formEl.querySelector('[name=total_received]').value = '';
                formEl.querySelector('[name=notes]').value = '';
                // reload
                renderRepayment(view, loan.id);
            } catch (e) { _.toast(e.message, 'error'); }
        };
    }
});