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
          this.stamina = 100;

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

      update(delta, collidables) {
          if (isGamePaused) return;
          
          this._previousPosition.copy(this.container.position);
          const wasOnGround = this.isOnGround;

          // Store movement delta for collision response
          this.checkGround(collidables);
          this.processMovement(delta, collidables);

          // Regenerate stamina and energy over time
          const staminaRegenRate = this.isOnGround ? 5 : 2;
          const energyRegenRate = 2;

          this.stamina = Math.min(100, this.stamina + delta * staminaRegenRate);
          this.energy = Math.min(100, this.energy + delta * energyRegenRate);

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

          // Apply movement speed with sprint modifier
          let currentSpeed = this.config.speed;
          if (this.isSprinting && this.isOnGround && this.stamina > 0) {
              currentSpeed *= this.config.sprintMultiplier;
              this.stamina -= 3;
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
        const objects     = [...collidables, ...placedBlocks];

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
          }
          this.updateFootsteps(delta, isMovingHorizontally);
          
          this.updateInteractionRaycast();
          this.updateHeadBob(delta, isMovingHorizontally);
          this.updateToolSwayAndBob(delta); // Unified sway/bob for current tool/item
          this.updateCameraRotation(delta);
          this.updateStatsHUD(); // Update HUD display
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
          if ((keys['shift'] || this.mobileSprintPressed) && this.isOnGround && (this.input.forward > 0 || this.joystickValues.y < -0.5)) {
            if(this.stamina > 2) {
              this.isSprinting = true;
              this.stamina = Math.max(0, this.stamina - 2);
              this.energy = Math.max(0, this.energy - 1);
            } else {
              this.isSprinting = false;
              console.log("Sin resto: recuperá el aguante");
            }
          } 

          // Jump handling
          if ((keys[' '] || this.mobileJumpPressed) && 
              (this.isOnGround || this.coyoteTime > 0)) {
              if(this.stamina > 5) {
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
                  this.stamina -= 5;
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
          if (table && table[t]) return table[t];
          return { damage: 4, reach: 2.2 };
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

      // Golpe cuerpo a cuerpo. damage/reach opcionales (default según herramienta).
      meleeAttack(damage, reach) {
          if (isGamePaused || !this.camera) return false;
          if (typeof meleeCooldown !== 'undefined' && meleeCooldown > 0) return false;

          const stats = this.getMeleeStatsForTool(this.currentTool);
          const dmg = (typeof damage === 'number') ? damage : stats.damage;
          const rng = (typeof reach === 'number') ? reach : stats.reach;

          const origin = this.camera.getWorldPosition(new THREE.Vector3());
          const dir = this.camera.getWorldDirection(new THREE.Vector3());
          const ray = new THREE.Raycaster(origin, dir, 0, rng);
          const targets = [];
          try { npcs.forEach(n => { if (n && n.health > 0 && n.mesh) targets.push(n.mesh); }); } catch (e) {}
          const hits = targets.length ? ray.intersectObjects(targets, true) : [];
          let hitNpc = false;
          for (let i = 0; i < hits.length; i++) {
              let p = hits[i].object, npc = null;
              while (p) {
                  if (p.userData && p.userData.parentCharacter instanceof NPC) {
                      npc = p.userData.parentCharacter;
                      break;
                  }
                  p = p.parent;
              }
              if (npc && npc.health > 0) {
                  try { npc.takeDamage(dmg); } catch (e) {}
                  try { createHarvestEffect(hits[i].point); } catch (e) {}
                  try { playSound('hit'); } catch (e) {}
                  hitNpc = true;
                  break;
              }
          }
          try { this.applyRecoil(); } catch (e) {}
          try {
              if (typeof meleeCooldown !== 'undefined') meleeCooldown = 0.42;
              else if (typeof shootCooldown !== 'undefined') shootCooldown = Math.max(shootCooldown || 0, 0.35);
          } catch (e) {}
          if (!hitNpc) {
              try { playSound('weapon_empty'); } catch (e) {}
          }
          return hitNpc;
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
          const stamina = Math.max(0, Math.min(100, Math.round(this.stamina)));

          statsDiv.innerHTML = `Vida: ${hp}<br>Energía: ${energy}<br>Aguante: ${stamina}`;
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
        // Hide all item models first
        this.inventory.items.forEach(item => {
          if (item.model) item.model.visible = false;
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

          // Handle keys separately - add to keychain
          if (def.type === 'key') {
              if (this.inventory.addKey(def.keyId || def.id, def.name)) {
                  // Remove from world
                  this.scene.remove(item);
                  collidableObjects.splice(collidableObjects.indexOf(item), 1);
                  playSound('key-pickup');
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

          // Remove from camera group and add back to scene
          this.camera.remove(itemMesh);
          this.scene.add(itemMesh);

          // Position in front of player
          const dropDirection = this.camera.getWorldDirection(new THREE.Vector3());
          const dropPosition = this.container.position.clone()
              .add(new THREE.Vector3(0, this.config.height * 0.2, 0)) // Drop from chest height
              .add(dropDirection.multiplyScalar(1.0)); // Drop 1 unit in front

          itemMesh.position.copy(dropPosition);
          // Optional: Reset scale if changed on pickup
          // itemMesh.scale.setScalar(1.0);
          // Optional: Apply a small velocity/spin
          itemMesh.userData.velocity = dropDirection.clone().multiplyScalar(2); // Small forward push
          itemMesh.userData.velocity.y += 1.0; // Small upward push

          // Add back to collidables and mark as not collected
          itemMesh.userData.collected = false;
          collidableObjects.push(itemMesh);

          this.heldItem = null; // Clear held item reference

          this.updateToolModelVisibility(); // Show gun/hammer if appropriate
          this.updateToolHUD();
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
                  this.applyDamageEffect();
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
      // Player-specific damage effect (e.g., screen flash)
      applyDamageEffect() {
          // Optional: Call super.applyDamageEffect() if Character has base effect too
          // super.applyDamageEffect();

          // Flash red screen overlay
          const damageOverlay = document.getElementById('damageOverlay'); // Assume exists in HTML
          if (damageOverlay) {
              damageOverlay.style.opacity = '0.7';
              setTimeout(() => {
                  damageOverlay.style.opacity = '0';
              }, 150);
          } else {
              console.warn("Damage overlay element not found");
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
          this.rangedRange = 15;
          this.rangedDamage = 6;
          this.healthRegenRate = 6;       // HP/sec while fleeing to safety
          this.healthRegenIdleRate = 1.5; // HP/sec when out of combat a while
          this.lastDamageTs = 0;
          this.isHostile = true;
          this.servoTimer = 2.5 + Math.random() * 5;

          // Visual representation (can be passed in or created)
          this.mesh = visualMesh || this.createVisual();
          this.mesh.userData.parentCharacter = this; // Link mesh back to character
          this.container.add(this.mesh); // Add visual mesh to the container
          collidableObjects.push(this.mesh); // Make the visual mesh collidable for bullets etc.
          this.mesh.isEnemy = true; // Flag for bullet logic

          // Need health on the mesh for bullet hits? Or hit the character collider?
          // Let's put health reference on the mesh userData for bullets to find easily
          this.mesh.health = this.health;
          this.mesh.userData.health = this.health;
          // Health bar
          const hbGeo = new THREE.PlaneGeometry(1.2, 0.08);
          const hbMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.9 });
          this.healthBar = new THREE.Mesh(hbGeo, hbMat);
          this.healthBar.position.set(0, this.height + 0.4, 0);
          this.healthBar.visible = false;
          this.container.add(this.healthBar);
          this.healthBarRangeSq = 18 * 18;
          this._hbTarget = new THREE.Vector3();
          this.eyeGlow = (this.mesh && typeof this.mesh.getObjectByName === 'function')
              ? this.mesh.getObjectByName('NPC_EyeGlow')
              : null;
      }

      createVisual() {
          // Default visual if none provided (e.g., a simple capsule or cylinder)
          const geo = new THREE.CapsuleGeometry(this.radius, this.height - 2 * this.radius, 8, 16);
          const mat = new THREE.MeshStandardMaterial({
              color: 0xff0000, // Red for enemy
              roughness: 0.6,
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.position.y = this.radius; // Align bottom with container base
          mesh.name = "NPC_Visual";
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
           if (this.eyeGlow) {
               this.eyeGlow.visible = this.health > 0;
               const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.0045);
               this.eyeGlow.material.opacity = 0.55 + pulse * 0.4;
               const gs = 0.9 + pulse * 0.4;
               this.eyeGlow.scale.set(gs, gs, 1);
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

          if (!player || this.health <= 0) {
              this.state = 'idle';
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
          const distanceToPlayer = this.container.position.distanceTo(focus.pos);
          const playerDist = this.container.position.distanceTo(player.container.position);
          const hasLOS = this.hasLineOfSight(player, collidables);

          // --- State Machine ---
          switch (this.state) {
              case 'idle':
                  if (this.isHostile && playerDist < this.detectionRange && hasLOS) {
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
                  // Si ve al jugador, lo persigue; si encontró una base, va por ella.
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
                  if (this.health <= this.maxHealth * this.fleeHealthThreshold && distanceToPlayer < this.detectionRange) {
                      this.state = 'fleeing';
                      break;
                  }
                  if (distanceToPlayer < this.attackRange) {
                      this.state = 'attacking';
                  } else if (distanceToPlayer > this.detectionRange * 2.0) {
                      this.state = 'idle';
                      this.target = null;
                  } else {
                      this.smartAvoidance(collidables, player);
                      this.tryBreakBlockAhead();
                      this.input.forward = -1;
                      const direction = new THREE.Vector3().subVectors(
                          focus.pos,
                          this.container.position
                      ).normalize();
                      const targetYRotation = Math.atan2(direction.x, direction.z);
                      const rotationDifference = targetYRotation - this.container.rotation.y;
                      const normalizedDiff = ((rotationDifference + Math.PI) % (Math.PI * 2)) - Math.PI;
                      const rotationSpeed = this.config.speed * delta * 2.0;
                      this.container.rotation.y += THREE.MathUtils.clamp(
                          normalizedDiff,
                          -rotationSpeed,
                          rotationSpeed
                      );
                      // Fire on the move: shoot while closing the distance
                      if (distanceToPlayer <= this.rangedRange && this.attackCooldown <= 0 &&
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
                  if (distanceToPlayer > this.detectionRange * 1.5 || this.health > this.maxHealth * 0.5) {
                      this.state = 'chasing';
                  } else {
                      const dirFlee = new THREE.Vector3().subVectors(this.container.position, focus.pos).normalize();
                      const targetYFlee = Math.atan2(dirFlee.x, dirFlee.z);
                      const rotDiffFlee = ((targetYFlee - this.container.rotation.y + Math.PI) % (Math.PI*2)) - Math.PI;
                      this.container.rotation.y += THREE.MathUtils.clamp(rotDiffFlee, -delta*3, delta*3);
                      this.input.forward = -1;
                  }
                  break;
              case 'attacking':
                  if (this.health <= this.maxHealth * this.fleeHealthThreshold && distanceToPlayer < this.detectionRange) {
                      this.state = 'fleeing';
                      break;
                  }
                  if (distanceToPlayer > this.attackRange && distanceToPlayer <= this.rangedRange &&
                      (focus.kind === 'base' || this.energy > 30)) {
                      this.attackMode = 'ranged';
                  } else {
                      this.attackMode = 'melee';
                  }
                  this.tryBreakBlockAhead();
                  if (distanceToPlayer > this.attackRange * 2.0) {
                      this.state = 'chasing';
                  } else if (this.attackCooldown <= 0) {
                      this.attackFocus(focus);
                      this.attackCooldown = this.attackCooldownBase;
                      if (this.attackMode === 'ranged' && focus.kind !== 'base') this.energy -= 20;
                  }
                  const dirAtk = new THREE.Vector3().subVectors(focus.pos, this.container.position).normalize();
                  const targetYAtk = Math.atan2(dirAtk.x, dirAtk.z);
                  const rotDiffAtk = ((targetYAtk - this.container.rotation.y + Math.PI) % (Math.PI*2)) - Math.PI;
                  this.container.rotation.y += THREE.MathUtils.clamp(rotDiffAtk, -delta*3, delta*3);
                  break;
          }

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
          const distanceToTarget = this.container.position.distanceTo(target.container.position);
          if (this.attackMode === 'melee' && distanceToTarget <= this.attackRange * 1.1) {
              if (target instanceof Player) {
                  target.health -= this.attackDamage;
                  target.applyDamageEffect();
                  target.updateStatsHUD();
                  if (target.health <= 0) {
                      showGameOver();
                  }
              }
          } else if (this.attackMode === 'ranged' && distanceToTarget <= this.rangedRange) {
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
          // Persigue al jugador, pero si tu base está mucho más cerca, va por la base
          const toPlayer = this.container.position.distanceTo(player.container.position);
          let best = null, bestD = Infinity;
          try {
              for (const wb of workbenches) {
                  if (!wb || wb.hp <= 0) continue;
                  const d = this.container.position.distanceTo(wb.pos);
                  if (d < bestD) { bestD = d; best = wb; }
              }
          } catch (e) {}
          if (best && bestD < toPlayer * 0.7 && bestD < this.detectionRange * 1.5) {
              return {
                  kind: 'base', ref: best, pos: best.pos,
                  target: { container: { position: best.pos }, height: 1.4, collider: best.mesh, mesh: best.mesh }
              };
          }
          return { kind: 'player', ref: player, pos: player.container.position, target: player };
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
      // If a wall the player built blocks the path, tear it down instead of getting stuck
      tryBreakBlockAhead() {
          if (this.attackCooldown > 0) return false;
          if (typeof placedBlocks === 'undefined' || !placedBlocks.length) return false;
          const origin = this.container.position.clone();
          origin.y += this.height * 0.4;
          const fwd = new THREE.Vector3(0, 0, -1).applyEuler(this.container.rotation).normalize();
          const reach = (this.attackRange || 2.5) + 0.9;
          const ray = new THREE.Raycaster(origin, fwd, 0, reach);
          let hits = [];
          try { hits = ray.intersectObjects(placedBlocks, false); } catch (e) { return false; }
          if (!hits.length) return false;
          const block = hits[0].object;
          if (!block || !placedBlocks.includes(block)) return false;
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

      takeDamage(amount) {
          this.health -= amount;
          this.lastDamageTs = performance.now();
          this.mesh.userData.health = this.health; // Sync health

          // Si el jugador le pega, deja de obsesionarse con la base y lo enfrenta
          this.baseHunt = null;

          // Become hostile if not already
          if (this.state === 'idle' || this.state === 'wandering') {
              this.isHostile = true;
              this.state = 'chasing';
              this.target = player;
          }

          playSound('hit');
          
          // Apply damage effect
          this.applyDamageEffect();
          
          if (this.health <= 0) {
              this.die();
          }
      }

      smartAvoidance(collidables, player) {
          const origin = this.container.position.clone();
          origin.y += this.height * 0.5; // cast from chest height

          const forwardDir = new THREE.Vector3(0, 0, -1).applyEuler(this.container.rotation).normalize();
          const leftDir = forwardDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 6);  // 30° left
          const rightDir = forwardDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 6); // 30° right

          const scanDistance = 1.5;

          const forwardRay = new THREE.Raycaster(origin, forwardDir, 0, scanDistance);
          const leftRay = new THREE.Raycaster(origin, leftDir, 0, scanDistance);
          const rightRay = new THREE.Raycaster(origin, rightDir, 0, scanDistance);

          const forwardHits = forwardRay.intersectObjects(collidables, true);
          const leftHits = leftRay.intersectObjects(collidables, true);
          const rightHits = rightRay.intersectObjects(collidables, true);

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
          try { enemiesKilled++; } catch (e) {}
          if (this.tutorialCombat && typeof directorOnTutorialRobotKilled === 'function') {
              try { directorOnTutorialRobotKilled(); } catch (e) {}
          }
          this.state = 'dead';
          this.velocity.set(0, 0, 0);
          
          // Create death effect
          this.createDeathEffect(this.mesh);
          
          // Remove from game after delay
          setTimeout(() => {
              if (this.mesh.parent) this.scene.remove(this.mesh);
              if (this.container.parent) this.scene.remove(this.container);
              
              // Remove from arrays
              const npcIndex = npcs.indexOf(this);
              if (npcIndex > -1) npcs.splice(npcIndex, 1);
              
              const collidableIndex = collidableObjects.indexOf(this.mesh);
              if (collidableIndex > -1) collidableObjects.splice(collidableIndex, 1);
          }, 1000);
      }

      createDeathEffect(enemy) {
          const particleCount = 30;
          const particles = new THREE.Group();

          const deathPos = new THREE.Vector3();
          enemy.getWorldPosition(deathPos);

          playSoundAt('explosion', deathPos, { gain: 0.9, maxDist: 60 });

          for (let i = 0; i < particleCount; i++) {
              const isBlood = Math.random() > 0.3;
              const size = isBlood ? 0.1 + Math.random() * 0.1 : 0.05 + Math.random() * 0.05;
              const color = isBlood ? 0x8A0303 : 0x00ffff;

              const mat = new THREE.MeshStandardMaterial({
                  color,
                  emissive: isBlood ? 0x000000 : color,
                  transparent: true,
                  opacity: 1.0,
                  roughness: 0.5
              });

              const particle = new THREE.Mesh(
                  new THREE.SphereGeometry(size, 8, 8),
                  mat
              );

              // Random scatter
              particle.position.copy(deathPos);
              particle.position.x += (Math.random() - 0.5) * 0.5;
              particle.position.y += (Math.random() - 0.5) * 0.5;
              particle.position.z += (Math.random() - 0.5) * 0.5;

              // Initial velocity
              particle.userData = {
                  velocity: new THREE.Vector3(
                      (Math.random() - 0.5) * 5,
                      Math.random() * 3,
                      (Math.random() - 0.5) * 5
                  ),
                  lifetime: 1.0 + Math.random()
              };

              particles.add(particle);
          }

          scene.add(particles);

          // Flash light burst
          const flash = new THREE.PointLight(0xffffff, 2, 3);
          flash.position.copy(deathPos);
          scene.add(flash);
          setTimeout(() => scene.remove(flash), 150);

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
