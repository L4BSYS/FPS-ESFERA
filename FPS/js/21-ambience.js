// js/21-ambience.js. LaGrieta FPS — surreal skies, light/dark cycles.
// Classic scripts share globals. Load before 16-boot.js.

let AMB = null;

const AMBIENCE_PRESETS = {
  day:   { skyTop: 0x2f6fb0, skyBottom: 0xbfe0ff, fog: 0xbfd8e8, ambientColor: 0xffffff, ambient: 0.62, sunColor: 0xfff2d0, sun: 1.35, exposure: 1.00, stars: 0.00, sunSize: 7.0, fogNear: 70, fogFar: 260, sunAngle: 0.95 },
  dawn:  { skyTop: 0x2a2a6a, skyBottom: 0xffc0a0, fog: 0x9a90b0, ambientColor: 0xffd0c0, ambient: 0.45, sunColor: 0xffd090, sun: 0.90, exposure: 1.02, stars: 0.20, sunSize: 8.0, fogNear: 60, fogFar: 230, sunAngle: 1.30 },
  dusk:  { skyTop: 0x1a1740, skyBottom: 0xff6a3a, fog: 0x7a4a55, ambientColor: 0xffb090, ambient: 0.38, sunColor: 0xff8a40, sun: 0.75, exposure: 1.05, stars: 0.25, sunSize: 9.0, fogNear: 50, fogFar: 200, sunAngle: 2.35 },
  night: { skyTop: 0x03040c, skyBottom: 0x101a33, fog: 0x070b18, ambientColor: 0x5a70b0, ambient: 0.10, sunColor: 0x3a4a8a, sun: 0.06, exposure: 1.15, stars: 1.00, sunSize: 5.0, fogNear: 30, fogFar: 140, sunAngle: 4.00 },
  blood: { skyTop: 0x1a0202, skyBottom: 0x8a1608, fog: 0x2a0705, ambientColor: 0xff6a4a, ambient: 0.22, sunColor: 0xff3010, sun: 0.45, exposure: 1.12, stars: 0.15, sunSize: 10.0, fogNear: 40, fogFar: 170, sunAngle: 2.70 },
  void:  { skyTop: 0x05030f, skyBottom: 0x3a1a6a, fog: 0x120a24, ambientColor: 0x9a70ff, ambient: 0.20, sunColor: 0xb070ff, sun: 0.35, exposure: 1.20, stars: 0.80, sunSize: 12.0, fogNear: 35, fogFar: 160, sunAngle: 3.40 }
};

const AMBIENCE_CYCLE = [
  { t: 0.00, p: 'night' },
  { t: 0.16, p: 'dawn' },
  { t: 0.30, p: 'day' },
  { t: 0.56, p: 'day' },
  { t: 0.70, p: 'dusk' },
  { t: 0.84, p: 'night' },
  { t: 1.00, p: 'night' }
];

const AMB_KEYS = ['ambient', 'sun', 'exposure', 'stars', 'sunSize', 'fogNear', 'fogFar', 'sunAngle'];
const AMB_COLOR_KEYS = ['skyTop', 'skyBottom', 'fog', 'ambientColor', 'sunColor'];

function ambPreset(name) {
  return Object.assign({}, AMBIENCE_PRESETS[name] || AMBIENCE_PRESETS.day);
}

function ambColorLerp(a, b, k) {
  return new THREE.Color(a).lerp(new THREE.Color(b), k);
}

function ambSpecLerp(a, b, k) {
  const out = {};
  AMB_COLOR_KEYS.forEach(function (key) { out[key] = ambColorLerp(a[key], b[key], k); });
  AMB_KEYS.forEach(function (key) { out[key] = (a[key] || 0) + ((b[key] || 0) - (a[key] || 0)) * k; });
  return out;
}

