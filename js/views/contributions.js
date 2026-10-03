'use strict';

ELF.router.register('contributions', async (view) => {
    const { ui, money, db, engine, audit } = ELF;
    const _ = ui;

    const members = await db.listMembers({ status: 'ACTIVE', pageSize: 500 }).then(r => r.rows);
    const methods = [
        { value: 'airtel', label: 'Airtel Money' },
        { value: 'cash', label: 'Cash' },
        { value: 'bank', label: 'Bank Transfer' }
    ];

    view.innerHTML = `
    ${_.pageHead('Record Contribution', 'Enter total received — the system splits it automatically')}

    <div class="grid-2">
      <div class="card">
        <div class="card-title">New Contribution</div>
        <div class="card-sub">Total received will be split into emergency + shares/savings</div>
        <div class="mt-16" id="c-form"></div>
        <div class="row mt-16">
          <button class="btn-primary btn-block" id="c-save">Save Contribution</button>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Split Preview</div>
        <div class="card-sub">Live calculation — reflects configured rules</div>
        <div class="mt-16" id="c-preview"></div>
        <div class="mt-16">
          <div class="field">
            <label>Latest contributions</label>
            <div id="c-recent"></div>
          </div>
        </div>
      </div>
    </div>
  `;

    const schema = [
        {
            name: 'member_id', label: 'Member', type: 'select', required: true, full: true,
            options: members.length ? members.map(m => ({ value: m.id, label: `${m.member_number} — ${m.full_name}` }))
                : [{ value: '', label: 'No active members yet' }]
        },
        { name: 'total', label: 'Total Amount Received (RWF)', type: 'number', required: true, placeholder: 'e.g. 6000' },
        { name: 'txn_date', label: 'Date', type: 'date', required: true, default: new Date().toISOString().slice(0, 10) },
        { name: 'method', label: 'Payment Method', type: 'select', options: methods },
        { name: 'reference', label: 'Reference (optional)' },
        { name: 'notes', label: 'Notes', type: 'textarea', full: true }
    ];
    const form = _.buildForm(schema);
    const formEl = _.$('#c-form');
    formEl.innerHTML = form.html;

    const previewEl = _.$('#c-preview');

    function renderPreview() {
        const data = form.read(formEl);
        const total = Number(data.total || 0);
        if (!total || total <= 0) {
            previewEl.innerHTML = `<div class="muted">Enter an amount to see the split</div>`;
            return null;
        }
        const split = engine.splitContribution(total);
        previewEl.innerHTML = `
      <div class="preview">
        <div class="row"><span>Total received</span><strong>${money.fmt(split.total)}</strong></div>
        <div class="row"><span>Emergency contribution</span><strong>${money.fmt(split.emergency)}</strong></div>
        <div class="row"><span>Share purchase (${split.shares} × ${money.fmt(split.sharePrice, false)})</span><strong>${money.fmt(split.shareValue)}</strong></div>
        <div class="row"><span>Savings remainder</span><strong>${money.fmt(split.savingsRemainder)}</strong></div>
      </div>`;
        return split;
    }

    formEl.addEventListener('input', renderPreview);
    renderPreview();

    async function loadRecent() {
        const { rows } = await db.listTransactions({ type: 'member_contribution', pageSize: 5 });
        _.$('#c-recent').innerHTML = _.table([
            { label: 'Date', render: r => new Date(r.txn_date).toLocaleDateString() },
            { label: 'Amount', align: 'right', render: r => money.fmt(r.amount) }
        ], rows, { empty: 'No contributions yet' });
    }
    loadRecent();

    _.$('#c-save').onclick = async () => {
        const data = form.read(formEl);
        const errs = _.validateRequired(data, schema);
        if (Object.keys(errs).length) return _.toast('Please complete required fields', 'error');
        const total = Number(data.total);
        if (!total || total <= 0) return _.toast('Amount must be greater than 0', 'error');

        const split = engine.splitContribution(total);
        try {
            const txn = await db.recordContribution({
                member_id: data.member_id,
                total,
                txn_date: new Date(data.txn_date).toISOString(),
                method: data.method,
                reference: data.reference,
                notes: data.notes,
                split
            });
            await audit.log('CREATE', 'transaction', txn.id, null, txn, 'Recorded contribution');
            _.toast('Contribution saved — ' + txn.txn_number, 'success');
            // reset amount and notes
            formEl.querySelector('[name=total]').value = '';
            formEl.querySelector('[name=notes]').value = '';
            renderPreview();
            loadRecent();
        } catch (e) {
            _.toast(e.message, 'error');
        }
    };
});