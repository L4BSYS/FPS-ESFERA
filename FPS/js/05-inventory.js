// js/05-inventory.js (part 5/16). LaGrieta FPS — classic scripts share globals. LOAD ORDER MATTERS, do not reorder.
// ==== Inventory System: mochila por slots + cinturón (1-5) ====
//
// La mochila y el cinturón son almacenamiento real: cada recurso, munición,
// herramienta o consumible ocupa una posición. `resources` y `ammo` siguen
// existiendo como "vistas" (getters/setters) sobre esos slots para que el resto
// del juego siga funcionando igual (inv.resources.wood, inv.ammo.pistol, etc.).
const INV_RESOURCE_KEYS = ['wood', 'stone', 'metal'];
const INV_AMMO_TYPES = ['pistol', 'rifle', 'shotgun', 'energy'];
const INV_RESOURCE_STACK = 60;
const INV_AMMO_STACK = { pistol: 60, rifle: 120, shotgun: 30, energy: 60 };
const INV_RESOURCE_NAMES = { wood: 'Madera', stone: 'Piedra', metal: 'Metal' };
const INV_AMMO_NAMES = { pistol: 'Pistola', rifle: 'Rifle', shotgun: 'Escopeta', energy: 'Energía' };
const INV_BELT_SLOTS = 5;
// La mochila arranca con "bolsillos" y cada mejora suma espacios.
const INV_BAG_TIERS = [
    { tier: 0, name: 'Bolsillos', slots: 8, desc: 'Lo que llevás encima desde el principio.' },
    { tier: 1, name: 'Mochila de lona', slots: 14, desc: 'Primera mochila: +6 espacios.' },
    { tier: 2, name: 'Mochila reforzada', slots: 20, desc: 'Costuras y remaches: +6 espacios.' },
    { tier: 3, name: 'Mochila de explorador', slots: 26, desc: 'Equipo de expedición: +6 espacios.' }
];
const INV_MAX_BAG_SLOTS = INV_BAG_TIERS[INV_BAG_TIERS.length - 1].slots;

class Inventory {
    constructor(player, maxSlots = INV_MAX_BAG_SLOTS) {
        this.player = player;
        this.bagTier = 0;
        this.slots = new Array(maxSlots || INV_MAX_BAG_SLOTS).fill(null);
        this.quickSlots = new Array(INV_BELT_SLOTS).fill(null);
        this.equippedItem = null;
        this.selectedSlot = 0;
        this.craftedFlags = {};
        this._keys = [];
        this._installPools();
        this.updateInventoryUI();
    }

    // ---------- Vistas compatibles: resources / ammo ----------
    _installPools() {
        const self = this;
        this.resources = {
            get keys() { return self._keys; },
            set keys(v) { self._keys = Array.isArray(v) ? v : []; }
        };
        INV_RESOURCE_KEYS.forEach((k) => {
            Object.defineProperty(this.resources, k, {
                enumerable: true,
                configurable: true,
                get() { return self.countResource(k); },
                set(v) { self.setResourceTotal(k, v); }
            });
        });
        this.ammo = {};
        INV_AMMO_TYPES.forEach((t) => {
            Object.defineProperty(this.ammo, t, {
                enumerable: true,
                configurable: true,
                get() { return self.countAmmo(t); },
                set(v) { self.setAmmoTotal(t, v); }
            });
        });
    }

