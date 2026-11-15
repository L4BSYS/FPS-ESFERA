// js/27-tech.js — Árbol de tecnología + mejoras de la mesa de trabajo.
// Depende de: CRAFT_RECIPES (02-systems), ITEM_DEFINITIONS (03-worlddata),
// Inventory (05-inventory), worldContainers (23-world-container).

// ============================================================
// 1) ÁRBOL DE TECNOLOGÍA
// ============================================================
// Cada nodo apunta a una receta de CRAFT_RECIPES o a una mejora de la mesa.
// `parents` define los pasos previos que hay que completar.
const TECH_NODES = [
    { id: 'hammer',       recipe: 'hammer',    tier: 0, parents: [],                      icon: '🔨', title: 'Martillo',           desc: 'Con las manos juntás madera y piedra. El martillo abre la construcción y la mesa.' },
    { id: 'torch',        recipe: 'torch',     tier: 0, parents: [],                      icon: '🔥', title: 'Antorcha',           desc: 'Luz portátil para explorar de noche.' },

    { id: 'axe',          recipe: 'axe',       tier: 1, parents: ['hammer'],              icon: '🪓', title: 'Hacha',              desc: 'Corta árboles mucho más rápido.' },
    { id: 'bench',        recipe: 'bench',     tier: 1, parents: ['hammer'],              icon: '🛠️', title: 'Mesa de trabajo',    desc: 'Reclama un área de base y desbloquea el crafteo avanzado.' },

    { id: 'pickaxe',      recipe: 'pickaxe',   tier: 2, parents: ['axe'],                 icon: '⛏️', title: 'Pico',               desc: 'Mina piedra y metal.' },
    { id: 'backpack1',    recipe: 'backpack1', tier: 2, parents: ['hammer'],              icon: '🎒', title: 'Mochila de lona',    desc: '+6 espacios reales para recursos, munición y herramientas.' },
    { id: 'dressing',     recipe: 'dressing',  tier: 2, parents: ['bench'],               icon: '🩹', title: 'Venda',              desc: 'Cura 30 de vida. Se fabrica en la mesa.' },
    { id: 'bench_chest',  kind: 'benchUpgrade', upgrade: 'chest', tier: 2, parents: ['bench'], icon: '🏗️', title: 'Cofre de mesa', desc: 'Mejora de la mesa: almacén propio de 12 espacios para alimentar al dispenser.' },

    { id: 'pistol',       recipe: 'pistol',    tier: 3, parents: ['pickaxe'],             icon: '🔫', title: 'Pistola',            desc: 'Arma de fuego con cargador de 12.' },
    { id: 'ammo',         recipe: 'ammo',      tier: 3, parents: ['pistol'],              icon: '📦', title: 'Balas x12',          desc: 'Munición de reserva. Ahora ocupa espacio en la mochila.' },
    { id: 'backpack2',    recipe: 'backpack2', tier: 3, parents: ['backpack1', 'bench'],  icon: '🎒', title: 'Mochila reforzada', desc: '+6 espacios más. Se hace en la mesa.' },
    { id: 'chest',        recipe: 'chest',     tier: 3, parents: ['bench_chest', 'pickaxe'], icon: '🧰', title: 'Cofre', desc: '12 espacios. Se fabrica después de instalar el cofre de mesa y se coloca dentro del área de la mesa.' },

    { id: 'backpack3',    recipe: 'backpack3', tier: 4, parents: ['backpack2', 'pistol'], icon: '🎒', title: 'Mochila de explorador', desc: '+6 espacios más. Máxima capacidad.' },
    { id: 'bench_dispenser', kind: 'benchUpgrade', upgrade: 'dispenser', tier: 4, parents: ['bench_chest', 'pistol'], icon: '📦', title: 'Dispenser de mesa', desc: 'Mejora de la mesa: produce balas consumiendo metal y madera del almacén o de los cofres asociados.' },
    { id: 'dispenser',    recipe: 'dispenser', tier: 4, parents: ['bench_dispenser'],     icon: '🏭', title: 'Dispenser colocable', desc: 'Se fabrica en la mesa y se coloca en tu base. También consume recursos de la base.' }
];

const TECH_COLUMNS = ['Básicos', 'Herramientas', 'Base', 'Equipo', 'Expedición'];

function techNodeById(id) {
    return TECH_NODES.find(n => n.id === id) || null;
}

function techNodeOwned(node) {
    const inv = getPlayerInv();
    if (!node || !inv) return false;
    if (node.kind === 'benchUpgrade') {
        return (typeof workbenches !== 'undefined') &&
            workbenches.some(w => w && w.hp > 0 && w.upgrades && w.upgrades[node.upgrade]);
    }
    const r = recipeById(node.recipe);
    return !!r && recipeOwned(r, inv);
}

function techNodeReady(node) {
    if (!node) return false;
    return (node.parents || []).every(pid => {
        const p = techNodeById(pid);
        return p ? techNodeOwned(p) : true;
    });
}

function techNodeState(node) {
    const owned = techNodeOwned(node);
    const ready = techNodeReady(node);
    let affordable = false;
    let reason = '';
    if (node.kind === 'benchUpgrade') {
        const wb = (typeof currentBench !== 'undefined') ? currentBench : null;
        const upg = wb && wb.upgrades ? wb.upgrades : null;
        affordable = !!upg && !upg[node.upgrade];
        if (!ready) reason = 'Bloqueado';
        else if (!affordable) reason = owned ? 'Instalado' : 'En la mesa';
        else reason = 'En la mesa';
    } else {
        const r = recipeById(node.recipe);
        if (r) {
            const st = recipeStatus(r);
            affordable = st.ok;
            if (!ready) reason = 'Bloqueado';
            else if (!st.hasReq && r.requiresBenchUpgrade) reason = 'Instalá la mejora de mesa';
            else if (!st.hasReq) reason = 'Falta la herramienta previa';
            else if (r.station === 'bench') reason = 'En la mesa';
            else if (owned && !r.repeatable) reason = 'Listo';
            else if (!affordable) reason = 'Faltan materiales';
            else reason = 'Craftear';
        }
    }
    let cls = owned ? 'done' : (!ready ? 'locked' : (affordable ? 'ready' : 'open'));
    return { owned, ready, affordable, reason, cls };
}

