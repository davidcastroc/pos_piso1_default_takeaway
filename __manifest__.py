{
    "name": "POS Piso 1: Para llevar por defecto",
    "version": "18.0.1.0.0",
    "category": "Point of Sale",
    "summary": "Fuerza 'Para llevar' por defecto en el POS Piso 1",
    "depends": ["point_of_sale"],
    "assets": {
        # Odoo 18 POS bundle (el que realmente usa /pos/ui)
        "point_of_sale._assets_pos": [
            "pos_piso1_default_takeaway/static/src/js/default_takeaway.js",
        ],
    },
    "installable": True,
    "application": False,
    "license": "LGPL-3",
}