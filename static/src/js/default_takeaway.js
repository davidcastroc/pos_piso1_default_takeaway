/** @odoo-module **/

import { patch } from "@web/core/utils/patch";

// ✅ Imports “a prueba de builds” (Odoo 18 cambia exports según bundle)
import * as posStoreMod from "@point_of_sale/app/store/pos_store";
import * as modelsMod from "@point_of_sale/app/store/models";

const PosStore = posStoreMod.PosStore || posStoreMod.default;
const Order = modelsMod.Order || modelsMod.default?.Order;

// ✅ CAMBIÁ ESTO si tu PdV "Piso 1" tiene otro config_id
const POS_PISO1_CONFIG_ID = 1;

function isPiso1(pos) {
    return pos?.config?.id === POS_PISO1_CONFIG_ID;
}

function getTakeawayFpId(pos) {
    const c = pos?.config || {};
    // posibles nombres según build / módulos
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
    if (!fpId) return;

    // builds diferentes
    if (typeof order.set_fiscal_position === "function") {
        order.set_fiscal_position(fpObj || fpId);
        return;
    }
    if (typeof order.setFiscalPosition === "function") {
        order.setFiscalPosition(fpObj || fpId);
        return;
    }

    // fallback (no ideal, pero evita quedarse sin nada)
    order.fiscal_position_id = fpId;
    order.fiscal_position = fpObj || fpId;
}

function recomputeOrderTaxes(order) {
    // diferentes nombres según build
    if (typeof order._applyFiscalPosition === "function") order._applyFiscalPosition();
    if (typeof order._recomputeTaxes === "function") order._recomputeTaxes();
    if (typeof order.compute_all_changes === "function") order.compute_all_changes();
    if (typeof order._computeTax === "function") order._computeTax();

    // refrescar UI si aplica
    if (typeof order.trigger === "function") order.trigger("change", order);
}

function markTakeaway(order) {
    if (typeof order.set_takeaway === "function") return order.set_takeaway(true);
    if (typeof order.set_is_takeaway === "function") return order.set_is_takeaway(true);
    if (typeof order.setTakeaway === "function") return order.setTakeaway(true);

    // fallback flags
    order.is_takeaway = true;
    order.takeaway = true;
}

function isOrderTakeaway(order) {
    return !!(order?.is_takeaway || order?.takeaway);
}

/**
 * Fuerza “para llevar” + FP takeaway + recalcula impuestos
 */
function forceTakeawayOnOrder(pos, order) {
    if (!pos || !order) return false;
    if (!isPiso1(pos)) return false;

    // 1) marcar takeaway (estado)
    markTakeaway(order);

    // 2) aplicar fiscal position de TAKEAWAY (la que quita 10%)
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
        is_takeaway: isOrderTakeaway(order),
    });

    return true;
}

console.log("🔥 [pos_piso1_default_takeaway] cargado", { PosStore: !!PosStore, Order: !!Order });

/**
 * ✅ 1) Cuando se crea una nueva orden
 * ✅ 2) Cuando cambias la orden activa
 */
if (PosStore) {
    patch(PosStore.prototype, {
        add_new_order() {
            const order = super.add_new_order(...arguments);
            try {
                // pequeño delay para que Odoo termine setup interno
                setTimeout(() => forceTakeawayOnOrder(this, order), 0);
            } catch (e) {
                console.warn("⚠️ Piso1 add_new_order error", e);
            }
            return order;
        },

        set_order(order) {
            const res = super.set_order(...arguments);
            try {
                // al seleccionar una orden, asegurar estado
                setTimeout(() => forceTakeawayOnOrder(this, order), 0);
            } catch (e) {
                console.warn("⚠️ Piso1 set_order error", e);
            }
            return res;
        },
    });
} else {
    console.warn("⚠️ PosStore no existe en este build. No se pudo parchar store.");
}

/**
 * ✅ Al construir la orden (por si entra por rutas raras)
 */
if (Order) {
    patch(Order.prototype, {
        setup() {
            super.setup(...arguments);
            try {
                const pos = this.pos;
                if (isPiso1(pos)) {
                    setTimeout(() => forceTakeawayOnOrder(pos, this), 50);
                }
            } catch (e) {
                console.warn("⚠️ Piso1 Order.setup error", e);
            }
        },
    });

    /**
     * ✅ FIX CLAVE: cuando asignás cliente (partner),
     * Odoo recalcula fiscal position y vuelve a meter el 10%.
     * Entonces re-aplicamos takeaway después del set_partner.
     */
    patch(Order.prototype, {
        set_partner(partner) {
            // si no existe en tu build, no hace nada
            const res = super.set_partner ? super.set_partner(...arguments) : undefined;
            try {
                if (isPiso1(this.pos) && isOrderTakeaway(this)) {
                    setTimeout(() => forceTakeawayOnOrder(this.pos, this), 0);
                }
            } catch (e) {
                console.warn("⚠️ Piso1 set_partner patch error", e);
            }
            return res;
        },

        setPartner(partner) {
            const res = super.setPartner ? super.setPartner(...arguments) : undefined;
            try {
                if (isPiso1(this.pos) && isOrderTakeaway(this)) {
                    setTimeout(() => forceTakeawayOnOrder(this.pos, this), 0);
                }
            } catch (e) {
                console.warn("⚠️ Piso1 setPartner patch error", e);
            }
            return res;
        },
    });
} else {
    console.warn("⚠️ Order no existe en este build. No se pudo parchar Order.");
}