function ensureTechTreeDOM() {
    const wrap = document.getElementById('techTree');
    if (!wrap) return null;
    return wrap;
}

function renderTechTree() {
    const wrap = ensureTechTreeDOM();
    if (!wrap) return;
    wrap.innerHTML = '';
    TECH_COLUMNS.forEach((label, tier) => {
        const col = document.createElement('div');
        col.className = 'rg-tech-col';
        col.dataset.tier = String(tier);
        const head = document.createElement('div');
        head.className = 'rg-tech-col-h';
        head.textContent = label;
        col.appendChild(head);
        TECH_NODES.filter(n => n.tier === tier).forEach(node => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'tech-node';
            btn.dataset.tech = node.id;
            btn.innerHTML =
                '<span class="tech-ico">' + node.icon + '</span>' +
                '<span class="tech-body">' +
                    '<span class="tech-name">' + node.title + '</span>' +
                    '<span class="tech-sub"></span>' +
                '</span>' +
                '<span class="tech-mark"></span>';
            btn.title = node.desc;
            btn.addEventListener('click', () => activateTechNode(node.id));
            col.appendChild(btn);
        });
        wrap.appendChild(col);
    });
    refreshTechTreeState();
    try { drawTechTreeLines(); } catch (e) {}
    requestAnimationFrame(drawTechTreeLines);
    setTimeout(drawTechTreeLines, 80);
}

function refreshTechTreeState() {
    const wrap = document.getElementById('techTree');
    if (!wrap) return;
    if (typeof pauseUI !== 'undefined' && pauseUI.activeTab !== 'craft') return;
    wrap.querySelectorAll('.tech-node').forEach(btn => {
        const node = techNodeById(btn.dataset.tech);
        if (!node) return;
        const st = techNodeState(node);
        btn.classList.remove('done', 'locked', 'ready', 'open');
        btn.classList.add(st.cls);
        let sub = node.desc;
        let mark = '•';
        if (node.kind === 'benchUpgrade') {
            sub = st.owned ? 'Instalado en la mesa' : 'Se instala desde la mesa';
            mark = st.owned ? '✓' : (st.ready ? '🏗️' : '🔒');
        } else {
            const r = recipeById(node.recipe);
            if (r) {
                sub = Object.keys(r.cost).map(k => resIcon(k) + r.cost[k]).join(' ') +
                    (r.station === 'bench' ? ' · 🛠 mesa' : ' · ✋ mano');
                if (st.owned && !r.repeatable) { sub = 'Completado'; mark = '✓'; }
                else if (!st.ready) mark = '🔒';
                else if (r.station === 'bench') mark = '🛠';
                else mark = st.affordable ? '▶' : '·';
            }
        }
        const subEl = btn.querySelector('.tech-sub');
        if (subEl) subEl.textContent = sub;
        const markEl = btn.querySelector('.tech-mark');
        if (markEl) markEl.textContent = mark;
        btn.title = node.title + ' — ' + node.desc + (st.reason ? '\n(' + st.reason + ')' : '');
    });
    try { drawTechTreeLines(); } catch (e) {}
    requestAnimationFrame(drawTechTreeLines);
}

function drawTechTreeLines() {
    const wrap = document.getElementById('techTree');
    if (!wrap) return;
    const old = wrap.querySelector('svg.rg-tech-lines');
    if (old) old.remove();
    const wrapRect = wrap.getBoundingClientRect();
    const w = Math.max(wrap.scrollWidth, wrapRect.width);
    const h = Math.max(wrap.scrollHeight, wrapRect.height);
    if (!w || !h) return;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'rg-tech-lines');
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    wrap.insertBefore(svg, wrap.firstChild);
    TECH_NODES.forEach(node => {
        (node.parents || []).forEach(pid => {
            const a = wrap.querySelector('[data-tech="' + pid + '"]');
            const b = wrap.querySelector('[data-tech="' + node.id + '"]');
            if (!a || !b) return;
            const ar = a.getBoundingClientRect();
            const br = b.getBoundingClientRect();
            const x1 = ar.right - wrapRect.left + wrap.scrollLeft;
            const y1 = ar.top - wrapRect.top + ar.height / 2 + wrap.scrollTop;
            const x2 = br.left - wrapRect.left + wrap.scrollLeft;
            const y2 = br.top - wrapRect.top + br.height / 2 + wrap.scrollTop;
            if (x2 <= x1) return;
            const mx = (x1 + x2) / 2;
            const p = document.createElementNS(NS, 'path');
            p.setAttribute('d', 'M' + x1 + ' ' + y1 + ' C ' + mx + ' ' + y1 + ', ' + mx + ' ' + y2 + ', ' + x2 + ' ' + y2);
            const st = techNodeState(node);
            p.setAttribute('class', 'tech-line ' + (st.owned ? 'done' : (st.ready ? 'ready' : 'locked')));
            svg.appendChild(p);
        });
    });
}

function activateTechNode(id) {
    const node = techNodeById(id);
    if (!node) return;
    if (!techNodeReady(node)) {
        setCraftStatus('Primero completá los pasos anteriores del árbol');
        return;
    }
    if (node.kind === 'benchUpgrade') {
        setCraftStatus('Se instala desde la mesa de trabajo (E en tu mesa)');
        return;
    }
    const r = recipeById(node.recipe);
    if (!r) return;
    if (r.station === 'bench') {
        setCraftStatus('Se fabrica en la mesa de trabajo (E en tu mesa)');
        return;
    }
    const idx = recipeIndexById(r.id);
    if (idx >= 0) craftItem(idx);
    renderTechTree();
}

