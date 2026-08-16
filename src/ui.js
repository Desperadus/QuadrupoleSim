// DOM wiring: controls, readouts and the presentation refresh loop.

import { MULTIPOLE_ORDERS, METRES_PER_MM } from "./constants.js";
import {
    STABILITY_APEX,
    APEX_DC_RF_RATIO,
    RF_ONLY_CUTOFF_Q,
    isBothAxesStable
} from "./stability.js";
import {
    mathieuA,
    mathieuQ,
    expectedFlightCycles,
    electrodePotential
} from "./physics.js";
import {
    config,
    state,
    SAMPLE_MIXTURES,
    applySample,
    setCustomSpecies,
    rebuildRuntime,
    resetLiveBeam,
    syncLiveIonCount
} from "./state.js";
import { scanState, startScan, stopScan, advanceScan } from "./scan.js";
import {
    initPlots,
    resizePlots,
    drawSpectrum,
    drawStabilityDiagram,
    drawIonAxes,
    drawRfDial,
    stabilityCanvasToParameters
} from "./plots.js";
import { invalidateRender, view, advanceFrame } from "./render3d.js";
import { createTourController } from "./tour.js";

const PRESENTATION_INTERVAL_MS = 40;
const SCAN_BUDGET_MS = 12;
const AXIAL_VIEW_ROTATION = { rotationX: 0, rotationY: -Math.PI / 2 };
const DEFAULT_VIEW_ROTATION = { rotationX: -0.42, rotationY: 0.62 };

let p5Instance = null;
let customSpecies = [];

function element(id) {
    return document.getElementById(id);
}

function setText(id, value) {
    const node = element(id);
    if (node) node.innerText = value;
}

// Ideal mass window the current operating line lets through, from the stability
// region alone. The flown scan is what actually measures the peak.
function idealMassWindow() {
    const runtime = state.runtime;
    if (config.mode === "rf-only" || runtime.acceptance.empty ||
        runtime.acceptance.unbounded) return null;
    const low = runtime.scanConstant / runtime.acceptance.qHigh;
    const high = runtime.scanConstant / runtime.acceptance.qLow;
    return { low, high, width: high - low, centre: 0.5 * (low + high) };
}

function refreshDerivedReadouts() {
    const runtime = state.runtime;
    setText("derived-v", `${runtime.rfAmplitude.toFixed(1)} V`);
    setText("derived-u", `${runtime.dcVoltage.toFixed(1)} V`);

    const massWindow = idealMassWindow();
    if (massWindow) {
        setText("derived-dm", `${massWindow.width.toFixed(3)} m/z`);
        setText("derived-r", Math.round(massWindow.centre / massWindow.width).toString());
        setText("stability-window", `${massWindow.width.toFixed(3)} m/z`);
    } else if (config.mode === "rf-only" || runtime.acceptance.unbounded) {
        const lowEdge = config.mode === "rf-only"
            ? config.lowMassCutoffMz
            : runtime.scanConstant / runtime.acceptance.qHigh;
        setText("derived-dm", "high-pass");
        setText("derived-r", "—");
        setText("stability-window", `> ${lowEdge.toFixed(1)} m/z`);
    } else {
        setText("derived-dm", "closed");
        setText("derived-r", "∞");
        setText("stability-window", "closed");
    }

    const referenceMz = config.mode === "rf-only" ? config.lowMassCutoffMz : config.targetMz;
    setText("stability-a", mathieuA(referenceMz, runtime).toFixed(5));
    setText("stability-q", mathieuQ(referenceMz, runtime).toFixed(5));
    setText("stability-ratio", (2 * runtime.dcRfRatio).toFixed(5));
}

function refreshMultipoleReadout() {
    const grid = element("multipole-grid");
    if (!grid) return;
    grid.innerHTML = "";
    MULTIPOLE_ORDERS.forEach((order, index) => {
        const value = state.runtime.coefficients[index];
        const cell = document.createElement("div");
        const nearZero = order !== 2 && Math.abs(value) < 5e-4;
        cell.innerHTML = `<span class="lbl">A<sub>${order}</sub></span>` +
            `<span class="val${nearZero ? " near-zero" : ""}">${value.toFixed(5)}</span>`;
        grid.appendChild(cell);
    });
}

