// Archipelago heightfield + triplanar PBR material (rock / grass / sand) with
// underwater caustics. One material is shared by the terrain, shore rocks and far islets.
import * as THREE from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const perlin = new ImprovedNoise();
export function fbm(x, z, oct = 5, lac = 2.03, gain = 0.5) {
  let s = 0, a = 1, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * perlin.noise(x * f, 11.3 + i * 7.1, z * f);
    n += a; a *= gain; f *= lac;
  }
  return s / n;
}
const sstep = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

// Island catalogue (world metres). Used by vegetation, the boat route and camera shots.
export const ISLANDS = {
  beach: { x: 40, z: 60 },                       // long sandy island with trees
  peakA: { x: -330, z: -260, h: 150, r: 120 },   // tall karst tower
  peakB: { x: 360, z: -360, h: 95, r: 85 },
  peakC: { x: -560, z: 330, h: 70, r: 70 },
  stacks: [
    { x: -120, z: -470, h: 34, r: 26 }, { x: 180, z: -150, h: 18, r: 18 },
    { x: 520, z: 120, h: 42, r: 32 }, { x: -460, z: -40, h: 26, r: 22 },
    { x: 260, z: 380, h: 22, r: 20 },
  ],
};

// Karst tower: near-vertical walls, rounded crown, stepped strata ledges.
function karst(x, z, I) {
  const dx = x - I.x, dz = z - I.z;
  if (dx * dx + dz * dz > (I.r * 2.3) ** 2) return -99;
  const warp = fbm(x * 0.012, z * 0.012, 3) * 0.45;
  const d = Math.hypot(dx, dz) / I.r + warp;
  if (d > 1.8) return -99;
  // steep walls: a plateau that falls off sharply near the rim
  const body = 1 - sstep(0.72, 0.98, d);
  // several spires: ridged noise lifts some parts of the crown far above others
  const rn = 1 - Math.abs(fbm(x * 0.024 + I.r, z * 0.024, 4));
  const spires = 0.35 + 0.85 * Math.pow(rn, 3.0);
  const crown = 1 - sstep(0.2, 0.95, d) * 0.25;
  let h = I.h * Math.pow(body, 0.25) * spires * crown;
  // strata: terrace with soft risers
  const step = 6.0;
  const q = h / step, fl = Math.floor(q), fr = q - fl;
  h = (fl + sstep(0.25, 0.75, fr)) * step * 0.55 + h * 0.45;
  // rocky skirt just under the waterline
  const skirt = (1 - sstep(0.95, 1.55, d)) * 5.5 - 6.5 + fbm(x * 0.05, z * 0.05, 2) * 2;
  return Math.max(h, skirt);
}

export function terrainHeight(x, z) {
  // sea floor: deep basin, rising toward the islands
  let h = -34 + 6 * fbm(x * 0.002, z * 0.002, 3);

  // main beach island: elongated, low hills, wide shallow lagoon
  {
    const B = ISLANDS.beach;
    const lx = (x - B.x) * Math.cos(0.4) + (z - B.z) * Math.sin(0.4);
    const lz = -(x - B.x) * Math.sin(0.4) + (z - B.z) * Math.cos(0.4);
    const warp = fbm(x * 0.006, z * 0.006, 3) * 0.35;
    const r = Math.hypot(lx / 250, lz / 120) + warp;
    const lagoon = (1 - sstep(0.85, 2.1, r)) * 32;      // shelf toward ~ -2 m
    const land = (1 - sstep(0.45, 1.0, r));
    const hills = land * (7 + 16 * Math.max(0, fbm(x * 0.012 + 3, z * 0.012, 4) + 0.25));
    const ridgeD = Math.hypot((lx + 150) / 70, lz / 55);
    const ridge = Math.pow(1 - sstep(0, 1, ridgeD), 1.3) * 58;
    let ih = -34 + lagoon + land * 5 + hills + ridge;
    // beach band: flatten and widen the sand just above the waterline
    const b = sstep(-1.5, 6, ih);
    ih = ih * (0.25 + 0.75 * b) + (1 - b) * 0.2;
    // reef patches in the lagoon (dark rock under clear water)
    ih += (1 - sstep(0.8, 1.9, r)) * sstep(0.15, 0.45, fbm(x * 0.03, z * 0.03, 3)) * 1.4;
    h = Math.max(h, ih);
  }

  for (const k of ['peakA', 'peakB', 'peakC']) h = Math.max(h, karst(x, z, ISLANDS[k]));
  for (const s of ISLANDS.stacks) h = Math.max(h, karst(x, z, s));

  // shallow sandy shelves around each karst island
  for (const k of ['peakA', 'peakB', 'peakC']) {
    const I = ISLANDS[k];
    const d = Math.hypot(x - I.x, z - I.z) / (I.r * 2.4);
    if (d > 1.05) continue;
    h = Math.max(h, -34 + (1 - sstep(0.4, 1.0, d)) * 27.5 + fbm(x * 0.02, z * 0.02, 3) * 2);
  }
  return h;
}

