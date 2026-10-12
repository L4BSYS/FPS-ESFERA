// js/16-boot.js (part 16/16). LaGrieta FPS — classic scripts share globals. LOAD ORDER MATTERS, do not reorder.
// --- Start ---
init();
try { if (typeof trialStart === 'function') trialStart('trial-1'); } catch (e) {}console.log("Ground Mesh: ", groundMesh);
console.log("Collidables: ", collidableObjects.length);

if (debugMode) {
  addDebugControls();
}
// Add damage overlay div to HTML body for player damage effect
const overlay = document.createElement('div');
  overlay.id = 'damageOverlay';
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.backgroundColor = 'rgba(255, 0, 0, 0.7)';
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = '999';
  overlay.style.opacity = '0';
  overlay.style.transition = 'opacity 0.15s ease-out';
document.body.appendChild(overlay);

// === Initialize ===
initSounds();
startAmbientMusic();
