/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import * as posStoreMod from "@point_of_sale/app/store/pos_store";

const TARGET_POS_NAME = "Piso 1";
const DEBUG = true;

function log(...a) {
    if (DEBUG) console.log("[pos_piso1_default_takeaway]", ...a);
}
function warn(...a) {
    console.warn("[pos_piso1_default_takeaway]", ...a);
}

const PosStore = posStoreMod.PosStore || posStoreMod.default;

function isPiso1(pos) {
    const name = pos?.config?.name;
    return !!name && name.trim().toLowerCase() === TARGET_POS_NAME.toLowerCase();
}

function getTakeawayFiscalPosition(pos) {
    return (
        pos?.config?.takeaway_fiscal_position_id ||
        pos?.config?.takeawayFiscalPositionId ||
        pos?.config?.takeaway_fiscal_position ||
        null
    );
}

function safeRecompute(order) {
    try {
        if (!order) return;
        if (typeof order.recomputeTaxes === "function") order.recomputeTaxes();
        else if (typeof order.recompute_tax === "function") order.recompute_tax();
        else if (typeof order._recomputeTaxes === "function") order._recomputeTaxes();
        if (typeof order.trigger === "function") order.trigger("change", order);
    } catch (e) {
        warn("No pude recomputar impuestos:", e);
    }
}

function setTakeawayFlag(order, val = true) {
    try {
        if (!order) return;
        if (typeof order.set_is_takeaway === "function") order.set_is_takeaway(val);
        else if (typeof order.setIsTakeaway === "function") order.setIsTakeaway(val);
        else {
            order.is_takeaway = !!val;
            order.isTakeaway = !!val;
        }
    } catch (e) {
        warn("No pude setear takeaway flag:", e);
    }
}

function setFiscalPosition(order, fpos) {
    try {
        if (!order || !fpos) return;
        if (typeof order.set_fiscal_position === "function") order.set_fiscal_position(fpos);
        else if (typeof order.setFiscalPosition === "function") order.setFiscalPosition(fpos);
        else {
            order.fiscal_position = fpos;
            order.fiscalPosition = fpos;
        }
    } catch (e) {
        warn("No pude setear fiscal position:", e);
    }
}

function forceTakeaway(pos, order) {
    if (!pos || !order) return;
    if (!isPiso1(pos)) return;

    const fpos = getTakeawayFiscalPosition(pos);
    setTakeawayFlag(order, true);
    if (fpos) setFiscalPosition(order, fpos);

    // Recompute en 2 fases para evitar carreras del POS (muy típico al setear cliente)
    queueMicrotask(() => safeRecompute(order));
    setTimeout(() => safeRecompute(order), 50);

    log("✅ forceTakeaway aplicado. fpos:", fpos || "(none)");
}

/**
 * Monkeypatch por ORDEN (instancia) para arreglar el bug del cliente:
 * cuando set_partner corre, Odoo puede recalcular fiscal position => te re-mete el 10%.
 * Entonces después de set_partner, re-forzamos takeaway.
 */
function hookPartnerSetter(pos, order) {
    if (!pos || !order) return;
    if (!isPiso1(pos)) return;

    // Evita parchear 500 veces la misma orden
    if (order.__piso1_takeaway_hooked) return;
    order.__piso1_takeaway_hooked = true;

    const orig_set_partner = order.set_partner?.bind(order);
    const orig_setPartner = order.setPartner?.bind(order);

    if (orig_set_partner) {
        order.set_partner = function (partner) {
            const res = orig_set_partner(partner);
            // después de asignar cliente, re-aplicamos takeaway sí o sí
            queueMicrotask(() => forceTakeaway(pos, order));
            setTimeout(() => forceTakeaway(pos, order), 80);
            return res;
        };
        log("hook set_partner ✅");
        return;
    }

    if (orig_setPartner) {
        order.setPartner = function (partner) {
            const res = orig_setPartner(partner);
            queueMicrotask(() => forceTakeaway(pos, order));
            setTimeout(() => forceTakeaway(pos, order), 80);
            return res;
        };
        log("hook setPartner ✅");
        return;
    }

    warn("No encontré set_partner/setPartner en la orden (raro).");
}

function applyToCurrentOrder(pos) {
    if (!pos) return;
    if (!isPiso1(pos)) return;

    const order = pos.get_order?.() || pos.getOrder?.();
    if (!order) return;

    // primero engancha set_partner para que NO se te rompa al poner cliente
    hookPartnerSetter(pos, order);

    // luego forzá takeaway
    forceTakeaway(pos, order);
}

if (!PosStore) {
    console.error("[pos_piso1_default_takeaway] ❌ PosStore undefined. Revisa import path.");
} else {
    patch(PosStore.prototype, {
        setup() {
            super.setup(...arguments);

            // MUY importante: esperar un toque para no matar Owl por nulls en la UI
            setTimeout(() => {
                try {
                    if (!this?.config?.name) return; // aún no listo
                    applyToCurrentOrder(this);
                    log("PosStore patched ✅ POS:", this.config?.name);
                } catch (e) {
                    console.error("[pos_piso1_default_takeaway] setup crash:", e);
                }
            }, 250);
        },

        add_new_order() {
            const res = super.add_new_order(...arguments);
            setTimeout(() => applyToCurrentOrder(this), 0);
            return res;
        },

        set_order(order) {
            const res = super.set_order?.(...arguments);
            setTimeout(() => applyToCurrentOrder(this), 0);
            return res;
        },
    });

    log("loaded ✅");
}
