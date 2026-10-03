'use strict';

ELF.router.register('profit', async (view, params) => {
    const { ui, money, db, engine, audit } = ELF;
    const _ = ui;

    if (params.id) return renderDetail(view, params.id);
    return renderList(view);

    // ---------- LIST ----------
    async function renderList(view) {
        const periods = await db.listProfitPeriods();

        view.innerHTML = `
      ${_.pageHead('Profit Periods', 'Distribute profit by eligible shares. Finalized periods are frozen forever.', `
        <button class="btn-primary" id="new-period">+ New Period</button>
      `)}
      ${_.table([
            { label: 'Period #', render: r => `<a class="mono" href="#profit/${r.id}">${_.escapeHtml(r.period_number)}</a>` },
            { label: 'From', render: r => new Date(r.period_start).toLocaleDateString() },
            { label: 'To', render: r => new Date(r.period_end).toLocaleDateString() },
            { label: 'Income', align: 'right', render: r => money.fmt(r.total_income) },
            { label: 'Expenses', align: 'right', render: r => money.fmt(r.total_expenses) },
            { label: 'Distributable', align: 'right', render: r => `<strong>${money.fmt(r.distributable_profit)}</strong>` },
            {
                label: 'Status', render: r => _.badge(r.status,
                    r.status === 'FINALIZED' ? 'completed'
                        : r.status === 'CALCULATED' ? 'active' : 'warn')
            },
            { label: '', align: 'right', render: r => `<a class="btn-ghost btn-sm" href="#profit/${r.id}">Open</a>` }
        ], periods, { empty: 'No profit periods yet. Create one to begin.' })}
    `;
        _.$('#new-period').onclick = () => newPeriodModal(() => renderList(view));
    }

    function newPeriodModal(onDone) {
        const today = new Date();
        const schema = [
            {
                name: 'period_start', label: 'Period start', type: 'date', required: true,
                default: new Date(today.getFullYear(), 0, 1).toISOString().slice(0, 10)
            },
            {
                name: 'period_end', label: 'Period end', type: 'date', required: true,
                default: new Date(today.getFullYear(), 11, 31).toISOString().slice(0, 10)
            },
            { name: 'notes', label: 'Notes', type: 'textarea', full: true }
        ];
        const body = document.createElement('div');
        const form = _.buildForm(schema);
        body.innerHTML = form.html;
        _.openModal({
            title: 'Create Profit Period',
            body,
            actions: [
                { label: 'Cancel' },
                {
                    label: 'Create', kind: 'primary', close: false, onClick: async () => {
                        const d = form.read(body);
                        if (new Date(d.period_start) > new Date(d.period_end)) return _.toast('Start must be before end', 'error');
                        try {
                            const created = await db.createProfitPeriod(d);
                            await audit.log('CREATE', 'profit_period', created.id, null, created, 'New period created');
                            _.toast('Period created: ' + created.period_number);
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
        const period = await db.getProfitPeriod(id);
        const allocations = period.status === 'FINALIZED'
            ? await db.listProfitAllocations(id)
            : [];

        // Preview totals always (live)
        const totals = await db.computePeriodTotals(period.period_start, period.period_end);
        const eligible = await db.buildEligibleMembers(period.period_start, period.period_end);

        // Preview allocation (engine)
        const preview = engine.allocateProfit(
            totals.distributable,
            eligible.map(e => ({ member_id: e.member_id, eligible_shares: e.eligible_shares }))
        );

        // If FINALIZED, use stored allocations instead of preview
        const displayAllocations = period.status === 'FINALIZED'
            ? allocations.map(a => {
                const e = eligible.find(x => x.member_id === a.member_id);
                return {
                    member_id: a.member_id,
                    member_number: e?.member_number || '',
                    full_name: e?.full_name || '',
                    eligible_shares: a.eligible_shares,
                    ownership_pct: Number(a.ownership_pct),
                    allocated_profit: a.allocated_profit,
                    rounding_adjustment: a.rounding_adjustment
                };
            })
            : preview.allocations.map(a => {
                const e = eligible.find(x => x.member_id === a.member_id);
                return {
                    member_id: a.member_id,
                    member_number: e?.member_number || '',
                    full_name: e?.full_name || '',
                    eligible_shares: a.eligible_shares,
                    ownership_pct: a.ownership_pct,
                    allocated_profit: a.allocated_profit,
                    rounding_adjustment: a.rounding_adjustment
                };
            });

        view.innerHTML = `
      ${_.pageHead('Profit Period ' + period.period_number,
            new Date(period.period_start).toLocaleDateString() + ' — ' + new Date(period.period_end).toLocaleDateString(),
            period.status === 'FINALIZED'
                ? `<span class="badge completed">FINALIZED</span>`
                : `<button class="btn-ghost" id="act-calc">Recalculate Totals</button>
             <button class="btn-primary" id="act-finalize">Finalize &amp; Distribute</button>` )}

      <div class="kpi-grid">
        ${_.kpi('Total Income', money.fmt(totals.income), 'Interest, penalties, sponsors, other')}
        ${_.kpi('Total Expenses', money.fmt(totals.expense), 'Airtel fees, operational', 'warn')}
        ${_.kpi('Distributable Profit', money.fmt(totals.distributable), 'Income − Expenses')}
        ${_.kpi('Eligible Members', eligible.length, 'With eligible shares')}
        ${_.kpi('Total Eligible Shares', eligible.reduce((a, e) => a + e.eligible_shares, 0), '')}
        ${_.kpi('Rounding Difference', money.fmt(preview.roundingDifference), 'Absorbed by largest fractional shares', Math.abs(preview.roundingDifference) > 0 ? 'info' : '')}
      </div>

      <div class="card mb-16">
        <div class="card-title">Allocation Basis</div>
        <div class="card-sub">Formula: Member Profit = Distributable × (Member Eligible Shares ÷ Total Eligible Shares)</div>
        <div class="mt-16">
          ${_.table([
                    { label: 'Member #', render: r => `<span class="mono">${_.escapeHtml(r.member_number)}</span>` },
                    { label: 'Name', render: r => `<a href="#members/${r.member_id}" style="font-weight:600">${_.escapeHtml(r.full_name)}</a>` },
                    { label: 'Eligible Shares', align: 'right', render: r => r.eligible_shares.toLocaleString() },
                    { label: 'Ownership', align: 'right', render: r => (r.ownership_pct * 100).toFixed(4) + '%' },
                    { label: 'Allocated Profit', align: 'right', render: r => `<strong>${money.fmt(r.allocated_profit)}</strong>` },
                    { label: 'Rounding', align: 'right', render: r => r.rounding_adjustment ? money.fmt(r.rounding_adjustment) : '—' }
                ], displayAllocations, { empty: period.status === 'FINALIZED' ? 'No allocations stored' : 'No eligible members yet' })}
        </div>
        ${displayAllocations.length ? `
          <div class="row between mt-16" style="padding-top:12px;border-top:2px solid var(--border-strong)">
            <strong>Total allocated</strong>
            <strong>${money.fmt(displayAllocations.reduce((a, x) => a + x.allocated_profit, 0))}</strong>
          </div>
        ` : ''}
      </div>

      ${period.status === 'FINALIZED' ? `
        <div class="card">
          <div class="card-title">Finalization</div>
          <div class="mt-16">
            <div class="row between" style="padding:6px 0;border-bottom:1px solid var(--border)">
              <span class="muted">Finalized at</span><span>${new Date(period.finalized_at).toLocaleString()}</span>
            </div>
            <div class="row between" style="padding:6px 0;border-bottom:1px solid var(--border)">
              <span class="muted">Total allocated</span><span>${money.fmt(period.total_allocated)}</span>
            </div>
            <div class="row between" style="padding:6px 0">
              <span class="muted">Rounding difference</span><span>${money.fmt(period.rounding_difference)}</span>
            </div>
          </div>
        </div>
      ` : ''}
    `;

        // Actions
        const calcBtn = _.$('#act-calc');
        if (calcBtn) calcBtn.onclick = async () => {
            try {
                await db.saveProfitCalculation(period.id, {
                    total_income: totals.income,
                    total_expenses: totals.expense,
                    distributable_profit: totals.distributable,
                    eligible_member_count: eligible.length,
                    total_eligible_shares: eligible.reduce((a, e) => a + e.eligible_shares, 0),
                    snapshot: {
                        period_start: period.period_start,
                        period_end: period.period_end,
                        capturedAt: new Date().toISOString(),
                        sharePrice: ELF.settings['finance.share_price'],
                        eligible_members: eligible
                    }
                });
                await audit.log('UPDATE', 'profit_period', period.id, null, { totals }, 'Recalculated totals');
                _.toast('Totals saved');
                renderDetail(view, id);
            } catch (e) { _.toast(e.message, 'error'); }
        };

        const finBtn = _.$('#act-finalize');
        if (finBtn) finBtn.onclick = async () => {
            if (!eligible.length) return _.toast('No eligible members', 'error');
            if (totals.distributable <= 0) return _.toast('Distributable profit must be > 0', 'error');
            const ok = await _.confirm(
                `Finalize this period? Profit of ${money.fmt(totals.distributable)} will be allocated to ${eligible.length} eligible member(s). This cannot be silently edited afterwards.`,
                { danger: true, okLabel: 'Finalize' }
            );
            if (!ok) return;
            try {
                // Save calculation snapshot first
                await db.saveProfitCalculation(period.id, {
                    total_income: totals.income,
                    total_expenses: totals.expense,
                    distributable_profit: totals.distributable,
                    eligible_member_count: eligible.length,
                    total_eligible_shares: preview.totalShares,
                    snapshot: {
                        period_start: period.period_start,
                        period_end: period.period_end,
                        capturedAt: new Date().toISOString(),
                        sharePrice: ELF.settings['finance.share_price'],
                        eligible_members: eligible
                    }
                });
                // Persist allocations
                await db.finalizeProfitPeriod(period.id, preview.allocations, preview.totalAllocated, preview.roundingDifference);

                // Record profit_allocation transactions per member for the ledger
                for (const a of preview.allocations) {
                    if (!a.allocated_profit) continue;
                    const gen = await db.nextNumber('report.prefix');
                    await db.sb.from('transactions').insert({
                        txn_number: gen, txn_type: 'profit_allocation',
                        amount: a.allocated_profit,
                        member_id: a.member_id,
                        profit_period_id: period.id,
                        description: `Profit allocation ${period.period_number}`,
                        metadata: { ownership_pct: a.ownership_pct, eligible_shares: a.eligible_shares }
                    });
                }

                await audit.log('UPDATE', 'profit_period', period.id,
                    { status: 'CALCULATED' }, { status: 'FINALIZED', total_allocated: preview.totalAllocated },
                    'Period finalized');

                _.toast('Period finalized');
                renderDetail(view, id);
            } catch (e) { _.toast(e.message, 'error'); }
        };
    }
});