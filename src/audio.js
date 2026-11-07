// Soundscape: real CC0 field recordings mixed live from the camera state.
// Air bus (sea, surf, wind, gulls, boat) runs through a low-pass that closes when the
// camera goes under water; the underwater bed fades in on its own bus. The boat engine,
// hull lapping, surf and gulls are positioned in 3D (HRTF) around the camera.
import * as THREE from 'three';

const FILES = {
  ocean: 'ocean', surf: 'surf', surfBig: 'surf_big', wind: 'wind', gust: 'gust',
  under: 'under', dive: 'dive', splash: 'splash', engine: 'engine', gulls: 'gulls', lap: 'lap',
};

const lerp = THREE.MathUtils.lerp, clamp = THREE.MathUtils.clamp;

export class SoundScape {
  constructor({ waves, boatSim, terrainHeight }) {
    this.waves = waves; this.boatSim = boatSim; this.terrainHeight = terrainHeight;
    this.ctx = null; this.on = false; this.ready = false;
    this.volume = 0.8;
    this.shoreTimer = 0; this.shore = { dist: 999, point: new THREE.Vector3() };
    this.gustTimer = 4; this.prevBoat = new THREE.Vector3(); this.prevCam = new THREE.Vector3();
    this._f = new THREE.Vector3(); this._u = new THREE.Vector3();
  }

