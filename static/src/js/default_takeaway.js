/** @odoo-module **/

import { patch } from "@web/core/utils/patch";

// Import “robusto”: a veces Order no viene como export nombrado.
import * as posStoreMod from "@point_of_sale/app/store/pos_store";
import * as models from "@point_of_sale/app/store/models";

const TARGET_POS_NAME = "Piso 1";
const DEBUG = true;

function log(...a) {
    if (DEBUG) console.log("[pos_piso1_default_takeaway]", ...a);
}

const PosStore = posStoreMod.PosStore || posStoreMod.default;
const Order =
    models.Order ||
    models.PosOrder ||
    models.OrderModel ||
    models.PosOrderModel;

if (!PosStore) {
    console.error("[pos_piso1_default_takeaway] ❌ PosStore undefined. Revisa import path.");
}
if (!Order) {
    console.error(
        "[pos_piso1_default_takeaway] ❌ Order undefined. exports disponibles en models:",
        Object.keys(models)
    );
}

function isPiso1(pos) {
    const name = pos?.config?.name || "";
    return name.trim().toLowerCase() === TARGET_POS_NAME.toLowerCase();
}

function getTakeawayFiscalPosition(pos) {
    return (
        pos?.config?.takeaway_fiscal_position_id ||
        pos?.config?.takeawayFiscalPositionId ||
        pos?.config?.takeaway_fiscal_position ||
        null
    );
}

function isOrderTakeaway(order) {
    try {
        if (typeof order.get_is_takeaway === "function") return !!order.get_is_takeaway();
        if (typeof order.getIsTakeaway === "function") return !!order.getIsTakeaway();
        return order.is_takeaway === true || order.isTakeaway === true;
    } catch {
        return false;
    }
}

function forceTakeaway(pos, order) {
    if (!pos || !order) return;

    // bandera takeaway
    try {
        if (typeof order.set_is_takeaway === "function") order.set_is_takeaway(true);
        else if (typeof order.setIsTakeaway === "function") order.setIsTakeaway(true);
        else {
            order.is_takeaway = true;
            order.isTakeaway = true;
        }
    } catch (e) {
        log("No pude setear takeaway flag:", e);
    }

    // fiscal position takeaway
    const fpos = getTakeawayFiscalPosition(pos);
    if (fpos) {
        try {
            if (typeof order.set_fiscal_position === "function") order.set_fiscal_position(fpos);
            else if (typeof order.setFiscalPosition === "function") order.setFiscalPosition(fpos);
            else {
                order.fiscal_position = fpos;
                order.fiscalPosition = fpos;
            }
        } catch (e) {
            log("No pude setear fiscal position:", e);
        }
    } else {
        log("WARNING: No existe takeaway fiscal position en config del POS.");
    }

    // recompute taxes
    try {
        if (typeof order.recomputeTaxes === "function") order.recomputeTaxes();
        else if (typeof order.recompute_tax === "function") order.recompute_tax();
        else if (typeof order._recomputeTaxes === "function") order._recomputeTaxes();

        if (typeof order.trigger === "function") order.trigger("change", order);
    } catch (e) {
        log("No pude recomputar impuestos:", e);
    }

    log("✅ forceTakeaway aplicado. fpos:", fpos);
}

function applyDefaultIfNeeded(pos, order) {
    if (!isPiso1(pos)) return;
    if (!order) return;
    if (isOrderTakeaway(order)) return;
    forceTakeaway(pos, order);
}

/**
 * PATCHES (solo si existen las clases)
 */
if (PosStore) {
    patch(PosStore.prototype, {
        setup() {
            super.setup(...arguments);

            queueMicrotask(() => {
                const order = this.get_order?.() || this.getOrder?.();
                applyDefaultIfNeeded(this, order);
            });

            setTimeout(() => {
                const order = this.get_order?.() || this.getOrder?.();
                applyDefaultIfNeeded(this, order);
            }, 50);

            log("PosStore patched ✅ POS:", this.config?.name);
        },

        add_new_order() {
            const res = super.add_new_order(...arguments);
            const order = this.get_order?.() || this.getOrder?.();
            applyDefaultIfNeeded(this, order);
            return res;
        },

        set_order(order) {
            const res = super.set_order?.(...arguments);
            applyDefaultIfNeeded(this, order);
            return res;
        },
    });
}

if (Order) {
    patch(Order.prototype, {
        set_partner(partner) {
            const res = super.set_partner(...arguments);

            const pos = this.pos || null;
            if (!pos || !isPiso1(pos)) return res;

            // El partner te cambia fiscal position => re-aplicamos takeaway
            queueMicrotask(() => forceTakeaway(pos, this));
            setTimeout(() => forceTakeaway(pos, this), 50);

            return res;
        },

        setPartner(partner) {
            const res = super.setPartner?.(...arguments);

            const pos = this.pos || null;
            if (!pos || !isPiso1(pos)) return res;

            queueMicrotask(() => forceTakeaway(pos, this));
            setTimeout(() => forceTakeaway(pos, this), 50);

            return res;
        },
    });
}

log("loaded ✅");