    // ---------- Helpers de slots ----------
    _areaArr(area) {
        return area === 'belt' ? this.quickSlots : this.slots;
    }
    _areaLimit(area) {
        return area === 'belt' ? this.quickSlots.length : Math.min(this.capacity, this.slots.length);
    }
    _areaName(area) {
        return area === 'belt' ? 'el cinturón' : 'la mochila';
    }
    get capacity() {
        const t = INV_BAG_TIERS[Math.max(0, Math.min(INV_BAG_TIERS.length - 1, this.bagTier | 0))];
        return t ? t.slots : INV_BAG_TIERS[0].slots;
    }
    get bagTierName() {
        const t = INV_BAG_TIERS[Math.max(0, Math.min(INV_BAG_TIERS.length - 1, this.bagTier | 0))];
        return t ? t.name : INV_BAG_TIERS[0].name;
    }
    get nextBagTier() {
        return this.bagTier < INV_BAG_TIERS.length - 1 ? INV_BAG_TIERS[this.bagTier + 1] : null;
    }
    get usedBagSlots() {
        let n = 0;
        for (let i = 0; i < this.capacity; i++) if (this.slots[i]) n++;
        return n;
    }
    get usedBeltSlots() {
        let n = 0;
        for (let i = 0; i < this.quickSlots.length; i++) if (this.quickSlots[i]) n++;
        return n;
    }
    // Lista plana compatible con el código viejo (cinturón primero).
    get items() {
        const out = [];
        for (let i = 0; i < this.quickSlots.length; i++) if (this.quickSlots[i]) out.push(this.quickSlots[i]);
        for (let i = 0; i < this.capacity; i++) if (this.slots[i]) out.push(this.slots[i]);
        return out;
    }
    findSlot(item) {
        if (!item) return null;
        for (let i = 0; i < this.quickSlots.length; i++) {
            if (item === this.quickSlots[i]) return { area: 'belt', idx: i };
        }
        for (let i = 0; i < this.capacity; i++) {
            if (item === this.slots[i]) return { area: 'bag', idx: i };
        }
        return null;
    }
    itemAt(area, idx) {
        const arr = this._areaArr(area);
        if (!arr || idx < 0 || idx >= this._areaLimit(area)) return null;
        return arr[idx] || null;
    }
    firstEmpty(area) {
        const arr = this._areaArr(area);
        const lim = this._areaLimit(area);
        for (let i = 0; i < lim; i++) if (!arr[i]) return i;
        return -1;
    }
    _orderFor(proto) {
        // Herramientas/armas al cinturón; recursos/municiones a la mochila.
        const beltFirst = proto && (proto.type === 'tool' || proto.type === 'weapon');
        return beltFirst ? ['belt', 'bag'] : ['bag', 'belt'];
    }
    _maxStack(item) {
        if (!item) return 1;
        if (typeof item.maxStack === 'number' && item.maxStack > 0) return item.maxStack;
        if (item.type === 'ammo') return INV_AMMO_STACK[item.ammoType] || 60;
        if (item.type === 'resource') return INV_RESOURCE_STACK;
        return item.stackable ? 99 : 1;
    }
    _stackKey(item) {
        if (!item) return '';
        return [item.type || '', item.resourceKey || item.id || '', item.ammoType || ''].join('|');
    }
    _sameStack(a, b) {
        return !!a && !!b && this._stackKey(a) === this._stackKey(b);
    }
    _addStacks(proto, qty, order) {
        let left = Math.max(0, Math.floor(qty || 0));
        if (left <= 0) return 0;
        for (const area of order) {
            if (left <= 0) break;
            const arr = this._areaArr(area);
            const lim = this._areaLimit(area);
            for (let i = 0; i < lim && left > 0; i++) {
                const s = arr[i];
                if (!s || !this._sameStack(s, proto)) continue;
                const max = this._maxStack(s);
                if ((s.quantity || 0) >= max) continue;
                const take = Math.min(max - (s.quantity || 0), left);
                s.quantity = (s.quantity || 0) + take;
                left -= take;
            }
            for (let i = 0; i < lim && left > 0; i++) {
                if (arr[i]) continue;
                const max = this._maxStack(proto);
                const take = Math.min(max, left);
                const copy = Object.assign({}, proto);
                copy.quantity = take;
                arr[i] = copy;
                left -= take;
            }
        }
        return left;
    }
    _addUnique(proto, order) {
        for (const area of order) {
            const idx = this.firstEmpty(area);
            if (idx >= 0) {
                const copy = Object.assign({}, proto);
                copy.quantity = 1;
                this._areaArr(area)[idx] = copy;
                return true;
            }
        }
        return false;
    }

