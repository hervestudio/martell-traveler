import * as THREE from 'three';

/**
 * Traveler — le personnage Martell.
 * Des filaments jaune pâle rendus en TUBES lisses (pas de fat-lines -> pas de
 * "disques" parasites). Les brins partent tous du même point (la tête, qui suit
 * le path) puis évoluent indépendamment.
 *
 *  - historique des positions de la tête -> chaque brin l'échantillonne avec un
 *    retard croissant + une onde perpendiculaire propre ;
 *  - la couleur s'éteint avant la fin -> les bouts sont invisibles ;
 *  - chaque tube projette sa propre ombre (castShadow) ;
 *  - triggerPulse() lance une onde de turbulence qui remonte le brin (réaction
 *    physique quand le perso mange une sphère).
 */

const UP = new THREE.Vector3(0, 1, 0);

const filamentVertex = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const filamentFragment = /* glsl */`
  uniform vec3 uColor; uniform float uIntensity; uniform float uTime; uniform float uSeed;
  varying vec2 vUv;
  void main(){
    float v = vUv.x;                       // 0 (tête) -> 1 (queue) le long du tube
    float fadeRaw = 1.0 - v / 0.85;
    float fade = fadeRaw > 0.0 ? pow(fadeRaw, 1.3) : 0.0;
    float flick = 0.8 + 0.2 * sin(uTime * 3.0 + uSeed * 12.566);
    // additif (SrcAlpha, One) -> contribution = couleur * fade
    gl_FragColor = vec4(uColor * uIntensity * flick, fade);
  }
`;

export class Traveler {
  constructor(scene, opts = {}) {
    this.head = new THREE.Vector3(0, 0, 50);
    this.history = [];
    this.maxHistory = 260;
    for (let i = 0; i < this.maxHistory; i++) this.history.push(this.head.clone());

    this.group = new THREE.Group();
    scene.add(this.group);

    this.colorVec = new THREE.Color(opts.color ?? 0xffe6a6);
    this.intensity = 1.0;
    this.ampMul = 1.0;
    this.waveSpeedMul = 1.0;
    this.phaseMul = 1.0;
    this.radius = (opts.thickness ?? 0.05) * 0.5;  // rayon du tube (épaisseur = diamètre)

    this.pulses = [];   // ondes de turbulence actives
    this.pulseAmp = 0.4;    // amplitude de l'onde
    this.pulseDur = 1.0;    // durée / vitesse (s) — plus grand = plus lent
    this.pulseWidth = 0.15; // largeur du front (en u)
    this.growDur = 0.6;     // durée d'apparition d'une nouvelle ligne (s)

    this.segments = 90;
    this.spacing = 1.1;   // espacement d'échantillonnage -> longueur de la traînée (÷2)
    this.tubeMax = Math.floor(this.segments * 0.85);  // on ne tube que la partie visible

    this.maxFilaments = 5;
    this.activeFilaments = Math.min(this.maxFilaments, opts.filamentCount ?? 1);
    this.filaments = [];
    for (let i = 0; i < this.maxFilaments; i++) this.filaments.push(this._makeFilament(i));
    this._applyVisibility();

    this._t = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._p = new THREE.Vector3();
  }

  _makeFilament(i) {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor:     { value: this.colorVec },   // référence partagée -> setColor met tout à jour
        uIntensity: { value: this.intensity },
        uTime:      { value: 0 },
        uSeed:      { value: i / this.maxFilaments },
      },
      vertexShader: filamentVertex,
      fragmentShader: filamentFragment,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    mesh.castShadow = true;       // chaque tube projette son ombre
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    this.group.add(mesh);

