/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { PosStore } from "@point_of_sale/app/store/pos_store";
import { Order } from "@point_of_sale/app/store/models";

/**
 * CONFIG
 * Cambiá SOLO esto si algún día renombrás el POS
 */
const TARGET_POS_NAME = "Piso 1";

// ponelo en false si ya no querés spam en consola
const DEBUG = true;

/**
 * Helpers
 */
function log(...args) {
    if (DEBUG) console.log("[pos_piso1_default_takeaway]", ...args);
}

function isPiso1(pos) {
    const name = pos?.config?.name || "";
    return name.trim().toLowerCase() === TARGET_POS_NAME.toLowerCase();
}

/**
 * Encuentra fiscal position "takeaway" desde el POS config.
 * En tu caso, es la que usás en: "Comer en el local/para llevar"
 * (la que mapea 10% -> 13% y quita el 10%).
 */
function getTakeawayFiscalPosition(pos) {
    // Odoo suele guardar acá la fiscal position usada para takeaway
    // (puede variar según build, por eso chequeamos varias)
    return (
        pos?.config?.takeaway_fiscal_position_id ||
        pos?.config?.takeawayFiscalPositionId ||
        pos?.config?.takeaway_fiscal_position ||
        null
    );
}

/**
 * Marca la orden como takeaway en el modelo y fuerza fiscal position + taxes recompute.
 * IMPORTANTE: el botón puede decir takeaway pero si no seteás fpos y no recalculás,
 * te queda igual (ese era tu síntoma).
 */
function forceTakeaway(pos, order) {
    if (!pos || !order) return;

    // 1) bandera de takeaway (según build puede existir una u otra)
    try {
        if (typeof order.set_is_takeaway === "function") {
            order.set_is_takeaway(true);
        } else if (typeof order.setIsTakeaway === "function") {
            order.setIsTakeaway(true);
        } else {
            // fallback: propiedad directa (algunas builds)
            order.is_takeaway = true;
            order.isTakeaway = true;
        }
    } catch (e) {
        log("No pude setear bandera takeaway:", e);
    }

    // 2) fiscal position de takeaway
    const fpos = getTakeawayFiscalPosition(pos);
    if (fpos) {
        try {
            if (typeof order.set_fiscal_position === "function") {
                order.set_fiscal_position(fpos);
            } else if (typeof order.setFiscalPosition === "function") {
                order.setFiscalPosition(fpos);
            } else {
                // fallback: directo
                order.fiscal_position = fpos;
                order.fiscalPosition = fpos;
            }
        } catch (e) {
            log("No pude setear fiscal position takeaway:", e);
        }
    } else {
        // Si no existe en config, igual dejamos la bandera takeaway; pero lo normal es que sí exista.
        log("WARNING: No encontré takeaway fiscal position en config (revisar POS settings).");
    }

    // 3) forzar recompute de impuestos (varía por build)
    try {
        // Hay builds donde existe recomputeTax / recomputeTaxes
        if (typeof order.recomputeTaxes === "function") {
            order.recomputeTaxes();
        } else if (typeof order.recompute_tax === "function") {
            order.recompute_tax();
        } else if (typeof order._recomputeTaxes === "function") {
            order._recomputeTaxes();
        }

        // Re-render / notify changes si existe
        if (typeof order.trigger === "function") {
            order.trigger("change", order);
        }
    } catch (e) {
        log("No pude recomputar impuestos:", e);
    }

    log("forceTakeaway aplicado. fpos:", fpos);
}

/**
 * Aplica el default takeaway SOLO en Piso 1
 * y SOLO si la orden todavía no está takeaway (evita loops).
 */
function applyDefaultIfNeeded(pos, order) {
    if (!isPiso1(pos)) return;
    if (!order) return;

    const already =
        order.is_takeaway === true ||
        order.isTakeaway === true ||
        (typeof order.get_is_takeaway === "function" && order.get_is_takeaway()) ||
        (typeof order.getIsTakeaway === "function" && order.getIsTakeaway());

    if (already) return;

    forceTakeaway(pos, order);
}

/**
 * PATCH PosStore:
 * - Cuando carga POS
 * - Cuando crea orden nueva
 * - Cuando cambia orden seleccionada
 */
patch(PosStore.prototype, {
    setup() {
        super.setup(...arguments);

        try {
            // Al terminar de cargar y existir una orden
            queueMicrotask(() => {
                const order = this.get_order?.() || this.getOrder?.();
                applyDefaultIfNeeded(this, order);
            });

            // Por si termina de cargar algo async
            setTimeout(() => {
                const order = this.get_order?.() || this.getOrder?.();
                applyDefaultIfNeeded(this, order);
            }, 50);

            log("PosStore patched OK. POS:", this.config?.name);
        } catch (e) {
            log("Error en PosStore.setup:", e);
        }
    },

    add_new_order() {
        const res = super.add_new_order(...arguments);
        const order = this.get_order?.() || this.getOrder?.();
        applyDefaultIfNeeded(this, order);
        return res;
    },

    // En algunas builds se llama create_new_order
    create_new_order() {
        const res = super.create_new_order?.(...arguments);
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

/**
 * PATCH Order:
 * Cuando agregás cliente, Odoo reaplica fiscal position del partner.
 * Entonces re-aplicamos takeaway DESPUÉS de set_partner.
 */
patch(Order.prototype, {
    set_partner(partner) {
        const res = super.set_partner(...arguments);

        const pos = this.pos || null;
        if (!pos || !isPiso1(pos)) return res;

        const reapply = () => forceTakeaway(pos, this);

        // Inmediato (después del set_partner)
        queueMicrotask(reapply);

        // Por si el recompute viene async
        setTimeout(reapply, 50);

        return res;
    },

    // Algunas builds usan setPartner
    setPartner(partner) {
        const res = super.setPartner?.(...arguments);

        const pos = this.pos || null;
        if (!pos || !isPiso1(pos)) return res;

        const reapply = () => forceTakeaway(pos, this);
        queueMicrotask(reapply);
        setTimeout(reapply, 50);

        return res;
    },
});

log("loaded ✅");