    // ---------- Alta de objetos ----------
    addItem(item) {
        if (!item) return false;
        if (item.type === 'ammo') {
            const added = this.addAmmoAmount(item.ammoType, item.amount || item.quantity || 1);
            return added > 0;
        }
        if (item.type === 'resource') {
            const key = item.resourceKey || item.id;
            const added = this.addResource(key, item.amount || item.quantity || 1);
            return added > 0;
        }
        const qty = Math.max(1, Math.floor(item.quantity || 1));
        let left = qty;
        if (item.stackable) {
            left = this._addStacks(Object.assign({}, item, { quantity: qty }), qty, this._orderFor(item));
        } else {
            for (const area of this._orderFor(item)) {
                if (this._addUnique(item, [area])) { left -= 1; break; }
            }
        }
        const added = qty - left;
        if (added > 0) this._changed();
        else this._notify('Mochila llena');
        return left === 0;
    }

    addResource(key, amount) {
        if (!INV_RESOURCE_KEYS.includes(key)) return 0;
        const want = Math.max(0, Math.floor(amount || 0));
        if (!want) return 0;
        const proto = {
            id: key,
            name: INV_RESOURCE_NAMES[key] || key,
            type: 'resource',
            resourceKey: key,
            stackable: true,
            maxStack: INV_RESOURCE_STACK
        };
        const left = this._addStacks(proto, want, ['bag', 'belt']);
        const added = want - left;
        if (added > 0) this._changed();
        else this._notify('Mochila llena: no entra ' + (INV_RESOURCE_NAMES[key] || key).toLowerCase());
        return added;
    }

    countResource(key) {
        let n = 0;
        for (let i = 0; i < this.capacity; i++) {
            const s = this.slots[i];
            if (s && s.type === 'resource' && (s.resourceKey || s.id) === key) n += s.quantity || 0;
        }
        for (let i = 0; i < this.quickSlots.length; i++) {
            const s = this.quickSlots[i];
            if (s && s.type === 'resource' && (s.resourceKey || s.id) === key) n += s.quantity || 0;
        }
        return n;
    }

    removeResource(key, amount) {
        let left = Math.max(0, Math.floor(amount || 0));
        if (left <= 0) return 0;
        const want = left;
        const areas = [['bag', this.slots], ['belt', this.quickSlots]];
        for (const [area, arr] of areas) {
            const lim = this._areaLimit(area);
            for (let i = 0; i < lim && left > 0; i++) {
                const s = arr[i];
                if (!s || s.type !== 'resource' || (s.resourceKey || s.id) !== key) continue;
                const take = Math.min(s.quantity || 0, left);
                s.quantity -= take;
                left -= take;
                if ((s.quantity || 0) <= 0) arr[i] = null;
            }
        }
        const removed = want - left;
        if (removed > 0) this._changed();
        return removed;
    }

    setResourceTotal(key, total) {
        const target = Math.max(0, Math.floor(total || 0));
        const cur = this.countResource(key);
        if (target > cur) return this.addResource(key, target - cur);
        if (target < cur) return -this.removeResource(key, cur - target);
        return 0;
    }

    addAmmoAmount(type, amount) {
        if (!INV_AMMO_TYPES.includes(type)) return 0;
        const want = Math.max(0, Math.floor(amount || 0));
        if (!want) return 0;
        const proto = {
            id: type + '_ammo',
            name: 'Balas de ' + (INV_AMMO_NAMES[type] || type).toLowerCase(),
            type: 'ammo',
            ammoType: type,
            stackable: true,
            maxStack: INV_AMMO_STACK[type] || 60,
            amount: 1
        };
        const left = this._addStacks(proto, want, ['bag', 'belt']);
        const added = want - left;
        if (added > 0) this._changed();
        else this._notify('Mochila llena: no entra munición');
        return added;
    }

    // Compat: devuelve true si entró al menos una bala.
    addAmmo(type, amount) {
        return this.addAmmoAmount(type, amount) > 0;
    }

    countAmmo(type) {
        let n = 0;
        const check = (s) => {
            if (s && s.type === 'ammo' && s.ammoType === type) n += s.quantity || 0;
        };
        for (let i = 0; i < this.capacity; i++) check(this.slots[i]);
        for (let i = 0; i < this.quickSlots.length; i++) check(this.quickSlots[i]);
        return n;
    }

