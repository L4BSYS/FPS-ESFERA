(function () {
  window.Game = window.Game || {};
  const Config = window.Game.Config;

  /**
   * Encapsula el estado de input del jugador: teclas, yaw/pitch de cámara,
   * y el manejo de Pointer Lock con fallback de click-y-arrastrar para
   * entornos donde Pointer Lock está bloqueado (ej. iframes con sandbox).
   */
  class InputManager {
    constructor(canvas, overlay) {
      this.canvas = canvas;
      this.overlay = overlay;

      this.keys = {};
      this.yaw = 0;
      this.pitch = 0;

      this.pointerLocked = false;
      this.fallbackMode = false;
      this._mouseDownForFallback = false;
      this._lastMouseX = 0;
      this._lastMouseY = 0;
      this._resizeCallbacks = [];

      this._bindKeyboard();
      this._bindMouse();
      this._bindPointerLock();
      this._bindResize();
    }

    _bindKeyboard() {
      const capturedCodes = [
        'Space', 'ShiftLeft', 'ShiftRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD',
        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      ];
      window.addEventListener('keydown', (e) => {
        this.keys[e.code] = true;
        if (capturedCodes.includes(e.code)) e.preventDefault();
      });
      window.addEventListener('keyup', (e) => {
        this.keys[e.code] = false;
      });
    }

    _bindMouse() {
      window.addEventListener('mousemove', (e) => {
        if (this.pointerLocked) {
          this._applyLook(e.movementX || 0, e.movementY || 0);
        } else if (this.fallbackMode && this._mouseDownForFallback) {
          const dx = e.clientX - this._lastMouseX;
          const dy = e.clientY - this._lastMouseY;
          this._lastMouseX = e.clientX;
          this._lastMouseY = e.clientY;
          this._applyLook(dx, dy);
        }
      });

      this.canvas.addEventListener('mousedown', (e) => {
        if (this.fallbackMode) {
          this._mouseDownForFallback = true;
          this._lastMouseX = e.clientX;
          this._lastMouseY = e.clientY;
          e.preventDefault();
        }
      });

      window.addEventListener('mouseup', () => {
        this._mouseDownForFallback = false;
      });
    }

    _applyLook(dx, dy) {
      this.yaw -= dx * Config.MOUSE_SENSITIVITY;
      this.pitch -= dy * Config.MOUSE_SENSITIVITY;
      this.pitch = Math.max(-Config.PITCH_CLAMP, Math.min(Config.PITCH_CLAMP, this.pitch));
    }

    _bindPointerLock() {
      this.canvas.addEventListener('click', () => {
        const hud = window.Game.HUD;
        if (hud && (hud.isPaused() || hud.isDeathOpen() || hud.isModalOpen())) return;
        if (!this.pointerLocked && !this.fallbackMode) {
          this.canvas.requestPointerLock();
        }
      });

      document.addEventListener('pointerlockchange', () => {
        this.pointerLocked = document.pointerLockElement === this.canvas;
        this._updateOverlay();
      });

      document.addEventListener('pointerlockerror', () => {
        console.warn('Pointer Lock no disponible. Usando modo click-y-arrastrar.');
        this.fallbackMode = true;
        this.pointerLocked = false;
        this._updateOverlay();
        const subtleEl = this.overlay.querySelector('.subtle');
        if (subtleEl) {
          subtleEl.textContent = 'Click y arrastrar para mirar | WASD | F antorcha | Q mochila | Shift | Espacio';
        }
      });
    }

    _updateOverlay() {
      this.overlay.classList.toggle('hidden', this.pointerLocked);
    }

    _bindResize() {
      window.addEventListener('resize', () => {
        this._resizeCallbacks.forEach((cb) => cb());
      });
    }

    onResize(callback) {
      this._resizeCallbacks.push(callback);
    }

    isDown(code) {
      return !!this.keys[code];
    }

    /** Consume una tecla (para acciones de un solo disparo, como saltar) */
    consume(code) {
      this.keys[code] = false;
    }
  }

  window.Game.InputManager = InputManager;
})();
