/* ============================================================
   money.js — exact integer RWF arithmetic
   All money in the app is BIGINT RWF. Never floats.
   ============================================================ */
'use strict';

ELF.money = (function () {

    const CUR = () => ELF.settings['cooperative.currency'] || 'RWF';

    /** Format 1234567 -> "1,234,567 RWF" */
    function fmt(n, withCurrency = true) {
        if (n === null || n === undefined || isNaN(n)) n = 0;
        const v = Math.round(Number(n));
        const sign = v < 0 ? '-' : '';
        const s = Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return sign + s + (withCurrency ? ' ' + CUR() : '');
    }

    /** Parse user input ("5,000 RWF", "5000", "") -> integer or NaN */
    function parse(input) {
        if (input === null || input === undefined) return NaN;
        if (typeof input === 'number') return Math.round(input);
        const s = String(input).replace(/[^\d.-]/g, '');
        if (!s) return NaN;
        const n = Number(s);
        return isFinite(n) ? Math.round(n) : NaN;
    }

    /** Safe sum of integers */
    function sum(...vals) {
        return vals.reduce((a, b) => a + (Number(b) || 0), 0);
    }

    /** Integer division with remainder, useful for share splits */
    function divmod(a, b) {
        a = Math.round(a); b = Math.round(b);
        if (b === 0) return [0, a];
        const q = Math.trunc(a / b);
        return [q, a - q * b];
    }

    /** Percentage with integer rounding (returns integer) */
    function pct(amount, percent) {
        // Use safe integer math: amount * percent / 100
        // percent may be a small decimal like 5 or 2.5
        const scaled = Math.round(Number(percent) * 1000); // percent * 1000
        return Math.round((amount * scaled) / 100000);
    }

    return { fmt, parse, sum, divmod, pct, CUR };
})();