import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { Traveler } from './traveler.js';

const UP_VEC = new THREE.Vector3(0, 1, 0);

// calques de bloom sélectif
const BLOOM_CHAR = 1;   // personnage + sphères lumineuses
const BLOOM_PATH = 2;   // chemin

// easing
const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);

// ============================================================
//  Renderer / Scene / Camera
// ============================================================
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

// environnement neutre -> reflets pour les sphères métallisées
const _pmrem = new THREE.PMREMGenerator(renderer);
const sceneEnv = _pmrem.fromScene(new RoomEnvironment(), 0.04);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a1330, 0.010);
scene.environment = sceneEnv.texture;

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 500);
camera.position.set(0, 6, 56);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.enabled = false;

// ---- Lumières ----
scene.add(new THREE.HemisphereLight(0x4a6bb0, 0x05102a, 0.7));
const keyLight = new THREE.DirectionalLight(0xbcd2ff, 1.1);
keyLight.position.set(-30, 40, 10);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far = 90;
keyLight.shadow.camera.left = -22;
keyLight.shadow.camera.right = 22;
keyLight.shadow.camera.top = 22;
keyLight.shadow.camera.bottom = -22;
keyLight.shadow.bias = -0.0005;
scene.add(keyLight);
scene.add(keyLight.target); // la lumière + sa cible suivent le personnage (ombre nette)

// ============================================================
//  Paramètres (pilotés par le GUI)
// ============================================================
const params = {
  // --- Chemin ---
  pathLength:   600,   // longueur totale (axe Z)
  pathTurns:    5,     // nombre de virages latéraux
  pathLateral:  5,     // amplitude latérale (X)
  pathHills:    2,     // nombre de montées/descentes
  pathElevation: 5,    // amplitude verticale (Y)
  regenerate:   () => rebuildPath(),

  // --- Personnage : attitude ---
  startSpeed:  0.01,   // vitesse de départ
  maxSpeed:    0.08,   // vitesse maximale
  accel:       0.05,   // accélération (par seconde)
  floatHeight: 1.8,    // hauteur de flottement au-dessus du chemin
  bob:         0.7,    // amplitude du flottement vertical
  sway:        0.4,    // amplitude du balancement latéral
  filaments:   5,      // nombre de fils
  amplitude:   1.4,    // amplitude du sillage
  waveSpeed:   1.0,    // vitesse d'ondulation
  phase:       2.05,   // étalement des phases entre brins
  pulseAmp:    0.7,    // turbulence (récup.) : amplitude
  pulseDur:    0.5,    // turbulence : durée/vitesse (plus grand = plus lent)
  pulseWidth:  0.3,    // turbulence : largeur du renflement
  growDur:     3.0,    // durée d'apparition d'une nouvelle ligne (s)

  // --- Personnage : placement (décalage par rapport au chemin) ---
  offsetX:     0.0,
  offsetY:     0.0,
  offsetZ:     7.0,

  // --- Personnage : visuel ---
  color:     '#ffc83d',
  thickness: 0.05,     // épaisseur de départ des filaments (unités monde)
  thicknessMax: 0.17,  // épaisseur atteinte quand toutes les sphères sont récupérées
  emission:  1.0,      // intensité d'émission des filaments
  emissionBoost: 0.6,  // surplus d'émission quand le perso mange une sphère
  glowChar:   0.3,     // force du bloom du personnage
  glowCharRadius: 0.2,
  exposure:  0.85,

  // --- Sphères flottantes le long du chemin ---
  sphCount:      14,
  sphSize:       0.25,
  sphSpread:     1.5,   // distance latérale au chemin
  sphElevation:  2.0,   // hauteur au-dessus du chemin
  sphBreathAmp:  0.5,   // amplitude de la respiration (échelle)
  sphBreathSpeed: 0.75, // vitesse de respiration
  sphFloatAmp:   0.3,   // amplitude de la flottaison (Y)
  sphFloatSpeed: 0.8,   // vitesse de la flottaison
  sphMode:       'émissif',          // 'émissif' | 'métallisé' | 'specular'
  // 3 couleurs émissives
  emColor1: '#c99e54', emColor2: '#a82d00', emColor3: '#285af0',
  sphEmissive: 1.75,
  // 3 couleurs métallisées
  metColor1: '#feca62', metColor2: '#a60707', metColor3: '#feca62',
  sphMetalness: 0.78, sphRoughness: 0.46,
  // glow & transparence (essais "bulles")
  sphGlow:        1.0,  // multiplicateur d'émission (glow)
  sphOpacity:     1.0,  // opacité
  sphTransmission: 0.0, // transmission (verre/bulle)
  sphPhysThickness: 0.5,// épaisseur (réfraction)

  // --- Chemin : texture lumineuse ---
  pathWidth:        2.8,        // largeur du ruban (géométrie)
  pathSpread:       0.65,       // étendue de la lumière vers le centre (0 = fins bords, 1 = jusqu'au centre)
  pathColor:        '#e9c30d',  // couleur des bords lumineux
  pathEmission:     0.35,       // intensité d'émission
  pathFlow:         2.0,        // vitesse du flux lumineux
  pathCenterColor:  '#6b4423',  // couleur du centre
  pathCenterOpacity: 0.25,      // opacité du centre
  glowPath:         0.5,        // force du bloom du chemin
  glowPathRadius:   0.6,
};