function refreshSpeciesPanels() {
    const runtime = state.runtime;

    const legend = element("species-legend");
    legend.innerHTML = "";
    for (const species of state.species) {
        const q = mathieuQ(species.mz, runtime);
        const a = mathieuA(species.mz, runtime);
        const stable = isBothAxesStable(a, q);
        const row = document.createElement("div");
        row.className = "species-row";
        row.innerHTML =
            `<span class="species-dot" style="background:${species.color}"></span>` +
            `<span class="species-name">${species.label} &middot; m/z ${species.mz}</span>` +
            `<span class="species-metric">a ${a.toFixed(4)} &nbsp; q ${q.toFixed(4)}</span>` +
            `<span class="species-verdict ${stable ? "pass" : "block"}">` +
            `${stable ? "stable" : "unstable"}</span>`;
        legend.appendChild(row);
    }

    const editor = element("species-editor");
    editor.innerHTML = "";
    if (customSpecies.length === 0) {
        editor.innerHTML = `<div class="peak-empty">Add ions to build a custom mixture, ` +
            `or pick a preset from the Sample menu.</div>`;
        return;
    }
    customSpecies.forEach((species, index) => {
        const row = document.createElement("div");
        row.className = "species-row";
        row.innerHTML =
            `<span class="species-name">${species.label} &middot; m/z ${species.mz}</span>` +
            `<span class="species-metric">abundance ${species.abundance}</span>`;
        const remove = document.createElement("button");
        remove.className = "species-remove";
        remove.type = "button";
        remove.innerText = "Remove";
        remove.addEventListener("click", () => {
            customSpecies.splice(index, 1);
            if (customSpecies.length === 0) {
                applySample("triplet");
                element("select-sample").value = "triplet";
            } else {
                setCustomSpecies(customSpecies);
            }
            refreshEverything();
        });
        row.appendChild(remove);
        editor.appendChild(row);
    });
}

function refreshSampleSummary() {
    const names = state.species.map((species) => `${species.label} (m/z ${species.mz})`);
    setText("injection-summary", `${state.species.length} species • ${names.join(" • ")}`);
}

function refreshStats() {
    const runtime = state.runtime;
    setText("stat-mode", config.mode === "rf-only" ? "RF-Only Guide" : "Mass Selective");
    setText("stat-rf", `${runtime.rfAmplitude.toFixed(1)} V`);
    setText("stat-dc", `${runtime.dcVoltage.toFixed(1)} V`);
    setText("stat-phi", `${electrodePotential(runtime, state.globalRfPhase).toFixed(1)} V`);

    const finished = state.transmittedCount + state.struckCount;
    const percent = finished > 0
        ? ` (${Math.round((100 * state.transmittedCount) / finished)}%)`
        : "";
    setText("stat-transmission", `${state.transmittedCount} / ${finished}${percent}`);

    const referenceMz = config.mode === "rf-only" ? config.lowMassCutoffMz : config.targetMz;
    setText("stat-cycles", expectedFlightCycles(referenceMz, config, runtime).toFixed(0));
    setText("canvas-scale-note", `Axial scale compressed ${config.aspectExaggeration}×`);
}

function refreshIonSelect() {
    const select = element("select-inspect-ion");
    const previous = select.value;
    select.innerHTML = "";
    state.liveIons.forEach((ion, index) => {
        const option = document.createElement("option");
        option.value = index;
        option.innerText = `Ion ${index + 1} — ${ion.label} (m/z ${ion.mz})`;
        select.appendChild(option);
    });
    const previousIndex = Number(previous);
    select.value = Number.isInteger(previousIndex) && previousIndex < state.liveIons.length
        ? String(previousIndex)
        : String(state.inspectedIonIndex);
}

function refreshInspector() {
    const ion = state.liveIons[state.inspectedIonIndex];
    if (!ion) return;
    const runtime = state.runtime;
    setText("inspect-mz", ion.mz.toString());

    const statusNode = element("inspect-status");
    const statusText = ion.launchDelay > 0
        ? "Waiting at source"
        : ion.status === "flying" ? "In the filter"
            : ion.status === "transmitted" ? "Transmitted" : "Struck a rod";
    statusNode.innerText = statusText;
    statusNode.style.color = ion.status === "struck"
        ? "var(--accent-red)"
        : ion.status === "transmitted" ? "var(--accent-green)" : "var(--text-main)";

    setText("inspect-aq",
        `${mathieuA(ion.mz, runtime).toFixed(4)}, ${mathieuQ(ion.mz, runtime).toFixed(4)}`);
    setText("inspect-pos",
        `${(ion.x / METRES_PER_MM).toFixed(2)}, ${(ion.y / METRES_PER_MM).toFixed(2)}, ` +
        `${(ion.z / METRES_PER_MM).toFixed(1)}`);
    setText("inspect-vz", `${(ion.vz / 1000).toFixed(2)} km/s`);
    setText("inspect-cycles", (ion.timeOfFlight / runtime.rfPeriod).toFixed(1));
}

