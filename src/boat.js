// Procedural fishing boat with buoyancy on the shared wave field, a route through the
// lagoon, a wake history for the ocean shader and bow spray particles.
import * as THREE from 'three';
import { WAKE_POINTS } from './ocean.js';
import { terrainHeight, ISLANDS } from './terrain.js';

export const BOAT_LEN = 7.2;
const HALF_BEAM = 1.3;

export function hullHalfWidth(u) { // u: 0 stern .. 1 bow
  const w = u < 0.72 ? 0.86 + 0.14 * Math.sin((u / 0.72) * Math.PI / 2) : Math.pow(Math.max(Math.cos(((u - 0.72) / 0.28) * Math.PI / 2), 0), 0.75);
  return HALF_BEAM * w;
}
const sheer = (u) => 0.55 + 0.45 * Math.pow(Math.max(u - 0.55, 0) / 0.45, 2);
const keel = (u) => -1.05 + 0.55 * Math.pow(Math.max(u - 0.6, 0) / 0.4, 1.6);

function hullGeometry() {
  const US = 48, VS = 28, pos = [], col = [], idx = [];
  const white = new THREE.Color(0xf2f0ea), red = new THREE.Color(0xa8261d), bottom = new THREE.Color(0x5b1a17), c = new THREE.Color();
  for (let i = 0; i <= US; i++) {
    const u = i / US, x = (u - 0.5) * BOAT_LEN, hw = hullHalfWidth(u), ys = sheer(u), yk = keel(u);
    for (let j = 0; j <= VS; j++) {
      const phi = (j / VS) * Math.PI;
      const z = hw * Math.cos(phi);
      const y = ys - (ys - yk) * Math.pow(Math.sin(phi), 0.38);
      pos.push(x, y, z);
      if (y < -0.42) c.copy(bottom); else if (y < -0.18) c.copy(red); else if (y > ys - 0.09) c.copy(red); else c.copy(white);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < US; i++) for (let j = 0; j < VS; j++) {
    const a = i * (VS + 1) + j, b = a + VS + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  // transom (flat stern) as a fan
  const base = pos.length / 3;
  pos.push(-BOAT_LEN / 2, (sheer(0) + keel(0)) / 2, 0); col.push(white.r, white.g, white.b);
  for (let j = 0; j <= VS; j++) {
    const k = j * 3; pos.push(pos[k], pos[k + 1], pos[k + 2]); col.push(white.r, white.g, white.b);
  }
  for (let j = 0; j < VS; j++) idx.push(base, base + 1 + j + 1, base + 1 + j);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function plankTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  for (let i = 0; i < 16; i++) {
    const l = 120 + Math.random() * 40;
    g.fillStyle = `rgb(${l + 40},${l + 8},${l - 40})`; g.fillRect(0, i * 32, 512, 32);
    g.fillStyle = 'rgba(40,25,10,0.55)'; g.fillRect(0, i * 32, 512, 2);
    for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(80,50,20,${Math.random() * 0.15})`; g.fillRect(Math.random() * 512, i * 32 + Math.random() * 30, 60 + Math.random() * 120, 1); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function buildBoat() {
  const boat = new THREE.Group();
  const hullMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.0, clearcoat: 0.85, clearcoatRoughness: 0.12, side: THREE.DoubleSide });
  const hull = new THREE.Mesh(hullGeometry(), hullMat);
  boat.add(hull);

  // deck
  const shape = new THREE.Shape();
  const N = 40;
  for (let i = 0; i <= N; i++) { const u = 0.02 + (i / N) * 0.95; const p = [(u - 0.5) * BOAT_LEN, hullHalfWidth(u) * 0.93]; i ? shape.lineTo(...p) : shape.moveTo(...p); }
  for (let i = N; i >= 0; i--) { const u = 0.02 + (i / N) * 0.95; shape.lineTo((u - 0.5) * BOAT_LEN, -hullHalfWidth(u) * 0.93); }
  const deckGeo = new THREE.ShapeGeometry(shape);
  deckGeo.rotateX(-Math.PI / 2);
  const planks = plankTexture(); planks.repeat.set(0.25, 0.6);
  const deck = new THREE.Mesh(deckGeo, new THREE.MeshStandardMaterial({ map: planks, roughness: 0.75 }));
  deck.position.y = 0.32;
  boat.add(deck);

  const white = new THREE.MeshPhysicalMaterial({ color: 0xeeeae2, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.2 });
  const red = new THREE.MeshPhysicalMaterial({ color: 0xb02a20, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.15 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0f1d25, roughness: 0.04, metalness: 0.1, clearcoat: 1, envMapIntensity: 1.6 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.25, metalness: 0.9 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.7 });

  // wheelhouse
  const cab = new THREE.Group();
  const walls = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.55, 1.55), white); walls.position.y = 0.78;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 1.8), red); roof.position.y = 1.62;
  const trim = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.14, 1.59), red); trim.position.y = 0.1;
  const winF = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.55), glass); winF.position.set(0.951, 1.12, 0); winF.rotation.y = Math.PI / 2;
  const winL = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.5), glass); winL.position.set(0.1, 1.12, 0.776);
  const winR = winL.clone(); winR.position.z = -0.776; winR.rotation.y = Math.PI;
  const door = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 1.25), wood); door.position.set(-0.951, 0.72, 0); door.rotation.y = -Math.PI / 2;
  cab.add(walls, roof, trim, winF, winL, winR, door);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.6, 8), steel); mast.position.set(-0.4, 2.45, 0);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1c0, emissiveIntensity: 2 }));
  lamp.position.set(-0.4, 3.28, 0);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.1, 6), steel); antenna.position.set(0.6, 2.2, 0.5);
  cab.add(mast, lamp, antenna);
  cab.position.set(0.55, 0.32, 0);
  boat.add(cab);

  // railings along the bow and a stern frame
  const railPts = [];
  for (let i = 0; i <= 30; i++) { const u = 0.62 + (i / 30) * 0.36; railPts.push(new THREE.Vector3((u - 0.5) * BOAT_LEN, sheer(u) + 0.48, hullHalfWidth(u) * 0.9)); }
  for (let i = 30; i >= 0; i--) { const p = railPts[i]; railPts.push(new THREE.Vector3(p.x, p.y, -p.z)); }
  const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railPts), 90, 0.028, 6), steel);
  boat.add(rail);
  for (let i = 0; i <= 6; i++) {
    const u = 0.64 + i * 0.055, z = hullHalfWidth(u) * 0.9;
    for (const s of [1, -1]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.48, 6), steel); post.position.set((u - 0.5) * BOAT_LEN, sheer(u) + 0.24, z * s); boat.add(post); }
  }
  const frame = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(-3.3, 0.55, 1.0), new THREE.Vector3(-3.35, 1.75, 0.95), new THREE.Vector3(-3.35, 1.85, 0), new THREE.Vector3(-3.35, 1.75, -0.95), new THREE.Vector3(-3.3, 0.55, -1.0)]), 40, 0.035, 6), steel);
  boat.add(frame);

  // fenders, barrel, crates
  const fenderMat = new THREE.MeshStandardMaterial({ color: 0xd2271b, roughness: 0.35 });
  for (const [u, s] of [[0.3, 1], [0.55, 1], [0.3, -1], [0.55, -1], [0.05, 1], [0.05, -1]]) {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), fenderMat);
    f.position.set((u - 0.5) * BOAT_LEN, 0.2, (hullHalfWidth(u) + 0.12) * s); f.scale.y = 1.25;
    boat.add(f);
  }
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.72, 20), new THREE.MeshStandardMaterial({ color: 0x1f5fb8, roughness: 0.4 }));
  barrel.position.set(-2.4, 0.68, 0.5); boat.add(barrel);
  const barrel2 = barrel.clone(); barrel2.position.set(-2.4, 0.68, -0.15); boat.add(barrel2);
  const crate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.55), new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.6 }));
  crate.position.set(-1.7, 0.52, -0.55); boat.add(crate);

  boat.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return boat;
}

// Closed route through the lagoon: circle the beach island at water depth 2.5–9 m.
function buildRoute() {
  const B = ISLANDS.beach, pts = [];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const dir = new THREE.Vector2(Math.cos(a), Math.sin(a));
    let r = 120, best = null;
    for (; r < 700; r += 6) {
      const x = B.x + dir.x * r, z = B.z + dir.y * r, h = terrainHeight(x, z);
      if (h < -3 && h > -9) { best = new THREE.Vector3(x, 0, z); break; }
    }
    if (!best) best = new THREE.Vector3(B.x + dir.x * 420, 0, B.z + dir.y * 420);
    pts.push(best);
  }
  return new THREE.CatmullRomCurve3(pts, true, 'centripetal');
}

export class BoatSim {
  constructor(boat, waves, overlayScene) {
    this.boat = boat; this.waves = waves;
    this.route = buildRoute();
    this.routeLen = this.route.getLength();
    this.speed = 5.2; // m/s ≈ 10 knots
    this.s = 0.08 * this.routeLen;
    this.pos = new THREE.Vector3(); this.heading = 0;
    this.pitch = 0; this.roll = 0; this.heave = 0;
    this.wake = Array.from({ length: WAKE_POINTS }, () => new THREE.Vector4(0, 0, 99, 0));
    this.wakeTimer = 0;
    this.inv = new THREE.Matrix4();
    this.forward = new THREE.Vector3();
    // spray
    const N = 420;
    this.spray = { n: N, pos: new Float32Array(N * 3), vel: new Float32Array(N * 3), life: new Float32Array(N), next: 0 };
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.spray.pos, 3));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.spray.life, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
      uniforms: { uScale: { value: 300 } },
      vertexShader: 'attribute float alpha; varying float vA; uniform float uScale; void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = clamp(uScale * (0.06 + 0.1 * (1.0 - alpha)) / -mv.z, 1.0, 64.0); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d); if (r > 0.25) discard; gl_FragColor = vec4(vec3(1.6), vA * smoothstep(0.25, 0.0, r) * 0.75); }',
    });
    this.sprayPts = new THREE.Points(g, m);
    this.sprayPts.frustumCulled = false;
    overlayScene.add(this.sprayPts);
    this.update(0, 0);
  }

  emit(p, v) {
    const S = this.spray, i = S.next; S.next = (S.next + 1) % S.n;
    S.pos.set([p.x, p.y, p.z], i * 3); S.vel.set([v.x, v.y, v.z], i * 3); S.life[i] = 1;
  }

  update(t, dt) {
    const W = this.waves;
    this.s = (this.s + this.speed * dt) % this.routeLen;
    const u = this.s / this.routeLen;
    const p = this.route.getPointAt(u), tan = this.route.getTangentAt(u);
    const targetHeading = Math.atan2(-tan.z, tan.x);
    let dh = targetHeading - this.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    this.heading += dh * Math.min(1, dt * 1.5);
    const fx = Math.cos(this.heading), fz = -Math.sin(this.heading);
    this.forward.set(fx, 0, fz);
    const sx = -fz, sz = fx;
    // sample the sea under bow / stern / port / starboard
    const hb = W.heightAt(p.x + fx * 3, p.z + fz * 3, t), hs = W.heightAt(p.x - fx * 3, p.z - fz * 3, t);
    const hp = W.heightAt(p.x + sx * 1.2, p.z + sz * 1.2, t), hsb = W.heightAt(p.x - sx * 1.2, p.z - sz * 1.2, t);
    const hc = (hb + hs + hp + hsb) * 0.25;
    const k = Math.min(1, dt * 3.5);
    this.heave += (hc - 0.12 - this.heave) * k;
    this.pitch += (Math.atan2(hb - hs, 6) + 0.035 - this.pitch) * k; // slight bow-up trim under way
    // local +z is the port side; rotateX(+) dips it, so a higher port side needs a negative roll
    this.roll += (-Math.atan2(hp - hsb, 2.4) + dh * 0.6 - this.roll) * k;
    this.pos.set(p.x, this.heave, p.z);
    const B = this.boat;
    B.position.copy(this.pos);
    B.rotation.set(0, 0, 0);
    B.rotateY(this.heading);
    B.rotateZ(this.pitch);
    B.rotateX(this.roll);
    B.updateMatrixWorld(true);
    this.inv.copy(B.matrixWorld).invert();

    // wake history (stern position + age)
    this.wakeTimer += dt;
    for (const w of this.wake) w.z += dt;
    if (this.wakeTimer > 0.4) {
      this.wakeTimer = 0;
      this.wake.pop();
      this.wake.unshift(new THREE.Vector4(p.x - fx * 3.4, p.z - fz * 3.4, 0, 0));
    }
    this.wake[0].set(p.x - fx * 3.4, p.z - fz * 3.4, 0, 0);

    // bow spray: stronger when the bow drops into a wave
    const S = this.spray;
    const impact = Math.max(0, (hb - this.heave) * 2.5 + 0.35);
    const nEmit = Math.floor(dt * 90 * impact);
    const v = new THREE.Vector3(), q = new THREE.Vector3();
    for (let i = 0; i < nEmit; i++) {
      const side = Math.random() < 0.5 ? 1 : -1;
      q.set(p.x + fx * (2.4 + Math.random()), this.heave + 0.05, p.z + fz * (2.4 + Math.random())).addScaledVector(new THREE.Vector3(sx, 0, sz), side * 0.9);
      v.set(fx * this.speed * 0.4 + sx * side * (1.5 + Math.random() * 2), 1.5 + Math.random() * 2.5 * impact, fz * this.speed * 0.4 + sz * side * (1.5 + Math.random() * 2));
      this.emit(q, v);
    }
    for (let i = 0; i < S.n; i++) {
      if (S.life[i] <= 0) continue;
      S.vel[i * 3 + 1] -= 9.81 * dt;
      S.pos[i * 3] += S.vel[i * 3] * dt; S.pos[i * 3 + 1] += S.vel[i * 3 + 1] * dt; S.pos[i * 3 + 2] += S.vel[i * 3 + 2] * dt;
      S.life[i] -= dt * 0.9;
      if (S.pos[i * 3 + 1] < -0.3) S.life[i] = 0;
    }
    this.sprayPts.geometry.attributes.position.needsUpdate = true;
    this.sprayPts.geometry.attributes.alpha.needsUpdate = true;
  }
}
