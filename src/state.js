// Central mutable simulation state, sample definitions and the live ion beam.

import {
    METRES_PER_MM,
    ION_PALETTE,
    DEFAULT_ROD_RADIUS_RATIO,
    STEPS_PER_RF_CYCLE
} from "./constants.js";
import {
    buildRuntime,
    createIonState,
    expectedFlightCycles,
    sampleEntryConditions,
    stepIon
} from "./physics.js";

export const config = {
    mode: "mass-selective",
    targetMz: 500,
    lowMassCutoffMz: 100,
    dcRfPercent: 98.0,
    rfFrequencyMHz: 1.0,
    r0mm: 4.0,
    rodLengthMm: 200,
    ionEnergyEv: 5,
    beamRadiusMm: 0.35,
    transverseEnergyEv: 0.02,
    fringeEnabled: true,
    fringeLengthMm: 4,
    randomEntryPhase: true,
    geometry: "hyperbolic",
    rodRadiusRatio: DEFAULT_ROD_RADIUS_RATIO,
    liveIonCount: 24,
    playbackCyclesPerSecond: 25,
    aspectExaggeration: 8,
    rodOpacity: 55,
    showGrid: true,
    showField: false,
    showTrails: true
};

export const SAMPLE_MIXTURES = {
    triplet: {
        label: "Reference triplet",
        species: [
            { mz: 300, abundance: 100, label: "m/z 300" },
            { mz: 400, abundance: 100, label: "m/z 400" },
            { mz: 500, abundance: 100, label: "m/z 500" }
        ]
    },
    doublet: {
        label: "Unit-mass doublet",
        species: [
            { mz: 500, abundance: 100, label: "m/z 500" },
            { mz: 501, abundance: 100, label: "m/z 501" }
        ]
    },
    isotopes: {
        label: "Isotope cluster",
        species: [
            { mz: 500, abundance: 100, label: "M" },
            { mz: 501, abundance: 30, label: "M+1" },
            { mz: 502, abundance: 6, label: "M+2" },
            { mz: 503, abundance: 1, label: "M+3" }
        ]
    },
    residualGas: {
        label: "Residual gas (nominal m/z)",
        species: [
            { mz: 18, abundance: 40, label: "H₂O⁺" },
            { mz: 28, abundance: 100, label: "N₂⁺" },
            { mz: 32, abundance: 26, label: "O₂⁺" },
            { mz: 40, abundance: 12, label: "Ar⁺" },
            { mz: 44, abundance: 8, label: "CO₂⁺" }
        ]
    },
    broad: {
        label: "Broad survey mixture",
        species: [
            { mz: 100, abundance: 60, label: "m/z 100" },
            { mz: 250, abundance: 100, label: "m/z 250" },
            { mz: 400, abundance: 75, label: "m/z 400" },
            { mz: 550, abundance: 90, label: "m/z 550" },
            { mz: 700, abundance: 45, label: "m/z 700" },
            { mz: 850, abundance: 30, label: "m/z 850" }
        ]
    }
};

export const state = {
    runtime: buildRuntime(config),
    sampleKey: "triplet",
    species: [],
    liveIons: [],
    globalRfPhase: 0,
    elapsedSeconds: 0,
    transmittedCount: 0,
    struckCount: 0,
    inspectedIonIndex: 0,
    isPlaying: true,
    impactMarks: []
};

export function rebuildRuntime() {
    state.runtime = buildRuntime(config);
}

export function applySample(sampleKey) {
    state.sampleKey = sampleKey;
    const mixture = SAMPLE_MIXTURES[sampleKey];
    state.species = mixture.species.map((entry, index) => ({
        ...entry,
        color: ION_PALETTE[index % ION_PALETTE.length]
    }));
    resetLiveBeam();
}

export function setCustomSpecies(species) {
    state.species = species.map((entry, index) => ({
        ...entry,
        color: entry.color || ION_PALETTE[index % ION_PALETTE.length]
    }));
    state.sampleKey = "custom";
    resetLiveBeam();
}

function pickSpeciesIndex() {
    const totalAbundance = state.species.reduce((sum, entry) => sum + entry.abundance, 0);
    let cursor = Math.random() * totalAbundance;
    for (let index = 0; index < state.species.length; index++) {
        cursor -= state.species[index].abundance;
        if (cursor <= 0) return index;
    }
    return state.species.length - 1;
}

const MAX_TRAIL_POINTS = 260;
// The trajectory plot samples densely enough to resolve individual RF
// oscillations, so it shows a rolling window rather than the whole flight.
const SERIES_SAMPLE_STRIDE = 4;
const MAX_SERIES_POINTS = 400;

