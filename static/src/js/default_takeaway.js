/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import * as posStoreMod from "@point_of_sale/app/store/pos_store";

const PosStore = posStoreMod.PosStore || posStoreMod.default;

const POS_PISO1_CONFIG_ID = 1; // <-- CAMBIAR al ID real del PdV Piso 1
const WRAP_FLAG = "__piso1_wrapped_set_partner__";

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

function forceTakeawayOnOrder(pos, order) {
    if (!pos || !order) return false;
    if (!isPiso1(pos)) return false;

    markTakeaway(order);

    const fpId = getTakeawayFpId(pos);
    const fpObj = getFpObj(pos, fpId);

    if (fpId) {
        setOrderFiscalPosition(order, fpId, fpObj);
    }
    recomputeOrderTaxes(order);

    console.log("✅ [Piso1 Default Takeaway] aplicado", {
        order_uid: order.uid,
        fpId,
        fpName: fpObj?.name,
        is_takeaway: order.is_takeaway ?? order.takeaway,
    });

    return true;
}

/**
 * 🔥 Este es el fix:
 * Envolvemos set_partner / setPartner A NIVEL DE INSTANCIA.
 * Así funciona aunque no exista modelsMod.Order.
 */
function wrapOrderPartnerSetter(pos, order) {
    try {
        if (!order || order[WRAP_FLAG]) return;
        order[WRAP_FLAG] = true;

        const wrap = (methodName) => {
            if (typeof order[methodName] !== "function") return;

            const original = order[methodName].bind(order);

            order[methodName] = function (partner) {
                const wasTakeaway = isOrderTakeaway(order);
                const res = original(...arguments);

                try {
                    if (isPiso1(pos) && wasTakeaway && partner?.id) {
                        // 👇 aquí es donde se arregla tu caso:
                        // después de asignar cliente, re-forzamos takeaway+FP+taxis
                        setTimeout(() => forceTakeawayOnOrder(pos, order), 0);
                        setTimeout(() => forceTakeawayOnOrder(pos, order), 120);
                        setTimeout(() => forceTakeawayOnOrder(pos, order), 350);
                    }
                } catch (e) {
                    console.warn("⚠️ Piso1 wrapped set_partner error", e);
                }

                return res;
            };
        };

        wrap("set_partner");
        wrap("setPartner");

        console.log("✅ Piso1: set_partner wrapped en instancia", { uid: order.uid });
    } catch (e) {
        console.warn("⚠️ wrapOrderPartnerSetter error", e);
    }
}

console.log("🔥 [pos_piso1_default_takeaway] cargado", { PosStore: !!PosStore });

if (PosStore) {
    patch(PosStore.prototype, {
        add_new_order() {
            const order = super.add_new_order(...arguments);
            try {
                wrapOrderPartnerSetter(this, order);
                setTimeout(() => forceTakeawayOnOrder(this, order), 0);
                setTimeout(() => forceTakeawayOnOrder(this, order), 250);
            } catch (e) {
                console.warn("⚠️ Piso1 add_new_order error", e);
            }
            return order;
        },

        set_order(order) {
            const res = super.set_order(...arguments);
            try {
                wrapOrderPartnerSetter(this, order);
                setTimeout(() => forceTakeawayOnOrder(this, order), 0);
                setTimeout(() => forceTakeawayOnOrder(this, order), 250);
            } catch (e) {
                console.warn("⚠️ Piso1 set_order error", e);
            }
            return res;
        },
    });
} else {
    console.warn("⚠️ PosStore no existe en este build. No se pudo parchar store.");
}