window.addEventListener('resize', () => {
    try { if (document.getElementById('techTree')) drawTechTreeLines(); } catch (e) {}
});

// ============================================================
// 2) MESA DE TRABAJO: COFRE + DISPENSER
// ============================================================
const BENCH_UPGRADE_COSTS = {
    chest: { wood: 10, stone: 6, metal: 2 },
    dispenser: { metal: 12, stone: 8, wood: 6 }
};
const BENCH_AMMO_COST = { metal: 2, wood: 1 };
const BENCH_AMMO_BATCH = 12;

function linkedChestsFor(wb) {
    if (!wb || typeof worldContainers === 'undefined') return [];
    const radius = wb.claimRadius || (typeof CLAIM_RADIUS !== 'undefined' ? CLAIM_RADIUS : 14);
    return worldContainers.filter(c => {
        if (!c || c.mode !== 'storage') return false;
        return Math.hypot(c.pos.x - wb.pos.x, c.pos.z - wb.pos.z) <= radius + 0.5;
    });
}

// Compatibilidad: helper para resolver el cofre/mesa asociado a un contenedor.
function containerLinkedBench(ref) {
    if (!ref || typeof workbenches === 'undefined') return null;
    const radius = (typeof CLAIM_RADIUS !== 'undefined' ? CLAIM_RADIUS : 14);
    let best = null, bd = Infinity;
    for (const wb of workbenches) {
        if (!wb || wb.hp <= 0) continue;
        const d = Math.hypot(ref.pos.x - wb.pos.x, ref.pos.z - wb.pos.z);
        const r = wb.claimRadius || radius;
        if (d <= r + 0.5 && d < bd) { bd = d; best = wb; }
    }
    return best;
}

function benchStorageTotals(wb) {
    const totals = { wood: 0, stone: 0, metal: 0 };
    if (!wb) return totals;
    const addSlots = (slots) => {
        if (!Array.isArray(slots)) return;
        slots.forEach(s => {
            if (!s) return;
            if (s.type === 'resource' && totals[s.id] !== undefined) totals[s.id] += (s.quantity || 0);
        });
    };
    if (Array.isArray(wb.storage)) addSlots(wb.storage);
    linkedChestsFor(wb).forEach(ref => addSlots(ref.slots));
    return totals;
}

function benchHasStorage(wb) {
    if (!wb) return false;
    return Array.isArray(wb.storage) || linkedChestsFor(wb).length > 0;
}

function benchAddToStorage(wb, key, amount) {
    let left = Math.max(0, Math.floor(amount || 0));
    if (!wb || !left) return 0;
    const want = left;
    const trySlots = (slots) => {
        if (!Array.isArray(slots)) return;
        for (let i = 0; i < slots.length && left > 0; i++) {
            const s = slots[i];
            if (s && s.type === 'resource' && s.id === key) {
                const take = Math.min(200 - (s.quantity || 0), left);
                if (take > 0) { s.quantity = (s.quantity || 0) + take; left -= take; }
            }
        }
        for (let i = 0; i < slots.length && left > 0; i++) {
            if (slots[i]) continue;
            const s = {
                id: key, name: (INV_RESOURCE_NAMES[key] || key), type: 'resource',
                resourceKey: key, quantity: Math.min(200, left), stackable: true
            };
            slots[i] = s;
            left -= s.quantity;
        }
    };
    trySlots(wb.storage);
    linkedChestsFor(wb).forEach(ref => trySlots(ref.slots));
    return want - left;
}

function benchTakeFromStorage(wb, key, amount) {
    let left = Math.max(0, Math.floor(amount || 0));
    if (!wb || !left) return 0;
    const want = left;
    const takeSlots = (slots) => {
        if (!Array.isArray(slots)) return;
        for (let i = 0; i < slots.length && left > 0; i++) {
            const s = slots[i];
            if (!s || s.type !== 'resource' || s.id !== key) continue;
            const take = Math.min(s.quantity || 0, left);
            s.quantity -= take;
            left -= take;
            if ((s.quantity || 0) <= 0) slots[i] = null;
        }
    };
    takeSlots(wb.storage);
    linkedChestsFor(wb).forEach(ref => takeSlots(ref.slots));
    return want - left;
}

function benchConsumeBase(wb, cost) {
    if (!wb || !cost) return false;
    const totals = benchStorageTotals(wb);
    for (const k in cost) if ((totals[k] || 0) < cost[k]) return false;
    for (const k in cost) benchTakeFromStorage(wb, k, cost[k]);
    return true;
}

function benchDepositResource(wb, key, amount) {
    const inv = getPlayerInv();
    if (!wb || !inv) return;
    if (!benchHasStorage(wb)) { setCraftStatus('Instalá el cofre de la mesa o colocá un cofre en tu base'); return; }
    const want = Math.min(amount || 1, inv.countResource(key));
    if (want <= 0) { setCraftStatus('No tenés ' + (INV_RESOURCE_NAMES[key] || key).toLowerCase()); return; }
    const moved = benchAddToStorage(wb, key, want);
    if (moved <= 0) { setCraftStatus('El almacén está lleno'); return; }
    inv.removeResource(key, moved);
    setCraftStatus('Guardaste ' + moved + ' ' + (INV_RESOURCE_NAMES[key] || key) + ' en la base');
    try { playSound('pickup'); } catch (e) {}
    renderBenchBaseUI(wb);
}

