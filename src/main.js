import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { WaveField } from './waves.js';
import { createOcean, WaterScenePass } from './ocean.js';
import { createTerrainMaterial, buildTerrain, buildFarIslets, buildShoreRocks, terrainHeight, terrainNormal, ISLANDS } from './terrain.js';
import { buildBoat, BoatSim } from './boat.js';
import { buildShots, Director } from './cinematic.js';
import { LookShader } from './post.js';

const $ = (id) => document.getElementById(id);
const loadText = $('loadText'), loadBar = $('loadBar');
console.info(`module start ${performance.now().toFixed(0)} ms`);
const fail = (msg, e) => { $('err').textContent = msg; console.error(e); };

const canvas = $('c');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (e) { fail("WebGL2 ishga tushmadi — brauzer yoki video drayverni yangilang.", e); throw e; }
const DPR = Math.min(window.devicePixelRatio, 1.5);
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.shadowMap.enabled = true;
renderer.info.autoReset = false;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const oceanScene = new THREE.Scene();
const overlayScene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.3, 12000);
camera.position.set(180, 40, 420);

// shared uniforms (same objects referenced by several shaders)
const shared = {
  uTime: { value: 0 }, uUnder: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.4, 0.6, 0.3).normalize() }, uSunColor: { value: new THREE.Color(1, 0.96, 0.9) },
  uFogColor: { value: new THREE.Color(0.75, 0.82, 0.9) }, uFogDensity: { value: 0.00032 },
  uUnderColor: { value: new THREE.Color(0.02, 0.16, 0.2) },
};

const manager = new THREE.LoadingManager();
manager.onProgress = (url, done, total) => { loadBar.style.width = `${(done / total) * 85}%`; loadText.textContent = `Assetlar yuklanmoqda… ${done}/${total}`; };
manager.onError = (url) => fail(`Yuklanmadi: ${url}`);
const texLoader = new THREE.TextureLoader(manager);

function findSun(tex) {
  // brightest region of the equirect HDR = sun direction; also average horizon colour for fog
  const { data, width: W, height: H } = tex.image;
  const half = data instanceof Uint16Array;
  const rd = (i) => (half ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i]);
  let best = -1, bx = 0, by = 0;
  for (let y = 0; y < H / 2; y += 2) for (let x = 0; x < W; x += 2) {
    const i = (y * W + x) * 4, l = rd(i) * 0.2126 + rd(i + 1) * 0.7152 + rd(i + 2) * 0.0722;
    if (l > best) { best = l; bx = x; by = y; }
  }
  const u = (bx + 0.5) / W, v = 1 - (by + 0.5) / H;
  const phi = (u - 0.5) * Math.PI * 2, lat = (v - 0.5) * Math.PI;
  const dir = new THREE.Vector3(Math.cos(phi) * Math.cos(lat), Math.sin(lat), Math.sin(phi) * Math.cos(lat));
  const hy = Math.floor(H * 0.47), fog = new THREE.Color(0, 0, 0);
  let n = 0;
  for (let x = 0; x < W; x += 8) { const i = (hy * W + x) * 4; fog.r += rd(i); fog.g += rd(i + 1); fog.b += rd(i + 2); n++; }
  fog.multiplyScalar(1 / n);
  return { dir, fog, peak: best };
}