    const angle = (i / this.maxFilaments) * Math.PI * 2;
    return {
      mesh, material,
      pts: [],
      grow: 1,            // 0..1 : progression d'apparition (longueur)
      angle,
      freq:  0.09 + i * 0.025,
      speed: 1.2 + i * 0.35,
      phase: i * 2.3,
      amp:   1.0 + (i % 3) * 0.45,
      twist: 0.5 + i * 0.22,
    };
  }

  resetHistory(point) {
    this.head.copy(point);
    this.history.length = 0;
    for (let k = 0; k < this.maxHistory; k++) this.history.push(point.clone());
    this.pulses.length = 0;
  }

  triggerPulse() { this.pulses.push({ age: 0 }); }

  setFilamentCount(n) {
    const c = THREE.MathUtils.clamp(Math.round(n), 1, this.maxFilaments);
    if (c !== this.activeFilaments) { this.activeFilaments = c; this._applyVisibility(); }
    return this.activeFilaments;
  }
  _applyVisibility() {
    this.filaments.forEach((f, i) => {
      const on = i < this.activeFilaments;
      if (on && !f.mesh.visible) f.grow = 0;   // nouvelle ligne -> se construit du point commun
      f.mesh.visible = on;
    });
  }
  setColor(hex)       { this.colorVec.set(hex); }
  setIntensity(v)     { this.intensity = v; }
  setThickness(v)     { this.radius = v * 0.5; }
  setHead(pos)        { this.head.copy(pos); }

  update(dt, time, buildGeometry = true) {
    // ondes de turbulence
    for (const pl of this.pulses) pl.age += dt;
    this.pulses = this.pulses.filter((pl) => pl.age < this.pulseDur);

    // historique
    this.history.unshift(this.head.clone());
    if (this.history.length > this.maxHistory) this.history.pop();

    if (!buildGeometry) return;   // réchauffe : on remplit l'historique sans tuber

    const hist = this.history;
    const tubeMax = this.tubeMax;
    for (let fi = 0; fi < this.activeFilaments; fi++) {
      const f = this.filaments[fi];
      f.grow = Math.min(1, f.grow + dt / Math.max(0.05, this.growDur));  // apparition progressive
      f.material.uniforms.uTime.value = time;
      f.material.uniforms.uIntensity.value = this.intensity;

      const pts = f.pts;
      pts.length = 0;
      const jEnd = Math.floor(tubeMax * f.grow);   // longueur courante (se construit du point commun)
      for (let j = 0; j <= jEnd; j += 2) {
        const histIndex = Math.min(hist.length - 1, Math.floor(j * this.spacing));
        const sample = hist[histIndex];

        const a = hist[Math.max(0, histIndex - 1)];
        const c = hist[Math.min(hist.length - 1, histIndex + 1)];
        this._t.subVectors(a, c);
        if (this._t.lengthSq() < 1e-6) this._t.set(0, 0, 1);
        this._t.normalize();

        this._n.crossVectors(this._t, UP);
        if (this._n.lengthSq() < 1e-6) this._n.set(1, 0, 0);
        this._n.normalize();
        this._b.crossVectors(this._t, this._n).normalize();

        const u = j / (this.segments - 1);
        const env = Math.sin(u * Math.PI) * (0.4 + 0.6 * (1 - u));
        const wave = Math.sin(j * f.freq + f.phase * this.phaseMul + time * f.speed * this.waveSpeedMul);
        const ang = f.angle + u * f.twist * 6.0 + time * 0.3;
        let radius = f.amp * env * (0.6 + 0.4 * wave) * this.ampMul;

        // turbulence : renflement lisse qui remonte du point commun vers le bout.
        // multiplié par env (=0 à la tête) -> le point commun reste commun.
        for (const pl of this.pulses) {
          const front = pl.age / this.pulseDur;        // 0 -> 1
          const d = u - front;
          const g = Math.exp(-(d * d) / (2 * this.pulseWidth * this.pulseWidth));
          const decay = 1 - pl.age / this.pulseDur;
          radius += g * decay * this.pulseAmp * env * this.ampMul;
        }

        this._p.copy(sample)
          .addScaledVector(this._n, Math.cos(ang) * radius)
          .addScaledVector(this._b, Math.sin(ang) * radius);
        // ignore les points coïncidents (sinon courbe dégénérée -> NaN -> crash)
        const lastP = pts.length ? pts[pts.length - 1] : null;
        if (!lastP || this._p.distanceToSquared(lastP) > 1e-4) pts.push(this._p.clone());
      }

      if (pts.length >= 3) {
        // type 'catmullrom' (uniforme) : pas de distanceToSquared -> robuste
        const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
        const tube = new THREE.TubeGeometry(curve, Math.max(8, pts.length * 2), this.radius, 6, false);
        f.mesh.geometry.dispose();
        f.mesh.geometry = tube;
      }
    }
  }
}
