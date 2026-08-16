// Two-dimensional diagnostic plots: mass spectrum, Mathieu stability diagram,
// transverse trajectories and the RF phase dial.

import {
    PLOT_BACKGROUND,
    PLOT_AXIS,
    PLOT_GRID,
    PLOT_TEXT_DIM,
    COLOR_X_PAIR,
    COLOR_Y_PAIR,
    METRES_PER_MM
} from "./constants.js";
import {
    STABILITY_BOUNDARY,
    STABILITY_APEX,
    RF_ONLY_CUTOFF_Q,
    isAxisStableCoarse
} from "./stability.js";
import { mathieuA, mathieuQ } from "./physics.js";
import { config, state } from "./state.js";
import { scanState } from "./scan.js";

const STABILITY_Q_MAX = 1.05;
const STABILITY_A_MAX = 0.30;
const RASTER_Q_STEPS = 210;
const RASTER_A_STEPS = 170;

const canvases = {};

export function initPlots() {
    for (const id of ["canvas-mass-spec", "canvas-stability", "canvas-ion-axes", "canvas-rf-dial"]) {
        const element = document.getElementById(id);
        canvases[id] = { element, context: element.getContext("2d") };
    }
    resizePlots();
    window.addEventListener("resize", resizePlots);
}

export function resizePlots() {
    const ratio = window.devicePixelRatio || 1;
    for (const [id, entry] of Object.entries(canvases)) {
        if (id === "canvas-rf-dial") continue;
        const bounds = entry.element.parentElement.getBoundingClientRect();
        if (bounds.width === 0 || bounds.height === 0) continue;
        entry.element.width = bounds.width * ratio;
        entry.element.height = bounds.height * ratio;
        entry.element.style.width = `${bounds.width}px`;
        entry.element.style.height = `${bounds.height}px`;
        entry.context.resetTransform();
        entry.context.scale(ratio, ratio);
        entry.cssWidth = bounds.width;
        entry.cssHeight = bounds.height;
    }
}

function beginPlot(id) {
    const entry = canvases[id];
    const width = entry.cssWidth ?? entry.element.width;
    const height = entry.cssHeight ?? entry.element.height;
    const context = entry.context;
    context.fillStyle = PLOT_BACKGROUND;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = PLOT_GRID;
    context.lineWidth = 1;
    for (let x = 40; x < width; x += 50) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
    }
    for (let y = 30; y < height; y += 40) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
    }
    return { context, width, height };
}

function drawFrame(context, padX, padY, plotWidth, plotHeight) {
    context.strokeStyle = PLOT_AXIS;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(padX, padY);
    context.lineTo(padX, padY + plotHeight);
    context.lineTo(padX + plotWidth, padY + plotHeight);
    context.stroke();
}

function niceTickStep(span, targetCount) {
    const rough = span / targetCount;
    const power = Math.pow(10, Math.floor(Math.log10(rough)));
    const scaled = rough / power;
    const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
    return step * power;
}

function drawAxisTicks(context, min, max, padX, padY, plotWidth, plotHeight) {
    const step = niceTickStep(max - min, 5);
    const decimals = step < 1 ? Math.ceil(-Math.log10(step)) : 0;
    context.fillStyle = PLOT_TEXT_DIM;
    context.strokeStyle = PLOT_AXIS;
    context.lineWidth = 1;
    context.font = "9px 'Inter', sans-serif";
    context.textAlign = "center";
    for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-6; value += step) {
        const x = padX + ((value - min) / (max - min)) * plotWidth;
        context.fillText(value.toFixed(decimals), x, padY + plotHeight + 13);
        context.beginPath();
        context.moveTo(x, padY + plotHeight);
        context.lineTo(x, padY + plotHeight + 4);
        context.stroke();
    }
}

