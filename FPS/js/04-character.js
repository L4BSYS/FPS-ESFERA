// js/04-character.js (part 4/16). LaGrieta FPS — classic scripts share globals. LOAD ORDER MATTERS, do not reorder.
// --- Base Classes ---
  class Character {
      constructor(scene, config = PLAYER_CONFIG) {
          this.scene = scene;
          this.config = config;

          // Container for the character
          this.container = new THREE.Group();
          this.container.position.set(0, this.config.height / 2 + 0.3, 5);
          this.scene.add(this.container);

          // Character stats
          this.health = 100;
          this.maxHealth = 100;
          this.energy = 100;
          this.maxStamina = config.maxStamina || 100;
          this.stamina = this.maxStamina;
          this.staminaSprintDrain = (typeof config.staminaSprintDrain === 'number') ? config.staminaSprintDrain : 12;
          this.staminaRegen = (typeof config.staminaRegen === 'number') ? config.staminaRegen : 15;
          this.staminaRegenDelay = (typeof config.staminaRegenDelay === 'number') ? config.staminaRegenDelay : 0.6;
          this.staminaJumpCost = (typeof config.staminaJumpCost === 'number') ? config.staminaJumpCost : 12;
          this.staminaExhaustRecover = (typeof config.staminaExhaustRecover === 'number') ? config.staminaExhaustRecover : 35;
          this.staminaExhausted = false;
          this._staminaRestTimer = 0;

          this.foodCollected = 0;
          this.toxinsCollected = 0;          

          // Physics and State
          this.gravity = config.gravity || -15;
          this.isOnGround = false;
          this.isSprinting = false;
          this.isClimbing = false;
          this.velocity = new THREE.Vector3();
          this.direction = new THREE.Vector3();
          this.canJump = true;
          this.jumpCooldown = 0;
          this.jumpGraceTimer = 0;
          this.coyoteTime = 0;
          this.coyoteTimeMax = 0.2;


          // Collider dimensions
          this.height = this.config.height;
          this.radius = this.config.radius;
          this.halfHeight = this.height / 2;
          this.standHeight = this.height;
          this.crouched = false;
          this._flinchT = 0;
          this.body = null;

          // Fists / guard (symmetric combat). guard = future shield; strike = future weapon.
          this.fistsCombat = false;
          this.isGuarding = false;
          this.nextHand = 1; // +1 right, -1 left — alternates on strike
          this._strikeCooldown = 0;
          this._meleePending = null;
          this._guardAiT = 0;
          this._staggerT = 0;

          // Input State
          this.input = { forward: 0, backward: 0, left: 0, right: 0 };

          // Tool/Item State
          this.currentTool = TOOLS.HANDS;
          this.heldItem = null;

          // Create capsule collider
          this.createCollider();

          // Ground check raycaster
          this.downRaycaster = new THREE.Raycaster(
              new THREE.Vector3(),
              new THREE.Vector3(0, -1, 0),
              0,
              this.halfHeight + this.config.groundCheckDistance
          );

          this.lastCollisionTime = 0;
          this.collisionCooldown = 0.1;
          this.lastCollidedObject = null;
          
          // Physics state
          this._previousPosition = new THREE.Vector3();
          this._movementDelta = new THREE.Vector3();
          this._tempVector = new THREE.Vector3();
          this._tempBox = new THREE.Box3();
      }
      destroy() {
        this.scene.remove(this.container);
        
        if (this.collider) {
          this.scene.remove(this.collider);
          this.collider.traverse(child => {
            if (child.isMesh) {
              child.geometry.dispose();
              child.material.dispose();
            }
          });
        }
        
        // Cleanup raycasters
        this.downRaycaster = null;
        this._temp.raycasters = null;
      }

      createCollider() {
          if (this.collider) return;

          this.collider = new THREE.Group();
          this.collider.name = "CharacterCollider";

          const colliderMat = new THREE.MeshBasicMaterial({
              wireframe: true,
              color: 0xffff00,
              depthTest: false,
              transparent: true,
              opacity: 0.7,
              visible: debugMode // 👈 this line is key
          });

          const cylinderHeight = this.height - 2 * this.radius;
          if (cylinderHeight > 0) {
              const cylinderGeo = new THREE.CylinderGeometry(this.radius, this.radius, cylinderHeight, 16);
              const cylinder = new THREE.Mesh(cylinderGeo, colliderMat.clone());
              cylinder.position.y = 0;
              this.collider.add(cylinder);

              const sphereGeo = new THREE.SphereGeometry(this.radius, 16, 8);
              const topSphere = new THREE.Mesh(sphereGeo, colliderMat.clone());
              topSphere.position.y = cylinderHeight / 2;
              this.collider.add(topSphere);

              const bottomSphere = new THREE.Mesh(sphereGeo, colliderMat.clone());
              bottomSphere.position.y = -cylinderHeight / 2;
              this.collider.add(bottomSphere);
          }
          

          this.scene.add(this.collider);
          this.colliderBox = new THREE.Box3();
          this.updateColliderBox();
      }
      updateColliderPosition() {
          if (this.collider) {
              this.collider.position.copy(this.container.position);
              this.collider.updateMatrixWorld(true);
          }
      }
      updateColliderBox() {
          this.updateColliderPosition();
          if (this.collider) {
              this.colliderBox.setFromObject(this.collider, true);
              // Expand slightly to prevent tunneling
              this.colliderBox.expandByScalar(this.config.collisionEpsilon || 0.05);
          }
      }

      /** Pose flags for bodyRig driver (shared Player/NPC). */
      getBodyFlags() {
          const hx = this.velocity.x;
          const hz = this.velocity.z;
          const speedH = Math.hypot(hx, hz);
          const moving = speedH > 0.45 || !!(this.input && (this.input.forward || this.input.backward || this.input.left || this.input.right));
          return {
              moving: moving,
              onGround: !!this.isOnGround,
              crouched: !!this.crouched,
              sprint: !!this.isSprinting && !this.crouched,
              velY: this.velocity.y,
              speedH: speedH,
              hasGun: this.currentTool === (typeof TOOLS !== 'undefined' ? TOOLS.GUN : 'gun'),
              fp: false,
              pitch: 0,
              guarding: !!this.isGuarding,
              down: (this.body && this.body.down) || (this.state === 'dead' ? 'dead' : null)
          };
      }

      getPoseId() {
          if (this.body && this.body.driver) return this.body.driver.poseId;
          if (!this.isOnGround) return this.velocity.y > 0.3 ? 'jump' : 'fall';
          if (this.crouched) return (this.getBodyFlags().moving ? 'crouch_walk' : 'crouch');
          if (this.getBodyFlags().moving) return this.isSprinting ? 'sprint' : 'walk';
          return 'idle';
      }

      setCrouched(on) {
          if (!(this.config && this.config.crouchEnabled !== false)) return;
          on = !!on;
          if (on === this.crouched) return;
          const factor = (this.config.crouchHeightFactor != null)
              ? this.config.crouchHeightFactor
              : ((typeof BODY_DEF !== 'undefined' && BODY_DEF.crouchPolicy) ? BODY_DEF.crouchPolicy.heightFactor : 0.65);
          const oldHalf = this.halfHeight;
          this.crouched = on;
          if (on) this.isSprinting = false;
          this.height = on ? this.standHeight * factor : this.standHeight;
          this.halfHeight = this.height / 2;
          // Keep feet planted: center moves with halfHeight delta.
          this.container.position.y += (this.halfHeight - oldHalf);
          this.rebuildColliderGeometry();
          this.updateColliderBox();
      }

      rebuildColliderGeometry() {
          if (!this.collider) return;
          const keepMat = this.collider.children[0] && this.collider.children[0].material
              ? this.collider.children[0].material
              : new THREE.MeshBasicMaterial({ wireframe: true, color: 0xffff00, depth: false, transparent: true, opacity: 0.7, visible: !!debugMode });
          while (this.collider.children.length) {
              const ch = this.collider.children[0];
              this.collider.remove(ch);
              if (ch.geometry) ch.geometry.dispose();
          }
          const cylinderHeight = this.height - 2 * this.radius;
          if (cylinderHeight > 0) {
              const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(this.radius, this.radius, cylinderHeight, 16), keepMat.clone());
              cylinder.position.y = 0;
              this.collider.add(cylinder);
              const sphereGeo = new THREE.SphereGeometry(this.radius, 16, 8);
              const topSphere = new THREE.Mesh(sphereGeo, keepMat.clone());
              topSphere.position.y = cylinderHeight / 2;
              this.collider.add(topSphere);
              const bottomSphere = new THREE.Mesh(sphereGeo, keepMat.clone());
              bottomSphere.position.y = -cylinderHeight / 2;
              this.collider.add(bottomSphere);
          }
      }

      updateBodyRig(delta, extraFlags) {
          if (!this.body || typeof this.body.update !== 'function') return;
          const flags = Object.assign(this.getBodyFlags(), extraFlags || {});
          if (this._flinchT > 0) this._flinchT -= delta;
          this.body.update(delta, flags);
      }

      /** Hit feedback on shared body (flinch + flash). Optional world knockback dir. */
      playBodyHit(fromPos, heavy) {
          if (!this.body) return;
          let side = Math.random() < 0.5 ? -1 : 1;
          try {
              if (fromPos && this.container) {
                  const to = new THREE.Vector3().subVectors(this.container.position, fromPos);
                  const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.container.rotation.y);
                  // Cross Y: sign says left/right of facing
                  side = Math.sign(forward.x * to.z - forward.z * to.x) || side;
              }
          } catch (e) {}
          if (typeof this.body.playHit === 'function') this.body.playHit({ side: side, heavy: !!heavy });
          else if (this.body.setAction) this.body.setAction('flinch');
          this._flinchT = heavy ? 0.55 : 0.38;
      }

      getFistsStats() {
          const f = (typeof MELEE_FISTS !== 'undefined') ? MELEE_FISTS : null;
          const band = (f && f.rangeBand) || 'short';
          let reach = (typeof meleeReachFor === 'function')
              ? meleeReachFor(band)
              : ((f && f.reach) || 1.35);
          if (f && f.reach != null && !(typeof meleeReachFor === 'function')) reach = f.reach;
          return {
              damage: (f && f.damage) || 7,
              rangeBand: band,
              reach: reach,
              peak: (f && f.peak) || 0.12,
              duration: (f && f.duration) || 0.28,
              cooldown: (f && f.cooldown) || 0.32,
              stagger: (f && f.stagger) || 0.14,
              guardDamageMult: (f && f.guardDamageMult) || 0.18,
              forgive: (f && f.forgive != null) ? f.forgive : 0.08,
              clashWindowMs: (f && f.clashWindowMs != null) ? f.clashWindowMs : 140,
              punchCost: (f && f.punchCost != null) ? f.punchCost : 9,
              guardDrainPerSec: (f && f.guardDrainPerSec != null) ? f.guardDrainPerSec : 12,
              blockHitCost: (f && f.blockHitCost != null) ? f.blockHitCost : 4,
              guardTiredBelow: (f && f.guardTiredBelow != null) ? f.guardTiredBelow : 15,
              guardTiredMult: (f && f.guardTiredMult != null) ? f.guardTiredMult : 0.45,
              softDamageMult: (f && f.softDamageMult != null) ? f.softDamageMult : 0.5,
              softCooldownMult: (f && f.softCooldownMult != null) ? f.softCooldownMult : 1.4
          };
      }

      /** Lab fists: spend Aguante; resets regen delay. */
      spendFistsStamina(amount) {
          if (!(amount > 0)) return;
          this.stamina = Math.max(0, (this.stamina || 0) - amount);
          this._staminaRestTimer = 0;
          if (this.stamina <= 0.5) {
              this.stamina = 0;
              this.staminaExhausted = true;
              this.isSprinting = false;
          }
      }

      fistsStaminaSoft() {
          if (!this.usesFistsCombat()) return false;
          const fs = this.getFistsStats();
          return !!(this.staminaExhausted || (this.stamina || 0) < fs.punchCost);
      }

      usesFistsCombat() {
          if (this.fistsCombat) return true;
          try {
              if (typeof isCombatLabActive === 'function' && isCombatLabActive() &&
                  typeof LAB !== 'undefined' && LAB && LAB.layer === 'fists') return true;
          } catch (e) {}
          return false;
      }

      /** Guard = future shield hook. Hold on; cancels pending strike + punch pose. */
      setGuard(on) {
          const want = !!on;
          // S1 Soft: exhausted → cannot raise guard
          if (want && this.usesFistsCombat() && this.staminaExhausted) {
              return this.isGuarding;
          }
          if (want && this.usesFistsCombat() && (this.stamina || 0) <= 0) {
              return this.isGuarding;
          }
          if (want === this.isGuarding) {
              if (want && this.body && typeof this.body.setGuard === 'function') {
                  try { this.body.setGuard(true); } catch (e) {}
              }
              return this.isGuarding;
          }
          this.isGuarding = want;
          if (want) {
              this._meleePending = null;
              try {
                  if (this.body && this.body.driver) {
                      this.body.driver.punchT = 0;
                      this.body.driver.punchW = 0;
                  }
              } catch (e) {}
          }
          try {
              if (this.body && typeof this.body.setGuard === 'function') this.body.setGuard(want);
          } catch (e) {}
          return this.isGuarding;
      }

      /** Strike = future weapon hook. Fists alternate L/R. No strike while guarding. */
      startStrike(opts) {
          opts = opts || {};
          if (this.isGuarding) return false;
          if (this.state === 'dead' || this.health <= 0) return false;
          if (this._staggerT > 0) return false;
          if (this._strikeCooldown > 0) return false;
          if (this._meleePending && !this._meleePending.resolved) return false;

          const fists = this.usesFistsCombat() || !!opts.fists;
          let stats;
          if (fists) stats = this.getFistsStats();
          else if (typeof this.getMeleeStatsForTool === 'function') stats = this.getMeleeStatsForTool(opts.tool || this.currentTool);
          else stats = { damage: 5, reach: (typeof meleeShortReach === 'function' ? meleeShortReach() : 1.35), peak: 0.14, duration: 0.34, cooldown: 0.36, stagger: 0.1 };

          let dmg = opts.damage != null ? opts.damage : stats.damage;
          const rng = opts.reach != null ? opts.reach : stats.reach;
          const dur = stats.duration || 0.28;
          const peak = Math.min(stats.peak || 0.12, Math.max(0.05, dur * 0.85));
          let cd = stats.cooldown || 0.32;
          const hand = (opts.hand != null) ? opts.hand : this.nextHand;
          this.nextHand = -hand;

          // S1 Soft Aguante: always spend; soft punch if low/exhausted
          let soft = false;
          if (fists) {
              const cost = stats.punchCost != null ? stats.punchCost : 9;
              soft = this.fistsStaminaSoft();
              if (soft) {
                  dmg = Math.max(1, Math.round(dmg * (stats.softDamageMult != null ? stats.softDamageMult : 0.5)));
                  cd *= (stats.softCooldownMult != null ? stats.softCooldownMult : 1.4);
              }
              this.spendFistsStamina(cost);
          }

          try {
              if (this.body) {
                  if (fists && typeof this.body.playPunch === 'function') {
                      this.body.playPunch({ side: hand, duration: dur });
                  } else if (typeof this.body.playSwing === 'function') {
                      this.body.playSwing({ duration: dur, side: hand });
                  } else if (typeof this.body.setAction === 'function') {
                      this.body.setAction('swing');
                  }
              }
          } catch (e) {}

          const now = performance.now();
          let aimPos = null;
          try {
              if (opts.aimPos) aimPos = opts.aimPos.clone ? opts.aimPos.clone() : opts.aimPos;
              else if (opts.aimAt && opts.aimAt.container) aimPos = opts.aimAt.container.position.clone();
              else if (this._combatAimPos) aimPos = this._combatAimPos.clone();
              else if (this.target && this.target.container) aimPos = this.target.container.position.clone();
          } catch (e) {}
          this._meleePending = {
              damage: dmg,
              reach: rng,
              forgive: (stats.forgive != null) ? stats.forgive : 0.08,
              stagger: stats.stagger || 0.14,
              tool: fists ? 'fists' : (this.currentTool || 'hands'),
              hand: hand,
              fists: !!fists,
              soft: soft,
              startAt: now,
              clashWindowMs: stats.clashWindowMs != null ? stats.clashWindowMs : 140,
              fromPlayer: !!this.camera,
              aimPos: aimPos,
              aimNpc: (opts.aimAt instanceof NPC) ? opts.aimAt : null,
              peakAt: now + peak * 1000,
              expireAt: now + dur * 1000,
              resolved: false,
              cancelled: false
          };
          this._strikeCooldown = cd;

          try {
              if (this.camera && typeof meleeCooldown !== 'undefined') meleeCooldown = this._strikeCooldown;
          } catch (e) {}
          try {
              if (this.camera && typeof isCombatLabActive === 'function' && isCombatLabActive() &&
                  typeof LAB !== 'undefined' && LAB && LAB.stats) {
                  LAB.stats.swings++;
                  if (typeof updateCombatLabHud === 'function') updateCombatLabHud();
              }
          } catch (e) {}
          try { if (typeof this.applyRecoil === 'function') this.applyRecoil(soft ? 0.04 : 0.07); } catch (e) {}
          return true;
      }

      /**
       * Character facing in XZ. BodyRig + NPC chase use local +Z
       * (input.forward=-1 → wishDir +Z; BODY_MOUNT.yawNpc=0).
       * Player walk/look uses camera −Z; getStrikeRay uses the camera for that.
       */
      getForwardDir(out) {
          const d = out || new THREE.Vector3();
          const yaw = this.container ? this.container.rotation.y : 0;
          // local +Z after Y rotation
          d.set(Math.sin(yaw), 0, Math.cos(yaw));
          return d;
      }

      /** Combat Lab: NPCs may fight each other (nearest-threat). Only while lab active. */
      allowsNpcFights() {
          try {
              if (typeof isCombatLabActive !== 'function' || !isCombatLabActive()) return false;
              const ep = (typeof COMBAT_LAB !== 'undefined' && COMBAT_LAB && COMBAT_LAB.enemyPolicy)
                  ? COMBAT_LAB.enemyPolicy : null;
              if (ep && ep.npcFights === false) return false;
              return true;
          } catch (e) {}
          return false;
      }

      getStrikeRay() {
          const origin = new THREE.Vector3();
          const dir = new THREE.Vector3();
          if (this.camera) {
              this.camera.getWorldPosition(origin);
              this.camera.getWorldDirection(dir);
          } else {
              origin.copy(this.container.position);
              origin.y += (this.halfHeight || 0.8) * 0.55;
              let aimed = false;
              try {
                  let to = null;
                  if (typeof meleeLiveAimPos === 'function') {
                      to = meleeLiveAimPos(this._meleePending, this.target);
                  }
                  if (!to && this._combatAimPos) to = this._combatAimPos;
                  if (!to && this.target && this.target.container) to = this.target.container.position;
                  if (!to && typeof player !== 'undefined' && player && player.health > 0 && player.container) {
                      to = player.container.position;
                  }
                  if (to) {
                      dir.set(to.x - origin.x, 0, to.z - origin.z);
                      if (dir.lengthSq() > 1e-6) {
                          dir.normalize();
                          dir.y = 0.08;
                          dir.normalize();
                          aimed = true;
                      }
                  }
              } catch (e) {}
              if (!aimed) this.getForwardDir(dir);
          }
          return { origin: origin, dir: dir };
      }

      resolveMeleeSwing() {
          const p = this._meleePending;
          if (!p) return;
          if (p.cancelled) {
              this._meleePending = null;
              return;
          }
          const now = performance.now();
          if (!p.resolved && now >= p.peakAt) {
              p.resolved = true;
              this._resolveMeleeHit(p);
          }
          if (now >= p.expireAt || p.cancelled) this._meleePending = null;
      }

      _resolveMeleeHit(p) {
          const rayInfo = this.getStrikeRay();
          const origin = rayInfo.origin;
          const dir = rayInfo.dir;
          const ray = new THREE.Raycaster(origin, dir, 0, p.reach);
          const isPlayerAtk = !!this.camera;
          const targets = [];

          // Symmetric NPC proxies (mesh + collider) for player and lab NPC↔NPC
          if (isPlayerAtk || (typeof this.allowsNpcFights === 'function' && this.allowsNpcFights())) {
              if (typeof meleeCollectNpcTargets === 'function') meleeCollectNpcTargets(this, targets);
              else {
                  try {
                      npcs.forEach(n => {
                          if (n && n !== this && n.health > 0 && n.mesh) targets.push(n.mesh);
                      });
                  } catch (e) {}
              }
          }
          if (isPlayerAtk) {
              try {
                  if (typeof ONLINE_CONFIG !== 'undefined' && ONLINE_CONFIG.friendlyFire &&
                      typeof remotes !== 'undefined' && remotes) {
                      for (const uid in remotes) {
                          if (remotes[uid] && remotes[uid].mesh) targets.push(remotes[uid].mesh);
                      }
                  }
              } catch (e) {}
          } else if (typeof meleeCollectPlayerTargets === 'function') {
              meleeCollectPlayerTargets(targets);
          }

          const hits = targets.length ? ray.intersectObjects(targets, true) : [];
          let hitSomething = false;
          for (let i = 0; i < hits.length; i++) {
              const id = (typeof meleeIdentifyHit === 'function')
                  ? meleeIdentifyHit(hits[i].object, this, NPC)
                  : { npc: null, hitPlayer: false };
              let npc = id.npc;
              let hitPlayer = id.hitPlayer;
              if (!npc && !hitPlayer) {
                  // Fallback walk if helper missing / pre-NPC-class edge
                  let obj = hits[i].object;
                  while (obj) {
                      if (obj.userData && obj.userData.parentCharacter instanceof NPC) {
                          npc = obj.userData.parentCharacter;
                          break;
                      }
                      if (typeof player !== 'undefined' && player &&
                          (obj === player.collider || obj === player.container || obj === player.mesh ||
                           (player.body && obj === player.body.root) ||
                           (obj.userData && obj.userData.isPlayerHitProxy))) {
                          hitPlayer = true;
                          break;
                      }
                      obj = obj.parent;
                  }
                  if (npc === this) npc = null;
              }

              if (isPlayerAtk && npc && npc.health > 0) {
                  this._applyStrikeToTarget(npc, hits[i].point, p);
                  hitSomething = true;
                  break;
              }
              if (!isPlayerAtk && hitPlayer && player && player.health > 0) {
                  this._applyStrikeToTarget(player, hits[i].point, p);
                  hitSomething = true;
                  break;
              }
              if (!isPlayerAtk && npc && npc.health > 0) {
                  this._applyStrikeToTarget(npc, hits[i].point, p);
                  hitSomething = true;
                  break;
              }
          }

          // Shared forgiveness (player + NPC) — short band needs this for feel
          if (!hitSomething && typeof meleeForgivenessHit === 'function') {
              let forgiveTarget = null;
              if (p.aimNpc && p.aimNpc.health > 0) forgiveTarget = p.aimNpc;
              else if (isPlayerAtk) {
                  try {
                      let best = null, bestD = Infinity;
                      if (typeof npcs !== 'undefined' && npcs) {
                          for (let i = 0; i < npcs.length; i++) {
                              const n = npcs[i];
                              if (!n || n.health <= 0 || !n.container) continue;
                              const d = origin.distanceTo(n.container.position);
                              if (d < bestD) { bestD = d; best = n; }
                          }
                      }
                      forgiveTarget = best;
                  } catch (e) {}
              } else if (this.target && this.target.health > 0 && this.target.container) {
                  forgiveTarget = this.target;
              } else if (typeof player !== 'undefined' && player && player.health > 0) {
                  forgiveTarget = player;
              }
              const slack = (p.forgive != null) ? p.forgive
                  : ((typeof this.getFistsStats === 'function') ? this.getFistsStats().forgive : 0.08);
              const forg = meleeForgivenessHit(origin, dir, p.reach, slack, forgiveTarget);
              if (forg) {
                  this._applyStrikeToTarget(forg.target, forg.point, p);
                  hitSomething = true;
              }
          }

          if (!hitSomething && isPlayerAtk) {
              try { playSound('weapon_empty'); } catch (e) {}
          }
          return hitSomething;
      }

      _applyStrikeToTarget(target, hitPoint, p) {
          if (!p || p.cancelled) return false;
          // S1 Strict: if both swinging in clash window, earlier startAt wins
          if (p.fists && target && typeof meleeClashVerdict === 'function') {
              const verdict = meleeClashVerdict(p, target);
              if (verdict === 'lose') {
                  try {
                      if (typeof noteCombatLabClash === 'function') noteCombatLabClash('lose');
                  } catch (e) {}
                  try { playSound('weapon_empty'); } catch (e) {}
                  return false;
              }
              if (verdict === 'win') {
                  try {
                      if (typeof meleeCancelPending === 'function') meleeCancelPending(target, 'clash_lose');
                  } catch (e) {}
                  try {
                      if (typeof noteCombatLabClash === 'function') noteCombatLabClash('win');
                  } catch (e) {}
              }
          }
          const hitY = hitPoint ? hitPoint.y : null;
          let finalDmg = p.damage;
          let zone = null;
          try {
              if (hitY != null && typeof scaleDamageByHit === 'function') {
                  const scaled = scaleDamageByHit(p.damage, target, hitY);
                  finalDmg = scaled.damage;
                  zone = scaled.zone;
              }
          } catch (e) {}
          try {
              if (typeof target.takeDamage === 'function') {
                  target.takeDamage(finalDmg, {
                      zone: zone,
                      hitY: hitY,
                      preScaled: true,
                      heavy: zone === 'head' || finalDmg >= 18,
                      stagger: p.stagger,
                      from: this.container ? this.container.position : null,
                      fromNpc: (this instanceof NPC) ? this : null
                  });
              }
          } catch (e) {}
          try {
              if (hitPoint && typeof createHarvestEffect === 'function') createHarvestEffect(hitPoint);
          } catch (e) {}
          try {
              if (hitPoint) playSoundAt('flesh_hit', hitPoint, { gain: 0.95, maxDist: 30 });
              else playSound('hit');
          } catch (e) {}
          try {
              if (this.camera && typeof noteCombatLabMeleeHit === 'function') {
                  noteCombatLabMeleeHit({ zone: zone, damage: finalDmg, tool: p.tool, hand: p.hand });
              }
          } catch (e) {}
      }

      update(delta, collidables) {
          if (isGamePaused) return;

          if (this._strikeCooldown > 0) this._strikeCooldown = Math.max(0, this._strikeCooldown - delta);
          if (this._guardAiT > 0) this._guardAiT = Math.max(0, this._guardAiT - delta);
          try { this.resolveMeleeSwing(); } catch (e) {}
          
          this._previousPosition.copy(this.container.position);
          const wasOnGround = this.isOnGround;

          // Store movement delta for collision response
          this.checkGround(collidables);
          this.processMovement(delta, collidables);

          // Aguante: sprint + fists guard drain; regen after rest delay.
          let staminaBusy = false;
          if (this.isSprinting && this.isOnGround && !this.staminaExhausted && this.stamina > 0) {
              this.stamina = Math.max(0, this.stamina - this.staminaSprintDrain * delta);
              staminaBusy = true;
              if (this.stamina <= 0.5) {
                  this.stamina = 0;
                  this.staminaExhausted = true;
                  this.isSprinting = false;
                  try { if (typeof lvToast === 'function') lvToast('Sin aguante: caminá un poco para recuperarlo'); } catch (e) {}
              }
          }
          // S1 Soft: holding guard drains Aguante (lab fists)
          if (this.isGuarding && typeof this.usesFistsCombat === 'function' && this.usesFistsCombat()) {
              const fs = this.getFistsStats();
              const drain = fs.guardDrainPerSec != null ? fs.guardDrainPerSec : 12;
              this.stamina = Math.max(0, (this.stamina || 0) - drain * delta);
              staminaBusy = true;
              if (this.stamina <= 0.5) {
                  this.stamina = 0;
                  this.staminaExhausted = true;
                  this.setGuard(false);
              }
          }
          if (staminaBusy) {
              this._staminaRestTimer = 0;
          } else {
              this._staminaRestTimer = (this._staminaRestTimer || 0) + delta;
              if (this._staminaRestTimer >= this.staminaRegenDelay) {
                  this.stamina = Math.min(this.maxStamina, this.stamina + this.staminaRegen * delta);
              }
          }
          if (this.staminaExhausted && this.stamina >= this.staminaExhaustRecover) {
              this.staminaExhausted = false;
          }
          this.energy = Math.min(100, this.energy + delta * 2);

          // Update coyote time
          if (this.isOnGround) {
              this.coyoteTime = this.coyoteTimeMax;
          } else if (wasOnGround) {
              // Just left the ground, start coyote time
              this.coyoteTime = this.coyoteTimeMax;
          } else {
              this.coyoteTime = Math.max(0, this.coyoteTime - delta);
          }
          
          if (this.jumpGraceTimer > 0) {
            this.jumpGraceTimer -= delta;
          }

          // Calculate actual movement after physics
          this._movementDelta.copy(this.container.position).sub(this._previousPosition);
          
          this.updateColliderBox();
      }
      processMovement(delta, collidables) {
          // Calculate movement direction
          const moveForward = this.input.backward - this.input.forward;
          const moveLeft = this.input.right - this.input.left;
          const wishDirection = new THREE.Vector3(moveLeft, 0, moveForward).normalize();
          
          // Apply player rotation to movement direction
          const moveDirection = wishDirection.applyEuler(
              new THREE.Euler(0, this.container.rotation.y, 0, 'YXZ')
          );

          // Apply movement speed with sprint / crouch modifiers
          let currentSpeed = this.config.speed;
          if (this.crouched) {
              currentSpeed *= (this.config.crouchSpeedFactor != null) ? this.config.crouchSpeedFactor : 0.5;
          } else if (this.isSprinting && this.isOnGround && this.stamina > 0) {
              currentSpeed *= this.config.sprintMultiplier;
          }

          // Calculate target velocity and apply acceleration
          const targetVelocityXZ = moveDirection.multiplyScalar(currentSpeed);
          const accelerationFactor = (this.isOnGround ? 
              this.config.acceleration : 
              this.config.acceleration * this.config.airControl) * delta;

          this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, targetVelocityXZ.x, accelerationFactor);
          this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, targetVelocityXZ.z, accelerationFactor);

          // Apply friction when grounded and not moving
          if (this.isOnGround && moveForward === 0 && moveLeft === 0) {
              this.velocity.x *= Math.pow(this.config.friction, delta * 10);
              this.velocity.z *= Math.pow(this.config.friction, delta * 10);
          }

          // Apply gravity only when airborne
          if (!this.isOnGround) {
            this.velocity.y += this.gravity * delta;
            // Air resistance
            this.velocity.x *= Math.pow(0.98, delta * 60);
            this.velocity.z *= Math.pow(0.98, delta * 60);
          } else if (this.isOnGround) {
              // Soft velocity reset with damping when grounded
              this.velocity.y = 0; // Increased damping from 0.7
          }

          // Calculate movement delta and handle collisions
          const moveDelta = this.velocity.clone().multiplyScalar(delta);
          
          // Attempt step climbing before main collision resolution
          if (this.isOnGround) {
              if (this.handleStepClimbing(collidables, moveDelta, delta)) {
                  // If step climbing succeeded, skip the rest of movement processing
                  this.updateColliderBox();
                  return;
              }
          }

          // Resolve all collisions
          this.resolveCollisions(collidables, moveDelta);
      }

      resolveCollisions(collidables, moveDelta) {
        const originalPos = this.container.position.clone();
        const targetPos   = originalPos.clone().add(moveDelta);
        // PR3: remote player capsules (pose-interpolated) — soft P–P collision, 0 extra bytes.
        const remotesList = (typeof remoteColliders !== 'undefined' && remoteColliders)
          ? remoteColliders
          : [];
        const objects     = [...collidables, ...placedBlocks, ...remotesList];

        // Temps for collision math
        const penetration = new THREE.Vector3();
        const normal      = new THREE.Vector3();
        const centerA     = new THREE.Vector3();
        const centerB     = new THREE.Vector3();

        let yCollisionResolved = false;
        let collided            = false;

        // Move to target and update our bounding box
        this.container.position.copy(targetPos);
        this.updateColliderBox();

        const maxIterations = 5;
        let i;
        for (i = 0; i < maxIterations; i++) {
          let anyCorrection = false;

          for (const obj of objects) {
            // — skip non‐collidables —
            if (
              !obj ||
              !obj.visible ||
              obj === this.collider ||
              obj === this.colliderBoxHelper ||
              obj === this.mesh ||
              obj.isBullet
            ) continue;

            const objBox = this.getObjectBoundingBox(obj);
            if (!objBox || !this.colliderBox.intersectsBox(objBox)) continue;

            // — handle collectibles immediately —
            if (obj.isCollectible && obj.inContact && !obj.userData.collected) {
              this.handleCollectible(obj);
              continue;
            }

            // — compute axis overlaps —
            const overlapX =
              Math.min(this.colliderBox.max.x, objBox.max.x) -
              Math.max(this.colliderBox.min.x, objBox.min.x);
            const overlapY =
              Math.min(this.colliderBox.max.y, objBox.max.y) -
              Math.max(this.colliderBox.min.y, objBox.min.y);
            const overlapZ =
              Math.min(this.colliderBox.max.z, objBox.max.z) -
              Math.max(this.colliderBox.min.z, objBox.min.z);

            if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) continue;

            // — pick the smallest overlap axis —
            let axis       = 'x';
            let minOverlap = overlapX;
            if (overlapY < minOverlap) { axis = 'y'; minOverlap = overlapY; }
            if (overlapZ < minOverlap) { axis = 'z'; minOverlap = overlapZ; }

            // — special‐case ground (& buildable‐top) collisions —
            if (
              axis === 'y' &&
              (obj === groundMesh || obj.userData?.allowBuildingOnTop) &&
              this._lastPenetrationDepth > this.config.maxStepHeight + this.config.collisionEpsilon
            ) {
              const penetrationDepth = this.colliderBox.min.y - objBox.max.y;
              if (penetrationDepth < 0) {
                // lift up out of ground
                this.container.position.y -= penetrationDepth;
                this.velocity.y = 0;
                this.isOnGround = true;
                yCollisionResolved = true;
                anyCorrection = true;
              }
            }
            else {
              // — standard collision: compute penetration vector —
              this.colliderBox.getCenter(centerA);
              objBox.getCenter(centerB);
              const direction = centerA[axis] < centerB[axis] ? -1 : 1;
              penetration[axis] = (minOverlap + this.config.collisionEpsilon) * direction;
              anyCorrection = true;
            }

            // — if we’ve got any penetration, apply it and slide our velocity —
            if (penetration.lengthSq() > 0) {
              this.container.position.add(penetration);
              normal.copy(penetration).normalize();

              const velAlongNormal = this.velocity.dot(normal);
              if (velAlongNormal < 0) {
                // reflect away from surface, with slight overcorrection factor
                this.velocity.addScaledVector(normal, -velAlongNormal * 1.01);
                // ensure we don’t “sink” into ground again
                if (axis === 'y' && this.isOnGround) {
                  this.velocity.y = 0;
                }
              }

              this.updateColliderBox();
              collided = true;
              penetration.set(0, 0, 0);
            }
      
          } // end for obj

          if (!anyCorrection) break;
        }

        const hitMax = i >= maxIterations;

        // ensure ground‐state is correct if we never hit Y collision above
        if (!yCollisionResolved) {
          this.checkGround(collidables);
        }

        // fallback to original pos if we got stuck
        if (collided && hitMax) {
          console.log("player got stuck?");

          //this.container.position.copy(originalPos);
          //this.velocity.set(0, 0, 0);
          //this.updateColliderBox();
          //this.checkGround(collidables);
        }

        // finally, snap to ground if we’re on it
        if (this.isOnGround) {
          this.snapToGround(collidables);
        }
      }

      snapToGround(collidables) {
          if (this.isClimbing) return; // Add this line at the top

          const snapRayOrigin = this.container.position.clone();
          snapRayOrigin.y -= (this.halfHeight - 0.05);
          
          const snapRaycaster = new THREE.Raycaster(
              snapRayOrigin, 
              new THREE.Vector3(0, -1, 0), 
              0, 
              0.5
          );
          
          const hits = snapRaycaster.intersectObjects(
              [groundMesh, ...placedBlocks].filter(o => o?.visible),
              true
          );

          let closestHit = null;
          let minDistance = Infinity;

          for (const hit of hits) {
              if (hit.object === this.collider || !hit.face || 
                  hit.face.normal.y <= Math.cos(this.config.maxSlopeAngle)) {
                  continue;
              }
              
              const distance = hit.distance;
              if (distance < minDistance) {
                  minDistance = distance;
                  closestHit = hit;
              }
          }

          if (closestHit) {
              const newY = closestHit.point.y + this.halfHeight + 0.05;
              // Use lerp with tighter factor (0.4) for quicker snapping
              this.container.position.y = THREE.MathUtils.lerp(
                  this.container.position.y,
                  newY,
                  0.2
              );
              this.velocity.y = 0;
          }
      }

      getObjectBoundingBox(object) {
          // Early return for invalid objects
          if (!object) return null;

          // NPCs use their character collider box
          if (object.userData?.parentCharacter instanceof NPC) {
              const npc = npcs.find(n => n.mesh === object);
              if (npc?.colliderBox) {
                  npc.updateColliderBox();
                  return npc.colliderBox;
              }
              return null;
          }

          // Return precomputed box for static objects
          if (object.isStatic && object.userData.worldBoundingBox?.isEmpty() === false) {
              return object.userData.worldBoundingBox;
          }

          // Remote coop avatars: capsule ≈ r 0.4 (NET_REMOTE_COLLIDER_R)
          if (object.userData && object.userData.isRemotePlayer && object.geometry) {
              object.updateMatrixWorld(true);
              const box = this._tempBox.setFromObject(object, true);
              // Slight shrink to reduce jitter from 3–4 Hz pose interpolation
              try { box.expandByScalar(-0.05); } catch (e) {}
              return box;
          }

          // Calculate dynamic objects on the fly
          if (object.geometry) {
              object.updateMatrixWorld(true);
              return this._tempBox.setFromObject(object, true);
          }

          // Grupos colisionables: nodos de recursos y tótems (sólidos),
          // o pickups automáticos (comida/toxina) para detectar el contacto.
          if (object.isGroup && (object.userData?.solid || (object.isCollectible && object.inContact))) {
              object.updateMatrixWorld(true);
              return this._tempBox.setFromObject(object, true);
          }

          return null;
      }

      checkGround(collidables) {
           if (this.jumpGraceTimer > 0) {
            this.isOnGround = false; // force airborne during jump grace
            return false;
          }

          const rayOrigin = this.container.position.clone();
          rayOrigin.y -= (this.halfHeight - 0.05);
          
          // Use just two rays - center and slightly forward
          const rayDirections = [
              new THREE.Vector3(0, -1, 0), // Center
              this.direction.clone().normalize().multiplyScalar(0.3).add(new THREE.Vector3(0, -1, 0)) // Forward + down
          ];
          
          let anyGroundHit = false;
          let closestHitDistance = Infinity;
          let closestHitPoint = null;
          let closestHitNormal = null;
          
          rayDirections.forEach(dir => {
              this.downRaycaster.set(rayOrigin, dir, 0, this.halfHeight + this.config.groundCheckDistance);
              const hits = this.downRaycaster.intersectObjects([groundMesh, ...collidableObjects, ...placedBlocks], true);
              
              const groundHit = hits.find(hit => {
                  // Only count as ground if surface is flat enough
                  return hit.face && hit.face.normal.y > 0.1;
              });
              
              if (groundHit) {
                  anyGroundHit = true;
                  if (groundHit.distance < closestHitDistance) {
                      closestHitDistance = groundHit.distance;
                      closestHitPoint = groundHit.point;
                      closestHitNormal = groundHit.face.normal;
                  }
              }
          });
          
          // Only adjust position if significantly above ground
          if (anyGroundHit && closestHitPoint) {
              const feetY = this.container.position.y - this.halfHeight;
              const distanceToGround = feetY - closestHitPoint.y;
              
              if (distanceToGround > 0.02) { // Increased from 0.01
                  this.container.position.y -= distanceToGround - 0.05; // Small buffer
                  this.onLand(closestHitPoint.y); // Pass actual ground height
              }
          }

          if (debugMode && closestHitPoint && !isGamePaused) {
            if (!this._groundMarker) {
              const geo = new THREE.SphereGeometry(0.05, 8, 6);
              const mat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
              this._groundMarker = new THREE.Mesh(geo, mat);
              this.scene.add(this._groundMarker);
            }
            this._groundMarker.position.copy(closestHitPoint);
          }

          if (debugMode && !isGamePaused) {
            console.log("groundMesh=", groundMesh);
            console.log(
              `ground? ${anyGroundHit} | dist=${closestHitDistance.toFixed(3)}m | velY=${this.velocity.y.toFixed(3)}`
            );
          }
          
          this.isOnGround = anyGroundHit;
          return this.isOnGround;
      }
      onLand(groundHeight) {
          this.isOnGround = true;
          this.canJump = true;
          this.jumpCooldown = 0;
      }

      handleCollisions(collidables, axis) {
        const epsilon = this.config.collisionEpsilon;
        const characterBox = this.colliderBox;

        if (!this.collider || characterBox.isEmpty()) {
          console.warn("Character collider box invalid in handleCollisions");
          return false;
        }

        let collisionOccurred = false;
        const ground = typeof groundMesh !== 'undefined' ? groundMesh : null;
        const tempPenetration = new THREE.Vector3();
        const tempCenterChar = new THREE.Vector3();
        const tempCenterObj = new THREE.Vector3();

        for (const object of collidables) {
          if (
            !object || 
            !object.visible || 
            object === this.collider || 
            object === ground || 
            object === this.colliderBoxHelper || 
            object.isBullet
          ) continue;

          let objectBox = null;

          if (object.userData?.parentCharacter instanceof NPC) {
            const npc = npcs.find(n => n.mesh === object);
            if (npc?.colliderBox) {
              npc.updateColliderBox();
              objectBox = npc.colliderBox;
            } else {
              continue;
            }
          } 
          else if (object.isStatic && object.userData.worldBoundingBox && !object.userData.worldBoundingBox.isEmpty()) {
            objectBox = object.userData.worldBoundingBox;
          } 
          else if (placedBlocks.includes(object) && object.geometry) {
            object.updateMatrixWorld(true);
            objectBox = new THREE.Box3().setFromObject(object, true);
          } 
          else if (object.geometry) {
            object.updateMatrixWorld(true);
            objectBox = new THREE.Box3().setFromObject(object, true);
          }

          if (!objectBox || objectBox.isEmpty()) continue;
          if (!characterBox.intersectsBox(objectBox)) continue;

          // Collectibles handling
          if (object.isCollectible && !object.userData.collected) {
            this.handleCollectible(object);
            continue;
          }

          // --- Physical collision resolution ---
          collisionOccurred = true;
          characterBox.getCenter(tempCenterChar);
          objectBox.getCenter(tempCenterObj);
          tempPenetration.set(0, 0, 0);

          if (axis === 'x') {
            const overlap = Math.min(characterBox.max.x, objectBox.max.x) - Math.max(characterBox.min.x, objectBox.min.x);
            tempPenetration.x = (tempCenterChar.x < tempCenterObj.x ? -1 : 1) * (overlap + epsilon);
            this.container.position.x -= tempPenetration.x;
            this.velocity.x = 0;
            this.updateColliderBox();
          } 
          else if (axis === 'z') {
            const overlap = Math.min(characterBox.max.z, objectBox.max.z) - Math.max(characterBox.min.z, objectBox.min.z);
            tempPenetration.z = (tempCenterChar.z < tempCenterObj.z ? -1 : 1) * (overlap + epsilon);
            this.container.position.z -= tempPenetration.z;
            this.velocity.z = 0;
            this.updateColliderBox();
          } 
          else if (axis === 'y') {
            const overlap = Math.min(characterBox.max.y, objectBox.max.y) - Math.max(characterBox.min.y, objectBox.min.y);
            if (overlap < epsilon) continue; // Ignore tiny overlaps

            if (this.velocity.y < 0 && characterBox.min.y < objectBox.max.y && tempCenterChar.y > tempCenterObj.y) {
              // Falling down onto object
              tempPenetration.y = overlap + epsilon;
              this.container.position.y += tempPenetration.y;
              this.velocity.y = 0;
              this.isOnGround = true;
              this.onLand();
              this.updateColliderBox();
            } 
            else if (this.velocity.y > 0 && characterBox.max.y > objectBox.min.y && tempCenterChar.y < tempCenterObj.y) {
              // Jumping up into object
              tempPenetration.y = -(overlap + epsilon);
              this.container.position.y += tempPenetration.y;
              this.velocity.y = 0;
              this.updateColliderBox();
            }
          }
        }

        return collisionOccurred;
      }
      handleStepClimbing(collidables, moveDelta, delta) {
        //console.log("found step");
        if (!this.isOnGround) return false;

        // 1) Use your configured max step & detection range
        const stepHeight    = this.config.maxStepHeight;    // e.g. 0.5
        const forwardDist   = this.config.stepForwardCheck; // e.g. 0.2

        // 2) Ray from your feet forward
        const origin = this.container.position.clone();
        origin.y   -= this.halfHeight - 0.1;

        const moveDir = new THREE.Vector3(moveDelta.x, 0, moveDelta.z).normalize();
        const footRay = new THREE.Raycaster(origin, moveDir, 0, forwardDist);
        const hits    = footRay.intersectObjects([...collidables, ...placedBlocks], true);

        const stepHit = hits.find(hit => {
          if (!hit.face || Math.abs(hit.face.normal.y) > 0.1) return false;
          const heightDiff = hit.point.y - origin.y;
          return heightDiff > 0 && heightDiff <= stepHeight;
        });
        if (!stepHit) {
          this.isClimbing = false;
          return false;
        }

        // 3) Cast down from top of that step to find a flat surface
        const topOrigin = stepHit.point.clone();
        topOrigin.y   += stepHeight + 0.01;
        const topRay   = new THREE.Raycaster(topOrigin, new THREE.Vector3(0, -1, 0), 0, stepHeight + 0.05);
        const topHits  = topRay.intersectObjects([...collidables, ...placedBlocks], true);
        const topFace  = topHits.find(h => h.face.normal.y > 0.8);
        if (!topFace) {
          this.isClimbing = false;
          return false;
        }

        // 4) Smoothly interpolate up to the new Y
        const targetY      = topFace.point.y + this.halfHeight;
        const climbFactor  = this.config.stepClimbSpeed * delta; // e.g. 5 units/sec
        const newY         = THREE.MathUtils.lerp(this.container.position.y, targetY, climbFactor);
        this.container.position.y = newY;
        console.log("targetY:",targetY);
        console.log("climbFactor:",climbFactor);
        console.log("newY:",newY);
        console.log("this.container.position.y:",this.container.position.y);
        
        // 5) Maintain horizontal momentum
        this.velocity.x *= this.config.horizontalStepBoost;
        this.velocity.z *= this.config.horizontalStepBoost;

        this.updateColliderBox();
        this.isClimbing = Math.abs(targetY - newY) > 0.01;
        return this.isClimbing;
      }
      handleCollectible(collectible) {
          if (collectible.userData.collected) return;
          collectible.userData.collected = true;
          
          // Remove from scene
          this.scene.remove(collectible);
          const index = collidableObjects.indexOf(collectible);
          if (index > -1) collidableObjects.splice(index, 1);
          
          console.log("Character handleCollectible(collectible) ",collectible);

          // Handle different collectible types
          switch(collectible.type) {
              case 'food':
                  this.health = Math.min(100, this.health + (collectible.userData.healAmount || 20));
                  playSound('health-regen');
                  this.foodCollected++;
                  break;
                  
              case 'toxin':
                  this.health -= collectible.userData.damageAmount || 30;
                  if (this.health < 0) this.health = 0;
                  playSound('damage-taken');
                  this.toxinsCollected++;
                  break;
                                    
              default:
                  if (collectible.isPickupable) {
                      // NPC try to pick up something
                      console.log("NPC try to pick up something"); 
                  }
          }
          
          this.updateStatsHUD?.();
      }

      applyDamageEffect() {
          // To be implemented fully in Player subclass if needed (e.g., screen flash)
          console.log("Character took damage!");
          // Simple visual feedback: Maybe flash the debug collider red?
          if (this.collider) {
              const originalColor = this.collider.children[0].material.color.clone();
              this.collider.children.forEach(child => child.material.color.setHex(0xff0000));
              setTimeout(() => {
                  if (this.collider) { // Check if collider still exists
                       this.collider.children.forEach(child => child.material.color.copy(originalColor));
                  }
              }, 150);
          }
      }

      // Method to check if placing a block at 'position' would collide with this character
      checkBlockPlacementCollision(position) {
          const testBlockRadius = 0.5; // Half-width of the block
          const testBox = new THREE.Box3(
              new THREE.Vector3(position.x - testBlockRadius, position.y - testBlockRadius, position.z - testBlockRadius),
              new THREE.Vector3(position.x + testBlockRadius, position.y + testBlockRadius, position.z + testBlockRadius)
          );

          // Ensure the character's collider box is up-to-date before checking
          this.updateColliderBox();
          return this.colliderBox.intersectsBox(testBox);
      }
  }
  class Player extends Character {
      constructor(camera, scene) {
          super(scene); // Call Character constructor
          this.camera = camera;

          // Add camera to container for 1st person view
          this.container.add(this.camera);
          // Position camera at eye level within the container
          this.camera.position.set(0, this.config.height * 0.5, 0); // e.g., 10% below 

          // NPC melee rays hit this capsule (player has no .mesh)
          try {
              if (this.collider) {
                  this.collider.userData = this.collider.userData || {};
                  this.collider.userData.isPlayerHitProxy = true;
              }
          } catch (e) {}

          // Player-specific Input State
          this.keys = {}; // Tracks currently pressed keys
          this.touchMoveStartX = 0;
          this.touchMoveStartY = 0;
          this.touchLookStartX = 0;
          this.touchLookStartY = 0;
          this.touchMoveActive = false;
          this.touchLookActive = false;
          this.joystickValues = { x: 0, y: 0 };
          this.mobileJumpPressed = false;
          this.mobileSprintPressed = false;

          // Effects State
          this.headBobTimer = 0;
          this.footstepTimer = 0;
          this.weaponBasePosition = new THREE.Vector3(0.25, -0.2, -0.4); // Re-evaluate Y
          this.hammerBasePosition = new THREE.Vector3(0.3, -0.3, -0.5); // Re-evaluate Y
          this.axeBasePosition = new THREE.Vector3(0.3, -0.3, -0.5); // Re-evaluate Y
          this.pickaxeBasePosition = new THREE.Vector3(0.3, -0.3, -0.5); // Re-evaluate Y
          this.heldItemOffset = new THREE.Vector3(0.4, -0.3, -0.6); // Re-evaluate Y
          this.weaponTargetBob = new THREE.Vector3();
          this.targetCameraRotationX = 0; // Used for smoothing and recoil

          // Tool Models (References set during init)
          this.gunModel = null;
          this.hammerModel = null;
          this.axeModel = null;
          this.pickaxeModel = null;
    
          // Initialize inventory with empty hands
          this.inventory = new Inventory(this);

          // PR3: 1P body (box-doll). Camera stays sibling under container; head joint drives eye pos.
          if (this.config.useBodyRig !== false && typeof createBody === 'function') {
              this.body = createBody({
                  mode: 'player',
                  bodyTypeId: 'normie',
                  showGunStub: false,
                  mountOnCharacter: true
              });
              const feetY = (typeof BODY_MOUNT !== 'undefined' && BODY_MOUNT.feetYFromHalfHeight)
                  ? BODY_MOUNT.feetYFromHalfHeight(this.halfHeight)
                  : -this.halfHeight;
              this.body.root.position.y = feetY;
              this.container.add(this.body.root);
          }

          this.updateToolModelVisibility(); // Set initial visibility
          this.updateToolHUD(); // Set initial HUD
          this.updateStatsHUD(); // Set initial stats HUD
      }

      // Override Character's update
      update(delta, keys, collidables) {
          if (typeof creatorMode !== 'undefined' && creatorMode && this.creatorFly) {
              this.flyUpdate(delta, keys);
              try {
                  this.updateInteractionRaycast();
                  this.updateCameraRotation(delta);
                  this.updateStatsHUD();
              } catch (e) {}
              return;
          }
          this.processInput(keys, delta); // Handle player input first to set this.input

          const wasGrounded = this.isOnGround;
          const fallSpeed = Math.max(0, -this.velocity.y);

          // Call Character's update for physics, movement, base stats
          super.update(delta, collidables);

          // Player-specific updates AFTER movement/physics
          const isMovingHorizontally = (Math.abs(this.input.forward - this.input.backward) > 0.1 || Math.abs(this.input.left - this.input.right) > 0.1) && this.isOnGround;

          if (!wasGrounded && this.isOnGround && fallSpeed > 3) {
              try { playSound('land', { gain: Math.min(1, fallSpeed / 14) }); } catch (e) {}
              try {
                  if (this.body) {
                      if (typeof this.body.playLand === 'function') this.body.playLand(fallSpeed);
                      if (typeof this.body.emit === 'function') {
                          this.body.emit('landed', +fallSpeed.toFixed(1));
                      }
                  }
              } catch (e) {}
          }
          this.updateFootsteps(delta, isMovingHorizontally);

          const pitch = this.camera ? this.camera.rotation.x : 0;
          const yaw = this.container ? this.container.rotation.y : 0;
          const dtLook = Math.max(delta, 1e-4);
          let lookYaw = 0;
          let lookPitch = 0;
          if (this._prevLookYaw == null) {
              this._prevLookYaw = yaw;
              this._prevLookPitch = pitch;
          } else {
              lookYaw = (yaw - this._prevLookYaw) / dtLook;
              lookPitch = (pitch - this._prevLookPitch) / dtLook;
              this._prevLookYaw = yaw;
              this._prevLookPitch = pitch;
          }
          this._lookYawRate = lookYaw;
          this._lookPitchRate = lookPitch;
          this.updateBodyRig(delta, {
              fp: true,
              hasGun: this.currentTool === TOOLS.GUN,
              pitch: pitch,
              lookYaw: lookYaw,
              lookPitch: lookPitch
          });
          this._bodyToolDt = delta;
          this.syncBodyToolMount();
          this.updateBodyHeadCamera(delta, isMovingHorizontally);
          
          this.updateInteractionRaycast();
          if (!(this.body && this.config.useBodyHeadCamera)) {
              this.updateHeadBob(delta, isMovingHorizontally);
          }
          this.updateToolSwayAndBob(delta); // Unified sway/bob for current tool/item
          this.updateCameraRotation(delta);
          this.updateStatsHUD(); // Update HUD display
          try {
              if (typeof document !== 'undefined' && document.documentElement) {
                  document.documentElement.dataset.fpsPose = this.getPoseId();
              }
          } catch (e) {}
      }

      /** Eye at head joint (+ optional −Z nudge). Keeps camera as container child (look yaw/pitch unchanged). */
      updateBodyHeadCamera(delta, isMoving) {
          if (!this.body || !this.body.headJoint || !this.config.useBodyHeadCamera) return;
          if (!this._headCamLocal) this._headCamLocal = new THREE.Vector3();
          this.body.headJoint.getWorldPosition(this._headCamLocal);
          this.container.worldToLocal(this._headCamLocal);
          // Nudge along camera look (−Z local of camera ≈ walk forward for player).
          const nudge = this.config.bodyHeadForwardNudge != null ? this.config.bodyHeadForwardNudge : 0.08;
          this._headCamLocal.z -= nudge;
          if (this.crouched) {
              // head joint already drops with crouch pose; tiny settle
          }
          this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, this._headCamLocal.x, Math.min(1, delta * 18));
          this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, this._headCamLocal.y, Math.min(1, delta * 18));
          this.camera.position.z = THREE.MathUtils.lerp(this.camera.position.z, this._headCamLocal.z, Math.min(1, delta * 18));
      }

      /** Tools that should live on wrist_R (body integration). */
      wantsBodyToolMount(tool) {
          if (!this.body || !this.body.toolMount) return false;
          if (this.config.gunOnBodyMount === false && this.config.bodyToolsOnMount === false) return false;
          const t = tool || this.currentTool;
          if (t === TOOLS.GUN) return this.config.gunOnBodyMount !== false;
          if (this.config.bodyToolsOnMount === false) return false;
          const list = (typeof BODY_DEF !== 'undefined' && BODY_DEF.bodyMountToolTypes)
              ? BODY_DEF.bodyMountToolTypes
              : ['gun', 'hammer', 'axe', 'pickaxe', 'torch'];
          return list.indexOf(t) >= 0;
      }

      getBodyGripSpec(itemId) {
          const grips = (typeof BODY_DEF !== 'undefined' && BODY_DEF.grips) ? BODY_DEF.grips : {};
          return grips[itemId] || grips.pistol || {
              local: [0, -0.18, 0.14], palm: [0.018, 0.022, 0.018],
              mode: 'hold', holdEuler: [0.20, 0.04, 0.10], lookFollow: 0.16, smooth: 11
          };
      }

      findInventoryPistol() {
          if (!this.inventory || !this.inventory.items) return null;
          for (let i = 0; i < this.inventory.items.length; i++) {
              const it = this.inventory.items[i];
              if (!it) continue;
              if (it.id === 'pistol' || it.toolType === TOOLS.GUN) return it;
          }
          return null;
      }

      /**
       * Fase A/B/D: equipped tool on wrist; pistol holsters on hip_R when not in hand.
       */
      syncBodyToolMount() {
          if (!this.body || !this.body.toolMount) return;
          if (!this._bodyMountedModels) this._bodyMountedModels = new Set();

          const wrist = this.body.toolMount;
          const hip = (this.body.sockets && this.body.sockets.hip_R) || null;
          const equipped = this.inventory && this.inventory.equippedItem;
          const wantWrist = equipped && equipped.model && this.wantsBodyToolMount(this.currentTool);
          const pistolItem = this.findInventoryPistol();
          const holsterOn = this.config.holsterGun !== false && hip && pistolItem && pistolItem.model &&
              !(wantWrist && equipped === pistolItem);

          // Clear wrist mounts that shouldn't be there
          this._bodyMountedModels.forEach((m) => {
              if (!m) return;
              const isHolstered = m.userData && m.userData._bodyHolstered;
              if (isHolstered) return;
              if (!wantWrist || m !== equipped.model) {
                  // If it's the pistol and we want holster, move to hip instead of camera
                  if (holsterOn && pistolItem && m === pistolItem.model) {
                      this.mountPistolHolster(pistolItem.model, hip);
                      return;
                  }
                  this.unmountViewmodelToCamera(m);
                  this._bodyMountedModels.delete(m);
              }
          });

          if (wantWrist) {
              const model = equipped.model;
              // Leaving holster → wrist
              if (model.userData && model.userData._bodyHolstered) {
                  delete model.userData._bodyHolstered;
                  try {
                      if (this.body.setAction) this.body.setAction('use'); // short draw flash
                  } catch (e) {}
              }
              const itemId = equipped.id || 'pistol';
              const grip = this.getBodyGripSpec(itemId);
              this.mountViewmodelOnSocket(model, wrist, { itemId: itemId, grip: grip, holster: false });
              this._bodyMountedModels.add(model);
          }

          if (holsterOn) {
              // Ensure mesh exists (pistol may never have been equipped this session)
              if (!pistolItem.model) {
                  try {
                      const d = (typeof ITEM_DEFINITIONS !== 'undefined') &&
                          (ITEM_DEFINITIONS.pistol || ITEM_DEFINITIONS[pistolItem.id]);
                      if (d && d.createModel) pistolItem.model = d.createModel();
                  } catch (e) {}
              }
              if (pistolItem.model) {
                  this.mountPistolHolster(pistolItem.model, hip);
                  this._bodyMountedModels.add(pistolItem.model);
              }
          } else if (pistolItem && pistolItem.model && pistolItem.model.userData &&
                     pistolItem.model.userData._bodyHolstered && wantWrist && equipped === pistolItem) {
              // drawn — holster flag cleared above
          } else if (pistolItem && pistolItem.model && !holsterOn && !wantWrist) {
              // No holster mode / no hip: hide on camera rest
              if (pistolItem.model.userData._bodyHolstered) {
                  this.unmountViewmodelToCamera(pistolItem.model);
                  this._bodyMountedModels.delete(pistolItem.model);
              }
          }
      }

      mountPistolHolster(model, hipSocket) {
          if (!model || !hipSocket) return;
          const holster = (typeof BODY_DEF !== 'undefined' && BODY_DEF.holster) ? BODY_DEF.holster : null;
          const wasOnWrist = this.body.toolMount && model.parent === this.body.toolMount;
          if (model.parent !== hipSocket) {
              if (!model.userData._camParentRest) {
                  model.userData._camParentRest = {
                      parent: model.parent,
                      pos: model.position.clone(),
                      rot: model.rotation.clone(),
                      scale: model.scale.clone()
                  };
              }
              if (wasOnWrist) {
                  try { if (this.body.setAction) this.body.setAction('use'); } catch (e) {}
                  try { if (this.body.emit) this.body.emit('holstered'); } catch (e) {}
              }
              hipSocket.add(model);
          }
          const itemId = (holster && holster.itemId) || 'pistol';
          const sm = (typeof getViewmodelWorldScale === 'function')
              ? getViewmodelWorldScale(itemId)
              : 0.30;
          model.scale.setScalar(sm);
          model.visible = true;
          model.userData._bodyHolstered = true;
          model.userData._bodyMountedTool = true;
          delete model.userData.originalPosition;

          const gl = (holster && holster.local) || [0, -0.12, 0.13];
          const palm = (holster && holster.palm) || [0.02, -0.02, 0.04];
          const eu = (holster && holster.euler) || [1.15, Math.PI, 0.2];
          model.rotation.set(eu[0], eu[1], eu[2]);
          const grip = new THREE.Vector3(gl[0], gl[1], gl[2]).multiplyScalar(sm);
          grip.applyEuler(model.rotation);
          model.position.set(palm[0] - grip.x, palm[1] - grip.y, palm[2] - grip.z);
      }

      mountViewmodelOnSocket(model, socket, opts) {
          opts = opts || {};
          if (!model || !socket) return;
          const grip = opts.grip || this.getBodyGripSpec(opts.itemId || 'pistol');
          if (model.parent !== socket) {
              if (!model.userData._camParentRest) {
                  model.userData._camParentRest = {
                      parent: model.parent,
                      pos: model.position.clone(),
                      rot: model.rotation.clone(),
                      scale: model.scale.clone()
                  };
              }
              const wasHolstered = !!(model.userData && model.userData._bodyHolstered);
              socket.add(model);
              model.visible = true;
              delete model.userData.originalPosition;
              model.userData._bodyMountedTool = true;
              delete model.userData._bodyHolstered;
              if (wasHolstered) {
                  try { if (this.body && this.body.emit) this.body.emit('drawn'); } catch (e) {}
              }
              const gl = grip.local || [0, -0.12, 0.13];
              model.userData._gunGripLocal = new THREE.Vector3(gl[0], gl[1], gl[2]);
              const palm = grip.palm || [0.015, 0.028, 0.012];
              model.userData._bodyPalm = new THREE.Vector3(palm[0], palm[1], palm[2]);
              model.userData._bodyGripSpec = grip;
          }
          const itemId = opts.itemId || 'pistol';
          const sm = (typeof getViewmodelWorldScale === 'function')
              ? getViewmodelWorldScale(itemId)
              : ((this.config.viewmodelToWorld != null) ? this.config.viewmodelToWorld : 0.30);
          model.scale.setScalar(sm);
          if (opts.holster) {
              this.mountPistolHolster(model, socket);
              return;
          }
          this.applyBodyToolHold(model, socket, model.userData._bodyGripSpec || grip);
      }

      unmountViewmodelToCamera(model) {
          if (!model) return;
          const onWrist = this.body && this.body.toolMount && model.parent === this.body.toolMount;
          const hip = this.body && this.body.sockets && this.body.sockets.hip_R;
          const onHip = hip && model.parent === hip;
          if (onWrist || onHip) {
              const rest = model.userData._camParentRest;
              const parent = (rest && rest.parent) || this.camera;
              parent.add(model);
              if (rest) {
                  model.position.copy(rest.pos);
                  model.rotation.copy(rest.rot);
                  model.scale.copy(rest.scale);
              } else if (this.weaponBasePosition) {
                  model.position.copy(this.weaponBasePosition);
              }
              model.visible = false;
          }
          delete model.userData._bodyMountedTool;
          delete model.userData._bodyMountedGun;
          delete model.userData._bodyHolstered;
          delete model.userData._gunGripLocal;
          delete model.userData._bodyAlign;
          delete model.userData._bodyPalm;
          delete model.userData._bodyGripSpec;
          delete model.userData._bodyMountRest;
          delete model.userData.originalPosition;
      }

      /** @deprecated use syncBodyToolMount */
      syncGunBodyMount() { this.syncBodyToolMount(); }

      /**
       * Natural hand hold: grip in palm, shaft/barrel in holdEuler relative to camera.
       * Handle tools keep +Y as shaft (up/forward in hand) — NOT pointed at crosshair.
       * lookFollow only adds a light pitch bias; smooth slerps so it doesn't twitch.
       */
      applyBodyToolHold(model, mount, grip) {
          if (!model || !mount || !this.camera) return;
          grip = grip || {};
          if (!this._gunAimMountQ) {
              this._gunAimMountQ = new THREE.Quaternion();
              this._gunAimCamQ = new THREE.Quaternion();
              this._gunAimLocalQ = new THREE.Quaternion();
              this._gunAimHold = new THREE.Quaternion();
              this._gunAimCorr = new THREE.Quaternion();
              this._gunAimGrip = new THREE.Vector3();
              this._gunAimPalm = new THREE.Vector3();
          }

          mount.updateWorldMatrix(true, false);
          this.camera.updateMatrixWorld(true);
          this.camera.getWorldQuaternion(this._gunAimCamQ);
          mount.getWorldQuaternion(this._gunAimMountQ);

          const he = grip.holdEuler || [0, 0, 0];
          const follow = grip.lookFollow != null ? grip.lookFollow : 0.1;
          // Base pose in camera space + light pitch from look (subtle).
          const pitchBias = (this.camera.rotation.x || 0) * follow;
          // Extra 1P tool lag from look rates (pairs with driver arm sway; keep small).
          let swayY = 0;
          let swayP = 0;
          const isGunHold = this.currentTool === (typeof TOOLS !== 'undefined' ? TOOLS.GUN : 'gun');
          if (isGunHold) {
              const yr = this._lookYawRate || 0;
              const pr = this._lookPitchRate || 0;
              swayY = Math.max(-0.12, Math.min(0.12, -yr * 0.012));
              swayP = Math.max(-0.10, Math.min(0.10, pr * 0.012));
          }
          this._gunAimHold.setFromEuler(new THREE.Euler(
              he[0] + pitchBias + swayP,
              he[1] + swayY,
              he[2],
              'YXZ'
          ));
          // desiredWorld = cam * hold
          this._gunAimLocalQ.copy(this._gunAimCamQ).multiply(this._gunAimHold);
          // local = inv(mount) * desiredWorld
          this._gunAimMountQ.invert();
          this._gunAimLocalQ.premultiply(this._gunAimMountQ);

          const smooth = grip.smooth != null ? grip.smooth : 8;
          const dt = (this._bodyToolDt > 0 && this._bodyToolDt < 0.1) ? this._bodyToolDt : 0.016;
          const alpha = 1 - Math.exp(-smooth * dt);
          model.quaternion.slerp(this._gunAimLocalQ, alpha);

          const gripLocal = model.userData._gunGripLocal || this._gunAimGrip.set(0, -0.12, 0.13);
          const sm = model.scale.x || 1;
          this._gunAimGrip.copy(gripLocal).multiplyScalar(sm);
          if (model.userData._bodyPalm) this._gunAimPalm.copy(model.userData._bodyPalm);
          else this._gunAimPalm.set(0.015, 0.028, 0.012);
          this._gunAimGrip.applyQuaternion(model.quaternion);
          model.position.copy(this._gunAimPalm).sub(this._gunAimGrip);

          if (!model.userData._bodyMountRest) {
              model.userData._bodyMountRest = { pos: new THREE.Vector3(), rot: new THREE.Euler() };
          }
          model.userData._bodyMountRest.pos.copy(model.position);
          model.userData._bodyMountRest.rot.setFromQuaternion(model.quaternion);
      }

      /** @deprecated */
      aimBodyToolAtCrosshair(model, mount, align) {
          this.applyBodyToolHold(model, mount, this.getBodyGripSpec('pistol'));
      }
      aimBodyGunAtCrosshair(model, mount) {
          this.applyBodyToolHold(model, mount, this.getBodyGripSpec('pistol'));
      }

      updateFootsteps(delta, isMoving) {
          if (!isMoving || !this.isOnGround) {
              this.footstepTimer = Math.min(this.footstepTimer || 0, 0.1);
              return;
          }
          const speed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
          if (speed < 0.7) {
              this.footstepTimer = 0;
              return;
          }
          this.footstepTimer = (this.footstepTimer || 0) - delta;
          if (this.footstepTimer > 0) return;
          const sprint = this.isSprinting && speed > this.config.speed * 1.05;
          const interval = sprint ? 0.27 : 0.39;
          this.footstepTimer = interval * (0.9 + Math.random() * 0.2);
          try {
              playSound('footstep', {
                  gain: Math.min(1.1, 0.55 + speed / 14),
                  sprint: sprint,
                  surface: this.footstepSurface()
              });
          } catch (e) {}
      }

      footstepSurface() {
          try {
              if (typeof THREE === 'undefined' || typeof groundMesh === 'undefined' || !groundMesh) return 'dirt';
              const origin = this.container.position.clone();
              origin.y -= this.halfHeight - 0.1;
              const ray = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0), 0, 0.6);
              const list = [groundMesh].concat(typeof placedBlocks !== 'undefined' ? placedBlocks : []);
              const hits = ray.intersectObjects(list, true);
              if (hits.length) {
                  let o = hits[0].object;
                  while (o) {
                      const t = o.userData && o.userData.type;
                      if (t === 'wood' || t === 'stone' || t === 'metal') return t;
                      o = o.parent;
                  }
              }
          } catch (e) {}
          return 'dirt';
      }

      flyUpdate(delta, keys) {
          // Creator flight: WASD + Space up + Shift down, no gravity
          const speed = 8;
          const fwd = new THREE.Vector3();
          this.camera.getWorldDirection(fwd);
          const fwdFlat = fwd.clone(); fwdFlat.y = 0;
          if (fwdFlat.lengthSq() < 0.001) fwdFlat.set(0, 0, -1);
          fwdFlat.normalize();
          const right = new THREE.Vector3().crossVectors(fwdFlat, new THREE.Vector3(0, 1, 0));
          const move = new THREE.Vector3();
          if (keys['w']) move.add(fwdFlat);
          if (keys['s']) move.sub(fwdFlat);
          if (keys['d']) move.add(right);
          if (keys['a']) move.sub(right);
          if (keys[' ']) move.y += 1;
          if (keys['shift']) move.y -= 1;
          if (move.lengthSq() > 0) {
              move.normalize().multiplyScalar(speed * delta);
              this.container.position.add(move);
              if (this.container.position.y < 0.5) this.container.position.y = 0.5;
          }
          this.velocity.set(0, 0, 0);
          this.isOnGround = false;
          this.updateColliderPosition();
          this.updateColliderBox();
      }
      processInput(keys, delta) {
          this.keys = keys; // Store current key state

          // --- Keyboard Input ---
          // Set the input values for the Character's processMovement
          this.input.forward = keys['w'] ? 1 : 0;
          this.input.backward = keys['s'] ? 1 : 0;
          this.input.left = keys['a'] ? 1 : 0;
          this.input.right = keys['d'] ? 1 : 0;

          // Determine sprinting state (affects speed in Character.processMovement)
          // Determinar si puede esprintar: el drenaje real ocurre en Character.update.
          const wantsSprint = (keys['shift'] || this.mobileSprintPressed) && this.isOnGround &&
            (this.input.forward > 0 || (this.joystickValues && this.joystickValues.y < -0.5));
          if (wantsSprint && !this.staminaExhausted && this.stamina > 0) {
            this.isSprinting = true;
          } else {
            this.isSprinting = false;
          }

          // Crouch: C = toggle, Control = hold (PR5)
          if (this.config.crouchEnabled !== false) {
              const ctrl = !!(keys['control'] || keys['ControlLeft'] || keys['ControlRight']);
              if (ctrl) {
                  this._crouchHold = true;
                  this.setCrouched(true);
              } else if (this._crouchHold) {
                  this._crouchHold = false;
                  this.setCrouched(false);
              } else if (keys['c'] && !this._crouchTogglePrev) {
                  this.setCrouched(!this.crouched);
              }
              this._crouchTogglePrev = !!keys['c'];
          }

          // Jump handling (blocked while crouched — crouchPolicy.canJump)
          const canJumpCrouch = !(this.crouched && (typeof BODY_DEF === 'undefined' || !BODY_DEF.crouchPolicy || BODY_DEF.crouchPolicy.canJump === false));
          if (canJumpCrouch && (keys[' '] || this.mobileJumpPressed) && 
              (this.isOnGround || this.coyoteTime > 0)) {
              if(this.stamina >= this.staminaJumpCost) {
                  this.velocity.y = this.config.jumpSpeed;
                  this.isOnGround = false;
                  this.coyoteTime = 0;
                  this.jumpGraceTimer = 1;
                  this.jumpCooldown = 0.2;                  
                  // When initiating jump, preserve existing momentum
                  const currentSpeed = Math.sqrt(this.velocity.x**2 + this.velocity.z**2);
                  const speedMultiplier = THREE.MathUtils.clamp(currentSpeed/this.config.speed, 0.8, 1.2);
                  this.velocity.x *= speedMultiplier;
                  this.velocity.z *= speedMultiplier;

                  this.canJump = false;
                  this.stamina -= this.staminaJumpCost;
                  this._staminaRestTimer = 0;
                  // Visual feedback
                  this.applyRecoil(0.1); // Small camera kick
                  playSound('jump');
              }
          }
          
          // Reset jump ability when grounded
          if (this.isOnGround && this.jumpCooldown <= 0) {
              this.canJump = true;
          }
          
          // Update cooldown
          if (this.jumpCooldown > 0) {
              this.jumpCooldown -= delta;
          }

          // --- Mobile Input ---
          if (this.touchMoveActive) {
              const deadzone = 0.1;
              let joyX = this.joystickValues.x;
              let joyY = this.joystickValues.y;

              if (Math.abs(joyX) < deadzone) joyX = 0;
              if (Math.abs(joyY) < deadzone) joyY = 0;

              // Combine or override keyboard input if joystick is active
              this.input.forward = Math.max(this.input.forward, joyY < 0 ? Math.abs(joyY) : 0);
              this.input.backward = Math.max(this.input.backward, joyY > 0 ? joyY : 0);
              this.input.left = Math.max(this.input.left, joyX < 0 ? Math.abs(joyX) : 0);
              this.input.right = Math.max(this.input.right, joyX > 0 ? joyX : 0);
               // Sprinting via mobile? Could add a button or check joystick magnitude/direction.
               // For now, disable sprinting if joystick is primary input source.
               // this.isSprinting = false;
          }
      }

      updateHeadBob(delta, isMoving) {
        const bobSpeed   = this.isSprinting ? this.config.headBobFrequency * 1.5 : this.config.headBobFrequency;
        const bobAmount  = this.isSprinting ? this.config.headBobAmount    * 1.2 : this.config.headBobAmount;
        const baseCamY   = this.config.height * 0.5;

        if (isMoving && this.isOnGround) {
          // ——— existing moving‐bob logic ———
          this.headBobTimer += delta * bobSpeed;
          const verticalBob   = Math.sin(this.headBobTimer * Math.PI * 2) * bobAmount;
          const horizontalBob = Math.sin(this.headBobTimer * Math.PI)     * bobAmount * 0.5;
          this.camera.position.y = baseCamY + verticalBob;
          this.camera.position.x = horizontalBob;
          this.weaponTargetBob.set(horizontalBob * 0.8, verticalBob * 0.8, 0);

        } else {
          // reset timer & lerp *fast* back to neutral
          this.headBobTimer = 0;
          this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, baseCamY, delta * 20);
          this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, 0,       delta * 20);
          this.weaponTargetBob.set(0, 0, 0);

          // once we’re “close enough,” snap exactly
          if (Math.abs(this.camera.position.y - baseCamY) < 0.001) this.camera.position.y = baseCamY;
          if (Math.abs(this.camera.position.x)             < 0.001) this.camera.position.x = 0;
        }
      }

      updateToolSwayAndBob(delta) {
          let activeToolModel = null;
          let basePosition = new THREE.Vector3();

          // Determine which model and base position to use
          if (this.heldItem && this.heldItem.model) {
              activeToolModel = this.heldItem.model;
              basePosition.copy(this.heldItemOffset);
          } else if (this.inventory.equippedItem?.model) {
              activeToolModel = this.inventory.equippedItem.model;
              // Body-mounted tools: skip camera sway (mesh follows toolMount / aim).
              if (this.body && this.body.toolMount && activeToolModel.parent === this.body.toolMount) {
                  return;
              }
              if (this.currentTool === TOOLS.GUN) {
                  basePosition.copy(this.weaponBasePosition);
              } else if (this.currentTool === TOOLS.HAMMER) {
                  basePosition.copy(this.hammerBasePosition);
              } else if (this.currentTool === TOOLS.AXE) {
                  basePosition.copy(this.axeBasePosition);
              } else if (this.currentTool === TOOLS.PICKAXE) {
                  basePosition.copy(this.pickaxeBasePosition);
              } else {
                  basePosition.copy(this.heldItemOffset);
              }
          }

          if (!activeToolModel) return;

          // Handle kickback recovery
          if (activeToolModel.userData.originalPosition) {
              activeToolModel.position.lerp(activeToolModel.userData.originalPosition, delta * 10);
              if (activeToolModel.position.distanceTo(activeToolModel.userData.originalPosition) < 0.001) {
                  activeToolModel.position.copy(activeToolModel.userData.originalPosition);
              }
          }
          // --- Sway based on camera rotation delta ---
          // (We need to track previous rotation or use velocity for better sway)
          // Simple sway based on current camera pitch:
          const swayMultiplier = 0.08;
          const targetSwayX = -this.camera.rotation.x * swayMultiplier * 1.5; // Vertical sway based on look pitch
          // Horizontal sway could be based on container rotation velocity (more complex)

          // --- Combine Base Position, Bob, and Sway ---
          const targetPosition = basePosition.clone().add(this.weaponTargetBob); // Add head bob offset

          // Smoothly interpolate the tool's position
          activeToolModel.position.x = THREE.MathUtils.lerp(activeToolModel.position.x, targetPosition.x, delta * 10.0);
          activeToolModel.position.y = THREE.MathUtils.lerp(activeToolModel.position.y, targetPosition.y, delta * 10.0);
          activeToolModel.position.z = THREE.MathUtils.lerp(activeToolModel.position.z, targetPosition.z, delta * 10.0); // Z usually doesn't bob much

          // Smoothly interpolate the tool's rotation (sway)
          activeToolModel.rotation.x = THREE.MathUtils.lerp(activeToolModel.rotation.x, targetSwayX, delta * 8.0);
          activeToolModel.rotation.y = THREE.MathUtils.lerp(activeToolModel.rotation.y, 0, delta * 8.0); // Reset Y sway
          activeToolModel.rotation.z = THREE.MathUtils.lerp(activeToolModel.rotation.z, 0, delta * 8.0); // Reset Z sway (can add roll sway later)
      }

      updateCameraRotation(delta) {
           // Smoothly recover from recoil
          this.targetCameraRotationX = THREE.MathUtils.lerp(
              this.targetCameraRotationX,
              Math.max(-this.config.maxPitch, Math.min(this.config.maxPitch, this.targetCameraRotationX)), // Clamp target first
              this.config.recoilRecoverySpeed * delta * 10 // Faster recovery adjustment
          );

          // Apply smoothed rotation to the actual camera, lerping for smoothness
           const lerpFactor = this.isOnGround ? 0.6 : 0.3; // More smoothing in air
           this.camera.rotation.x = THREE.MathUtils.lerp(
              this.camera.rotation.x,
              this.targetCameraRotationX,
              lerpFactor
          );
      }

      applyRecoil() {
          const recoilAmount = this.config.recoilAmount * (1 + Math.random() * 0.3); // Slight randomness
          this.targetCameraRotationX -= recoilAmount; // Increase pitch *target*

          // Apply a smaller, instant kick directly to camera for immediate feedback
          this.camera.rotation.x -= recoilAmount * 0.4;

          // Clamp immediately to prevent exceeding limits drastically
          this.targetCameraRotationX = Math.max(-this.config.maxPitch, Math.min(this.config.maxPitch, this.targetCameraRotationX));
          this.camera.rotation.x = Math.max(-this.config.maxPitch, Math.min(this.config.maxPitch, this.camera.rotation.x));
      }

      getMeleeStatsForTool(tool) {
          const t = tool || this.currentTool || (typeof TOOLS !== 'undefined' ? TOOLS.HANDS : 'hands');
          const table = (typeof MELEE_STATS !== 'undefined') ? MELEE_STATS : null;
          const base = (table && table[t]) ? table[t] : { damage: 4, reach: 2.2 };
          return {
              damage: base.damage != null ? base.damage : 4,
              reach: base.reach != null ? base.reach : 2.2,
              cooldown: base.cooldown != null ? base.cooldown : 0.42,
              peak: base.peak != null ? base.peak : 0.18,
              duration: base.duration != null ? base.duration : 0.42,
              stagger: base.stagger != null ? base.stagger : 0.15
          };
      }

      // ¿Hay un NPC enemigo bajo la mira dentro de reach?
      lookAtHostileNpc(reach) {
          if (!this.camera) return null;
          const r = (typeof reach === 'number') ? reach : 2.6;
          const origin = this.camera.getWorldPosition(new THREE.Vector3());
          const dir = this.camera.getWorldDirection(new THREE.Vector3());
          const ray = new THREE.Raycaster(origin, dir, 0, r);
          const targets = [];
          try { npcs.forEach(n => { if (n && n.health > 0 && n.mesh) targets.push(n.mesh); }); } catch (e) {}
          if (!targets.length) return null;
          const hits = ray.intersectObjects(targets, true);
          for (let i = 0; i < hits.length; i++) {
              let p = hits[i].object, npc = null;
              while (p) {
                  if (p.userData && p.userData.parentCharacter instanceof NPC) {
                      npc = p.userData.parentCharacter;
                      break;
                  }
                  p = p.parent;
              }
              if (npc && npc.health > 0) return npc;
          }
          return null;
      }

      // ¿Hay un nodo de recurso bajo la mira?
      lookAtResourceNode(reach) {
          if (!this.camera) return null;
          const r = (typeof reach === 'number') ? reach : 3;
          const origin = this.camera.getWorldPosition(new THREE.Vector3());
          const dir = this.camera.getWorldDirection(new THREE.Vector3());
          const ray = new THREE.Raycaster(origin, dir, 0, r);
          const hits = ray.intersectObjects(collidableObjects, true);
          for (let i = 0; i < hits.length; i++) {
              let node = hits[i].object;
              while (node && !node.isResourceNode) node = node.parent;
              if (node && node.isResourceNode && typeof node.harvest === 'function') return node;
          }
          return null;
      }

      /** Tool melee or fists strike (peak-resolved on Character). */
      meleeAttack(damage, reach) {
          if (isGamePaused || !this.camera) return false;
          // Fists lab: always MELEE_FISTS — ignore tool-stat overrides (mobile/hands path)
          if (this.usesFistsCombat()) {
              return this.startStrike({ fists: true });
          }
          if (typeof meleeCooldown !== 'undefined' && meleeCooldown > 0) return false;
          return this.startStrike({
              fists: false,
              damage: damage,
              reach: reach,
              tool: this.currentTool
          });
      }

      handleMouseMove(event, sensitivity = this.config.sensitivity) {
          if (isGamePaused) return;

          const movementX = event.movementX || 0;
          const movementY = event.movementY || 0;

          // Rotate the character container (Y-axis, horizontal look)
          this.container.rotation.y -= movementX * sensitivity;

          // Adjust the target camera pitch (X-axis, vertical look)
          this.targetCameraRotationX -= movementY * sensitivity;

          // Clamp the target pitch immediately
          this.targetCameraRotationX = Math.max(-this.config.maxPitch, Math.min(this.config.maxPitch, this.targetCameraRotationX));
      }

      updateStatsHUD() {
          const statsDiv = document.getElementById('stats');
          if (!statsDiv) return;

          const hp = Math.max(0, Math.min(100, Math.round(this.health)));
          const energy = Math.max(0, Math.min(100, Math.round(this.energy)));
          const stamina = Math.max(0, Math.min(this.maxStamina || 100, Math.round(this.stamina)));
          const exhausted = this.staminaExhausted ? ' <span style="color:#ff9a3c">(agotado)</span>' : '';

          statsDiv.innerHTML = `Vida: ${hp}<br>Energía: ${energy}<br>Aguante: ${stamina}${exhausted}`;
      }

      updateToolHUD() {
          const hud = document.getElementById('toolHud');
          if (hud) {
              const toolNames = {hands:'Manos', gun:'Pistola', hammer:'Martillo', axe:'Hacha', pickaxe:'Pico', torch:'Antorcha'};
              let toolText = `Herramienta: ${toolNames[this.currentTool] || this.currentTool}`;
              if (this.heldItem) {
                  toolText += `<br>En mano: ${this.heldItem.name || 'Item'}`;
              }
              hud.textContent = toolText; // Use textContent to allow line breaks potentially
              // Or use innerHTML if you need the <br> tag:
               hud.innerHTML = toolText.replace('<br>', '<br/>'); // Ensure self-closing for stricter HTML
          }
          try { if (typeof refreshBuildBarVisibility === 'function') refreshBuildBarVisibility(); } catch (e) {}
      }

      setTool(newTool) {
          // Don't change if already using this tool
          if (this.currentTool === newTool) return;

          // Find first item matching the tool type
          const toolItem = this.inventory.items.find(i => 
              i.toolType === newTool
          );

          if (toolItem) {
              this.currentTool = newTool;
              this.inventory.equipItem(toolItem);
          } else {
              this.currentTool = TOOLS.HANDS;
              this.inventory.unequipItem();
          }

          this.updateToolModelVisibility();
          this.updateToolHUD();
          updateActionButton(); // Ensure mobile button updates
      }

      updateToolModelVisibility() {
        // Hide all item models first (holstered pistol stays visible — syncBodyToolMount owns it)
        this.inventory.items.forEach(item => {
          if (!item.model) return;
          if (item.model.userData && item.model.userData._bodyHolstered) return;
          item.model.visible = false;
        });

        // Show equipped item if any
        if (this.inventory.equippedItem?.model) {
          this.inventory.equippedItem.model.visible = true;
        }

        updateActionButton(); // Add this line
      }

      autoAssignQuickSlots() {
          // Find tools/weapons in inventory and assign to quick slots
          this.inventory.items.forEach((item, index) => {
              if (index < this.inventory.quickSlots.length) { // Only assign to available slots
                  if (item.type === 'weapon' || item.type === 'tool') {
                      const emptySlot = this.inventory.quickSlots.findIndex(slot => !slot);
                      if (emptySlot >= 0) this.inventory.assignToQuickSlot(item, emptySlot);
                  }
              }
          });
          
          // Update UI
          this.inventory.updateQuickSlotUI();
      }

      updateInteractionRaycast() {
          const rayOrigin = new THREE.Vector3();
          const rayDirection = new THREE.Vector3();
          this.camera.getWorldPosition(rayOrigin);
          this.camera.getWorldDirection(rayDirection);

          const raycaster = new THREE.Raycaster(rayOrigin, rayDirection, 0.1, this.config.interactionReach);
          const interactables = [...collidableObjects, ...placedBlocks].filter(obj =>
              obj.visible && (obj.isPickupable || obj.isInteractable || obj.userData?.isDoor)
          );

          const hits = raycaster.intersectObjects(interactables, true);
          const promptElement = document.getElementById('interactionPrompt');
          
          // Reset all highlights
          interactables.forEach(obj => {
              if (obj.userData.originalMaterial) {
                  obj.material = obj.userData.originalMaterial;
                  delete obj.userData.originalMaterial;
              }
          });

          if (hits.length > 0) {
              const hit = hits[0];
              const target = hit.object.isPickupable || hit.object.isInteractable ? hit.object : 
                            (hit.object.parent?.isPickupable || hit.object.parent?.isInteractable ? hit.object.parent : null);

              if (target) {
                  // Highlight the object
                  if (target.material && !target.userData.originalMaterial) {
                      target.userData.originalMaterial = target.material;
                      target.material = target.material.clone();
                      target.material.emissive = new THREE.Color(0x888800);
                      target.material.emissiveIntensity = 0.5;
                  }
                  let promptText = '';
                  if (target.userData?.isDoor) {
                      if (target.userData.target) {
                          promptText = target.userData.locked ?
                              "[E] Necesitás la llave para cruzar" :
                              `[E] Cruzar la puerta`;
                      } else {
                          promptText = target.userData.locked ?
                              "[E] Abrir puerta (llave)" :
                              `[E] ${target.userData.open ? "Cerrar" : "Abrir"} puerta`;
                      }
                  } else if (target.isPickupable) {
                      promptText = target.userData && (target.userData.tutorialBag || target.userData.playgroundBag)
                          ? '[E] Tomar mochila'
                          : `[E] Agarrar ${target.name || 'objeto'}`;
                  } else if (target.isInteractable) {
                      promptText = `[E] ${target.userData.interactPrompt || "Interact"}`;
                  }

                  if (promptElement && promptText) {
                      promptElement.textContent = promptText;
                      promptElement.style.opacity = '1';
                      return;
                  }
              }
          }

          if (promptElement && typeof containerLookPrompt === 'function') {
              const wp = containerLookPrompt();
              if (wp) {
                  promptElement.textContent = wp;
                  promptElement.style.opacity = '1';
                  return;
              }
          }

          if (promptElement && typeof cartelLookPrompt === 'function') {
              const cp = cartelLookPrompt();
              if (cp) {
                  promptElement.textContent = cp;
                  promptElement.style.opacity = '1';
                  return;
              }
          }

          if (promptElement) {
              promptElement.style.opacity = '0';
          }
      }

      interactOrPickup() {
          const rayOrigin = new THREE.Vector3();
          const rayDirection = new THREE.Vector3();
          this.camera.getWorldPosition(rayOrigin);
          this.camera.getWorldDirection(rayDirection);

          const raycaster = new THREE.Raycaster(rayOrigin, rayDirection, 0.1, this.config.interactionReach);
          const interactables = [...collidableObjects, ...placedBlocks].filter(obj =>
              obj.visible &&
              obj !== this.collider &&
              obj !== this.colliderBoxHelper &&
              obj !== groundMesh &&
              (obj.isPickupable || obj.isInteractable || obj.userData?.isDoor)
          );

          const hits = raycaster.intersectObjects(interactables, true);
          if (hits.length > 0) {
              const hitObject = hits[0].object;
              const interactTarget = hitObject.isPickupable || hitObject.isInteractable ? hitObject : 
                                  (hitObject.parent?.isPickupable || hitObject.parent?.isInteractable ? hitObject.parent : null);

              if (!interactTarget) return;

              // Priority 1: Door interaction
              if (interactTarget.userData?.isDoor) {
                  this.tryOpenDoor(interactTarget);
                  return;
              }

              // Priority 2: Pickup items (regardless of current tool)
              if (interactTarget.isPickupable && !interactTarget.userData.collected) {
                  if (interactTarget.userData && interactTarget.userData.tutorialBag) {
                      if (typeof directorPickupTutorialBag === 'function') {
                          try { directorPickupTutorialBag(interactTarget); } catch (e) {}
                      }
                      return;
                  }
                  if (interactTarget.userData && interactTarget.userData.playgroundBag) {
                      if (typeof pickupPlaygroundBag === 'function') {
                          try { pickupPlaygroundBag(interactTarget); } catch (e) {}
                      }
                      return;
                  }
                  if (!this.heldItem) {
                      this.pickupItem(interactTarget);
                  } else {
                      console.log("Hands are full!");
                  }
                  return;
              }

              // Priority 3: Other interactions
              if (interactTarget.isInteractable && interactTarget.userData.interact) {
                  interactTarget.userData.interact(this);
              }
          }
      }

      tryOpenDoor(door) {
          if (!door.userData.isDoor) return;
          try { if (typeof ensureDoorStableId === 'function') ensureDoorStableId(door); } catch (e) {}

          if (door.userData.locked) {
              // Check if player has the required key in keychain
              if (this.inventory.hasKey(door.userData.requiredKey)) {
                  door.userData.locked = false;
                  door.userData.open = true;
                  door.castShadow = false;
                  console.log("Door unlocked and opened!");
                  playSound('door_open');

                  if (door.userData.consumeKey) {
                      try { this.inventory.removeKey(door.userData.requiredKey); } catch (e) {}
                  }

                  // Visual changes
                  door.material.color.setHex(0x00FF00); // Change to green
                  door.material.transparent = true;
                  door.material.opacity = 0.3;

                  // Remove from collidables
                  const index = collidableObjects.indexOf(door);
                  if (index > -1) collidableObjects.splice(index, 1);

                  if (typeof door.userData.onOpened === 'function') {
                      try { door.userData.onOpened(door); } catch (e) {}
                  }
              } else {
                  console.log("This door is locked!");
                  playSound('door_locked');
                  showMessage("Necesitás la llave dorada para abrir esta puerta");
                  return;
              }
          } else {
              // Toggle door open/close
              door.userData.open = !door.userData.open;
              playSound(door.userData.open ? 'door_open' : 'door_close');
              
              if (door.userData.open) {
                  // Remove from collidables if opening
                  const index = collidableObjects.indexOf(door);
                  if (index > -1) collidableObjects.splice(index, 1);
              } else {
                  // Add back to collidables if closing
                  if (!collidableObjects.includes(door)) {
                      collidableObjects.push(door);
                  }
              }
          }

          // PR7: sync door open state (portals still blocked in goThroughDoor).
          try {
              if (typeof onlineChestsSync === 'function' && onlineChestsSync()) {
                  const did = door.did || (door.userData && door.userData.did);
                  if (did) {
                      if (typeof ONLINE !== 'undefined' && ONLINE.isHost &&
                          typeof onlinePublishDoorEvent === 'function') {
                          const me = (typeof onlineUser === 'function') ? onlineUser() : null;
                          onlinePublishDoorEvent(did, !!door.userData.open, me ? me.uid : null);
                      } else if (typeof onlineSendDoorIntent === 'function') {
                          onlineSendDoorIntent(did, !!door.userData.open);
                      }
                  }
              }
          } catch (e) {}

          // Puerta-portal: al abrirla, viajamos al nivel destino
          if (door.userData.open && door.userData.target && typeof goThroughDoor === 'function') {
              goThroughDoor(door);
          }
      }

      pickupItem(item) {
          const def = item.userData.itemData || ITEM_DEFINITIONS[item.name.toLowerCase().replace(/\s+/g, '_')];
          if (!def) {
              console.warn("No definition found for item:", item.name);
              return;
          }

          // PR6 guest: intent loot; bag grant + world rm llegan por event.
          try {
              if (typeof onlineLootSync === 'function' && onlineLootSync() &&
                  typeof ONLINE !== 'undefined' && !ONLINE.isHost) {
                  try { if (typeof ensureItemStableId === 'function') ensureItemStableId(item); } catch (e) {}
                  const iid = item.iid || (item.userData && item.userData.iid);
                  if (!iid) return;
                  try { playSound('pickup'); } catch (e) {}
                  if (typeof onlineSendLootIntent === 'function') onlineSendLootIntent(iid);
                  return;
              }
          } catch (e) {}

          // Handle keys separately - add to keychain
          if (def.type === 'key') {
              if (this.inventory.addKey(def.keyId || def.id, def.name)) {
                  // Remove from world
                  this.scene.remove(item);
                  collidableObjects.splice(collidableObjects.indexOf(item), 1);
                  playSound('key-pickup');
                  try {
                      if (typeof onlineLootSync === 'function' && onlineLootSync() &&
                          typeof ONLINE !== 'undefined' && ONLINE.isHost &&
                          typeof onlineHostPublishLootRemove === 'function') {
                          const me = (typeof onlineUser === 'function') ? onlineUser() : null;
                          onlineHostPublishLootRemove(item, me ? me.uid : null);
                      }
                  } catch (e) {}
                  // Solo la llave de salida del tótem NE (no la del vestíbulo).
                  if (item.userData && item.userData.tutorialExitKey &&
                      typeof directorOnTutorialKeyPicked === 'function') {
                      try { directorOnTutorialKeyPicked(); } catch (e) {}
                  }
                  return;
              }
              return;
          }

          // Handle ammo separately - add to ammo count
          if (def.type === 'ammo') {
              const amt = (item.userData && typeof item.userData.amount === 'number') ? item.userData.amount : def.amount;
              if (this.inventory.addAmmo(def.ammoType, amt)) {
                  // Remove from world
                  this.scene.remove(item);
                  collidableObjects.splice(collidableObjects.indexOf(item), 1);
                  playSound('ammo-pickup');
                  this.inventory.updateAmmoUI();
                  try {
                      if (typeof onlineLootSync === 'function' && onlineLootSync() &&
                          typeof ONLINE !== 'undefined' && ONLINE.isHost &&
                          typeof onlineHostPublishLootRemove === 'function') {
                          const me = (typeof onlineUser === 'function') ? onlineUser() : null;
                          onlineHostPublishLootRemove(item, me ? me.uid : null);
                      }
                  } catch (e) {}
                  return;
              }
              return;
          }

          // Handle loose resources separately - ocupan un slot de la mochila
          if (def.type === 'resource') {
              const key = def.resourceKey || def.id;
              const amt = (item.userData && typeof item.userData.amount === 'number') ? item.userData.amount : (def.amount || 1);
              const added = this.inventory.addResource(key, amt);
              if (added <= 0) {
                  try { showMessage('Mochila llena — no entra ' + ((typeof RESOURCE_ES !== 'undefined' && RESOURCE_ES[key]) || key)); } catch (e) {}
                  return;
              }
              this.scene.remove(item);
              const ri = collidableObjects.indexOf(item);
              if (ri > -1) collidableObjects.splice(ri, 1);
              if (typeof worldItems !== 'undefined') {
                  const wi = worldItems.indexOf(item);
                  if (wi > -1) worldItems.splice(wi, 1);
              }
              playSound('pickup');
              try { updateResourceHUD(); } catch (e) {}
              try { showMessage('+' + added + ' ' + ((typeof RESOURCE_ES !== 'undefined' && RESOURCE_ES[key]) || key)); } catch (e) {}
              try {
                  if (typeof onlineLootSync === 'function' && onlineLootSync() &&
                      typeof ONLINE !== 'undefined' && ONLINE.isHost &&
                      typeof onlineHostPublishLootRemove === 'function') {
                      const me = (typeof onlineUser === 'function') ? onlineUser() : null;
                      onlineHostPublishLootRemove(item, me ? me.uid : null);
                  }
              } catch (e) {}
              return;
          }

          // Build inventory entry for regular items
          const inventoryItem = {
              ...def,
              quantity: 1,
              model: item
          };

          if (this.inventory.addItem(inventoryItem)) {
              if ((def.id === 'food' || def.type === 'consumable' && def.healAmount > 0) &&
                  typeof directorOnFoodLesson === 'function') {
                  try { directorOnFoodLesson(); } catch (e) {}
              }
              // Remove from world
              this.scene.remove(item);
              collidableObjects.splice(collidableObjects.indexOf(item), 1);
              playSound('pickup');
              try {
                  if (typeof onlineLootSync === 'function' && onlineLootSync() &&
                      typeof ONLINE !== 'undefined' && ONLINE.isHost &&
                      typeof onlineHostPublishLootRemove === 'function') {
                      const me = (typeof onlineUser === 'function') ? onlineUser() : null;
                      onlineHostPublishLootRemove(item, me ? me.uid : null);
                  }
              } catch (e) {}

              // Auto-assign to first empty quick slot if weapon/tool
              if (inventoryItem.type === 'weapon' || inventoryItem.type === 'tool') {
                  // Add to first empty quick slot
                  const emptySlot = this.inventory.quickSlots.findIndex(slot => !slot);
                  if (emptySlot >= 0 && emptySlot < this.inventory.quickSlots.length) {
                      this.inventory.assignToQuickSlot(inventoryItem, emptySlot);
                  }
                  // Re-run auto-assign to organize slots
                  this.autoAssignQuickSlots();
              }

              // Auto-equip weapons immediately
              if (inventoryItem.type === 'weapon' || inventoryItem.type === 'tool') {
                  const addedItem = this.inventory.items.find(i => i.id === inventoryItem.id && i.model === item);
                  if (addedItem) {
                      this.inventory.equipItem(addedItem);
                      this.currentTool = def.toolType;
                      this.camera.add(item);
                      item.position.copy(this.heldItemOffset);
                      item.rotation.set(0,0,0);
                  }
              }

              this.updateToolModelVisibility();
              this.updateToolHUD();
              this.inventory.updateAmmoUI();
              this.inventory.updateWeaponHUD();
              this.inventory.updateQuickSlotUI();
          } else {
              console.log("Inventory full - can't pick up", item.name);
          }
      }

      dropItem() {
          if (!this.heldItem || !this.heldItem.mesh) return;

          console.log("Dropping:", this.heldItem.name);
          const itemMesh = this.heldItem.mesh;
          const dropDirection = this.camera.getWorldDirection(new THREE.Vector3());
          const dropPosition = this.container.position.clone()
              .add(new THREE.Vector3(0, this.config.height * 0.2, 0)) // Drop from chest height
              .add(dropDirection.clone().multiplyScalar(1.0)); // Drop 1 unit in front

          // PR6 guest: clear hands locally; host spawns shared world item via drop intent.
          try {
              if (typeof onlineLootSync === 'function' && onlineLootSync() &&
                  typeof ONLINE !== 'undefined' && !ONLINE.isHost) {
                  const id = (itemMesh.userData && itemMesh.userData.itemKey) ||
                      (this.heldItem.id) || itemMesh.name || 'food';
                  this.camera.remove(itemMesh);
                  this.heldItem = null;
                  this.updateToolModelVisibility();
                  this.updateToolHUD();
                  try {
                      if (typeof onlineSendDropIntent === 'function') {
                          onlineSendDropIntent({
                              id: id,
                              x: dropPosition.x,
                              y: dropPosition.y,
                              z: dropPosition.z,
                              amount: 1
                          });
                      }
                  } catch (e) {}
                  return;
              }
          } catch (e) {}

          // Remove from camera group and add back to scene
          this.camera.remove(itemMesh);
          this.scene.add(itemMesh);

          itemMesh.position.copy(dropPosition);
          itemMesh.userData.velocity = dropDirection.clone().multiplyScalar(2); // Small forward push
          itemMesh.userData.velocity.y += 1.0; // Small upward push

          // Add back to collidables and mark as not collected
          itemMesh.userData.collected = false;
          collidableObjects.push(itemMesh);
          try {
              if (typeof worldItems !== 'undefined' && worldItems.indexOf(itemMesh) === -1) {
                  worldItems.push(itemMesh);
              }
          } catch (e) {}
          try { if (typeof ensureItemStableId === 'function') ensureItemStableId(itemMesh); } catch (e) {}

          this.heldItem = null; // Clear held item reference

          this.updateToolModelVisibility(); // Show gun/hammer if appropriate
          this.updateToolHUD();

          // PR6 host: publish spawn so guests see the dropped item.
          try {
              if (typeof onlineLootSync === 'function' && onlineLootSync() &&
                  typeof ONLINE !== 'undefined' && ONLINE.isHost) {
                  ONLINE.dropSeq = (ONLINE.dropSeq || 0) + 1;
                  const key = (itemMesh.userData && itemMesh.userData.itemKey) || itemMesh.name || 'item';
                  const base = itemMesh.iid || key;
                  itemMesh.iid = String(base) + '_d' + ONLINE.dropSeq;
                  try { itemMesh.userData.iid = itemMesh.iid; } catch (e) {}
                  if (typeof onlinePublishEvent === 'function') {
                      const me = (typeof onlineUser === 'function') ? onlineUser() : null;
                      onlinePublishEvent({
                          k: 'loot',
                          iid: itemMesh.iid,
                          id: key,
                          x: Math.round(itemMesh.position.x * 100) / 100,
                          y: Math.round(itemMesh.position.y * 100) / 100,
                          z: Math.round(itemMesh.position.z * 100) / 100,
                          amount: 1,
                          rm: false,
                          by: me ? me.uid : null
                      });
                  }
              }
          } catch (e) {}
      }

      // Use tool for resouces and personal protection
      handleAttack() {
          // Only proceed if we're using a harvesting tool
          if (![TOOLS.AXE, TOOLS.PICKAXE].includes(this.currentTool)) {
              // If not a harvesting tool, try interaction instead
              this.interactOrPickup();
              return;
          }

          const ray = new THREE.Raycaster(
              this.camera.getWorldPosition(new THREE.Vector3()),
              this.camera.getWorldDirection(new THREE.Vector3()),
              0,
              3
          );

          const hits = ray.intersectObjects(collidableObjects, true);

          for (const hit of hits) {
              let node = hit.object;
              while (node && !node.isResourceNode) node = node.parent;

              if (!node || !node.isResourceNode) continue;

              if (typeof node.harvest !== 'function') {
                  console.error("Resource node missing .harvest() method!", node);
                  continue;
              }

              // Check if we're using the correct tool for this resource
              let requiredTool;
              switch(node.type) {
                  case 'wood':
                      requiredTool = TOOLS.AXE;
                      break;
                  case 'stone':
                  case 'metal':
                      requiredTool = TOOLS.PICKAXE;
                      break;
                  default:
                      console.warn("Unknown resource type:", node.type);
                      continue;
              }

              if (this.currentTool !== requiredTool) {
                  showMessage("¡Herramienta equivocada!");
                  return;
              }

              // Fase C: harvest swing on body
              try {
                  if (this.body) {
                      if (typeof this.body.playSwing === 'function') this.body.playSwing();
                      else if (typeof this.body.setAction === 'function') this.body.setAction('swing');
                  }
              } catch (e) {}

              // PR6 guest: swing FX + harvest intent; grant vía event node.gained.
              const lootSyncGuest = (typeof onlineLootSync === 'function' && onlineLootSync() &&
                  typeof ONLINE !== 'undefined' && !ONLINE.isHost);
              if (lootSyncGuest) {
                  try { if (typeof ensureNodeStableId === 'function') ensureNodeStableId(node); } catch (e) {}
                  const nid = node.nid || (node.userData && node.userData.nid);
                  createHarvestEffect(hit.point);
                  playSoundAt('harvest', hit.point, { surface: node.type, gain: 0.9, maxDist: 30 });
                  try {
                      if (typeof onlineSendHarvestIntent === 'function') {
                          onlineSendHarvestIntent(nid, this.currentTool);
                      }
                  } catch (e) {}
                  break;
              }

              const efficiency = this.inventory.equippedItem?.efficiency || 1;
              const gained = node.harvest(efficiency);

              if (gained > 0) {
                  // Fauna neuronal: un nodo polinizado da +1 recurso
                  const pollinated = !!(node.userData && node.userData.pollinatedUntil &&
                      performance.now() < node.userData.pollinatedUntil);
                  const amount = gained + (pollinated ? 1 : 0);
                  const added = this.inventory.addResource(node.type, amount);
                  if (added <= 0) {
                      try { showMessage('Mochila llena — no entra más ' + ((typeof RESOURCE_ES !== 'undefined' && RESOURCE_ES[node.type]) || node.type)); } catch (e) {}
                      break;
                  }
                  updateResourceHUD();
                  createHarvestEffect(hit.point);
                  playSoundAt('harvest', hit.point, { surface: node.type, gain: 0.9, maxDist: 30 });
                  // PR6 host: mirror node HP/gained to guests.
                  try {
                      if (typeof onlineLootSync === 'function' && onlineLootSync() &&
                          typeof ONLINE !== 'undefined' && ONLINE.isHost &&
                          typeof onlineHostPublishNodeHit === 'function') {
                          const me = (typeof onlineUser === 'function') ? onlineUser() : null;
                          onlineHostPublishNodeHit(node, node.type, amount, me ? me.uid : null);
                      }
                  } catch (e) {}
                  if (pollinated) {
                      try { showMessage('¡Polinizado! +1 ' + ((typeof RESOURCE_ES !== 'undefined' && RESOURCE_ES[node.type]) || node.type)); } catch (e) {}
                  }
                  if (node.type === 'wood' && typeof directorOnWoodHarvested === 'function') {
                      try { directorOnWoodHarvested(); } catch (e) {}
                  }
                  if ((node.type === 'stone' || node.type === 'metal') &&
                      typeof directorOnPickaxeResourceHarvested === 'function') {
                      try { directorOnPickaxeResourceHarvested(); } catch (e) {}
                  }
              }

              break;
          }
      }
      //Rewrite Character method to include player interactions
      handleCollectible(collectible) {
          if (collectible.userData.collected) return;
          collectible.userData.collected = true;
          
          // Remove from scene
          this.scene.remove(collectible);
          const index = collidableObjects.indexOf(collectible);
          if (index > -1) collidableObjects.splice(index, 1);
          
          console.log("Player handleCollectible(collectible) ",collectible);
          // Handle different collectible types
          switch(collectible.type) {
              case 'food':
                  this.health = Math.min(100, this.health + (collectible.userData.healAmount || 20));
                  playSound('health-regen');
                  this.foodCollected++;
                  if (typeof directorOnFoodLesson === 'function') {
                      try { directorOnFoodLesson(); } catch (e) {}
                  }
                  break;
                  
              case 'toxin':
                  this.health -= collectible.userData.damageAmount || 30;
                  if (this.health < 0) this.health = 0;
                  this.applyDamageEffect({ heavy: true });
                  this.updateStatsHUD();

                  this.toxinsCollected++;
                  playSound('damage-taken');
                  break;
                  
              case 'ammo':
                  this.inventory?.addAmmo(
                      collectible.userData.ammoType,
                      collectible.userData.amount
                  );
                  playSound('ammo-pickup');
                  this.inventory?.updateAmmoUI();
                  break;
                  
              case 'key':
                  this.inventory?.addKey(
                      collectible.userData.keyId,
                      collectible.name
                  );
                  playSound('key-pickup');
                  break;
                  
              default:
                  if (collectible.isPickupable) {
                      this.pickupItem(collectible);
                  }
          }
          
          this.updateStatsHUD?.();
      }
      // Player-specific damage effect (screen flash + camera kick + 1P flinch)
      applyDamageEffect(opts) {
          opts = opts || {};
          const heavy = !!opts.heavy || (this.maxHealth > 0 && this.health <= this.maxHealth * 0.35);
          const damageOverlay = document.getElementById('damageOverlay');
          if (damageOverlay) {
              damageOverlay.style.opacity = heavy ? '0.88' : '0.62';
              damageOverlay.style.transition = 'opacity 0.04s linear';
              setTimeout(() => {
                  damageOverlay.style.transition = heavy ? 'opacity 0.45s ease-out' : 'opacity 0.3s ease-out';
                  damageOverlay.style.opacity = '0';
              }, heavy ? 80 : 50);
          }
          // Camera kick + body flinch (1P arms react)
          try {
              this.applyRecoil(heavy ? 0.24 : 0.14);
              if (this.body && typeof this.body.playHit === 'function') {
                  this.body.playHit({
                      side: Math.random() < 0.5 ? -1 : 1,
                      heavy: heavy
                  });
              }
          } catch (e) {}
      }

      /**
       * Symmetric with NPC.takeDamage: guard chips damage (future shield).
       * @param {number} amount
       * @param {object} [opts]
       */
      takeDamage(amount, opts) {
          if (this.health <= 0) return;
          opts = opts || {};
          let dmg = amount;
          let zone = opts.zone || null;
          if (!zone && opts.hitY != null && typeof classifyHitOnCharacter === 'function') {
              zone = classifyHitOnCharacter(this, opts.hitY);
          }
          if (zone && typeof hitZoneMultiplier === 'function' && opts.scaleByZone !== false && opts.preScaled !== true) {
              dmg = Math.max(1, Math.round(amount * hitZoneMultiplier(zone)));
          }
          let blocked = false;
          if (this.isGuarding && opts.ignoreGuard !== true) {
              const fs = (typeof this.getFistsStats === 'function') ? this.getFistsStats() : null;
              let mult = (fs && fs.guardDamageMult != null) ? fs.guardDamageMult : 0.18;
              // S1 Soft: tired guard absorbs worse
              if (fs && (this.stamina || 0) < (fs.guardTiredBelow != null ? fs.guardTiredBelow : 15)) {
                  mult = fs.guardTiredMult != null ? fs.guardTiredMult : 0.45;
              }
              dmg = Math.max(1, Math.round(dmg * mult));
              blocked = true;
              try {
                  if (typeof this.spendFistsStamina === 'function') {
                      this.spendFistsStamina(fs && fs.blockHitCost != null ? fs.blockHitCost : 4);
                  }
              } catch (e) {}
              try {
                  if (this.body && typeof this.body.emit === 'function') this.body.emit('blocked', zone);
              } catch (e) {}
              try {
                  if (typeof noteCombatLabBlock === 'function') noteCombatLabBlock('player');
              } catch (e) {}
          }
          this.health -= dmg;
          if (this.health < 0) this.health = 0;
          if (blocked) {
              // Guard holds: chip only — no screen flinch / body hit react
              try { this.updateStatsHUD(); } catch (e) {}
          } else {
              const heavy = opts.heavy != null
                  ? !!opts.heavy
                  : (zone === 'head' || dmg >= 18 || (this.maxHealth > 0 && this.health <= this.maxHealth * 0.35));
              try { this.applyDamageEffect({ heavy: heavy }); } catch (e) {}
              try { this.updateStatsHUD(); } catch (e) {}
          }
          if (this.health <= 0) {
              try { showGameOver(); } catch (e) {}
          }
      }
  }
  class NPC extends Character {
      constructor(scene, config, visualMesh) {
          // Merge specific NPC config with base config if needed
          const npcConfig = {
              ...PLAYER_CONFIG,
              speed: 5.0, // Increased from 1.5
              acceleration: 15.0, // Increased from 8.0
              detectionRange: 10, // Increased detection range
              attackRange: 3,
              attackDamage: 8,
              gravity: PLAYER_CONFIG.gravity,
              ...config
          };
          super(scene, npcConfig); // Call Character constructor

          // AI-specific properties
          this.target = null; // Usually the player
          this.path = [];
          this.state = 'idle'; // e.g., 'idle', 'wandering', 'chasing', 'attacking'
          this.detectionRange = npcConfig.detectionRange || 15;
          this.attackRange = npcConfig.attackRange || 3;
          this.attackCooldown = 0;
          this.attackDamage = npcConfig.attackDamage || 10;
          this.wanderTimer = 0;
          this.wanderTarget = null;
          this.idleTimer = 0;
          this.brain = null;      // Red neuronal (22-neural-fauna.js)
          this.brainOut = null;
          this.brainTimer = 0;
          this.baseHunt = null;   // Mesa de trabajo detectada mientras vaga
          this.homePos = null;

          this.lastKnownPlayerPos = null;
          this.lostPlayerTimer = 0;
          this.fleeHealthThreshold = 0.25;
          this.energy = 100;
          this.maxEnergy = 100;
          this.energyRegenRate = 5;
          this.attackMode = 'melee';
          this.attackCooldownBase = 1.5;
          // Fists AI (Combat Lab): chance to raise guard instead of striking
          this.guardChance = 0;
          this.guardDuration = 0.65;
          this.rangedRange = 15;
          this.rangedDamage = 6;
          this.healthRegenRate = 6;       // HP/sec while fleeing to safety
          this.healthRegenIdleRate = 1.5; // HP/sec when out of combat a while
          this.lastDamageTs = 0;
          this.isHostile = true;
          this.servoTimer = 2.5 + Math.random() * 5;

          // Visual representation (can be passed in or created).
          // Playground/spawns often pass a custom robotGroup — that skipped createVisual() and
          // never mounted bodyRig. Always attach bodyRig when available; hide legacy mesh.
          this.mesh = visualMesh || this.createVisual();
          this.mesh.userData.parentCharacter = this; // Link mesh back to character
          this.container.add(this.mesh); // Add visual mesh to the container
          collidableObjects.push(this.mesh); // Make the visual mesh collidable for bullets etc.
          this.mesh.isEnemy = true; // Flag for bullet logic

          // Need health on the mesh for bullet hits? Or hit the character collider?
          // Let's put health reference on the mesh userData for bullets to find easily
          this.mesh.health = this.health;
          this.mesh.userData.health = this.health;

          if (typeof createBody === 'function' && !this.body) {
              this.attachBodyRig();
          }
          if (this.body && this.mesh) {
              // Hide legacy robot/capsule drawing but KEEP hit meshes raycastable
              // (Three Raycaster skips object.visible === false).
              function makeInvisibleHit(o) {
                  if (!o || !o.isMesh) return;
                  o.visible = true;
                  if (o.material) {
                      o.material = o.material.clone();
                      o.material.transparent = true;
                      o.material.opacity = 0;
                      o.material.depthWrite = false;
                      if ('colorWrite' in o.material) o.material.colorWrite = false;
                  }
              }
              const namedHit = this.mesh.getObjectByName && this.mesh.getObjectByName('NPC_Body');
              if (namedHit) {
                  this.mesh.traverse(function (o) {
                      if (o.isSprite) o.visible = false;
                      else if (o.isMesh && o !== namedHit) o.visible = false;
                  });
                  makeInvisibleHit(namedHit);
              } else if (this.mesh.isMesh) {
                  makeInvisibleHit(this.mesh);
              } else {
                  this.mesh.traverse(function (o) {
                      if (o.isSprite) o.visible = false;
                      else if (o.isMesh) makeInvisibleHit(o);
                  });
              }
          }

          // Health bar
          const hbGeo = new THREE.PlaneGeometry(1.2, 0.08);
          const hbMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.9 });
          this.healthBar = new THREE.Mesh(hbGeo, hbMat);
          this.healthBar.position.set(0, this.height + 0.4, 0);
          this.healthBar.visible = false;
          this.container.add(this.healthBar);
          this.healthBarRangeSq = 18 * 18;
          this._hbTarget = new THREE.Vector3();
          this.eyeGlow = null; // legacy robot eye sprite removed (boss may reintroduce later)
      }

      /** Mount shared box-doll under container. Safe to call once from constructor / createVisual. */
      attachBodyRig(bodyTypeId, palette) {
          if (this.body || typeof createBody !== 'function') return this.body;
          const types = (typeof BODY_DEF !== 'undefined' && BODY_DEF.bodyTypes)
              ? Object.keys(BODY_DEF.bodyTypes) : ['normie'];
          const id = bodyTypeId || types[Math.floor(Math.random() * types.length)] || 'normie';
          const shirts = [0xa53a3a, 0x3f9a4a, 0xd6b73a, 0x3a5a8a, 0x8a3a8a];
          this.body = createBody({
              mode: 'npc',
              bodyTypeId: id,
              palette: palette || { shirt: shirts[Math.floor(Math.random() * shirts.length)] },
              showGunStub: false,
              mountOnCharacter: true
          });
          const feetY = (typeof BODY_MOUNT !== 'undefined' && BODY_MOUNT.feetYFromHalfHeight)
              ? BODY_MOUNT.feetYFromHalfHeight(this.halfHeight)
              : -this.halfHeight;
          this.body.root.position.y = feetY;
          this.container.add(this.body.root);
          return this.body;
      }

      createVisual() {
          // Hit proxy capsule (bullets / isEnemy). Visible only as fallback when bodyRig is missing.
          const geo = new THREE.CapsuleGeometry(this.radius, this.height - 2 * this.radius, 8, 16);
          const useBody = typeof createBody === 'function';
          const mat = new THREE.MeshStandardMaterial({
              color: 0xff0000,
              roughness: 0.6,
              transparent: useBody,
              opacity: useBody ? 0 : 1,
              depthWrite: !useBody
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.castShadow = !useBody;
          mesh.receiveShadow = !useBody;
          mesh.position.y = this.radius; // Align bottom with container base
          mesh.name = useBody ? 'NPC_HitProxy' : 'NPC_Visual';
          // Keep proxy raycastable but not drawn when bodyRig is active.
          mesh.visible = true;
          if (useBody) mesh.material.colorWrite = false;

          // Body mount happens in constructor via attachBodyRig() so custom visualMesh paths also get it.
          return mesh;
      }
      // Override Character update
      update(delta, collidables, player) { // Player is needed for targeting
          // Update AI state and determine movement intention
          this.updateAI(delta, player, collidables);

          // Call Character's update method to handle physics and movement based on the `this.input` values set by `updateAI`.
          super.update(delta, collidables);

          if (this._lastPosition && !this._lastPosition.equals(this.container.position)) {
            updateSpatialPartition();
          }
          this._lastPosition = this.container.position.clone();

          this.updateBodyRig(delta, { hasGun: false, fp: false });

          // Mirror health changes (if bullets hit mesh directly)
           // This is a bit fragile, better to have bullets damage the Character directly
           if (this.mesh.userData.health !== this.health) {
               this.health = this.mesh.userData.health;
               // Check if died
               if (this.health <= 0) {
                   this.die();
               }
           }

           // Update health bar
           if (this.healthBar && camera) {
               const inBarRange = player && player.container
                   ? this.container.position.distanceToSquared(player.container.position) <= this.healthBarRangeSq
                   : false;
               this.healthBar.visible = inBarRange && this.health > 0;
               if (inBarRange) {
                   this.healthBar.lookAt(camera.getWorldPosition(this._hbTarget));
                   const hpRatio = Math.max(0, Math.min(1, this.health / this.maxHealth));
                   this.healthBar.scale.x = hpRatio;
                   if (hpRatio > 0.6) this.healthBar.material.color.set(0x00ff00);
                   else if (hpRatio > 0.3) this.healthBar.material.color.set(0xffaa00);
                   else this.healthBar.material.color.set(0xff0000);
               }
           }
           // Update attack cooldown
          if (this.attackCooldown > 0) {
              this.attackCooldown -= delta;
          }
          if (this.energy < this.maxEnergy) {
              this.energy += this.energyRegenRate * delta;
              if (this.energy > this.maxEnergy) this.energy = this.maxEnergy;
          }
          // Health regen: fast while fleeing, slow when out of combat for a while
          if (this.health > 0 && this.health < this.maxHealth) {
              const sinceDamage = (performance.now() - (this.lastDamageTs || 0)) / 1000;
              if (sinceDamage > 4) {
                  const rate = this.state === 'fleeing' ? this.healthRegenRate : this.healthRegenIdleRate;
                  this.health = Math.min(this.maxHealth, this.health + rate * delta);
                  this.mesh.userData.health = this.health;
              }
          }

          // Servo mecánico ocasional, espacializado
          if (this.health > 0 && this.container && !(typeof creatorMode !== 'undefined' && creatorMode)) {
              this.servoTimer = (this.servoTimer || 0) - delta;
              if (this.servoTimer <= 0) {
                  const moving = Math.abs(this.velocity.x) + Math.abs(this.velocity.z) > 1.2;
                  const alert = this.state === 'chasing' || this.state === 'attacking' || this.state === 'fleeing';
                  this.servoTimer = (moving ? 3.2 : 5.5) + Math.random() * 4;
                  if (typeof playSoundAt === 'function') {
                      try {
                          playSoundAt('robot_servo', this.container.position, {
                              gain: alert ? 0.6 : 0.4,
                              maxDist: 24,
                              alert: alert
                          });
                      } catch (e) {}
                  }
              }
          }

          /*
          if (!this._debugTimer) this._debugTimer = 0;
          this._debugTimer += delta;
          if (this._debugTimer > 1) {
            this._debugTimer = 0;
            console.log(`NPC State: ${this.state}, Pos: ${this.container.position.toArray().map(n => n.toFixed(2))}, Forward: ${this.input.forward}, OnGround: ${this.isOnGround}`);
          }
          */

      }

      updateAI(delta, player, collidables) {
          
          const intendedMove = new THREE.Vector3();

          if (this.input.forward) {
              const angle = this.container.rotation.y;
              intendedMove.x = Math.sin(angle) * this.config.speed;
              intendedMove.z = Math.cos(angle) * this.config.speed;
          }


          // Reset input each frame
          this.input = { forward: 0, backward: 0, left: 0, right: 0 };

          if (this.state === 'dead' || this._deadCounted) return;
          if (!player || this.health <= 0) {
              return;
          }
          // Melee stagger: hold still briefly (feel), keep facing threat
          if (this._staggerT > 0) {
              this._staggerT -= delta;
              this.input = this.input || { forward: 0, backward: 0, left: 0, right: 0 };
              this.input.forward = 0;
              this.input.backward = 0;
              this.input.left = 0;
              this.input.right = 0;
              try {
                  const face = (this.target && this.target.container)
                      ? this.target.container.position
                      : (player && player.container ? player.container.position : null);
                  if (face) this.turnTowards(face, delta, 2.5);
              } catch (e) {}
              return;
          }
          if (typeof creatorMode !== 'undefined' && creatorMode) {
              this.state = 'idle';
              this.target = null;
              return;
          }
          if (this.isOnGround) {
              // Apply stronger downward force to maintain ground contact
              this.velocity.y = Math.max(this.velocity.y, -0.1);
          }
          const focus = this.selectFocus(player);
          // Distancia real al objetivo elegido (jugador, npc o mesa).
          const focusDist = this.container.position.distanceTo(focus.pos);
          try {
              this._combatAimPos = focus.pos.clone ? focus.pos.clone() : focus.pos;
              if (focus.kind === 'npc' || focus.kind === 'player') this.target = focus.ref;
          } catch (e) {}
          const playerDist = this.container.position.distanceTo(player.container.position);
          const hasLOS = this.hasLineOfSight(player, collidables);
          // Un bloque construido justo delante: primero se rompe, si no se
          // atraviesa la base y los enemigos quedan atascados en el muro.
          const blockingBlock = (this.state === 'chasing' || this.state === 'attacking')
              ? this.findBlockingBlock() : null;

          // --- State Machine ---
          switch (this.state) {
              case 'idle':
                  // Lab NPC threat does not need LOS to player
                  if (focus.kind === 'npc' && focusDist < this.detectionRange) {
                      this.state = 'chasing';
                      this.target = focus.ref;
                  } else if (this.isHostile && focus.kind === 'player' &&
                             focusDist < this.detectionRange && hasLOS) {
                      this.state = 'chasing';
                      this.target = focus.ref || player;
                  } else if (this.isHostile && playerDist < this.detectionRange && hasLOS) {
                      this.state = 'chasing';
                      this.target = player;
                  } else {
                      this.idleTimer = (this.idleTimer || 0) + delta;
                      if (this.isHostile && this.idleTimer > 2.5) {
                          this.state = 'wandering';
                          this.idleTimer = 0;
                      }
                  }
                  break;

              case 'wandering': {
                  // Si ve amenaza (player u otro npc en lab), la persigue; si encontró una base, va por ella.
                  if (focus.kind === 'npc' && focusDist < this.detectionRange) {
                      this.state = 'chasing';
                      this.target = focus.ref;
                      break;
                  }
                  if (this.isHostile && playerDist < this.detectionRange && hasLOS) {
                      this.state = 'chasing';
                      this.target = player;
                      break;
                  }
                  if (this.baseHunt) {
                      this.state = 'chasing';
                      break;
                  }
                  this.wanderTimer = (this.wanderTimer || 0) + delta;
                  const out = this.brainOut || [Math.random(), 0.65, 0.5];
                  const turn = (out[0] - 0.5) * 2.2;
                  this.container.rotation.y += turn * delta;
                  this.smartAvoidance(collidables, player);
                  this.tryBreakBlockAhead();
                  if (out[1] > 0.5) this.input.forward = -1;
                  else if (out[1] < 0.18) this.input.backward = -1;
                  if (this.isOnGround) {
                      this.handleStepClimbing(collidables, intendedMove.clone().multiplyScalar(delta));
                  }
                  break;
              }

              case 'chasing':
                  if (this.isGuarding) this.setGuard(false);
                  if (this.health <= this.maxHealth * this.fleeHealthThreshold && focusDist < this.detectionRange) {
                      this.state = 'fleeing';
                      break;
                  }
                  if (focusDist < this.attackRange + (focus.kind === 'base' ? 0.5 : 0)) {
                      this.state = 'attacking';
                  } else if (focusDist > this.detectionRange * 2.0) {
                      this.state = 'idle';
                      this.target = null;
                  } else if (blockingBlock) {
                      // Hay un bloque construido entre el enemigo y su objetivo:
                      // se queda golpeándolo en vez de rodearlo para siempre.
                      this.turnTowards(focus.pos, delta, 3.0);
                      this.input.forward = -1;
                      if (this.attackCooldown <= 0) {
                          this.attackPlacedBlock(blockingBlock);
                          this.attackCooldown = this.attackCooldownBase;
                      }
                  } else {
                      this.smartAvoidance(collidables, player);
                      this.tryBreakBlockAhead();
                      this.input.forward = -1;
                      this.turnTowards(focus.pos, delta, this.config.speed * 2.0);
                      // Fire on the move: shoot while closing the distance
                      if (this.canRanged !== false && this.rangedRange > 0 &&
                          focusDist <= this.rangedRange && this.attackCooldown <= 0 &&
                          (focus.kind === 'base' || this.energy > 30) &&
                          (focus.kind === 'base' || hasLOS)) {
                          this.shootAt(focus.target);
                          this.attackCooldown = this.attackCooldownBase * 1.5;
                          if (focus.kind !== 'base') this.energy -= 20;
                      }
                      if (this.isOnGround) {
                          this.handleStepClimbing(collidables, intendedMove.clone().multiplyScalar(delta));
                      }
                  }
                  break;

              case 'fleeing':
                  if (focusDist > this.detectionRange * 1.5 || this.health > this.maxHealth * 0.5) {
                      this.state = 'chasing';
                  } else {
                      const dirFlee = new THREE.Vector3().subVectors(this.container.position, focus.pos).normalize();
                      const targetYFlee = Math.atan2(dirFlee.x, dirFlee.z);
                      const rotDiffFlee = ((targetYFlee - this.container.rotation.y + Math.PI) % (Math.PI*2)) - Math.PI;
                      this.container.rotation.y += THREE.MathUtils.clamp(rotDiffFlee, -delta*3, delta*3);
                      this.input.forward = -1;
                  }
                  break;
              case 'attacking': {
                  const attackLimit = this.attackRange + (focus.kind === 'base' ? 0.5 : 0);
                  if (this.health <= this.maxHealth * this.fleeHealthThreshold && focusDist < this.detectionRange) {
                      this.setGuard(false);
                      this.state = 'fleeing';
                      break;
                  }
                  if (blockingBlock) {
                      // No atacar la mesa a través de un muro: romperlo primero.
                      this.setGuard(false);
                      this.turnTowards(focus.pos, delta, 3.0);
                      if (this.attackCooldown <= 0) {
                          this.attackPlacedBlock(blockingBlock);
                          this.attackCooldown = this.attackCooldownBase;
                      }
                      break;
                  }
                  // Fists / boxing: same strike+guard contract as player
                  if (typeof this.usesFistsCombat === 'function' && this.usesFistsCombat()) {
                      this.attackMode = 'melee';
                      this.turnTowards(focus.pos, delta, 3.0);
                      const fs = (typeof this.getFistsStats === 'function') ? this.getFistsStats() : null;
                      const strikeReach = (fs && fs.reach) || this.attackRange || 1.35;
                      // Dead-zone fix: leave attacking as soon as out of punch reach
                      // (old exit was attackRange*2 → soft-lock ring with no move/strike)
                      const outOfReach = focusDist > strikeReach * 1.12;
                      if (outOfReach) {
                          this.setGuard(false);
                          this.state = 'chasing';
                          break;
                      }
                      // Drop AI guard when timer ends
                      if (this.isGuarding && this._guardAiT <= 0) {
                          this.setGuard(false);
                      }
                      if (this.isGuarding) break;
                      if (this.attackCooldown <= 0) {
                          const gc = (this.guardChance != null) ? this.guardChance : 0.35;
                          const inPunch = focusDist <= strikeReach * 1.05;
                          if (inPunch && Math.random() < gc) {
                              this.setGuard(true);
                              this._guardAiT = (this.guardDuration != null) ? this.guardDuration : 0.65;
                              this.attackCooldown = 0.35;
                          } else if (inPunch) {
                              this.startStrike({
                                  fists: true,
                                  damage: this.attackDamage,
                                  reach: strikeReach,
                                  aimAt: focus.ref,
                                  aimPos: focus.pos
                              });
                              this.attackCooldown = (fs && fs.cooldown) ? (fs.cooldown + 0.1) : 0.42;
                          } else {
                              // Safety: shouldn't hit often after outOfReach check
                              this.state = 'chasing';
                          }
                      }
                      break;
                  }
                  if (this.canRanged !== false && this.rangedRange > 0 &&
                      focusDist > attackLimit && focusDist <= this.rangedRange &&
                      (focus.kind === 'base' || this.energy > 30)) {
                      this.attackMode = 'ranged';
                  } else {
                      this.attackMode = 'melee';
                  }
                  if (focusDist > this.attackRange * 2.0) {
                      this.state = 'chasing';
                  } else if (this.attackCooldown <= 0) {
                      this.attackFocus(focus);
                      this.attackCooldown = this.attackCooldownBase;
                      if (this.attackMode === 'ranged' && focus.kind !== 'base') this.energy -= 20;
                  }
                  this.turnTowards(focus.pos, delta, 3.0);
                  break;
              }
          }

      }

      turnTowards(point, delta, rate) {
          if (!point) return;
          const dir = new THREE.Vector3().subVectors(point, this.container.position);
          dir.y = 0;
          if (dir.lengthSq() < 0.0001) return;
          const targetY = Math.atan2(dir.x, dir.z);
          let diff = ((targetY - this.container.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
          const step = Math.max(0.2, rate || 3) * delta;
          this.container.rotation.y += THREE.MathUtils.clamp(diff, -step, step);
      }

      moveTo(targetPosition) {
           // Simple move: Calculate direction vector and set input
           const direction = new THREE.Vector3().subVectors(
              targetPosition,
              this.container.position
          );
          direction.y = 0; // Ignore vertical difference for basic movement direction
          direction.normalize();

          // Face the direction of movement (or target)
          this.faceTarget(targetPosition);

          // Set Character input based on direction relative to NPC's facing direction
          // (Since Character.processMovement uses container rotation, just set forward)
          this.input.forward = -1; // Move forward (Character class handles rotation)
          // More complex: Calculate local direction and set forward/left/right/backward
          // const localDirection = direction.clone().applyEuler(new THREE.Euler(0, -this.container.rotation.y, 0));
          // this.input.forward = Math.max(0, -localDirection.z);
          // this.input.backward = Math.max(0, localDirection.z);
          // this.input.left = Math.max(0, -localDirection.x);
          // this.input.right = Math.max(0, localDirection.x);
      }

      faceTarget(targetPosition) {
          const direction = new THREE.Vector3().subVectors(targetPosition, this.container.position);
          const targetRotationY = Math.atan2(direction.x, direction.z);

          // Smooth rotation
          const currentRotationY = this.container.rotation.y;
          let deltaRotation = targetRotationY - currentRotationY;

          // Normalize angle difference to [-PI, PI]
          while (deltaRotation > Math.PI) deltaRotation -= Math.PI * 2;
          while (deltaRotation < -Math.PI) deltaRotation += Math.PI * 2;

          const rotationSpeed = Math.PI * 1.5; // Radians per second
          this.container.rotation.y += THREE.MathUtils.clamp(deltaRotation, -rotationSpeed * clock.getDelta(), rotationSpeed * clock.getDelta());
      }

      attack(target) {
          if (!target || !target.container) return;
          const distanceToTarget = this.container.position.distanceTo(target.container.position);
          // Fists layer: peak-resolved strike (same pipeline as player)
          if (typeof this.usesFistsCombat === 'function' && this.usesFistsCombat()) {
              const fs = (typeof this.getFistsStats === 'function') ? this.getFistsStats() : null;
              const strikeReach = (fs && fs.reach) || this.attackRange || 1.35;
              if (distanceToTarget <= strikeReach * 1.05) {
                  this.startStrike({
                      fists: true,
                      damage: this.attackDamage,
                      reach: strikeReach,
                      aimAt: target,
                      aimPos: target.container ? target.container.position : null
                  });
              }
              return;
          }
          if (this.attackMode === 'melee' && distanceToTarget <= this.attackRange * 1.1) {
              // PR5b: host NPC melee vs remote player proxy → hurt event
              if (target.isRemoteProxy && target.remoteUid) {
                  try {
                      if (typeof onlineHostDamagePlayer === 'function') {
                          onlineHostDamagePlayer(target.remoteUid, this.attackDamage || 8, 'npc:' + (this.eid || 'x'));
                      }
                  } catch (e) {}
                  return;
              }
              if (target instanceof Player) {
                  if (typeof target.takeDamage === 'function') {
                      target.takeDamage(this.attackDamage, {
                          heavy: this.attackDamage >= 12,
                          from: this.container ? this.container.position : null
                      });
                  } else {
                      target.health -= this.attackDamage;
                      if (target.health < 0) target.health = 0;
                      const heavyHit = this.attackDamage >= 12 ||
                          (target.maxHealth > 0 && target.health <= target.maxHealth * 0.35);
                      target.applyDamageEffect({ heavy: heavyHit });
                      target.updateStatsHUD();
                      if (target.health <= 0) showGameOver();
                  }
              }
          } else if (this.canRanged !== false && this.attackMode === 'ranged' &&
                     this.rangedRange > 0 && distanceToTarget <= this.rangedRange) {
              this.shootAt(target);
          }
      }

      shootAt(target) {
          try {
              const muzzlePos = this.container.position.clone();
              muzzlePos.y += this.height * 0.4;
              const targetPos = target.container.position.clone();
              targetPos.y += (target.height || 1.7) * 0.3;
              const dir = new THREE.Vector3().subVectors(targetPos, muzzlePos).normalize();
              // Slight inaccuracy so the player can dodge at range
              dir.x += (Math.random() - 0.5) * 0.06;
              dir.y += (Math.random() - 0.5) * 0.03;
              dir.z += (Math.random() - 0.5) * 0.06;
              dir.normalize();
              muzzlePos.add(dir.clone().multiplyScalar(0.6)); // start clear of own body
              const bullet = new Bullet(muzzlePos, dir);
              bullet.owner = 'enemy';
              bullet.shooter = this;
              bullet.damage = this.rangedDamage || 6;
              bullet.structureDamage = Math.max(25, (this.rangedDamage || 6) * 4);
              bullet.velocity.multiplyScalar(0.75);
              bullet.lifetime = Math.min(bullet.lifetime, 3);
              bullet.mesh.material.color.setHex(0xff3333);
              bullet.mesh.material.emissive.setHex(0xff0000);
              try { playSoundAt('enemy_shot', muzzlePos, { gain: 0.9, maxDist: 55 }); } catch (e) {}
          } catch (e) { console.error('NPC shoot failed:', e); }
      }

      selectFocus(player) {
          // Prioridad: base detectada mientras vagaba (la "recuerda" hasta destruirla)
          if (this.baseHunt) {
              if (this.baseHunt.hp <= 0) {
                  this.baseHunt = null;
              } else {
                  return {
                      kind: 'base', ref: this.baseHunt, pos: this.baseHunt.pos,
                      target: { container: { position: this.baseHunt.pos }, height: 1.4, collider: this.baseHunt.mesh, mesh: this.baseHunt.mesh }
                  };
              }
          }
          // Persigue al jugador (u otro remoto en host coop), pero si tu base está mucho más cerca, va por la base
          let focusPlayer = player;
          let toPlayer = player && player.container
              ? this.container.position.distanceTo(player.container.position)
              : Infinity;
          try {
              if (typeof onlineCombatSync === 'function' && onlineCombatSync() &&
                  typeof ONLINE !== 'undefined' && ONLINE.isHost &&
                  typeof remotes !== 'undefined' && remotes) {
                  for (const uid in remotes) {
                      const r = remotes[uid];
                      if (!r || r.mesh == null) continue;
                      const d = Math.hypot(
                          r.tx - this.container.position.x,
                          r.tz - this.container.position.z
                      );
                      if (d < toPlayer) {
                          toPlayer = d;
                          focusPlayer = {
                              isRemoteProxy: true,
                              remoteUid: uid,
                              container: { position: new THREE.Vector3(r.tx, r.ty || 0, r.tz) },
                              height: 1.7,
                              mesh: r.mesh,
                              collider: r.mesh
                          };
                      }
                  }
              }
          } catch (e) {}
          let best = null, bestD = Infinity;
          try {
              for (const wb of workbenches) {
                  if (!wb || wb.hp <= 0) continue;
                  const d = this.container.position.distanceTo(wb.pos);
                  if (d < bestD) { bestD = d; best = wb; }
              }
          } catch (e) {}
          if (best && (bestD < toPlayer - 4 || bestD < toPlayer * 0.7) && bestD < this.detectionRange * 1.5) {
              return {
                  kind: 'base', ref: best, pos: best.pos,
                  target: { container: { position: best.pos }, height: 1.4, collider: best.mesh, mesh: best.mesh }
              };
          }

          // Combat Lab: sticky last attacker briefly, else nearest-threat (player | NPCs)
          if (typeof this.allowsNpcFights === 'function' && this.allowsNpcFights()) {
              try {
                  if (this._lastAttacker && this._lastAttacker.health > 0 &&
                      this._lastAttacker.state !== 'dead' && this._lastAttacker.container &&
                      performance.now() < (this._lastAttackerUntil || 0)) {
                      const dAtt = this.container.position.distanceTo(this._lastAttacker.container.position);
                      if (dAtt < this.detectionRange) {
                          return {
                              kind: 'npc',
                              ref: this._lastAttacker,
                              pos: this._lastAttacker.container.position.clone(),
                              target: this._lastAttacker
                          };
                      }
                  }
              } catch (e) {}
              let bestNpc = null;
              let bestNpcD = Infinity;
              try {
                  if (typeof npcs !== 'undefined' && npcs) {
                      for (let i = 0; i < npcs.length; i++) {
                          const n = npcs[i];
                          if (!n || n === this || n.health <= 0 || n.state === 'dead') continue;
                          if (!n.container) continue;
                          const d = this.container.position.distanceTo(n.container.position);
                          if (d < bestNpcD && d < this.detectionRange) {
                              bestNpcD = d;
                              bestNpc = n;
                          }
                      }
                  }
              } catch (e) {}
              if (bestNpc && bestNpcD <= toPlayer) {
                  return {
                      kind: 'npc',
                      ref: bestNpc,
                      pos: bestNpc.container.position.clone(),
                      target: bestNpc
                  };
              }
          }

          const pos = focusPlayer && focusPlayer.container ? focusPlayer.container.position : player.container.position;
          return { kind: 'player', ref: focusPlayer, pos: pos, target: focusPlayer };
      }
      attackFocus(focus) {
          if (focus.kind === 'base') {
              const wb = focus.ref;
              if (!wb || wb.hp <= 0) return;
              if (this.attackMode === 'melee') {
                  damageWorkbench(wb, Math.max(20, (this.attackDamage || 8) * 3));
              } else {
                  this.shootAt(focus.target);
              }
          } else {
              this.attack(focus.ref);
          }
      }
      // Bloque construido justo delante, a la altura del cuerpo. Sirve para
      // atacarlo en lugar de quedar empujando el muro.
      findBlockingBlock(reach) {
          if (typeof placedBlocks === 'undefined' || !placedBlocks.length) return null;
          // Body / chase forward = local +Z (see getForwardDir / BODY_MOUNT)
          const fwd = this.getForwardDir(new THREE.Vector3());
          const maxReach = reach || (this.attackRange || 2.5) + 1.1;
          const feetY = this.container.position.y - this.halfHeight;
          const heights = [0.45, 1.15, 1.85];
          for (let i = 0; i < heights.length; i++) {
              const origin = this.container.position.clone();
              origin.y = feetY + heights[i];
              const ray = new THREE.Raycaster(origin, fwd, 0, maxReach);
              let hits = [];
              try { hits = ray.intersectObjects(placedBlocks, false); } catch (e) { return null; }
              if (hits.length) {
                  const block = hits[0].object;
                  if (block && placedBlocks.includes(block)) return block;
              }
          }
          return null;
      }
      // If a wall the player built blocks the path, tear it down instead of getting stuck
      tryBreakBlockAhead() {
          if (this.attackCooldown > 0) return false;
          const block = this.findBlockingBlock();
          if (!block) return false;
          this.attackPlacedBlock(block);
          this.attackCooldown = this.attackCooldownBase;
          return true;
      }
      attackPlacedBlock(block) {
          if (!block || !block.userData) return;
          const info = BLOCK_MATERIALS[block.userData.type] || { health: 3 };
          if (typeof block.userData.health !== 'number') block.userData.health = block.userData.maxHealth || info.health;
          if (typeof block.userData.maxHealth !== 'number') block.userData.maxHealth = info.health;
          block.userData.health -= Math.max(3, this.attackDamage || 8);
          try { updateBlockAppearance(block); } catch (e) {}
          try { playSound('hit'); } catch (e) {}
          if (block.userData.health <= 0) {
              try { destroyBlock(block); } catch (e) {}
          }
      }
      hasLineOfSight(target, collidables) {
           if (!target) return false;
           const origin = this.container.position.clone();
           origin.y += this.height * 0.4; // Check from eye level
           const targetPos = target.container.position.clone();
           targetPos.y += target.height * 0.4; // Target eye level

           const direction = new THREE.Vector3().subVectors(targetPos, origin).normalize();
           const distance = origin.distanceTo(targetPos);

           const raycaster = new THREE.Raycaster(origin, direction, 0.1, distance);

           // Filter obstacles: visible, not self, not target, not helpers/bullets
           const obstacles = collidables.filter(obj =>
               obj.visible &&
               obj !== this.collider &&
               obj !== target.collider &&
               obj !== this.mesh &&
               obj !== target.mesh && // Check target mesh if it exists
               obj !== this.colliderBoxHelper &&
               obj !== target.colliderBoxHelper && // Check target helper
               !obj.isBullet &&
               !obj.isCollectible // Ignore collectibles
               // Include placed blocks:
               // && placedBlocks.includes(obj) // This check might be too slow if many blocks
           );
           // Add placed blocks separately if not already in collidables for LOS check
           // obstacles.push(...placedBlocks);

           const hits = raycaster.intersectObjects([...obstacles, ...placedBlocks], true); // Check recursively

           // Check if the first hit is the target (or very close to it)
           if (hits.length > 0) {
               const firstHit = hits[0];
               // Check if the hit object is the target's collider or visual mesh
               if (firstHit.object === target.collider || firstHit.object === target.mesh || firstHit.object.parent === target.mesh) {
                  return true; // Hit the target first
               }
              // If hit distance is very close to target distance, assume LOS
               if (Math.abs(firstHit.distance - distance) < 0.5) {
                   // This might allow seeing through thin walls, be careful
                   // return true;
               }
              // console.log(`LOS blocked by: ${hits[0].object.name || 'Unnamed Object'} at distance ${hits[0].distance} / ${distance}`);
               return false; // Blocked by something else
           }

           return true; // No obstacles found
      }

      // Enemigos también consumen pickups automáticos: comida los cura, toxina los daña
      handleCollectible(collectible) {
          if (!collectible || collectible.userData.collected) return;
          collectible.userData.collected = true;
          try { this.scene.remove(collectible); } catch (e) {}
          const ci = collidableObjects.indexOf(collectible);
          if (ci > -1) collidableObjects.splice(ci, 1);
          if (collectible.type === 'food') {
              this.health = Math.min(this.maxHealth || 100, this.health + (collectible.userData.healAmount || 20));
              try { createHarvestEffect(collectible.position); } catch (e) {}
          } else if (collectible.type === 'toxin') {
              try { createHarvestEffect(collectible.position); } catch (e) {}
              try { this.takeDamage(collectible.userData.damageAmount || 30); } catch (e) {}
          }
      }

      /**
       * @param {number} amount
       * @param {object} [opts] { zone, hitY, from, heavy }
       */
      takeDamage(amount, opts) {
          if (this.state === 'dead' || this._deadCounted) return;
          opts = opts || {};
          let dmg = amount;
          let zone = opts.zone || null;
          if (!zone && opts.hitY != null && typeof classifyHitOnCharacter === 'function') {
              zone = classifyHitOnCharacter(this, opts.hitY);
          }
          if (zone && typeof hitZoneMultiplier === 'function' && opts.scaleByZone !== false && opts.preScaled !== true) {
              dmg = Math.max(1, Math.round(amount * hitZoneMultiplier(zone)));
          }
          // Guard / block (future shield): low chip; NO stagger / knockback / flinch
          let blocked = false;
          if (this.isGuarding && opts.ignoreGuard !== true) {
              const fs = (typeof this.getFistsStats === 'function') ? this.getFistsStats() : null;
              let mult = (fs && fs.guardDamageMult != null) ? fs.guardDamageMult : 0.18;
              if (fs && (this.stamina || 0) < (fs.guardTiredBelow != null ? fs.guardTiredBelow : 15)) {
                  mult = fs.guardTiredMult != null ? fs.guardTiredMult : 0.45;
              }
              dmg = Math.max(1, Math.round(dmg * mult));
              blocked = true;
              try {
                  if (typeof this.spendFistsStamina === 'function') {
                      this.spendFistsStamina(fs && fs.blockHitCost != null ? fs.blockHitCost : 4);
                  }
              } catch (e) {}
              try {
                  if (this.body && typeof this.body.emit === 'function') this.body.emit('blocked', zone);
              } catch (e) {}
              try {
                  if (typeof noteCombatLabBlock === 'function') noteCombatLabBlock('npc');
              } catch (e) {}
          }
          this.health -= dmg;
          if (this.health < 0) this.health = 0;
          this.lastDamageTs = performance.now();
          this.lastHitZone = zone || this.lastHitZone || null;
          if (this.mesh) this.mesh.userData.health = this.health;

          // Si le pegan, deja de obsesionarse con la base y enfrenta la amenaza
          this.baseHunt = null;

          // Sticky retaliation (~1.6s) then nearest-threat resumes in selectFocus
          if (opts.fromNpc && opts.fromNpc !== this && opts.fromNpc.health > 0) {
              this.isHostile = true;
              this.target = opts.fromNpc;
              this._lastAttacker = opts.fromNpc;
              this._lastAttackerUntil = performance.now() + 1600;
              if (this.state === 'idle' || this.state === 'wandering' || this.state === 'fleeing') {
                  this.state = 'chasing';
              }
          } else if (this.state === 'idle' || this.state === 'wandering') {
              this.isHostile = true;
              this.state = 'chasing';
              this.target = player;
          }

          const from = opts.from || ((typeof player !== 'undefined' && player && player.container)
              ? player.container.position : null);

          if (blocked) {
              // Held guard: absorb — stay planted, keep guarding pose
              try { playSound('hit'); } catch (e) {}
          } else {
              try { playSound('hit'); } catch (e) {}
              try { this.applyDamageEffect(); } catch (e) {}

              const heavy = opts.heavy != null
                  ? !!opts.heavy
                  : (dmg >= 25 || zone === 'head' || this.health <= this.maxHealth * 0.35);
              try { this.playBodyHit(from, heavy); } catch (e) {}
              try {
                  if (this.body && typeof this.body.emit === 'function' && zone) {
                      this.body.emit('hit', zone);
                  }
              } catch (e) {}

              // Soft stagger: brief AI lock + attackCooldown bump
              try {
                  let st = (opts.stagger != null) ? opts.stagger : (heavy ? 0.28 : 0.12);
                  if (st > 0 && this.health > 0) {
                      this._staggerT = Math.max(this._staggerT || 0, st);
                      this.attackCooldown = Math.max(this.attackCooldown || 0, st * 0.85);
                      this.input = this.input || { forward: 0, backward: 0, left: 0, right: 0 };
                      this.input.forward = 0;
                      this.input.backward = 0;
                      this.input.left = 0;
                      this.input.right = 0;
                      this.velocity.x *= 0.35;
                      this.velocity.z *= 0.35;
                  }
              } catch (e) {}

              // Soft knockback away from attacker
              try {
                  if (from && this.health > 0) {
                      const away = new THREE.Vector3().subVectors(this.container.position, from);
                      away.y = 0;
                      if (away.lengthSq() > 1e-4) {
                          const knock = heavy ? 4.5 : 2.8;
                          const headBoost = zone === 'head' ? 1.15 : 1;
                          away.normalize().multiplyScalar(knock * headBoost);
                          this.velocity.x += away.x;
                          this.velocity.z += away.z;
                          if (heavy) this.velocity.y = Math.max(this.velocity.y, zone === 'head' ? 2.2 : 1.6);
                      }
                  }
              } catch (e) {}
          }
          
          if (this.health <= 0) {
              this.die();
          }
      }

      smartAvoidance(collidables, player) {
          const origin = this.container.position.clone();
          origin.y += this.height * 0.5; // cast from chest height

          const forwardDir = this.getForwardDir(new THREE.Vector3());
          const leftDir = forwardDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 6);  // 30° left
          const rightDir = forwardDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 6); // 30° right

          const scanDistance = 1.5;
          const obstacles = (typeof placedBlocks !== 'undefined') ? [...collidables, ...placedBlocks] : collidables;

          const forwardRay = new THREE.Raycaster(origin, forwardDir, 0, scanDistance);
          const leftRay = new THREE.Raycaster(origin, leftDir, 0, scanDistance);
          const rightRay = new THREE.Raycaster(origin, rightDir, 0, scanDistance);

          const forwardHits = forwardRay.intersectObjects(obstacles, true);
          const leftHits = leftRay.intersectObjects(obstacles, true);
          const rightHits = rightRay.intersectObjects(obstacles, true);

          if (forwardHits.length > 0) {
              const leftClear = leftHits.length === 0;
              const rightClear = rightHits.length === 0;

              if (leftClear && !rightClear) {
                  // Turn slightly left
                  this.container.rotation.y += 0.05;
              } else if (rightClear && !leftClear) {
                  // Turn slightly right
                  this.container.rotation.y -= 0.05;
              } else if (leftClear && rightClear) {
                  // Pick random direction
                  if (Math.random() < 0.5) {
                      this.container.rotation.y += 0.05;
                  } else {
                      this.container.rotation.y -= 0.05;
                  }
              }
              // else: stuck, no way clear, stay forward
          }
      }

      die() {
          if (this._deadCounted) return;
          this._deadCounted = true;
          // Mark dead BEFORE hydra count so combatLabCountAlive never overcounts
          this.state = 'dead';
          this.health = 0;
          if (this.mesh) this.mesh.userData.health = 0;
          try { enemiesKilled++; } catch (e) {}
          if (this.tutorialCombat && typeof directorOnTutorialRobotKilled === 'function') {
              try { directorOnTutorialRobotKilled(); } catch (e) {}
          }
          try {
              if (typeof noteCombatLabKill === 'function') noteCombatLabKill();
          } catch (e) {}
          this.velocity.set(0, 0, 0);
          this.isOnGround = false; // allow death knockup ballistic

          // Stop blocking movement / targeting immediately (corpse is visual-only)
          try {
              if (this.healthBar) this.healthBar.visible = false;
              if (this.mesh) {
                  const mi = collidableObjects.indexOf(this.mesh);
                  if (mi > -1) collidableObjects.splice(mi, 1);
              }
              if (this.collider) {
                  const ci = collidableObjects.indexOf(this.collider);
                  if (ci > -1) collidableObjects.splice(ci, 1);
              }
          } catch (e) {}

          // PR6: host spawns shared death loot (guests see via event loot).
          try {
              if (!this.isPuppet && typeof onlineHostDeathLoot === 'function') {
                  onlineHostDeathLoot(this);
              }
          } catch (e) {}
          
          // Theatrical death: crumple → flat, then VFX, then remove (procedural ragdoll feel)
          try {
              if (this.body) {
                  if (typeof this.body.playDeath === 'function') this.body.playDeath();
                  else if (typeof this.body.setDown === 'function') this.body.setDown('dead');
              }
          } catch (e) {}
          try {
              const from = (typeof player !== 'undefined' && player && player.container)
                  ? player.container.position : null;
              if (from) {
                  const away = new THREE.Vector3().subVectors(this.container.position, from);
                  away.y = 0;
                  if (away.lengthSq() > 1e-4) {
                      away.normalize().multiplyScalar(3.6);
                      this.velocity.x = away.x;
                      this.velocity.z = away.z;
                      this.velocity.y = 2.8;
                  }
              }
          } catch (e) {}

          // VFX as body goes flat (~0.5s crumple in driver)
          setTimeout(() => {
              try {
                  if (!this.container || !this.container.parent) return;
                  if (this.mesh) this.createDeathEffect(this.mesh);
                  else if (this.container) this.createDeathEffect(this.container);
              } catch (e) {}
          }, 520);
          
          // Remove after flat pose reads
          setTimeout(() => {
              try {
                  if (this.body && typeof this.body.dispose === 'function') this.body.dispose();
              } catch (e) {}
              this.body = null;
              if (this.mesh && this.mesh.parent) this.scene.remove(this.mesh);
              if (this.container && this.container.parent) this.scene.remove(this.container);
              
              const npcIndex = npcs.indexOf(this);
              if (npcIndex > -1) npcs.splice(npcIndex, 1);
          }, 1450);
      }

      createDeathEffect(enemy) {
          const particleCount = 36;
          const particles = new THREE.Group();

          const deathPos = new THREE.Vector3();
          enemy.getWorldPosition(deathPos);

          playSoundAt('explosion', deathPos, { gain: 0.95, maxDist: 60 });

          for (let i = 0; i < particleCount; i++) {
              const isBlood = Math.random() > 0.28;
              const size = isBlood ? 0.08 + Math.random() * 0.12 : 0.04 + Math.random() * 0.06;
              const color = isBlood ? 0x8A0303 : 0x00ffff;

              const mat = new THREE.MeshStandardMaterial({
                  color,
                  emissive: isBlood ? 0x220000 : color,
                  emissiveIntensity: isBlood ? 0.15 : 0.6,
                  transparent: true,
                  opacity: 1.0,
                  roughness: 0.55
              });

              const particle = new THREE.Mesh(
                  new THREE.SphereGeometry(size, 6, 6),
                  mat
              );

              // Scatter around torso height
              particle.position.copy(deathPos);
              particle.position.x += (Math.random() - 0.5) * 0.55;
              particle.position.y += 0.2 + (Math.random() - 0.3) * 0.6;
              particle.position.z += (Math.random() - 0.5) * 0.55;

              particle.userData = {
                  velocity: new THREE.Vector3(
                      (Math.random() - 0.5) * 6.5,
                      1.2 + Math.random() * 3.5,
                      (Math.random() - 0.5) * 6.5
                  ),
                  lifetime: 0.85 + Math.random() * 0.7
              };

              particles.add(particle);
          }

          scene.add(particles);

          // Flash light burst
          const flash = new THREE.PointLight(0xff8866, 2.4, 4);
          flash.position.copy(deathPos);
          flash.position.y += 0.4;
          scene.add(flash);
          setTimeout(() => { try { scene.remove(flash); } catch (e) {} }, 120);

          // Animate particles
          const animateParticles = () => {
              let allDead = true;
              const delta = 0.016;

              particles.children.forEach(p => {
                  if (p.userData.lifetime > 0) {
                      allDead = false;
                      p.userData.lifetime -= delta;
                      p.position.add(p.userData.velocity.clone().multiplyScalar(delta));
                      p.userData.velocity.y -= 9.8 * delta; // gravity
                      p.material.opacity = Math.max(0, p.userData.lifetime);
                  }
              });

              if (allDead) {
                  scene.remove(particles);
              } else {
                  requestAnimationFrame(animateParticles);
              }
          };

          animateParticles();
      }
  }
