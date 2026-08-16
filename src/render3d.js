// 3D presentation of the quadrupole: rods, ion beam and the oscillating RF
// field. Drawing units are pixels; the axial direction is deliberately drawn
// compressed, since a real analyser is roughly fifty times longer than it is
// wide and the transverse motion would otherwise be invisible.

import { STEPS_PER_RF_CYCLE, COLOR_X_PAIR, COLOR_Y_PAIR } from "./constants.js";
import { electricFieldAt, electrodePotential } from "./physics.js";
import { config, state, advanceLiveBeam } from "./state.js";

const RADIAL_PIXELS_PER_R0 = 62;
const HYPERBOLA_HALF_HEIGHT = 1.15;   // in units of r0
const CONTOUR_SAMPLES = 44;
const FIELD_GRID_STEPS = 5;
const FIELD_AXIAL_STATIONS = 5;
const TRAIL_FADE_SEGMENTS = 5;

export const view = {
    rotationX: -0.42,
    rotationY: 0.62,
    invalidated: true
};

export function invalidateRender() {
    view.invalidated = true;
}

let rodContours = null;
let contourSignature = "";

function rotatePoint(point, quarterTurns) {
    let { x, y } = point;
    for (let turn = 0; turn < quarterTurns; turn++) {
        const nextX = -y;
        y = x;
        x = nextX;
    }
    return { x, y };
}

// A closed cross-section for one rod, in metres, for the rod lying on +x.
function buildBaseContour(runtime) {
    const points = [];
    if (runtime.geometry === "round") {
        for (let i = 0; i < CONTOUR_SAMPLES; i++) {
            const angle = (2 * Math.PI * i) / CONTOUR_SAMPLES;
            points.push({
                x: runtime.rodCentre + runtime.rodRadius * Math.cos(angle),
                y: runtime.rodRadius * Math.sin(angle)
            });
        }
        return points;
    }

    // Inner face follows the equipotential x^2 - y^2 = r0^2, then the rod is
    // closed off with a circular arc so it has a finite body.
    const halfHeight = HYPERBOLA_HALF_HEIGHT * runtime.r0;
    const half = Math.floor(CONTOUR_SAMPLES / 2);
    for (let i = 0; i <= half; i++) {
        const y = -halfHeight + (2 * halfHeight * i) / half;
        points.push({ x: Math.sqrt(runtime.r0 * runtime.r0 + y * y), y });
    }
    const endPoint = points[points.length - 1];
    const outerRadius = Math.hypot(endPoint.x, endPoint.y);
    const endAngle = Math.atan2(endPoint.y, endPoint.x);
    for (let i = 1; i < half; i++) {
        const angle = endAngle - (2 * endAngle * i) / half;
        points.push({ x: outerRadius * Math.cos(angle), y: outerRadius * Math.sin(angle) });
    }
    return points;
}

function buildRodContours(runtime) {
    const signature = `${runtime.geometry}|${runtime.r0}|${runtime.rodRadius}`;
    if (rodContours && contourSignature === signature) return rodContours;

    const base = buildBaseContour(runtime);
    const centroidX = base.reduce((sum, point) => sum + point.x, 0) / base.length;
    const centroidY = base.reduce((sum, point) => sum + point.y, 0) / base.length;

    rodContours = [0, 1, 2, 3].map((quarterTurns) => {
        const points = base.map((point) => rotatePoint(point, quarterTurns));
        const centroid = rotatePoint({ x: centroidX, y: centroidY }, quarterTurns);
        const normals = points.map((point, index) => {
            const previous = points[(index - 1 + points.length) % points.length];
            const next = points[(index + 1) % points.length];
            let nx = next.y - previous.y;
            let ny = -(next.x - previous.x);
            const length = Math.hypot(nx, ny) || 1;
            nx /= length;
            ny /= length;
            // Orient every normal away from the rod body.
            if (nx * (point.x - centroid.x) + ny * (point.y - centroid.y) < 0) {
                nx = -nx;
                ny = -ny;
            }
            return { x: nx, y: ny };
        });
        return { points, normals, centroid, polarity: quarterTurns % 2 === 0 ? 1 : -1 };
    });
    contourSignature = signature;
    return rodContours;
}

function getScales(runtime) {
    const radial = RADIAL_PIXELS_PER_R0 / runtime.r0;
    return { radial, axial: radial / config.aspectExaggeration };
}