export function terrainNormal(x, z, e = 1.5) {
  return new THREE.Vector3(
    terrainHeight(x - e, z) - terrainHeight(x + e, z), 2 * e,
    terrainHeight(x, z - e) - terrainHeight(x, z + e)).normalize();
}

function loadTex(loader, url, srgb, anis) {
  const t = loader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anis;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createTerrainMaterial(loader, renderer, shared) {
  const anis = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const T = (n, srgb) => loadTex(loader, `assets/tex/${n}.jpg`, srgb, anis);
  const u = {
    tRockD: { value: T('rock_diff', true) }, tRockN: { value: T('rock_nor') }, tRockR: { value: T('rock_rough') },
    tGrassD: { value: T('grass_diff', true) }, tGrassN: { value: T('grass_nor') }, tGrassR: { value: T('grass_rough') },
    tSandD: { value: T('sand_diff', true) }, tSandN: { value: T('sand_nor') }, tSandR: { value: T('sand_rough') },
    uTime: shared.uTime, uSunDir: shared.uSunDir, uSunColor: shared.uSunColor, uUnder: shared.uUnder,
  };
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 wpT = vec4(transformed, 1.0);
        vec3 wnT = objectNormal;
        #ifdef USE_INSTANCING
          wpT = instanceMatrix * wpT;
          wnT = mat3(instanceMatrix) * wnT;
        #endif
        wpT = modelMatrix * wpT;
        vWPos = wpT.xyz;
        vWNrm = normalize(mat3(modelMatrix) * wnT);`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNrm;
        uniform sampler2D tRockD, tRockN, tRockR, tGrassD, tGrassN, tGrassR, tSandD, tSandN, tSandR;
        uniform float uTime, uUnder; uniform vec3 uSunDir, uSunColor;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
        // animated cellular caustics: two Voronoi layers, take the bright ridges
        float voro(vec2 p, float t){ vec2 i=floor(p), f=fract(p); float m1=8.0, m2=8.0;
          for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 g=vec2(x,y);
            vec2 o=0.5+0.5*sin(t+6.2831*vec2(h21(i+g), h21(i+g+17.0)));
            float d=length(g+o-f); if(d<m1){m2=m1;m1=d;} else if(d<m2){m2=d;} }
          return m2-m1; }
        float caustic(vec2 p, float t){
          float a = voro(p*0.42, t*1.1), b = voro(p*0.42*1.37+vec2(5.2,1.3), -t*0.9);
          return pow(smoothstep(0.16, 0.0, a) + smoothstep(0.16, 0.0, b), 1.4) * 0.6; }
        vec3 triW(vec3 n){ vec3 w = pow(abs(n), vec3(4.0)); return w / (w.x + w.y + w.z); }
        vec4 triTex(sampler2D t, vec3 p, vec3 w, float s){
          return texture2D(t, p.zy*s)*w.x + texture2D(t, p.xz*s)*w.y + texture2D(t, p.xy*s)*w.z; }
        // whiteout-blended triplanar normal mapping (world space)
        vec3 triNrm(sampler2D t, vec3 p, vec3 n, vec3 w, float s, float str){
          vec3 tx = texture2D(t, p.zy*s).xyz*2.0-1.0, ty = texture2D(t, p.xz*s).xyz*2.0-1.0, tz = texture2D(t, p.xy*s).xyz*2.0-1.0;
          tx.xy *= str; ty.xy *= str; tz.xy *= str;
          vec3 sg = sign(n);
          tx.z *= sg.x; ty.z *= sg.y; tz.z *= sg.z;
          tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
          ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
          tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
          return normalize(tx.zyx*w.x + ty.xzy*w.y + tz.xyz*w.z); }
        vec3 gMatW; vec3 gWN;`)
      .replace('#include <map_fragment>', `
        vec3 P = vWPos; vec3 Nw = normalize(vWNrm);
        // projection weights from the true face orientation: smooth vertex normals
        // across terrace risers would pick the top projection and smear the texture
        vec3 Ng = normalize(cross(dFdx(P), dFdy(P)));
        if (dot(Ng, Nw) < 0.0) Ng = -Ng;
        vec3 W = triW(normalize(mix(Nw, Ng, 0.85)));
        float nz = vn(P.xz*0.045)*0.6 + vn(P.xz*0.19)*0.4;
        float slope = Nw.y;
        float sandW = 1.0 - smoothstep(2.6, 5.2, P.y + nz*2.6);
        float rockW = max(smoothstep(0.80, 0.60, slope + nz*0.08), smoothstep(48.0, 75.0, P.y + nz*20.0) * 0.55);
        float reef = (1.0 - smoothstep(-0.2, 0.8, P.y)) * smoothstep(0.55, 0.75, vn(P.xz*0.035)*0.7 + vn(P.xz*0.12)*0.3);
        rockW = max(rockW, reef);
        sandW *= (1.0 - rockW);
        float grassW = max(1.0 - rockW - sandW, 0.0);
        gMatW = vec3(rockW, grassW, sandW);
        vec3 rock = mix(triTex(tRockD, P, W, 0.018).rgb, triTex(tRockD, P, W, 0.07).rgb, 0.4);
        float rl = dot(rock, vec3(0.3,0.59,0.11));
        // limestone: bleach the mossy rock toward grey, add strata bands and rain streaks
        float cliff = smoothstep(0.75, 0.35, slope);
        float bands = sin(P.y * 0.9 + nz * 3.0) * 0.5 + 0.5;
        float fine = sin(P.y * 4.1 + vn(P.xz * 0.2) * 6.0) * 0.5 + 0.5;
        float strata = mix(1.0, 0.72 + 0.4 * bands * (0.75 + 0.25 * fine), cliff);
        float streak = vn(vec2((P.x + P.z) * 0.35, P.y * 0.015)) * vn(vec2((P.x - P.z) * 0.9, P.y * 0.04));
        rock = mix(rock, vec3(rl) * vec3(1.05, 1.04, 1.0), 0.6) * strata * 1.25;
        rock *= mix(1.0, 0.62, smoothstep(0.35, 0.7, streak) * cliff);
        // moss and grass hold on the ledges and the crown
        float ledge = smoothstep(0.55, 0.8, slope) * smoothstep(4.0, 9.0, P.y);
        vec3 grass = mix(texture2D(tGrassD, P.xz*0.06).rgb, texture2D(tGrassD, P.xz*0.013).rgb, 0.45);
        grass *= vec3(0.78, 1.0, 0.62);
        vec3 sand = mix(texture2D(tSandD, P.xz*0.11).rgb, texture2D(tSandD, P.xz*0.027).rgb, 0.5) * vec3(1.12, 1.08, 1.0);
        // swash: the wet line creeps up and back down the beach with the surf
        float swash = 0.25 + 0.55 * (0.5 + 0.5 * sin(uTime * 0.85 + dot(P.xz, vec2(0.021, 0.017)) + nz * 2.0));
        float wet = max(1.0 - smoothstep(0.1, 1.4, P.y), 1.0 - smoothstep(swash, swash + 0.35, P.y));
        sand *= mix(1.0, 0.62, wet);
        rock = mix(rock, grass * 0.85, ledge * smoothstep(0.35, 0.6, vn(P.xz * 0.08 + P.y * 0.05)) * 0.85);
        vec3 alb = rock*rockW + grass*grassW + sand*sandW;
        diffuseColor.rgb = alb;`)
      .replace('#include <roughnessmap_fragment>', `
        float rR = triTex(tRockR, P, W, 0.055).r;
        float gR = texture2D(tGrassR, P.xz*0.06).r;
        float sR = texture2D(tSandR, P.xz*0.11).r;
        float roughnessFactor = clamp(rR*gMatW.x + gR*gMatW.y + sR*gMatW.z, 0.35, 1.0);
        roughnessFactor = mix(roughnessFactor, 0.28, wet * gMatW.z);`)
      .replace('#include <normal_fragment_maps>', `
        vec3 nR = triNrm(tRockN, P, Nw, W, 0.055, 1.3);
        vec3 nG = triNrm(tGrassN, P, Nw, vec3(0.0,1.0,0.0) * 0.999 + W*0.001, 0.06, 1.0);
        vec3 nS = triNrm(tSandN, P, Nw, vec3(0.0,1.0,0.0) * 0.999 + W*0.001, 0.11, 0.8);
        vec3 nW = normalize(nR*gMatW.x + nG*gMatW.y + nS*gMatW.z);
        gWN = nW;
        normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // sunlight focused by the waves onto the sea floor
        float depthBelow = -P.y;
        if (depthBelow > -0.3) {
          float cz = caustic(P.xz + uSunDir.xz * depthBelow * 0.6, uTime);
          float fadeC = smoothstep(-0.3, 0.6, depthBelow) * exp(-max(depthBelow, 0.0) * 0.07);
          float sunUp = max(uSunDir.y, 0.0);
          totalEmissiveRadiance += diffuseColor.rgb * uSunColor * cz * fadeC * sunUp * 2.2;
        }`);
  };
  mat.customProgramCacheKey = () => 'terrain-tri-v1';
  return mat;
}

