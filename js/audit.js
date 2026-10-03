/* ============================================================
   audit.js — audit log writer
   ============================================================ */
'use strict';

ELF.audit = (function () {
    async function log(action, record_type, record_id, old_value, new_value, reason) {
        try {
            await ELF.sb.from('audit_log').insert({
                action, record_type, record_id: record_id ? String(record_id) : null,
                old_value: old_value || null, new_value: new_value || null,
                reason: reason || null, actor: 'secretary'
            });
        } catch (e) {
            console.warn('[audit] failed', e);
        }
    }
    return { log };
})();