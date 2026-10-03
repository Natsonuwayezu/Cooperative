# ECOLE LA FONTAINE Staff Cooperative — Management System

Single-user operational web app for a small Rwandan school staff cooperative.

## 1. Profit calculation

Distributable = Total Income − Total Expenses
Income types: loan_interest, loan_penalty, sponsor_income, other_income
Expense types: expense, airtel_fee
Emergency contributions are NEVER included in profit.
Member profit = Distributable × (Member Eligible Shares / Total Eligible Shares)
Allocations are floor-rounded and the leftover RWF is distributed to the
largest fractional shares so the sum equals distributable exactly.
Finalized periods are frozen forever.

text

## 2. Loan calculation

Interest per month = Principal × rate% × months (simple interest)
Late penalty = 2,000 RWF (configurable), added to the outstanding balance.
Repayment allocation order (configurable):
emergency → interest → penalty → principal → savings
Airtel outgoing transactions auto-incur the configured fee (default 20 RWF).

text

## 3. Emergency fund calculation

Balance = Σ(emergency_contribution) − Σ(emergency_assistance)
Separate from shares and profit. Assistance is a grant, not a loan.

text

## 4. Testing results

Verified in-browser:

- Contribution split (6,000 / 16,000 / 21,000 / 501,000) → correct.
- Profit allocation 100/1000 × 500,000 = 50,000 → correct.
- Multiple loans per borrower preserved as separate records.
- Deactivate blocked when member has an active loan.
- Emergency contributions excluded from distributable profit.
- Sponsor, external borrower excluded from profit allocation.
- Historical setting changes do not affect past transactions.
- Reversal creates matching reversal row; ledger reconciles.

## 5. Assumptions

- RWF has no cents; all amounts are integers.
- Single operational user; no approvals, signatures, or role complexity.
- Sponsors and external borrowers never share member profit.
- Airtel outgoing fee applies automatically to Airtel-tagged disbursements.
- Loan interest is simple (not compounding) unless the secretary charges it again.
- RLS is disabled/opened for this internal app; put it behind a private network or add proper policies if exposed.
