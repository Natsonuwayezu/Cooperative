'use strict';

ELF.router.register('borrowers', async (view, params) => {
    const { ui, money, db, audit } = ELF;
    const _ = ui;

    if (params.id) return renderProfile(view, params.id);
    return renderList(view);

    async function renderList(view) {
        const rows = await db.listBorrowers();
        view.innerHTML = `
      ${_.pageHead('External Borrowers', 'Non-member borrowers — no profit sharing', `
        <button class="btn-primary" id="new-borrower">+ Add Borrower</button>
      `)}
      ${_.table([
            { label: 'Borrower #', render: r => `<a class="mono" href="#borrowers/${r.id}">${_.escapeHtml(r.borrower_number)}</a>` },
            { label: 'Name', render: r => `<a href="#borrowers/${r.id}" style="font-weight:600">${_.escapeHtml(r.name)}</a>` },
            { label: 'Phone', render: r => _.escapeHtml(r.phone || '—') },
            { label: 'Kind', render: r => _.badge(r.kind, 'brand') },
            { label: '', align: 'right', render: r => `<a class="btn-ghost btn-sm" href="#borrowers/${r.id}">Open</a>` }
        ], rows, { empty: 'No external borrowers yet' })}
    `;
        _.$('#new-borrower').onclick = () => newBorrowerModal(() => renderList(view));
    }

    async function renderProfile(view, id) {
        const b = await db.sb.from('borrowers').select('*').eq('id', id).single().then(r => r.data);
        const loans = await db.sb.from('loans').select('*').eq('borrower_id', id).then(r => r.data || []);
        const active = loans.filter(l => l.status === 'ACTIVE' || l.status === 'OVERDUE');
        const totalOut = active.reduce((a, l) => a + Number(l.principal), 0);

        view.innerHTML = `
      ${_.pageHead(b.name, `External borrower ${b.borrower_number}`, `
        <a class="btn-primary" href="#loans">+ Issue Loan</a>
      `)}
      <div class="grid-3 mb-16">
        ${_.kpi('Active Loans', active.length)}
        ${_.kpi('Outstanding Principal', money.fmt(totalOut), '', totalOut ? 'warn' : '')}
        ${_.kpi('Profit Sharing', 'None', 'External borrowers do not share profit', 'info')}
      </div>
      <div class="card">
        <div class="card-title">Loan History</div>
        <div class="mt-16">
          ${_.table([
            { label: 'Loan #', render: r => `<a class="mono" href="#loans/${r.id}">${_.escapeHtml(r.loan_number)}</a>` },
            { label: 'Issued', render: r => new Date(r.issue_date).toLocaleDateString() },
            { label: 'Principal', align: 'right', render: r => money.fmt(r.principal) },
            { label: 'Status', render: r => _.badge(r.status, r.status === 'ACTIVE' ? 'active' : 'completed') }
        ], loans, { empty: 'No loans yet' })}
        </div>
      </div>
    `;
    }

    function newBorrowerModal(onDone) {
        const schema = [
            { name: 'name', label: 'Full name', required: true, full: true },
            { name: 'phone', label: 'Phone' },
            { name: 'email', label: 'Email', type: 'email' },
            { name: 'national_id', label: 'National ID' },
            { name: 'address', label: 'Address' },
            { name: 'notes', label: 'Notes', type: 'textarea', full: true }
        ];
        const body = document.createElement('div');
        const form = _.buildForm(schema);
        body.innerHTML = form.html;
        _.openModal({
            title: 'Add External Borrower',
            body,
            actions: [
                { label: 'Cancel' },
                {
                    label: 'Save', kind: 'primary', close: false, onClick: async () => {
                        const d = form.read(body);
                        if (!d.name) return _.toast('Name required', 'error');
                        try {
                            const created = await db.createBorrower({ ...d, kind: 'EXTERNAL' });
                            await audit.log('CREATE', 'borrower', created.id, null, created, 'New external borrower');
                            _.toast('Borrower added: ' + created.borrower_number);
                            _.closeModal();
                            onDone && onDone();
                        } catch (e) { _.toast(e.message, 'error'); }
                    }
                }
            ]
        });
    }
});