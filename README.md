# Zumrad arxipelag

A real-time tropical archipelago in the browser, built with three.js (WebGL2):

- **Ocean** — 32-wave Gerstner spectrum shared by the GPU surface and a CPU sampler; refraction and
  depth-based absorption from the opaque scene, HDR sky + planar reflections, GGX sun glint,
  Jacobian crest foam, shore surf and a boat wake.
- **Underwater** — Snell's window, total internal reflection, light shafts, sea-floor caustics,
  lens droplets when the camera breaks the surface.
- **Islands** — procedural karst towers with strata, a beach island with trees, triplanar PBR texturing.
- **Boat** — procedural fishing boat with buoyancy, wake and bow spray.
- **Camera** — six cinematic drone shots, plus free orbit and boat-follow modes.

## Run

```bash
npm install
npm run dev      # http://localhost:5190
npm run build    # static site in dist/
```

## Layout

| File | Purpose |
|---|---|
| `src/waves.js` | Wave spectrum (GPU GLSL + CPU sampler) |
| `src/ocean.js` | Ocean shader and the water render pass (refraction, reflection) |
| `src/terrain.js` | Heightfield, triplanar material, rocks, far islets |
| `src/boat.js` | Boat geometry, buoyancy, wake, spray |
| `src/cinematic.js` | Shot list and director |
| `src/post.js` | Underwater, droplets, grade, fades |

Asset credits: [`public/assets/CREDITS.md`](public/assets/CREDITS.md) (Poly Haven CC0, three.js MIT).