    removeAmmo(type, amount) {
        let left = Math.max(0, Math.floor(amount || 0));
        if (left <= 0) return 0;
        const want = left;
        const areas = [['bag', this.slots], ['belt', this.quickSlots]];
        for (const [area, arr] of areas) {
            const lim = this._areaLimit(area);
            for (let i = 0; i < lim && left > 0; i++) {
                const s = arr[i];
                if (!s || s.type !== 'ammo' || s.ammoType !== type) continue;
                const take = Math.min(s.quantity || 0, left);
                s.quantity -= take;
                left -= take;
                if ((s.quantity || 0) <= 0) arr[i] = null;
            }
        }
        const removed = want - left;
        if (removed > 0) this._changed();
        return removed;
    }

    setAmmoTotal(type, total) {
        const target = Math.max(0, Math.floor(total || 0));
        const cur = this.countAmmo(type);
        if (target > cur) return this.addAmmoAmount(type, target - cur);
        if (target < cur) return -this.removeAmmo(type, cur - target);
        return 0;
    }

    useAmmo(type, amount) {
        if (this.countAmmo(type) < (amount || 1)) {
            try { playSound('weapon_empty'); } catch (e) {}
            return false;
        }
        this.removeAmmo(type, amount || 1);
        this.updateAmmoUI();
        return true;
    }

    // ---------- Baja / movimiento ----------
    removeItem(item, quantity = 1) {
        const loc = this.findSlot(item);
        if (!loc) return false;
        const arr = this._areaArr(loc.area);
        const slot = arr[loc.idx];
        if (!slot) return false;
        const qty = Math.max(1, Math.floor(quantity || 1));
        if (slot.stackable && (slot.quantity || 1) > qty) {
            slot.quantity -= qty;
        } else {
            arr[loc.idx] = null;
            if (this.equippedItem === slot) this.unequipItem();
        }
        this._changed();
        return true;
    }

    removeItemById(id, quantity = 1) {
        let left = Math.max(1, Math.floor(quantity || 1));
        const areas = [['bag', this.slots], ['belt', this.quickSlots]];
        for (const [area, arr] of areas) {
            const lim = this._areaLimit(area);
            for (let i = 0; i < lim && left > 0; i++) {
                const s = arr[i];
                if (!s || s.id !== id) continue;
                const take = Math.min(left, s.stackable ? (s.quantity || 1) : 1);
                if (s.stackable && (s.quantity || 1) > take) s.quantity -= take;
                else {
                    arr[i] = null;
                    if (this.equippedItem === s) this.unequipItem();
                }
                left -= take;
            }
        }
        if (left < Math.max(1, Math.floor(quantity || 1))) {
            this._changed();
            return true;
        }
        return false;
    }

    hasItemId(id) {
        return this.items.some((it) => it && it.id === id);
    }

    // Mueve/mezcla entre cinturón y mochila. Devuelve true si cambió algo.
    moveItem(fromArea, fromIdx, toArea, toIdx) {
        if (fromArea !== 'belt' && fromArea !== 'bag') return false;
        if (toArea !== 'belt' && toArea !== 'bag') return false;
        const fromArr = this._areaArr(fromArea);
        const toArr = this._areaArr(toArea);
        if (fromIdx < 0 || fromIdx >= this._areaLimit(fromArea)) return false;
        if (toIdx < 0 || toIdx >= this._areaLimit(toArea)) return false;
        if (fromArea === toArea && fromIdx === toIdx) return true;
        const a = fromArr[fromIdx];
        if (!a) return false;
        const b = toArr[toIdx];
        if (b && a.stackable && b.stackable && this._sameStack(a, b)) {
            const max = this._maxStack(b);
            const space = Math.max(0, max - (b.quantity || 0));
            if (space > 0) {
                const take = Math.min(space, a.quantity || 1);
                b.quantity = (b.quantity || 0) + take;
                if (a.stackable && (a.quantity || 1) > take) a.quantity -= take;
                else fromArr[fromIdx] = null;
                this._changed();
                return true;
            }
        }
        fromArr[fromIdx] = b || null;
        toArr[toIdx] = a;
        this._changed();
        return true;
    }

