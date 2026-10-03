'use strict';

ELF.router.register('emergency', async (view) => {
    const { ui, money, db, audit } = ELF;
    const _ = ui;

    // Load all emergency transactions
    const [contribs, assist] = await Promise.all([
        db.sb.from('transactions').select('*').eq('txn_type', 'emergency_contribution').order('txn_date', { ascending: false }).then(r => r.data || []),
        db.sb.from('transactions').select('*').eq('txn_type', 'emergency_assistance').order('txn_date', { ascending: false }).then(r => r.data || [])
    ]);
    const totalIn = contribs.reduce((a, t) => a + Number(t.amount), 0);
    const totalOut = assist.reduce((a, t) => a + Number(t.amount), 0);
    const balance = totalIn - totalOut;

    // Per-member balances
    const memberIds = Array.from(new Set([...contribs, ...assist].map(t => t.member_id).filter(Boolean)));
    const members = memberIds.length
        ? await db.sb.from('members').select('id,full_name,member_number').in('id', memberIds).then(r => r.data || [])
        : [];
    const nameMap = {};
    members.forEach(m => nameMap[m.id] = m);

    const perMember = {};
    for (const t of contribs) {
        if (!t.member_id) continue;
        perMember[t.member_id] = perMember[t.member_id] || { in: 0, out: 0 };
        perMember[t.member_id].in += Number(t.amount);
    }
    for (const t of assist) {
        if (!t.member_id) continue;
        perMember[t.member_id] = perMember[t.member_id] || { in: 0, out: 0 };
        perMember[t.member_id].out += Number(t.amount);
    }

    view.innerHTML = `
    ${_.pageHead('Emergency Fund', 'Separate from shares. Not part of distributable profit.', `
      <button class="btn-primary" id="new-assist">+ Record Assistance</button>
    `)}

    <div class="kpi-grid">
      ${_.kpi('Total Contributions', money.fmt(totalIn), contribs.length + ' entries')}
      ${_.kpi('Total Assistance Paid', money.fmt(totalOut), assist.length + ' entries', 'warn')}
      ${_.kpi('Current Emergency Balance', money.fmt(balance), 'Available to assist members', balance > 0 ? 'info' : 'danger')}
    </div>

    <div class="card mb-16">
      <div class="card-title">Member Emergency Balances</div>
      <div class="card-sub">Each member's own emergency fund balance</div>
      <div class="mt-16">
        ${_.table([
        {
            label: 'Member', render: r => {
                const m = nameMap[r.member_id];
                return m ? `<a href="#members/${m.id}" style="font-weight:600">${_.escapeHtml(m.full_name)}</a> <span class="muted mono">${_.escapeHtml(m.member_number)}</span>` : '—';
            }
        },
        { label: 'Contributed', align: 'right', render: r => money.fmt(r.in) },
        { label: 'Assistance received', align: 'right', render: r => money.fmt(r.out) },
        { label: 'Balance', align: 'right', render: r => money.fmt(Math.max(0, r.in - r.out)) }
    ], Object.entries(perMember).map(([member_id, v]) => ({ member_id, ...v })), { empty: 'No emergency activity yet' })}
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-title">Recent Contributions</div>
        <div class="mt-16">
          ${_.table([
        { label: 'Date', render: r => new Date(r.txn_date).toLocaleDateString() },
        {
            label: 'Member', render: r => {
                const m = nameMap[r.member_id];
                return m ? _.escapeHtml(m.full_name) : '—';
            }
        },
        { label: 'Amount', align: 'right', render: r => money.fmt(r.amount) }
    ], contribs.slice(0, 20), { empty: 'None yet' })}
        </div>
      </div>
      <div class="card">
        <div class="card-title">Recent Assistance</div>
        <div class="mt-16">
          ${_.table([
        { label: 'Date', render: r => new Date(r.txn_date).toLocaleDateString() },
        {
            label: 'Member', render: r => {
                const m = nameMap[r.member_id];
                return m ? _.escapeHtml(m.full_name) : '—';
            }
        },
        { label: 'Amount', align: 'right', render: r => money.fmt(r.amount) },
        { label: 'Reason', render: r => _.escapeHtml((r.description || '').replace('Emergency assistance: ', '').slice(0, 40)) }
    ], assist.slice(0, 20), { empty: 'None yet' })}
        </div>
      </div>
    </div>
  `;

    _.$('#new-assist').onclick = () => assistanceModal(() => ELF.router.go('emergency'));

    async function assistanceModal(onDone) {
        const actives = await db.listMembers({ status: 'ACTIVE', pageSize: 500 }).then(r => r.rows);
        const schema = [
            {
                name: 'member_id', label: 'Member', type: 'select', required: true, full: true,
                options: actives.length ? actives.map(m => ({ value: m.id, label: `${m.member_number} — ${m.full_name}` }))
                    : [{ value: '', label: 'No active members' }]
            },
            { name: 'amount', label: 'Amount (RWF)', type: 'number', required: true },
            { name: 'assistance_date', label: 'Date', type: 'date', required: true, default: new Date().toISOString().slice(0, 10) },
            { name: 'reason', label: 'Reason', required: true, full: true, placeholder: 'Accident, serious difficulty, etc.' },
            { name: 'notes', label: 'Notes', type: 'textarea', full: true }
        ];
        const body = document.createElement('div');
        const form = _.buildForm(schema);
        body.innerHTML = form.html;
        _.openModal({
            title: 'Record Emergency Assistance',
            body,
            actions: [
                { label: 'Cancel' },
                {
                    label: 'Save', kind: 'danger', close: false, onClick: async () => {
                        const d = form.read(body);
                        const errs = _.validateRequired(d, schema);
                        if (Object.keys(errs).length) return _.toast('Complete required fields', 'error');
                        try {
                            const rec = await db.recordEmergencyAssistance({ ...d, amount: Number(d.amount) });
                            await audit.log('CREATE', 'emergency_assistance', rec.id, null, rec, 'Assistance paid');
                            _.toast('Assistance recorded');
                            _.closeModal();
                            onDone && onDone();
                        } catch (e) { _.toast(e.message, 'error'); }
                    }
                }
            ]
        });
    }
});