// Incremental mass scan.
//
// The spectrum is not drawn from stability theory: at every setpoint the RF and
// DC are recomputed and ion packets are actually flown through the rods, so peak
// width, peak shape and transmission losses all come out of the integration.

import { buildRuntime, flyIon, mathieuQ, expectedFlightCycles } from "./physics.js";
import { config, state } from "./state.js";

// A generous margin around the ideal acceptance window. Ions outside it cannot
// reach the detector, so flying them would only burn time.
const PREFILTER_MARGIN = 1.4;

export const scanState = {
    running: false,
    completed: false,
    stepIndex: 0,
    stepCount: 320,
    mzMin: 250,
    mzMax: 550,
    ionsPerStep: 6,
    fastPrefilter: true,
    setpoints: new Float32Array(0),
    intensities: new Float32Array(0),
    maxIntensity: 0,
    peaks: [],
    flightsFlown: 0,
    startedAt: 0,
    durationMs: 0
};

export function startScan() {
    const count = scanState.stepCount;
    scanState.setpoints = new Float32Array(count);
    scanState.intensities = new Float32Array(count);
    for (let index = 0; index < count; index++) {
        scanState.setpoints[index] = scanState.mzMin +
            ((scanState.mzMax - scanState.mzMin) * index) / Math.max(1, count - 1);
    }
    scanState.stepIndex = 0;
    scanState.maxIntensity = 0;
    scanState.peaks = [];
    scanState.flightsFlown = 0;
    scanState.running = true;
    scanState.completed = false;
    scanState.startedAt = performance.now();
    scanState.durationMs = 0;
}

export function stopScan() {
    scanState.running = false;
}

function runSetpoint(setpointMz) {
    const setpointConfig = config.mode === "rf-only"
        ? { ...config, lowMassCutoffMz: setpointMz }
        : { ...config, targetMz: setpointMz };
    const runtime = buildRuntime(setpointConfig);
    const acceptance = runtime.acceptance;

    let intensity = 0;
    for (const species of state.species) {
        if (scanState.fastPrefilter && !acceptance.empty) {
            const q = mathieuQ(species.mz, runtime);
            if (q < acceptance.qLow / PREFILTER_MARGIN ||
                q > acceptance.qHigh * PREFILTER_MARGIN) {
                continue;
            }
        }

        const maxCycles = Math.ceil(
            expectedFlightCycles(species.mz, setpointConfig, runtime) * 1.5 + 50
        );
        let transmitted = 0;
        for (let shot = 0; shot < scanState.ionsPerStep; shot++) {
            const ion = flyIon(species.mz, setpointConfig, runtime, maxCycles, shot);
            scanState.flightsFlown++;
            if (ion.status === "transmitted") transmitted++;
        }
        intensity += (transmitted / scanState.ionsPerStep) * species.abundance;
    }
    return intensity;
}

export function advanceScan(budgetMs) {
    if (!scanState.running) return false;

    const deadline = performance.now() + budgetMs;
    let progressed = false;
    while (scanState.stepIndex < scanState.stepCount && performance.now() < deadline) {
        const index = scanState.stepIndex;
        const intensity = runSetpoint(scanState.setpoints[index]);
        scanState.intensities[index] = intensity;
        scanState.maxIntensity = Math.max(scanState.maxIntensity, intensity);
        scanState.stepIndex++;
        progressed = true;
    }

    if (scanState.stepIndex >= scanState.stepCount) {
        scanState.running = false;
        scanState.completed = true;
        scanState.durationMs = performance.now() - scanState.startedAt;
        scanState.peaks = detectPeaks();
    }
    return progressed;
}

// Linear interpolation of the m/z at which the trace crosses a given level
// between two neighbouring scan points.
function crossingMz(indexA, indexB, level) {
    const { setpoints, intensities } = scanState;
    const span = intensities[indexA] - intensities[indexB];
    const fraction = span === 0 ? 0 : (intensities[indexA] - level) / span;
    return setpoints[indexA] + fraction * (setpoints[indexB] - setpoints[indexA]);
}

// Peak centroid and full width at half maximum, measured from the flown data.
// Quadrupole peaks are flat-topped rather than pointed, so contiguous regions
// above threshold are treated as one peak instead of hunting local maxima.
function detectPeaks() {
    const { setpoints, intensities, maxIntensity } = scanState;
    if (maxIntensity <= 0) return [];

    const threshold = maxIntensity * 0.02;
    const peaks = [];
    let regionStart = null;

    const closeRegion = (regionEnd) => {
        let apexIndex = regionStart;
        let weightSum = 0;
        let weightedMz = 0;
        for (let i = regionStart; i <= regionEnd; i++) {
            if (intensities[i] > intensities[apexIndex]) apexIndex = i;
            weightSum += intensities[i];
            weightedMz += intensities[i] * setpoints[i];
        }
        const apexIntensity = intensities[apexIndex];
        const half = apexIntensity / 2;

        let leftEdge = setpoints[regionStart];
        for (let i = apexIndex; i > 0; i--) {
            if (intensities[i - 1] > half) continue;
            leftEdge = crossingMz(i, i - 1, half);
            break;
        }
        let rightEdge = setpoints[regionEnd];
        for (let i = apexIndex; i < intensities.length - 1; i++) {
            if (intensities[i + 1] > half) continue;
            rightEdge = crossingMz(i, i + 1, half);
            break;
        }

        // Quadrupole peaks are flat topped, so the midpoint between the two
        // half-height edges locates the peak far better than the highest bin.
        const width = rightEdge - leftEdge;
        const centreMz = 0.5 * (leftEdge + rightEdge);
        peaks.push({
            centreMz,
            centroidMz: weightSum > 0 ? weightedMz / weightSum : centreMz,
            intensity: apexIntensity,
            relativeIntensity: apexIntensity / maxIntensity,
            widthFwhm: width,
            resolution: width > 0 ? centreMz / width : null
        });
    };

    for (let index = 0; index < intensities.length; index++) {
        const above = intensities[index] >= threshold;
        if (above && regionStart === null) regionStart = index;
        if (!above && regionStart !== null) {
            closeRegion(index - 1);
            regionStart = null;
        }
    }
    if (regionStart !== null) closeRegion(intensities.length - 1);

    return peaks.sort((a, b) => b.intensity - a.intensity).slice(0, 12);
}