    // Mueve un objeto al primer hueco de la mochila. Devuelve el índice o -1.
    moveToBag(area, idx) {
        const free = this.firstEmpty('bag');
        if (free < 0) return -1;
        return this.moveItem(area, idx, 'bag', free) ? free : -1;
    }

    // ---------- Equipar / usar ----------
    equipItem(item) {
        if (!item || !this.findSlot(item)) return false;
        try {
            if (item && !item.model && item.toolType) {
                for (const k in ITEM_DEFINITIONS) {
                    const d = ITEM_DEFINITIONS[k];
                    if (d.toolType === item.toolType && d.createModel) { item.model = d.createModel(); break; }
                }
            }
            if (typeof attachToolModel === 'function') attachToolModel(item, null);
        } catch (e) {}

        if (this.equippedItem === item) return true;

        if (this.equippedItem?.model) this.equippedItem.model.visible = false;
        if (item.model) item.model.visible = true;
        this.equippedItem = item;

        if (item.toolType) this.player.currentTool = item.toolType;

        if (item.ammoType) {
            this.ensureWeaponMagazine(item);
            if ((item.magazine || 0) <= 0 && this.countAmmo(item.ammoType) > 0) this.reloadWeapon();
        }

        this._changed();
        updateActionButton();
        return true;
    }

    unequipItem() {
        if (this.equippedItem?.model) this.equippedItem.model.visible = false;
        this.equippedItem = null;
        this._changed();
    }

    useItem(item) {
        if (!item || item.type !== 'consumable') return false;
        if (item.healAmount > 0) {
            if (this.player.health >= (this.player.maxHealth || 100)) {
                this._notify('Vida al máximo');
                return false;
            }
            this.player.health = Math.min(this.player.maxHealth || 100, this.player.health + (item.healAmount || 30));
            try { this.player.updateStatsHUD(); playSound('health-regen'); } catch (e) {}
            return this.removeItem(item, 1);
        }
        this._notify('Ese consumible no se puede usar');
        return false;
    }

    // ---------- Armas / recarga ----------
    getMagazineSize(item) {
        if (!item) return 0;
        if (typeof item.magazineSize === 'number' && item.magazineSize > 0) return item.magazineSize;
        const byType = { pistol: 12, rifle: 30, shotgun: 6, energy: 20 };
        return byType[item.ammoType] || 12;
    }

    ensureWeaponMagazine(item) {
        if (!item || !item.ammoType) return;
        if (typeof item.magazineSize !== 'number' || item.magazineSize <= 0) {
            item.magazineSize = this.getMagazineSize(item);
        }
        if (typeof item.magazine !== 'number' || item.magazine < 0) item.magazine = 0;
        if (item.magazine > item.magazineSize) item.magazine = item.magazineSize;
    }

    reloadWeapon() {
        const item = this.equippedItem;
        if (!item || !item.ammoType) return false;
        this.ensureWeaponMagazine(item);
        const magSize = item.magazineSize;
        const cur = item.magazine || 0;
        if (cur >= magSize) {
            try { if (typeof lvToast === 'function') lvToast('Cargador lleno'); } catch (e) {}
            return false;
        }
        const reserve = this.countAmmo(item.ammoType);
        if (reserve <= 0) {
            try { playSound('weapon_empty'); } catch (e) {}
            try { if (typeof lvToast === 'function') lvToast('Sin balas de reserva'); } catch (e) {}
            return false;
        }
        const take = Math.min(magSize - cur, reserve);
        this.removeAmmo(item.ammoType, take);
        item.magazine = cur + take;
        try { playSound('ammo-pickup'); } catch (e) {}
        this.updateAmmoUI();
        try { if (typeof shootCooldown !== 'undefined') shootCooldown = Math.max(shootCooldown || 0, 0.55); } catch (e) {}
        this._changed();
        return true;
    }

    getMaxAmmo(type) {
        // Ya no hay tope global: el límite es el espacio físico de la mochila.
        return 9999;
    }