// état de progression (déclaré tôt : utilisé par primeCharacter au chargement)
let pathT = 0;
let runTime = 0;
let snapCam = false;
let emissionBoostT = 0;   // temps restant du boost d'émission (récupération)
const EMISSION_BOOST_DUR = 0.3;

// ============================================================
//  Ciel dégradé
// ============================================================
{
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      top:    { value: new THREE.Color(0x07112e) },
      bottom: { value: new THREE.Color(0x21346e) },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 bottom;
      void main(){ float h = clamp(vP.y/300.0*0.5+0.45,0.0,1.0); gl_FragColor = vec4(mix(bottom,top,h),1.0);} `,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(300, 32, 32), skyMat));
}

// ============================================================
//  Matériau du terrain : bleu uni (#064384)
// ============================================================
function makeTerrainMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0x064384, roughness: 0.95, metalness: 0.0 });
}

// ============================================================
//  Monde : sol (UN seul morceau, plat sous le chemin) + montagne au fond.
//  Dimensionné selon la longueur du chemin pour rester cohérent.
// ============================================================
const PATH_START_Z = 50;
let worldMeshes = [];

function buildWorld(p) {
  for (const m of worldMeshes) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
  worldMeshes = [];

  const endZ = PATH_START_Z - p.pathLength;     // fin du chemin
  const depth = p.pathLength + 140;             // marge avant/après
  const centerZ = (PATH_START_Z + endZ) / 2;

  // --- Sol ---
  const segZ = Math.max(120, Math.round(depth / 2));
  const geo = new THREE.PlaneGeometry(180, depth, 90, segZ);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const flatHalf = 15;                 // bande plate centrale (sous le chemin)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const dist = Math.abs(x);
    let y = 0;
    if (dist > flatHalf) {
      const d = (dist - flatHalf) / (90 - flatHalf);
      y = Math.pow(d, 1.7) * 32;
      y += Math.sin((z + centerZ) * 0.10) * 2.0 * d;
      y += Math.cos(x * 0.18) * 1.2 * d;
    }
    pos.setY(i, y);
  }
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, makeTerrainMaterial());
  ground.position.set(0, 0, centerZ);
  ground.receiveShadow = true;
  scene.add(ground);
  worldMeshes.push(ground);

  // --- Montagne, juste au-delà de la fin du chemin ---
  const mGeo = new THREE.ConeGeometry(46, 58, 64, 24, true);
  const mPos = mGeo.attributes.position;
  for (let i = 0; i < mPos.count; i++) {
    const px = mPos.getX(i), py = mPos.getY(i), pz = mPos.getZ(i);
    const f = (py + 29) / 58;
    const n = Math.sin(px * 0.4) * Math.cos(pz * 0.4) * (1 - f) * 4.0;
    mPos.setX(i, px + n); mPos.setZ(i, pz + n * 0.6);
  }
  mGeo.computeVertexNormals();
  const mtn = new THREE.Mesh(mGeo, makeTerrainMaterial());
  mtn.position.set(0, 18, endZ - 14);
  mtn.receiveShadow = true;
  scene.add(mtn);
  worldMeshes.push(mtn);
}
buildWorld(params);

// ============================================================
//  LE CHEMIN — génération procédurale depuis les paramètres
// ============================================================
let pathCurve;
let ribbonMeshes = [];
let ribbonEdgeMat = null;
let ribbonCenterMat = null;

function buildPathCurve(p) {
  const pts = [];
  const seg = 14;
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    const z = PATH_START_Z - u * p.pathLength;
    const x = Math.sin(u * Math.PI * p.pathTurns) * p.pathLateral;
    // montées/descentes : reste >= 0 pour ne pas passer sous le sol
    const y = (Math.sin(u * Math.PI * p.pathHills - Math.PI / 2) * 0.5 + 0.5) * p.pathElevation;
    pts.push(new THREE.Vector3(x, y, z));
  }
  return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
}

function makeRibbonGeometry(curve, halfW, N = 600) {
  const positions = [], uvs = [], indices = [];
  const tmpT = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = curve.getPointAt(t);
    curve.getTangentAt(t, tmpT);
    side.crossVectors(tmpT, up).normalize();
    const L = p.clone().addScaledVector(side,  halfW);
    const R = p.clone().addScaledVector(side, -halfW);
    positions.push(L.x, L.y + 0.05, L.z, R.x, R.y + 0.05, R.z);
    uvs.push(0, t, 1, t);
    if (i < N) { const a = i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function buildRibbons() {
  const halfW = params.pathWidth;

  // centre : marron, opacité réglable
  ribbonCenterMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(params.pathCenterColor), transparent: true,
    opacity: params.pathCenterOpacity, depthWrite: false, side: THREE.DoubleSide,
  });
  const center = new THREE.Mesh(makeRibbonGeometry(pathCurve, halfW), ribbonCenterMat);

  // bords lumineux (additif)
  ribbonEdgeMat = new THREE.ShaderMaterial({
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {
      uColor:    { value: new THREE.Color(params.pathColor) },
      uEmission: { value: params.pathEmission },
      uFlow:     { value: params.pathFlow },
      uSpread:   { value: params.pathSpread },
      uTime:     { value: 0 },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: `
      varying vec2 vUv; uniform vec3 uColor; uniform float uTime; uniform float uEmission; uniform float uFlow; uniform float uSpread;
      void main(){
        float x = abs(vUv.x - 0.5) * 2.0;                 // 0 centre -> 1 bord
        // uSpread élargit la diffusion vers le centre tout en gardant le dégradé
        float edge = smoothstep(1.0 - clamp(uSpread, 0.02, 1.0), 1.0, x);
        float flow = 0.6 + 0.4 * sin(vUv.y * 70.0 - uTime * uFlow);
        gl_FragColor = vec4(uColor * (0.8 + 0.6*edge) * uEmission, edge * (0.35 + 0.65 * flow));
      }`,
  });
  const edges = new THREE.Mesh(makeRibbonGeometry(pathCurve, halfW + 0.05), ribbonEdgeMat);
  edges.layers.enable(BLOOM_PATH);   // le chemin bloom sur son propre calque

  scene.add(center, edges);
  ribbonMeshes = [center, edges];
}

function rebuildPath() {
  for (const m of ribbonMeshes) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
  ribbonMeshes = [];
  pathCurve = buildPathCurve(params);
  buildRibbons();
  buildWorld(params);     // sol + montagne suivent la longueur du chemin
  pathT = 0; runTime = 0;
  primeCharacter();
  if (spheres.length) buildSpheres();  // repositionne les sphères sur le nouveau chemin
}

pathCurve = buildPathCurve(params);
buildRibbons();

// ============================================================
//  Le personnage
// ============================================================
const traveler = new Traveler(scene, {
  filamentCount: 1, color: params.color, thickness: params.thickness,
});
function applyCharacterVisual() {
  traveler.setColor(params.color);
  traveler.setIntensity(params.emission);
  traveler.setThickness(params.thickness);
  traveler.ampMul = params.amplitude;
  traveler.waveSpeedMul = params.waveSpeed;
  traveler.phaseMul = params.phase;
  traveler.pulseAmp = params.pulseAmp;
  traveler.pulseDur = params.pulseDur;
  traveler.pulseWidth = params.pulseWidth;
  traveler.growDur = params.growDur;
  renderer.toneMappingExposure = params.exposure;
}
applyCharacterVisual();
for (const f of traveler.filaments) f.mesh.layers.enable(BLOOM_CHAR);

// Réchauffe : construit une vraie traînée courbée derrière le perso en simulant
// des pas réels le long du chemin (évite les longues lignes droites au départ).
function primeCharacter() {
  pathT = 0; runTime = 0;
  const sp0 = pathCurve.getPointAt(0); sp0.y += params.floatHeight;
  traveler.resetHistory(sp0);

  const dtSim = 1 / 60;
  for (let s = 0; s < traveler.maxHistory; s++) {
    pathT = Math.min(0.999, pathT + params.startSpeed * dtSim);
    const p = pathCurve.getPointAt(pathT);
    p.y += params.floatHeight;
    p.x += params.offsetX; p.y += params.offsetY; p.z += params.offsetZ;
    traveler.setHead(p);
    traveler.update(dtSim, 0, false);   // false = pas de tube d'ombre pendant la réchauffe
  }
}
primeCharacter();

// ============================================================
//  Sphères flottantes le long du chemin (3 couleurs, émissif ou métallisé)
//  Placées en hauteur et décalées sur le côté -> pas de collision personnage.
// ============================================================
const sphereGroup = new THREE.Group();
scene.add(sphereGroup);
let spheres = [];
let collectableCount = 0;   // nb de sphères atteignables (pour l'épaisseur des fils)
const _side = new THREE.Vector3();

function makeSphereMaterial(ci) {
  const transparent = params.sphOpacity < 1 || params.sphTransmission > 0;
  const common = {
    transparent, opacity: params.sphOpacity,
    transmission: params.sphTransmission, thickness: params.sphPhysThickness, ior: 1.25,
  };
  if (params.sphMode === 'métallisé') {
    const cols = [params.metColor1, params.metColor2, params.metColor3];
    return new THREE.MeshPhysicalMaterial({
      ...common, color: cols[ci], metalness: params.sphMetalness, roughness: params.sphRoughness,
    });
  }
  const cols = [params.emColor1, params.emColor2, params.emColor3];
  if (params.sphMode === 'specular') {
    // bulle brillante : reflets spéculaires + glow + transparence
    return new THREE.MeshPhysicalMaterial({
      ...common, color: cols[ci],
      emissive: cols[ci], emissiveIntensity: params.sphEmissive * params.sphGlow,
      roughness: 0.05, metalness: 0.0,
      specularIntensity: 1.0, clearcoat: 1.0, clearcoatRoughness: 0.04,
    });
  }
  // émissif
  return new THREE.MeshPhysicalMaterial({
    ...common, color: 0x0a0a0a, emissive: cols[ci],
    emissiveIntensity: params.sphEmissive * params.sphGlow, roughness: 0.5, metalness: 0.0,
  });
}

// couleur d'une sphère selon le mode de matériau et son index de couleur
function sphereColorHex(s) {
  if (params.sphMode === 'métallisé') return [params.metColor1, params.metColor2, params.metColor3][s.ci];
  return [params.emColor1, params.emColor2, params.emColor3][s.ci];
}

function buildSpheres() {
  for (const s of spheres) { sphereGroup.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose(); }
  spheres = [];
  const n = params.sphCount;
  // offset identique à celui de la tête -> les sphères "récupérables" sont pile
  // sur la trajectoire du personnage ; les autres sont placées à l'écart.
  const headOff = new THREE.Vector3(params.offsetX, params.floatHeight + params.offsetY, params.offsetZ);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const p = pathCurve.getPointAt(t);
    const collectable = (i % 2 === 0);   // une sur deux est atteignable
    let base;
    if (collectable) {
      base = p.clone().add(headOff);                         // sur la trajectoire
    } else {
      _side.crossVectors(pathCurve.getTangentAt(t), UP_VEC).normalize();
      const sign = (i % 4 < 2) ? 1 : -1;
      base = p.clone().addScaledVector(_side, params.sphSpread * sign);
      base.y += params.sphElevation;                         // à l'écart -> manquée
    }
    const ci = i % 3;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), makeSphereMaterial(ci));
    mesh.position.copy(base);
    mesh.layers.enable(BLOOM_CHAR);   // les sphères lumineuses bloom avec le perso
    sphereGroup.add(mesh);
    spheres.push({ mesh, base, phase: i * 1.7, ci, collectable, collected: false, popT: 0 });
  }
  collectableCount = spheres.filter(s => s.collectable).length;
}
function updateSphereMaterials() {
  for (const s of spheres) { s.mesh.material.dispose(); s.mesh.material = makeSphereMaterial(s.ci); }
}
buildSpheres();

// ============================================================
//  Post-processing — bloom
// ============================================================
const res = new THREE.Vector2(innerWidth, innerHeight);

// --- bloom du personnage (calque BLOOM_CHAR) ---
const bloomChar = new UnrealBloomPass(res.clone(), params.glowChar, params.glowCharRadius, 0.2);
const charComposer = new EffectComposer(renderer);
charComposer.renderToScreen = false;
charComposer.addPass(new RenderPass(scene, camera));
charComposer.addPass(bloomChar);

// --- bloom du chemin (calque BLOOM_PATH) ---
const bloomPath = new UnrealBloomPass(res.clone(), params.glowPath, params.glowPathRadius, 0.2);
const pathComposer = new EffectComposer(renderer);
pathComposer.renderToScreen = false;
pathComposer.addPass(new RenderPass(scene, camera));
pathComposer.addPass(bloomPath);

// --- composition finale : scène complète + addition des deux blooms ---
const mixPass = new ShaderPass(new THREE.ShaderMaterial({
  uniforms: {
    baseTexture:  { value: null },
    bloomCharTex: { value: charComposer.renderTarget2.texture },
    bloomPathTex: { value: pathComposer.renderTarget2.texture },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader: `
    uniform sampler2D baseTexture; uniform sampler2D bloomCharTex; uniform sampler2D bloomPathTex;
    varying vec2 vUv;
    void main(){
      gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomCharTex, vUv) + texture2D(bloomPathTex, vUv);
    }`,
}), 'baseTexture');
mixPass.needsSwap = true;

const finalComposer = new EffectComposer(renderer);
finalComposer.addPass(new RenderPass(scene, camera));
finalComposer.addPass(mixPass);
finalComposer.addPass(new OutputPass());

function renderBloomLayer(composer, layer) {
  camera.layers.set(layer);
  composer.render();
}

// ============================================================
//  GUI
// ============================================================
const gui = new GUI({ title: 'MARTELL — réglages' });

const fPath = gui.addFolder('Chemin');
fPath.add(params, 'pathLength', 100, 700, 5).name('longueur').onChange(rebuildPath);
fPath.add(params, 'pathTurns', 0, 6, 1).name('virages').onChange(rebuildPath);
fPath.add(params, 'pathLateral', 0, 16, 0.5).name('amplitude latérale').onChange(rebuildPath);
fPath.add(params, 'pathHills', 0, 6, 1).name('montées/descentes').onChange(rebuildPath);
fPath.add(params, 'pathElevation', 0, 15, 0.5).name('amplitude verticale').onChange(rebuildPath);
fPath.add(params, 'regenerate').name('↻ régénérer');

const fPathLight = gui.addFolder('Chemin — lumière');
fPathLight.add(params, 'pathWidth', 0.5, 10, 0.1).name('largeur ruban').onChange(rebuildPath);
fPathLight.add(params, 'pathSpread', 0.02, 1, 0.01).name('étendue lumière').onChange(v => ribbonEdgeMat.uniforms.uSpread.value = v);
fPathLight.addColor(params, 'pathColor').name('couleur bords').onChange(v => ribbonEdgeMat.uniforms.uColor.value.set(v));
fPathLight.add(params, 'pathEmission', 0, 4, 0.05).name('émission').onChange(v => ribbonEdgeMat.uniforms.uEmission.value = v);
fPathLight.add(params, 'pathFlow', 0, 8, 0.1).name('flux lumineux').onChange(v => ribbonEdgeMat.uniforms.uFlow.value = v);
fPathLight.addColor(params, 'pathCenterColor').name('couleur centre').onChange(v => ribbonCenterMat.color.set(v));
fPathLight.add(params, 'pathCenterOpacity', 0, 1, 0.01).name('opacité centre').onChange(v => ribbonCenterMat.opacity = v);
fPathLight.add(params, 'glowPath', 0, 3, 0.05).name('glow chemin').onChange(v => bloomPath.strength = v);
fPathLight.add(params, 'glowPathRadius', 0, 2, 0.05).name('rayon glow chemin').onChange(v => bloomPath.radius = v);

const fAtt = gui.addFolder('Personnage — attitude');
fAtt.add(params, 'startSpeed', 0.002, 0.05, 0.001).name('vitesse départ');
fAtt.add(params, 'maxSpeed', 0.01, 0.2, 0.005).name('vitesse max');
fAtt.add(params, 'accel', 0, 0.2, 0.005).name('accélération');
fAtt.add(params, 'floatHeight', 0, 6, 0.1).name('hauteur');
fAtt.add(params, 'bob', 0, 2, 0.05).name('flottement');
fAtt.add(params, 'sway', 0, 3, 0.05).name('balancement');
fAtt.add(params, 'amplitude', 0, 3, 0.05).name('amplitude sillage').onChange(v => traveler.ampMul = v);
fAtt.add(params, 'waveSpeed', 0, 4, 0.05).name('vitesse onde').onChange(v => traveler.waveSpeedMul = v);
fAtt.add(params, 'phase', 0, 3, 0.05).name('étalement phases').onChange(v => traveler.phaseMul = v);
fAtt.add(params, 'pulseAmp', 0, 2, 0.05).name('turbulence ampl.').onChange(v => traveler.pulseAmp = v);
fAtt.add(params, 'pulseDur', 0.2, 3, 0.05).name('turbulence durée').onChange(v => traveler.pulseDur = v);
fAtt.add(params, 'pulseWidth', 0.05, 0.6, 0.01).name('turbulence largeur').onChange(v => traveler.pulseWidth = v);
fAtt.add(params, 'growDur', 0.1, 5, 0.05).name('apparition fil (s)').onChange(v => traveler.growDur = v);

const fPos = gui.addFolder('Personnage — placement');
fPos.add(params, 'offsetX', -12, 12, 0.1).name('décalage X');
fPos.add(params, 'offsetY', -6, 12, 0.1).name('décalage Y');
fPos.add(params, 'offsetZ', -20, 20, 0.5).name('décalage Z (av/ar)');

const fVis = gui.addFolder('Personnage — visuel');
fVis.addColor(params, 'color').name('couleur').onChange(v => traveler.setColor(v));
fVis.add(params, 'thickness', 0.02, 0.4, 0.01).name('épaisseur départ');
fVis.add(params, 'thicknessMax', 0.02, 0.6, 0.01).name('épaisseur max');
fVis.add(params, 'emission', 0, 3, 0.05).name('émission');
fVis.add(params, 'emissionBoost', 0, 3, 0.05).name('boost (récup.)');
fVis.add(params, 'glowChar', 0, 3, 0.05).name('glow perso').onChange(v => bloomChar.strength = v);
fVis.add(params, 'glowCharRadius', 0, 2, 0.05).name('rayon glow perso').onChange(v => bloomChar.radius = v);
fVis.add(params, 'exposure', 0.4, 2, 0.05).name('exposition').onChange(v => renderer.toneMappingExposure = v);

const fSph = gui.addFolder('Sphères');
fSph.add(params, 'sphCount', 0, 40, 1).name('nombre').onChange(buildSpheres);
fSph.add(params, 'sphSize', 0.1, 4, 0.05).name('taille');
fSph.add(params, 'sphSpread', 0, 16, 0.5).name('écart latéral').onChange(buildSpheres);
fSph.add(params, 'sphElevation', 0, 14, 0.5).name('hauteur').onChange(buildSpheres);
fSph.add(params, 'sphBreathAmp', 0, 0.8, 0.02).name('respiration');
fSph.add(params, 'sphBreathSpeed', 0, 4, 0.05).name('vit. respiration');
fSph.add(params, 'sphFloatAmp', 0, 2, 0.05).name('flottaison (Y)');
fSph.add(params, 'sphFloatSpeed', 0, 4, 0.05).name('vit. flottaison');
fSph.add(params, 'sphMode', ['émissif', 'métallisé', 'specular']).name('matériau').onChange(updateSphereMaterials);

const fEm = fSph.addFolder('Émissif — 3 couleurs');
fEm.addColor(params, 'emColor1').name('couleur 1').onChange(updateSphereMaterials);
fEm.addColor(params, 'emColor2').name('couleur 2').onChange(updateSphereMaterials);
fEm.addColor(params, 'emColor3').name('couleur 3').onChange(updateSphereMaterials);
fEm.add(params, 'sphEmissive', 0, 4, 0.05).name('intensité').onChange(updateSphereMaterials);

const fMet = fSph.addFolder('Métallisé — 3 couleurs');
fMet.addColor(params, 'metColor1').name('couleur 1').onChange(updateSphereMaterials);
fMet.addColor(params, 'metColor2').name('couleur 2').onChange(updateSphereMaterials);
fMet.addColor(params, 'metColor3').name('couleur 3').onChange(updateSphereMaterials);
fMet.add(params, 'sphMetalness', 0, 1, 0.02).name('métallicité').onChange(updateSphereMaterials);
fMet.add(params, 'sphRoughness', 0, 1, 0.02).name('rugosité').onChange(updateSphereMaterials);

const fBulle = fSph.addFolder('Glow & transparence (bulles)');
fBulle.add(params, 'sphGlow', 0, 5, 0.05).name('glow (émission)').onChange(updateSphereMaterials);
fBulle.add(params, 'sphOpacity', 0, 1, 0.01).name('opacité').onChange(updateSphereMaterials);
fBulle.add(params, 'sphTransmission', 0, 1, 0.01).name('transmission (verre)').onChange(updateSphereMaterials);
fBulle.add(params, 'sphPhysThickness', 0, 4, 0.05).name('épaisseur (réfraction)').onChange(updateSphereMaterials);

// ============================================================
//  Contrôles clavier
// ============================================================
let paused = false;
let followCam = true;

// Toggle "couleur" : si actif, le perso prend la couleur de la dernière sphère mangée.
let colorMode = false;
const colorToggle = document.getElementById('colorToggle');
const colorSwitch = colorToggle.querySelector('.switch');
const colorState = colorToggle.querySelector('.state');
colorToggle.addEventListener('click', () => {
  colorMode = !colorMode;
  colorToggle.classList.toggle('on', colorMode);
  colorState.textContent = colorMode ? 'ON' : 'OFF';
  if (!colorMode) {
    traveler.setColor(params.color);   // retour à la couleur de base (#ffc83d)
    colorSwitch.style.background = '';
  }
});

addEventListener('keydown', (e) => {
  if (e.code === 'Space') { paused = !paused; e.preventDefault(); }
  else if (e.key === 'c' || e.key === 'C') {
    followCam = !followCam; orbit.enabled = !followCam;
    if (orbit.enabled) orbit.target.copy(traveler.head);
  }
});

// ============================================================
//  Boucle
// ============================================================
const clock = new THREE.Clock();
const scoreEl = document.getElementById('score');
const camPos = new THREE.Vector3();
const camTarget = new THREE.Vector3();
const lookAhead = new THREE.Vector3();
const tmpTan = new THREE.Vector3();

let firstFrame = true;
function tick() {
  requestAnimationFrame(tick);
  if (crashed) return;
  try {
    const dt = Math.min(clock.getDelta(), 0.05);
    const time = clock.elapsedTime;

    if (!paused) {
      runTime += dt;
      const speed = Math.min(params.maxSpeed, params.startSpeed + runTime * params.accel);
      const next = pathT + speed * dt;
      if (next >= 1) {
        // bouclage : on ré-amorce la traînée au départ pour éviter
        // que les splines ne s'étirent jusqu'à la montagne du fond
        pathT = next % 1;
        primeCharacter();
        snapCam = true;   // évite le glissement caméra de la montagne au départ
        for (const s of spheres) { s.collected = false; s.popT = 0; s.mesh.visible = true; } // nouveau tour
      } else {
        pathT = next;
      }
    }

    // tête sur le chemin + vie (flottement + balancement) + placement
    const p = pathCurve.getPointAt(pathT);
    pathCurve.getTangentAt(pathT, tmpTan);
    p.y += params.floatHeight + Math.sin(time * 1.8) * params.bob;
    p.x += Math.sin(time * 0.9) * params.sway;
    p.x += params.offsetX; p.y += params.offsetY; p.z += params.offsetZ;
    traveler.setHead(p);
    traveler.update(dt, time);

    // la lumière (et sa cible) suit le personnage -> ombre nette et bien cadrée
    keyLight.target.position.copy(p);
    keyLight.position.set(p.x - 22, p.y + 34, p.z + 12);

    if (ribbonEdgeMat) ribbonEdgeMat.uniforms.uTime.value = time;

    // sphères : récupération (passage au centre) + respiration + flottement
    const bs = params.sphBreathSpeed, ba = params.sphBreathAmp;
    const PICK_H = 0.8;           // tolérance horizontale (serrée -> rate celles à l'écart)
    const PICK_V = 1.6;           // tolérance verticale (large -> encaisse le flottement)
    let collected = 0;
    for (const s of spheres) {
      if (s.collected) {
        // disparition : monte vers son point le plus haut (easeOut) en scalant à 0,
        // depuis sa hauteur actuelle -> pas de redescente.
        s.popT = Math.min(1, s.popT + dt * 2);   // gonflement ralenti (dt*2)
        const e = easeOutCubic(s.popT);
        s.mesh.scale.setScalar(Math.max(0, params.sphSize * (1 - e)));
        s.mesh.position.set(s.base.x, s.startY + e * 3, s.base.z);
        if (s.popT >= 1) s.mesh.visible = false;
        collected++;
        continue;
      }
      // respiration (échelle) + flottaison constante (Y), tout en sinus (lissé)
      s.mesh.scale.setScalar(params.sphSize * (1 + ba * Math.sin(time * bs + s.phase)));
      s.mesh.position.set(
        s.base.x,
        s.base.y + params.sphFloatAmp * Math.sin(time * params.sphFloatSpeed + s.phase),
        s.base.z,
      );
      // récupération si le personnage passe en son centre
      const dx = traveler.head.x - s.mesh.position.x;
      const dz = traveler.head.z - s.mesh.position.z;
      const dy = traveler.head.y - s.mesh.position.y;
      if (Math.hypot(dx, dz) < PICK_H && Math.abs(dy) < PICK_V) {
        s.collected = true; s.popT = 0;
        s.startY = s.mesh.position.y;          // part de sa hauteur actuelle (pas de saut)
        emissionBoostT = EMISSION_BOOST_DUR;   // flash d'émission du perso
        traveler.triggerPulse();               // onde de turbulence sur les splines
        if (colorMode) {                       // le perso prend la couleur de la sphère
          const hex = sphereColorHex(s);
          traveler.setColor(hex);
          colorSwitch.style.background = hex;  // la piste reflète la couleur prise
        }
      }
    }
    if (scoreEl) scoreEl.textContent = `Sphères : ${collected} / ${spheres.length}`;

    // progression : 1 spline fine au départ -> elle grossit -> 2e spline -> ...
    // jusqu'à 5 splines à l'épaisseur max, au fil des sphères récupérées.
    const frac = collectableCount ? Math.min(1, collected / collectableCount) : 0;
    traveler.setFilamentCount(1 + Math.floor(frac * 5));   // 1..5 par paliers
    traveler.setThickness(params.thickness + (params.thicknessMax - params.thickness) * frac);

    // émission du perso : +boost pendant 0.3 s après une récupération, puis retour
    if (emissionBoostT > 0) emissionBoostT = Math.max(0, emissionBoostT - dt);
    const boost = params.emissionBoost * (emissionBoostT / EMISSION_BOOST_DUR);
    traveler.setIntensity(params.emission + boost);

    // caméra de suivi
    if (followCam) {
      const behind = tmpTan.clone().multiplyScalar(-9);
      camPos.copy(p).add(behind).add(new THREE.Vector3(0, 4.5, 0));
      lookAhead.copy(pathCurve.getPointAt((pathT + 0.06) % 1));
      if (firstFrame || snapCam) {
        // pas de glissement : on se place directement derrière le perso
        camera.position.copy(camPos);
        camTarget.copy(lookAhead);
        snapCam = false;
      } else {
        camera.position.lerp(camPos, 1 - Math.pow(0.001, dt));
        camTarget.lerp(lookAhead, 1 - Math.pow(0.0015, dt));
      }
      camera.lookAt(camTarget);
    } else {
      orbit.update();
    }

    // bloom sélectif : perso, puis chemin, puis composition finale
    renderBloomLayer(charComposer, BLOOM_CHAR);
    renderBloomLayer(pathComposer, BLOOM_PATH);
    camera.layers.set(0);
    finalComposer.render();

    if (firstFrame) { firstFrame = false; document.getElementById('loader').classList.add('hidden'); }
  } catch (err) {
    const l = document.getElementById('loader');
    l.classList.remove('hidden'); l.classList.add('error');
    l.textContent = '⚠ Erreur de rendu\n\n' + (err && err.stack ? err.stack : err);
    crashed = true;   // stoppe la boucle pour garder la stack à l'écran
  }
}
let crashed = false;

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  charComposer.setSize(innerWidth, innerHeight);
  pathComposer.setSize(innerWidth, innerHeight);
  finalComposer.setSize(innerWidth, innerHeight);
});

tick();
