// Ocean surface: camera-following polar grid displaced by the shared Gerstner spectrum.
// Shading uses the opaque scene rendered first (colour + depth) for refraction and
// water-thickness absorption, the HDR sky for reflection, Jacobian foam, shore surf,
// the boat wake, and a Snell's-window view from below.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GERSTNER_GLSL } from './waves.js';

export const WAKE_POINTS = 28;

function polarGrid(radial = 240, angular = 384, rMax = 9000, r0 = 3.5) {
  const a = Math.log(1 + rMax / r0) / radial;
  const pos = [];
  for (let i = 0; i <= radial; i++) {
    const r = r0 * (Math.exp(a * i) - 1);
    for (let j = 0; j < angular; j++) {
      const t = (j / angular) * Math.PI * 2;
      pos.push(Math.cos(t) * r, 0, Math.sin(t) * r);
    }
  }
  const idx = [];
  for (let i = 0; i < radial; i++) for (let j = 0; j < angular; j++) {
    const a0 = i * angular + j, a1 = i * angular + ((j + 1) % angular);
    const b0 = a0 + angular, b1 = a1 + angular;
    idx.push(a0, a1, b0, a1, b1, b0); // counter-clockwise seen from above (+Y)
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

export function createOcean(waves, shared, env) {
  const uniforms = {
    ...waves.glslUniforms(),
    uTime: shared.uTime,
    uSunDir: shared.uSunDir, uSunColor: shared.uSunColor,
    uUnder: shared.uUnder,
    uEnv: { value: env.texture }, uEnvIntensity: { value: 1.0 },
    uFogColor: shared.uFogColor, uFogDensity: shared.uFogDensity,
    uUnderColor: shared.uUnderColor,
    tScene: { value: null }, tDepth: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uNear: { value: 0.5 }, uFar: { value: 12000 },
    tNormal: { value: null },
    tRefl: { value: null }, uReflMat: { value: new THREE.Matrix4() }, uReflOn: { value: 0 },
    uBoatInv: { value: new THREE.Matrix4() }, uBoatOn: { value: 0 },
    uWake: { value: Array.from({ length: WAKE_POINTS }, () => new THREE.Vector4(0, 0, 99, 0)) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      ${GERSTNER_GLSL}
      uniform float uTime;
      varying vec3 vWorld; varying vec2 vP0; varying float vViewZ;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec2 p0 = wp.xz;
        float dist = length(p0 - cameraPosition.xz);
        // drop wavelengths shorter than ~4 grid cells at this distance
        float minWl = max(0.6, dist * 0.045 + abs(cameraPosition.y) * 0.02);
        vec3 d, n; float j;
        gerstner(p0, uTime, minWl, d, n, j);
        wp.xyz += d;
        vWorld = wp.xyz; vP0 = p0;
        vec4 mv = viewMatrix * wp;
        vViewZ = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <packing>
      ${GERSTNER_GLSL}
      #define WAKE_POINTS ${WAKE_POINTS}
      uniform float uTime, uUnder, uEnvIntensity, uFogDensity, uNear, uFar, uBoatOn;
      uniform vec3 uSunDir, uSunColor, uFogColor, uUnderColor;
      uniform sampler2D uEnv, tScene, tDepth, tNormal, tRefl;
      uniform mat4 uReflMat; uniform float uReflOn;
      uniform vec2 uRes;
      uniform mat4 uBoatInv;
      uniform vec4 uWake[WAKE_POINTS];
      varying vec3 vWorld; varying vec2 vP0; varying float vViewZ;

      vec3 sampleSky(vec3 dir){
        dir = normalize(dir);
        float u = atan(dir.z, dir.x) * RECIPROCAL_PI2 + 0.5;
        float v = asin(clamp(dir.y, -1.0, 1.0)) * RECIPROCAL_PI + 0.5;
        return texture2D(uEnv, vec2(u, v)).rgb * uEnvIntensity;
      }
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
      float foamTex(vec2 p, float t){
        float a = vn(p*0.9 + vec2(t*0.11, 0.0)) * 0.5 + vn(p*2.3 - vec2(0.0, t*0.17)) * 0.3 + vn(p*6.1 + t*0.05) * 0.2;
        return a; }
      // foam lace: bright Voronoi cell borders, like bubbles packing on the surface
      float lace(vec2 p, float t){
        vec2 i = floor(p), f = fract(p); float m1 = 8.0, m2 = 8.0;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec2 g = vec2(x, y);
          vec2 o = 0.5 + 0.45 * sin(t + 6.2831 * vec2(h21(i + g), h21(i + g + 23.1)));
          float d = length(g + o - f);
          if (d < m1) { m2 = m1; m1 = d; } else if (d < m2) { m2 = d; }
        }
        return 1.0 - smoothstep(0.02, 0.16, m2 - m1);
      }
      float sceneLinear(vec2 uv){ return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar); }

      float hullHalfWidth(float u){ // u: 0 stern .. 1 bow (mirrors boat.js)
        float w = u < 0.72 ? 0.86 + 0.14 * sin(u / 0.72 * 1.5708) : pow(max(cos((u - 0.72) / 0.28 * 1.5708), 0.0), 0.75);
        return 1.3 * w; }

      void main(){
        // keep water out of the hull
        if (uBoatOn > 0.5) {
          vec3 lb = (uBoatInv * vec4(vWorld, 1.0)).xyz;
          float u = lb.x / 7.2 + 0.5;
          if (u > 0.0 && u < 1.0 && abs(lb.z) < hullHalfWidth(u) * 0.96 && lb.y < 0.6) discard;
        }
        vec2 suv = gl_FragCoord.xy / uRes;
        float waterZ = vViewZ;
        float sceneZ = sceneLinear(suv);
        bool below = !gl_FrontFacing;
        if (sceneZ < waterZ - 0.05) discard; // opaque object in front of the water

        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;

        vec3 gd, gn; float jac;
        float minWl = max(0.25, dist * 0.004);
        gerstner(vP0, uTime, minWl, gd, gn, jac);
        // micro detail from two scrolling normal maps, faded with distance
        float df = 1.0 / (1.0 + dist * 0.012);
        vec2 q = vWorld.xz;
        vec3 n1 = texture2D(tNormal, q / 11.0 + vec2(uTime * 0.021, uTime * 0.013)).xzy * 2.0 - 1.0;
        vec3 n2 = texture2D(tNormal, q / 29.0 - vec2(uTime * 0.012, -uTime * 0.017)).xzy * 2.0 - 1.0;
        vec3 N = normalize(gn + vec3(n1.x + n2.x, 0.0, n1.z + n2.z) * 0.45 * df);

        float sunUp = clamp(uSunDir.y * 3.0, 0.0, 1.0);
        vec3 col;

        if (below) {
          // looking up from under water: Snell's window shows the sky inside ~48.6 deg,
          // total internal reflection mirrors the depths outside it
          vec3 Nd = -N;
          vec3 I = -V;
          vec3 T = refract(I, Nd, 1.333);
          float cosI = abs(dot(I, Nd));
          vec3 deep = uUnderColor * (0.35 + 0.65 * sunUp);
          if (dot(T, T) > 0.0) {
            float edge = smoothstep(0.66, 0.9, 1.0 - cosI);  // fresnel rises toward the critical angle
            col = mix(sampleSky(T) * 1.15, deep * 1.3, edge);
            col += uSunColor * pow(max(dot(normalize(T), uSunDir), 0.0), 220.0) * 6.0 * sunUp;
          } else {
            col = deep * (0.55 + 0.6 * pow(abs(N.y), 6.0));
          }
          float fogU = 1.0 - exp(-dist * 0.035);
          col = mix(col, uUnderColor * (0.5 + 0.5 * sunUp), fogU);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          return;
        }

        float NdV = max(dot(N, V), 0.001);
        float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);

        // refraction through the water body using the opaque scene
        float thick = max(sceneZ - waterZ, 0.0);
        vec2 off = N.xz * 0.045 * clamp(thick / 4.0, 0.0, 1.0) / (1.0 + dist * 0.01);
        vec2 ruv = clamp(suv + off, vec2(0.001), vec2(0.999));
        float sceneZ2 = sceneLinear(ruv);
        if (sceneZ2 < waterZ) { ruv = suv; sceneZ2 = sceneZ; }
        float path = max(sceneZ2 - waterZ, 0.0);
        // approximate vertical depth for absorption tint
        float vdepth = path * clamp(V.y + 0.15, 0.15, 1.0);
        vec3 refr = texture2D(tScene, ruv).rgb;
        vec3 absorb = exp(-vec3(0.42, 0.075, 0.045) * path);
        vec3 scatter = vec3(0.012, 0.115, 0.135) * (0.25 + 0.75 * sunUp) * (uSunColor * 0.35 + 0.35);
        // sunlit crest scattering: light passing through thin wave tips
        float sss = pow(max(dot(V, -uSunDir) * 0.5 + 0.5, 0.0), 4.0) * max(gd.y, 0.0) * 0.6;
        scatter += vec3(0.02, 0.18, 0.16) * sss * sunUp;
        vec3 water = refr * absorb + scatter * (1.0 - exp(-path * 0.22));

        // sky reflection
        vec3 R = reflect(-V, N);
        R.y = max(R.y, 0.015);
        vec3 refl = sampleSky(R);
        if (uReflOn > 0.5) {
          // planar reflection of islands / boat, distorted by the surface normal
          vec4 rc = uReflMat * vec4(vWorld.x, 0.0, vWorld.z, 1.0);
          vec2 rp = rc.xy / rc.w + N.xz * (0.11 + 0.05 * uChop) / (1.0 + dist * 0.003);
          vec4 rr = texture2D(tRefl, clamp(rp, vec2(0.001), vec2(0.999)));
          refl = mix(refl, rr.rgb, rr.a * 0.68);
        }

        col = mix(water, refl, F);

        // sun glint (GGX)
        vec3 L = normalize(uSunDir);
        vec3 H = normalize(L + V);
        float rough = 0.05 + min(dist * 0.00012, 0.15);
        float a2 = rough * rough * rough * rough;
        float NdH = max(dot(N, H), 0.0);
        float dd = NdH * NdH * (a2 - 1.0) + 1.0;
        float D = a2 / (PI * dd * dd);
        float NdL = max(dot(N, L), 0.0);
        col += uSunColor * D * F * NdL / (4.0 * NdV + 0.001) * sunUp * 1.4;

        // foam: breaking crests (Jacobian), shore surf, boat wake
        float ft = foamTex(q * 0.55, uTime);
        float crest = smoothstep(0.78, 0.2, jac) * smoothstep(0.3, 0.62, ft);
        float shoreZone = 1.0 - smoothstep(0.0, 2.4, vdepth);
        float band = 0.5 + 0.5 * sin(vdepth * 3.2 - uTime * 1.6 + ft * 4.0);
        float shore = shoreZone * smoothstep(0.42, 0.78, band * 0.75 + ft * 0.45);
        shore += (1.0 - smoothstep(0.0, 0.35, vdepth)) * 0.8 * ft;
        float wake = 0.0;
        for (int i = 0; i < WAKE_POINTS - 1; i++) {
          vec4 A = uWake[i], B = uWake[i + 1];
          if (A.z > 30.0 || B.z > 30.0) continue;
          vec2 ab = B.xy - A.xy; float L2 = max(dot(ab, ab), 1e-4);
          float h = clamp(dot(q - A.xy, ab) / L2, 0.0, 1.0);
          float d = length(q - (A.xy + ab * h));
          float age = mix(A.z, B.z, h);
          float life = 1.0 - smoothstep(0.0, 12.0, age);
          float spread = 0.9 + age * 0.55;
          float centre = exp(-pow(d / (0.8 + age * 0.22), 2.0)) * smoothstep(0.0, 0.4, age);
          float arm = exp(-pow((d - spread) / (0.5 + age * 0.08), 2.0)) * 0.75;
          wake = max(wake, (centre + arm) * life);
        }
        wake *= smoothstep(0.25, 0.6, foamTex(q * 1.7, uTime * 2.0) + 0.25);
        float cover = clamp(crest * 0.95 + shore + wake, 0.0, 1.5);
        float pat = lace(q * 0.85, uTime * 0.35) * 0.6 + lace(q * 2.6 + 7.0, uTime * 0.5) * 0.4;
        // dense core where coverage is high, lacy bubbles at the fringes
        float foam = clamp(cover * 1.35 - (1.0 - pat) * 0.75, 0.0, 1.0);
        foam = max(foam, smoothstep(0.9, 1.3, cover)) * (0.25 + 0.75 / (1.0 + dist * 0.004)) + cover * 0.25 * (1.0 - 1.0 / (1.0 + dist * 0.004));
        foam = clamp(foam, 0.0, 1.0);
        vec3 foamLit = vec3(0.92, 0.95, 0.97) * (uSunColor * (NdL * 0.75 + 0.15) * sunUp + sampleSky(vec3(0.0, 1.0, 0.0)) * 0.55);
        col = mix(col, foamLit, foam * 0.92);

        // aerial perspective
        float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
        col = mix(col, uFogColor, fogF);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(polarGrid(), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return mesh;
}

// Renders the opaque world to an HDR target with depth, then composites the ocean
// (which samples that colour/depth) and finally an overlay scene (spray, particles).
export class WaterScenePass extends Pass {
  constructor(scene, oceanScene, overlayScene, camera, ocean) {
    super();
    this.scene = scene; this.oceanScene = oceanScene; this.overlayScene = overlayScene;
    this.camera = camera; this.ocean = ocean;
    this.needsSwap = false;
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(1, 1) });
    // mirrored camera for the planar reflection (half resolution)
    this.reflRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.reflCam = new THREE.PerspectiveCamera();
    this.clip = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.4)];
    this.under = false;
    this._v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    this._cc = new THREE.Color();
    this.bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.copy = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tDiffuse, vUv); }',
      depthTest: false, depthWrite: false,
    }));
  }
  setSize(w, h) {
    this.rt.setSize(w, h);
    this.reflRT.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
    this.ocean.material.uniforms.uRes.value.set(w, h);
  }
  render(renderer, writeBuffer, readBuffer) {
    const u = this.ocean.material.uniforms;
    if (!this.under) this.renderReflection(renderer, u);
    u.uReflOn.value = this.under ? 0 : 1;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    u.tScene.value = this.rt.texture;
    u.tDepth.value = this.rt.depthTexture;
    u.uNear.value = this.camera.near; u.uFar.value = this.camera.far;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clear();
    this.copy.material.uniforms.tDiffuse.value = this.rt.texture;
    this.copy.render(renderer);
    const ac = renderer.autoClear; renderer.autoClear = false;
    renderer.render(this.oceanScene, this.camera);
    renderer.render(this.overlayScene, this.camera);
    renderer.autoClear = ac;
  }
  renderReflection(renderer, u) {
    const cam = this.camera, rc = this.reflCam, [p, d, t] = this._v;
    cam.getWorldPosition(p); cam.getWorldDirection(d);
    t.copy(p).add(d);
    p.y = -p.y; t.y = -t.y;
    rc.position.copy(p);
    rc.up.set(0, 1, 0).applyQuaternion(cam.quaternion); rc.up.y = -rc.up.y;
    rc.lookAt(t);
    rc.near = cam.near; rc.far = cam.far;
    rc.updateMatrixWorld();
    rc.projectionMatrix.copy(cam.projectionMatrix);
    rc.matrixWorldInverse.copy(rc.matrixWorld).invert();
    u.uReflMat.value.copy(this.bias).multiply(rc.projectionMatrix).multiply(rc.matrixWorldInverse);
    const bg = this.scene.background, sa = renderer.shadowMap.autoUpdate;
    renderer.getClearColor(this._cc); const ca = renderer.getClearAlpha();
    this.scene.background = null;
    renderer.shadowMap.autoUpdate = false;  // reuse this frame's shadow map
    renderer.clippingPlanes = this.clip;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.reflRT);
    renderer.clear();
    renderer.render(this.scene, rc);
    renderer.clippingPlanes = [];
    renderer.setClearColor(this._cc, ca);
    renderer.shadowMap.autoUpdate = sa;
    renderer.shadowMap.needsUpdate = true;
    this.scene.background = bg;
    u.tRefl.value = this.reflRT.texture;
  }
  dispose() { this.rt.dispose(); this.reflRT.dispose(); this.copy.dispose(); }
}
