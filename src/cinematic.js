// Drone-style shot list. Each shot returns camera position + look target for a local
// time 0..1; cuts are hidden by a short fade handled in the post pass.
import * as THREE from 'three';
import { ISLANDS, terrainHeight } from './terrain.js';

const ease = (x) => x * x * (3 - 2 * x);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function buildShots(boatSim) {
  const A = ISLANDS.peakA, B = ISLANDS.beach, Pb = ISLANDS.peakB;
  const curve = (pts) => new THREE.CatmullRomCurve3(pts, false, 'centripetal');

  // a shoreline pass: find the beach edge south-east of the island centre
  const shoreDir = new THREE.Vector2(Math.cos(0.4), Math.sin(0.4));
  const shoreNormal = new THREE.Vector2(-shoreDir.y, shoreDir.x);
  const shorePts = [];
  for (let i = -3; i <= 3; i++) {
    const cx = B.x + shoreDir.x * i * 55, cz = B.z + shoreDir.y * i * 55;
    let r = 40; for (; r < 400; r += 3) if (terrainHeight(cx + shoreNormal.x * r, cz + shoreNormal.y * r) < -1.4) break;
    shorePts.push(V(cx + shoreNormal.x * (r + 10), 2.6, cz + shoreNormal.y * (r + 10)));
  }
  const shoreCam = curve(shorePts);

  return [
    {
      name: 'Sohil boʻyidagi past parvoz', dur: 12,
      at(t, out) {
        const p = shoreCam.getPointAt(0.05 + ease(t) * 0.75);
        const ahead = shoreCam.getPointAt(Math.min(0.05 + ease(t) * 0.75 + 0.12, 1));
        out.pos.copy(p).add(V(0, Math.sin(t * 3) * 0.3, 0));
        out.look.copy(ahead).add(V(-shoreNormal.x * 30, -1.5, -shoreNormal.y * 30));
      },
    },
    {
      name: 'Ohaktosh choʻqqisi', dur: 14,
      at(t, out) {
        const a = -0.6 + ease(t) * 1.9, r = 300 - 90 * ease(t), y = 22 + 110 * ease(t);
        out.pos.set(A.x + Math.cos(a) * r, y, A.z + Math.sin(a) * r);
        out.look.set(A.x, 55 + 40 * t, A.z);
      },
    },
    {
      name: 'Arxipelag ustida', dur: 12,
      at(t, out) {
        const c = curve([V(560, 190, 520), V(260, 170, 260), V(-60, 150, 20), V(-260, 140, -120)]);
        out.pos.copy(c.getPointAt(ease(t)));
        out.look.lerpVectors(V(B.x, 0, B.z), V(A.x, 40, A.z), ease(t));
      },
    },
    {
      name: 'Suvga shoʻngʻish', dur: 13,
      at(t, out) {
        const base = V(Pb.x - 230, 0, Pb.z + 200), dir = V(1, 0, -0.35).normalize();
        const along = t * 120;
        let y;
        if (t < 0.25) y = THREE.MathUtils.lerp(9, -4.5, ease(t / 0.25));
        else if (t < 0.7) y = -4.5 + Math.sin((t - 0.25) * 9) * 0.8;
        else y = THREE.MathUtils.lerp(-4.2, 3.2, ease((t - 0.7) / 0.3));
        out.pos.copy(base).addScaledVector(dir, along).setY(y);
        out.look.copy(out.pos).addScaledVector(dir, 30).setY(y < 0 ? y + 3 + 7 * (THREE.MathUtils.smoothstep(t, 0.3, 0.45) - THREE.MathUtils.smoothstep(t, 0.6, 0.72)) : y - 1);
      },
    },
    {
      name: 'Qayiq ortidan', dur: 16,
      at(t, out) {
        const f = boatSim.forward, p = boatSim.pos;
        const side = V(-f.z, 0, f.x);
        const orbit = -0.9 + ease(t) * 1.6;
        const back = V(0, 0, 0).addScaledVector(f, -Math.cos(orbit) * 15).addScaledVector(side, Math.sin(orbit) * 12);
        out.pos.copy(p).add(back).setY(4.5 + 2 * Math.sin(t * 2.2));
        out.look.copy(p).addScaledVector(f, 5).setY(0.8);
      },
    },
    {
      name: 'Toʻlqinlar ustida', dur: 11,
      at(t, out) {
        const start = V(-150, 0, 420), dir = V(0.25, 0, -1).normalize();
        out.pos.copy(start).addScaledVector(dir, t * 170).setY(1.7 + Math.sin(t * 5) * 0.25);
        out.look.copy(out.pos).addScaledVector(dir, 50).setY(-1.0);
      },
    },
  ];
}

export class Director {
  constructor(shots) {
    this.shots = shots;
    this.total = shots.reduce((s, x) => s + x.dur, 0);
    this.t = 0;
    this.state = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  }
  update(dt, camera) {
    this.t = (this.t + dt) % this.total;
    let acc = 0, idx = 0;
    for (; idx < this.shots.length; idx++) { if (this.t < acc + this.shots[idx].dur) break; acc += this.shots[idx].dur; }
    const shot = this.shots[idx], lt = (this.t - acc) / shot.dur;
    shot.at(lt, this.state);
    camera.position.copy(this.state.pos);
    camera.lookAt(this.state.look);
    const edge = Math.min(this.t - acc, acc + shot.dur - this.t);
    return { index: idx, name: shot.name, local: lt, fade: 1 - THREE.MathUtils.smoothstep(edge, 0, 0.45), progress: this.t / this.total };
  }
  jump(i) { this.t = this.shots.slice(0, i).reduce((s, x) => s + x.dur, 0) + 0.01; }
}