function ambCycleSpecAt(t) {
  t = ((t % 1) + 1) % 1;
  let a = AMBIENCE_CYCLE[0], b = AMBIENCE_CYCLE[AMBIENCE_CYCLE.length - 1];
  for (let i = 0; i < AMBIENCE_CYCLE.length - 1; i++) {
    if (t >= AMBIENCE_CYCLE[i].t && t <= AMBIENCE_CYCLE[i + 1].t) { a = AMBIENCE_CYCLE[i]; b = AMBIENCE_CYCLE[i + 1]; break; }
  }
  const span = (b.t - a.t) || 1;
  return ambSpecLerp(ambPreset(a.p), ambPreset(b.p), (t - a.t) / span);
}

function initAmbience() {
  if (AMB && AMB.sky) return AMB;
  if (typeof scene === 'undefined' || !scene) return null;

  AMB = {
    sky: null, stars: null, sunMesh: null,
    lights: { ambient: null, sun: null },
    base: ambPreset('day'),
    baseName: 'day',
    cycle: false,
    cycleStarted: false,
    time: 0.32,
    speed: 1 / 200,
    name: 'day',
    current: null
  };

  // --- Gradient sky dome ---
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x2f6fb0) },
      bottomColor: { value: new THREE.Color(0xbfe0ff) }
    },
    vertexShader: [
      'varying vec3 vWorldPosition;',
      'void main() {',
      '  vec4 wp = modelMatrix * vec4(position, 1.0);',
      '  vWorldPosition = wp.xyz;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 topColor;',
      'uniform vec3 bottomColor;',
      'varying vec3 vWorldPosition;',
      'void main() {',
      '  float h = normalize(vWorldPosition).y;',
      '  float k = pow(clamp(h * 0.5 + 0.5, 0.0, 1.0), 1.25);',
      '  gl_FragColor = vec4(mix(bottomColor, topColor, k), 1.0);',
      '}'
    ].join('\n')
  });
  AMB.sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), skyMat);
  AMB.sky.name = 'AmbienceSky';
  AMB.sky.frustumCulled = false;
  AMB.sky.renderOrder = -20;
  scene.add(AMB.sky);

  // --- Stars ---
  const starGeo = new THREE.BufferGeometry();
  const N = 900;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const u = Math.random() * Math.PI * 2;
    const v = Math.random() * 0.9 + 0.02; // upper hemisphere-ish
    const r = 520;
    const y = Math.sin(v * Math.PI * 0.5);
    const horiz = Math.cos(v * Math.PI * 0.5);
    pos[i * 3] = Math.cos(u) * horiz * r;
    pos[i * 3 + 1] = y * r;
    pos[i * 3 + 2] = Math.sin(u) * horiz * r;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, transparent: true, opacity: 0, depthWrite: false, fog: false });
  AMB.stars = new THREE.Points(starGeo, starMat);
  AMB.stars.name = 'AmbienceStars';
  AMB.stars.frustumCulled = false;
  AMB.stars.renderOrder = -19;
  scene.add(AMB.stars);

  // --- Sun / moon disc ---
  const sunMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, fog: false });
  AMB.sunMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), sunMat);
  AMB.sunMesh.name = 'AmbienceSun';
  AMB.sunMesh.frustumCulled = false;
  AMB.sunMesh.renderOrder = -18;
  scene.add(AMB.sunMesh);

  // --- Capture existing lights ---
  AMB.lights.ambient = (scene.userData && scene.userData.ambientLight) || scene.children.find(function (o) { return o.isAmbientLight; }) || null;
  AMB.lights.sun = (scene.userData && scene.userData.sunLight) || scene.children.find(function (o) { return o.isDirectionalLight; }) || null;

  AMB.current = {
    skyTop: new THREE.Color(AMB.base.skyTop),
    skyBottom: new THREE.Color(AMB.base.skyBottom),
    fog: new THREE.Color(AMB.base.fog),
    ambientColor: new THREE.Color(AMB.base.ambientColor),
    sunColor: new THREE.Color(AMB.base.sunColor),
    ambient: AMB.base.ambient,
    sun: AMB.base.sun,
    exposure: AMB.base.exposure,
    stars: AMB.base.stars,
    sunSize: AMB.base.sunSize,
    fogNear: AMB.base.fogNear,
    fogFar: AMB.base.fogFar,
    sunAngle: AMB.base.sunAngle
  };

  applyAmbienceNow();
  return AMB;
}