// Rod colour tracks the instantaneous potential so the drive is visible on the
// hardware itself, not only in the field arrows.
function rodColour(p, polarity, potential, amplitude, alpha) {
    const normalised = amplitude > 0
        ? Math.max(-1, Math.min(1, (polarity * potential) / amplitude))
        : 0;
    const neutral = p.color(146, 154, 163, alpha);
    const positive = p.color(COLOR_X_PAIR);
    const negative = p.color(COLOR_Y_PAIR);
    positive.setAlpha(alpha);
    negative.setAlpha(alpha);
    return normalised >= 0
        ? p.lerpColor(neutral, positive, normalised)
        : p.lerpColor(neutral, negative, -normalised);
}

function drawRods(p, runtime, scales) {
    const alpha = p.map(config.rodOpacity, 0, 100, 0, 255);
    if (alpha <= 0) return;

    const contours = buildRodContours(runtime);
    const potential = electrodePotential(runtime, state.globalRfPhase);
    const startX = 0;
    const endX = runtime.length * scales.axial;

    for (const rod of contours) {
        p.push();
        p.noStroke();
        p.specularMaterial(rodColour(p, rod.polarity, potential, runtime.rfAmplitude, alpha));
        p.shininess(90);

        p.beginShape(p.TRIANGLE_STRIP);
        for (let index = 0; index <= rod.points.length; index++) {
            const point = rod.points[index % rod.points.length];
            const normal = rod.normals[index % rod.points.length];
            const y = point.x * scales.radial;
            const z = point.y * scales.radial;
            p.normal(0, normal.x, normal.y);
            p.vertex(startX, y, z);
            p.vertex(endX, y, z);
        }
        p.endShape();

        for (const [axialX, normalX] of [[startX, -1], [endX, 1]]) {
            p.beginShape(p.TRIANGLE_FAN);
            p.normal(normalX, 0, 0);
            p.vertex(axialX, rod.centroid.x * scales.radial, rod.centroid.y * scales.radial);
            for (let index = 0; index <= rod.points.length; index++) {
                const point = rod.points[index % rod.points.length];
                p.vertex(axialX, point.x * scales.radial, point.y * scales.radial);
            }
            p.endShape();
        }
        p.pop();
    }
}

function drawApertures(p, runtime, scales) {
    p.push();
    p.noFill();
    p.strokeWeight(1.5);
    for (const [axialPosition, colour] of [[0, [40, 122, 69]], [runtime.length, [154, 103, 0]]]) {
        p.stroke(colour[0], colour[1], colour[2], 170);
        p.beginShape();
        for (let i = 0; i <= 48; i++) {
            const angle = (2 * Math.PI * i) / 48;
            p.vertex(
                axialPosition * scales.axial,
                runtime.r0 * Math.cos(angle) * scales.radial,
                runtime.r0 * Math.sin(angle) * scales.radial
            );
        }
        p.endShape();
    }
    p.pop();
}

function drawAxes(p, runtime, scales) {
    p.push();
    p.strokeWeight(2);
    const axialSpan = runtime.length * scales.axial;
    const radialSpan = runtime.r0 * 2.2 * scales.radial;
    p.stroke(82, 96, 109, 150);
    p.line(-axialSpan * 0.08, 0, 0, axialSpan * 1.08, 0, 0);
    p.stroke(180, 35, 24, 130);
    p.line(0, -radialSpan, 0, 0, radialSpan, 0);
    p.stroke(23, 105, 170, 130);
    p.line(0, 0, -radialSpan, 0, 0, radialSpan);
    p.pop();
}

function isInsideAperture(x, y, runtime) {
    if (runtime.geometry === "round") {
        const rodRadiusSquared = runtime.rodRadius * runtime.rodRadius;
        const offsetX = Math.abs(x) - runtime.rodCentre;
        if (offsetX * offsetX + y * y <= rodRadiusSquared) return false;
        const offsetY = Math.abs(y) - runtime.rodCentre;
        return x * x + offsetY * offsetY > rodRadiusSquared;
    }
    return Math.abs(x * x - y * y) < runtime.r0 * runtime.r0;
}

