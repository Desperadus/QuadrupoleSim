# QuadrupoleSim

Interactive 3D simulation of a quadrupole mass analyser, built for teaching how
the thing actually works rather than for showing a pretty animation.

## Try it out!
https://desperadus.github.io/QuadrupoleSim/

## Features

Two operating modes:

- **Mass Selective** — DC and RF together. Set a target m/z and a DC/RF ratio,
  inject a mixture and watch everything else strike the rods.
- **RF-Only Guide** — no DC. A high-pass mass filter: set the low-mass cutoff and
  everything heavier is transmitted. This is what a collision cell or pre-filter is.

- 3D view of the rods, the ion beam, trajectory trails and rod impacts, with the
  rod colour tracking the instantaneous RF potential
- Animated RF electric field vectors that reverse every half cycle
- Interactive Mathieu stability diagram showing the joint region, the x-only and
  y-only regions, the operating line and every ion in the sample; click to retune
- Live transverse trajectory plots against the rod boundary, plus an ion inspector
- Adjustable geometry (hyperbolic or round rods, r₀, rod length), drive
  (frequency, target m/z, DC/RF ratio), ion source (axial energy, beam radius,
  transverse energy, entry phase) and fringe model
- Preset sample mixtures plus a custom mixture builder
- A ten-step guided tour that drives the controls while it explains

## Running localy

```bash
npm install
npm run dev
```
