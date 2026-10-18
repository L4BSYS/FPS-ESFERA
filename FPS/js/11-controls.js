// js/11-controls.js (part 11/16). LaGrieta FPS — classic scripts share globals. LOAD ORDER MATTERS, do not reorder.
// --- Controls Setup ---
  function setupControls() {
      const canvas = renderer.domElement;

      // Pointer Lock
      canvas.addEventListener('click', () => {
          if (!isGamePaused && document.pointerLockElement !== canvas) {
              lockPointer();
          } else if (isGamePaused) {
              // Clicking screen while paused could resume? Or handled by button.
          }
      });
      document.addEventListener('pointerlockchange', onPointerLockChange, false);
      document.addEventListener('pointerlockerror', onPointerLockError, false);

      function onPointerLockChange() {
          if (document.pointerLockElement === canvas) {
               console.log("Pointer Locked");
              document.addEventListener('mousemove', onMouseMove, false);
              // Optional: Hide cursor explicitly
              // canvas.style.cursor = 'none';
              if (isGamePaused) { // If lock is gained while paused (e.g. clicking resume), unpause
                  togglePause();
              }
          } else {
               console.log("Pointer Unlocked");
               lastPointerUnlockTs = Date.now();
              document.removeEventListener('mousemove', onMouseMove, false);
              // Optional: Show cursor
              // canvas.style.cursor = 'default';
              if (player) {
                  keys = {}; // Reset global keys state
                  player.keys = {}; // Reset player's view of keys
                  player.input = { forward: 0, backward: 0, left: 0, right: 0 }; // Reset input intention
                  player.velocity.x = 0; player.velocity.z = 0; // Stop horizontal movement immediately
              }
              if (!isGamePaused && !(typeof paletteOpen !== 'undefined' && paletteOpen)) { // If lock is lost unexpectedly, pause the game
                  togglePause();
              }
          }
      }
      function onPointerLockError() { console.warn('Pointer lock request was denied; click the game view to capture the mouse.'); }
      function onMouseMove(event) { if (player && !isGamePaused) player.handleMouseMove(event, player.config.sensitivity); }

      // Keyboard
      window.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
              if (typeof paletteOpen !== 'undefined' && paletteOpen && !isGamePaused) { togglePalette(false); return; }
              if (typeof pendingPlacement !== 'undefined' && pendingPlacement && !isGamePaused) { cancelPlacement(true); return; }
              if (typeof netChatOpen !== 'undefined' && netChatOpen) { toggleNetChat(false); return; }
              if (typeof closeTopModal === 'function' && closeTopModal()) return;
              togglePause(); return;
          }
          // Cerrar paneles abiertos aunque el juego esté en pausa (Q/E)
          if (typeof invOpen !== 'undefined' && invOpen && (e.key || '').toLowerCase() === KeyMap.inventory && !isTypingTarget(e)) { toggleInventory(); return; }
          if (typeof totemOpen !== 'undefined' && totemOpen && (e.key || '').toLowerCase() === KeyMap.interact && !isTypingTarget(e)) { toggleTotem(false); return; }
          if (typeof benchOpen !== 'undefined' && benchOpen && (e.key || '').toLowerCase() === KeyMap.interact && !isTypingTarget(e)) { toggleBench(false); return; }
          if (isGamePaused) return; // Ignore game keys if paused

          const key = e.key.toLowerCase();
          keys[key] = true; // Update global keys state

          // Interaction Keys (configurables en Ajustes)
          if (key === KeyMap.interact) { // Universal interact/pickup key
              if (isTypingTarget(e)) return;
              if (player) {
                  if (typeof tryOpenWorkbench === 'function' && tryOpenWorkbench()) return;
                  if (typeof tryOpenTotem === 'function' && tryOpenTotem()) return;
                  player.interactOrPickup();
              }
          }
          else if (key === KeyMap.inventory) { // Inventory modal
              if (isTypingTarget(e)) return;
              toggleInventory();
          }
          else if (key === 't' && !isTypingTarget(e)) { // Chat de sector
              if (typeof toggleNetChat === 'function') toggleNetChat();
          }
          else if (key === KeyMap.palette) { // Creator palette bar (no pause needed)
              if (isTypingTarget(e)) return;
              if (typeof creatorMode !== 'undefined' && creatorMode) togglePalette();
          }

          // Construction: Block Type Switching
          if (player?.currentTool === TOOLS.HAMMER) {
            switch(e.key.toLowerCase()) {
                case 'z': 
                    if(player.inventory.resources.wood > 0) setBlockType('wood');
                    break;
                case 'x': 
                    if(player.inventory.resources.stone > 0) setBlockType('stone');
                    break;
                case 'c': 
                    if(player.inventory.resources.metal > 0) setBlockType('metal');
                    break;
            }
          }
      });

      window.addEventListener('keyup', (e) => {
          const key = e.key.toLowerCase();
          keys[key] = false; // Update global keys state
      });

      // Mouse Buttons
      window.addEventListener('mousedown', (e) => {
          if (document.pointerLockElement === canvas && !isGamePaused && player) {
              // Colocación pendiente (mesa/estructura): clic izquierdo confirma, derecho cancela
              if (typeof pendingPlacement !== 'undefined' && pendingPlacement) {
                  if (e.button === 0) { confirmPlacement(); return; }
                  if (e.button === 2) { e.preventDefault(); cancelPlacement(true); return; }
              }
              if (e.button === 0) { // Left click
                  // First check if we're looking at a pickup item
                  const lookingAtPickup = checkForPickupItems();
                  if (lookingAtPickup) {
                      player.interactOrPickup();
                      return;
                  }

                  // Otherwise perform tool-specific action
                  switch (player.currentTool) {
                      case TOOLS.GUN:
                          shoot();
                          break;

                      case TOOLS.HAMMER:
                          if (typeof creatorMode !== 'undefined' && creatorMode) creatorPlace();
                          else placeBlock();
                          updateSpatialPartition();
                          break;

                      case TOOLS.HANDS:
                      case TOOLS.TORCH:
                          player.interactOrPickup();
                          break;

                      case TOOLS.AXE:
                      case TOOLS.PICKAXE:
                          player.handleAttack();
                          break;

                      default:
                          console.warn("Unhandled tool type:", player.currentTool);
                  }
              } else if (e.button === 2) { // Right click
                  e.preventDefault();
                  if (typeof creatorMode !== 'undefined' && creatorMode) {
                      paletteHold = true;
                      togglePalette(true);
                      return;
                  }

                  switch (player.currentTool) {
                      case TOOLS.HAMMER:
                          creatorDelete();
                          break;

                      case TOOLS.HANDS:
                          if (player.heldItem) player.dropItem();
                          break;
                  }
              }
          } else if (!isGamePaused && !document.pointerLockElement) {
              // If click outside when not locked, try to lock pointer
              // canvas.requestPointerLock();
          }
      });

      // Prevent context menu on right-click in game window
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  function setupMobileControls() {
      if (window.__mobileControlsReady) return;
      window.__mobileControlsReady = true;
      const joystick = document.getElementById('joystickLeft');
      const knob = document.getElementById('joystickKnob');
      const rightArea = document.getElementById('rightTouchArea');
      const jumpBtn = document.getElementById('jumpBtn');
      const actionBtn = document.getElementById('actionBtn');

      let joystickActive = false;
      let joystickTouchId = null;
      let lookTouchId = null;
      const joystickCenter = { x: 50, y: 50 };
      const maxDist = 40;
      const findTouch = (list, id) => {
        for (let k = 0; k < list.length; k++) { if (list[k].identifier === id) return list[k]; }
        return null;
      };
      const moveKnobTo = (touch) => {
        const rect = joystick.getBoundingClientRect();
        const x = touch.clientX - rect.left - joystickCenter.x;
        const y = touch.clientY - rect.top - joystickCenter.y;

        const dist = Math.min(maxDist, Math.sqrt(x*x + y*y));
        const angle = Math.atan2(y, x);

        const knobX = dist * Math.cos(angle);
        const knobY = dist * Math.sin(angle);

        knob.style.transform = `translate(${knobX}px, ${knobY}px)`;

        // Update player movement
        player.joystickValues.x = knobX / maxDist;
        player.joystickValues.y = knobY / maxDist; // Invert Y for forward/back
      };

      joystick.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (joystickTouchId !== null) return;
        const t = e.changedTouches[0];
        joystickTouchId = t.identifier;
        joystickActive = true;
        player.touchMoveActive = true;
        moveKnobTo(t);
      });

      document.addEventListener('touchmove', (e) => {
        if (joystickTouchId === null) return;
        const touch = findTouch(e.changedTouches, joystickTouchId) || findTouch(e.touches, joystickTouchId);
        if (!touch) return;
        e.preventDefault();
        moveKnobTo(touch);
      }, { passive: false });

      const endJoystickTouch = (e) => {
        if (joystickTouchId === null) return;
        for (const t of Array.from(e.changedTouches)) {
          if (t.identifier === joystickTouchId) {
            joystickTouchId = null;
            joystickActive = false;
            knob.style.transform = 'translate(0, 0)';
            player.touchMoveActive = false;
            player.joystickValues.x = 0;
            player.joystickValues.y = 0;
            break;
          }
        }
      };
      document.addEventListener('touchend', endJoystickTouch);
      document.addEventListener('touchcancel', endJoystickTouch);

      rightArea.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (lookTouchId !== null) return;
        const t = e.changedTouches[0];
        lookTouchId = t.identifier;
        player.touchLookActive = true;
        player.touchLookStartX = t.clientX;
        player.touchLookStartY = t.clientY;
      });

      rightArea.addEventListener('touchmove', (e) => {
        if (lookTouchId === null) return;
        const touch = findTouch(e.changedTouches, lookTouchId);
        if (!touch) return;
        e.preventDefault();

        const movementX = touch.clientX - player.touchLookStartX;
        const movementY = touch.clientY - player.touchLookStartY;

        player.handleMouseMove({
          movementX,
          movementY
        }, PLAYER_CONFIG.mobileSensitivity);

        player.touchLookStartX = touch.clientX;
        player.touchLookStartY = touch.clientY;
      }, { passive: false });

      const endLookTouch = (e) => {
        if (lookTouchId === null) return;
        for (const t of Array.from(e.changedTouches)) {
          if (t.identifier === lookTouchId) { lookTouchId = null; player.touchLookActive = false; break; }
        }
      };
      rightArea.addEventListener('touchend', endLookTouch);
      rightArea.addEventListener('touchcancel', endLookTouch);

      jumpBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        player.mobileJumpPressed = true;
      });

      jumpBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        player.mobileJumpPressed = false;
      });

      if (actionBtn) {
          actionBtn.addEventListener('touchstart', (e) => {
              e.preventDefault();
              primaryAction();
          });
      }

      const secondaryBtn = document.getElementById('secondaryBtn');
      if (secondaryBtn) {
          secondaryBtn.addEventListener('touchstart', (e) => {
              e.preventDefault();
              secondaryAction();
          });
      }

      const menuBtn = document.getElementById('menuBtn');
      if (menuBtn) {
          menuBtn.addEventListener('touchstart', (e) => {
              e.preventDefault();
              try { togglePause(); } catch (err) {}
          });
      }

      // Add touch events for material buttons (legacy + build bar)
      document.querySelectorAll('.material-btn, .build-mat').forEach(btn => {
          btn.addEventListener('touchstart', (e) => {
              e.preventDefault();
              if(!btn.classList.contains('disabled') && !btn.classList.contains('empty')) {
                  setBlockType(btn.dataset.type);
              }
          });
      });

  }

  // Acción principal (clic izquierdo / botón de acción táctil).
  // Incluye abrir mesa/tótem, recoger objetos y la acción de la herramienta.
  function primaryAction() {
      if (typeof isGamePaused !== 'undefined' && isGamePaused) return;
      if (typeof player === 'undefined' || !player) return;
      if (typeof pendingPlacement !== 'undefined' && pendingPlacement) { confirmPlacement(); return; }
      try {
          if (typeof tryOpenWorkbench === 'function' && tryOpenWorkbench()) return;
          if (typeof tryOpenTotem === 'function' && tryOpenTotem()) return;
      } catch (e) {}
      if (checkForPickupItems()) { player.interactOrPickup(); return; }
      switch (player.currentTool) {
          case TOOLS.GUN: shoot(); break;
          case TOOLS.HAMMER:
              if (typeof creatorMode !== 'undefined' && creatorMode) creatorPlace();
              else placeBlock();
              break;
          case TOOLS.AXE:
          case TOOLS.PICKAXE: player.handleAttack(); break;
          default: player.interactOrPickup();
      }
  }

  // Acción secundaria (clic derecho / botón táctil).
  function secondaryAction() {
      if (typeof isGamePaused !== 'undefined' && isGamePaused) return;
      if (typeof player === 'undefined' || !player) return;
      if (typeof pendingPlacement !== 'undefined' && pendingPlacement) { cancelPlacement(true); return; }
      if (typeof creatorMode !== 'undefined' && creatorMode) { paletteHold = true; togglePalette(true); return; }
      switch (player.currentTool) {
          case TOOLS.HAMMER: creatorDelete(); break;
          case TOOLS.HANDS:
          case TOOLS.TORCH:
              if (player.heldItem) player.dropItem();
              break;
          default:
              if (player.heldItem) player.dropItem();
      }
  }
  function updateActionButton() {
      if (!player) return;
      
      const actionBtn = document.getElementById('actionBtn');
      if (!actionBtn) return;

      // Clear existing handlers
      actionBtn.onclick = null;
      
      // Determine the best action based on context
      actionBtn.onclick = (e) => {
          e.preventDefault();
          primaryAction();
      };

      // Update icon (unchanged)
      const tool = player.currentTool;
      actionBtn.textContent = {
          [TOOLS.GUN]: '🔫',
          [TOOLS.HAMMER]: '🔨',
          [TOOLS.AXE]: '🪓',
          [TOOLS.PICKAXE]: '⛏️',
          [TOOLS.TORCH]: '🔥',
          [TOOLS.HANDS]: '✊'
      }[tool] || '❔';
  }

  function checkForPickupItems() {
      if (!player) return false;
      
      const rayOrigin = new THREE.Vector3();
      const rayDirection = new THREE.Vector3();
      player.camera.getWorldPosition(rayOrigin);
      player.camera.getWorldDirection(rayDirection);

      const raycaster = new THREE.Raycaster(rayOrigin, rayDirection, 0.1, player.config.interactionReach);
      const interactables = collidableObjects.filter(obj => 
          obj.visible && obj.isPickupable && !obj.userData.collected
      );

      const hits = raycaster.intersectObjects(interactables, true);
      return hits.length > 0;
  }
