Re-arranges (orden / UX / estructura)
• Playground por sectores: frente controles · derecha herramientas · izquierda contenedor · norte daño/cura · SE combate
• Tótem = baliza de zona (reemplaza el poste); zonas arrancan OFF; E prende/apaga; sin modal
• Combate sin robots iniciales; olas se arman al prender el tótem (una sola autoridad: oleadas)
• Código: playground → 25-playground.js · tutorial DIRECTOR → 26-tutorial-director.js

Add-ons (cosas nuevas)
• WorldZone damage / heal / spawn (anillo + tótem)
• WorldContainer: cofre + dispenser
• Melee fase A + pistola con cargador y R
• Carteles-poste con cara + modal (E)
• Tótem puzzle (llave) en tutorial NE
• Sectores de patio con carteles explicativos + props agrupados


26/10

La Grieta — changelog (tanda completa)

1) Menú contextual del browser Qué había Solo el canvas bloqueaba el clic derecho. En menú, HUD, overlays y slots el menú nativo todavía podía abrirse.

Qué hice • js/11-controls.js — bloqueo global (document + window, capture) con preventDefault en todo contextmenu • index.html — oncontextmenu="return false;" en body desde el primer paint • css/retro.css — sin callout/selección en html/body (iOS); inputs de chat mantienen texto

Los handlers locales siguen vivos (ej. vaciar quick slot con clic derecho).

—

2) Home cinematográfico Columna izquierda: marca → status → edición → nav → pie. CTA Continuar / Tutorial. Overlay con viñeta + mundo visible. Boot resuelve a home.

—

3) Pantallas cinema centradas Pausa, Moriste, Tutorial completado y Nivel completado usan el mismo lenguaje: .rg-cinema-center + .rg-cinema-card. Home queda a la izquierda; estas cuatro al centro.

—

4) Mira / ESC • Crosshair tipo punto táctico + cursores duales • Look bridge post-ESC: la cámara no queda muerta mientras Chrome no da pointer lock

—

5) Inventario ficha (mochila → mesa → cofre) Qué había Craft por click de libro, chips de recursos, stacks sueltos, softlocks (“Ya la tenés”, costes ambiguos, martillo trabado).

Reglas • Comida / toxina / venda → solo mochila (nunca cinturón) • Munición alimenta ammo{} • 1 slot = 1 stack (max 10) • requires = tener en bag o belt • Libro solo selecciona; craft = bandeja A+B • B mínimo: herramientas se pueden volver a craftar

Craft por gesto (pares) Hand: piedra+piedra martillo · madera+piedra hacha · piedra+metal pico · madera+madera antorcha · madera+metal mesa
Bench: metal+metal pistola · madera+metal balas · madera+piedra venda

UI estaciones (misma gramática) • Mochila Q · Mesa E · Cofre E · Dispenser Tomar 10 • DnD unificado cinturón / mochila / bandeja / cofre • Recetario aprendible (localStorage lagrieta_recipes)

—

6) Post code-review (orden) Sacamos gemelos y god-files: • 28-craft.js · 29-tray.js · 30-station-drag.js • 27-workbench.js · 31-world-signs.js • 23-world-container.js (cofre + dispenser, sin DnD twin) • 02-systems.js / 15-ui.js slim

—

7) BAG_SKIN Identidad barata de la mochila: token CSS --bag-* + tint del prop 3D (opción 1).

—

8) Menú pausa / Ajustes Qué había La card cambiaba de alto según el tab; en Ajustes los botones a 100% se veían como barras laterales; debajo del slider de sensibilidad había texto tipo tutorial.

Qué hice • Card fija ~520×640 + body scrolleable (.rg-pause-body) • Ajustes en filas label + control (Sonido / Mouse / Teclas) • Sacado el texto tutorial bajo sensibilidad • Fix: Cuenta iba al card en vez del body y rompía el alto

—

Probar rápido ESC → tabs (marco estable) → Ajustes
Q → craft A+B + recetario
E mesa / cofre / dispenser Tomar 10
