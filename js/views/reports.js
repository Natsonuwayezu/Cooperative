'use strict';

ELF.router.register('reports', async (view, params) => {
    const { ui, money, db, pdf } = ELF;
    const _ = ui;

    if (params.id) return renderReport(view, params.id);
    return renderCenter(view);

    // ---------- CENTER ----------
    function renderCenter(view) {
        const groups = [
            {
                title: 'Membership', items: [
                    { id: 'member_register', label: 'Member Register', desc: 'All members with status and contact' },
                    { id: 'active_members', label: 'Active Members', desc: 'Currently active only' },
                    { id: 'deactivated_members', label: 'Deactivated Members', desc: 'Former members with end dates' },
                    { id: 'participation_periods', label: 'Participation Periods', desc: 'Every membership cycle' }
                ]
            },
            {
                title: 'Shares & Savings', items: [
                    { id: 'share_register', label: 'Share Register', desc: 'Every share purchase' },
                    { id: 'member_share_balances', label: 'Member Share Balances', desc: 'Current shares per member' },
                    { id: 'contribution_register', label: 'Contribution Register', desc: 'All contributions with split' }
                ]
            },
            {
                title: 'Emergency', items: [
                    { id: 'emergency_contributions', label: 'Emergency Contribution Register', desc: 'Monthly contributions' },
                    { id: 'emergency_balances', label: 'Member Emergency Balances', desc: 'Per-member fund balance' },
                    { id: 'emergency_assistance', label: 'Emergency Assistance Report', desc: 'Approved payouts' }
                ]
            },
            {
                title: 'Loans', items: [
                    { id: 'loan_register', label: 'Loan Register', desc: 'All loans' },
                    { id: 'active_loans', label: 'Active Loans', desc: 'Open loans only' },
                    { id: 'overdue_loans', label: 'Overdue Loans', desc: 'Past expected due date' },
                    { id: 'completed_loans', label: 'Completed Loans', desc: 'Fully repaid' },
                    { id: 'loan_repayments', label: 'Loan Repayment Report', desc: 'All repayment entries' },
                    { id: 'interest_income', label: 'Interest Income Report', desc: 'Interest charges' },
                    { id: 'penalty_income', label: 'Penalty Income Report', desc: 'Late penalties' }
                ]
            },
            {
                title: 'Finance', items: [
                    { id: 'cashbook', label: 'Cashbook', desc: 'Chronological ledger' },
                    { id: 'airtel_ledger', label: 'Airtel Money Ledger', desc: 'All Airtel transactions' },
                    { id: 'income_report', label: 'Income Report', desc: 'All income' },
                    { id: 'expense_report', label: 'Expense Report', desc: 'All expenses' },
                    { id: 'financial_position', label: 'Financial Position', desc: 'Assets/liabilities snapshot' }
                ]
            },
            {
                title: 'Profit', items: [
                    { id: 'profit_periods', label: 'Profit Period Report', desc: 'All periods' },
                    { id: 'profit_distribution', label: 'Profit Distribution Report', desc: 'Per-member allocation basis' }
                ]
            },
            {
                title: 'Audit', items: [
                    { id: 'audit_log', label: 'Audit Log', desc: 'Every change ever made' }
                ]
            }
        ];

        view.innerHTML = `
      ${_.pageHead('Report Center', 'Preview, print, or export any report as a professional PDF or CSV')}
      ${groups.map(g => `
        <div class="card mb-16">
          <div class="card-title">${g.title}</div>
          <div class="grid-3 mt-16">
            ${g.items.map(it => `
              <a class="card" href="#reports/${it.id}" style="text-decoration:none;cursor:pointer;border-color:var(--border)">
                <div class="card-title" style="color:var(--brand)">${_.escapeHtml(it.label)}</div>
                <div class="card-sub">${_.escapeHtml(it.desc)}</div>
              </a>
            `).join('')}
          </div>
        </div>
      `).join('')}
    `;
    }

    // ---------- REPORT RUNNER ----------
    async function renderReport(view, id) {
        const meta = REPORTS[id];
        if (!meta) {
            view.innerHTML = _.pageHead('Unknown report') + `<div class="card">Report “${_.escapeHtml(id)}” not found.</div>`;
            return;
        }

        const today = new Date().toISOString().slice(0, 10);
        const defaultFrom = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);

        view.innerHTML = `
      ${_.pageHead(meta.title, meta.desc, `
        <button class="btn-ghost" id="rp-pdf">Export PDF</button>
        <button class="btn-ghost" id="rp-csv">Export CSV</button>
        <a class="btn-ghost" href="#reports">← All reports</a>
      `)}
      ${meta.hasRange ? `
        <div class="card mb-16">
          <div class="row wrap" style="gap:10px">
            <div class="field"><label>From</label><input id="rp-from" type="date" value="${defaultFrom}"></div>
            <div class="field"><label>To</label><input id="rp-to" type="date" value="${today}"></div>
            <div class="field"><label>&nbsp;</label><button class="btn-primary" id="rp-run">Run</button></div>
          </div>
        </div>
      ` : ''}
      <div id="rp-output"></div>
    `;

        let lastData = null;

        async function run() {
            const out = _.$('#rp-output');
            out.innerHTML = `<div class="muted center" style="padding:40px">Loading…</div>`;
            try {
                const range = {
                    from: _.$('#rp-from') ? _.$('#rp-from').value : null,
                    to: _.$('#rp-to') ? _.$('#rp-to').value : null
                };
                const data = await meta.run(range);
                lastData = data;

                // Table view
                out.innerHTML = `
          ${_.table(
                    data.columns.map(c => ({ label: c.header, key: c.dataKey, align: c.align, mono: c.mono })),
                    data.rows,
                    { empty: 'No records in this range' }
                )}
          ${data.summary && data.summary.length ? `
            <div class="card mt-16">
              <div class="card-title">Summary</div>
              <div class="mt-16">
                ${data.summary.map(s => `<div class="row between" style="padding:4px 0"><span class="muted">${_.escapeHtml(s.label)}</span><strong>${_.escapeHtml(String(s.value))}</strong></div>`).join('')}
              </div>
            </div>` : ''}
        `;
            } catch (e) {
                out.innerHTML = `<div class="card"><div class="card-title" style="color:var(--danger)">Report failed</div><div class="card-sub">${_.escapeHtml(e.message)}</div></div>`;
            }
        }

        if (_.$('#rp-run')) _.$('#rp-run').onclick = run;
        await run();

        _.$('#rp-pdf').onclick = async () => {
            if (!lastData) return;
            const period = (_.$('#rp-from')) ? `${_.$('#rp-from').value} → ${_.$('#rp-to').value}` : '';
            await pdf.present({
                title: meta.title,
                period,
                columns: lastData.columns.map(c => ({ header: c.header, dataKey: c.dataKey, halign: c.align || 'left' })),
                rows: lastData.rows,
                summary: lastData.summary,
                orientation: meta.orientation || 'portrait',
                notes: lastData.notes
            }, `elf-${id}-${new Date().toISOString().slice(0, 10)}.pdf`);
        };

        _.$('#rp-csv').onclick = () => {
            if (!lastData) return;
            const header = lastData.columns.map(c => `"${c.header}"`).join(',');
            const body = lastData.rows.map(r => lastData.columns.map(c => {
                const v = r[c.dataKey] ?? '';
                const s = String(v).replace(/"/g, '""');
                return `"${s}"`;
            }).join(',')).join('\n');
            const csv = header + '\n' + body;
            const blob = new Blob([csv], { type: 'text/csv' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `elf-${id}-${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            _.toast('CSV downloaded');
        };
    }

    // ---------- REPORT DEFINITIONS ----------
    const REPORTS = {
        // ---- Membership ----
        member_register: {
            title: 'Member Register', desc: 'All registered members', hasRange: false,
            run: async () => {
                const { data } = await db.sb.from('members').select('*').order('member_number');
                return {
                    columns: [
                        { header: 'Member #', dataKey: 'member_number', mono: true },
                        { header: 'Full name', dataKey: 'full_name' },
                        { header: 'Phone', dataKey: 'phone' },
                        { header: 'Registered', dataKey: 'reg', align: 'left' },
                        { header: 'Status', dataKey: 'status' }
                    ],
                    rows: (data || []).map(m => ({ ...m, reg: new Date(m.registration_date).toLocaleDateString() })),
                    summary: [{ label: 'Total members', value: (data || []).length }]
                };
            }
        },
        active_members: {
            title: 'Active Members', desc: 'Currently active only', hasRange: false,
            run: async () => {
                const { data } = await db.sb.from('members').select('*').eq('status', 'ACTIVE').order('member_number');
                return {
                    columns: [
                        { header: 'Member #', dataKey: 'member_number', mono: true },
                        { header: 'Full name', dataKey: 'full_name' },
                        { header: 'Phone', dataKey: 'phone' },
                        { header: 'Registered', dataKey: 'reg' }
                    ],
                    rows: (data || []).map(m => ({ ...m, reg: new Date(m.registration_date).toLocaleDateString() })),
                    summary: [{ label: 'Active members', value: (data || []).length }]
                };
            }
        },
        deactivated_members: {
            title: 'Deactivated Members', desc: 'Former members', hasRange: false,
            run: async () => {
                const { data } = await db.sb.from('members').select('*').eq('status', 'DEACTIVATED').order('member_number');
                return {
                    columns: [
                        { header: 'Member #', dataKey: 'member_number', mono: true },
                        { header: 'Full name', dataKey: 'full_name' },
                        { header: 'Phone', dataKey: 'phone' }
                    ],
                    rows: data || [], summary: [{ label: 'Deactivated', value: (data || []).length }]
                };
            }
        },
        participation_periods: {
            title: 'Participation Periods', desc: 'Every membership cycle', hasRange: false,
            run: async () => {
                const { data } = await db.sb.from('member_participation_periods').select('*, members(full_name, member_number)').order('start_date');
                return {
                    columns: [
                        { header: 'Member #', dataKey: 'num', mono: true },
                        { header: 'Name', dataKey: 'name' },
                        { header: 'Start', dataKey: 'start' },
                        { header: 'End', dataKey: 'end' },
                        { header: 'Reason', dataKey: 'reason' }
                    ],
                    rows: (data || []).map(p => ({
                        num: p.members?.member_number,
                        name: p.members?.full_name,
                        start: new Date(p.start_date).toLocaleDateString(),
                        end: p.end_date ? new Date(p.end_date).toLocaleDateString() : 'Current',
                        reason: p.reason_end || p.reason_start || ''
                    }))
                };
            }
        },

        // ---- Shares ----
        share_register: {
            title: 'Share Register', desc: 'Every share purchase', hasRange: true,
            run: async ({ from, to }) => {
                let q = db.sb.from('transactions').select('*, members(full_name, member_number)')
                    .in('txn_type', ['share_purchase', 'member_contribution'])
                    .order('txn_date');
                if (from) q = q.gte('txn_date', from);
                if (to) q = q.lte('txn_date', to + 'T23:59:59');
                const { data } = await q;
                let totalShares = 0, totalValue = 0;
                const rows = (data || []).filter(t => (t.metadata?.shares || 0) > 0).map(t => {
                    const shares = Number(t.metadata?.shares || 0);
                    const sp = Number(t.metadata?.sharePrice || ELF.settings['finance.share_price'] || 0);
                    totalShares += shares; totalValue += shares * sp;
                    return {
                        date: new Date(t.txn_date).toLocaleDateString(),
                        num: t.txn_number,
                        member: t.members?.member_number,
                        name: t.members?.full_name,
                        shares, value: money.fmt(shares * sp, false)
                    };
                });
                return {
                    columns: [
                        { header: 'Date', dataKey: 'date' },
                        { header: 'Txn #', dataKey: 'num', mono: true },
                        { header: 'Member #', dataKey: 'member' },
                        { header: 'Name', dataKey: 'name' },
                        { header: 'Shares', dataKey: 'shares', align: 'right' },
                        { header: 'Value (RWF)', dataKey: 'value', align: 'right' }
                    ],
                    rows,
                    summary: [
                        { label: 'Total shares', value: totalShares.toLocaleString() },
                        { label: 'Total value', value: money.fmt(totalValue) }
                    ]
                };
            }
        },
        member_share_balances: {
            title: 'Member Share Balances', desc: 'Current shares per member', hasRange: false,
            run: async () => {
                const { data } = await db.sb.from('transactions')
                    .select('member_id, metadata, txn_type, status, members(full_name, member_number, status)')
                    .in('txn_type', ['share_purchase', 'member_contribution']);
                const map = {};
                for (const t of (data || [])) {
                    if (t.status === 'REVERSED' || !t.member_id) continue;
                    const sh = Number(t.metadata?.shares || 0);
                    if (sh <= 0) continue;
                    map[t.member_id] = map[t.member_id] || { name: t.members?.full_name, num: t.members?.member_number, status: t.members?.status, shares: 0 };
                    map[t.member_id].shares += sh;
                }
                const sp = Number(ELF.settings['finance.share_price'] || 0);
                const rows = Object.values(map).sort((a, b) => b.shares - a.shares).map(r => ({
                    ...r, value: money.fmt(r.shares * sp, false)
                }));
                return {
                    columns: [
                        { header: 'Member #', dataKey: 'num' },
                        { header: 'Name', dataKey: 'name' },
                        { header: 'Status', dataKey: 'status' },
                        { header: 'Shares', dataKey: 'shares', align: 'right' },
                        { header: 'Value (RWF)', dataKey: 'value', align: 'right' }
                    ],
                    rows,
                    summary: [
                        { label: 'Total shares', value: rows.reduce((a, r) => a + r.shares, 0).toLocaleString() },
                        { label: 'Total value', value: money.fmt(rows.reduce((a, r) => a + r.shares, 0) * sp) }
                    ]
                };
            }
        },
        contribution_register: {
            title: 'Contribution Register', desc: 'All member contributions', hasRange: true,
            run: async ({ from, to }) => {
                let q = db.sb.from('transactions').select('*, members(full_name, member_number)')
                    .eq('txn_type', 'member_contribution').order('txn_date');
                if (from) q = q.gte('txn_date', from);
                if (to) q = q.lte('txn_date', to + 'T23:59:59');
                const { data } = await q;
                let total = 0;
                const rows = (data || []).map(t => {
                    total += Number(t.amount);
                    return {
                        date: new Date(t.txn_date).toLocaleDateString(),
                        num: t.txn_number, member: t.members?.member_number, name: t.members?.full_name,
                        shares: t.metadata?.shares || 0, emergency: t.metadata?.emergency || 0,
                        amount: money.fmt(t.amount, false)
                    };
                });
                return {
                    columns: [
                        { header: 'Date', dataKey: 'date' },
                        { header: 'Txn #', dataKey: 'num', mono: true },
                        { header: 'Member #', dataKey: 'member' },
                        { header: 'Name', dataKey: 'name' },
                        { header: 'Shares', dataKey: 'shares', align: 'right' },
                        { header: 'Emergency', dataKey: 'emergency', align: 'right' },
                        { header: 'Amount (RWF)', dataKey: 'amount', align: 'right' }
                    ],
                    rows, summary: [{ label: 'Total received', value: money.fmt(total) }]
                };
            }
        },

        // ---- Emergency ----
        emergency_contributions: {
            title: 'Emergency Contribution Register', desc: 'Monthly contributions', hasRange: true,
            run: async ({ from, to }) => {
                let q = db.sb.from('transactions').select('*, members(full_name, member_number)')
                    .eq('txn_type', 'emergency_contribution').order('txn_date');
                if (from) q = q.gte('txn_date', from);
                if (to) q = q.lte('txn_date', to + 'T23:59:59');
                const { data } = await q;
                let total = 0;
                const rows = (data || []).map(t => {
                    total += Number(t.amount); return {
                        date: new Date(t.txn_date).toLocaleDateString(),
                        num: t.txn_number, member: t.members?.member_number, name: t.members?.full_name,
                        amount: money.fmt(t.amount, false)
                    };
                });
                return {
                    columns: [
                        { header: 'Date', dataKey: 'date' },
                        { header: 'Txn #', dataKey: 'num', mono: true },
                        { header: 'Member #', dataKey: 'member' },
                        { header: 'Name', dataKey: 'name' },
                        { header: 'Amount (RWF)', dataKey: 'amount', align: 'right' }
                    ],
                    rows, summary: [{ label: 'Total', value: money.fmt(total) }]
                };
            }
        },
        emergency_balances: {
            title: 'Member Emergency Balances', desc: 'Per-member emergency fund', hasRange: false,
            run: async () => {
                const { data } = await db.sb.from('transactions')
                    .select('member_id, amount, txn_type, status, members(full_name, member_number)')
                    .in('txn_type', ['emergency_contribution', 'emergency_assistance']);
                const map = {};
                for (const t of (data || [])) {
                    if (t.status === 'REVERSED' || !t.member_id) continue;
                    map[t.member_id] = map[t.member_id] || { num: t.members?.member_number, name: t.members?.full_name, in: 0, out: 0 };
                    if (t.txn_type === 'emergency_contribution') map[t.member_id].in += Number(t.amount);
                    else map[t.member_id].out += Number(t.amount);
                }
                const rows = Object.values(map).map(r => ({
                    ...r, contributed: money.fmt(r.in, false), out: money.fmt(r.out, false),
                    balance: money.fmt(Math.max(0, r.in - r.out), false)
                })).sort((a, b) => a.name.localeCompare(b.name));
                return {
                    columns: [
                        { header: 'Member #', dataKey: 'num' },
                        { header: 'Name', dataKey: 'name' },
                        { header: 'Contributed', dataKey: 'contributed', align: 'right' },
                        { header: 'Assistance received', dataKey: 'out', align: 'right' },
                        { header: 'Balance', dataKey: 'balance', align: 'right' }
                    ],
                    rows,
                    summary: [{
                        label: 'Total emergency balance',
                        value: money.fmt(rows.reduce((a, r) => a + Number(String(r.balance).replace(/,/g, '')), 0))
                    }]
                };
            }
        },
        emergency_assistance: {
            title: 'Emergency Assistance Report', desc: 'Approved payouts', hasRange: true,
            run: async ({ from, to }) => {
                let q = db.sb.from('emergency_assistance').select('*, members(full_name, member_number)').order('assistance_date');
                if (from) q = q.gte('assistance_date', from);
                if (to) q = q.lte('assistance_date', to);
                const { data } = await q;
                let total = 0;
                const rows = (data || []).map(a => {
                    total += Number(a.amount); return {
                        date: new Date(a.assistance_date).toLocaleDateString(),
                        member: a.members?.member_number, name: a.members?.full_name,
                        amount: money.fmt(a.amount, false), reason: a.reason
                    };
                });
                return {
                    columns: [
                        { header: 'Date', dataKey: 'date' },
                        { header: 'Member #', dataKey: 'member' },
                        { header: 'Name', dataKey: 'name' },
                        { header: 'Reason', dataKey: 'reason' },
                        { header: 'Amount (RWF)', dataKey: 'amount', align: 'right' }
                    ],
                    rows, summary: [{ label: 'Total assistance paid', value: money.fmt(total) }]
                };
            }
        },

        // ---- Loans ----
        loan_register: {
            title: 'Loan Register', desc: 'All loans', hasRange: false,
            run: async () => {
                const { data } = await db.sb.from('loans').select('*').order('issue_date', { ascending: false });
                return {
                    columns: [
                        { header: 'Loan #', dataKey: 'loan_number', mono: true },
                        { header: 'Issued', dataKey: 'issued' },
                        { header: 'Principal', dataKey: 'principal', align: 'right' },
                        { header: 'Rate', dataKey: 'rate', align: 'right' },
                        { header: 'Due', dataKey: 'due' },
                        { header: 'Status', dataKey: 'status' }
                    ],
                    rows: (data || []).map(l => ({
                        loan_number: l.loan_number,
                        issued: new Date(l.issue_date).toLocaleDateString(),
                        principal: money.fmt(l.principal, false),
                        rate: Number(l.interest_rate_pct).toFixed(2) + '%',
                        due: l.expected_due_date ? new Date(l.expected_due_date).toLocaleDateString() : '—',
                        status: l.status
                    })),
                    summary: [{ label: 'Total loans', value: (data || []).length }]
                };
            }
        },
        active_loans: {
            title: 'Active Loans', desc: 'Currently open', hasRange: false,
            run: async () => {
                const { data } = await db.sb.from('loans').select('*').eq('status', 'ACTIVE').order('issue_date');
                return {
                    columns: [
                        { header: 'Loan #', dataKey: 'loan_number', mono: true },
                        { header: 'Issued', dataKey: 'issued' },
                        { header: 'Principal', dataKey: 'principal', align: 'right' },
                        { header: 'Rate', dataKey: 'rate', align: 'right' }
                    ],
                    rows: (data || []).map(l => ({
                        loan_number: l.loan_number, issued: new Date(l.issue_date).toLocaleDateString(),
                        principal: money.fmt(l.principal, false), rate: Number(l.interest_rate_pct).toFixed(2) + '%'
                    })),
                    summary: [{ label: 'Active loans', value: (data || []).length },
                    { label: 'Principal outstanding', value: money.fmt((data || []).reduce((a, l) => a + Number(l.principal), 0)) }]
                };
            }
        },
        overdue_loans: {
            title: 'Overdue Loans', desc: 'Past expected due date', hasRange: false,
            run: async () => {
                const today = new Date().toISOString().slice(0, 10);
                const { data } = await db.sb.from('loans').select('*').eq('status', 'ACTIVE').lt('expected_due_date', today).order('expected_due_date');
                return {
                    columns: [
                        { header: 'Loan #', dataKey: 'loan_number', mono: true },
                        { header: 'Issued', dataKey: 'issued' },
                        { header: 'Due', dataKey: 'due' },
                        { header: 'Principal', dataKey: 'principal', align: 'right' }
                    ],
                    rows: (data || []).map(l => ({
                        loan_number: l.loan_number, issued: new Date(l.issue_date).toLocaleDateString(),
                        due: new Date(l.expected_due_date).toLocaleDateString(),
                        principal: money.fmt(l.principal, false)
                    })),
                    summary: [{ label: 'Overdue loans', value: (data || []).length }]
                };
            }
        },
        completed_loans: {
            title: 'Completed Loans', desc: 'Fully repaid', hasRange: false,
            run: async () => {
                const { data } = await db.sb.from('loans').select('*').eq('status', 'COMPLETED').order('issue_date', { ascending: false });
                return {
                    columns: [
                        { header: 'Loan #', dataKey: 'loan_number', mono: true },
                        { header: 'Issued', dataKey: 'issued' },
                        { header: 'Principal', dataKey: 'principal', align: 'right' }
                    ],
                    rows: (data || []).map(l => ({
                        loan_number: l.loan_number, issued: new Date(l.issue_date).toLocaleDateString(),
                        principal: money.fmt(l.principal, false)
                    })),
                    summary: [{ label: 'Completed', value: (data || []).length }]
                };
            }
        },
        loan_repayments: {
            title: 'Loan Repayment Report', desc: 'All repayment entries', hasRange: true,
            run: async ({ from, to }) => {
                let q = db.sb.from('loan_repayments').select('*, loans(loan_number)').order('payment_date');
                if (from) q = q.gte('payment_date', from);
                if (to) q = q.lte('payment_date', to);
                const { data } = await q;
                let total = 0;
                const rows = (data || []).map(r => {
                    total += Number(r.total_received); return {
                        date: new Date(r.payment_date).toLocaleDateString(),
                        loan: r.loans?.loan_number,
                        total: money.fmt(r.total_received, false),
                        interest: money.fmt(r.interest_portion, false),
                        penalty: money.fmt(r.penalty_portion, false),
                        principal: money.fmt(r.principal_portion, false)
                    };
                });
                return {
                    columns: [
                        { header: 'Date', dataKey: 'date' },
                        { header: 'Loan #', dataKey: 'loan', mono: true },
                        { header: 'Total', dataKey: 'total', align: 'right' },
                        { header: 'Interest', dataKey: 'interest', align: 'right' },
                        { header: 'Penalty', dataKey: 'penalty', align: 'right' },
                        { header: 'Principal', dataKey: 'principal', align: 'right' }
                    ],
                    rows, summary: [{ label: 'Total received', value: money.fmt(total) }]
                };
            }
        },
        interest_income: {
            title: 'Interest Income Report', desc: 'Interest charges', hasRange: true,
            run: async ({ from, to }) => {
                let q = db.sb.from('loan_interest_entries').select('*, loans(loan_number)').order('charge_date');
                if (from) q = q.gte('charge_date', from);
                if (to) q = q.lte('charge_date', to);
                const { data } = await q;
                let total = 0;
                const rows = (data || []).map(i => {
                    total += Number(i.interest_amount); return {
                        date: new Date(i.charge_date).toLocaleDateString(),
                        loan: i.loans?.loan_number,
                        rate: Number(i.rate_pct).toFixed(2) + '%',
                        base: money.fmt(i.base_amount, false),
                        interest: money.fmt(i.interest_amount, false)
                    };
                });
                return {
                    columns: [
                        { header: 'Date', dataKey: 'date' },
                        { header: 'Loan #', dataKey: 'loan', mono: true },
                        { header: 'Rate', dataKey: 'rate', align: 'right' },
                        { header: 'Base', dataKey: 'base', align: 'right' },
                        { header: 'Interest', dataKey: 'interest', align: 'right' }
                    ],
                    rows, summary: [{ label: 'Total interest income', value: money.fmt(total) }]
                };
            }
        },
        penalty_income: {
            title: 'Penalty Income Report', desc: 'Late penalties', hasRange: true,
            run: async ({ from, to }) => {
                let q = db.sb.from('loan_penalties').select('*, loans(loan_number)').order('penalty_date');
                if (from) q = q.gte('penalty_date', from);
                if (to) q = q.lte('penalty_date', to);
                const { data } = await q;
                let total = 0;
                const rows = (data || []).map(p => {
                    total += Number(p.amount); return {
                        date: new Date(p.penalty_date).toLocaleDateString(),
                        loan: p.loans?.loan_number,
                        amount: money.fmt(p.amount, false),
                        reason: p.reason || ''
                    };
                });
                return {
                    columns: [
                        { header: 'Date', dataKey: 'date' },
                        { header: 'Loan #', dataKey: 'loan', mono: true },
                        { header: 'Amount', dataKey: 'amount', align: 'right' },
                        { header: 'Reason', dataKey: 'reason' }
                    ],
                    rows, summary: [{ label: 'Total penalties', value: money.fmt(total) }]
                };
            }
        },

        // ---- Finance ----
        cashbook: {
            title: 'Cashbook', desc: 'Chronological ledger', hasRange: true, orientation: 'landscape',
            run: async ({ from, to }) => {
                let q = db.sb.from('transactions').select('*').order('txn_date');
                if (from) q = q.gte('txn_date', from);
                if (to) q = q.lte('txn_date', to + 'T23:59:59');
                const { data } = await q;
                let total = 0;
                const rows = (data || []).filter(t => t.status !== 'REVERSED').map(t => {
                    const inTypes = ['loan_repayment', 'member_contribution', 'share_purchase', 'emergency_contribution', 'sponsor_income', 'other_income', 'deposit'];
                    const isIn = inTypes.includes(t.txn_type);
                    const amt = Number(t.amount); total += isIn ? amt : -amt;
                    return {
                        date: new Date(t.txn_date).toLocaleDateString(),
                        num: t.txn_number, type: t.txn_type,
                        desc: (t.description || '').slice(0, 60),
                        in: isIn ? money.fmt(amt, false) : '',
                        out: !isIn ? money.fmt(amt, false) : '',
                        balance: money.fmt(total, false)
                    };
                });
                return {
                    columns: [
                        { header: 'Date', dataKey: 'date' },
                        { header: 'Txn #', dataKey: 'num', mono: true },
                        { header: 'Type', dataKey: 'type' },
                        { header: 'Description', dataKey: 'desc' },
                        { header: 'In (RWF)', dataKey: 'in', align: 'right' },
                        { header: 'Out (RWF)', dataKey: 'out', align: 'right' },
                        { header: 'Balance', dataKey: 'balance', align: 'right' }
                    ],
                    rows,
                    summary: [{ label: 'Ending running balance', value: money.fmt(total) }],
                    notes: 'Running balance is informational. Refer to Financial Position for authoritative figures.'
                };
            }
        },
        airtel_ledger: {
            title: 'Airtel Money Ledger', desc: 'All Airtel transactions', hasRange: true,
            run: async ({ from, to }) => {
                let q = db.sb.from('transactions').select('*, financial_accounts(code,name)').order('txn_date');
                if (from) q = q.gte('txn_date', from);
                if (to) q = q.lte('txn_date', to + 'T23:59:59');
                const { data } = await q;
                const rows = (data || []).filter(t => t.financial_accounts?.code === 'AIRTEL' && t.status !== 'REVERSED').map(t => ({
                    date: new Date(t.txn_date).toLocaleDateString(),
                    num: t.txn_number, type: t.txn_type,
                    amount: money.fmt(t.amount, false)
                }));
                let total = 0;
                rows.forEach(r => total += Number(String(r.amount).replace(/,/g, '')));
                return {
                    columns: [
                        { header: 'Date', dataKey: 'date' },
                        { header: 'Txn #', dataKey: 'num', mono: true },
                        { header: 'Type', dataKey: 'type' },
                        { header: 'Amount (RWF)', dataKey: 'amount', align: 'right' }
                    ],
                    rows, summary: [{ label: 'Total Airtel movement', value: money.fmt(total) }]
                };
            }
        },
        income_report: {
            title: 'Income Report', desc: 'All income entries', hasRange: true,
            run: async ({ from, to }) => {
                let q = db.sb.from('transactions').select('*').in('txn_type', ['loan_interest', 'loan_penalty', 'sponsor_income', 'other_income']).order('txn_date');
                if (from) q = q.gte('txn_date', from);
                if (to) q = q.lte('txn_date', to + 'T23:59:59');
                const { data } = await q;
                let total = 0;
                const rows = (data || []).filter(t => t.status !== 'REVERSED').map(t => {
                    total += Number(t.amount); return {
                        date: new Date(t.txn_date).toLocaleDateString(),
                        num: t.txn_number, type: t.txn_type,
                        desc: (t.description || '').slice(0, 60),
                        amount: money.fmt(t.amount, false)
                    };
                });
                return {
                    columns: [
                        { header: 'Date', dataKey: 'date' },
                        { header: 'Txn #', dataKey: 'num', mono: true },
                        { header: 'Type', dataKey: 'type' },
                        { header: 'Description', dataKey: 'desc' },
                        { header: 'Amount', dataKey: 'amount', align: 'right' }
                    ],
                    rows, summary: [{ label: 'Total income', value: money.fmt(total) }]
                };
            }
        },
        expense_report: {
            title: 'Expense Report', desc: 'All expenses', hasRange: true,
            run: async ({ from, to }) => {
                let q = db.sb.from('transactions').select('*').in('txn_type', ['expense', 'airtel_fee', 'emergency_assistance']).order('txn_date');
                if (from) q = q.gte('txn_date', from);
                if (to) q = q.lte('txn_date', to + 'T23:59:59');
                const { data } = await q;
                let total = 0;
                const rows = (data || []).filter(t => t.status !== 'REVERSED').map(t => {
                    total += Number(t.amount); return {
                        date: new Date(t.txn_date).toLocaleDateString(),
                        num: t.txn_number, type: t.txn_type,
                        desc: (t.description || '').slice(0, 60),
                        amount: money.fmt(t.amount, false)
                    };
                });
                return {
                    columns: [
                        { header: 'Date', dataKey: 'date' },
                        { header: 'Txn #', dataKey: 'num', mono: true },
                        { header: 'Type', dataKey: 'type' },
                        { header: 'Description', dataKey: 'desc' },
                        { header: 'Amount', dataKey: 'amount', align: 'right' }
                    ],
                    rows, summary: [{ label: 'Total expenses', value: money.fmt(total) }]
                };
            }
        },
        financial_position: {
            title: 'Financial Position', desc: 'Snapshot of assets, liabilities, and funds', hasRange: false,
            run: async () => {
                const { data: txns } = await db.sb.from('transactions').select('txn_type,amount,status');
                let shareCapital = 0, emergencyIn = 0, emergencyOut = 0, income = 0, expenses = 0;
                for (const t of (txns || [])) {
                    if (t.status === 'REVERSED') continue;
                    const amt = Number(t.amount) || 0;
                    switch (t.txn_type) {
                        case 'share_purchase': shareCapital += amt; break;
                        case 'emergency_contribution': emergencyIn += amt; break;
                        case 'emergency_assistance': emergencyOut += amt; break;
                        case 'loan_interest':
                        case 'loan_penalty':
                        case 'sponsor_income':
                        case 'other_income': income += amt; break;
                        case 'expense':
                        case 'airtel_fee': expenses += amt; break;
                    }
                }
                const { data: loans } = await db.sb.from('loans').select('principal,status');
                const outstanding = (loans || []).filter(l => l.status === 'ACTIVE' || l.status === 'OVERDUE').reduce((a, l) => a + Number(l.principal), 0);

                const emergencyFund = Math.max(0, emergencyIn - emergencyOut);
                const distributable = Math.max(0, income - expenses);
                const liquid = shareCapital + emergencyFund + distributable - outstanding;

                return {
                    columns: [
                        { header: 'Item', dataKey: 'item' },
                        { header: 'Amount', dataKey: 'amount', align: 'right' }
                    ],
                    rows: [
                        { item: 'Member share capital', amount: money.fmt(shareCapital) },
                        { item: 'Emergency fund', amount: money.fmt(emergencyFund) },
                        { item: 'Distributable profit', amount: money.fmt(distributable) },
                        { item: 'Outstanding loans (asset)', amount: money.fmt(outstanding) },
                        { item: 'Total income', amount: money.fmt(income) },
                        { item: 'Total expenses', amount: money.fmt(expenses) },
                        { item: 'Net position', amount: money.fmt(liquid) }
                    ],
                    summary: [
                        { label: 'Liquid balance (approx.)', value: money.fmt(liquid) },
                        { label: 'Share capital', value: money.fmt(shareCapital) },
                        { label: 'Emergency fund', value: money.fmt(emergencyFund) },
                        { label: 'Outstanding loans', value: money.fmt(outstanding) }
                    ],
                    notes: 'Derived from the ledger. Review Cashbook for authoritative cash movements.'
                };
            }
        },

        // ---- Profit ----
        profit_periods: {
            title: 'Profit Period Report', desc: 'All profit periods', hasRange: false,
            run: async () => {
                const periods = await db.listProfitPeriods();
                return {
                    columns: [
                        { header: 'Period #', dataKey: 'num', mono: true },
                        { header: 'From', dataKey: 'from' },
                        { header: 'To', dataKey: 'to' },
                        { header: 'Income', dataKey: 'income', align: 'right' },
                        { header: 'Expenses', dataKey: 'exp', align: 'right' },
                        { header: 'Distributable', dataKey: 'dist', align: 'right' },
                        { header: 'Status', dataKey: 'status' }
                    ],
                    rows: periods.map(p => ({
                        num: p.period_number,
                        from: new Date(p.period_start).toLocaleDateString(),
                        to: new Date(p.period_end).toLocaleDateString(),
                        income: money.fmt(p.total_income, false),
                        exp: money.fmt(p.total_expenses, false),
                        dist: money.fmt(p.distributable_profit, false),
                        status: p.status
                    })),
                    summary: [{ label: 'Total periods', value: periods.length }]
                };
            }
        },
        profit_distribution: {
            title: 'Profit Distribution Report', desc: 'Allocation basis per member', hasRange: false, orientation: 'landscape',
            run: async () => {
                const { data: periods } = await db.sb.from('profit_periods').select('*').eq('status', 'FINALIZED');
                if (!periods || !periods.length) {
                    return { columns: [{ header: 'Info', dataKey: 'info' }], rows: [{ info: 'No finalized profit periods yet' }], summary: [] };
                }
                const latest = periods.sort((a, b) => new Date(b.period_end) - new Date(a.period_end))[0];
                const allocs = await db.listProfitAllocations(latest.id);
                const { data: members } = await db.sb.from('members').select('id, full_name, member_number');
                const mMap = {}; (members || []).forEach(m => mMap[m.id] = m);
                let totalAlloc = 0;
                const rows = allocs.map(a => {
                    totalAlloc += Number(a.allocated_profit);
                    return {
                        num: mMap[a.member_id]?.member_number || '',
                        name: mMap[a.member_id]?.full_name || '',
                        shares: Number(a.eligible_shares).toLocaleString(),
                        pct: (Number(a.ownership_pct) * 100).toFixed(4) + '%',
                        profit: money.fmt(a.allocated_profit, false),
                        rounding: a.rounding_adjustment ? money.fmt(a.rounding_adjustment, false) : '—'
                    };
                });
                return {
                    columns: [
                        { header: 'Member #', dataKey: 'num' },
                        { header: 'Name', dataKey: 'name' },
                        { header: 'Eligible shares', dataKey: 'shares', align: 'right' },
                        { header: 'Ownership', dataKey: 'pct', align: 'right' },
                        { header: 'Allocated profit', dataKey: 'profit', align: 'right' },
                        { header: 'Rounding', dataKey: 'rounding', align: 'right' }
                    ],
                    rows,
                    summary: [
                        { label: 'Period', value: latest.period_number },
                        { label: 'Distributable', value: money.fmt(latest.distributable_profit) },
                        { label: 'Total allocated', value: money.fmt(totalAlloc) },
                        { label: 'Rounding difference', value: money.fmt(latest.rounding_difference) }
                    ]
                };
            }
        },

        // ---- Audit ----
        audit_log: {
            title: 'Audit Log', desc: 'Every change ever made', hasRange: true, orientation: 'landscape',
            run: async ({ from, to }) => {
                let q = db.sb.from('audit_log').select('*').order('created_at', { ascending: false }).limit(500);
                if (from) q = q.gte('created_at', from);
                if (to) q = q.lte('created_at', to + 'T23:59:59');
                const { data } = await q;
                return {
                    columns: [
                        { header: 'When', dataKey: 'when' },
                        { header: 'Action', dataKey: 'action' },
                        { header: 'Record', dataKey: 'record' },
                        { header: 'ID', dataKey: 'id', mono: true },
                        { header: 'Reason', dataKey: 'reason' }
                    ],
                    rows: (data || []).map(a => ({
                        when: new Date(a.created_at).toLocaleString(),
                        action: a.action, record: a.record_type,
                        id: (a.record_id || '').slice(0, 8),
                        reason: (a.reason || '').slice(0, 80)
                    })),
                    summary: [{ label: 'Entries shown', value: (data || []).length }]
                };
            }
        }
    };
});