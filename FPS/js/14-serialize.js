// js/14-serialize.js (part 14/16). LaGrieta FPS — classic scripts share globals. LOAD ORDER MATTERS, do not reorder.
// --- Scene Serialization ---
function serializeBlocks() {
  return placedBlocks.map(b => ({
    x: Math.round(b.position.x*100)/100,
    y: Math.round(b.position.y*100)/100,
    z: Math.round(b.position.z*100)/100,
    t: (b.userData && b.userData.type) || currentBlockType,
    r: (b.rotation && b.rotation.y) || 0
  }));
}
function clearBlocks() {
  placedBlocks.forEach(b => scene.remove(b));
  placedBlocks.length = 0;
  blockGrid.clear();
  if (typeof updateSpatialPartition === 'function') updateSpatialPartition();
}
// Rebuild one saved block the same way placeBlock() does (no resource cost)
function rebuildBlock(type, x, y, z, rotY) {
  if (!BLOCK_MATERIALS[type]) return null;
  const block = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      BLOCK_MATERIALS[type].material.clone()
  );
  block.position.set(x, y, z);
  block.rotation.y = rotY || 0;
  block.castShadow = true;
  block.receiveShadow = true;
  block.userData = {
      type: type,
      isFoundation: (y === 0.5),
      allowBuildingOnTop: true,
      isClimbable: true,
      supportedBlocks: [],
      supportingBlocks: [],
      health: BLOCK_MATERIALS[type].health,
      maxHealth: BLOCK_MATERIALS[type].health
  };
  if (y !== 0.5) {
      const below = blockGrid.get(getGridKey(x, y - 1, z));
      if (below) {
          block.userData.supportingBlocks = [below];
          below.userData.supportedBlocks.push(block);
      }
  }
  scene.add(block);
  placedBlocks.push(block);
  blockGrid.set(getGridKey(x, y, z), block);
  return block;
}
function deserializeBlocks(data) {
  clearBlocks();
  if (!Array.isArray(data)) return 0;
  let n = 0;
  data.slice(0, 2000).forEach(d => {
    if (typeof d.x !== 'number' || typeof d.y !== 'number' || typeof d.z !== 'number') return;
    const type = d.t || d.type || 'wood';
    if (rebuildBlock(type, d.x, d.y, d.z, d.r)) n++;
  });
  if (typeof updateSpatialPartition === 'function') updateSpatialPartition();
  if (typeof updateDebugVisuals === 'function') updateDebugVisuals();
  return n;
}