async function main() {
  const waves = new WaveField();
  const gl = new GLTFLoader(manager);
  const [hdr, gltf, gltfFar] = await Promise.all([
    new RGBELoader(manager).loadAsync('assets/hdri/sky_4k.hdr'),
    gl.loadAsync('assets/models/tree.glb'),
    gl.loadAsync('assets/models/tree_far.glb'),
  ]);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const sun = findSun(hdr);
  shared.uSunDir.value.copy(sun.dir);
  shared.uFogColor.value.copy(sun.fog).multiplyScalar(0.95);
  scene.background = hdr;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  scene.environmentIntensity = 0.9;
  scene.fog = new THREE.FogExp2(shared.uFogColor.value.clone(), shared.uFogDensity.value);

  loadText.textContent = 'Orollar qurilmoqda…'; loadBar.style.width = '88%';
  await new Promise(r => setTimeout(r, 30)); // let the loading text paint (rAF stalls in background tabs)

  const terrainMat = createTerrainMaterial(texLoader, renderer, shared);
  const t0 = performance.now();
  const terrain = buildTerrain(terrainMat);
  console.info(`terrain built in ${(performance.now() - t0).toFixed(0)} ms`);
  scene.add(terrain, buildFarIslets(terrainMat), buildShoreRocks(terrainMat));

  // sunlight + shadows over the main islands
  const sunLight = new THREE.DirectionalLight(0xfff3e2, 3.2);
  sunLight.position.copy(sun.dir).multiplyScalar(1500);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(4096, 4096);
  Object.assign(sunLight.shadow.camera, { left: -560, right: 560, top: 560, bottom: -560, near: 100, far: 3200 });
  sunLight.shadow.bias = -0.0003; sunLight.shadow.normalBias = 0.8;
  scene.add(sunLight, sunLight.target);

  // trees (Poly Haven Island Tree 02, simplified) instanced over the beach island
  const spots = [];
  let seed = 21; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let t = 0; t < 30000 && spots.length < 50; t++) {
    const x = ISLANDS.beach.x + (rnd() - 0.5) * 520, z = ISLANDS.beach.z + (rnd() - 0.5) * 520, h = terrainHeight(x, z);
    if (h < 3.4 || h > 30 || terrainNormal(x, z).y < 0.86) continue;
    if (spots.some(s => (s.x - x) ** 2 + (s.z - z) ** 2 < 100)) continue;
    spots.push(new THREE.Vector3(x, h - 0.2, z));
  }
  const dmy = new THREE.Object3D();
  const treeMats = spots.map(p => {
    const sc = 2.4 + rnd() * 1.6;
    dmy.position.copy(p); dmy.rotation.set(0, rnd() * Math.PI * 2, 0); dmy.scale.setScalar(sc); dmy.updateMatrix();
    return dmy.matrix.clone();
  });
  const swayMat = (src) => {
    const mat = src.clone();
    mat.side = THREE.DoubleSide;
    if (mat.map && /leaf|leaves/i.test(mat.name + (mat.map.name || ''))) { mat.alphaTest = 0.45; mat.transparent = false; }
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = shared.uTime;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float ph = instanceMatrix[3].x * 0.11 + instanceMatrix[3].z * 0.07;
        float k = pow(max(position.y, 0.0) / 3.4, 2.0) * 0.06;
        transformed.x += sin(uTime * 1.3 + ph) * k; transformed.z += cos(uTime * 1.05 + ph) * k * 0.6;`);
    };
    return mat;
  };
  // near: full model; far: lighter model; shadows: light model on layer 1 (shadow camera only)
  const makeSet = (root, cast, layer) => {
    const parts = []; root.updateMatrixWorld(true);
    root.traverse(o => { if (o.isMesh) {
      const im = new THREE.InstancedMesh(o.geometry.clone().applyMatrix4(o.matrixWorld), swayMat(o.material), treeMats.length);
      im.castShadow = cast; im.receiveShadow = !cast || layer === 0;
      if (layer) { im.layers.set(layer); }
      im.frustumCulled = false;
      scene.add(im); parts.push(im);
    } });
    return parts;
  };
  const treeNear = makeSet(gltf.scene, false, 0), treeFar = makeSet(gltfFar.scene, false, 0), treeShadow = makeSet(gltfFar.scene, true, 1);
  treeShadow.forEach(im => { treeMats.forEach((m, i) => im.setMatrixAt(i, m)); im.instanceMatrix.needsUpdate = true; });
  sunLight.shadow.camera.layers.enable(1);
  const lodSplit = (camPos, near = 140) => {
    let n = 0, f = 0;
    treeMats.forEach((m, i) => {
      const d = tmpL.setFromMatrixPosition(m).distanceTo(camPos);
      if (d < near) { treeNear.forEach(im => im.setMatrixAt(n, m)); n++; } else { treeFar.forEach(im => im.setMatrixAt(f, m)); f++; }
    });
    treeNear.forEach(im => { im.count = n; im.instanceMatrix.needsUpdate = true; });
    treeFar.forEach(im => { im.count = f; im.instanceMatrix.needsUpdate = true; });
  };
  const tmpL = new THREE.Vector3();
  lodSplit(camera.position);

  // ocean
  const waterNormals = texLoader.load('assets/tex/waternormals.jpg');
  waterNormals.wrapS = waterNormals.wrapT = THREE.RepeatWrapping;
  const ocean = createOcean(waves, shared, { texture: hdr });
  ocean.material.uniforms.tNormal.value = waterNormals;
  oceanScene.add(ocean);

  // boat
  const boat = buildBoat();
  scene.add(boat);
  const boatSim = new BoatSim(boat, waves, overlayScene);
  ocean.material.uniforms.uWake.value = boatSim.wake;
  ocean.material.uniforms.uBoatOn.value = 1;

  // post chain
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, rt);
  const waterPass = new WaterScenePass(scene, oceanScene, overlayScene, camera, ocean);
  composer.addPass(waterPass);
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.5, 1.6));
  const look = new ShaderPass(LookShader);
  look.uniforms.uUnderColor.value = shared.uUnderColor.value;
  composer.addPass(look);
  composer.addPass(new OutputPass());
  const smaa = new SMAAPass(innerWidth * DPR, innerHeight * DPR);
  composer.addPass(smaa);
  const resize = () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    look.uniforms.uAspect.value = camera.aspect;
  };
  addEventListener('resize', resize); resize();

  // camera modes
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 4; controls.maxDistance = 2500;
  controls.enabled = false;
  const director = new Director(buildShots(boatSim));
  let mode = 'cine';
  const btn = { cine: $('btnCine'), free: $('btnFree'), boat: $('btnBoat') };
  const setMode = (m) => {
    mode = m;
    for (const k in btn) btn[k].setAttribute('aria-pressed', k === m);
    controls.enabled = m !== 'cine';
    if (m === 'free') controls.target.copy(director.state.look);
    $('mode').textContent = m === 'cine' ? 'Kino rejimi' : m === 'free' ? 'Erkin kamera' : 'Qayiq kuzatuvi';
  };
  btn.cine.onclick = () => setMode('cine');
  btn.free.onclick = () => setMode('free');
  btn.boat.onclick = () => { setMode('boat'); camera.position.copy(boatSim.pos).add(new THREE.Vector3(-14, 6, 8)); };
  const chips = $('chips');
  director.shots.forEach((s, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = String(i + 1); b.title = s.name;
    b.onclick = () => { director.jump(i); setMode('cine'); };
    chips.appendChild(b);
  });

  // sea state (Douglas scale)
  const SEA = [
    [0.12, '0 m', 'koʻzgudek shtil'], [0.25, '0–0,1 m', 'mayda jimirlash'], [0.42, '0,1–0,5 m', 'sokin'],
    [0.68, '0,5–1,25 m', 'yengil'], [0.95, '1,25–2,5 m', 'oʻrtacha'], [1.25, '2,5–4 m', 'notinch'], [1.55, '4–6 m', 'juda notinch'],
  ];
  const sea = $('sea');
  const setSea = () => {
    const [s, hgt, name] = SEA[+sea.value];
    waves.setStrength(s);
    ocean.material.uniforms.uChop.value = waves.chop;
    $('seaOut').textContent = `Duglas ${sea.value} · ${hgt} · ${name}`;
  };
  sea.addEventListener('input', setSea); setSea();

  // frame loop
  const clock = new THREE.Clock();
  let lodTimer = 0;
  let wasUnder = false, drops = 0, frames = 0, fpsT = 0, fps = 0;
  const sunScreen = new THREE.Vector3();
  const underFog = new THREE.FogExp2(shared.uUnderColor.value.clone(), 0.05);
  const airFog = scene.fog;
  const tmpV = new THREE.Vector3();

  console.info(`setup done at ${performance.now().toFixed(0)} ms`);
  const tc = performance.now();
  await renderer.compileAsync(scene, camera);
  await renderer.compileAsync(oceanScene, camera);
  console.info(`shaders compiled in ${(performance.now() - tc).toFixed(0)} ms`);
  $('loading').classList.add('done');

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 1 / 20);
    const t = clock.elapsedTime;
    renderer.info.reset();
    shared.uTime.value = t;
    boatSim.update(t, dt);
    ocean.material.uniforms.uBoatInv.value.copy(boatSim.inv);

    let fade = 0;
    if (mode === 'cine') {
      const info = director.update(dt, camera);
      fade = info.fade;
      $('shotName').textContent = info.name;
      $('shotIdx').textContent = `Kadr ${info.index + 1} / ${director.shots.length}`;
      $('shotBar').style.width = `${(info.local * 100).toFixed(1)}%`;
      [...chips.children].forEach((c, i) => c.setAttribute('aria-pressed', i === info.index));
    } else {
      if (mode === 'boat') {
        controls.target.lerp(tmpV.copy(boatSim.pos).setY(1.2), 0.2);
        const d = camera.position.distanceTo(controls.target);
        if (d > 40) camera.position.lerp(controls.target, 0.02);
      }
      controls.update();
      const ground = terrainHeight(camera.position.x, camera.position.z);
      if (camera.position.y < ground + 1.5) camera.position.y = ground + 1.5;
    }
    ocean.position.set(camera.position.x, 0, camera.position.z);
    if ((lodTimer += dt) > 0.3) { lodTimer = 0; lodSplit(camera.position); }

    // underwater state
    const surf = waves.heightAt(camera.position.x, camera.position.z, t);
    const under = camera.position.y < surf - 0.05;
    if (wasUnder && !under) drops = 1;
    wasUnder = under;
    drops = Math.max(0, drops - dt * 0.32);
    shared.uUnder.value = under ? 1 : 0;
    waterPass.under = under;
    scene.fog = under ? underFog : airFog;
    scene.background = under ? shared.uUnderColor.value : hdr;

    sunScreen.copy(camera.position).addScaledVector(shared.uSunDir.value, 1000).project(camera);
    look.uniforms.uSun.value.set(sunScreen.x * 0.5 + 0.5, sunScreen.y * 0.5 + 0.5);
    look.uniforms.uSunOn.value = sunScreen.z < 1 ? 1 : 0;
    look.uniforms.uTime.value = t;
    look.uniforms.uUnder.value = under ? 1 : 0;
    look.uniforms.uDrops.value = drops;
    look.uniforms.uFade.value = fade;

    // shadow frustum follows the camera's area of interest
    const focus = mode === 'cine' ? director.state.look : controls.target;
    tmpV.set(THREE.MathUtils.clamp(focus.x, -600, 600), 0, THREE.MathUtils.clamp(focus.z, -600, 600));
    sunLight.target.position.copy(tmpV);
    sunLight.position.copy(tmpV).addScaledVector(shared.uSunDir.value, 1500);

    composer.render(dt);

    frames++; fpsT += dt;
    if (fpsT > 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0;
      const info = renderer.info.render;
      $('stats').textContent = `${fps.toFixed(0)} FPS · ${(info.triangles / 1e6).toFixed(2)} M uchburchak · ${info.calls} draw call`; }
  });
  window.__orol = { renderer, scene, camera, waves, boatSim, director, setMode };
}

main().catch(e => fail(`Xato: ${e.message}`, e));
