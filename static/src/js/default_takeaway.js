/** @odoo-module **/

import { patch } from "@web/core/utils/patch";

// ✅ IMPORTS “a prueba de builds”
import * as posStoreMod from "@point_of_sale/app/store/pos_store";
import * as modelsMod from "@point_of_sale/app/store/models";

const PosStore = posStoreMod.PosStore || posStoreMod.default;
const Order = modelsMod.Order || modelsMod.default?.Order;

// ✅ CAMBIÁ ESTO si tu Piso 1 tiene otro config_id
const POS_PISO1_CONFIG_ID = 1;

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

function setOrderFiscalPosition(order, fpId, fpObj) {
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

function forceTakeawayOnOrder(pos, order) {
    if (!pos || !order) return false;
    if (!isPiso1(pos)) return false;

    // 1) marcar takeaway (estado)
    if (typeof order.set_takeaway === "function") order.set_takeaway(true);
    else if (typeof order.set_is_takeaway === "function") order.set_is_takeaway(true);
    else if (typeof order.setTakeaway === "function") order.setTakeaway(true);
    else {
        order.is_takeaway = true;
        order.takeaway = true;
    }

    // 2) aplicar fiscal position de TAKEAWAY
    const fpId = getTakeawayFpId(pos);
    const fpObj = getFpObj(pos, fpId);

    if (fpId) {
        setOrderFiscalPosition(order, fpId, fpObj);
        recomputeOrderTaxes(order);
    }

    console.log("✅ [Piso1 Default Takeaway] aplicado", {
        order_uid: order.uid,
        fpId,
        fpName: fpObj?.name,
        is_takeaway: order.is_takeaway ?? order.takeaway,
    });

    return true;
}

console.log("🔥 [pos_piso1_default_takeaway] cargado", { PosStore: !!PosStore, Order: !!Order });

// ==========================
// PATCH POS STORE
// ==========================
if (PosStore) {
    patch(PosStore.prototype, {
        add_new_order() {
            const order = super.add_new_order(...arguments);
            try {
                forceTakeawayOnOrder(this, order);
            } catch (e) {
                console.warn("⚠️ Piso1 add_new_order error", e);
            }
            return order;
        },

        set_order(order) {
            const res = super.set_order(...arguments);
            try {
                forceTakeawayOnOrder(this, order);
            } catch (e) {
                console.warn("⚠️ Piso1 set_order error", e);
            }
            return res;
        },
    });
} else {
    console.warn("⚠️ PosStore no existe en este build. No se pudo parchar store.");
}

// ==========================
// PATCH ORDER
// ==========================
if (Order) {
    patch(Order.prototype, {
        setup() {
            super.setup(...arguments);
            try {
                const pos = this.pos;
                if (isPiso1(pos)) {
                    setTimeout(() => {
                        forceTakeawayOnOrder(pos, this);
                    }, 50);
                }
            } catch (e) {
                console.warn("⚠️ Piso1 Order.setup error", e);
            }
        },

        // 🔥 FIX CUANDO SE AGREGA CLIENTE
        set_partner(partner) {
            const res = super.set_partner?.(...arguments);
            try {
                const pos = this.pos;
                if (isPiso1(pos)) {
                    queueMicrotask(() => forceTakeawayOnOrder(pos, this));
                    setTimeout(() => forceTakeawayOnOrder(pos, this), 60);
                }
            } catch (e) {
                console.warn("⚠️ Piso1 set_partner error", e);
            }
            return res;
        },

        // Fallback builds raros
        setPartner(partner) {
            const res = super.setPartner?.(...arguments);
            try {
                const pos = this.pos;
                if (isPiso1(pos)) {
                    queueMicrotask(() => forceTakeawayOnOrder(pos, this));
                    setTimeout(() => forceTakeawayOnOrder(pos, this), 60);
                }
            } catch (e) {
                console.warn("⚠️ Piso1 setPartner error", e);
            }
            return res;
        },
    });
} else {
    console.warn("⚠️ Order no existe en este build. No se pudo parchar Order.");
}