function refreshPeakTable() {
    const table = element("peak-table");
    table.innerHTML = "";
    if (scanState.peaks.length === 0) {
        table.innerHTML = `<div class="peak-empty">No peaks detected yet.</div>`;
        return;
    }
    const header = document.createElement("div");
    header.className = "peak-row head";
    header.innerHTML = `<span>Centre m/z</span><span>FWHM</span><span>R = m/Δm</span><span>Rel.</span>`;
    table.appendChild(header);
    for (const peak of scanState.peaks) {
        const row = document.createElement("div");
        row.className = "peak-row";
        row.innerHTML =
            `<span>${peak.centreMz.toFixed(3)}</span>` +
            `<span>${peak.widthFwhm.toFixed(3)}</span>` +
            `<span>${peak.resolution === null ? "—" : Math.round(peak.resolution)}</span>` +
            `<span>${Math.round(peak.relativeIntensity * 100)}%</span>`;
        table.appendChild(row);
    }
}

function refreshModeVisibility() {
    const isGuide = config.mode === "rf-only";
    element("group-target-mz").hidden = isGuide;
    element("group-cutoff-mz").hidden = !isGuide;
    element("group-dcrf-setup").hidden = isGuide;
    element("btn-mode-filter").classList.toggle("active", !isGuide);
    element("btn-mode-guide").classList.toggle("active", isGuide);
    element("btn-mode-filter").setAttribute("aria-pressed", String(!isGuide));
    element("btn-mode-guide").setAttribute("aria-pressed", String(isGuide));
    element("slider-dcrf").disabled = isGuide;
    setText("scan-mode-note", isGuide
        ? "RF ramped, DC held at zero"
        : "DC and RF ramped together");
}

function refreshControlLabels() {
    setText("lbl-target-mz", config.targetMz.toString());
    setText("lbl-cutoff-mz", config.lowMassCutoffMz.toString());
    setText("lbl-dcrf", `${config.dcRfPercent.toFixed(2)}% of apex`);
    setText("lbl-dcrf-setup", `${config.dcRfPercent.toFixed(2)}% of apex`);
    setText("lbl-r0", `${config.r0mm.toFixed(1)} mm`);
    setText("lbl-length", `${config.rodLengthMm} mm`);
    setText("lbl-frequency", `${config.rfFrequencyMHz.toFixed(2)} MHz`);
    setText("lbl-energy", `${config.ionEnergyEv.toFixed(1)} eV`);
    setText("lbl-beam", `${config.beamRadiusMm.toFixed(2)} mm`);
    setText("lbl-transverse", `${config.transverseEnergyEv.toFixed(3)} eV`);
    setText("lbl-fringe", `${config.fringeLengthMm.toFixed(1)} mm`);
    setText("lbl-ion-count", config.liveIonCount.toString());
    setText("lbl-aspect", `${config.aspectExaggeration}×`);
    setText("lbl-rod-opacity", `${config.rodOpacity}%`);
    setText("lbl-rod-ratio", config.rodRadiusRatio.toFixed(4));

    element("slider-target-mz").value = config.targetMz;
    element("input-target-mz").value = config.targetMz;
    element("slider-cutoff-mz").value = config.lowMassCutoffMz;
    element("slider-dcrf").value = config.dcRfPercent;
    element("slider-dcrf-setup").value = config.dcRfPercent;
    element("slider-r0").value = config.r0mm;
    element("slider-length").value = config.rodLengthMm;
    element("slider-frequency").value = config.rfFrequencyMHz;
    element("slider-energy").value = config.ionEnergyEv;
    element("slider-beam").value = config.beamRadiusMm;
    element("slider-transverse").value = config.transverseEnergyEv;
    element("slider-fringe").value = config.fringeLengthMm;
    element("slider-ion-count").value = config.liveIonCount;
    element("slider-aspect").value = config.aspectExaggeration;
    element("slider-rod-opacity").value = config.rodOpacity;
    element("slider-rod-ratio").value = config.rodRadiusRatio;
    element("input-playback").value = config.playbackCyclesPerSecond;
    element("toggle-fringe").checked = config.fringeEnabled;
    element("toggle-random-phase").checked = config.randomEntryPhase;
    element("group-rod-ratio").hidden = config.geometry !== "round";
    document.querySelectorAll(".seg-btn[data-geometry]").forEach((button) => {
        button.classList.toggle("active", button.dataset.geometry === config.geometry);
    });
    element("btn-toggle-field").setAttribute("aria-pressed", String(config.showField));
    element("btn-toggle-field").classList.toggle("btn-primary", config.showField);
    element("electric-field-legend").hidden = !config.showField;
    element("btn-toggle-trails").setAttribute("aria-pressed", String(config.showTrails));
    element("btn-toggle-grid").classList.toggle("btn-primary", config.showGrid);
}

