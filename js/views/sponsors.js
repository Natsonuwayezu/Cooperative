'use strict';

ELF.router.register('sponsors', async (view, params) => {
    const { ui, money, db, audit } = ELF;
    const _ = ui;

    if (params.id) return renderProfile(view, params.id);
    return renderList(view);

    async function renderList(view) {
        const rows = await db.listSponsors();
        view.innerHTML = `
      ${_.pageHead('Sponsors', 'Sponsors provide income but do not hold member shares', `
        <button class="btn-primary" id="new-sponsor">+ Add Sponsor</button>
      `)}
      ${_.table([
            { label: 'Sponsor #', render: r => `<a class="mono" href="#sponsors/${r.id}">${_.escapeHtml(r.sponsor_number)}</a>` },
            { label: 'Name', render: r => `<a href="#sponsors/${r.id}" style="font-weight:600">${_.escapeHtml(r.name)}</a>` },
            { label: 'Contact', render: r => _.escapeHtml(r.contact || '—') },
            { label: 'Purpose', render: r => _.escapeHtml((r.purpose || '').slice(0, 60)) },
            { label: '', align: 'right', render: r => `<a class="btn-ghost btn-sm" href="#sponsors/${r.id}">Open</a>` }
        ], rows, { empty: 'No sponsors yet' })}
    `;
        _.$('#new-sponsor').onclick = () => newSponsorModal(() => renderList(view));
    }

    async function renderProfile(view, id) {
        const s = await db.sb.from('sponsors').select('*').eq('id', id).single().then(r => r.data);
        const txns = await db.sb.from('transactions').select('*').eq('sponsor_id', id).order('txn_date', { ascending: false }).then(r => r.data || []);
        const totalIncome = txns.filter(t => t.txn_type === 'sponsor_income').reduce((a, t) => a + Number(t.amount), 0);

        view.innerHTML = `
      ${_.pageHead(s.name, `Sponsor ${s.sponsor_number}`, `
        <button class="btn-primary" id="add-income">+ Record Sponsor Income</button>
      `)}
      <div class="grid-3 mb-16">
        ${_.kpi('Total Contributions', money.fmt(totalIncome), txns.filter(t => t.txn_type === 'sponsor_income').length + ' entr(ies)')}
        ${_.kpi('Loans', txns.filter(t => t.txn_type === 'loan_disbursement').length, '', 'info')}
        ${_.kpi('Eligible for Profit?', 'No', 'Sponsors never share member profit', 'warn')}
      </div>

      <div class="card">
        <div class="card-title">Transaction History</div>
        <div class="mt-16">
          ${_.table([
            { label: 'Date', render: r => new Date(r.txn_date).toLocaleDateString() },
            { label: 'Number', render: r => `<span class="mono">${_.escapeHtml(r.txn_number)}</span>` },
            { label: 'Type', render: r => _.badge(r.txn_type.replace(/_/g, ' '), 'brand') },
            { label: 'Description', render: r => _.escapeHtml(r.description || '—') },
            { label: 'Amount', align: 'right', render: r => money.fmt(r.amount) }
        ], txns, { empty: 'No transactions' })}
        </div>
      </div>
    `;
        _.$('#add-income').onclick = () => sponsorIncomeModal(s, () => renderProfile(view, id));
    }

    function newSponsorModal(onDone) {
        const schema = [
            { name: 'name', label: 'Sponsor name', required: true, full: true },
            { name: 'contact', label: 'Contact (phone/email)' },
            { name: 'email', label: 'Email', type: 'email' },
            { name: 'purpose', label: 'Purpose', full: true },
            { name: 'notes', label: 'Notes', type: 'textarea', full: true }
        ];
        const body = document.createElement('div');
        const form = _.buildForm(schema);
        body.innerHTML = form.html;
        _.openModal({
            title: 'New Sponsor',
            body,
            actions: [
                { label: 'Cancel' },
                {
                    label: 'Save', kind: 'primary', close: false, onClick: async () => {
                        const d = form.read(body);
                        if (!d.name) return _.toast('Name required', 'error');
                        try {
                            const created = await db.createSponsor(d);
                            await audit.log('CREATE', 'sponsor', created.id, null, created, 'New sponsor');
                            _.toast('Sponsor added: ' + created.sponsor_number);
                            _.closeModal();
                            onDone && onDone();
                        } catch (e) { _.toast(e.message, 'error'); }
                    }
                }
            ]
        });
    }

    function sponsorIncomeModal(sponsor, onDone) {
        const schema = [
            { name: 'amount', label: 'Amount (RWF)', type: 'number', required: true },
            { name: 'txn_date', label: 'Date', type: 'date', required: true, default: new Date().toISOString().slice(0, 10) },
            {
                name: 'method', label: 'Method', type: 'select', options: [
                    { value: 'airtel', label: 'Airtel Money' },
                    { value: 'cash', label: 'Cash' },
                    { value: 'bank', label: 'Bank Transfer' }
                ]
            },
            { name: 'reference', label: 'Reference' },
            { name: 'description', label: 'Description', full: true },
            { name: 'notes', label: 'Notes', type: 'textarea', full: true }
        ];
        const body = document.createElement('div');
        const form = _.buildForm(schema);
        body.innerHTML = form.html;
        _.openModal({
            title: 'Record Sponsor Income',
            body,
            actions: [
                { label: 'Cancel' },
                {
                    label: 'Save', kind: 'primary', close: false, onClick: async () => {
                        const d = form.read(body);
                        if (!d.amount) return _.toast('Amount required', 'error');
                        try {
                            const txn = await db.recordSponsorIncome({ sponsor_id: sponsor.id, ...d });
                            await audit.log('CREATE', 'transaction', txn.id, null, txn, 'Sponsor income');
                            _.toast('Recorded: ' + txn.txn_number);
                            _.closeModal();
                            onDone && onDone();
                        } catch (e) { _.toast(e.message, 'error'); }
                    }
                }
            ]
        });
    }
});