export function buildTerrain(material, onProgress) {
  const SIZE = 2200, SEG = 880;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, terrainHeight(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals();
  onProgress?.();
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

// Low-detail karst islets toward the horizon so the archipelago keeps going.
export function buildFarIslets(material) {
  const group = new THREE.Group();
  const r = (() => { let a = 99; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  for (let i = 0; i < 14; i++) {
    const ang = r() * Math.PI * 2, dist = 1350 + r() * 2600;
    const I = { x: 0, z: 0, h: 30 + r() * 120, r: 40 + r() * 90 };
    const S = I.r * 4, seg = 96;
    const g = new THREE.PlaneGeometry(S, S, seg, seg);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    const ox = r() * 1000, oz = r() * 1000;
    for (let k = 0; k < p.count; k++) p.setY(k, karst(p.getX(k) + ox * 0, p.getZ(k), { ...I, x: 0, z: 0 }) * 1 + fbm((p.getX(k) + ox) * 0.02, (p.getZ(k) + oz) * 0.02, 3) * 3);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.position.set(Math.cos(ang) * dist, 0, Math.sin(ang) * dist);
    m.rotation.y = r() * 6.28;
    group.add(m);
  }
  return group;
}

export function buildShoreRocks(material, count = 90) {
  let geo = new THREE.IcosahedronGeometry(1, 4);
  geo.deleteAttribute('normal'); geo.deleteAttribute('uv');
  geo = mergeVertices(geo); // shared vertices -> smooth normals instead of facets
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = perlin.noise(v.x * 1.6, v.y * 1.6, v.z * 1.6) * 0.35 + perlin.noise(v.x * 4, v.y * 4, v.z * 4) * 0.1;
    v.multiplyScalar(1 + n); v.y *= 0.65;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(geo, material, count);
  const d = new THREE.Object3D();
  let seed = 5, placed = 0;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let t = 0; t < 40000 && placed < count; t++) {
    const x = (rnd() - 0.5) * 1700, z = (rnd() - 0.5) * 1700, h = terrainHeight(x, z);
    if (h < -2.5 || h > 1.2) continue;
    if (terrainNormal(x, z).y > 0.97 && rnd() < 0.85) continue;
    const s = 0.8 + rnd() * rnd() * 4.5;
    d.position.set(x, h + s * 0.1, z);
    d.rotation.set(rnd() * 0.4, rnd() * 6.28, rnd() * 0.4);
    d.scale.set(s * (1 + rnd() * 0.7), s, s * (0.8 + rnd() * 0.5));
    d.updateMatrix();
    mesh.setMatrixAt(placed++, d.matrix);
  }
  mesh.count = placed;
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
