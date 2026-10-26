// js/01-config.js (part 1/16). LaGrieta FPS — classic scripts share globals. LOAD ORDER MATTERS, do not reorder.
// ==== Globals ====
let debugMode = false;
let isGamePaused = false;
let isMobile = false;

/**
 * Identidad visual de la mochila (mundo 3D + HUD + modal Q).
 * Una sola fuente: applyBagSkin() empuja los colores a :root;
 * buildTutorialBagModel() lee cloth/strap/buckleHex.
 */
var BAG_SKIN = {
  icon: '🎒',
  cloth: '#4a6b3a',
  clothDark: '#24331f',
  clothMid: '#354f2c',
  strap: '#6b4a2e',
  buckle: '#c4a574',
  stitch: 'rgba(196, 165, 116, 0.35)',
  ink: '#e8f5d8',
  // Three.js (mismo valor que cloth/strap/buckle)
  clothHex: 0x4a6b3a,
  clothEmissiveHex: 0x1a2e1a,
  strapHex: 0x6b4a2e,
  buckleHex: 0xc4a574,
  buckleEmissiveHex: 0x664400
};

function applyBagSkin() {
  try {
    const s = BAG_SKIN;
    const r = document.documentElement;
    if (!r || !r.style) return;
    r.style.setProperty('--bag-cloth', s.cloth);
    r.style.setProperty('--bag-cloth-dark', s.clothDark);
    r.style.setProperty('--bag-cloth-mid', s.clothMid);
    r.style.setProperty('--bag-strap', s.strap);
    r.style.setProperty('--bag-buckle', s.buckle);
    r.style.setProperty('--bag-stitch', s.stitch);
    r.style.setProperty('--bag-ink', s.ink);
    r.style.setProperty('--bag-icon', JSON.stringify(s.icon));
    document.querySelectorAll('.rg-bag-ico').forEach(function (el) {
      el.textContent = s.icon;
    });
  } catch (e) {}
}
try {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyBagSkin);
  } else {
    applyBagSkin();
  }
} catch (e) {}

/** true mientras pedimos pointer lock al reanudar (evita el dot flotante). */
var pointerLockPending = false;

/** Cursor dual: menu (flecha ámbar) | ui (dot verde) | game (oculto con pointer lock). */
function syncCursorMode() {
  try {
    const html = document.documentElement;
    if (!html) return;
    html.classList.remove('rg-cursor-menu', 'rg-cursor-ui', 'rg-cursor-game');
    const shown = (id) => {
      const el = document.getElementById(id);
      if (!el) return false;
      const d = el.style.display;
      if (d === 'none') return false;
      if (d === 'flex' || d === 'block') return true;
      try { return window.getComputedStyle(el).display !== 'none'; } catch (e) { return false; }
    };
    const menuOpen = (typeof LEVEL !== 'undefined' && LEVEL.menuOpen) ||
      shown('mainMenu') || shown('pauseMenu') || shown('gameOver') ||
      shown('tutorialReward') || shown('trialModal');
    if (menuOpen) {
      html.classList.add('rg-cursor-menu');
      return;
    }
    const uiOpen = (typeof invOpen !== 'undefined' && invOpen) ||
      (typeof benchOpen !== 'undefined' && benchOpen) ||
      (typeof openModal !== 'undefined' && openModal) ||
      shown('invModal') || shown('benchModal') || shown('totemModal') || shown('containerModal');
    if (uiOpen) {
      html.classList.add('rg-cursor-ui');
      return;
    }
    // Jugando, lock pendiente o ya locked: cursor oculto.
    // No caer a "ui" (dot) solo porque el lock todavía no volvió tras ESC.
    if (document.pointerLockElement || pointerLockPending || !isGamePaused) {
      html.classList.add('rg-cursor-game');
      return;
    }
    html.classList.add('rg-cursor-ui');
  } catch (e) {}
}

let scene, renderer, camera;
let player, clock, keys = {};
let weapon, muzzleFlash; 

let shootCooldown = 0;
let meleeCooldown = 0;
let groundMesh; // Keep a direct reference to the ground

let collidableObjects = [];
let bullets = []; // Array to track active bullets
let npcs = []; // Array to hold multiple NPCs