function drawFieldArrows(p, runtime, scales) {
    const samples = [];
    let maximumMagnitude = 0;
    const extent = 0.78 * runtime.r0;

    for (let station = 0; station < FIELD_AXIAL_STATIONS; station++) {
        const axialPosition = (runtime.length * (station + 0.5)) / FIELD_AXIAL_STATIONS;
        for (let row = 0; row < FIELD_GRID_STEPS; row++) {
            for (let column = 0; column < FIELD_GRID_STEPS; column++) {
                const x = -extent + (2 * extent * row) / (FIELD_GRID_STEPS - 1);
                const y = -extent + (2 * extent * column) / (FIELD_GRID_STEPS - 1);
                if (!isInsideAperture(x, y, runtime)) continue;
                const field = electricFieldAt(x, y, axialPosition, state.globalRfPhase, runtime);
                const magnitude = Math.hypot(field.x, field.y, field.z);
                if (magnitude === 0) continue;
                maximumMagnitude = Math.max(maximumMagnitude, magnitude);
                samples.push({ x, y, axialPosition, field, magnitude });
            }
        }
    }
    if (maximumMagnitude <= 0) return;

    const lowColour = p.color(22, 134, 183, 210);
    const highColour = p.color(209, 139, 32, 235);
    p.push();
    p.noFill();
    for (const sample of samples) {
        const strength = Math.sqrt(sample.magnitude / maximumMagnitude);
        const length = p.lerp(9, 26, strength);
        const unitAxial = sample.field.z / sample.magnitude;
        const unitX = sample.field.x / sample.magnitude;
        const unitY = sample.field.y / sample.magnitude;

        const startAxial = sample.axialPosition * scales.axial;
        const startRadialX = sample.x * scales.radial;
        const startRadialY = sample.y * scales.radial;
        const endAxial = startAxial + unitAxial * length;
        const endRadialX = startRadialX + unitX * length;
        const endRadialY = startRadialY + unitY * length;

        p.stroke(p.lerpColor(lowColour, highColour, strength));
        p.strokeWeight(p.lerp(1.1, 2.2, strength));
        p.line(startAxial, startRadialX, startRadialY, endAxial, endRadialX, endRadialY);

        // A small pyramid head keeps the direction readable from any viewpoint.
        const headLength = 5;
        const headWidth = 2.8;
        const baseAxial = endAxial - unitAxial * headLength;
        const baseRadialX = endRadialX - unitX * headLength;
        const baseRadialY = endRadialY - unitY * headLength;
        const perpendicularA = { x: -unitY, y: unitX };
        p.line(endAxial, endRadialX, endRadialY,
            baseAxial, baseRadialX + perpendicularA.x * headWidth,
            baseRadialY + perpendicularA.y * headWidth);
        p.line(endAxial, endRadialX, endRadialY,
            baseAxial, baseRadialX - perpendicularA.x * headWidth,
            baseRadialY - perpendicularA.y * headWidth);
    }
    p.pop();
}

// Trails are drawn as a handful of stroked polylines rather than one call per
// segment. A per-segment loop costs thousands of draw calls per frame once the
// trails fill up, which is enough to stall the whole sketch.
function drawTrail(p, ion, scales) {
    const pointCount = ion.trail.length;
    const segmentSize = Math.ceil(pointCount / TRAIL_FADE_SEGMENTS);
    const trailColour = p.color(ion.color);

    p.push();
    p.noFill();
    for (let segment = 0; segment < TRAIL_FADE_SEGMENTS; segment++) {
        const start = segment * segmentSize;
        const end = Math.min(pointCount - 1, start + segmentSize);
        if (end - start < 1) continue;

        const fade = (segment + 1) / TRAIL_FADE_SEGMENTS;
        trailColour.setAlpha(p.lerp(35, 235, fade));
        p.stroke(trailColour);
        p.strokeWeight(p.lerp(0.7, 2.2, fade));
        p.beginShape();
        for (let index = start; index <= end; index++) {
            const point = ion.trail[index];
            p.vertex(
                point.z * scales.axial,
                point.x * scales.radial,
                point.y * scales.radial
            );
        }
        p.endShape();
    }
    p.pop();
}

