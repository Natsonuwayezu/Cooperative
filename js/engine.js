/* ============================================================
   engine.js — Financial calculation core (PURE, no DB, no DOM)
   Every rule the cooperative cares about lives here.
   ============================================================ */
'use strict';

ELF.engine = (function () {
    const M = () => ELF.money;

    /* ------------------------------------------------------------
       1. CONTRIBUTION SPLIT
       Given a total received, split into emergency + share/savings.
       Rule (per master prompt §3):
         - emergency is fixed monthly (usually 1,000)
         - remainder goes to shares; leftover < share price stays as savings
       Example: 6,000 -> emergency 1,000, share 5,000, shares 1, leftover 0
                16,000 -> emergency 1,000, share 15,000, shares 3, leftover 0
                21,000 -> emergency 1,000, share 20,000, shares 4, leftover 0
                7,500  -> emergency 1,000, share 6,500, shares 1, leftover 1,500
       ------------------------------------------------------------ */
    function splitContribution(totalReceived, opts = {}) {
        totalReceived = Math.round(Number(totalReceived) || 0);
        const emergencyDue = opts.emergencyDue !== undefined
            ? Math.round(opts.emergencyDue)
            : Math.round(ELF.settings['finance.emergency_monthly'] || 1000);
        const sharePrice = opts.sharePrice !== undefined
            ? Math.round(opts.sharePrice)
            : Math.round(ELF.settings['finance.share_price'] || 5000);

        if (totalReceived < 0) throw new Error('Amount cannot be negative');
        if (sharePrice <= 0) throw new Error('Share price must be > 0');

        // Emergency is capped at amount received
        const emergency = Math.min(emergencyDue, totalReceived);
        let remaining = totalReceived - emergency;

        // Allow caller to skip emergency (e.g. pure savings top-up after already paid)
        if (opts.skipEmergency) {
            remaining = totalReceived;
        }

        const [shares, remainder] = M().divmod(remaining, sharePrice);
        const shareValue = shares * sharePrice;

        return {
            total: totalReceived,
            emergency: opts.skipEmergency ? 0 : emergency,
            shares: shares,
            shareValue: shareValue,
            savingsRemainder: remainder,     // < sharePrice, still member's money
            sharePrice: sharePrice,
            emergencyDue: emergencyDue,
            skippedEmergency: !!opts.skipEmergency
        };
    }

    /* ------------------------------------------------------------
       2. LOAN INTEREST
       Monthly simple interest on current outstanding balance.
       Rule (per master prompt §12): interest charged per full month
       the money remains outstanding. Pro-rated for partial months
       at the cooperative's discretion — we round to nearest RWF.
       ------------------------------------------------------------ */
    function calcMonthlyInterest(principal, ratePct, months) {
        principal = Math.round(principal || 0);
        ratePct = Number(ratePct || 0);
        months = Number(months || 0);
        if (principal <= 0 || ratePct <= 0 || months <= 0) return 0;
        return M().pct(principal, ratePct * months);
    }

    /** Full months between two dates (floor). Optional day-of-month carry. */
    function fullMonthsBetween(fromDate, toDate) {
        const a = new Date(fromDate);
        const b = new Date(toDate);
        if (isNaN(a) || isNaN(b) || b < a) return 0;
        let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
        if (b.getDate() < a.getDate()) months -= 1;
        return Math.max(0, months);
    }

    /* ------------------------------------------------------------
       3. LOAN PAYMENT ALLOCATION
       Splits a repayment across emergency / interest / penalty /
       principal / savings according to configured order.
       Anything left after all buckets filled = unapplied.
       ------------------------------------------------------------ */
    function allocateRepayment(totalReceived, buckets, order) {
        totalReceived = Math.round(totalReceived || 0);
        if (totalReceived < 0) throw new Error('Amount cannot be negative');

        const ord = order || ELF.settings['finance.allocation_order']
            || ['emergency', 'interest', 'penalty', 'principal', 'savings'];

        const out = {
            emergency: 0, interest: 0, penalty: 0,
            principal: 0, savings: 0, unapplied: 0
        };
        let left = totalReceived;

        for (const key of ord) {
            const owed = Math.max(0, Math.round(buckets[key] || 0));
            if (owed <= 0) continue;
            const pay = Math.min(left, owed);
            out[key] = pay;
            left -= pay;
            if (left <= 0) break;
        }

        // Anything not matching a known bucket (e.g. extra savings)
        if (left > 0) {
            if (Object.prototype.hasOwnProperty.call(out, 'savings')) {
                out.savings += left;
            } else {
                out.unapplied = left;
            }
            left = 0;
        }

        out.total = totalReceived;
        return out;
    }

    /* ------------------------------------------------------------
       4. LOAN BALANCE (from ledger)
       Given a loan row and its interest entries, penalties, repayments,
       compute what is currently outstanding.
       ------------------------------------------------------------ */
    function computeLoanBalance(loan, interestEntries = [], penalties = [], repayments = []) {
        const principal = Math.round(loan.principal || 0);
        const interest = interestEntries.reduce((a, x) => a + Math.round(x.interest_amount || 0), 0);
        const penalty = penalties.reduce((a, x) => a + Math.round(x.amount || 0), 0);
        const paidInt = repayments.reduce((a, x) => a + Math.round(x.interest_portion || 0), 0);
        const paidPen = repayments.reduce((a, x) => a + Math.round(x.penalty_portion || 0), 0);
        const paidPrin = repayments.reduce((a, x) => a + Math.round(x.principal_portion || 0), 0);

        const principalOut = Math.max(0, principal - paidPrin);
        const interestOut = Math.max(0, interest - paidInt);
        const penaltyOut = Math.max(0, penalty - paidPen);

        return {
            principalOutstanding: principalOut,
            interestOutstanding: interestOut,
            penaltyOutstanding: penaltyOut,
            totalOutstanding: principalOut + interestOut + penaltyOut,
            principalPaid: paidPrin,
            interestPaid: paidInt,
            penaltyPaid: paidPen,
            totalPaid: paidPrin + paidInt + paidPen
        };
    }

    /* ------------------------------------------------------------
       5. EMERGENCY BALANCE (from ledger)
       Every emergency contribution adds; every emergency assistance
       paid to the member subtracts (assistance is not repaid).
       ------------------------------------------------------------ */
    function computeEmergencyBalance(txns) {
        let bal = 0;
        for (const t of txns) {
            const amt = Math.round(t.amount || 0);
            if (t.txn_type === 'emergency_contribution') bal += amt;
            else if (t.txn_type === 'emergency_assistance') bal -= amt;
        }
        return Math.max(0, bal);
    }

    /* ------------------------------------------------------------
       6. SHARE BALANCE (from ledger)
       Every share purchase adds shares; savings_remainder stored as
       separate savings field on the txn metadata.
       ------------------------------------------------------------ */
    function computeShareBalance(txns) {
        let shares = 0, savings = 0;
        for (const t of txns) {
            if (t.txn_type !== 'member_contribution' && t.txn_type !== 'share_purchase') continue;
            const meta = t.metadata || {};
            shares += Math.round(meta.shares || 0);
            savings += Math.round(meta.savingsRemainder || 0);
        }
        return { shares, savings };
    }

    /* ------------------------------------------------------------
       7. PROFIT PERIOD CALCULATION
       Distributable profit = total income - total expenses.
       Emergency contributions NEVER count as income here.
       Then allocate by eligible shares among eligible members.
       ------------------------------------------------------------ */
    function calcDistributableProfit(totalIncome, totalExpenses) {
        return Math.max(0, Math.round(totalIncome) - Math.round(totalExpenses));
    }

    /**
     * Given a profit period and a snapshot of eligible members,
     * return per-member allocation with rounding adjusted so that
     * sum(allocations) === distributableProfit exactly.
     *
     * eligibleMembers = [{ member_id, eligible_shares }]
     */
    function allocateProfit(distributableProfit, eligibleMembers) {
        distributableProfit = Math.max(0, Math.round(distributableProfit));
        const totalShares = eligibleMembers.reduce((a, m) => a + Math.round(m.eligible_shares || 0), 0);

        if (totalShares === 0 || distributableProfit === 0) {
            return {
                totalShares,
                totalAllocated: 0,
                roundingDifference: 0,
                allocations: eligibleMembers.map(m => ({
                    member_id: m.member_id,
                    eligible_shares: Math.round(m.eligible_shares || 0),
                    ownership_pct: 0,
                    allocated_profit: 0,
                    rounding_adjustment: 0
                }))
            };
        }

        const raw = eligibleMembers.map(m => {
            const shares = Math.round(m.eligible_shares || 0);
            const exact = (distributableProfit * shares) / totalShares;
            return {
                member_id: m.member_id,
                eligible_shares: shares,
                ownership_pct: shares / totalShares,
                exact
            };
        });

        // Floor everyone, then distribute the shortfall to the largest fractional parts.
        let allocatedSum = 0;
        const floored = raw.map(r => {
            const f = Math.floor(r.exact);
            allocatedSum += f;
            return { ...r, allocated_profit: f, frac: r.exact - f };
        });

        let diff = distributableProfit - allocatedSum;
        // Sort indices by fractional desc to hand out leftover RWF
        const idx = floored.map((_, i) => i).sort((a, b) => floored[b].frac - floored[a].frac);
        for (let k = 0; k < idx.length && diff > 0; k++, diff--) {
            floored[idx[k]].allocated_profit += 1;
        }

        const totalAllocated = floored.reduce((a, r) => a + r.allocated_profit, 0);
        return {
            totalShares,
            totalAllocated,
            roundingDifference: distributableProfit - totalAllocated,
            allocations: floored.map(r => ({
                member_id: r.member_id,
                eligible_shares: r.eligible_shares,
                ownership_pct: r.ownership_pct,
                allocated_profit: r.allocated_profit,
                rounding_adjustment: r.allocated_profit - Math.floor(r.exact)
            }))
        };
    }

    /* ------------------------------------------------------------
       8. ELIGIBILITY
       A member is eligible for a profit period if they had any
       active days inside [period_start, period_end].
       Eligible shares = shares purchased BEFORE period_end.
       ------------------------------------------------------------ */
    function isEligibleForPeriod(memberId, periods, periodStart, periodEnd) {
        const ps = new Date(periodStart);
        const pe = new Date(periodEnd);
        for (const p of periods) {
            if (p.member_id !== memberId) continue;
            const s = new Date(p.start_date);
            const e = p.end_date ? new Date(p.end_date) : new Date('9999-12-31');
            if (s <= pe && e >= ps) return true;
        }
        return false;
    }

    /* ------------------------------------------------------------
       9. Airtel fee
       ------------------------------------------------------------ */
    function airtelOutgoingFee() {
        return Math.round(ELF.settings['finance.airtel_outgoing_fee'] || 20);
    }

    /* ------------------------------------------------------------
       10. Late penalty
       ------------------------------------------------------------ */
    function latePenalty() {
        return Math.round(ELF.settings['finance.late_penalty'] || 2000);
    }

    /* ------------------------------------------------------------
       11. Overdue check
       ------------------------------------------------------------ */
    function isOverdue(loan, asOf = new Date()) {
        if (!loan || loan.status !== 'ACTIVE') return false;
        if (!loan.expected_due_date) return false;
        return new Date(loan.expected_due_date) < new Date(asOf);
    }

    return {
        splitContribution,
        calcMonthlyInterest,
        fullMonthsBetween,
        allocateRepayment,
        computeLoanBalance,
        computeEmergencyBalance,
        computeShareBalance,
        calcDistributableProfit,
        allocateProfit,
        isEligibleForPeriod,
        airtelOutgoingFee,
        latePenalty,
        isOverdue
    };
})();