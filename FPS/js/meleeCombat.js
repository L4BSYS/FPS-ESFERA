// js/meleeCombat.js — shared melee hit helpers (fists / tool peak-resolve).
// LOAD: after bodyRig.js, before 04-character.js.
// Keeps Player/NPC strike resolution symmetric without growing Character further.

(function (global) {
  'use strict';

  function meleeShortReach() {
    if (typeof meleeReachFor === 'function') return meleeReachFor('short');
    if (typeof MELEE_RANGE !== 'undefined' && MELEE_RANGE && MELEE_RANGE.short != null) return MELEE_RANGE.short;
    return 1.35;
  }

  /** Push living NPC hit proxies (mesh + collider). Skips attacker. */
  function meleeCollectNpcTargets(attacker, out) {
    out = out || [];
    try {
      if (typeof npcs === 'undefined' || !npcs) return out;
      for (var i = 0; i < npcs.length; i++) {
        var n = npcs[i];
        if (!n || n === attacker || n.health <= 0 || n.state === 'dead') continue;
        if (n.mesh) out.push(n.mesh);
        if (n.collider) out.push(n.collider);
      }
    } catch (e) {}
    return out;
  }

  /** Player hit proxies (no .mesh on 1P — capsule + body root). */
  function meleeCollectPlayerTargets(out) {
    out = out || [];
    try {
      if (typeof player === 'undefined' || !player || player.health <= 0) return out;
      if (player.collider) out.push(player.collider);
      if (player.container) out.push(player.container);
      if (player.body && player.body.root) out.push(player.body.root);
      if (player.mesh) out.push(player.mesh);
    } catch (e) {}
    return out;
  }

  /**
   * Walk hit object → { npc, hitPlayer }.
   * @param {object} [NPCClass] optional NPC constructor for instanceof
   */
  function meleeIdentifyHit(obj, attacker, NPCClass) {
    var npc = null;
    var hitPlayer = false;
    while (obj) {
      if (obj.userData && obj.userData.parentCharacter) {
        var pc = obj.userData.parentCharacter;
        if (NPCClass) {
          if (pc instanceof NPCClass) npc = pc;
        } else if (pc && pc !== player && typeof pc.takeDamage === 'function') {
          npc = pc;
        }
        if (npc) break;
      }
      try {
        if (typeof player !== 'undefined' && player &&
            (obj === player.collider || obj === player.container || obj === player.mesh ||
             (player.body && obj === player.body.root) ||
             (obj.userData && obj.userData.isPlayerHitProxy))) {
          hitPlayer = true;
          break;
        }
      } catch (e) {}
      obj = obj.parent;
    }
    if (npc && attacker && npc === attacker) npc = null;
    return { npc: npc, hitPlayer: hitPlayer };
  }

  /**
   * Boxing forgiveness: if thin ray missed, land on preferred target in front & in reach.
   * @returns {object|null} { target, point } or null
   */
  function meleeForgivenessHit(origin, dir, reach, forgive, preferredTarget) {
    if (!preferredTarget || !preferredTarget.container) return null;
    if (preferredTarget.health != null && preferredTarget.health <= 0) return null;
    try {
      var to = new THREE.Vector3().subVectors(preferredTarget.container.position, origin);
      to.y = 0;
      var dist = to.length();
      var slack = forgive != null ? forgive : 0.08;
      if (dist <= 0.05 || dist > reach + slack) return null;
      to.normalize();
      var fwd = dir.clone();
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) return null;
      fwd.normalize();
      if (fwd.dot(to) <= 0.72) return null;
      var hitPt = preferredTarget.container.position.clone();
      hitPt.y += (preferredTarget.halfHeight || 0.8) * 0.3;
      return { target: preferredTarget, point: hitPt };
    } catch (e) {
      return null;
    }
  }

  /** Live aim point for pending strike (prefer moving target over frozen clone). */
  function meleeLiveAimPos(pending, fallbackTarget) {
    try {
      if (pending && pending.aimNpc && pending.aimNpc.container && pending.aimNpc.health > 0) {
        return pending.aimNpc.container.position;
      }
    } catch (e) {}
    try {
      if (fallbackTarget && fallbackTarget.container) return fallbackTarget.container.position;
    } catch (e) {}
    try {
      if (pending && pending.aimPos) return pending.aimPos;
    } catch (e) {}
    return null;
  }

  /**
   * S1 Strict clash: if both have active fists pendings in window, earlier startAt wins.
   * @returns {'win'|'lose'|'none'}
   */
  function meleeClashVerdict(attackerPending, target) {
    if (!attackerPending || !attackerPending.fists || !target) return 'none';
    var tp = target._meleePending;
    if (!tp || !tp.fists || tp.resolved || tp.cancelled) return 'none';
    var winMs = attackerPending.clashWindowMs != null ? attackerPending.clashWindowMs : 140;
    var a0 = attackerPending.startAt != null ? attackerPending.startAt : 0;
    var b0 = tp.startAt != null ? tp.startAt : 0;
    if (Math.abs(a0 - b0) > winMs) return 'none';
    if (a0 < b0) return 'win';
    if (b0 < a0) return 'lose';
    // Exact tie: player beats NPC; else stable by presence of camera
    try {
      if (attackerPending.fromPlayer) return 'win';
      if (tp.fromPlayer) return 'lose';
    } catch (e) {}
    return 'win';
  }

  function meleeCancelPending(ch, reason) {
    if (!ch || !ch._meleePending) return;
    try {
      ch._meleePending.cancelled = true;
      ch._meleePending.resolved = true;
    } catch (e) {}
    ch._meleePending = null;
    try {
      if (ch.body && ch.body.driver) {
        ch.body.driver.punchT = 0;
        ch.body.driver.punchW = 0;
      }
    } catch (e) {}
  }

  global.meleeShortReach = meleeShortReach;
  global.meleeCollectNpcTargets = meleeCollectNpcTargets;
  global.meleeCollectPlayerTargets = meleeCollectPlayerTargets;
  global.meleeIdentifyHit = meleeIdentifyHit;
  global.meleeForgivenessHit = meleeForgivenessHit;
  global.meleeLiveAimPos = meleeLiveAimPos;
  global.meleeClashVerdict = meleeClashVerdict;
  global.meleeCancelPending = meleeCancelPending;
})(typeof window !== 'undefined' ? window : this);