    // ---------- Mochila: mejoras ----------
    upgradeBackpack(tier) {
        const t = Math.max(0, Math.min(INV_BAG_TIERS.length - 1, Math.floor(tier || 0)));
        if (t <= this.bagTier) return false;
        this.bagTier = t;
        this._changed();
        try { if (typeof lvToast === 'function') lvToast('Mochila: ' + this.bagTierName + ' (' + this.capacity + ' espacios)'); } catch (e) {}
        return true;
    }

    resetAll() {
        this.slots = new Array(this.slots.length || INV_MAX_BAG_SLOTS).fill(null);
        for (let i = 0; i < this.quickSlots.length; i++) this.quickSlots[i] = null;
        this.bagTier = 0;
        this.equippedItem = null;
        this.selectedSlot = 0;
        this.craftedFlags = {};
        this._keys = [];
        this._changed();
    }

    // ---------- Llaves ----------
    addKey(keyId, keyName) {
        if (!this._keys.some(k => k.id === keyId)) {
            this._keys.push({ id: keyId, name: keyName });
            this._changed();
            return true;
        }
        return false;
    }
    hasKey(keyId) {
        return this._keys.some(k => k.id === keyId);
    }
    removeKey(keyId) {
        const i = this._keys.findIndex(k => k.id === keyId);
        if (i < 0) return false;
        this._keys.splice(i, 1);
        this._changed();
        return true;
    }

    spendResources(cost) {
        if (!cost) return true;
        for (const k in cost) {
            if (this.countResource(k) < cost[k]) return false;
        }
        for (const k in cost) this.removeResource(k, cost[k]);
        return true;
    }

    // ---------- Refresco de UI ----------
    _notify(msg) {
        try {
            if (typeof lvToast === 'function') lvToast(msg);
            else if (typeof showMessage === 'function') showMessage(msg);
        } catch (e) {}
    }

    _changed() {
        try { this.updateInventoryUI(); } catch (e) {}
        try { this.updateQuickSlotUI(); } catch (e) {}
        try { this.updateAmmoUI(); } catch (e) {}
        try { this.updateWeaponHUD(); } catch (e) {}
        try { if (typeof updateResourceHUD === 'function') updateResourceHUD(); } catch (e) {}
        try { if (typeof invOpen !== 'undefined' && invOpen && typeof refreshInvModal === 'function') refreshInvModal(); } catch (e) {}
        try { if (typeof refreshCraftUI === 'function') refreshCraftUI(); } catch (e) {}
        try {
            if (typeof benchOpen !== 'undefined' && benchOpen && typeof renderBenchBaseUI === 'function') {
                renderBenchBaseUI(typeof currentBench !== 'undefined' ? currentBench : null);
            }
        } catch (e) {}
        try {
            if (typeof pauseUI !== 'undefined' && pauseUI.activeTab === 'craft' && typeof refreshTechTreeState === 'function') {
                refreshTechTreeState();
            }
        } catch (e) {}
    }

    // HUD lateral legado (oculto): resumen corto.
    updateInventoryUI() {
        const inventoryDiv = document.getElementById('inventory');
        if (!inventoryDiv) return;
        let html = '<h3>Mochila ' + this.usedBagSlots + '/' + this.capacity + '</h3>';
        if (this._keys.length) {
            html += '<div class="keys"><h4>Llaves</h4><ul>';
            this._keys.forEach(key => { html += '<li>' + key.name + '</li>'; });
            html += '</ul></div>';
        }
        inventoryDiv.innerHTML = html;
    }

    updateAmmoUI() {
        const ammoDiv = document.getElementById('ammo');
        const ammoTypeDiv = document.getElementById('ammoType');
        if (!ammoDiv || !ammoTypeDiv) return;
        if (this.equippedItem?.ammoType) {
            this.ensureWeaponMagazine(this.equippedItem);
            const mag = this.equippedItem.magazine || 0;
            const magSize = this.equippedItem.magazineSize || this.getMagazineSize(this.equippedItem);
            const reserve = this.countAmmo(this.equippedItem.ammoType);
            ammoDiv.textContent = `${mag}/${magSize} | ${reserve}`;
            ammoTypeDiv.textContent = 'R RECARGAR · ' + String(this.equippedItem.ammoType).toUpperCase();
            if (mag <= 0) ammoDiv.style.color = 'red';
            else if (mag / magSize < 0.35) ammoDiv.style.color = '#ffcc66';
            else ammoDiv.style.color = 'white';
        } else {
            ammoDiv.textContent = '';
            ammoTypeDiv.textContent = '';
        }
    }

