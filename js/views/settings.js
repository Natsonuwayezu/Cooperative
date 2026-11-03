'use strict';

ELF.router.register('settings', async (view) => {
    const { ui, db, audit } = ELF;
    const _ = ui;

    const defs = [
        {
            group: 'Cooperative', items: [
                { key: 'cooperative.name', label: 'Cooperative Name', type: 'text' },
                { key: 'cooperative.address', label: 'Address', type: 'text' },
                { key: 'cooperative.airtel', label: 'Airtel Money Number', type: 'text' },
                { key: 'cooperative.currency', label: 'Currency', type: 'text' }
            ]
        },
        {
            group: 'Financial Rules', items: [
                { key: 'finance.share_price', label: 'Share Price (RWF)', type: 'number' },
                { key: 'finance.emergency_monthly', label: 'Monthly Emergency (RWF)', type: 'number' },
                { key: 'finance.loan_interest_pct', label: 'Loan Interest (%/month)', type: 'number', step: '0.001' },
                { key: 'finance.late_penalty', label: 'Late Penalty (RWF)', type: 'number' },
                { key: 'finance.airtel_outgoing_fee', label: 'Airtel Fee (RWF)', type: 'number' }
            ]
        },
        {
            group: 'Security', items: [
                { key: 'security.passphrase_enabled', label: 'Require Passphrase', type: 'boolean' }
            ]
        }
    ];

    view.innerHTML = `
    ${_.pageHead('Settings', 'Configurable business rules')}
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
              </div>`;
    }).join('')}
        </div>
      </div>
    `).join('')}
  `;

    view.querySelectorAll('[data-setting]').forEach(el => {
        el.onchange = async () => {
            const key = el.dataset.setting;
            let value;
            if (el.tagName === 'SELECT' && (el.value === 'true' || el.value === 'false')) value = el.value === 'true';
            else if (el.type === 'number') value = Number(el.value);
            else value = el.value;

            try {
                await db.saveSetting(key, value);
                await audit.log('UPDATE', 'setting', key, ELF.settings[key], value, 'Setting changed');
                _.toast('Setting saved');
            } catch (e) { _.toast(e.message, 'error'); }
        };
    });
});