function benchWithdrawResource(wb, key, amount) {
    const inv = getPlayerInv();
    if (!wb || !inv) return;
    const taken = benchTakeFromStorage(wb, key, amount || 1);
    if (taken <= 0) { setCraftStatus('No hay ' + (INV_RESOURCE_NAMES[key] || key) + ' en la base'); return; }
    const added = inv.addResource(key, taken);
    if (added < taken) benchAddToStorage(wb, key, taken - added);
    setCraftStatus('Sacaste ' + added + ' ' + (INV_RESOURCE_NAMES[key] || key));
    renderBenchBaseUI(wb);
}

function buildBenchChestModel() {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.85 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xc4a574, metalness: 0.35, roughness: 0.45 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.32, 0.4), wood);
    body.position.y = 0.16;
    body.castShadow = true;
    g.add(body);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.08, 0.44), trim);
    lid.position.y = 0.36;
    lid.castShadow = true;
    g.add(lid);
    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.04), trim);
    latch.position.set(0, 0.26, 0.21);
    g.add(latch);
    return g;
}

function buildBenchDispenserModel() {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a4a55, metalness: 0.4, roughness: 0.5 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x4caf50, emissive: 0x1b5e20, emissiveIntensity: 0.8, roughness: 0.4 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.5, 0.34), bodyMat);
    box.position.y = 0.25;
    box.castShadow = true;
    g.add(box);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.03), accent);
    slot.position.set(0, 0.34, 0.18);
    g.add(slot);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 8), accent);
    tube.position.set(0, 0.06, 0.2);
    tube.rotation.x = Math.PI / 2;
    g.add(tube);
    return g;
}

function installBenchUpgrade(wb, kind, opts) {
    opts = opts || {};
    const inv = getPlayerInv();
    if (!wb || !wb.upgrades) return false;
    if (wb.upgrades[kind]) return true;
    if (kind === 'dispenser' && !wb.upgrades.chest) {
        setCraftStatus('Primero instalá el cofre de la mesa');
        return false;
    }
    const cost = BENCH_UPGRADE_COSTS[kind] || {};
    if (!opts.noCost) {
        if (!inv || !inv.spendResources(cost)) {
            setCraftStatus('Te faltan materiales para la mejora (necesitás ' +
                Object.keys(cost).map(k => cost[k] + ' ' + (RESOURCE_ES[k] || k)).join(' + ') + ')');
            return false;
        }
    }
    wb.upgrades[kind] = true;
    if (kind === 'chest') {
        if (!Array.isArray(wb.storage)) wb.storage = new Array(wb.storageCapacity || 12).fill(null);
        const model = buildBenchChestModel();
        model.position.set(0.5, 1.05, -0.18);
        model.userData.benchUpgrade = 'chest';
        wb.mesh.add(model);
        wb.chestMesh = model;
    } else if (kind === 'dispenser') {
        if (typeof wb.dispenserStock !== 'number') wb.dispenserStock = 0;
        const model = buildBenchDispenserModel();
        model.position.set(-0.5, 1.05, 0.18);
        model.userData.benchUpgrade = 'dispenser';
        wb.mesh.add(model);
        wb.dispenserMesh = model;
    }
    if (!opts.silent) {
        setCraftStatus(kind === 'chest' ? 'Cofre de mesa instalado: 12 espacios' : 'Dispenser de mesa instalado');
        try { playSound('health-regen'); } catch (e) {}
    }
    try { refreshCraftUI(); } catch (e) {}
    try { refreshTechTreeState(); } catch (e) {}
    renderBenchBaseUI(wb);
    return true;
}

function installBenchChest(wb) { return installBenchUpgrade(wb, 'chest'); }
function installBenchDispenser(wb) { return installBenchUpgrade(wb, 'dispenser'); }

function benchProduceAmmo(wb) {
    if (!wb || !wb.upgrades || !wb.upgrades.dispenser) return;
    const cap = wb.dispenserCap || 240;
    if ((wb.dispenserStock || 0) + BENCH_AMMO_BATCH > cap) {
        setCraftStatus('El dispenser está lleno (máx. ' + cap + ')');
        return;
    }
    // PR8: guest shared craft → host consume; host publishes storage deltas.
    try {
        if (typeof onlineCraftSync === 'function' && onlineCraftSync() &&
            typeof ONLINE !== 'undefined' && !ONLINE.isHost &&
            typeof onlineSendCraftAmmoIntent === 'function') {
            if (onlineSendCraftAmmoIntent(wb, null)) {
                setCraftStatus('Esperando al host para cargar el dispenser…');
                return;
            }
            setCraftStatus('No se pudo pedir el craft al host');
            return;
        }
        if (typeof onlineCraftSync === 'function' && onlineCraftSync() &&
            typeof ONLINE !== 'undefined' && ONLINE.isHost &&
            typeof onlineHostCraftConsume === 'function') {
            if (!onlineHostCraftConsume(wb, BENCH_AMMO_COST, null)) {
                const [k] = Object.keys(BENCH_AMMO_COST).filter(key => benchStorageTotals(wb)[key] < BENCH_AMMO_COST[key]);
                setCraftStatus('Falta ' + (RESOURCE_ES[k] || 'material') + ' en la mesa o en los cofres asociados');
                return;
            }
            setCraftStatus('Dispenser cargado: +' + BENCH_AMMO_BATCH + ' balas');
            try { playSound('ammo-pickup'); } catch (e) {}
            renderBenchBaseUI(wb);
            return;
        }
    } catch (e) {}
    if (!benchConsumeBase(wb, BENCH_AMMO_COST)) {
        const [k] = Object.keys(BENCH_AMMO_COST).filter(key => benchStorageTotals(wb)[key] < BENCH_AMMO_COST[key]);
        setCraftStatus('Falta ' + (RESOURCE_ES[k] || 'material') + ' en la mesa o en los cofres asociados');
        return;
    }
    wb.dispenserStock = (wb.dispenserStock || 0) + BENCH_AMMO_BATCH;
    setCraftStatus('Dispenser cargado: +' + BENCH_AMMO_BATCH + ' balas');
    try { playSound('ammo-pickup'); } catch (e) {}
    renderBenchBaseUI(wb);
}