export function refreshEverything() {
    refreshModeVisibility();
    refreshControlLabels();
    refreshDerivedReadouts();
    refreshMultipoleReadout();
    refreshSpeciesPanels();
    refreshSampleSummary();
    refreshIonSelect();
    refreshPeakTable();
    refreshStats();
    drawActiveTabPlots();
    invalidateRender();
}

function activeTabId() {
    return document.querySelector(".tab-content.active")?.id;
}

function drawActiveTabPlots() {
    switch (activeTabId()) {
        case "tab-spectrum":
            drawSpectrum();
            break;
        case "tab-stability":
            drawStabilityDiagram();
            break;
        case "tab-plots":
            drawIonAxes();
            refreshInspector();
            break;
        default:
            break;
    }
}

// Applies a configuration patch and rebuilds only what the change requires.
function updateConfig(patch, { resetBeam = false } = {}) {
    Object.assign(config, patch);
    rebuildRuntime();
    if (resetBeam) resetLiveBeam();
    refreshEverything();
}

function bindSlider(id, key, { parse = parseFloat, resetBeam = false } = {}) {
    element(id).addEventListener("input", (event) => {
        updateConfig({ [key]: parse(event.target.value) }, { resetBeam });
    });
}

function setupTabs() {
    const tabs = document.querySelectorAll(".tab-btn");
    const contents = document.querySelectorAll(".tab-content");
    tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
            tabs.forEach((other) => other.classList.remove("active"));
            contents.forEach((content) => content.classList.remove("active"));
            tab.classList.add("active");
            element(tab.dataset.tab).classList.add("active");
            resizePlots();
            drawActiveTabPlots();
        });
    });
}

function selectTab(tabId) {
    const tab = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    if (tab) tab.click();
}

function setupPlayback() {
    const playButton = element("btn-play");
    playButton.addEventListener("click", () => {
        state.isPlaying = !state.isPlaying;
        playButton.innerText = state.isPlaying ? "Pause" : "Play";
        playButton.classList.toggle("btn-primary", state.isPlaying);
        invalidateRender();
    });

    element("btn-step").addEventListener("click", () => {
        if (state.isPlaying) return;
        advanceFrame();
        drawActiveTabPlots();
        refreshStats();
        invalidateRender();
    });

    element("btn-reset").addEventListener("click", () => {
        resetLiveBeam();
        refreshEverything();
    });

    const playbackInput = element("input-playback");
    playbackInput.addEventListener("input", () => {
        const value = Number(playbackInput.value);
        if (Number.isFinite(value) && value > 0) {
            config.playbackCyclesPerSecond = value;
            playbackInput.setCustomValidity("");
        } else {
            playbackInput.setCustomValidity("Enter a playback rate greater than 0.");
        }
    });
}

function setupModeSwitch() {
    document.querySelectorAll(".mode-btn").forEach((button) => {
        button.addEventListener("click", () => {
            updateConfig({ mode: button.dataset.mode });
        });
    });
}

function setupSampleSelect() {
    const select = element("select-sample");
    for (const [key, mixture] of Object.entries(SAMPLE_MIXTURES)) {
        const option = document.createElement("option");
        option.value = key;
        option.innerText = mixture.label;
        select.appendChild(option);
    }
    select.value = state.sampleKey;
    select.addEventListener("change", () => {
        applySample(select.value);
        refreshEverything();
    });
}

