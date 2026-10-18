// js/06-entities.js (part 6/16). LaGrieta FPS — classic scripts share globals. LOAD ORDER MATTERS, do not reorder.
  // Hits are child meshes: walk up to test if obj belongs to character's body
  function isCharacterPart(obj, character) {
      if (!obj || !character) return false;
      let p = obj;
      while (p) {
          if (p === character.mesh || p === character.container ||
              p === character.collider || p === character.colliderBoxHelper) return true;
          p = p.parent;
      }
      return false;
  }
  class Bullet {
      constructor(startPosition, direction) {
          this.mesh = new THREE.Mesh(
              new THREE.SphereGeometry(0.05, 8, 4), // Simplified geo
              new THREE.MeshStandardMaterial({
                  color: 0xFFD700,
                  emissive: 0xFFA500,
                  emissiveIntensity: 1.5, // Brighter trail/bullet
                  metalness: 0.5,
                  roughness: 0.4
              })
          );
          this.mesh.position.copy(startPosition);
          this.mesh.isBullet = true; // Flag for collision filtering
          this.direction = direction.clone().normalize();
          this.speed = PLAYER_CONFIG.bulletSpeed;
          this.lifetime = PLAYER_CONFIG.bulletLifetime;
          this.colliderBox = new THREE.Box3().setFromObject(this.mesh);

          this.gravity = 2.0; // Reduced gravity for flatter trajectory
          this.velocity = new THREE.Vector3().copy(this.direction).multiplyScalar(this.speed);
          this.drag = 0.995; // Slightly less drag

          // Ownership: null = player bullet, 'enemy' = NPC bullet
          this.owner = null;
          this.damage = 15;
          this.structureDamage = 15;
          this.shooter = null;

          // Trail effect
          this.trail = this.createTrail();
          scene.add(this.trail);
          scene.add(this.mesh);
          bullets.push(this);
      }

      createTrail() {
          const trailGeometry = new THREE.BufferGeometry();
          const trailMaterial = new THREE.LineBasicMaterial({
              color: 0xFFA500,
              transparent: true,
              opacity: 0.6, // Slightly less opaque
              linewidth: 2 // Thicker line if supported
          });

          const positions = new Float32Array(6); // 2 points, 3 coords each
          trailGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

          const trail = new THREE.Line(trailGeometry, trailMaterial);
          trail.frustumCulled = false; // Always draw trail
          return trail;
      }

      updateTrail() {
          const positions = this.trail.geometry.attributes.position.array;
          const trailLengthFactor = 0.1; // How far back the trail extends

          // End point (current position)
          positions[0] = this.mesh.position.x;
          positions[1] = this.mesh.position.y;
          positions[2] = this.mesh.position.z;

          // Start point (slightly behind based on velocity)
          positions[3] = this.mesh.position.x - this.velocity.x * trailLengthFactor;
          positions[4] = this.mesh.position.y - this.velocity.y * trailLengthFactor;
          positions[5] = this.mesh.position.z - this.velocity.z * trailLengthFactor;

          this.trail.geometry.attributes.position.needsUpdate = true;
          this.trail.geometry.computeBoundingSphere(); // Update bounding sphere for frustum culling (though disabled)
      }

      update(delta, collidables) {
          if (isGamePaused) return;

          const previousPosition = this.mesh.position.clone();

          // Apply gravity
          this.velocity.y -= this.gravity * delta;

          // Apply air resistance (drag)
          this.velocity.multiplyScalar(Math.pow(this.drag, delta * 60)); // Frame-rate independent drag

          // Update position
          this.mesh.position.add(this.velocity.clone().multiplyScalar(delta));
          this.updateTrail();

          this.lifetime -= delta;
          if (this.lifetime <= 0) {
              this.createFadeEffect();
              this.destroy();
              return;
          }

          // --- Collision Check using Raycasting (more accurate for fast bullets) ---
          const moveDistance = previousPosition.distanceTo(this.mesh.position);
          if (moveDistance < 0.01) return; // Skip check if not moved significantly

          const rayDirection = this.velocity.clone().normalize();
          const bulletRay = new THREE.Raycaster(previousPosition, rayDirection, 0, moveDistance);

          const isEnemyBullet = this.owner === 'enemy';
          const objectsToCheck = collidables.filter(obj => {
              if (!obj.visible || obj === groundMesh || obj.isBullet || obj.isSprite) return false;
              if (isEnemyBullet) {
                  // Enemy bullets: never hit the shooter itself
                  return obj !== this.shooter?.collider && obj !== this.shooter?.mesh &&
                         obj !== this.shooter?.colliderBoxHelper;
              }
              // Player bullets: never hit the player
              return obj !== player?.collider && obj !== player?.colliderBoxHelper && obj !== player?.mesh;
          });
          if (isEnemyBullet) {
              // Enemy bullets can hit the player (no friendly fire on NPCs)
              if (player?.collider && !objectsToCheck.includes(player.collider)) objectsToCheck.push(player.collider);
              if (player?.mesh && !objectsToCheck.includes(player.mesh)) objectsToCheck.push(player.mesh);
          } else {
              // Player bullets can hit NPCs' visual meshes
              objectsToCheck.push(...npcs.map(npc => npc.mesh).filter(mesh => mesh));
          }
          objectsToCheck.push(...placedBlocks);

          const hits = bulletRay.intersectObjects(objectsToCheck, true); // Recursive check

          if (hits.length > 0) {
              for (const hit of hits) {
                  // Hits are sorted by distance; stop past this frame's travel
                  if (hit.distance > moveDistance + 0.1) break; // Add small tolerance
                  // Skip the shooter's own body parts (enemy bullets)
                  if (this.owner === 'enemy' && this.shooter && isCharacterPart(hit.object, this.shooter)) continue;
                  this.handleHit(hit.object, hit.point);
                  this.destroy();
                  return;
              }
          }

          // Update collider box (less critical if using raycasting)
          // this.colliderBox.setFromObject(this.mesh);
      }

      handleHit(hitObject, hitPosition) {
           console.log("Bullet hit:", hitObject.name, hitObject);

           // Hits are usually child meshes of a group: walk up to find whose body this is
           let hitNPC = null;
           let hitPlayer = false;
           let anc = hitObject;
           while (anc) {
               if (anc.userData && anc.userData.parentCharacter instanceof NPC) { hitNPC = anc.userData.parentCharacter; break; }
               if (typeof player !== 'undefined' && player &&
                   (anc === player.collider || anc === player.container || anc === player.mesh)) { hitPlayer = true; break; }
               anc = anc.parent;
           }

           if (this.owner === 'enemy') {
               if (hitNPC && this.shooter && hitNPC === this.shooter) return; // own body: ignore
               if (hitPlayer) {
                   this.hitPlayer(hitPosition);
                   return;
               }
               if (hitNPC) { // no friendly fire: spark only
                   this.createImpactEffect(hitObject, hitPosition);
                   return;
               }
           } else {
               if (hitNPC) {
                   this.hitNpc(hitNPC, hitPosition);
                   return;
               }
               if (hitPlayer) {
                   console.log("Bullet hit player (shouldn't happen)");
                   return;
               }
           }
           // Mesa de trabajo: la base también recibe daño
           {
               let bw = hitObject;
               while (bw) {
                   if (bw.userData && bw.userData.benchRef && bw.userData.benchRef.hp > 0) {
                       damageWorkbench(bw.userData.benchRef, this.structureDamage || this.damage || 15);
                       this.createImpactEffect(hitObject, hitPosition);
                       return;
                   }
                   bw = bw.parent;
               }
           }
           // Check if hit a placed block
           if (placedBlocks.includes(hitObject) && hitObject.userData) {
              this.hitBlock(hitObject, hitPosition);
              return;
           }
           // Default impact effect for walls, ground, other objects
           this.createImpactEffect(hitObject, hitPosition);
           return;
      }

      hitPlayer(hitPosition) {
          if (!player || player.health <= 0) return;
          player.health -= (this.damage || 8);
          try {
              player.applyDamageEffect();
              player.updateStatsHUD();
          } catch (e) {}
          try { playSound('damage-taken'); } catch (e) {}
          this.createBloodEffect(hitPosition);
          if (player.health <= 0) {
              showGameOver();
          }
      }

      hitNpc(npc, hitPosition) {
          if (!npc || npc.health <= 0) return;

          const damage = 15; // Base bullet damage
          npc.takeDamage(damage); // This should call the NPC's takeDamage method
          
          // Create blood effect
          this.createBloodEffect(hitPosition);
          
          // Visual feedback on mesh
          if (npc.mesh && npc.mesh.material) {
              const originalColor = npc.mesh.material.color.clone();
              npc.mesh.material.color.setHex(0xff0000); // Flash red
              
              setTimeout(() => {
                  if (npc.mesh && npc.mesh.material) {
                      npc.mesh.material.color.copy(originalColor);
                  }
              }, 100);
          }
          
          // Check if NPC died
          if (npc.health <= 0) {
              npc.die();
          }
      }

      hitBlock(block, hitPosition) {
          if (!block || !block.userData || !block.parent) return;

          const blockType = block.userData.type;
          const blockInfo = BLOCK_MATERIALS[blockType];
          
          if (!blockInfo) return;

          // Calculate damage based on bullet power and block resistance
          const damage = (this.owner === 'enemy')
              ? Math.max(3, this.structureDamage || 25)
              : Math.max(1, 5 - blockInfo.resistance); // Base 5 damage minus resistance
          
          // Initialize health if not set
          if (block.userData.health === undefined) {
              block.userData.health = blockInfo.health;
              block.userData.maxHealth = blockInfo.health;
          }

          block.userData.health -= damage;

          // Visual effects
          this.createBlockHitEffect(block, hitPosition);
          updateBlockAppearance(block); // Now this function exists

          if (block.userData.health <= 0) {
              destroyBlock(block);
          }
      }

      createImpactEffect(hitObject, hitPosition) {
          // Impact particles (Sparks/Dust)
          const particleCount = 10;
          const particles = new THREE.Group();
          const particleGeo = new THREE.BoxGeometry(0.03, 0.03, 0.03); // Tiny boxes
          const particleMat = new THREE.MeshStandardMaterial({
              color: 0xaaaaaa,
              emissive: 0x555555,
              metalness: 0.2,
              roughness: 0.8
          });

          for (let i = 0; i < particleCount; i++) {
              const particle = new THREE.Mesh(particleGeo, particleMat.clone()); // Clone mat
              const power = 0.5 + Math.random() * 1.0;
              particle.userData.velocity = new THREE.Vector3(
                  (Math.random() - 0.5) * power,
                  (Math.random() - 0.5) * power,
                  (Math.random() - 0.5) * power
              );
              particle.position.copy(hitPosition).add(particle.userData.velocity.clone().normalize().multiplyScalar(0.01)); // Start slightly offset
              particle.userData.lifetime = 0.3 + Math.random() * 0.4;
              particles.add(particle);
          }
          scene.add(particles);

          // Animate particles
          const animateParticles = () => {
              let allDead = true;
              const delta = 0.016;
              particles.children.forEach(p => {
                  if (p.userData.lifetime > 0) {
                      allDead = false;
                      p.userData.lifetime -= delta;
                      p.position.add(p.userData.velocity.clone().multiplyScalar(delta));
                      p.userData.velocity.y -= 3.0 * delta; // Gravity on particles
                      p.material.opacity = p.userData.lifetime * 3;
                      p.material.needsUpdate = true;
                  } else {
                       p.visible = false; // Hide dead particles
                  }
              });
              if (allDead) {
                  scene.remove(particles); // Clean up group
              } else {
                  requestAnimationFrame(animateParticles);
              }
          };
          animateParticles();
          // Optional: Add impact decal
          this.createImpactDecal(hitObject, hitPosition);
      }

      createImpactDecal(hitObject, position) {
          // Only create decals on certain objects
          if (!hitObject.material || hitObject.userData?.parentCharacter instanceof NPC) return;
          
          const decalSize = new THREE.Vector3(0.2, 0.2, 0.2);
          const decalMaterial = new THREE.MeshStandardMaterial({
              color: 0x333333,
              roughness: 0.7,
              metalness: 0.5,
              polygonOffset: true,
              polygonOffsetFactor: -1
          });
          
          // Calculate normal (simplified - would be better to use actual face normal)
          const normal = new THREE.Vector3().subVectors(position, hitObject.position).normalize();
          
          const decal = new THREE.Mesh(
              new THREE.CylinderGeometry(0.05, 0.05, 0.02, 8),
              decalMaterial
          );
          
          // Position and orient the decal
          decal.position.copy(position);
          decal.lookAt(position.clone().add(normal));
          decal.rotateX(Math.PI / 2); // Orient properly
          
          // Make decal face the surface
          decal.position.add(normal.clone().multiplyScalar(0.01));
          
          scene.add(decal);
          
          // Fade out after some time
          setTimeout(() => {
              let opacity = 1;
              const fadeInterval = setInterval(() => {
                  opacity -= 0.05;
                  decal.material.opacity = opacity;
                  if (opacity <= 0) {
                      clearInterval(fadeInterval);
                      scene.remove(decal);
                  }
              }, 100);
          }, 3000);
      }

      createFadeEffect() {
        // Create a small explosion when bullet times out
        const explosion = new THREE.Mesh(
            new THREE.SphereGeometry(0.1, 8, 8),
            new THREE.MeshBasicMaterial({
                color: 0xFF4500,
                transparent: true,
                opacity: 0.8
            })
        );
        explosion.position.copy(this.mesh.position);
        scene.add(explosion);
        
        // Animate explosion
        let scale = 1;
        const animateExplosion = () => {
            scale += 0.2;
            explosion.scale.setScalar(scale);
            explosion.material.opacity -= 0.05;
            
            if (explosion.material.opacity <= 0) {
                scene.remove(explosion);
                return;
            }
            requestAnimationFrame(animateExplosion);
        };
        animateExplosion();
      }
      createBloodEffect(hitPosition) { 
            const bloodCount = 12;
            const bloodParticles = new THREE.Group();
            const bloodGeo = new THREE.SphereGeometry(0.04, 4, 4);
            const bloodMat = new THREE.MeshStandardMaterial({
                color: 0x8A0303, // Dark red
                roughness: 0.8
            });

            for (let i = 0; i < bloodCount; i++) {
                const particle = new THREE.Mesh(bloodGeo, bloodMat.clone());
                const power = 0.2 + Math.random() * 0.4;
                particle.userData.velocity = new THREE.Vector3(
                    (Math.random() - 0.5) * power,
                    (Math.random() * 0.6) * power, // Mostly upwards/outwards
                    (Math.random() - 0.5) * power
                );
                particle.position.copy(hitPosition).add(particle.userData.velocity.clone().normalize().multiplyScalar(0.02)); // Start slightly offset
                particle.userData.lifetime = 0.6 + Math.random() * 0.6;
                bloodParticles.add(particle);
            }
            scene.add(bloodParticles);

            // Animate blood
            const animateBlood = () => {
                let allDead = true;
                const delta = 0.016;
                bloodParticles.children.forEach(p => {
                     if (p.userData.lifetime > 0) {
                         allDead = false;
                         p.userData.lifetime -= delta;
                         p.position.add(p.userData.velocity.clone().multiplyScalar(delta));
                         p.userData.velocity.y -= 5.0 * delta; // Gravity
                         p.material.opacity = p.userData.lifetime * 1.5;
                         p.material.needsUpdate = true;
                     } else {
                         p.visible = false;
                     }
                });
                if (allDead) {
                    scene.remove(bloodParticles);
                } else {
                    requestAnimationFrame(animateBlood);
                }
            };
            animateBlood();
      }

      createBlockHitEffect(block, hitPosition) {
          const particleCount = 8 + Math.floor(Math.random() * 4);
          const particles = new THREE.Group();
          const matInfo = BLOCK_MATERIALS[block.userData.type];
          
          for (let i = 0; i < particleCount; i++) {
              const size = 0.05 + Math.random() * 0.1;
              const particle = new THREE.Mesh(
                  new THREE.BoxGeometry(size, size, size),
                  new THREE.MeshStandardMaterial({
                      color: matInfo.material.color.clone(),
                      roughness: matInfo.material.roughness,
                      metalness: matInfo.material.metalness
                  })
              );
              
              particle.position.copy(hitPosition);
              particle.position.add(new THREE.Vector3(
                  (Math.random() - 0.5) * 0.3,
                  (Math.random() - 0.5) * 0.3,
                  (Math.random() - 0.5) * 0.3
              ));
              
              particle.userData = {
                  velocity: new THREE.Vector3(
                      (Math.random() - 0.5) * 2,
                      Math.random() * 1.5,
                      (Math.random() - 0.5) * 2
                  ),
                  lifetime: 0.5 + Math.random() * 0.7
              };
              
              particles.add(particle);
          }
          
          scene.add(particles);
          
          // Animation loop
          const animateParticles = () => {
              let allDead = true;
              const delta = 0.016;
              
              particles.children.forEach(p => {
                  if (p.userData.lifetime > 0) {
                      allDead = false;
                      p.userData.lifetime -= delta;
                      p.position.add(p.userData.velocity.clone().multiplyScalar(delta));
                      p.userData.velocity.y -= 2.5 * delta; // Gravity
                      p.material.opacity = p.userData.lifetime * 2;
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

      destroy() {
          if (this.trail && this.trail.parent) {
              scene.remove(this.trail);
          }
          if (this.mesh && this.mesh.parent) {
              scene.remove(this.mesh);
          }

          const index = bullets.indexOf(this);
          if (index > -1) {
              bullets.splice(index, 1);
          }
      }
  }
  class ResourceNode {
    constructor(type, position, capacity) {
      this.type = type;
      this.capacity = capacity;
      this.mesh = this.createMesh(type);
      this.mesh.position.copy(position);
      this.mesh.isResourceNode = true;
    }

    createMesh(type) {
      const geometries = {
        wood: new THREE.CylinderGeometry(1, 1, 2, 8),
        stone: new THREE.BoxGeometry(1.5, 1.5, 1.5),
        metal: new THREE.OctahedronGeometry(1)
      };
      
      const materials = {
        wood: new THREE.MeshStandardMaterial({ color: 0x8B4513 }),
        stone: new THREE.MeshStandardMaterial({ color: 0x808080 }),
        metal: new THREE.MeshStandardMaterial({ color: 0xC0C0C0 })
      };

      const mesh = new THREE.Mesh(geometries[type], materials[type]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    }

    harvest(amount) {
      this.capacity -= amount;
      if(this.capacity <= 0) {
        this.mesh.visible = false;
        setTimeout(() => {
          this.mesh.visible = true;
          this.capacity = 100; // Respawn after 30 seconds
        }, 30000);
      }
      return Math.min(amount, this.capacity + amount);
    }
  }
  class GroundTerrain {
    constructor(scene, collidableObjects, options = {}) {
      this.scene = scene;
      this.collidableObjects = collidableObjects;
      this.options = {
        size: 200,
        color: 0x558855,
        roughness: 0.95,
        metalness: 0.05,
        debug: false,
        ...options
      };

      this.mesh = this.createVisualMesh();
      this.collider = this.createCollider();
      this.mesh.userData.isGround = true; // Mark both as ground
      this.collider.userData.isGround = true;

      this.debugHelpers = [];

      this.init();
    }

    init() {
      // Create visual ground mesh
      this.mesh = this.createVisualMesh();
      
      // Create collision representation
      this.collider = this.createCollider();
      
      // Set up physics properties
      this.configurePhysics();
      
      // Add to scene and collision system
      this.addToScene();
    }

    createVisualMesh() {
      const geometry = new THREE.BoxGeometry(this.options.size, 0.25, this.options.size);
      const material = new THREE.MeshStandardMaterial({
        color: this.options.color,
        roughness: this.options.roughness,
        metalness: this.options.metalness
      });

      const mesh = new THREE.Mesh(geometry, material);
      //mesh.rotation.x = -Math.PI / 2;
      mesh.receiveShadow = true;
      mesh.name = "GroundVisual";
      mesh.position.y = 0;

      return mesh;
    }

    createCollider() {
      // Create separate collision geometry (slightly thicker)
      const colliderGeometry = new THREE.BoxGeometry(
        this.options.size * 1.02, // Slightly larger than visual
        0.25,
        this.options.size * 1.02
      );      
      const colliderMat = new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          depthWrite: false // Prevents interfering with depth buffer
      });
      const collider = new THREE.Mesh(colliderGeometry, colliderMat);
      collider.visible = true; // Essential for raycast detection

      //collider.rotation.x = -Math.PI / 2;
      collider.position.y = 0.02; // Elevate slightly above visual mesh
      collider.name = "GroundCollider";

      // Configure collision data
      collider.userData = {
        isGround: true,
        allowBuildingOnTop: true,
        isStatic: true,
        friction: 0.8,
        restitution: 0.1,
        worldBoundingBox: new THREE.Box3(
          new THREE.Vector3(-this.options.size/2, -0.02, -this.options.size/2),
          new THREE.Vector3(this.options.size/2, 0.02, this.options.size/2)
        )
      };

      // Calculate initial bounds
      collider.geometry.computeBoundingBox();
      collider.position.y = 0; // Align exactly with ground plane

      return collider;
    }

    configurePhysics() {
      // Force matrix updates for accurate collisions
      this.mesh.updateMatrixWorld(true);
      this.collider.updateMatrixWorld(true);
      
      // Calculate precise bounding box
      this.collider.geometry.computeBoundingBox();
      this.collider.userData.worldBoundingBox.setFromObject(this.collider);
    }

    addToScene() {
      this.scene.add(this.mesh);
      this.scene.add(this.collider);
      this.collidableObjects.push(this.collider);
    }

    update() {
      // For dynamic terrain modifications
      this.configurePhysics();
    }

    dispose() {
      this.scene.remove(this.mesh);
      this.scene.remove(this.collider);
      this.debugHelpers.forEach(helper => this.scene.remove(helper));
      
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.collider.geometry.dispose();
    }
  }
