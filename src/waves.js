// Shared Gerstner wave spectrum: the same numbers drive the GPU ocean surface
// and the CPU sampler used by the boat (buoyancy) and the camera (underwater test).
import * as THREE from 'three';

export const WAVE_COUNT = 32;
const G = 9.81;

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class WaveField {
  constructor() {
    this.windAngle = 0.55; // radians, direction waves travel toward
    this.chop = 1.0;
    // packed for the shader: A = (dirX, dirZ, k, omega), B = (amp, phase, wavelength, 0)
    this.a = Array.from({ length: WAVE_COUNT }, () => new THREE.Vector4());
    this.b = Array.from({ length: WAVE_COUNT }, () => new THREE.Vector4());
    this.setStrength(1);
  }

  // strength ~ 0.3 (calm) .. 1.6 (rough). Equal steepness per band, Beaufort-ish.
  setStrength(s) {
    this.strength = s;
    const r = mulberry32(1337);
    const steepTotal = Math.min(0.15 + 0.62 * s, 1.05);
    for (let i = 0; i < WAVE_COUNT; i++) {
      const wl = 150 * Math.pow(0.845, i); // 150 m swell down to ~0.8 m chop
      const k = (2 * Math.PI) / wl;
      const omega = Math.sqrt(G * k);
      const spread = 0.35 + 0.9 * (i / WAVE_COUNT);
      const ang = this.windAngle + (r() - 0.5) * 2 * spread;
      const steep = (steepTotal / WAVE_COUNT) * (0.55 + r() * 0.9);
      const amp = steep / k;
      this.a[i].set(Math.cos(ang), Math.sin(ang), k, omega);
      this.b[i].set(amp, r() * Math.PI * 2, wl, 0);
    }
    this.chop = 0.75 + 0.35 * Math.min(s, 1.2);
  }

  // Displacement of an undisturbed surface point p0 = (x, z) at time t.
  displace(x, z, t, out) {
    let dx = 0, dy = 0, dz = 0;
    for (let i = 0; i < WAVE_COUNT; i++) {
      const A = this.a[i], B = this.b[i];
      const f = A.z * (A.x * x + A.y * z) - A.w * t + B.y;
      const c = Math.cos(f), s = Math.sin(f);
      dy += B.x * c;
      dx -= this.chop * A.x * B.x * s;
      dz -= this.chop * A.y * B.x * s;
    }
    out.set(dx, dy, dz);
    return out;
  }

  // Water surface height at world (x, z): invert the horizontal displacement.
  heightAt(x, z, t) {
    const d = this._tmp || (this._tmp = new THREE.Vector3());
    let px = x, pz = z;
    for (let it = 0; it < 4; it++) {
      this.displace(px, pz, t, d);
      px = x - d.x; pz = z - d.z;
    }
    this.displace(px, pz, t, d);
    return d.y;
  }

  glslUniforms() {
    return { uWaveA: { value: this.a }, uWaveB: { value: this.b }, uChop: { value: this.chop } };
  }
}

// GLSL mirror of WaveField.displace plus analytic derivatives (normal + Jacobian).
// `fade` removes waves shorter than the local grid/pixel footprint to stop aliasing.
export const GERSTNER_GLSL = /* glsl */ `
  #define WAVE_COUNT ${WAVE_COUNT}
  uniform vec4 uWaveA[WAVE_COUNT];
  uniform vec4 uWaveB[WAVE_COUNT];
  uniform float uChop;

  void gerstner(vec2 p, float t, float minWl, out vec3 disp, out vec3 nrm, out float jac) {
    disp = vec3(0.0);
    float dydx = 0.0, dydz = 0.0, dXdx = 1.0, dZdz = 1.0, dXdz = 0.0;
    for (int i = 0; i < WAVE_COUNT; i++) {
      vec4 A = uWaveA[i]; vec4 B = uWaveB[i];
      float w = smoothstep(minWl, minWl * 2.0, B.z);
      if (w <= 0.0) continue;
      float amp = B.x * w;
      float f = A.z * dot(A.xy, p) - A.w * t + B.y;
      float c = cos(f), s = sin(f);
      disp.y += amp * c;
      disp.xz -= uChop * A.xy * amp * s;
      float ka = A.z * amp;
      dydx -= ka * A.x * s;
      dydz -= ka * A.y * s;
      dXdx -= uChop * ka * A.x * A.x * c;
      dZdz -= uChop * ka * A.y * A.y * c;
      dXdz -= uChop * ka * A.x * A.y * c;
    }
    vec3 tx = vec3(dXdx, dydx, dXdz);
    vec3 tz = vec3(dXdz, dydz, dZdz);
    nrm = normalize(cross(tz, tx));
    jac = dXdx * dZdz - dXdz * dXdz;
  }
`;