function benchTakeAmmo(wb) {
    const inv = getPlayerInv();
    if (!wb || !inv) return;
    const stock = wb.dispenserStock || 0;
    if (stock <= 0) { setCraftStatus('El dispenser está vacío — cargalo con recursos'); return; }
    const n = Math.min(12, stock);
    const added = inv.addAmmoAmount('pistol', n);
    if (added <= 0) { setCraftStatus('Mochila llena: no entra munición'); return; }
    wb.dispenserStock = stock - added;
    setCraftStatus('Tomaste ' + added + ' balas');
    try { playSound('pickup'); } catch (e) {}
    renderBenchBaseUI(wb);
}

// ============================================================
// 2b) UI unificada de la mesa: slots iguales a la mochila
// ============================================================
var benchSelected = null;

function benchStorageSources(wb) {
    const out = [];
    if (!wb) return out;
    if (Array.isArray(wb.storage)) out.push({ key: 'bench', label: 'Cofre de mesa', slots: wb.storage });
    linkedChestsFor(wb).forEach((ref, i) => {
        out.push({ key: 'chest' + i, label: 'Cofre ' + (i + 1), slots: ref.slots, ref: ref });
    });
    return out;
}

function benchMaxStack(entry) {
    if (!entry) return 1;
    if (entry.type === 'resource') return 200;
    if (entry.type === 'ammo') return 200;
    return entry.stackable ? 99 : 1;
}

function benchAddEntry(wb, entry) {
    const sources = benchStorageSources(wb);
    if (!sources.length || !entry) return 0;
    let left = Math.max(1, Math.floor(entry.quantity || entry.amount || 1));
    const want = left;
    const max = benchMaxStack(entry);
    const same = (s) => s && s.id === entry.id && s.type === entry.type &&
        (s.ammoType || null) === (entry.ammoType || null);
    for (const src of sources) {
        for (let i = 0; i < src.slots.length && left > 0; i++) {
            const s = src.slots[i];
            if (!same(s)) continue;
            const take = Math.min(max - (s.quantity || 0), left);
            if (take > 0) { s.quantity = (s.quantity || 0) + take; left -= take; }
        }
    }
    for (const src of sources) {
        for (let i = 0; i < src.slots.length && left > 0; i++) {
            if (src.slots[i]) continue;
            const copy = Object.assign({}, entry);
            copy.quantity = Math.min(max, left);
            src.slots[i] = copy;
            left -= copy.quantity;
        }
    }
    return want - left;
}

function benchDepositInvSlot(wb, area, idx) {
    const inv = getPlayerInv();
    if (!inv || !wb) return;
    const item = inv.itemAt(area, idx);
    if (!item) return;
    if (!benchStorageSources(wb).length) {
        setCraftStatus('Instalá el cofre de la mesa o colocá un cofre en tu base');
        return;
    }
    const qty = item.quantity || 1;
    const moved = benchAddEntry(wb, Object.assign({}, item, { quantity: qty }));
    if (moved <= 0) { setCraftStatus('El almacén está lleno'); return; }
    if (item.type === 'resource') inv.removeResource(item.resourceKey || item.id, moved);
    else if (item.type === 'ammo') inv.removeAmmo(item.ammoType, moved);
    else inv.removeItem(item, moved);
    setCraftStatus('Guardaste ' + moved + ' × ' + item.name + ' en la base');
    try { playSound('pickup'); } catch (e) {}
    benchSelected = null;
    renderBenchBaseUI(wb);
}

function benchWithdrawSlot(wb, key, idx) {
    const inv = getPlayerInv();
    if (!inv || !wb) return;
    const src = benchStorageSources(wb).find(s => s.key === key);
    if (!src) return;
    const slot = src.slots[idx];
    if (!slot) return;
    const have = slot.quantity || slot.amount || 1;
    let moved = 0;
    if (slot.type === 'resource') {
        moved = inv.addResource(slot.id, have);
    } else if (slot.type === 'ammo') {
        moved = inv.addAmmoAmount(slot.ammoType || 'pistol', have);
    } else {
        const def = (typeof ITEM_DEFINITIONS !== 'undefined' && (ITEM_DEFINITIONS[slot.id] || null)) || {};
        const entry = Object.assign({}, def, slot, { quantity: have });
        try { if (def.createModel) entry.model = def.createModel(); } catch (e) {}
        if (entry.stackable && have > 1) {
            for (let k = 0; k < have; k++) {
                if (!inv.addItem(Object.assign({}, entry, { quantity: 1 }))) break;
                moved++;
            }
        } else if (inv.addItem(entry)) {
            moved = have;
        }
    }
    if (moved <= 0) { setCraftStatus('Mochila llena'); return; }
    slot.quantity = have - moved;
    if ((slot.quantity || 0) <= 0) src.slots[idx] = null;
    setCraftStatus('Sacaste ' + moved + ' × ' + (slot.name || slot.id));
    try { playSound('pickup'); } catch (e) {}
    benchSelected = null;
    renderBenchBaseUI(wb);
}

function benchMoveStorageSlot(wb, fromKey, fromIdx, toKey, toIdx) {
    const sources = benchStorageSources(wb);
    const from = sources.find(s => s.key === fromKey);
    const to = sources.find(s => s.key === toKey);
    if (!from || !to) return;
    if (from === to && fromIdx === toIdx) return;
    const a = from.slots[fromIdx];
    if (!a) return;
    const b = to.slots[toIdx];
    const same = b && a.id === b.id && a.type === b.type && (a.ammoType || null) === (b.ammoType || null);
    if (same) {
        const max = benchMaxStack(a);
        const space = Math.max(0, max - (b.quantity || 0));
        const take = Math.min(space, a.quantity || 1);
        if (take > 0) {
            b.quantity = (b.quantity || 0) + take;
            a.quantity = (a.quantity || 0) - take;
            if ((a.quantity || 0) <= 0) from.slots[fromIdx] = null;
        }
    } else {
        to.slots[toIdx] = a;
        from.slots[fromIdx] = b || null;
    }
    renderBenchBaseUI(wb);
}

