'use strict';

ELF.router.register('loans', async (view, params) => {
    const { ui, money, db, engine, audit } = ELF;
    const _ = ui;

    if (params.id) return renderDetail(view, params.id);
    return renderList(view);

    // ---------- LIST ----------
    async function renderList(view) {
        let page = 1, statusFilter = 'ACTIVE';
        const pageSize = 25;

        view.innerHTML = `
      ${_.pageHead('Loans', 'Loan register — multiple loans per borrower are supported', `
        <button class="btn-primary" id="new-loan">+ New Loan</button>
      `)}
      <div class="card mb-16">
        <div class="row wrap" style="gap:10px">
          <div class="field" style="min-width:180px">
            <select id="l-status">
              <option value="">All loans</option>
              <option value="ACTIVE">Active</option>
              <option value="OVERDUE">Overdue</option>
              <option value="COMPLETED">Completed</option>
              <option value="WRITTEN_OFF">Written off</option>
            </select>
          </div>
        </div>
      </div>
      <div id="l-list"></div>
      <div id="l-page" class="row between mt-16"></div>
    `;

        // default filter — Active
        _.$('#l-status').value = 'ACTIVE';

        const listEl = _.$('#l-list');
        const pageEl = _.$('#l-page');

        async function load() {
            listEl.innerHTML = `<div class="muted center" style="padding:40px">Loading…</div>`;
            const { rows, count } = await db.listLoans({ status: statusFilter, page, pageSize });

            // Resolve borrower names
            const memberIds = rows.map(r => r.member_id).filter(Boolean);
            const borrowerIds = rows.map(r => r.borrower_id).filter(Boolean);
            const sponsorIds = rows.map(r => r.sponsor_id).filter(Boolean);
            const [members, borrowers, sponsors] = await Promise.all([
                memberIds.length ? db.sb.from('members').select('id,full_name,member_number').in('id', memberIds).then(r => r.data || []) : [],
                borrowerIds.length ? db.sb.from('borrowers').select('id,name,borrower_number').in('id', borrowerIds).then(r => r.data || []) : [],
                sponsorIds.length ? db.sb.from('sponsors').select('id,name,sponsor_number').in('id', sponsorIds).then(r => r.data || []) : []
            ]);
            const nameMap = {};
            members.forEach(m => nameMap[m.id] = { name: m.full_name, ref: m.member_number, kind: 'Member' });
            borrowers.forEach(b => nameMap[b.id] = { name: b.name, ref: b.borrower_number, kind: 'External' });
            sponsors.forEach(s => nameMap[s.id] = { name: s.name, ref: s.sponsor_number, kind: 'Sponsor' });

            listEl.innerHTML = _.table([
                { label: 'Loan #', render: r => `<a href="#loans/${r.id}" class="mono">${_.escapeHtml(r.loan_number)}</a>` },
                {
                    label: 'Borrower', render: r => {
                        const id = r.member_id || r.borrower_id || r.sponsor_id;
                        const info = nameMap[id];
                        return info
                            ? `${_.escapeHtml(info.name)} <span class="badge brand" style="margin-left:6px">${info.kind}</span>`
                            : '—';
                    }
                },
                { label: 'Issued', render: r => new Date(r.issue_date).toLocaleDateString() },
                { label: 'Principal', align: 'right', render: r => money.fmt(r.principal) },
                { label: 'Rate', align: 'right', render: r => Number(r.interest_rate_pct).toFixed(2) + '%/mo' },
                {
                    label: 'Status', render: r => {
                        const od = engine.isOverdue(r);
                        const kind = od ? 'overdue' : r.status === 'COMPLETED' ? 'completed' : r.status === 'ACTIVE' ? 'active' : 'warn';
                        return _.badge(od ? 'OVERDUE' : r.status, kind);
                    }
                },
                { label: '', align: 'right', render: r => `<a class="btn-ghost btn-sm" href="#loans/${r.id}">Open</a>` }
            ], rows, { empty: 'No loans match your filter' });

            const pages = Math.max(1, Math.ceil(count / pageSize));
            pageEl.innerHTML = `
        <div class="muted">Page ${page} of ${pages} — ${count} loan(s)</div>
        <div class="row">
          <button class="btn-ghost btn-sm" id="prev" ${page <= 1 ? 'disabled' : ''}>‹ Prev</button>
          <button class="btn-ghost btn-sm" id="next" ${page >= pages ? 'disabled' : ''}>Next ›</button>
        </div>`;
            _.$('#prev').onclick = () => { page--; load(); };
            _.$('#next').onclick = () => { page++; load(); };
        }

        _.$('#l-status').onchange = e => { statusFilter = e.target.value; page = 1; load(); };
        _.$('#new-loan').onclick = () => newLoanModal(load);

        await load();
    }

    // ---------- NEW LOAN MODAL ----------
    async function newLoanModal(onDone) {
        const [members, borrowers, sponsors] = await Promise.all([
            db.listMembers({ status: 'ACTIVE', pageSize: 500 }).then(r => r.rows),
            db.listBorrowers(),
            db.listSponsors()
        ]);

        const borrowerOptions = [
            { value: '', label: '— Select borrower —' },
            ...members.map(m => ({ value: 'm:' + m.id, label: `Member — ${m.member_number} — ${m.full_name}` })),
            ...borrowers.map(b => ({ value: 'b:' + b.id, label: `External — ${b.borrower_number} — ${b.name}` })),
            ...sponsors.map(s => ({ value: 's:' + s.id, label: `Sponsor — ${s.sponsor_number} — ${s.name}` }))
        ];

        const schema = [
            { name: 'borrower_ref', label: 'Borrower', type: 'select', required: true, options: borrowerOptions, full: true },
            { name: 'principal', label: 'Principal (RWF)', type: 'number', required: true, placeholder: 'e.g. 100000' },
            { name: 'issue_date', label: 'Issue date', type: 'date', required: true, default: new Date().toISOString().slice(0, 10) },
            { name: 'expected_due_date', label: 'Expected due date', type: 'date' },
            {
                name: 'interest_rate_pct', label: 'Interest rate (% / month)', type: 'number', required: true,
                default: Number(ELF.settings['finance.loan_interest_pct']) || 5, step: '0.001'
            },
            {
                name: 'disbursement_method', label: 'Disbursement method', type: 'select',
                options: [
                    { value: 'airtel', label: 'Airtel Money (20 RWF fee)' },
                    { value: 'cash', label: 'Cash' },
                    { value: 'bank', label: 'Bank Transfer' }
                ]
            },
            { name: 'notes', label: 'Notes', type: 'textarea', full: true }
        ];

        const body = document.createElement('div');
        const form = _.buildForm(schema);
        body.innerHTML = form.html + `<div id="loan-preview" class="mt-16"></div>`;

        function renderPreview() {
            const data = form.read(body);
            const p = Number(data.principal) || 0;
            const r = Number(data.interest_rate_pct) || 0;
            const min = Number(ELF.settings['finance.min_loan']) || 1000;
            const fee = (data.disbursement_method === 'airtel') ? ELF.engine.airtelOutgoingFee() : 0;
            const previewEl = body.querySelector('#loan-preview');
            if (!p) { previewEl.innerHTML = ''; return; }
            if (p < min) {
                previewEl.innerHTML = `<div class="badge overdue">Below minimum loan (${money.fmt(min)})</div>`;
                return;
            }
            previewEl.innerHTML = `
        <div class="preview">
          <div class="row"><span>Principal</span><strong>${money.fmt(p)}</strong></div>
          <div class="row"><span>Interest rate</span><strong>${r}% / month</strong></div>
          <div class="row"><span>Interest (first month est.)</span><strong>${money.fmt(engine.calcMonthlyInterest(p, r, 1))}</strong></div>
          <div class="row"><span>Disbursement fee</span><strong>${money.fmt(fee)}</strong></div>
          <div class="row total"><span>Total cash out</span><strong>${money.fmt(p + fee)}</strong></div>
        </div>`;
        }
        body.addEventListener('input', renderPreview);
        renderPreview();

        _.openModal({
            title: 'New Loan',
            body,
            actions: [
                { label: 'Cancel' },
                {
                    label: 'Issue Loan', kind: 'primary', close: false, onClick: async () => {
                        const data = form.read(body);
                        const errs = _.validateRequired(data, schema);
                        if (Object.keys(errs).length) return _.toast('Please complete required fields', 'error');
                        const principal = Number(data.principal);
                        const min = Number(ELF.settings['finance.min_loan']) || 1000;
                        if (principal < min) return _.toast('Below minimum loan', 'error');

                        // Split borrower_ref
                        const [kind, id] = data.borrower_ref.split(':');
                        const payload = {
                            principal,
                            interest_rate_pct: Number(data.interest_rate_pct),
                            issue_date: data.issue_date,
                            expected_due_date: data.expected_due_date || null,
                            status: 'ACTIVE',
                            notes: data.notes || null,
                            disbursement_method: data.disbursement_method
                        };
                        if (kind === 'm') payload.member_id = id;
                        if (kind === 'b') payload.borrower_id = id;
                        if (kind === 's') payload.sponsor_id = id;

                        try {
                            const created = await db.createLoan(payload);
                            await audit.log('CREATE', 'loan', created.id, null, created, 'New loan issued');
                            _.toast('Loan issued: ' + created.loan_number);
                            _.closeModal();
                            onDone && onDone();
                        } catch (e) { _.toast(e.message, 'error'); }
                    }
                }
            ]
        });
    }

    // ---------- DETAIL ----------
    async function renderDetail(view, id) {
        const loan = await db.getLoan(id);
        const [interest, penalties, repayments] = await Promise.all([
            db.listLoanInterest(id),
            db.listLoanPenalties(id),
            db.listLoanRepayments(id)
        ]);

        // Resolve borrower
        let borrowerLabel = '—';
        if (loan.member_id) {
            const m = await db.getMember(loan.member_id);
            borrowerLabel = `${m.full_name} (${m.member_number}) — Member`;
        } else if (loan.borrower_id) {
            const r = await db.sb.from('borrowers').select('*').eq('id', loan.borrower_id).single().then(r => r.data);
            borrowerLabel = `${r.name} (${r.borrower_number}) — External`;
        } else if (loan.sponsor_id) {
            const r = await db.sb.from('sponsors').select('*').eq('id', loan.sponsor_id).single().then(r => r.data);
            borrowerLabel = `${r.name} (${r.sponsor_number}) — Sponsor`;
        }

        const bal = engine.computeLoanBalance(loan, interest, penalties, repayments);
        const overdue = engine.isOverdue(loan);

        view.innerHTML = `
      ${_.pageHead('Loan ' + loan.loan_number, borrowerLabel, `
        <button class="btn-ghost" id="act-interest">Charge Interest</button>
        <button class="btn-ghost" id="act-penalty">Add Penalty</button>
        <button class="btn-primary" id="act-repay">Record Repayment</button>
        ${loan.status === 'ACTIVE' ? `<button class="btn-success" id="act-close">Mark Completed</button>` : ''}
      `)}

      <div class="grid-3 mb-16">
        ${_.kpi('Principal', money.fmt(loan.principal), Number(loan.interest_rate_pct).toFixed(2) + '% / month')}
        ${_.kpi('Outstanding Principal', money.fmt(bal.principalOutstanding), '')}
        ${_.kpi('Total Outstanding', money.fmt(bal.totalOutstanding),
            `incl. interest ${money.fmt(bal.interestOutstanding)} + penalties ${money.fmt(bal.penaltyOutstanding)}`,
            bal.totalOutstanding ? 'warn' : '')}
      </div>

      <div class="grid-2 mb-16">
        <div class="card">
          <div class="card-title">Loan Details</div>
          <div class="mt-16">
            <div class="row between" style="padding:6px 0;border-bottom:1px solid var(--border)">
              <span class="muted">Status</span>
              ${_.badge(overdue ? 'OVERDUE' : loan.status, overdue ? 'overdue' : loan.status === 'ACTIVE' ? 'active' : 'completed')}
            </div>
            <div class="row between" style="padding:6px 0;border-bottom:1px solid var(--border)">
              <span class="muted">Issue date</span><span>${new Date(loan.issue_date).toLocaleDateString()}</span>
            </div>
            <div class="row between" style="padding:6px 0;border-bottom:1px solid var(--border)">
              <span class="muted">Expected due</span><span>${loan.expected_due_date ? new Date(loan.expected_due_date).toLocaleDateString() : '—'}</span>
            </div>
            <div class="row between" style="padding:6px 0;border-bottom:1px solid var(--border)">
              <span class="muted">Interest charged to date</span><span>${money.fmt(interest.reduce((a, x) => a + Number(x.interest_amount), 0))}</span>
            </div>
            <div class="row between" style="padding:6px 0;border-bottom:1px solid var(--border)">
              <span class="muted">Penalties to date</span><span>${money.fmt(penalties.reduce((a, x) => a + Number(x.amount), 0))}</span>
            </div>
            <div class="row between" style="padding:6px 0">
              <span class="muted">Total repaid</span><span>${money.fmt(bal.totalPaid)}</span>
            </div>
            ${loan.notes ? `<div class="mt-16"><div class="muted">Notes</div><div>${_.escapeHtml(loan.notes)}</div></div>` : ''}
          </div>
        </div>

        <div class="card">
          <div class="card-title">Repayment Progress</div>
          <div class="card-sub">Based on outstanding vs original principal + interest + penalties</div>
          <div class="mt-16">
            ${renderProgressBar(loan.principal, bal)}
          </div>
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-title">Interest Charges</div>
        <div class="mt-16">
          ${_.table([
                { label: 'Date', render: r => new Date(r.charge_date).toLocaleDateString() },
                { label: 'Rate', align: 'right', render: r => Number(r.rate_pct).toFixed(2) + '%' },
                { label: 'Base', align: 'right', render: r => money.fmt(r.base_amount) },
                { label: 'Interest', align: 'right', render: r => money.fmt(r.interest_amount) },
                { label: 'Status', render: r => _.badge(r.status, 'brand') }
            ], interest, { empty: 'No interest charged yet' })}
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-title">Penalties</div>
        <div class="mt-16">
          ${_.table([
                { label: 'Date', render: r => new Date(r.penalty_date).toLocaleDateString() },
                { label: 'Amount', align: 'right', render: r => money.fmt(r.amount) },
                { label: 'Reason', render: r => _.escapeHtml(r.reason || '—') }
            ], penalties, { empty: 'No penalties' })}
        </div>
      </div>

      <div class="card">
        <div class="card-title">Repayments</div>
        <div class="mt-16">
          ${_.table([
                { label: 'Date', render: r => new Date(r.payment_date).toLocaleDateString() },
                { label: 'Total', align: 'right', render: r => money.fmt(r.total_received) },
                { label: 'Emergency', align: 'right', render: r => money.fmt(r.emergency_portion) },
                { label: 'Interest', align: 'right', render: r => money.fmt(r.interest_portion) },
                { label: 'Penalty', align: 'right', render: r => money.fmt(r.penalty_portion) },
                { label: 'Principal', align: 'right', render: r => money.fmt(r.principal_portion) },
                { label: 'Savings', align: 'right', render: r => money.fmt(r.savings_portion) },
                { label: 'Unapplied', align: 'right', render: r => money.fmt(r.unapplied_portion) }
            ], repayments, { empty: 'No repayments yet' })}
        </div>
      </div>
    `;

        function renderProgressBar(principal, bal) {
            const total = principal + bal.interestOutstanding + bal.penaltyOutstanding + bal.principalOutstanding;
            const pct = total > 0 ? Math.round((bal.totalPaid / (bal.totalPaid + total)) * 100) : 0;
            return `
        <div style="background:var(--surface-2);border-radius:999px;height:12px;overflow:hidden">
          <div style="background:var(--brand);height:100%;width:${Math.min(100, pct)}%"></div>
        </div>
        <div class="row between mt-8" style="font-size:12px">
          <span class="muted">Repaid ${money.fmt(bal.totalPaid)}</span>
          <span class="muted">Outstanding ${money.fmt(bal.totalOutstanding)}</span>
        </div>`;
        }

        // Actions
        _.$('#act-interest').onclick = () => chargeInterestModal(loan, () => renderDetail(view, id));
        _.$('#act-penalty').onclick = () => chargePenaltyModal(loan, () => renderDetail(view, id));
        _.$('#act-repay').onclick = () => { location.hash = 'repayments/' + id; };
        const closeBtn = _.$('#act-close');
        if (closeBtn) closeBtn.onclick = async () => {
            if (bal.totalOutstanding > 0) {
                const ok = await _.confirm('Loan still has an outstanding balance. Mark as completed anyway?', { danger: true, okLabel: 'Complete' });
                if (!ok) return;
            }
            await db.updateLoanStatus(loan.id, 'COMPLETED');
            await audit.log('UPDATE', 'loan', loan.id, { status: loan.status }, { status: 'COMPLETED' }, 'Marked completed');
            _.toast('Loan completed');
            renderDetail(view, id);
        };
    }

    // ---------- CHARGE INTEREST MODAL ----------
    function chargeInterestModal(loan, onDone) {
        const [interest] = [null];
        // We compute base as current outstanding principal + unpaid interest + penalties
        (async () => {
            const ints = await db.listLoanInterest(loan.id);
            const pens = await db.listLoanPenalties(loan.id);
            const reps = await db.listLoanRepayments(loan.id);
            const bal = engine.computeLoanBalance(loan, ints, pens, reps);

            const today = new Date();
            const last = [...ints].sort((a, b) => new Date(b.charge_date) - new Date(a.charge_date))[0];
            const fromDate = last ? new Date(last.charge_date) : new Date(loan.issue_date);
            const months = engine.fullMonthsBetween(fromDate, today);
            const suggestedBase = bal.totalOutstanding;
            const suggestedRate = Number(loan.interest_rate_pct);
            const suggestedAmount = engine.calcMonthlyInterest(suggestedBase, suggestedRate, Math.max(months, 1));

            const schema = [
                { name: 'charge_date', label: 'Charge date', type: 'date', required: true, default: today.toISOString().slice(0, 10) },
                { name: 'rate_pct', label: 'Rate (% / month)', type: 'number', required: true, default: suggestedRate, step: '0.001' },
                { name: 'base_amount', label: 'Base amount (RWF)', type: 'number', required: true, default: suggestedBase },
                { name: 'months', label: 'Months charged', type: 'number', required: true, default: Math.max(months, 1) },
                { name: 'notes', label: 'Notes', type: 'textarea', full: true }
            ];
            const body = document.createElement('div');
            const form = _.buildForm(schema);
            body.innerHTML = form.html + `<div id="ipv" class="mt-16"></div>`;

            function render() {
                const d = form.read(body);
                const amt = engine.calcMonthlyInterest(Number(d.base_amount) || 0, Number(d.rate_pct) || 0, Number(d.months) || 0);
                body.querySelector('#ipv').innerHTML = `
          <div class="preview">
            <div class="row total"><span>Interest to charge</span><strong>${money.fmt(amt)}</strong></div>
          </div>`;
            }
            body.addEventListener('input', render);
            render();

            _.openModal({
                title: 'Charge Interest',
                body,
                actions: [
                    { label: 'Cancel' },
                    {
                        label: 'Charge', kind: 'primary', close: false, onClick: async () => {
                            const d = form.read(body);
                            const amt = engine.calcMonthlyInterest(Number(d.base_amount) || 0, Number(d.rate_pct) || 0, Number(d.months) || 0);
                            if (amt <= 0) return _.toast('Interest amount must be > 0', 'error');
                            await db.chargeInterest({
                                loan_id: loan.id,
                                charge_date: d.charge_date,
                                rate_pct: Number(d.rate_pct),
                                base_amount: Number(d.base_amount),
                                interest_amount: amt,
                                notes: d.notes || null
                            });
                            await audit.log('CREATE', 'loan_interest', loan.id, null, { interest_amount: amt }, 'Interest charged');
                            _.toast('Interest charged: ' + money.fmt(amt));
                            _.closeModal();
                            onDone && onDone();
                        }
                    }
                ]
            });
        })();
    }

    // ---------- CHARGE PENALTY MODAL ----------
    function chargePenaltyModal(loan, onDone) {
        const schema = [
            { name: 'penalty_date', label: 'Penalty date', type: 'date', required: true, default: new Date().toISOString().slice(0, 10) },
            { name: 'amount', label: 'Amount (RWF)', type: 'number', required: true, default: Number(ELF.settings['finance.late_penalty']) || 2000 },
            { name: 'reason', label: 'Reason', full: true, default: 'Late repayment' }
        ];
        const body = document.createElement('div');
        const form = _.buildForm(schema);
        body.innerHTML = form.html;

        _.openModal({
            title: 'Add Penalty',
            body,
            actions: [
                { label: 'Cancel' },
                {
                    label: 'Add Penalty', kind: 'primary', close: false, onClick: async () => {
                        const d = form.read(body);
                        const amt = Number(d.amount);
                        if (!amt || amt <= 0) return _.toast('Amount must be > 0', 'error');
                        await db.chargePenalty({ loan_id: loan.id, penalty_date: d.penalty_date, amount: amt, reason: d.reason });
                        await audit.log('CREATE', 'loan_penalty', loan.id, null, { amount: amt, reason: d.reason }, 'Penalty added');
                        _.toast('Penalty added: ' + money.fmt(amt));
                        _.closeModal();
                        onDone && onDone();
                    }
                }
            ]
        });
    }
});