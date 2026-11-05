'use strict';

ELF.router.register('emergency', async (view) => {
    const { ui, money, db, audit } = ELF;
    const _ = ui;

    // 1. Load all emergency transactions
    const [contribs, assist] = await Promise.all([
        db.sb.from('transactions')
            .select('*, members(full_name, member_number)')
            .eq('txn_type', 'emergency_contribution')
            .neq('status', 'REVERSED')
            .order('txn_date', { ascending: false })
            .then(r => r.data || []),
        db.sb.from('transactions')
            .select('*, members(full_name, member_number)')
            .eq('txn_type', 'emergency_assistance')
            .neq('status', 'REVERSED')
            .order('txn_date', { ascending: false })
            .then(r => r.data || [])
    ]);

    const totalIn = contribs.reduce((a, t) => a + Number(t.amount), 0);
    const totalOut = assist.reduce((a, t) => a + Number(t.amount), 0);
    const pool = totalIn - totalOut;

    // 2. Per-member: how much they contributed + how much of assistance they helped fund
    //    Each member's share of assistance = (their total contributions / total pool contributions) × total assistance
    const memberIds = Array.from(new Set([...contribs, ...assist].map(t => t.member_id).filter(Boolean)));
    const members = memberIds.length
        ? await db.sb.from('members').select('id, full_name, member_number').in('id', memberIds).then(r => r.data || [])
        : [];
    const nameMap = {};
    members.forEach(m => nameMap[m.id] = m);

    const perMember = {};
    for (const t of contribs) {
        if (!t.member_id) continue;
        perMember[t.member_id] = perMember[t.member_id] || { contributed: 0 };
        perMember[t.member_id].contributed += Number(t.amount);
    }

    // Fair-share calculation: each member "funded" a portion of assistance in proportion to their contribution
    Object.entries(perMember).forEach(([id, v]) => {
        v.fundedAssistance = totalIn > 0 ? Math.round(v.contributed / totalIn * totalOut) : 0;
    });

    view.innerHTML = `
    ${_.pageHead('Emergency Fund', 'Pooled fund — all members contribute equally to help any member in need', `
      <button class="btn-primary" id="new-assist">+ Record Assistance</button>
    `)}

    <div class="kpi-grid mb-16">
      ${_.kpi('Total Contributions (Pool In)', money.fmt(totalIn), contribs.length + ' entries')}
      ${_.kpi('Total Assistance Paid (Pool Out)', money.fmt(totalOut), assist.length + ' entries', 'warn')}
      ${_.kpi('Current Pool Balance', money.fmt(pool), 'Available to help members', pool > 0 ? 'info' : 'danger')}
    </div>

    <div class="card mb-16" style="background:var(--brand-soft); border-color:var(--brand)">
      <div class="card-title" style="color:var(--brand)">How the pool works</div>
      <div class="card-sub" style="color:var(--text-2); margin-top:6px">
        Everyone's contributions go into one shared pool. When a member needs help, 
        <strong>the cost is split across all members in proportion to their contributions</strong>. 
        No single member is ever charged the full amount.
      </div>
      ${totalOut > 0 ? `
        <div class="mt-16" style="padding-top:12px; border-top:1px dashed var(--brand)">
          <strong>Latest split for ${money.fmt(totalOut)} assistance:</strong>
          ${Object.entries(perMember)
                .filter(([_, v]) => v.fundedAssistance > 0)
                .map(([id, v]) => {
                    const m = nameMap[id];
                    return `<div class="row between" style="padding:2px 0; font-size:13px">
                <span>${_.escapeHtml(m?.full_name || '—')}</span>
                <span>${money.fmt(v.fundedAssistance)}</span>
              </div>`;
                }).join('')}
        </div>
      ` : ''}
    </div>

    <div class="card mb-16">
      <div class="card-title">Member Contributions to the Pool</div>
      <div class="card-sub">How much each member has put into the emergency pool</div>
      <div class="mt-16">
        ${_.table([
                    {
                        label: 'Member', render: r => {
                            const m = nameMap[r.member_id];
                            return m ? `<a href="#members/${m.id}" style="font-weight:600">${_.escapeHtml(m.full_name)}</a>` : '—';
                        }
                    },
                    { label: 'Total Contributed', align: 'right', render: r => money.fmt(r.contributed) },
                    { label: 'Assistance They Funded', align: 'right', render: r => money.fmt(r.fundedAssistance || 0) }
                ], Object.entries(perMember).map(([member_id, v]) => ({ member_id, ...v })), { empty: 'No contributions yet' })}
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
                        label: 'Recipient', render: r => {
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

    _.$('#new-assist').onclick = () => assistanceModal(pool, () => ELF.router.go('emergency'));

    async function assistanceModal(currentPool, onDone) {
        const actives = await db.listMembers({ status: 'ACTIVE', pageSize: 500 }).then(r => r.rows);
        const schema = [
            {
                name: 'member_id', label: 'Who is receiving help?', type: 'select', required: true, full: true,
                options: actives.length ? actives.map(m => ({ value: m.id, label: m.full_name }))
                    : [{ value: '', label: 'No active members' }]
            },
            { name: 'amount', label: 'Amount (RWF)', type: 'number', required: true },
            { name: 'assistance_date', label: 'Date', type: 'date', required: true, default: new Date().toISOString().slice(0, 10) },
            { name: 'reason', label: 'Reason', required: true, full: true, placeholder: 'Accident, serious difficulty, etc.' },
            { name: 'notes', label: 'Notes', type: 'textarea', full: true }
        ];
        const body = document.createElement('div');
        const form = _.buildForm(schema);
        body.innerHTML = form.html + `<div id="pool-preview" class="mt-16"></div>`;

        function renderPreview() {
            const d = form.read(body);
            const amt = Number(d.amount) || 0;
            const previewEl = body.querySelector('#pool-preview');
            if (!amt) { previewEl.innerHTML = ''; return; }

            if (amt > currentPool) {
                previewEl.innerHTML = `<div class="badge overdue">Exceeds pool balance (${money.fmt(currentPool)} available)</div>`;
                return;
            }

            // Calculate per-member split
            const totalContrib = totalIn;
            const splitLines = Object.entries(perMember)
                .map(([id, v]) => {
                    const share = totalContrib > 0 ? Math.round(v.contributed / totalContrib * amt) : 0;
                    return { name: nameMap[id]?.full_name || '—', share };
                })
                .filter(x => x.share > 0)
                .sort((a, b) => b.share - a.share);

            previewEl.innerHTML = `
              <div class="preview">
                <div class="row"><span>Pool will pay</span><strong>${money.fmt(amt)}</strong></div>
                <div class="row"><span>Pool remaining after</span><strong>${money.fmt(currentPool - amt)}</strong></div>
                <div style="margin-top:8px; font-size:12px; color:var(--text-2)">
                  <strong>Each member's share of this assistance:</strong>
                  ${splitLines.map(s => `<div class="row between" style="padding:2px 0"><span>${_.escapeHtml(s.name)}</span><span>${money.fmt(s.share, false)}</span></div>`).join('')}
                </div>
              </div>`;
        }
        body.addEventListener('input', renderPreview);
        renderPreview();

        _.openModal({
            title: 'Pay Emergency Assistance from Pool',
            body,
            actions: [
                { label: 'Cancel' },
                {
                    label: 'Pay from Pool', kind: 'danger', close: false, onClick: async () => {
                        const d = form.read(body);
                        const errs = _.validateRequired(d, schema);
                        if (Object.keys(errs).length) return _.toast('Complete required fields', 'error');

                        if (Number(d.amount) > currentPool) {
                            return _.toast('Amount exceeds available pool', 'error');
                        }

                        try {
                            const rec = await db.recordEmergencyAssistance({ ...d, amount: Number(d.amount) });
                            await audit.log('CREATE', 'emergency_assistance', rec.id, null, rec, 'Assistance from pool');
                            _.toast('Assistance paid from pool');
                            _.closeModal();
                            onDone && onDone();
                        } catch (e) { _.toast(e.message, 'error'); }
                    }
                }
            ]
        });
    }
});