export function drawSpectrum() {
    const { context, width, height } = beginPlot("canvas-mass-spec");
    const padX = 42;
    const padY = 18;
    const plotWidth = width - padX - 16;
    const plotHeight = height - padY - 22;
    drawFrame(context, padX, padY, plotWidth, plotHeight);

    const { setpoints, intensities, stepIndex, maxIntensity } = scanState;
    if (setpoints.length === 0) {
        context.fillStyle = PLOT_TEXT_DIM;
        context.font = "11px 'Inter', sans-serif";
        context.textAlign = "center";
        context.fillText(
            "Press Acquire Spectrum to scan the filter across the mass range.",
            padX + plotWidth / 2, padY + plotHeight / 2
        );
        return;
    }

    const minMz = scanState.mzMin;
    const maxMz = scanState.mzMax;
    const scale = maxIntensity > 0 ? maxIntensity : 1;
    const toX = (mz) => padX + ((mz - minMz) / (maxMz - minMz)) * plotWidth;
    const toY = (value) => padY + plotHeight - (value / scale) * (plotHeight - 8);

    // The true composition is drawn underneath as reference sticks so the flown
    // peaks can be compared with where the ions actually are.
    for (const species of state.species) {
        if (species.mz < minMz || species.mz > maxMz) continue;
        const x = toX(species.mz);
        context.strokeStyle = "rgba(100, 116, 139, 0.45)";
        context.setLineDash([3, 3]);
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(x, padY);
        context.lineTo(x, padY + plotHeight);
        context.stroke();
        context.setLineDash([]);
    }

    const drawCount = Math.max(0, stepIndex);
    if (drawCount > 1) {
        context.beginPath();
        context.moveTo(toX(setpoints[0]), padY + plotHeight);
        for (let index = 0; index < drawCount; index++) {
            context.lineTo(toX(setpoints[index]), toY(intensities[index]));
        }
        context.lineTo(toX(setpoints[drawCount - 1]), padY + plotHeight);
        context.closePath();
        context.fillStyle = "rgba(23, 105, 170, 0.16)";
        context.fill();

        context.beginPath();
        for (let index = 0; index < drawCount; index++) {
            const x = toX(setpoints[index]);
            const y = toY(intensities[index]);
            if (index === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
        }
        context.strokeStyle = "#1769aa";
        context.lineWidth = 1.6;
        context.stroke();
    }

    if (scanState.running && drawCount > 0) {
        const x = toX(setpoints[Math.min(drawCount, setpoints.length - 1)]);
        context.strokeStyle = "rgba(154, 103, 0, 0.8)";
        context.lineWidth = 1.5;
        context.beginPath();
        context.moveTo(x, padY);
        context.lineTo(x, padY + plotHeight);
        context.stroke();
    }

    context.fillStyle = "#765000";
    context.font = "9px 'Inter', sans-serif";
    context.textAlign = "center";
    for (const peak of scanState.peaks.slice(0, 8)) {
        if (peak.centreMz < minMz || peak.centreMz > maxMz) continue;
        context.fillText(
            peak.centreMz.toFixed(1),
            toX(peak.centreMz),
            Math.max(padY + 9, toY(peak.intensity) - 5)
        );
    }

    drawAxisTicks(context, minMz, maxMz, padX, padY, plotWidth, plotHeight);
}

// The x-only and y-only tints are rasterised once; the joint region is drawn as
// a crisp polygon from the bisected boundary.
let stabilityRaster = null;

function buildStabilityRaster() {
    const raster = document.createElement("canvas");
    raster.width = RASTER_Q_STEPS;
    raster.height = RASTER_A_STEPS;
    const context = raster.getContext("2d");
    const image = context.createImageData(RASTER_Q_STEPS, RASTER_A_STEPS);

    for (let column = 0; column < RASTER_Q_STEPS; column++) {
        const q = (STABILITY_Q_MAX * (column + 0.5)) / RASTER_Q_STEPS;
        for (let row = 0; row < RASTER_A_STEPS; row++) {
            const a = STABILITY_A_MAX * (1 - (2 * (row + 0.5)) / RASTER_A_STEPS);
            const xStable = isAxisStableCoarse(a, q);
            const yStable = isAxisStableCoarse(-a, q);
            const offset = 4 * (row * RASTER_Q_STEPS + column);
            if (xStable && yStable) {
                image.data[offset] = 40; image.data[offset + 1] = 122;
                image.data[offset + 2] = 69; image.data[offset + 3] = 96;
            } else if (xStable) {
                image.data[offset] = 180; image.data[offset + 1] = 35;
                image.data[offset + 2] = 24; image.data[offset + 3] = 46;
            } else if (yStable) {
                image.data[offset] = 23; image.data[offset + 1] = 105;
                image.data[offset + 2] = 170; image.data[offset + 3] = 46;
            }
        }
    }
    context.putImageData(image, 0, 0);
    return raster;
}

const stabilityLayout = { padX: 46, padY: 16, plotWidth: 0, plotHeight: 0 };

export function stabilityCanvasToParameters(offsetX, offsetY) {
    const { padX, padY, plotWidth, plotHeight } = stabilityLayout;
    if (plotWidth <= 0) return null;
    const q = ((offsetX - padX) / plotWidth) * STABILITY_Q_MAX;
    const a = STABILITY_A_MAX * (1 - (2 * (offsetY - padY)) / plotHeight);
    if (q < 0 || q > STABILITY_Q_MAX) return null;
    if (a < -STABILITY_A_MAX || a > STABILITY_A_MAX) return null;
    return { q, a };
}

export function drawStabilityDiagram() {
    const { context, width, height } = beginPlot("canvas-stability");
    const padX = stabilityLayout.padX;
    const padY = stabilityLayout.padY;
    const plotWidth = width - padX - 18;
    const plotHeight = height - padY - 26;
    stabilityLayout.plotWidth = plotWidth;
    stabilityLayout.plotHeight = plotHeight;

    const toX = (q) => padX + (q / STABILITY_Q_MAX) * plotWidth;
    const toY = (a) => padY + (plotHeight / 2) * (1 - a / STABILITY_A_MAX);

    if (!stabilityRaster) stabilityRaster = buildStabilityRaster();
    context.save();
    context.beginPath();
    context.rect(padX, padY, plotWidth, plotHeight);
    context.clip();
    context.imageSmoothingEnabled = true;
    context.drawImage(stabilityRaster, padX, padY, plotWidth, plotHeight);
    context.restore();

    // Joint stability region outline.
    context.beginPath();
    STABILITY_BOUNDARY.forEach((point, index) => {
        const x = toX(point.q);
        const y = toY(point.a);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
    });
    for (let index = STABILITY_BOUNDARY.length - 1; index >= 0; index--) {
        const point = STABILITY_BOUNDARY[index];
        context.lineTo(toX(point.q), toY(-point.a));
    }
    context.closePath();
    context.strokeStyle = "#287a45";
    context.lineWidth = 1.6;
    context.stroke();

    // Zero-DC axis, which is where an RF-only guide operates.
    context.strokeStyle = "rgba(82, 96, 109, 0.5)";
    context.setLineDash([4, 4]);
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(padX, toY(0));
    context.lineTo(padX + plotWidth, toY(0));
    context.stroke();
    context.setLineDash([]);

    // Operating line a = 2*(U/V)*q.
    const slope = 2 * state.runtime.dcRfRatio;
    const lineEndQ = slope > 0
        ? Math.min(STABILITY_Q_MAX, STABILITY_A_MAX / slope)
        : STABILITY_Q_MAX;
    context.strokeStyle = "#655281";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(toX(0), toY(0));
    context.lineTo(toX(lineEndQ), toY(slope * lineEndQ));
    context.stroke();

    // Apex marker.
    context.fillStyle = "#287a45";
    context.beginPath();
    context.arc(toX(STABILITY_APEX.q), toY(STABILITY_APEX.a), 3, 0, 2 * Math.PI);
    context.fill();
    context.font = "9px 'Inter', sans-serif";
    context.textAlign = "left";
    context.fillText(
        `apex (${STABILITY_APEX.q.toFixed(3)}, ${STABILITY_APEX.a.toFixed(5)})`,
        toX(STABILITY_APEX.q) + 6, toY(STABILITY_APEX.a) - 4
    );

    // RF-only cutoff marker.
    context.fillStyle = "#9a6700";
    context.beginPath();
    context.arc(toX(RF_ONLY_CUTOFF_Q), toY(0), 3, 0, 2 * Math.PI);
    context.fill();
    context.textAlign = "center";
    context.fillText(`q = ${RF_ONLY_CUTOFF_Q.toFixed(3)}`, toX(RF_ONLY_CUTOFF_Q), toY(0) + 15);

    // Every species in the sample, placed at its own (a, q).
    for (const species of state.species) {
        const q = mathieuQ(species.mz, state.runtime);
        const a = mathieuA(species.mz, state.runtime);
        if (q > STABILITY_Q_MAX * 1.4) continue;
        const x = toX(Math.min(q, STABILITY_Q_MAX));
        const y = toY(Math.max(-STABILITY_A_MAX, Math.min(STABILITY_A_MAX, a)));
        context.fillStyle = species.color;
        context.beginPath();
        context.arc(x, y, 4.5, 0, 2 * Math.PI);
        context.fill();
        context.strokeStyle = "#ffffff";
        context.lineWidth = 1.2;
        context.stroke();
    }

    drawFrame(context, padX, padY, plotWidth, plotHeight);
    drawAxisTicks(context, 0, STABILITY_Q_MAX, padX, padY, plotWidth, plotHeight);

    context.fillStyle = PLOT_TEXT_DIM;
    context.font = "9px 'Inter', sans-serif";
    context.textAlign = "right";
    context.fillText(`+${STABILITY_A_MAX.toFixed(2)}`, padX - 5, padY + 9);
    context.fillText("0", padX - 5, toY(0) + 3);
    context.fillText(`-${STABILITY_A_MAX.toFixed(2)}`, padX - 5, padY + plotHeight - 2);
}

export function drawIonAxes() {
    const { context, width, height } = beginPlot("canvas-ion-axes");
    const padX = 42;
    const padY = 16;
    const plotWidth = width - padX - 16;
    const plotHeight = height - padY - 22;
    drawFrame(context, padX, padY, plotWidth, plotHeight);

    const ion = state.liveIons[state.inspectedIonIndex];
    if (!ion || ion.seriesX.length < 2) {
        context.fillStyle = PLOT_TEXT_DIM;
        context.font = "11px 'Inter', sans-serif";
        context.textAlign = "center";
        context.fillText("Waiting for trajectory data…", padX + plotWidth / 2, padY + plotHeight / 2);
        return;
    }

    const displayRadiusMm = config.r0mm * 1.35;
    const toY = (metres) =>
        padY + plotHeight / 2 - (metres / METRES_PER_MM / displayRadiusMm) * (plotHeight / 2);
    const startTime = ion.seriesTime[0];
    const endTime = Math.max(ion.seriesTime[ion.seriesTime.length - 1], startTime + 1e-12);
    const toX = (time) => padX + ((time - startTime) / (endTime - startTime)) * plotWidth;

    // Rod boundary: an ion reaching +/-r0 in either axis is lost.
    context.strokeStyle = "rgba(100, 116, 139, 0.55)";
    context.setLineDash([4, 3]);
    context.lineWidth = 1;
    for (const boundary of [config.r0mm * METRES_PER_MM, -config.r0mm * METRES_PER_MM]) {
        context.beginPath();
        context.moveTo(padX, toY(boundary));
        context.lineTo(padX + plotWidth, toY(boundary));
        context.stroke();
    }
    context.setLineDash([]);

    const drawSeries = (series, color) => {
        context.strokeStyle = color;
        context.lineWidth = 1.6;
        context.beginPath();
        for (let index = 0; index < series.length; index++) {
            const x = toX(ion.seriesTime[index]);
            const y = toY(series[index]);
            if (index === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
        }
        context.stroke();
    };
    drawSeries(ion.seriesX, COLOR_X_PAIR);
    drawSeries(ion.seriesY, COLOR_Y_PAIR);

    drawAxisTicks(
        context,
        startTime * 1e6,
        endTime * 1e6,
        padX, padY, plotWidth, plotHeight
    );

    context.fillStyle = PLOT_TEXT_DIM;
    context.font = "9px 'Inter', sans-serif";
    context.textAlign = "right";
    context.fillText(`+${displayRadiusMm.toFixed(1)}`, padX - 5, padY + 9);
    context.fillText("0", padX - 5, padY + plotHeight / 2 + 3);
    context.fillText(`-${displayRadiusMm.toFixed(1)}`, padX - 5, padY + plotHeight - 2);
}

export function drawRfDial() {
    const entry = canvases["canvas-rf-dial"];
    if (!entry) return;
    const context = entry.context;
    const width = entry.element.width;
    const height = entry.element.height;

    context.clearRect(0, 0, width, height);
    context.strokeStyle = "rgba(100, 116, 139, 0.35)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, height / 2);
    context.lineTo(width, height / 2);
    context.stroke();

    const amplitude = height / 2 - 4;
    context.strokeStyle = COLOR_X_PAIR;
    context.lineWidth = 1.6;
    context.beginPath();
    for (let pixel = 0; pixel <= width; pixel++) {
        const phase = (pixel / width) * 4 * Math.PI;
        const y = height / 2 - amplitude * -Math.cos(phase);
        if (pixel === 0) context.moveTo(pixel, y);
        else context.lineTo(pixel, y);
    }
    context.stroke();

    const phase = state.globalRfPhase % (4 * Math.PI);
    const markerX = (phase / (4 * Math.PI)) * width;
    const markerY = height / 2 - amplitude * -Math.cos(phase);
    context.fillStyle = COLOR_Y_PAIR;
    context.beginPath();
    context.arc(markerX, markerY, 3.5, 0, 2 * Math.PI);
    context.fill();
}
