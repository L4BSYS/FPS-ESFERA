// js/05-inventory.js (part 5/16). LaGrieta FPS — classic scripts share globals. LOAD ORDER MATTERS, do not reorder.
// ==== Inventory System (ficha + tiers de mochila de Sebastian) ====
// Capacidad real = INV_BAG_TIERS[bagTier].slots. Items densos en this.items[].
const INV_BAG_TIERS = [
    { tier: 0, name: 'Bolsillos', slots: 8, desc: 'Lo que llevás encima desde el principio.' },
    { tier: 1, name: 'Mochila de lona', slots: 14, desc: 'Primera mochila: +6 espacios.' },
    { tier: 2, name: 'Mochila reforzada', slots: 20, desc: 'Costuras y remaches: +6 espacios.' },
    { tier: 3, name: 'Mochila de explorador', slots: 26, desc: 'Equipo de expedición: +6 espacios.' }
];
const INV_MAX_BAG_SLOTS = INV_BAG_TIERS[INV_BAG_TIERS.length - 1].slots;

  class Inventory {
      constructor(player, maxSlots) {
          this.player = player;
          this.bagTier = 0;
          const tier0 = INV_BAG_TIERS[0].slots;
          this.maxSlots = (typeof maxSlots === 'number' && maxSlots > 0) ? maxSlots : tier0;
          this.items = [];
          this.equippedItem = null;
          this.selectedSlot = 0;
          this.craftedFlags = {};
          this._resourceStacksReady = false;
          
          // Initialize ammo types from ITEM_DEFINITIONS
          this.ammo = {
              pistol: 30,    // Starting pistol ammo (se materializa en ficha al migrar)
              rifle: 0,
              shotgun: 0,
              energy: 0
          };
          
          // Mirror de stacks de recurso (legacy readers: HUD, build, craft)
          this.resources = {
            wood: 0,
            stone: 0,
            metal: 0,
            keys: []
          };
          
          // Cinturón 1-5: posee la herramienta (no es atajo a mochila)
          this.quickSlots = [null, null, null, null, null];
      }

      canPlaceOnBelt(item) {
          if (!item) return false;
          if (item.type === 'resource' || item.resourceKey) return false;
          if (item.type === 'ammo') return false;
          if (item.type === 'consumable' || item.healAmount > 0 || item.damageAmount > 0) return false;
          if (item.id === 'bandage' || item.id === 'food' || item.id === 'toxin') return false;
          return !!(item.toolType || item.type === 'weapon' || item.type === 'tool');
      }

      ownsToolType(toolType) {
          if (!toolType) return false;
          if (this.items.some(i => i && i.toolType === toolType)) return true;
          if (this.quickSlots.some(i => i && i.toolType === toolType)) return true;
          return false;
      }

      findItemEverywhere(pred) {
          for (let i = 0; i < this.items.length; i++) {
              if (pred(this.items[i], 'bag', i)) return { item: this.items[i], where: 'bag', index: i };
          }
          for (let i = 0; i < this.quickSlots.length; i++) {
              const it = this.quickSlots[i];
              if (it && pred(it, 'belt', i)) return { item: it, where: 'belt', index: i };
          }
          return null;
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

      /** Sube el tier de mochila (1..3). No baja. Devuelve true si cambió. */
      upgradeBackpack(tier) {
          const t = Math.max(0, Math.min(INV_BAG_TIERS.length - 1, tier | 0));
          if (t <= (this.bagTier | 0)) return false;
          this.bagTier = t;
          this.maxSlots = INV_BAG_TIERS[t].slots;
          try {
              if (typeof lvToast === 'function') {
                  lvToast('Mochila: ' + this.bagTierName + ' (' + this.capacity + ' espacios)');
              }
          } catch (e) {}
          try { if (typeof refreshInvModal === 'function') refreshInvModal(); } catch (e) {}
          try { if (typeof refreshTechTreeState === 'function') refreshTechTreeState(); } catch (e) {}
          return true;
      }

      backpackSlotCount() {
          return this.items.length;
      }

      backpackHasSpace(forItem) {
          if (forItem && forItem.stackable) {
              const existing = this.items.find(i =>
                  i.id === forItem.id && i.type === forItem.type &&
                  (i.quantity || 0) < (i.maxStack || Infinity)
              );
              if (existing) return true;
          }
          return this.items.length < this.capacity;
      }

      syncResourceCounters() {
          const sums = { wood: 0, stone: 0, metal: 0 };
          this.items.forEach(it => {
              if (!it || it.type !== 'resource') return;
              const k = it.resourceKey || it.id;
              if (sums[k] != null) sums[k] += (it.quantity || 0);
          });
          this.resources.wood = sums.wood;
          this.resources.stone = sums.stone;
          this.resources.metal = sums.metal;
      }

      syncAmmoFromStacks() {
          const sums = { pistol: 0, rifle: 0, shotgun: 0, energy: 0 };
          this.items.forEach(it => {
              if (!it || it.type !== 'ammo' || !it.ammoType) return;
              if (sums[it.ammoType] == null) return;
              sums[it.ammoType] += (it.quantity || 0);
          });
          Object.keys(sums).forEach(t => {
              this.ammo[t] = Math.min(sums[t], this.getMaxAmmo(t));
          });
          try { this.updateAmmoUI(); } catch (e) {}
      }

      ensureResourceStacksMigrated() {
          if (this._resourceStacksReady) return;
          this._resourceStacksReady = true;
          ['wood', 'stone', 'metal'].forEach(k => {
              const have = this.items
                  .filter(it => it && it.type === 'resource' && (it.resourceKey || it.id) === k)
                  .reduce((n, it) => n + (it.quantity || 0), 0);
              const legacy = this.resources[k] || 0;
              if (legacy > have) {
                  this._addResourceStackOnly(k, legacy - have);
              }
          });
          // Balas iniciales del pool → ficha en mochila
          const ammoHave = this.items
              .filter(it => it && it.type === 'ammo' && it.ammoType === 'pistol')
              .reduce((n, it) => n + (it.quantity || 0), 0);
          if ((this.ammo.pistol || 0) > ammoHave) {
              this._addAmmoStackOnly('pistol', (this.ammo.pistol || 0) - ammoHave);
          }
          this.syncResourceCounters();
          this.syncAmmoFromStacks();
          this.normalizeResourceStackCaps();
      }

      _resourceDef(key) {
          const map = { wood: 'res_wood', stone: 'res_stone', metal: 'res_metal' };
          const dk = map[key];
          return (dk && ITEM_DEFINITIONS[dk]) ? ITEM_DEFINITIONS[dk] : {
              id: key, name: key, type: 'resource', resourceKey: key, stackable: true, maxStack: 10
          };
      }

      _addResourceStackOnly(key, amount) {
          let left = amount || 0;
          if (left <= 0) return 0;
          const def = this._resourceDef(key);
          const cap = def.maxStack || 10;
          let added = 0;
          for (let i = 0; i < this.items.length && left > 0; i++) {
              const it = this.items[i];
              if (!it || it.type !== 'resource' || (it.resourceKey || it.id) !== key) continue;
              if ((it.maxStack || cap) > cap) it.maxStack = cap;
              const space = (it.maxStack || cap) - (it.quantity || 0);
              if (space <= 0) continue;
              const take = Math.min(space, left);
              it.quantity = (it.quantity || 0) + take;
              left -= take;
              added += take;
          }
          while (left > 0 && this.items.length < this.maxSlots) {
              const take = Math.min(left, cap);
              this.items.push({
                  id: def.id || key,
                  name: def.name || key,
                  type: 'resource',
                  resourceKey: key,
                  stackable: true,
                  maxStack: cap,
                  quantity: take
              });
              left -= take;
              added += take;
          }
          return added;
      }

      // Parte stacks viejos (>10) al techo actual de recursos
      normalizeResourceStackCaps() {
          const overflow = [];
          for (let i = 0; i < this.items.length; i++) {
              const it = this.items[i];
              if (!it || it.type !== 'resource') continue;
              const key = it.resourceKey || it.id;
              const def = this._resourceDef(key);
              const cap = def.maxStack || 10;
              it.maxStack = cap;
              if ((it.quantity || 0) <= cap) continue;
              let extra = it.quantity - cap;
              it.quantity = cap;
              while (extra > 0) {
                  const take = Math.min(extra, cap);
                  overflow.push({
                      id: def.id || key,
                      name: def.name || it.name || key,
                      type: 'resource',
                      resourceKey: key,
                      stackable: true,
                      maxStack: cap,
                      quantity: take
                  });
                  extra -= take;
              }
          }
          overflow.forEach((stack) => {
              if (this.items.length < this.maxSlots) this.items.push(stack);
              else this._addResourceStackOnly(stack.resourceKey, stack.quantity);
          });
          this.syncResourceCounters();
      }

      addResource(key, amount) {
          this.ensureResourceStacksMigrated();
          const n = this._addResourceStackOnly(key, amount || 1);
          this.syncResourceCounters();
          this.updateInventoryUI();
          return n > 0;
      }

      spendResource(key, amount) {
          this.ensureResourceStacksMigrated();
          let need = amount || 1;
          if (this.getResourceCount(key) < need) return false;
          for (let i = this.items.length - 1; i >= 0 && need > 0; i--) {
              const it = this.items[i];
              if (!it || it.type !== 'resource' || (it.resourceKey || it.id) !== key) continue;
              const q = it.quantity || 0;
              if (q <= need) {
                  need -= q;
                  this.items.splice(i, 1);
              } else {
                  it.quantity = q - need;
                  need = 0;
              }
          }
          this.syncResourceCounters();
          this.updateInventoryUI();
          return need === 0;
      }

      getResourceCount(key) {
          this.ensureResourceStacksMigrated();
          return this.resources[key] || 0;
      }

      _addAmmoStackOnly(ammoType, amount) {
          let left = amount || 0;
          if (left <= 0) return 0;
          const maxStack = this.getMaxAmmo(ammoType) || 60;
          const id = ammoType === 'pistol' ? 'pistol_ammo' : (ammoType + '_ammo');
          const name = ammoType === 'pistol' ? 'Balas de pistola' : ('Munición ' + ammoType);
          let added = 0;
          for (let i = 0; i < this.items.length && left > 0; i++) {
              const it = this.items[i];
              if (!it || it.type !== 'ammo' || it.ammoType !== ammoType) continue;
              const space = (it.maxStack || maxStack) - (it.quantity || 0);
              if (space <= 0) continue;
              const take = Math.min(space, left);
              it.quantity = (it.quantity || 0) + take;
              left -= take;
              added += take;
          }
          while (left > 0 && this.items.length < this.maxSlots) {
              const take = Math.min(left, maxStack);
              this.items.push({
                  id: id,
                  name: name,
                  type: 'ammo',
                  ammoType: ammoType,
                  stackable: true,
                  maxStack: maxStack,
                  quantity: take
              });
              left -= take;
              added += take;
          }
          return added;
      }

      spendAmmoFromStacks(ammoType, amount) {
          let need = amount || 1;
          for (let i = this.items.length - 1; i >= 0 && need > 0; i--) {
              const it = this.items[i];
              if (!it || it.type !== 'ammo' || it.ammoType !== ammoType) continue;
              const q = it.quantity || 0;
              if (q <= need) {
                  need -= q;
                  this.items.splice(i, 1);
              } else {
                  it.quantity = q - need;
                  need = 0;
              }
          }
          this.syncAmmoFromStacks();
          this.updateInventoryUI();
          return need === 0;
      }
      
      // Add an item to inventory (now handles all our defined item types)
      addItem(item) {
          this.ensureResourceStacksMigrated();
          // Handle ammo pickups → ficha que alimenta el pool
          if (item.type === 'ammo') {
              return this.addAmmo(item.ammoType, item.amount || item.quantity || 1);
          }
          // Resource pickups (branch/pebble/scrap) → stack de recurso
          if (item.type === 'resource' && item.resourceKey) {
              return this.addResource(item.resourceKey, item.amount || item.quantity || 1);
          }
          if (item.type === 'resource' && (item.id === 'wood' || item.id === 'stone' || item.id === 'metal')) {
              return this.addResource(item.id, item.quantity || 1);
          }

          // Try to stack if possible
          if (this.tryStackItem(item)) {
              return true;
          }

          if (this.items.length >= this.maxSlots) {
              console.log("¡Mochila llena!");
              return false;
          }
          
          // Add new item to inventory
          this.items.push({
              ...item,
              quantity: item.quantity || 1
          });
          
          this.updateInventoryUI();
          return true;
      }
      
      // Improved stack handling
      tryStackItem(item) {
          if (!item.stackable) return false;
          
          // Find existing stack of same type
          const existing = this.items.find(i => 
              i.id === item.id && 
              i.quantity < (i.maxStack || Infinity)
          );
          
          if (existing) {
              const remainingSpace = (existing.maxStack || Infinity) - existing.quantity;
              const toAdd = Math.min(remainingSpace, item.quantity || 1);
              
              existing.quantity += toAdd;
              
              // If we have leftover items, try to create another stack
              if (item.quantity && (item.quantity - toAdd) > 0) {
                  return this.addItem({
                      ...item,
                      quantity: item.quantity - toAdd
                  });
              }
              
              this.updateInventoryUI();
              return true;
          }
          return false;
      }
      
      // Remove item from backpack (no del cinturón; usar clearQuickSlot / moveFromBelt)
      removeItem(item, quantity = 1) {
          const index = this.items.indexOf(item);
          if (index === -1) return false;
          
          if (item.stackable && item.quantity > quantity) {
              item.quantity -= quantity;
          } else {
              this.items.splice(index, 1);
              if (this.equippedItem === item) {
                  this.unequipItem();
              }
              try { if (typeof detachOrphanToolModels === 'function') detachOrphanToolModels(); } catch (e) {}
          }
          if (item.type === 'resource') this.syncResourceCounters();
          if (item.type === 'ammo') this.syncAmmoFromStacks();
          this.updateInventoryUI();
          return true;
      }
      
      // Equip an item (mochila o cinturón)
      equipItem(item) {
          if (!item) return false;
          const owned = this.items.includes(item) || this.quickSlots.includes(item);
          if (!owned) {
              return false;
          }
          try {
              if (item && !item.model && item.toolType) {
                  for (const k in ITEM_DEFINITIONS) {
                      const d = ITEM_DEFINITIONS[k];
                      if (d.toolType === item.toolType && d.createModel) { item.model = d.createModel(); break; }
                  }
              }
              if (typeof attachToolModel === 'function') attachToolModel(item, null);
          } catch (e) {}

          // Skip if already equipped
          if (this.equippedItem === item) return true;

          // Hide previous item model
          if (this.equippedItem?.model) {
              this.equippedItem.model.visible = false;
          }

          // Show new item model
          if (item.model) {
              item.model.visible = true;
          }

          this.equippedItem = item;

          // Update player's current tool if this is a tool item
          if (item.toolType) {
              this.player.currentTool = item.toolType;
          }

          // Armas: asegurar cargador; si está vacío y hay reserva, recargar al equipar.
          if (item.ammoType) {
              this.ensureWeaponMagazine(item);
              if ((item.magazine || 0) <= 0 && (this.ammo[item.ammoType] || 0) > 0) {
                  this.reloadWeapon();
              }
          }

          this.updateInventoryUI();
          this.updateWeaponHUD();
          this.updateAmmoUI();
          updateActionButton(); // Update mobile button

          return true;
      }

      unequipItem() {
          if (this.equippedItem?.model) {
              this.equippedItem.model.visible = false;
          }
          this.equippedItem = null;
          this.updateInventoryUI();
          this.updateWeaponHUD();
          this.updateAmmoUI();
      }
      
      // Use a consumable item (now works with food/toxin)
      useItem(item) {
          if (!item || item.type !== 'consumable') return false;
          
          switch (item.id) {
              case 'food':
                  if (this.player.health >= 100) {
                      console.log("Health already full!");
                      return false;
                  }
                  this.player.health = Math.min(100, this.player.health + (item.healAmount || 30));
                  playSound('health-regen');
                  break;
                  
              case 'toxin':
                  // Could implement some special effect here
                  console.log("Toxin used - no effect on self");
                  break;
                  
              default:
                  console.log("Unknown consumable:", item.id);
                  return false;
          }
          
          // Remove item or decrement quantity
          return this.removeItem(item, 1);
      }
      
      // Balas: ficha en mochila alimenta el pool (ammo{} es mirror)
      addAmmo(type, amount) {
          if (this.ammo[type] === undefined) return false;
          this.ensureResourceStacksMigrated();
          const room = this.getMaxAmmo(type) - (this.ammo[type] || 0);
          if (room <= 0) return false;
          const take = Math.min(amount || 1, room);
          const added = this._addAmmoStackOnly(type, take);
          this.syncAmmoFromStacks();
          this.updateInventoryUI();
          return added > 0;
      }
      
      useAmmo(type, amount) {
          this.ensureResourceStacksMigrated();
          this.syncAmmoFromStacks();
          if (this.ammo[type] === undefined || this.ammo[type] < (amount || 1)) {
              playSound('weapon_empty');
              return false;
          }
          const ok = this.spendAmmoFromStacks(type, amount || 1);
          if (!ok) playSound('weapon_empty');
          return ok;
      }

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
          if (typeof item.magazine !== 'number' || item.magazine < 0) {
              item.magazine = 0;
          }
          if (item.magazine > item.magazineSize) item.magazine = item.magazineSize;
      }

      // R: llenar cargador desde la reserva.
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
          this.syncAmmoFromStacks();
          const reserve = this.ammo[item.ammoType] || 0;
          if (reserve <= 0) {
              playSound('weapon_empty');
              try { if (typeof lvToast === 'function') lvToast('Sin balas de reserva'); } catch (e) {}
              return false;
          }
          const take = Math.min(magSize - cur, reserve);
          if (!this.spendAmmoFromStacks(item.ammoType, take)) {
              playSound('weapon_empty');
              return false;
          }
          item.magazine = cur + take;
          try { playSound('ammo-pickup'); } catch (e) {}
          this.updateAmmoUI();
          try { if (typeof shootCooldown !== 'undefined') shootCooldown = Math.max(shootCooldown || 0, 0.55); } catch (e) {}
          return true;
      }
      
      // Get max ammo capacity (reserva)
      getMaxAmmo(type) {
          const maxAmmo = {
              pistol: 60,
              rifle: 180,
              shotgun: 40,
              energy: 100
          };
          return maxAmmo[type] || 0;
      }
      
      // Key management (unchanged)
      addKey(keyId, keyName) {
          if (!this.resources.keys.some(k => k.id === keyId)) {
              this.resources.keys.push({ id: keyId, name: keyName });
              this.updateInventoryUI();
              return true;
          }
          return false;
      }
      
      hasKey(keyId) {
          return this.resources.keys.some(k => k.id === keyId);
      }

      removeKey(keyId) {
          const i = this.resources.keys.findIndex(k => k.id === keyId);
          if (i < 0) return false;
          this.resources.keys.splice(i, 1);
          this.updateInventoryUI();
          return true;
      }
      
      // Improved inventory UI
      updateInventoryUI() {
          const inventoryDiv = document.getElementById('inventory');
          if (!inventoryDiv) return;
          
          let html = '<h3>Mochila</h3><ul>';
          
          // List items with quantity and equipped indicator
          this.items.forEach(item => {
              const equippedClass = this.equippedItem === item ? ' class="equipped"' : '';
              html += `<li${equippedClass}>`;
              
              html += `${item.name} ${itemIcon(item)}`;
              
              // Show quantity if stackable
              if (item.stackable && item.quantity > 1) {
                  html += ` (${item.quantity})`;
              }
              
              html += '</li>';
          });
          
          html += '</ul>';
          
          // Show keys separately
          if (this.resources.keys.length > 0) {
              html += '<div class="keys"><h4>Llaves</h4><ul>';
              this.resources.keys.forEach(key => {
                  html += `<li>${key.name}</li>`;
              });
              html += '</ul></div>';
          }
          
          inventoryDiv.innerHTML = html;
      }
      
      // Update ammo display in HUD
      updateAmmoUI() {
          const ammoDiv = document.getElementById('ammo');
          const ammoTypeDiv = document.getElementById('ammoType');
          
          if (!ammoDiv || !ammoTypeDiv) return;
          
          if (this.equippedItem?.ammoType) {
              this.ensureWeaponMagazine(this.equippedItem);
              const mag = this.equippedItem.magazine || 0;
              const magSize = this.equippedItem.magazineSize || this.getMagazineSize(this.equippedItem);
              const reserve = this.ammo[this.equippedItem.ammoType] || 0;
              // Formato FPS: cargador | reserva
              ammoDiv.textContent = `${mag}/${magSize} | ${reserve}`;
              ammoTypeDiv.textContent = 'R RECARGAR · ' + (this.equippedItem.ammoType === 'pistol' ? 'PISTOLA' : String(this.equippedItem.ammoType).toUpperCase());

              if (mag <= 0) {
                  ammoDiv.style.color = 'red';
              } else if (mag / magSize < 0.35) {
                  ammoDiv.style.color = '#ffcc66';
              } else {
                  ammoDiv.style.color = 'white';
              }
          } else {
              ammoDiv.textContent = '';
              ammoTypeDiv.textContent = '';
          }
      }
      
      // Update weapon name display
      updateWeaponHUD() {
          const weaponDiv = document.getElementById('weaponInfo');
          if (!weaponDiv) return;
          const hud = document.getElementById('weaponHud');
          const hasItem = !!this.equippedItem;
          if (hud) hud.style.display = hasItem ? 'block' : 'none';

          if (this.equippedItem?.type === 'weapon') {
              weaponDiv.textContent = `${this.equippedItem.name}`;
          } else if (this.equippedItem?.type === 'tool') {
              weaponDiv.textContent = `${this.equippedItem.name}`;
          } else {
              weaponDiv.textContent = 'MANOS';
          }
      }
      
      // Quick access to items (for number keys 1-4)
      quickSelect(slotIndex) {
          if (slotIndex < 0 || slotIndex >= this.quickSlots.length) return;
          
          const item = this.quickSlots[slotIndex];
          // Consumibles no van al cinturón (solo mochila)
          if (item && this.canPlaceOnBelt(item)) {
              this.equipItem(item);
              if (item.toolType) {
                  this.player.currentTool = item.toolType;
              } else {
                  this.player.currentTool = TOOLS.HANDS;
              }
              updateActionButton();
          } else {
              this.unequipItem();
              this.player.currentTool = TOOLS.HANDS;
              updateActionButton();
          }
          this.selectedSlot = slotIndex;
          this.updateQuickSlotUI();
          this.player.updateToolHUD();
      }

      /** Mueve herramienta de mochila → cinturón (sale de la mochila). */
      assignToQuickSlot(item, slotIndex) {
          if (slotIndex < 0 || slotIndex >= this.quickSlots.length) return false;
          if (!item || !this.canPlaceOnBelt(item)) return false;

          // Ya está en este slot
          if (this.quickSlots[slotIndex] === item) return true;

          // Sacarla de otro slot del cinturón
          for (let i = 0; i < this.quickSlots.length; i++) {
              if (this.quickSlots[i] === item) this.quickSlots[i] = null;
          }

          const inBag = this.items.indexOf(item);
          if (inBag === -1 && !this.quickSlots.includes(item)) return false;

          // Evitar dos copias del mismo toolType/id en cinturón
          if (this.quickSlots.some((slot, i) => slot && i !== slotIndex && slot.id === item.id)) {
              return false;
          }

          const displaced = this.quickSlots[slotIndex];
          if (displaced && displaced !== item) {
              if (!this.backpackHasSpace(displaced)) return false;
              this.items.push(displaced);
          }

          if (inBag !== -1) this.items.splice(inBag, 1);
          this.quickSlots[slotIndex] = item;
          this.updateQuickSlotUI();
          this.updateInventoryUI();
          return true;
      }

      /** Cinturón → mochila (si hay espacio). */
      clearQuickSlot(slotIndex) {
          if (slotIndex < 0 || slotIndex >= this.quickSlots.length) return false;
          const item = this.quickSlots[slotIndex];
          if (!item) return true;
          if (!this.backpackHasSpace(item)) {
              try {
                  if (typeof setCraftStatus === 'function') setCraftStatus('Mochila llena — no podés bajar del cinturón');
                  else if (typeof lvToast === 'function') lvToast('Mochila llena');
              } catch (e) {}
              return false;
          }
          this.quickSlots[slotIndex] = null;
          this.items.push(item);
          if (this.equippedItem === item) {
              // Sigue equipada desde mochila
          }
          this.updateQuickSlotUI();
          this.updateInventoryUI();
          return true;
      }

      moveBeltToBag(slotIndex) {
          return this.clearQuickSlot(slotIndex);
      }

      updateQuickSlotUI() {
          const quickSlotElements = document.querySelectorAll('.quick-slot');
          quickSlotElements.forEach((el) => {
              const index = parseInt(el.getAttribute('data-slot'), 10);
              if (isNaN(index)) return;
              el.innerHTML = '';
              el.classList.remove('active');
              
              const item = this.quickSlots[index];
              
              // Create icon/content
              const icon = document.createElement('div');
              icon.className = 'quick-slot-icon';
              
              if (item) {
                  // Item exists - show it
                  if (item.type === 'weapon') {
                      icon.textContent = '🔫';
                  } else if (item.toolType) { // Check toolType instead of item.type
                      icon.textContent = {
                          [TOOLS.HAMMER]: '🔨',
                          [TOOLS.AXE]: '🪓',
                          [TOOLS.PICKAXE]: '⛏️',
                          [TOOLS.TORCH]: '🔥'
                      }[item.toolType] || '❔';
                  } else if (item.healAmount > 0) {
                      icon.textContent = '🍖';
                  } else if (typeof itemIcon === 'function') {
                      icon.textContent = itemIcon(item);
                  }
                  
                  el.setAttribute('title', item.name + (item.healAmount > 0 ? ' — usar/equipar' : ''));
                  el.oncontextmenu = (e) => { e.preventDefault(); this.clearQuickSlot(index); };
                  
                  // Highlight if equipped
                  if (this.equippedItem === item) {
                      el.classList.add('active');
                  }
              } else {
                  el.removeAttribute('title');
                  el.oncontextmenu = (e) => { e.preventDefault(); this.clearQuickSlot(index); };
                  // Empty slot - show placeholder
                  icon.textContent = '＋';
                  icon.style.opacity = '0.5';
              }
              
              // Add key number
              const keyNum = document.createElement('div');
              keyNum.className = 'quick-slot-key';
              keyNum.textContent = index + 1;
              
              el.appendChild(icon);
              el.appendChild(keyNum);
          });
      }
  }
