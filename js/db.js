/* ============================================================
   db.js — Supabase data access layer
   All database calls go through here. Nothing else touches .from().
   ============================================================ */
'use strict';

ELF.db = (function () {
    const sb = window.supabase.createClient(ELF.SUPABASE_URL, ELF.SUPABASE_ANON);
    ELF.sb = sb;

    // -------- generic helpers --------
    async function run(promise, label) {
        const { data, error } = await promise;
        if (error) {
            console.error('[db:' + label + ']', error);
            throw new Error(error.message || 'Database error');
        }
        return data;
    }

    // -------- settings --------
    async function loadSettings() {
        const rows = await run(sb.from('settings').select('key,value'), 'loadSettings');
        for (const r of rows) ELF.settings[r.key] = r.value;
        return ELF.settings;
    }

    async function saveSetting(key, value, reason) {
        const old = ELF.settings[key];
        await run(sb.from('settings').upsert({ key, value, updated_at: new Date().toISOString() }), 'saveSetting');
        await run(sb.from('setting_versions').insert({
            key, old_value: old ?? null, new_value: value,
            effective_date: new Date().toISOString().slice(0, 10),
            reason: reason || null
        }), 'saveSetting.version');
        ELF.settings[key] = value;
    }

    // -------- number generation --------
    async function nextNumber(prefixKey, pad = 5) {
        const prefix = ELF.settings[prefixKey] || 'ELF';
        const { data, error } = await sb.rpc('next_number', { p_prefix: prefix, p_pad: pad });
        if (error) {
            // Fallback if RPC is missing: timestamp-based
            console.warn('[db] next_number RPC missing, falling back', error);
            return prefix + '-' + Date.now().toString().slice(-8);
        }
        return data;
    }

    // -------- MEMBERS --------
    async function listMembers({ q = '', status = '', page = 1, pageSize = 25 } = {}) {
        let query = sb.from('members').select('*', { count: 'exact' }).order('created_at', { ascending: false });
        if (status) query = query.eq('status', status);
        if (q) query = query.or(`full_name.ilike.%${q}%,member_number.ilike.%${q}%,phone.ilike.%${q}%`);
        const from = (page - 1) * pageSize;
        query = query.range(from, from + pageSize - 1);
        const { data, error, count } = await query;
        if (error) throw error;
        return { rows: data, count: count || 0 };
    }

    async function getMember(id) {
        return run(sb.from('members').select('*').eq('id', id).single(), 'getMember');
    }

    async function createMember(payload) {
        const member_number = await nextNumber('member.number_prefix');
        const row = { ...payload, member_number };
        const data = await run(sb.from('members').insert(row).select().single(), 'createMember');
        await run(sb.from('member_participation_periods').insert({
            member_id: data.id,
            start_date: row.registration_date || new Date().toISOString().slice(0, 10),
            reason_start: 'Initial registration'
        }), 'createMember.period');
        return data;
    }

    async function updateMember(id, patch) {
        return run(sb.from('members').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select().single(), 'updateMember');
    }

    async function listParticipationPeriods(memberId) {
        return run(sb.from('member_participation_periods')
            .select('*').eq('member_id', memberId).order('start_date', { ascending: true }), 'listPeriods');
    }

    async function deactivateMember(id, reason, snapshot) {
        const now = new Date().toISOString().slice(0, 10);
        // 1. Check outstanding loans
        const loans = await run(sb.from('loans').select('id').eq('member_id', id).eq('status', 'ACTIVE'), 'checkLoans');
        if (loans.length) throw new Error('Member has an active loan and cannot be deactivated.');
        // 2. Close current participation period
        const open = await run(sb.from('member_participation_periods')
            .select('*').eq('member_id', id).is('end_date', null).order('start_date', { ascending: false }).limit(1), 'openPeriod');
        if (open && open.length) {
            await run(sb.from('member_participation_periods').update({
                end_date: now, reason_end: reason || 'Deactivated', snapshot
            }).eq('id', open[0].id), 'closePeriod');
        }
        // 3. Mark member
        await run(sb.from('members').update({ status: 'DEACTIVATED', updated_at: new Date().toISOString() }).eq('id', id), 'deactivateMember');
        return { deactivatedAt: now };
    }

    async function reactivateMember(id, reason) {
        const now = new Date().toISOString().slice(0, 10);
        await run(sb.from('member_participation_periods').insert({
            member_id: id, start_date: now, reason_start: reason || 'Reactivated'
        }), 'reactivatePeriod');
        await run(sb.from('members').update({ status: 'ACTIVE', updated_at: new Date().toISOString() }).eq('id', id), 'reactivateMember');
        return { reactivatedAt: now };
    }

    // -------- TRANSACTIONS --------
    async function createTransaction(payload) {
        const txn_number = await nextNumber('loan.number_prefix'); // fallback; overridden below
        const prefix = ELF.settings['report.prefix'] || 'ELF';
        const gen = await nextNumber('report.prefix');
        const row = { ...payload, txn_number: gen };
        return run(sb.from('transactions').insert(row).select().single(), 'createTransaction');
    }

    async function listTransactions({ q = '', type = '', from, to, memberId, page = 1, pageSize = 40 } = {}) {
        let query = sb.from('transactions').select('*', { count: 'exact' }).order('txn_date', { ascending: false });
        if (type) query = query.eq('txn_type', type);
        if (memberId) query = query.eq('member_id', memberId);
        if (from) query = query.gte('txn_date', from);
        if (to) query = query.lte('txn_date', to);
        if (q) query = query.or(`txn_number.ilike.%${q}%,description.ilike.%${q}%,reference.ilike.%${q}%`);
        const start = (page - 1) * pageSize;
        query = query.range(start, start + pageSize - 1);
        const { data, error, count } = await query;
        if (error) throw error;
        return { rows: data, count: count || 0 };
    }

    async function getMemberTransactions(memberId) {
        return run(sb.from('transactions').select('*').eq('member_id', memberId).order('txn_date', { ascending: true }), 'memberTxns');
    }

    async function reverseTransaction(id, reason) {
        const orig = await run(sb.from('transactions').select('*').eq('id', id).single(), 'getOrig');
        await run(sb.from('transactions').update({ status: 'REVERSED', updated_at: new Date().toISOString() }).eq('id', id), 'markReversed');
        const gen = await nextNumber('report.prefix');
        return run(sb.from('transactions').insert({
            txn_number: gen, txn_type: 'reversal',
            amount: orig.amount, account_id: orig.account_id,
            member_id: orig.member_id, loan_id: orig.loan_id,
            reference: orig.txn_number,
            description: 'Reversal of ' + orig.txn_number + (reason ? ' — ' + reason : ''),
            reversal_of: orig.id, status: 'POSTED',
            metadata: { reverseOf: orig.txn_number, reason: reason || null }
        }).select().single(), 'insertReversal');
    }

    // -------- CONTRIBUTION (atomic-ish: transaction + period mark) --------
    async function recordContribution({ member_id, total, txn_date, method, reference, notes, split }) {
        const account = await getAccountByCode(methodToAccount(method));
        const txn = await createTransaction({
            txn_date: txn_date || new Date().toISOString(),
            txn_type: 'member_contribution',
            category: method || 'cash',
            amount: total,
            account_id: account ? account.id : null,
            member_id,
            reference: reference || null,
            description: `Contribution: ${split.shares} share(s) + emergency ${split.emergency}`,
            notes: notes || null,
            status: 'POSTED',
            metadata: {
                shares: split.shares,
                shareValue: split.shareValue,
                emergency: split.emergency,
                savingsRemainder: split.savingsRemainder,
                sharePrice: split.sharePrice,
                emergencyDue: split.emergencyDue,
                method: method || 'cash'
            }
        });

        // Split as separate ledger rows for clean reporting
        if (split.emergency > 0) {
            const gen2 = await nextNumber('report.prefix');
            await run(sb.from('transactions').insert({
                txn_number: gen2, txn_type: 'emergency_contribution',
                amount: split.emergency, account_id: account?.id || null,
                member_id, reference: txn.txn_number,
                description: 'Monthly emergency contribution'
            }), 'emergencyRow');
        }
        if (split.shareValue > 0) {
            const gen3 = await nextNumber('report.prefix');
            await run(sb.from('transactions').insert({
                txn_number: gen3, txn_type: 'share_purchase',
                amount: split.shareValue, account_id: account?.id || null,
                member_id, reference: txn.txn_number,
                description: `Share purchase: ${split.shares} × ${split.sharePrice}`,
                metadata: { shares: split.shares, sharePrice: split.sharePrice }
            }), 'shareRow');
        }
        return txn;
    }

    // -------- ACCOUNTS --------
    async function listAccounts() {
        return run(sb.from('financial_accounts').select('*').eq('active', true), 'listAccounts');
    }
    async function getAccountByCode(code) {
        const rows = await run(sb.from('financial_accounts').select('*').eq('code', code).limit(1), 'getAccount');
        return rows[0] || null;
    }
    function methodToAccount(method) {
        if (!method) return 'CASH';
        const m = String(method).toLowerCase();
        if (m.includes('airtel')) return 'AIRTEL';
        if (m.includes('bank')) return 'BANK';
        return 'CASH';
    }

    // -------- LOOKUPS --------
    async function listSponsors() {
        return run(sb.from('sponsors').select('*').order('created_at', { ascending: false }), 'listSponsors');
    }
    async function listBorrowers() {
        return run(sb.from('borrowers').select('*').order('created_at', { ascending: false }), 'listBorrowers');
    }
    async function listLoans({ status, page = 1, pageSize = 30 } = {}) {
        let query = sb.from('loans').select('*', { count: 'exact' }).order('issue_date', { ascending: false });
        if (status) query = query.eq('status', status);
        const s = (page - 1) * pageSize;
        query = query.range(s, s + pageSize - 1);
        const { data, error, count } = await query;
        if (error) throw error;
        return { rows: data, count: count || 0 };
    }

    // -------- LOANS --------
    async function createLoan(payload) {
        const loan_number = await nextNumber('loan.number_prefix');
        const row = { ...payload, loan_number };
        const data = await run(sb.from('loans').insert(row).select().single(), 'createLoan');
        // Disbursement transaction
        const account = await getAccountByCode(methodToAccount(payload.disbursement_method || 'cash'));
        const gen = await nextNumber('report.prefix');
        await run(sb.from('transactions').insert({
            txn_number: gen, txn_type: 'loan_disbursement',
            amount: data.principal, account_id: account?.id || null,
            loan_id: data.id, member_id: data.member_id, borrower_id: data.borrower_id,
            sponsor_id: data.sponsor_id,
            reference: data.loan_number,
            description: `Loan disbursement ${data.loan_number}`,
            metadata: { method: payload.disbursement_method || 'cash' }
        }), 'loanDisbursementTxn');

        // Airtel outgoing fee (auto)
        if ((payload.disbursement_method || '').toLowerCase().includes('airtel')) {
            const fee = ELF.engine.airtelOutgoingFee();
            if (fee > 0) {
                const gen2 = await nextNumber('report.prefix');
                await run(sb.from('transactions').insert({
                    txn_number: gen2, txn_type: 'airtel_fee',
                    amount: fee, account_id: account?.id || null,
                    loan_id: data.id, member_id: data.member_id, borrower_id: data.borrower_id,
                    reference: data.loan_number,
                    description: 'Airtel outgoing fee (loan disbursement)',
                    category: 'airtel_fee'
                }), 'airtelFee');
            }
        }
        return data;
    }

    async function getLoan(id) {
        return run(sb.from('loans').select('*').eq('id', id).single(), 'getLoan');
    }

    async function updateLoanStatus(id, status) {
        return run(sb.from('loans').update({ status, updated_at: new Date().toISOString() }).eq('id', id).select().single(), 'updateLoanStatus');
    }

    async function listLoanInterest(loanId) {
        return run(sb.from('loan_interest_entries').select('*').eq('loan_id', loanId).order('charge_date', { ascending: true }), 'listInterest');
    }
    async function listLoanPenalties(loanId) {
        return run(sb.from('loan_penalties').select('*').eq('loan_id', loanId).order('penalty_date', { ascending: true }), 'listPenalties');
    }
    async function listLoanRepayments(loanId) {
        return run(sb.from('loan_repayments').select('*').eq('loan_id', loanId).order('payment_date', { ascending: true }), 'listRepayments');
    }

    async function chargeInterest({ loan_id, charge_date, rate_pct, base_amount, interest_amount, period_from, period_to, notes }) {
        const row = { loan_id, charge_date, rate_pct, base_amount, interest_amount, period_from, period_to, notes };
        const data = await run(sb.from('loan_interest_entries').insert(row).select().single(), 'chargeInterest');
        // Record as income transaction
        const gen = await nextNumber('report.prefix');
        await run(sb.from('transactions').insert({
            txn_number: gen, txn_type: 'loan_interest',
            amount: interest_amount, loan_id,
            reference: null,
            description: `Interest charged (${rate_pct}% on ${base_amount})`,
            category: 'loan_interest'
        }), 'interestIncomeTxn');
        return data;
    }

    async function chargePenalty({ loan_id, penalty_date, amount, reason }) {
        const row = { loan_id, penalty_date, amount, reason };
        const data = await run(sb.from('loan_penalties').insert(row).select().single(), 'chargePenalty');
        const gen = await nextNumber('report.prefix');
        await run(sb.from('transactions').insert({
            txn_number: gen, txn_type: 'loan_penalty',
            amount, loan_id,
            description: 'Late repayment penalty',
            category: 'loan_penalty'
        }), 'penaltyIncomeTxn');
        return data;
    }

    async function recordRepayment({ loan_id, member_id, borrower_id, sponsor_id, total_received, payment_date, method, split, notes }) {
        const account = await getAccountByCode(methodToAccount(method));
        const gen = await nextNumber('report.prefix');
        const txn = await run(sb.from('transactions').insert({
            txn_number: gen, txn_type: 'loan_repayment',
            amount: total_received, account_id: account?.id || null,
            loan_id, member_id, borrower_id, sponsor_id,
            reference: null,
            description: 'Loan repayment',
            notes: notes || null,
            metadata: { method: method || 'cash', split }
        }).select().single(), 'repaymentTxn');

        const repayment = await run(sb.from('loan_repayments').insert({
            loan_id, txn_id: txn.id, payment_date,
            total_received,
            emergency_portion: split.emergency || 0,
            interest_portion: split.interest || 0,
            penalty_portion: split.penalty || 0,
            principal_portion: split.principal || 0,
            savings_portion: split.savings || 0,
            unapplied_portion: split.unapplied || 0,
            notes: notes || null
        }).select().single(), 'repaymentRow');

        // Emergency portion recorded separately so emergency ledger stays clean
        if ((split.emergency || 0) > 0 && member_id) {
            const gen2 = await nextNumber('report.prefix');
            await run(sb.from('transactions').insert({
                txn_number: gen2, txn_type: 'emergency_contribution',
                amount: split.emergency, account_id: account?.id || null,
                member_id, reference: txn.txn_number,
                description: 'Monthly emergency contribution (via repayment)'
            }), 'emergencyViaRepay');
        }

        // Savings portion -> share purchase
        if ((split.savings || 0) > 0 && member_id) {
            const sharePrice = Number(ELF.settings['finance.share_price']) || 5000;
            const shares = Math.floor(split.savings / sharePrice);
            const gen3 = await nextNumber('report.prefix');
            await run(sb.from('transactions').insert({
                txn_number: gen3, txn_type: 'share_purchase',
                amount: shares * sharePrice, account_id: account?.id || null,
                member_id, reference: txn.txn_number,
                description: `Share purchase via repayment (${shares} share(s))`,
                metadata: { shares, sharePrice }
            }), 'shareViaRepay');
        }

        return { txn, repayment };
    }

    // -------- SPONSORS --------
    async function createSponsor(payload) {
        const sponsor_number = await nextNumber('sponsor.number_prefix');
        const row = { ...payload, sponsor_number };
        return run(sb.from('sponsors').insert(row).select().single(), 'createSponsor');
    }
    async function updateSponsor(id, patch) {
        return run(sb.from('sponsors').update(patch).eq('id', id).select().single(), 'updateSponsor');
    }
    async function recordSponsorIncome({ sponsor_id, amount, txn_date, method, reference, description, notes }) {
        const account = await getAccountByCode(methodToAccount(method));
        const gen = await nextNumber('report.prefix');
        return run(sb.from('transactions').insert({
            txn_number: gen, txn_type: 'sponsor_income',
            amount, account_id: account?.id || null,
            sponsor_id, reference: reference || null,
            description: description || 'Sponsor contribution',
            notes: notes || null,
            metadata: { method: method || 'cash' }
        }).select().single(), 'sponsorIncome');
    }

    // -------- BORROWERS (external) --------
    async function createBorrower(payload) {
        const borrower_number = await nextNumber('borrower.number_prefix');
        const row = { ...payload, borrower_number };
        return run(sb.from('borrowers').insert(row).select().single(), 'createBorrower');
    }
    async function updateBorrower(id, patch) {
        return run(sb.from('borrowers').update(patch).eq('id', id).select().single(), 'updateBorrower');
    }

    // -------- EMERGENCY ASSISTANCE --------
    async function recordEmergencyAssistance({ member_id, amount, assistance_date, reason, notes }) {
        const acc = await getAccountByCode('AIRTEL');
        const gen = await nextNumber('report.prefix');
        const txn = await run(sb.from('transactions').insert({
            txn_number: gen, txn_type: 'emergency_assistance',
            amount, account_id: acc?.id || null,
            member_id, description: 'Emergency assistance: ' + reason,
            notes: notes || null
        }).select().single(), 'emergencyAssistanceTxn');

        return run(sb.from('emergency_assistance').insert({
            member_id, amount, assistance_date, reason, notes, txn_id: txn.id
        }).select().single(), 'emergencyAssistanceRow');
    }

    // -------- OTHER INCOME / EXPENSE --------
    async function recordIncome({ amount, txn_date, category, method, reference, description, notes }) {
        const account = await getAccountByCode(methodToAccount(method));
        const gen = await nextNumber('report.prefix');
        return run(sb.from('transactions').insert({
            txn_number: gen, txn_type: category === 'sponsor_income' ? 'sponsor_income' : 'other_income',
            category: category || 'other_income',
            amount, account_id: account?.id || null,
            reference: reference || null,
            description: description || 'Income',
            notes: notes || null,
            metadata: { method: method || 'cash' }
        }).select().single(), 'recordIncome');
    }

    async function recordExpense({ amount, txn_date, category, method, reference, description, notes }) {
        const account = await getAccountByCode(methodToAccount(method));
        const gen = await nextNumber('report.prefix');
        return run(sb.from('transactions').insert({
            txn_number: gen, txn_type: 'expense',
            category: category || 'other_expense',
            amount, account_id: account?.id || null,
            reference: reference || null,
            description: description || 'Expense',
            notes: notes || null,
            metadata: { method: method || 'cash' }
        }).select().single(), 'recordExpense');
    }

    // -------- PROFIT PERIODS --------
    async function listProfitPeriods() {
        return run(sb.from('profit_periods').select('*').order('period_start', { ascending: false }), 'listProfitPeriods');
    }

    async function getProfitPeriod(id) {
        return run(sb.from('profit_periods').select('*').eq('id', id).single(), 'getProfitPeriod');
    }

    async function createProfitPeriod({ period_start, period_end, notes }) {
        const period_number = await nextNumber('report.prefix');
        return run(sb.from('profit_periods').insert({
            period_number, period_start, period_end, status: 'OPEN', notes: notes || null
        }).select().single(), 'createProfitPeriod');
    }

    /**
     * Compute totals for a period from the ledger.
     * Emergency contributions are NEVER income.
     */
    async function computePeriodTotals(periodStart, periodEnd) {
        const { data, error } = await sb.from('transactions')
            .select('txn_type,amount,status')
            .gte('txn_date', periodStart)
            .lte('txn_date', periodEnd + 'T23:59:59');
        if (error) throw error;
        const incomeTypes = new Set(['loan_interest', 'loan_penalty', 'sponsor_income', 'other_income']);
        const expenseTypes = new Set(['expense', 'airtel_fee']);
        let income = 0, expense = 0;
        for (const t of (data || [])) {
            if (t.status === 'REVERSED') continue;
            const amt = Number(t.amount) || 0;
            if (incomeTypes.has(t.txn_type)) income += amt;
            else if (expenseTypes.has(t.txn_type)) expense += amt;
            // emergency_contribution intentionally excluded
        }
        return { income, expense, distributable: Math.max(0, income - expense) };
    }

    /**
     * Build the eligible-member list for a profit period:
     *   - Member had at least one active participation period overlapping [start,end]
     *   - eligible_shares = shares purchased with txn_date <= period_end
     */
    async function buildEligibleMembers(periodStart, periodEnd) {
        // 1. All members
        const { data: members } = await sb.from('members').select('id,member_number,full_name');
        // 2. All participation periods
        const { data: periods } = await sb.from('member_participation_periods').select('*');
        // 3. All share purchases up to period end
        const { data: shares } = await sb.from('transactions')
            .select('member_id,metadata,txn_date,txn_type,status')
            .in('txn_type', ['share_purchase', 'member_contribution'])
            .lte('txn_date', periodEnd + 'T23:59:59');

        const ps = new Date(periodStart).getTime();
        const pe = new Date(periodEnd + 'T23:59:59').getTime();

        const eligibleMap = new Map(); // member_id -> eligible_shares
        for (const p of (periods || [])) {
            const s = new Date(p.start_date).getTime();
            const e = p.end_date ? new Date(p.end_date).getTime() : 9e15;
            if (s <= pe && e >= ps) {
                if (!eligibleMap.has(p.member_id)) eligibleMap.set(p.member_id, 0);
            }
        }
        for (const t of (shares || [])) {
            if (t.status === 'REVERSED') continue;
            if (!eligibleMap.has(t.member_id)) continue;
            const meta = t.metadata || {};
            const sh = Number(meta.shares || 0);
            if (sh > 0) eligibleMap.set(t.member_id, eligibleMap.get(t.member_id) + sh);
        }

        const eligible = [];
        for (const [member_id, eligible_shares] of eligibleMap.entries()) {
            if (eligible_shares <= 0) continue; // no shares => no allocation
            const m = members.find(x => x.id === member_id);
            eligible.push({
                member_id,
                member_number: m?.member_number || '',
                full_name: m?.full_name || '',
                eligible_shares
            });
        }
        return eligible;
    }

    async function saveProfitCalculation(periodId, { total_income, total_expenses, distributable_profit, eligible_member_count, total_eligible_shares, snapshot }) {
        return run(sb.from('profit_periods').update({
            total_income, total_expenses, distributable_profit,
            eligible_member_count, total_eligible_shares,
            status: 'CALCULATED',
            snapshot
        }).eq('id', periodId).select().single(), 'saveProfitCalculation');
    }

    async function finalizeProfitPeriod(periodId, allocations, totalAllocated, roundingDifference) {
        // Delete previous allocations for this period (if recalculating)
        await sb.from('profit_allocations').delete().eq('profit_period_id', periodId);
        // Insert allocations
        if (allocations.length) {
            const rows = allocations.map(a => ({
                profit_period_id: periodId,
                member_id: a.member_id,
                eligible_shares: a.eligible_shares,
                ownership_pct: a.ownership_pct,
                allocated_profit: a.allocated_profit,
                rounding_adjustment: a.rounding_adjustment || 0,
                status: 'ALLOCATED'
            }));
            const { error } = await sb.from('profit_allocations').insert(rows);
            if (error) throw error;
        }
        // Mark finalized
        const { data, error } = await sb.from('profit_periods').update({
            status: 'FINALIZED',
            total_allocated: totalAllocated,
            rounding_difference: roundingDifference,
            finalized_at: new Date().toISOString()
        }).eq('id', periodId).select().single();
        if (error) throw error;
        return data;
    }

    async function listProfitAllocations(periodId) {
        return run(sb.from('profit_allocations').select('*').eq('profit_period_id', periodId).order('allocated_profit', { ascending: false }), 'listProfitAllocations');
    }

    async function reopenProfitPeriod(periodId) {
        // Only allow from CALCULATED. FINALIZED should be reversed via adjustment (see prompt §8).
        return run(sb.from('profit_periods').update({ status: 'CALCULATED', finalized_at: null }).eq('id', periodId).select().single(), 'reopen');
    }

    return {
        sb, run,
        loadSettings, saveSetting,
        nextNumber,
        listMembers, getMember, createMember, updateMember,
        listParticipationPeriods, deactivateMember, reactivateMember,
        createTransaction, listTransactions, getMemberTransactions, reverseTransaction,
        recordContribution,
        listAccounts, getAccountByCode, methodToAccount,
        listSponsors, listBorrowers, listLoans,
        // loans
        createLoan, getLoan, updateLoanStatus,
        listLoanInterest, listLoanPenalties, listLoanRepayments,
        chargeInterest, chargePenalty, recordRepayment,
        // sponsors / borrowers
        createSponsor, updateSponsor, recordSponsorIncome,
        createBorrower, updateBorrower,
        // emergency assistance
        recordEmergencyAssistance,
        // profit periods
        listProfitPeriods, getProfitPeriod, createProfitPeriod,
        computePeriodTotals, buildEligibleMembers,
        saveProfitCalculation, finalizeProfitPeriod, listProfitAllocations, reopenProfitPeriod,
        // income / expense
        recordIncome, recordExpense
    };
})();