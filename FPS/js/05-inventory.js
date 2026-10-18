// js/05-inventory.js (part 5/16). LaGrieta FPS — classic scripts share globals. LOAD ORDER MATTERS, do not reorder.
// ==== Inventory System ====
  class Inventory {
      constructor(player, maxSlots = 10) {
          this.player = player;
          this.maxSlots = maxSlots;
          this.items = [];
          this.equippedItem = null;
          this.selectedSlot = 0;
          
          // Initialize ammo types from ITEM_DEFINITIONS
          this.ammo = {
              pistol: 30,    // Starting pistol ammo
              rifle: 0,      // No starting rifle ammo
              shotgun: 0,    // No starting shotgun ammo
              energy: 0      // No starting energy ammo
          };
          
          // Resources (now using our defined consumables)
          this.resources = {
            wood: 0,
            stone: 0,
            metal: 0,
            keys: []
          };
          
          // Quick access slots (1-5)
          this.quickSlots = [null, null, null, null, null];
      }
      
      // Add an item to inventory (now handles all our defined item types)
      addItem(item) {
          // Check if inventory is full (only for non-stackable items)
          if (!item.stackable && this.items.length >= this.maxSlots) {
              console.log("¡Mochila llena!");
              return false;
          }
          
          // Handle ammo pickups directly
          if (item.type === 'ammo') {
              return this.addAmmo(item.ammoType, item.amount);
          }
          
          // Try to stack if possible
          if (this.tryStackItem(item)) {
              return true;
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
      
      // Remove item from inventory
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
              // Limpiar atajos que apuntaban al objeto eliminado
              for (let i = 0; i < this.quickSlots.length; i++) {
                  if (this.quickSlots[i] === item) this.quickSlots[i] = null;
              }
          }
          
          this.updateInventoryUI();
          return true;
      }
      
      // Equip an item (now handles weapon switching better)
      equipItem(item) {
          if (!item || !this.items.includes(item)) {
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
      
      // Add ammo (updated to prevent overflows)
      addAmmo(type, amount) {
          if (this.ammo[type] !== undefined) {
              const newAmount = this.ammo[type] + (amount || 1);
              this.ammo[type] = Math.min(newAmount, this.getMaxAmmo(type));
              this.updateAmmoUI();
              return true;
          }
          return false;
      }
      
      // Use ammo (with better error handling)
      useAmmo(type, amount) {
          if (this.ammo[type] === undefined || this.ammo[type] < (amount || 1)) {
              playSound('weapon_empty');
              return false;
          }
          
          this.ammo[type] -= (amount || 1);
          this.updateAmmoUI();
          return true;
      }
      
      // Get max ammo capacity
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
              const ammoType = this.equippedItem.ammoType;
              const currentAmmo = this.ammo[ammoType] || 0;
              const maxAmmo = this.getMaxAmmo(ammoType);
              
              ammoDiv.textContent = `${currentAmmo}/${maxAmmo}`;
              ammoTypeDiv.textContent = 'BALAS ' + (ammoType === 'pistol' ? 'DE PISTOLA' : ammoType.toUpperCase());
              
              // Visual warning when low on ammo
              if (currentAmmo/maxAmmo < 0.2) {
                  ammoDiv.style.color = 'red';
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
          if (item && item.healAmount > 0 && this.items.includes(item)) {
              // Consumibles: el atajo los usa directamente
              this.player.health = Math.min(this.player.maxHealth || 100, this.player.health + (item.healAmount || 30));
              this.removeItem(item, 1);
              try { this.player.updateStatsHUD(); playSound('health-regen'); } catch (e) {}
              this.updateQuickSlotUI();
              return;
          }
          if (item && this.items.includes(item)) {
              this.equipItem(item);
              // Update player's current tool based on the equipped item
              if (item.toolType) {
                  this.player.currentTool = item.toolType;
              } else {
                  this.player.currentTool = TOOLS.HANDS;
              }
              updateActionButton(); // Update mobile action button
          } else {
              this.unequipItem();
              this.player.currentTool = TOOLS.HANDS;
              updateActionButton(); // Update mobile action button
          }
          this.updateQuickSlotUI();
          this.player.updateToolHUD();
      }

      assignToQuickSlot(item, slotIndex) {
          if (slotIndex < 0 || slotIndex >= this.quickSlots.length) return false;
          if (!this.items.includes(item)) return false;
          
          // Don't allow duplicates in quick slots
          if (this.quickSlots.some(slot => slot?.id === item.id)) return false;
          
          this.quickSlots[slotIndex] = item;
          this.updateQuickSlotUI();
          return true;
      }

      clearQuickSlot(slotIndex) {
          if (slotIndex < 0 || slotIndex >= this.quickSlots.length) return;
          this.quickSlots[slotIndex] = null;
          this.updateQuickSlotUI();
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
