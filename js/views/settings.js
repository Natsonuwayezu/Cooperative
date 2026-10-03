'use strict';

ELF.router.register('settings', async (view) => {
    const { ui, db, audit, money } = ELF;
    const _ = ui;

    const defs = [
        {
            group: 'Cooperative', items: [
                { key: 'cooperative.name', label: 'Cooperative name', type: 'text' },
                { key: 'cooperative.address', label: 'Address', type: 'text' },
                { key: 'cooperative.phone', label: 'Phone', type: 'text' },
                { key: 'cooperative.airtel', label: 'Airtel Money number', type: 'text' },
                { key: 'cooperative.currency', label: 'Currency', type: 'text' }
            ]
        },
        {
            group: 'Financial Rules', items: [
                { key: 'finance.share_price', label: 'Share price (RWF)', type: 'number', hint: 'Historical transactions keep their original price.' },
                { key: 'finance.emergency_monthly', label: 'Monthly emergency contribution (RWF)', type: 'number' },
                { key: 'finance.loan_interest_pct', label: 'Loan interest rate (% per month)', type: 'number', step: '0.001' },
                { key: 'finance.late_penalty', label: 'Late repayment penalty (RWF)', type: 'number' },
                { key: 'finance.airtel_outgoing_fee', label: 'Airtel outgoing fee (RWF)', type: 'number' },
                { key: 'finance.min_loan', label: 'Minimum loan amount (RWF)', type: 'number' }
            ]
        },
        {
            group: 'Numbering & Reporting', items: [
                { key: 'report.prefix', label: 'Transaction prefix', type: 'text' },
                { key: 'member.number_prefix', label: 'Member number prefix', type: 'text' },
                { key: 'loan.number_prefix', label: 'Loan number prefix', type: 'text' },
                { key: 'sponsor.number_prefix', label: 'Sponsor number prefix', type: 'text' },
                { key: 'borrower.number_prefix', label: 'Borrower number prefix', type: 'text' },
                { key: 'report.footer', label: 'Report footer', type: 'text' }
            ]
        },
        {
            group: 'Security', items: [
                { key: 'security.passphrase_enabled', label: 'Require passphrase', type: 'boolean' }
            ]
        }
    ];

    const versions = await db.sb.from('setting_versions').select('*')
        .order('created_at', { ascending: false }).limit(40).then(r => r.data || []);

    view.innerHTML = `
    ${_.pageHead('Settings', 'All business rules are configurable. Changes are versioned with effective date.')}

    ${defs.map(g => `
      <div class="card mb-16">
        <div class="card-title">${g.group}</div>
        <div class="grid-2 mt-16">
          ${g.items.map(it => {
        const v = ELF.settings[it.key];
        return `
              <div class="field">
                <label>${_.escapeHtml(it.label)}</label>
                ${it.type === 'boolean'
                ? `<select data-setting="${it.key}">
                       <option value="true" ${v === true ? 'selected' : ''}>Yes</option>
                       <option value="false" ${v === false ? 'selected' : ''}>No</option>
                     </select>`
                : `<input data-setting="${it.key}" type="${it.type}" ${it.step ? `step="${it.step}"` : ''} value="${_.escapeHtml(v ?? '')}">`
            }
                ${it.hint ? `<div class="hint">${_.escapeHtml(it.hint)}</div>` : ''}
              </div>`;
    }).join('')}
        </div>
      </div>
    `).join('')}

    <div class="card mb-16">
      <div class="card-title">Change Passphrase</div>
      <div class="grid-2 mt-16">
        <div class="field"><label>New passphrase</label><input id="pw-new" type="password"></div>
        <div class="field"><label>Confirm</label><input id="pw-conf" type="password"></div>
      </div>
      <div class="row mt-16"><button class="btn-primary" id="pw-save">Update Passphrase</button></div>
    </div>

    <div class="card">
      <div class="card-title">Recent Rule Changes</div>
      <div class="card-sub">Every change keeps its old value and effective date</div>
      <div class="mt-16">
        ${_.table([
        { label: 'When', render: r => new Date(r.created_at).toLocaleString() },
        { label: 'Key', render: r => `<span class="mono">${_.escapeHtml(r.key)}</span>` },
        { label: 'Old', render: r => _.escapeHtml(JSON.stringify(r.old_value)) },
        { label: 'New', render: r => _.escapeHtml(JSON.stringify(r.new_value)) },
        { label: 'Reason', render: r => _.escapeHtml(r.reason || '—') }
    ], versions, { empty: 'No changes recorded yet' })}
      </div>
    </div>
  `;

    view.querySelectorAll('[data-setting]').forEach(el => {
        el.onchange = async () => {
            const key = el.dataset.setting;
            let value;
            if (el.tagName === 'SELECT' && (el.value === 'true' || el.value === 'false')) value = el.value === 'true';
            else if (el.type === 'number') value = Number(el.value);
            else value = el.value;

            const reason = prompt(`Reason for changing ${key}? (recommended)`) || null;
            try {
                await db.saveSetting(key, value, reason);
                await audit.log('UPDATE', 'setting', key, ELF.settings[key], value, reason);
                _.toast('Setting saved');
            } catch (e) { _.toast(e.message, 'error'); }
        };
    });

    _.$('#pw-save').onclick = async () => {
        const a = _.$('#pw-new').value;
        const b = _.$('#pw-conf').value;
        if (a.length < 4) return _.toast('Too short', 'error');
        if (a !== b) return _.toast('Passwords do not match', 'error');
        const buf = new TextEncoder().encode(a);
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf))).map(x => x.toString(16).padStart(2, '0')).join('');
        await db.saveSetting('security.passphrase_hash', hash, 'Passphrase updated');
        await db.saveSetting('security.passphrase_enabled', true, 'Passphrase updated');
        await audit.log('UPDATE', 'setting', 'security.passphrase_hash', null, '***', 'Passphrase changed');
        _.toast('Passphrase updated');
    };
});