function setupScanControls() {
    const scanButton = element("btn-scan");
    const stopButton = element("btn-scan-stop");

    const readScanInputs = () => {
        scanState.mzMin = Math.max(1, Number(element("input-scan-min").value));
        scanState.mzMax = Math.max(scanState.mzMin + 1, Number(element("input-scan-max").value));
        scanState.stepCount = Math.max(20, Math.round(Number(element("input-scan-steps").value)));
        scanState.ionsPerStep = Math.max(1, Math.round(Number(element("input-scan-shots").value)));
        scanState.fastPrefilter = element("check-fast-scan").checked;
    };

    scanButton.addEventListener("click", () => {
        readScanInputs();
        startScan();
        scanButton.disabled = true;
        stopButton.disabled = false;
        refreshPeakTable();
    });

    stopButton.addEventListener("click", () => {
        stopScan();
        scanButton.disabled = false;
        stopButton.disabled = true;
    });
}

function runScanFromTour(range) {
    element("input-scan-min").value = range.mzMin;
    element("input-scan-max").value = range.mzMax;
    element("btn-scan").click();
}

function setupStabilityInteraction() {
    const canvas = element("canvas-stability");
    canvas.addEventListener("click", (event) => {
        const bounds = canvas.getBoundingClientRect();
        const parameters = stabilityCanvasToParameters(
            event.clientX - bounds.left,
            event.clientY - bounds.top
        );
        if (!parameters || parameters.q <= 0.01) return;

        // The click sets the operating line slope, and the RF amplitude is
        // re-derived so the ion at the target m/z lands on the clicked q.
        const ratioPercent = Math.max(0, Math.min(
            99.95,
            (Math.abs(parameters.a) / (2 * parameters.q) / APEX_DC_RF_RATIO) * 100
        ));
        if (config.mode === "rf-only") {
            updateConfig({
                lowMassCutoffMz: Math.max(
                    1,
                    (RF_ONLY_CUTOFF_Q / parameters.q) * config.lowMassCutoffMz
                )
            });
            return;
        }
        const currentQ = mathieuQ(config.targetMz, state.runtime);
        updateConfig({
            dcRfPercent: ratioPercent,
            targetMz: Math.max(1, config.targetMz * (currentQ / parameters.q))
        });
    });
}

function setupGeometryControls() {
    document.querySelectorAll(".seg-btn[data-geometry]").forEach((button) => {
        button.addEventListener("click", () => {
            updateConfig({ geometry: button.dataset.geometry }, { resetBeam: true });
        });
    });
    element("slider-rod-ratio").addEventListener("input", (event) => {
        updateConfig({ rodRadiusRatio: parseFloat(event.target.value) }, { resetBeam: true });
    });
}

function setupTuningControls() {
    element("slider-target-mz").addEventListener("input", (event) => {
        updateConfig({ targetMz: parseFloat(event.target.value) });
    });
    element("input-target-mz").addEventListener("change", (event) => {
        const value = parseFloat(event.target.value);
        if (Number.isFinite(value) && value > 0) updateConfig({ targetMz: value });
    });
    bindSlider("slider-cutoff-mz", "lowMassCutoffMz");
    for (const id of ["slider-dcrf", "slider-dcrf-setup"]) {
        element(id).addEventListener("input", (event) => {
            updateConfig({ dcRfPercent: parseFloat(event.target.value) });
        });
    }
    bindSlider("slider-r0", "r0mm", { resetBeam: true });
    bindSlider("slider-length", "rodLengthMm", { parse: parseInt, resetBeam: true });
    bindSlider("slider-frequency", "rfFrequencyMHz");
    bindSlider("slider-energy", "ionEnergyEv");
    bindSlider("slider-beam", "beamRadiusMm");
    bindSlider("slider-transverse", "transverseEnergyEv");
    bindSlider("slider-fringe", "fringeLengthMm");
    bindSlider("slider-aspect", "aspectExaggeration");
    bindSlider("slider-rod-opacity", "rodOpacity", { parse: parseInt });

    element("slider-ion-count").addEventListener("input", (event) => {
        config.liveIonCount = parseInt(event.target.value);
        syncLiveIonCount();
        refreshEverything();
    });
    element("toggle-fringe").addEventListener("change", (event) => {
        updateConfig({ fringeEnabled: event.target.checked });
    });
    element("toggle-random-phase").addEventListener("change", (event) => {
        updateConfig({ randomEntryPhase: event.target.checked });
    });
}