function benchSelectedItem(wb) {
    if (!benchSelected) return null;
    if (benchSelected.surface === 'inv') {
        const inv = getPlayerInv();
        return inv ? inv.itemAt(benchSelected.area, benchSelected.idx) : null;
    }
    if (benchSelected.surface === 'storage') {
        const src = benchStorageSources(wb).find(s => s.key === benchSelected.refKey);
        return src ? (src.slots[benchSelected.idx] || null) : null;
    }
    return null;
}

function renderBenchInventory(wb) {
    const el = document.getElementById('benchInv');
    if (!el) return;
    const inv = getPlayerInv();
    el.innerHTML = '';
    if (!inv) return;
    const beltLabel = document.createElement('div');
    beltLabel.className = 'rg-inv-label';
    beltLabel.style.gridColumn = '1 / -1';
    beltLabel.innerHTML = 'CINTURÓN <span>teclas 1-5</span>';
    el.appendChild(beltLabel);
    for (let i = 0; i < inv.quickSlots.length; i++) {
        el.appendChild(makeItemSlot(inv.quickSlots[i], {
            surface: 'bench', area: 'belt', idx: i, keyLabel: String(i + 1),
            selected: !!(benchSelected && benchSelected.surface === 'inv' && benchSelected.area === 'belt' && benchSelected.idx === i)
        }));
    }
    const bagLabel = document.createElement('div');
    bagLabel.className = 'rg-inv-label';
    bagLabel.style.gridColumn = '1 / -1';
    bagLabel.innerHTML = 'MOCHILA <span>' + inv.usedBagSlots + '/' + inv.capacity + '</span>';
    el.appendChild(bagLabel);
    for (let i = 0; i < inv.capacity; i++) {
        el.appendChild(makeItemSlot(inv.slots[i], {
            surface: 'bench', area: 'bag', idx: i,
            selected: !!(benchSelected && benchSelected.surface === 'inv' && benchSelected.area === 'bag' && benchSelected.idx === i)
        }));
    }
}

function renderBenchStorage(wb) {
    const el = document.getElementById('benchStorage');
    const hint = document.getElementById('benchStoreHint');
    if (!el) return;
    el.innerHTML = '';
    const sources = benchStorageSources(wb);
    if (!sources.length) {
        el.innerHTML = '<div class="rg-hint" style="grid-column:1/-1;">Sin almacén: instalá el cofre de la mesa o crafteá y colocá un cofre dentro del área.</div>';
        if (hint) hint.textContent = '';
        return;
    }
    sources.forEach((src) => {
        const label = document.createElement('div');
        label.className = 'rg-inv-label';
        label.textContent = src.label + ' · ' + src.slots.length + ' espacios';
        el.appendChild(label);
        src.slots.forEach((slot, idx) => {
            el.appendChild(makeItemSlot(slot, {
                surface: 'bench', area: 'storage', idx: idx, refKey: src.key,
                selected: !!(benchSelected && benchSelected.surface === 'storage' && benchSelected.refKey === src.key && benchSelected.idx === idx),
                emptyTitle: 'Espacio libre en ' + src.label
            }));
        });
    });
    if (hint) {
        const totals = benchStorageTotals(wb);
        const linked = linkedChestsFor(wb);
        hint.textContent = 'Base: 🪵 ' + (totals.wood || 0) + ' · 🪨 ' + (totals.stone || 0) + ' · ⚙️ ' + (totals.metal || 0) +
            (linked.length ? (' · ' + linked.length + ' cofre(s) asociado(s)') : '');
    }
}

function renderBenchUpgrades(wb) {
    const el = document.getElementById('benchUpgrades');
    if (!el) return;
    const upg = wb.upgrades || (wb.upgrades = { chest: false, dispenser: false });
    let up = '<div class="bench-upg-row">';
    if (!upg.chest) {
        up += '<button class="rg-btn rg-btn-small rg-btn-primary" data-bact="chest">🧰 Instalar cofre de mesa</button>' +
            '<span class="bench-cost">' + resIcon('wood') + BENCH_UPGRADE_COSTS.chest.wood + ' ' +
            resIcon('stone') + BENCH_UPGRADE_COSTS.chest.stone + ' ' +
            resIcon('metal') + BENCH_UPGRADE_COSTS.chest.metal + '</span>';
    } else {
        up += '<span class="bench-ok">✓ Cofre de mesa (12 espacios)</span>';
    }
    up += '</div><div class="bench-upg-row">';
    if (!upg.dispenser) {
        up += '<button class="rg-btn rg-btn-small ' + (upg.chest ? 'rg-btn-primary' : '') + '" data-bact="dispenser"' +
            (upg.chest ? '' : ' disabled') + '>📦 Instalar dispenser</button>' +
            '<span class="bench-cost">' + resIcon('metal') + BENCH_UPGRADE_COSTS.dispenser.metal + ' ' +
            resIcon('stone') + BENCH_UPGRADE_COSTS.dispenser.stone + ' ' +
            resIcon('wood') + BENCH_UPGRADE_COSTS.dispenser.wood + '</span>';
    } else {
        up += '<span class="bench-ok">✓ Dispenser instalado · stock ' + (wb.dispenserStock || 0) + '</span>';
    }
    up += '</div>';
    el.innerHTML = up;
}