function setAmbience(nameOrSpec) {
  const amb = initAmbience();
  if (!amb) return;
  let spec = nameOrSpec;
  if (typeof spec === 'string') {
    spec = (spec === 'cycle') ? { cycle: true } : { preset: spec };
  }
  spec = spec || {};
  if (spec.preset === 'cycle') { spec = Object.assign({}, spec, { cycle: true }); delete spec.preset; }

  amb.cycle = !!spec.cycle;
  amb.baseName = spec.preset || 'day';
  amb.base = ambPreset(amb.baseName);
  AMB_KEYS.concat(AMB_COLOR_KEYS).forEach(function (key) {
    if (key in spec) amb.base[key] = spec[key];
  });
  amb.speed = spec.speed || (1 / 200);
  if (amb.cycle) {
    if (!amb.cycleStarted) { amb.time = 0.32; amb.cycleStarted = true; }
    amb.name = 'cycle';
  } else {
    amb.cycleStarted = false;
    amb.name = amb.baseName;
  }
}

// Llamado por loadLevel al terminar de construir el mundo.
function applyLevelAmbience(def) {
  let env = def && def.env;
  if (!env) env = 'cycle';
  setAmbience(env);
}

function applyAmbienceNow() {
  if (!AMB || !AMB.current) return;
  const c = AMB.current;
  const sky = AMB.sky && AMB.sky.material && AMB.sky.material.uniforms;
  if (sky) {
    sky.topColor.value.copy(c.skyTop);
    sky.bottomColor.value.copy(c.skyBottom);
  }
  if (scene.fog) {
    scene.fog.color.copy(c.fog);
    scene.fog.near = c.fogNear;
    scene.fog.far = c.fogFar;
  }
  if (scene.background && scene.background.isColor) scene.background.copy(c.fog);
  if (AMB.stars) AMB.stars.material.opacity = c.stars;
  if (AMB.lights.ambient) {
    AMB.lights.ambient.color.copy(c.ambientColor);
    AMB.lights.ambient.intensity = c.ambient;
  }
  if (AMB.lights.sun) {
    AMB.lights.sun.color.copy(c.sunColor);
    AMB.lights.sun.intensity = c.sun;
    const elevation = Math.max(0.16, Math.sin(c.sunAngle));
    const dir = new THREE.Vector3(Math.cos(c.sunAngle), elevation, 0.42).normalize();
    AMB.lights.sun.position.copy(dir.clone().multiplyScalar(130));
    if (AMB.lights.sun.target) AMB.lights.sun.target.position.set(0, 0, 0);
    if (AMB.sunMesh) {
      AMB.sunMesh.position.copy(dir.clone().multiplyScalar(450));
      AMB.sunMesh.scale.setScalar(c.sunSize);
      AMB.sunMesh.material.color.copy(c.sunColor);
      AMB.sunMesh.material.opacity = c.sun > 0.12 ? 0.95 : 0.55;
    }
  }
  if (typeof renderer !== 'undefined' && renderer) renderer.toneMappingExposure = c.exposure;
}

function updateAmbience(delta) {
  const amb = initAmbience();
  if (!amb || !amb.current) return;
  if (amb.cycle) {
    amb.time = (amb.time + amb.speed * delta) % 1;
  }
  const target = amb.cycle ? ambCycleSpecAt(amb.time) : (function () {
    const out = {};
    AMB_COLOR_KEYS.forEach(function (key) { out[key] = new THREE.Color(amb.base[key]); });
    AMB_KEYS.forEach(function (key) { out[key] = amb.base[key]; });
    return out;
  })();

  const c = amb.current;
  const k = 1 - Math.exp(-delta * 2.2);
  AMB_COLOR_KEYS.forEach(function (key) { c[key].lerp(target[key], k); });
  AMB_KEYS.forEach(function (key) { c[key] += (target[key] - c[key]) * k; });
  applyAmbienceNow();
}