    updateWeaponHUD() {
        const weaponDiv = document.getElementById('weaponInfo');
        if (!weaponDiv) return;
        const hud = document.getElementById('weaponHud');
        const hasItem = !!this.equippedItem;
        if (hud) hud.style.display = hasItem ? 'block' : 'none';
        if (this.equippedItem) weaponDiv.textContent = this.equippedItem.name;
        else weaponDiv.textContent = 'MANOS';
    }

    // ---------- Cinturón / atajos ----------
    quickSelect(slotIndex) {
        if (slotIndex < 0 || slotIndex >= this.quickSlots.length) return;
        const item = this.quickSlots[slotIndex];
        if (!item) {
            this.unequipItem();
            this.player.currentTool = TOOLS.HANDS;
            updateActionButton();
            this.updateQuickSlotUI();
            this.player.updateToolHUD();
            return;
        }
        if (item.type === 'consumable' && item.healAmount > 0) {
            this.useItem(item);
            this.updateQuickSlotUI();
            return;
        }
        if (item.toolType || item.type === 'weapon') {
            this.equipItem(item);
            this.player.currentTool = item.toolType || TOOLS.HANDS;
            updateActionButton();
        } else if (item.type === 'ammo' || item.type === 'resource') {
            this._notify('Ese espacio guarda ' + item.name + ' (no se equipa)');
        } else {
            this._notify(item.name + ' no se puede equipar');
        }
        this.updateQuickSlotUI();
        this.player.updateToolHUD();
    }

    assignToQuickSlot(item, slotIndex) {
        if (slotIndex < 0 || slotIndex >= this.quickSlots.length) return false;
        const loc = this.findSlot(item);
        if (!loc) return false;
        if (loc.area === 'belt') return this.moveItem('belt', loc.idx, 'belt', slotIndex);
        return this.moveItem('bag', loc.idx, 'belt', slotIndex);
    }

    clearQuickSlot(slotIndex) {
        if (slotIndex < 0 || slotIndex >= this.quickSlots.length) return false;
        if (!this.quickSlots[slotIndex]) return true;
        const free = this.firstEmpty('bag');
        if (free < 0) {
            this._notify('Mochila llena: no puedo moverlo');
            return false;
        }
        return this.moveItem('belt', slotIndex, 'bag', free);
    }

    updateQuickSlotUI() {
        const quickSlotElements = document.querySelectorAll('#quickSlots .quick-slot');
        quickSlotElements.forEach((el) => {
            const index = parseInt(el.getAttribute('data-slot'), 10);
            if (isNaN(index)) return;
            el.innerHTML = '';
            el.classList.remove('active', 'empty');
            const item = this.quickSlots[index];
            const icon = document.createElement('div');
            icon.className = 'quick-slot-icon';
            if (item) {
                icon.textContent = (typeof itemIcon === 'function') ? itemIcon(item) : '❔';
                el.setAttribute('title', item.name + (item.quantity > 1 ? ' x' + item.quantity : ''));
                if (item.stackable && (item.quantity || 1) > 1) {
                    const q = document.createElement('span');
                    q.className = 'quick-slot-qty';
                    q.textContent = item.quantity;
                    el.appendChild(q);
                }
                el.oncontextmenu = (e) => { e.preventDefault(); this.clearQuickSlot(index); };
                if (this.equippedItem === item) el.classList.add('active');
            } else {
                el.removeAttribute('title');
                icon.textContent = '＋';
                icon.style.opacity = '0.5';
                el.classList.add('empty');
                el.oncontextmenu = (e) => { e.preventDefault(); this.clearQuickSlot(index); };
            }
            const keyNum = document.createElement('div');
            keyNum.className = 'quick-slot-key';
            keyNum.textContent = index + 1;
            el.appendChild(icon);
            el.appendChild(keyNum);
        });
    }
}
