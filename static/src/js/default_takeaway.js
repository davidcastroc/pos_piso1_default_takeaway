/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import * as posStoreMod from "@point_of_sale/app/store/pos_store";
import * as modelsMod from "@point_of_sale/app/store/models";

const PosStore = posStoreMod.PosStore || posStoreMod.default;
const Order = modelsMod.Order || modelsMod.default?.Order;

const POS_PISO1_CONFIG_ID = 1; // <-- CAMBIAR al ID real del PdV Piso 1

function isPiso1(pos) {
    return pos?.config?.id === POS_PISO1_CONFIG_ID;
}

function getTakeawayFpId(pos) {
    const c = pos?.config || {};
    const val =
        c.takeaway_fiscal_position_id ??
        c.takeaway_fp_id ??
        c.fiscal_position_takeaway_id ??
        c.takeaway_fpos_id ??
        null;

    if (Array.isArray(val)) return val[0];
    return val || null;
}

function getFpObj(pos, fpId) {
    if (!fpId) return null;
    if (pos?.fiscal_positions_by_id?.[fpId]) return pos.fiscal_positions_by_id[fpId];
    if (Array.isArray(pos?.fiscal_positions)) {
        return pos.fiscal_positions.find((x) => x.id === fpId) || null;
    }
    return null;
}

function markTakeaway(order) {
    if (typeof order.set_takeaway === "function") return order.set_takeaway(true);
    if (typeof order.set_is_takeaway === "function") return order.set_is_takeaway(true);
    if (typeof order.setTakeaway === "function") return order.setTakeaway(true);
    order.is_takeaway = true;
    order.takeaway = true;
}

function isOrderTakeaway(order) {
    return !!(order?.is_takeaway || order?.takeaway);
}

function setOrderFiscalPosition(order, fpId, fpObj) {
    if (!fpId) return;
    if (typeof order.set_fiscal_position === "function") {
        order.set_fiscal_position(fpObj || fpId);
        return;
    }
    if (typeof order.setFiscalPosition === "function") {
        order.setFiscalPosition(fpObj || fpId);
        return;
    }
    order.fiscal_position_id = fpId;
    order.fiscal_position = fpObj || fpId;
}

function recomputeOrderTaxes(order) {
    if (typeof order._applyFiscalPosition === "function") order._applyFiscalPosition();
    if (typeof order._recomputeTaxes === "function") order._recomputeTaxes();
    if (typeof order.compute_all_changes === "function") order.compute_all_changes();
    if (typeof order._computeTax === "function") order._computeTax();
    if (typeof order.trigger === "function") order.trigger("change", order);
}

// 🔥 la función clave
function forceTakeawayOnOrder(pos, order) {
    if (!pos || !order) return false;
    if (!isPiso1(pos)) return false;

    markTakeaway(order);

    const fpId = getTakeawayFpId(pos);
    const fpObj = getFpObj(pos, fpId);

    if (fpId) {
        // aplicar FP + recalcular
        setOrderFiscalPosition(order, fpId, fpObj);
        recomputeOrderTaxes(order);
    }

    return true;
}

/**
 * 1) Default takeaway al crear/cambiar orden
 */
if (PosStore) {
    patch(PosStore.prototype, {
        add_new_order() {
            const order = super.add_new_order(...arguments);
            try {
                setTimeout(() => forceTakeawayOnOrder(this, order), 0);
                setTimeout(() => forceTakeawayOnOrder(this, order), 300);
            } catch (e) {
                console.warn("⚠️ Piso1 add_new_order error", e);
            }
            return order;
        },

        set_order(order) {
            const res = super.set_order(...arguments);
            try {
                setTimeout(() => forceTakeawayOnOrder(this, order), 0);
                setTimeout(() => forceTakeawayOnOrder(this, order), 300);
            } catch (e) {
                console.warn("⚠️ Piso1 set_order error", e);
            }
            return res;
        },
    });
}

/**
 * 2) GUARD: si Odoo intenta cambiar fiscal position (por cliente), lo corregimos.
 *    Esto es lo que te está jodiendo ahorita.
 */
if (Order) {
    // A) cuando inicia la orden
    patch(Order.prototype, {
        setup() {
            super.setup(...arguments);
            try {
                if (isPiso1(this.pos)) {
                    setTimeout(() => forceTakeawayOnOrder(this.pos, this), 50);
                    setTimeout(() => forceTakeawayOnOrder(this.pos, this), 350);
                }
            } catch (e) {
                console.warn("⚠️ Piso1 Order.setup error", e);
            }
        },
    });

    // B) cuando asignás partner (cliente): lo forzamos DESPUÉS (varias veces)
    patch(Order.prototype, {
        set_partner(partner) {
            const res = super.set_partner?.(...arguments);
            try {
                if (isPiso1(this.pos)) {
                    setTimeout(() => forceTakeawayOnOrder(this.pos, this), 0);
                    setTimeout(() => forceTakeawayOnOrder(this.pos, this), 250);
                    setTimeout(() => forceTakeawayOnOrder(this.pos, this), 800);
                }
            } catch (e) {
                console.warn("⚠️ Piso1 set_partner error", e);
            }
            return res;
        },

        setPartner(partner) {
            const res = super.setPartner?.(...arguments);
            try {
                if (isPiso1(this.pos)) {
                    setTimeout(() => forceTakeawayOnOrder(this.pos, this), 0);
                    setTimeout(() => forceTakeawayOnOrder(this.pos, this), 250);
                    setTimeout(() => forceTakeawayOnOrder(this.pos, this), 800);
                }
            } catch (e) {
                console.warn("⚠️ Piso1 setPartner error", e);
            }
            return res;
        },
    });

    // C) EL VERDADERO “CINTURÓN DE SEGURIDAD”:
    //    cada vez que Odoo cambie fiscal position, si es Piso1 => lo devolvemos a TAKEAWAY.
    patch(Order.prototype, {
        set_fiscal_position(fp) {
            const res = super.set_fiscal_position?.(...arguments);
            try {
                if (isPiso1(this.pos)) {
                    // si ya debería ser takeaway, forzarlo
                    if (isOrderTakeaway(this)) {
                        setTimeout(() => forceTakeawayOnOrder(this.pos, this), 0);
                        setTimeout(() => forceTakeawayOnOrder(this.pos, this), 200);
                    }
                }
            } catch (e) {
                console.warn("⚠️ Piso1 set_fiscal_position guard error", e);
            }
            return res;
        },

        setFiscalPosition(fp) {
            const res = super.setFiscalPosition?.(...arguments);
            try {
                if (isPiso1(this.pos)) {
                    if (isOrderTakeaway(this)) {
                        setTimeout(() => forceTakeawayOnOrder(this.pos, this), 0);
                        setTimeout(() => forceTakeawayOnOrder(this.pos, this), 200);
                    }
                }
            } catch (e) {
                console.warn("⚠️ Piso1 setFiscalPosition guard error", e);
            }
            return res;
        },
    });
}

console.log("✅ pos_piso1_default_takeaway loaded", {
    PosStore: !!PosStore,
    Order: !!Order,
    POS_PISO1_CONFIG_ID,
});