function spawnLiveIon(speciesIndex) {
    const species = state.species[speciesIndex];
    const entry = sampleEntryConditions(species.mz, config, state.runtime);
    // Live ions share the laboratory clock, so their entry phase is the phase of
    // the drive at the moment they arrive unless a random phase was requested.
    if (!config.randomEntryPhase) entry.rfPhase = state.globalRfPhase;
    const ion = createIonState(species.mz, state.runtime, entry);
    ion.speciesIndex = speciesIndex;
    ion.color = species.color;
    ion.label = species.label;
    ion.trail = [];
    ion.seriesX = [];
    ion.seriesY = [];
    ion.seriesTime = [];
    ion.sampleCounter = 0;
    ion.finishedAt = null;
    ion.launchDelay = 0;
    // Spread the trail samples over the whole flight so the drawn trajectory
    // spans the rods instead of only the last stretch.
    ion.trailStride = Math.max(1, Math.ceil(
        (expectedFlightCycles(species.mz, config, state.runtime) * STEPS_PER_RF_CYCLE) /
        MAX_TRAIL_POINTS
    ));
    return ion;
}

export function resetLiveBeam() {
    state.liveIons = [];
    state.transmittedCount = 0;
    state.struckCount = 0;
    state.impactMarks = [];
    state.elapsedSeconds = 0;
    state.globalRfPhase = 0;
    for (let index = 0; index < config.liveIonCount; index++) {
        const ion = spawnLiveIon(pickSpeciesIndex());
        // Stagger the launch so the beam looks continuous instead of pulsed.
        ion.launchDelay = (index / config.liveIonCount) *
            (state.runtime.length / Math.max(ion.vz, 1));
        state.liveIons.push(ion);
    }
    state.inspectedIonIndex = Math.min(state.inspectedIonIndex, state.liveIons.length - 1);
}

export function syncLiveIonCount() {
    while (state.liveIons.length > config.liveIonCount) state.liveIons.pop();
    while (state.liveIons.length < config.liveIonCount) {
        state.liveIons.push(spawnLiveIon(pickSpeciesIndex()));
    }
    state.inspectedIonIndex = Math.min(
        state.inspectedIonIndex,
        Math.max(0, state.liveIons.length - 1)
    );
}

const IMPACT_MARK_LIMIT = 60;
// A finished ion is held on screen for a few RF cycles so its fate is visible
// before the slot is reused.
const FINISHED_LINGER_CYCLES = 12;

export function advanceLiveBeam(simulatedSeconds, stepCount) {
    const runtime = state.runtime;
    const dt = simulatedSeconds / stepCount;

    for (let step = 0; step < stepCount; step++) {
        state.globalRfPhase += runtime.omega * dt;
        state.elapsedSeconds += dt;

        for (const ion of state.liveIons) {
            if (ion.launchDelay > 0) {
                ion.launchDelay -= dt;
                continue;
            }
            if (ion.status !== "flying") continue;

            const status = stepIon(ion, runtime, dt);
            ion.sampleCounter++;
            if (ion.sampleCounter % ion.trailStride === 0) {
                ion.trail.push({ x: ion.x, y: ion.y, z: ion.z });
                if (ion.trail.length > MAX_TRAIL_POINTS) ion.trail.shift();
            }
            if (ion.sampleCounter % SERIES_SAMPLE_STRIDE === 0) {
                ion.seriesX.push(ion.x);
                ion.seriesY.push(ion.y);
                ion.seriesTime.push(ion.timeOfFlight);
                if (ion.seriesX.length > MAX_SERIES_POINTS) {
                    ion.seriesX.shift();
                    ion.seriesY.shift();
                    ion.seriesTime.shift();
                }
            }

            if (status === "transmitted") {
                state.transmittedCount++;
                ion.finishedAt = state.elapsedSeconds;
            } else if (status === "struck") {
                state.struckCount++;
                ion.finishedAt = state.elapsedSeconds;
                state.impactMarks.push({ x: ion.x, y: ion.y, z: ion.z, color: ion.color });
                if (state.impactMarks.length > IMPACT_MARK_LIMIT) state.impactMarks.shift();
            }
        }
    }

    // Respawn finished ions so the beam keeps flowing.
    const lingerSeconds = FINISHED_LINGER_CYCLES * runtime.rfPeriod;
    for (let index = 0; index < state.liveIons.length; index++) {
        const ion = state.liveIons[index];
        if (ion.status === "flying" || ion.finishedAt === null) continue;
        if (state.elapsedSeconds - ion.finishedAt < lingerSeconds) continue;
        state.liveIons[index] = spawnLiveIon(pickSpeciesIndex());
    }
}

export function beamRadiusMetres() {
    return config.beamRadiusMm * METRES_PER_MM;
}
