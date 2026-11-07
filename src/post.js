// Final look pass (linear HDR, before tone mapping): underwater tint + light shafts,
// lens droplets after the camera breaks the surface, grade, vignette and cut fades.
import * as THREE from 'three';

export const LookShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 }, uUnder: { value: 0 }, uDrops: { value: 0 }, uFade: { value: 0 },
    uSun: { value: new THREE.Vector2(0.5, 0.8) }, uSunOn: { value: 0 },
    uUnderColor: { value: new THREE.Color() }, uAspect: { value: 1 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uUnder, uDrops, uFade, uSunOn, uAspect;
    uniform vec2 uSun; uniform vec3 uUnderColor;
    varying vec2 vUv;
    float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    vec2 h22(vec2 p){ return vec2(h21(p), h21(p + 19.19)); }

    // water drops on the lens: returns uv offset and a highlight mask
    vec3 drops(vec2 uv, float t, float amount){
      vec2 acc = vec2(0.0); float hl = 0.0;
      for (int layer = 0; layer < 3; layer++){
        float sc = 7.0 + float(layer) * 5.0;
        vec2 p = uv * vec2(uAspect, 1.0) * sc;
        p.y += t * (0.25 + 0.2 * float(layer));       // drops slide down
        vec2 id = floor(p), f = fract(p) - 0.5;
        vec2 rnd = h22(id + float(layer) * 7.0);
        if (rnd.x > amount * 0.85) continue;
        vec2 c = (rnd - 0.5) * 0.6;
        float r = 0.12 + 0.18 * h21(id + 3.1);
        vec2 d = f - c; d.y *= 1.0 + 0.6 * abs(d.y);
        float m = smoothstep(r, r * 0.6, length(d));
        acc += -d * m * 0.9 / sc;
        hl += m * smoothstep(0.0, r, -d.y + d.x * 0.3) * 0.25;
        // trail above the drop
        float trail = smoothstep(r * 0.35, 0.0, abs(f.x - c.x)) * smoothstep(c.y, c.y + 0.5, f.y) * 0.25;
        acc += vec2(0.0, trail * 0.02 / sc);
      }
      return vec3(acc, hl);
    }

    void main(){
      vec2 uv = vUv;
      float t = uTime;
      if (uUnder > 0.0) {
        uv += vec2(sin(uv.y * 22.0 + t * 1.7), cos(uv.x * 19.0 + t * 1.3)) * 0.0028 * uUnder;
      }
      vec3 dr = vec3(0.0);
      if (uDrops > 0.001) { dr = drops(vUv, t, uDrops); uv += dr.xy * uDrops; }
      vec3 col = texture2D(tDiffuse, uv).rgb;
      if (uUnder > 0.0) {
        // crepuscular shafts: radial blur toward the sun's screen position
        vec2 dir = (uSun - uv) / 28.0;
        vec2 s = uv; float shafts = 0.0, w = 1.0;
        for (int i = 0; i < 28; i++){ s += dir; vec3 c = texture2D(tDiffuse, s).rgb; shafts += dot(c, vec3(0.33)) * w; w *= 0.95; }
        shafts /= 14.0;
        float upness = smoothstep(0.2, 1.0, uv.y);
        col = mix(col, uUnderColor * 1.4, 0.35 * uUnder);
        col += uUnderColor * shafts * 0.9 * uSunOn * uUnder * upness;
        col *= mix(1.0, 0.55 + 0.45 * uv.y, uUnder);
      }
      col += dr.z * uDrops * 0.6;
      // grade: gentle contrast + saturation in linear light
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, 1.12);
      col = pow(max(col, 0.0), vec3(1.04));
      vec2 vc = vUv - 0.5;
      col *= 1.0 - dot(vc, vc) * 0.55;
      col *= 1.0 - uFade;
      gl_FragColor = vec4(col, 1.0);
    }`,
};
