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

        // Derive balances from ledger
        const shareInfo = ELF.engine.computeShareBalance(txns);
        const emergency = ELF.engine.computeEmergencyBalance(txns);
        const shareValue = shareInfo.shares * Number(ELF.settings['finance.share_price'] || 0);
        const loanBalance = loans.filter(l => l.status === 'ACTIVE' || l.status === 'OVERDUE')
            .reduce((a, l) => a + Number(l.principal), 0);

        const isActive = member.status === 'ACTIVE';

        view.innerHTML = `
      ${_.pageHead(member.full_name, `Member ${member.member_number} • Joined ${new Date(member.registration_date).toLocaleDateString()}`,
            isActive
                ? `<button class="btn-ghost" id="act-edit">Edit</button>
             <button class="btn-danger" id="act-deact">Deactivate</button>`
                : `<button class="btn-ghost" id="act-edit">Edit</button>
             <button class="btn-success" id="act-react">Reactivate</button>`)}

      <div class="grid-3 mb-16">
        ${_.kpi('Shares', shareInfo.shares, money.fmt(shareValue) + ' value')}
        ${_.kpi('Emergency Balance', money.fmt(emergency), 'Separate from profit', 'info')}
        ${_.kpi('Loan Balance', money.fmt(loanBalance), loans.length + ' loan(s)', loanBalance ? 'warn' : '')}
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
            <div class="row between" style="padding:6px 0;border-bottom:1px solid var(--border)">
              <span class="muted">Email</span><span>${_.escapeHtml(member.email || '—')}</span>
            </div>
            <div class="row between" style="padding:6px 0;border-bottom:1px solid var(--border)">
              <span class="muted">National ID</span><span>${_.escapeHtml(member.national_id || '—')}</span>
            </div>
            <div class="row between" style="padding:6px 0">
              <span class="muted">Address</span><span>${_.escapeHtml(member.address || '—')}</span>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Participation Periods</div>
          <div class="card-sub">Membership history is preserved, never overwritten</div>
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
                    { label: 'Number', render: r => `<span class="mono">${_.escapeHtml(r.txn_number)}</span>` },
                    { label: 'Type', render: r => _.badge(r.txn_type.replace(/_/g, ' '), 'brand') },
                    { label: 'Description', render: r => _.escapeHtml(r.description || '—') },
                    { label: 'Amount', align: 'right', render: r => money.fmt(r.amount) }
                ], txns.slice().reverse(), { empty: 'No transactions yet' })}
        </div>
      </div>
    `;

        _.$('#act-edit').onclick = () => editMember(member, () => renderProfile(view, id));

        if (isActive) {
            _.$('#act-deact').onclick = async () => {
                const reason = prompt('Reason for deactivation?') || 'Deactivated';
                const ok = await _.confirm(`Deactivate ${member.full_name}? Their participation ends today and a snapshot will be stored.`, { danger: true, okLabel: 'Deactivate' });
                if (!ok) return;
                try {
                    const snap = {
                        shares: shareInfo.shares,
                        shareValue,
                        emergency,
                        loanBalance,
                        capturedAt: new Date().toISOString()
                    };
                    await db.deactivateMember(member.id, reason, snap);
                    await audit.log('UPDATE', 'member', member.id, { status: 'ACTIVE' }, { status: 'DEACTIVATED' }, reason);
                    _.toast('Member deactivated');
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