  async enable() {
    if (!this.ctx) {
      const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = ctx.createGain(); this.master.gain.value = 0;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.3;
      this.master.connect(comp).connect(ctx.destination);
      this.airFilter = ctx.createBiquadFilter(); this.airFilter.type = 'lowpass'; this.airFilter.frequency.value = 20000; this.airFilter.Q.value = 0.5;
      this.airBus = ctx.createGain(); this.airBus.connect(this.airFilter).connect(this.master);
      this.waterBus = ctx.createGain(); this.waterBus.gain.value = 0; this.waterBus.connect(this.master);
      this.buffers = {};
      await Promise.all(Object.entries(FILES).map(async ([k, f]) => {
        const res = await fetch(`assets/audio/${f}.mp3`);
        if (!res.ok) throw new Error(`audio ${f}: HTTP ${res.status}`);
        this.buffers[k] = await ctx.decodeAudioData(await res.arrayBuffer());
      }));
      this.build();
      this.ready = true;
    }
    await this.ctx.resume();
    this.on = true;
    this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.4);
  }

  disable() {
    if (!this.ctx) return;
    this.on = false;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25);
    setTimeout(() => { if (!this.on) this.ctx.suspend(); }, 900);
  }

  setVolume(v) {
    this.volume = v;
    if (this.on) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }

  loop(buf, dest, { rate = 1, offset = Math.random() } = {}) {
    const ctx = this.ctx, src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf; src.loop = true; src.playbackRate.value = rate;
    g.gain.value = 0;
    src.connect(g).connect(dest);
    src.start(0, offset * buf.duration);
    return { src, g };
  }

  panner(dest, ref = 8, rolloff = 1.1, max = 2000) {
    const p = this.ctx.createPanner();
    Object.assign(p, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: ref, rolloffFactor: rolloff, maxDistance: max });
    p.connect(dest);
    return p;
  }

  build() {
    const B = this.buffers;
    // ambient beds (non-positional)
    this.ocean = this.loop(B.ocean, this.airBus);
    this.wind = this.loop(B.wind, this.airBus);
    this.under = this.loop(B.under, this.waterBus);
    this.under.g.gain.value = 1;
    // positional sources
    this.surfP = this.panner(this.airBus, 30, 0.9);
    this.surf = this.loop(B.surf, this.surfP);
    this.surfBig = this.loop(B.surfBig, this.surfP);
    this.engineP = this.panner(this.airBus, 6, 1.3);
    this.engine = this.loop(B.engine, this.engineP);
    this.lapP = this.panner(this.airBus, 3, 1.6);
    this.lap = this.loop(B.lap, this.lapP);
    this.gullsP = this.panner(this.airBus, 25, 1.0);
    this.gulls = this.loop(B.gulls, this.gullsP);
  }

  oneShot(buf, gain = 1, rate = 1) {
    if (!this.ready || !this.on) return;
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain();
    s.buffer = buf; s.playbackRate.value = rate; g.gain.value = gain;
    s.connect(g).connect(this.master);
    s.start();
  }

  // nearest coastline: march rays outward from the camera until the terrain crosses sea level
  findShore(cam) {
    let best = 999;
    const p = this.shore.point;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
      for (let r = 0; r < 420; r += 12) {
        if (this.terrainHeight(cam.x + dx * r, cam.z + dz * r) > -0.4) {
          if (r < best) { best = r; p.set(cam.x + dx * r, 0.5, cam.z + dz * r); }
          break;
        }
      }
    }
    this.shore.dist = best;
  }

  setPos(node, v) {
    const t = this.ctx.currentTime;
    node.positionX.setTargetAtTime(v.x, t, 0.05); node.positionY.setTargetAtTime(v.y, t, 0.05); node.positionZ.setTargetAtTime(v.z, t, 0.05);
  }

  update(dt, camera, s) {
    if (!this.ready || !this.on || dt <= 0) return;
    const ctx = this.ctx, t = ctx.currentTime, L = ctx.listener;
    const cam = camera.position;
    // listener follows the camera
    camera.getWorldDirection(this._f); this._u.set(0, 1, 0).applyQuaternion(camera.quaternion);
    if (L.positionX) {
      L.positionX.setTargetAtTime(cam.x, t, 0.03); L.positionY.setTargetAtTime(cam.y, t, 0.03); L.positionZ.setTargetAtTime(cam.z, t, 0.03);
      L.forwardX.setTargetAtTime(this._f.x, t, 0.03); L.forwardY.setTargetAtTime(this._f.y, t, 0.03); L.forwardZ.setTargetAtTime(this._f.z, t, 0.03);
      L.upX.setTargetAtTime(this._u.x, t, 0.03); L.upY.setTargetAtTime(this._u.y, t, 0.03); L.upZ.setTargetAtTime(this._u.z, t, 0.03);
    } else {
      L.setPosition(cam.x, cam.y, cam.z); L.setOrientation(this._f.x, this._f.y, this._f.z, this._u.x, this._u.y, this._u.z);
    }

    const sea = s.seaStrength;                    // 0.12 .. 1.55
    const alt = Math.max(cam.y, 0);
    const low = 1 - clamp(alt / 140, 0, 1);       // 1 at the water, 0 high above

    // underwater: muffle the air, bring up the deep bed
    const under = s.under ? 1 : 0;
    this.airFilter.frequency.setTargetAtTime(under ? 380 : 20000, t, under ? 0.05 : 0.12);
    this.airBus.gain.setTargetAtTime(under ? 0.35 : 1, t, 0.08);
    this.waterBus.gain.setTargetAtTime(under ? 0.6 : 0, t, under ? 0.06 : 0.15);
    if (s.entered) this.oneShot(this.buffers.dive, 0.9, 0.95 + Math.random() * 0.1);
    if (s.exited) this.oneShot(this.buffers.splash, 0.75, 1.0 + Math.random() * 0.1);

    // open sea bed: louder near the surface and with rougher water
    this.ocean.g.gain.setTargetAtTime(lerp(0.25, 1.0, low) * (0.5 + 0.4 * sea), t, 0.3);
    // wind: grows with altitude and sea state, plus occasional gusts
    const windAmt = clamp(0.12 + alt / 220, 0, 0.9) * (0.5 + 0.45 * sea);
    this.wind.g.gain.setTargetAtTime(windAmt * 0.55, t, 0.5);
    this.gustTimer -= dt;
    if (this.gustTimer < 0) { this.gustTimer = 6 + Math.random() * 10; if (!under) this.oneShot(this.buffers.gust, 0.18 + 0.25 * windAmt, 0.85 + Math.random() * 0.3); }

    // surf on the nearest coastline (positioned there)
    this.shoreTimer -= dt;
    if (this.shoreTimer < 0) { this.shoreTimer = 0.25; this.findShore(cam); }
    const near = clamp(1 - this.shore.dist / 380, 0, 1);
    this.setPos(this.surfP, this.shore.point);
    this.surf.g.gain.setTargetAtTime(near * 1.25 * (0.6 + 0.3 * sea), t, 0.4);
    this.surfBig.g.gain.setTargetAtTime(near * clamp((sea - 0.5) * 0.9, 0, 0.8), t, 0.4);

    // gulls circle over the beach island, only by day and not too far away
    const ga = s.time * 0.08;
    this._u.set(s.gullCenter.x + Math.cos(ga) * 70, 38, s.gullCenter.z + Math.sin(ga) * 70);
    this.setPos(this.gullsP, this._u);
    this.gulls.g.gain.setTargetAtTime(0.55, t, 0.5);

    // boat: engine with Doppler shift, hull lapping
    const bp = this.boatSim.pos;
    this.setPos(this.engineP, this._f.copy(bp).setY(1.0));
    this.setPos(this.lapP, this._u.copy(bp).setY(0.2));
    const dPrev = this.prevBoat.distanceTo(this.prevCam), dNow = bp.distanceTo(cam);
    const vRel = (dPrev - dNow) / dt;             // approaching > 0
    const doppler = clamp(343 / (343 - clamp(vRel, -60, 60)), 0.85, 1.18);
    const rev = 1 + clamp(this.boatSim.pitch * 2.2, -0.08, 0.12);  // engine labours as the bow climbs
    this.engine.src.playbackRate.setTargetAtTime(doppler * rev, t, 0.08);
    this.engine.g.gain.setTargetAtTime(0.85, t, 0.2);
    this.lap.g.gain.setTargetAtTime(0.6 * (0.5 + 0.5 * sea), t, 0.3);
    this.prevBoat.copy(bp); this.prevCam.copy(cam);
  }
}
