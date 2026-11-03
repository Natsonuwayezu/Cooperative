'use strict';

ELF.router.register('contributions', async (view) => {
  const { ui, money, db, engine, audit } = ELF;
  const _ = ui;

  const members = await db.listMembers({ status: 'ACTIVE', pageSize: 500 }).then(r => r.rows);
  const methods = [
    { value: 'airtel', label: 'Airtel' },
    { value: 'cash', label: 'Cash' }
  ];

  const monthOptions = [];
  const d = new Date();
  for (let i = 0; i < 7; i++) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const label = d.toLocaleString('default', { month: 'long', year: 'numeric' });
    monthOptions.push({ value: `${y}-${m}`, label });
    d.setMonth(d.getMonth() - 1);
  }

  view.innerHTML = `
    ${_.pageHead('Record Contribution', 'Fast entry')}
    <div class="grid-2">
      <div class="card">
        <div class="mt-16" id="c-form"></div>
        <div class="row mt-16">
          <button class="btn-primary btn-block" id="c-save">Save</button>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Split Preview</div>
        <div class="mt-16" id="c-preview"></div>
      </div>
    </div>
  `;

  const schema = [
    {
      name: 'member_id', label: 'Member', type: 'select', required: true, full: true,
      options: members.length ? members.map(m => ({ value: m.id, label: m.full_name })) : [{ value: '', label: 'No members' }]
    },
    { name: 'period_month', label: 'Month', type: 'select', required: true, options: monthOptions },
    { name: 'total', label: 'Total Received (RWF)', type: 'number', required: true },
    { name: 'include_emergency', label: 'Include 1,000 Emergency?', type: 'select', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], default: 'yes' },
    { name: 'txn_date', label: 'Date Received', type: 'date', required: true, default: new Date().toISOString().slice(0, 10) },
    { name: 'method', label: 'Method', type: 'select', options: methods }
  ];

  const form = _.buildForm(schema);
  const formEl = _.$('#c-form');
  formEl.innerHTML = form.html;
  const previewEl = _.$('#c-preview');

  function renderPreview() {
    const data = form.read(formEl);
    const total = Number(data.total || 0);
    if (!total || total <= 0) { previewEl.innerHTML = `<div class="muted">Enter amount</div>`; return; }

    const skipEmg = data.include_emergency === 'no';
    const split = engine.splitContribution(total, { skipEmergency: skipEmg });

    previewEl.innerHTML = `
      <div class="preview">
        <div class="row"><span>Total</span><strong>${money.fmt(split.total)}</strong></div>
        <div class="row"><span>Emergency</span><strong>${money.fmt(split.emergency)}</strong></div>
        <div class="row"><span>Shares (${split.shares})</span><strong>${money.fmt(split.shareValue)}</strong></div>
        <div class="row"><span>Savings</span><strong>${money.fmt(split.savingsRemainder)}</strong></div>
      </div>`;
  }

  formEl.addEventListener('input', renderPreview);
  renderPreview();

  _.$('#c-save').onclick = async () => {
    const data = form.read(formEl);
    const errs = _.validateRequired(data, schema);
    if (Object.keys(errs).length) return _.toast('Please complete fields', 'error');
    const total = Number(data.total);
    if (!total || total <= 0) return _.toast('Amount must be > 0', 'error');

    const { data: existing } = await db.sb.from('transactions')
      .select('id').eq('member_id', data.member_id).eq('txn_type', 'share_purchase').eq('period_month', data.period_month);
    if (existing && existing.length > 0) return _.toast('Already contributed for ' + data.period_month, 'error');

    const skipEmg = data.include_emergency === 'no';
    const split = engine.splitContribution(total, { skipEmergency: skipEmg });

    try {
      const txn = await db.recordContribution({
        member_id: data.member_id,
        total,
        txn_date: new Date(data.txn_date).toISOString(),
        method: data.method,
        period_month: data.period_month,
        split
      });
      await audit.log('CREATE', 'transaction', txn.id, null, txn, 'Contribution');
      _.toast('Saved');
      formEl.querySelector('[name=total]').value = '';
      renderPreview();
    } catch (e) { _.toast(e.message, 'error'); }
  };
});