function renderBenchDispenser(wb) {
    const el = document.getElementById('benchDispenser');
    if (!el) return;
    const upg = wb.upgrades || {};
    if (!upg.dispenser) {
        el.innerHTML = '<div class="rg-hint">La mejora del dispenser se instala arriba. Consume recursos del almacén de la mesa y de los cofres asociados.</div>';
        return;
    }
    const have = benchStorageTotals(wb);
    const can = Object.keys(BENCH_AMMO_COST).every(k => (have[k] || 0) >= BENCH_AMMO_COST[k]);
    el.innerHTML = '<div class="bench-disp-row"><span>Stock: <b>' + (wb.dispenserStock || 0) + '</b> balas</span>' +
        '<button class="rg-btn rg-btn-small rg-btn-primary" data-bact="produce"' + (can ? '' : ' disabled') + '>Producir ' + BENCH_AMMO_BATCH + '</button>' +
        '<button class="rg-btn rg-btn-small" data-bact="takeammo"' + ((wb.dispenserStock || 0) > 0 ? '' : ' disabled') + '>Tomar 12</button></div>' +
        '<div class="bench-cost">Costo: ' + resIcon('metal') + BENCH_AMMO_COST.metal + ' ' + resIcon('wood') + BENCH_AMMO_COST.wood +
        ' · sale del almacén/cofres (' + (have.metal || 0) + ' metal, ' + (have.wood || 0) + ' madera)</div>';
}

function renderBenchDetail(wb) {
    const detail = document.getElementById('benchDetail');
    if (!detail) return;
    detail.innerHTML = '';
    const item = benchSelectedItem(wb);
    if (!item) {
        detail.innerHTML = '<b>Seleccioná un objeto</b><br>' +
            'Arrastrá recursos, munición o herramientas entre la mochila y el almacén. Doble clic mueve todo el stack.';
        return;
    }
    const title = document.createElement('div');
    title.className = 'inv-detail-title';
    title.textContent = itemIcon(item) + ' ' + item.name + ((item.quantity || 1) > 1 ? ' ×' + item.quantity : '');
    detail.appendChild(title);
    const meta = document.createElement('div');
    meta.className = 'inv-detail-meta';
    meta.textContent = invTypeLabel(item) + (benchSelected.surface === 'storage' ? ' · almacén de la base' : ' · mochila');
    detail.appendChild(meta);
    const desc = document.createElement('div');
    desc.className = 'inv-detail-desc';
    desc.textContent = invItemDesc(item, getPlayerInv());
    detail.appendChild(desc);
    const actions = document.createElement('div');
    actions.className = 'rg-item-actions';
    if (benchSelected.surface === 'storage') {
        actions.appendChild(invDetailBtn('Pasar a la mochila', 'rg-btn-primary', () => {
            benchWithdrawSlot(wb, benchSelected.refKey, benchSelected.idx);
        }));
    } else {
        const inv = getPlayerInv();
        if (item.toolType || item.type === 'weapon') {
            if (inv && inv.equippedItem === item) {
                actions.appendChild(invDetailBtn('Desequipar', '', () => {
                    inv.unequipItem();
                    try { player.currentTool = TOOLS.HANDS; player.updateToolHUD(); } catch (e) {}
                    renderBenchBaseUI(wb);
                }));
            } else {
                actions.appendChild(invDetailBtn('Equipar', 'rg-btn-primary', () => {
                    if (inv) inv.equipItem(item);
                    try { player.updateToolHUD(); updateActionButton(); } catch (e) {}
                    renderBenchBaseUI(wb);
                }));
            }
        } else if (item.type === 'consumable' && item.healAmount > 0) {
            actions.appendChild(invDetailBtn('Usar', 'rg-btn-primary', () => {
                if (inv) inv.useItem(item);
                renderBenchBaseUI(wb);
            }));
        } else if (item.type === 'ammo') {
            actions.appendChild(invDetailBtn('Recargar arma', 'rg-btn-primary', () => {
                if (inv && inv.equippedItem && inv.equippedItem.ammoType) inv.reloadWeapon();
                else setCraftStatus('Equipá un arma para recargar');
                renderBenchBaseUI(wb);
            }));
        }
        actions.appendChild(invDetailBtn('Guardar en la base', 'rg-btn-primary', () => {
            benchDepositInvSlot(wb, benchSelected.area, benchSelected.idx);
        }));
    }
    detail.appendChild(actions);
}

function bindBenchInteractions(wb) {
    const upEl = document.getElementById('benchUpgrades');
    const stEl = document.getElementById('benchStorage');
    const dsEl = document.getElementById('benchDispenser');
    const invEl = document.getElementById('benchInv');
    if (upEl) {
        upEl.querySelectorAll('[data-bact]').forEach(b => {
            b.addEventListener('click', () => {
                const act = b.getAttribute('data-bact');
                if (act === 'chest') installBenchChest(wb);
                else if (act === 'dispenser') installBenchDispenser(wb);
            });
        });
    }
    if (dsEl) {
        dsEl.querySelectorAll('[data-bact]').forEach(b => {
            b.addEventListener('click', () => {
                const act = b.getAttribute('data-bact');
                if (act === 'produce') benchProduceAmmo(wb);
                else if (act === 'takeammo') benchTakeAmmo(wb);
            });
        });
    }
    const selectSlot = (surface, el) => {
        if (surface === 'inv') {
            benchSelected = { surface: 'inv', area: el.dataset.area, idx: parseInt(el.dataset.idx, 10) };
        } else {
            benchSelected = { surface: 'storage', refKey: el.dataset.ref, idx: parseInt(el.dataset.idx, 10) };
        }
        renderBenchBaseUI(wb);
    };
    if (invEl) {
        invEl.querySelectorAll('.inv-slot[data-surface="bench"]').forEach(el => {
            el.addEventListener('click', () => selectSlot('inv', el));
            el.addEventListener('dblclick', () => {
                benchDepositInvSlot(wb, el.dataset.area, parseInt(el.dataset.idx, 10));
            });
        });
    }
    if (stEl) {
        stEl.querySelectorAll('.inv-slot[data-surface="bench"]').forEach(el => {
            el.addEventListener('click', () => selectSlot('storage', el));
            el.addEventListener('dblclick', () => {
                benchWithdrawSlot(wb, el.dataset.ref, parseInt(el.dataset.idx, 10));
            });
        });
    }
}

