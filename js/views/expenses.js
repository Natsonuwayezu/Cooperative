'use strict';

ELF.router.register('expenses', async (view) => {
    const { ui, money, db, audit } = ELF;
    const _ = ui;

    const [recent, categories] = await Promise.all([
        db.sb.from('transactions').select('*')
            .in('txn_type', ['expense', 'airtel_fee'])
            .order('txn_date', { ascending: false }).limit(50).then(r => r.data || []),
        db.sb.from('categories').select('*').eq('kind', 'expense').then(r => r.data || [])
    ]);

    const total = recent.reduce((a, t) => a + Number(t.amount), 0);

    view.innerHTML = `
    ${_.pageHead('Expenses', 'Operational, Airtel, and emergency assistance expenses')}

    <div class="grid-2">
      <div class="card">
        <div class="card-title">Record Expense</div>
        <div class="card-sub">Emergency assistance is entered from the Emergency Fund screen</div>
        <div class="mt-16" id="exp-form"></div>
        <div class="row mt-16">
          <button class="btn-danger btn-block" id="exp-save">Save Expense</button>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Summary</div>
        <div class="mt-16">
          ${_.kpi('Total Recorded Expense', money.fmt(total), recent.length + ' entr(ies)', 'warn')}
        </div>
        <div class="mt-16">
          <div class="muted" style="margin-bottom:8px">Categories</div>
          ${categories.map(c => _.badge(c.label, 'warn')).join(' ')}
        </div>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-title">Recent Expenses</div>
      <div class="mt-16">
        ${_.table([
        { label: 'Date', render: r => new Date(r.txn_date).toLocaleDateString() },
        { label: 'Number', render: r => `<span class="mono">${_.escapeHtml(r.txn_number)}</span>` },
        { label: 'Type', render: r => _.badge(r.txn_type.replace(/_/g, ' '), 'warn') },
        { label: 'Description', render: r => _.escapeHtml(r.description || '—') },
        { label: 'Amount', align: 'right', render: r => money.fmt(r.amount) }
    ], recent, { empty: 'No expenses recorded' })}
      </div>
    </div>
  `;

    const schema = [
        {
            name: 'category', label: 'Category', type: 'select', required: true, full: true,
            options: categories.length ? categories.map(c => ({ value: c.code, label: c.label }))
                : [{ value: 'other_expense', label: 'Other Expense' }]
        },
        { name: 'amount', label: 'Amount (RWF)', type: 'number', required: true },
        { name: 'txn_date', label: 'Date', type: 'date', required: true, default: new Date().toISOString().slice(0, 10) },
        {
            name: 'method', label: 'Paid via', type: 'select', options: [
                { value: 'airtel', label: 'Airtel Money' },
                { value: 'cash', label: 'Cash' },
                { value: 'bank', label: 'Bank Transfer' }
            ]
        },
        { name: 'reference', label: 'Reference' },
        { name: 'description', label: 'Description', full: true },
        { name: 'notes', label: 'Notes', type: 'textarea', full: true }
    ];
    const form = _.buildForm(schema);
    _.$('#exp-form').innerHTML = form.html;

    _.$('#exp-save').onclick = async () => {
        const d = form.read(_.$('#exp-form'));
        const errs = _.validateRequired(d, schema);
        if (Object.keys(errs).length) return _.toast('Please complete required fields', 'error');
        if (!d.amount || Number(d.amount) <= 0) return _.toast('Amount must be > 0', 'error');
        try {
            const txn = await db.recordExpense({ ...d, amount: Number(d.amount) });
            await audit.log('CREATE', 'transaction', txn.id, null, txn, 'Expense recorded');
            _.toast('Expense saved: ' + txn.txn_number);
            ELF.router.go('expenses');
        } catch (e) { _.toast(e.message, 'error'); }
    };
});