function drawIons(p, runtime, scales) {
    for (const ion of state.liveIons) {
        if (ion.launchDelay > 0) continue;

        if (config.showTrails && ion.trail.length > 1) {
            drawTrail(p, ion, scales);
        }

        if (ion.status !== "flying") continue;
        p.push();
        p.translate(ion.z * scales.axial, ion.x * scales.radial, ion.y * scales.radial);
        p.noStroke();
        p.ambientMaterial(p.color(ion.color));
        p.fill(p.color(ion.color));
        p.sphere(3.6);
        p.pop();
    }

    for (const mark of state.impactMarks) {
        p.push();
        p.translate(mark.z * scales.axial, mark.x * scales.radial, mark.y * scales.radial);
        p.noStroke();
        p.fill(180, 35, 24, 130);
        p.sphere(4.2);
        p.pop();
    }
}

export function createSketch() {
    return (p) => {
        let canvasVisible = true;

        p.setup = () => {
            const holder = document.getElementById("p5-canvas-holder");
            const canvas = p.createCanvas(holder.clientWidth, holder.clientHeight, p.WEBGL);
            canvas.parent(holder);
            p.pixelDensity(1);
            canvas.style("touch-action", "none");

            if ("IntersectionObserver" in window) {
                const observer = new IntersectionObserver((entries) => {
                    canvasVisible = entries[0]?.isIntersecting ?? true;
                    if (canvasVisible) invalidateRender();
                });
                observer.observe(holder);
            }

            window.addEventListener("resize", () => {
                p.resizeCanvas(holder.clientWidth, holder.clientHeight);
                invalidateRender();
            });

            // p5 only applies wheel zoom from inside orbitControl during draw();
            // this sketch skips frames while paused, so wheel input is handled
            // directly to keep zooming responsive in every state.
            holder.addEventListener("wheel", (event) => {
                if (event.target?.closest?.("button, input, select")) return;
                event.preventDefault();
                event.stopPropagation();

                const renderer = p._renderer;
                const camera = renderer?._curCamera || renderer?.curCamera;
                if (!camera) return;

                const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
                    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? holder.clientHeight : 1;
                const deltaPixels = event.deltaY * unit;
                if (!Number.isFinite(deltaPixels) || deltaPixels === 0) return;

                const radius = Math.hypot(
                    camera.eyeX - camera.centerX,
                    camera.eyeY - camera.centerY,
                    camera.eyeZ - camera.centerZ
                );
                if (!Number.isFinite(radius) || radius === 0) return;

                const requested = radius * Math.exp(deltaPixels * (event.ctrlKey ? 0.006 : 0.003));
                const nextRadius = Math.min(6000, Math.max(90, requested));
                const scale = nextRadius / radius;
                p.camera(
                    camera.centerX + (camera.eyeX - camera.centerX) * scale,
                    camera.centerY + (camera.eyeY - camera.centerY) * scale,
                    camera.centerZ + (camera.eyeZ - camera.centerZ) * scale,
                    camera.centerX, camera.centerY, camera.centerZ,
                    camera.upX, camera.upY, camera.upZ
                );
                invalidateRender();
            }, { capture: true, passive: false });
        };

        p.draw = () => {
            if (state.isPlaying) advanceFrame();
            if (!canvasVisible) return;

            const runtime = state.runtime;
            const scales = getScales(runtime);

            p.background(236, 240, 244);
            p.ambientLight(60, 65, 72);
            p.directionalLight(255, 246, 224, -0.4, 0.4, -1.0);
            p.directionalLight(110, 148, 186, 0.7, -0.25, 0.45);
            p.pointLight(255, 214, 158, -200, -140, 260);
            p.orbitControl(1, 1, 0.1);

            p.rotateX(view.rotationX);
            p.rotateY(view.rotationY);
            p.translate(-(runtime.length * scales.axial) / 2, 0, 0);

            if (config.showGrid) drawAxes(p, runtime, scales);
            if (config.showField) drawFieldArrows(p, runtime, scales);
            drawApertures(p, runtime, scales);
            drawIons(p, runtime, scales);
            drawRods(p, runtime, scales);

            view.invalidated = false;
        };
    };
}

// One rendered frame advances the beam by the requested number of RF cycles,
// always integrated at the same fixed number of substeps per cycle.
export function advanceFrame() {
    const cycles = config.playbackCyclesPerSecond / 60;
    const simulatedSeconds = cycles * state.runtime.rfPeriod;
    const stepCount = Math.max(1, Math.round(cycles * STEPS_PER_RF_CYCLE));
    advanceLiveBeam(simulatedSeconds, stepCount);
}