function benchSlotUnder(x, y) {
    const els = document.querySelectorAll('#benchModal .inv-slot[data-surface="bench"]');
    for (const el of els) {
        const r = el.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            return {
                area: el.dataset.area,
                idx: parseInt(el.dataset.idx, 10),
                refKey: el.dataset.ref,
                inInv: !!el.closest('#benchInv'),
                inStorage: !!el.closest('#benchStorage')
            };
        }
    }
    return null;
}

var _benchDrag = null;
document.addEventListener('pointerdown', (e) => {
    if (!benchOpen || !currentBench) return;
    if (e.target && e.target.closest && e.target.closest('button')) return;
    const el = e.target && e.target.closest ? e.target.closest('#benchModal .inv-slot[data-surface="bench"]') : null;
    if (!el) return;
    const inInv = !!el.closest('#benchInv');
    const inStorage = !!el.closest('#benchStorage');
    if (!inInv && !inStorage) return;
    const item = inInv
        ? (getPlayerInv() ? getPlayerInv().itemAt(el.dataset.area, parseInt(el.dataset.idx, 10)) : null)
        : benchSelectedItem(currentBench);
    if (!item) return;
    e.preventDefault();
    _benchDrag = {
        inInv: inInv,
        inStorage: inStorage,
        area: el.dataset.area,
        idx: parseInt(el.dataset.idx, 10),
        refKey: el.dataset.ref,
        item: item,
        x: e.clientX,
        y: e.clientY,
        moved: false
    };
});
document.addEventListener('pointermove', (e) => {
    if (!_benchDrag) return;
    if (Math.abs(e.clientX - _benchDrag.x) + Math.abs(e.clientY - _benchDrag.y) > 6) {
        _benchDrag.moved = true;
        try { invDragGhost(_benchDrag.item, e.clientX, e.clientY); } catch (err) {}
    }
});
document.addEventListener('pointerup', (e) => {
    if (!_benchDrag) return;
    const drag = _benchDrag;
    _benchDrag = null;
    const g = document.getElementById('invDragGhost');
    if (g) g.remove();
    if (!drag.moved || !currentBench) return;
    const wb = currentBench;
    const target = benchSlotUnder(e.clientX, e.clientY);
    if (!target) return;
    if (drag.inInv && target.inStorage) {
        benchDepositInvSlot(wb, drag.area, drag.idx);
    } else if (drag.inStorage && target.inInv) {
        benchWithdrawSlot(wb, drag.refKey, drag.idx);
    } else if (drag.inInv && target.inInv && getPlayerInv()) {
        getPlayerInv().moveItem(drag.area, drag.idx, target.area, target.idx);
        renderBenchBaseUI(wb);
    } else if (drag.inStorage && target.inStorage) {
        benchMoveStorageSlot(wb, drag.refKey, drag.idx, target.refKey, target.idx);
    }
});
document.addEventListener('pointercancel', () => {
    if (!_benchDrag) return;
    _benchDrag = null;
    const g = document.getElementById('invDragGhost');
    if (g) g.remove();
    if (currentBench) renderBenchBaseUI(currentBench);
});

function renderBenchBaseUI(wb) {
    wb = wb || (typeof currentBench !== 'undefined' ? currentBench : null);
    const upEl = document.getElementById('benchUpgrades');
    const stEl = document.getElementById('benchStorage');
    const dsEl = document.getElementById('benchDispenser');
    if (!upEl || !stEl || !dsEl) return;
    if (!wb) {
        upEl.innerHTML = '';
        stEl.innerHTML = '';
        dsEl.innerHTML = '';
        const invEl = document.getElementById('benchInv');
        if (invEl) invEl.innerHTML = '';
        const detail = document.getElementById('benchDetail');
        if (detail) detail.innerHTML = '';
        return;
    }
    if (benchSelected && !benchSelectedItem(wb)) benchSelected = null;
    renderBenchUpgrades(wb);
    renderBenchInventory(wb);
    renderBenchStorage(wb);
    renderBenchDispenser(wb);
    renderBenchDetail(wb);
    bindBenchInteractions(wb);
    try { renderMaterialChips(document.getElementById('benchFoot')); } catch (e) {}
    try { refreshBenchModal(); } catch (e) {}
}


// --- Serialización de mejoras de la mesa ---
function serializedBenchUpgrades(wb) {
    if (!wb) return null;
    return {
        upgrades: wb.upgrades ? { chest: !!wb.upgrades.chest, dispenser: !!wb.upgrades.dispenser } : null,
        storage: Array.isArray(wb.storage) ? wb.storage.map(s => s ? Object.assign({}, s) : null) : null,
        dispenserStock: wb.dispenserStock || 0
    };
}
function applyBenchUpgradeData(wb, data) {
    if (!wb || !data) return;
    if (data.upgrades && data.upgrades.chest) installBenchUpgrade(wb, 'chest', { noCost: true, silent: true });
    if (data.upgrades && data.upgrades.dispenser) installBenchUpgrade(wb, 'dispenser', { noCost: true, silent: true });
    if (Array.isArray(data.storage)) {
        if (!Array.isArray(wb.storage)) wb.storage = new Array(wb.storageCapacity || 12).fill(null);
        data.storage.slice(0, wb.storage.length).forEach((s, i) => { wb.storage[i] = s ? Object.assign({}, s) : null; });
    }
    if (typeof data.dispenserStock === 'number') wb.dispenserStock = Math.max(0, data.dispenserStock);
}