function setupViewControls() {
    element("btn-camera-reset").addEventListener("click", () => {
        if (p5Instance) p5Instance.camera();
        Object.assign(view, DEFAULT_VIEW_ROTATION);
        invalidateRender();
    });
    element("btn-view-axial").addEventListener("click", () => {
        if (p5Instance) p5Instance.camera();
        Object.assign(view, AXIAL_VIEW_ROTATION);
        invalidateRender();
    });
    element("btn-toggle-grid").addEventListener("click", () => {
        updateConfig({ showGrid: !config.showGrid });
    });
    element("btn-toggle-field").addEventListener("click", () => {
        updateConfig({ showField: !config.showField });
    });
    element("btn-toggle-trails").addEventListener("click", () => {
        updateConfig({ showTrails: !config.showTrails });
    });
    element("select-inspect-ion").addEventListener("change", (event) => {
        state.inspectedIonIndex = parseInt(event.target.value);
        drawActiveTabPlots();
    });
}

function setupCustomMixture() {
    element("btn-add-species").addEventListener("click", () => {
        const mz = parseFloat(element("input-add-mz").value);
        const abundance = parseFloat(element("input-add-abundance").value);
        if (!Number.isFinite(mz) || mz <= 0) return;
        const label = element("input-add-label").value.trim() || `m/z ${mz}`;
        customSpecies.push({
            mz,
            abundance: Number.isFinite(abundance) && abundance > 0 ? abundance : 100,
            label
        });
        setCustomSpecies(customSpecies);
        element("select-sample").value = "";
        element("input-add-label").value = "";
        refreshEverything();
    });

    element("btn-clear-species").addEventListener("click", () => {
        customSpecies = [];
        applySample("triplet");
        element("select-sample").value = "triplet";
        refreshEverything();
    });
}

function buildTourApi(tabSelector) {
    return {
        setConfig: (patch) => updateConfig(patch),
        setMode: (mode) => updateConfig({ mode }),
        setSample: (key) => {
            applySample(key);
            element("select-sample").value = key;
            refreshEverything();
        },
        setTab: tabSelector,
        runScan: runScanFromTour
    };
}

function startPresentationLoop() {
    setInterval(() => {
        if (scanState.running) {
            const progressed = advanceScan(SCAN_BUDGET_MS);
            const percent = Math.round((100 * scanState.stepIndex) / scanState.stepCount);
            setText("scan-progress",
                `Scanning ${percent}% • ${scanState.stepIndex}/${scanState.stepCount} setpoints ` +
                `• ${scanState.flightsFlown} ion flights`);
            if (progressed && activeTabId() === "tab-spectrum") drawSpectrum();
            if (!scanState.running) {
                element("btn-scan").disabled = false;
                element("btn-scan-stop").disabled = true;
                setText("scan-progress",
                    `Complete • ${scanState.flightsFlown} ion flights in ` +
                    `${(scanState.durationMs / 1000).toFixed(1)} s`);
                refreshPeakTable();
                drawSpectrum();
            }
        }

        if (document.hidden) return;
        drawRfDial();
        refreshStats();
        if (!state.isPlaying) return;
        drawActiveTabPlots();
    }, PRESENTATION_INTERVAL_MS);
}

export function setupUI(instance) {
    p5Instance = instance;

    setupTabs();
    setupPlayback();
    setupModeSwitch();
    setupSampleSelect();
    setupScanControls();
    setupStabilityInteraction();
    setupGeometryControls();
    setupTuningControls();
    setupViewControls();
    setupCustomMixture();
    initPlots();

    setText("stability-apex-note",
        `apex q=${STABILITY_APEX.q.toFixed(3)} a=${STABILITY_APEX.a.toFixed(5)}`);
    const apexNode = element("theory-apex-values");
    if (apexNode) {
        apexNode.innerHTML =
            `apex: q = ${STABILITY_APEX.q.toFixed(5)}, a = ${STABILITY_APEX.a.toFixed(5)}` +
            `<br>RF-only cutoff: q = ${RF_ONLY_CUTOFF_Q.toFixed(5)}` +
            `<br>apex U/V = ${APEX_DC_RF_RATIO.toFixed(5)}`;
    }

    const tour = createTourController(buildTourApi(selectTab));
    element("btn-tour").addEventListener("click", tour.open);

    refreshEverything();
    startPresentationLoop();
}
