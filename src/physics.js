// Field evaluation, ion integration and rod collisions.
//
// Everything is done in SI units so the voltages, frequencies and flight times
// the interface reports are the ones a real instrument would show.

import {
    ELEMENTARY_CHARGE,
    ATOMIC_MASS_UNIT,
    METRES_PER_MM,
    MATHIEU_A_FACTOR,
    MATHIEU_Q_FACTOR,
    MULTIPOLE_ORDERS,
    STEPS_PER_RF_CYCLE
} from "./constants.js";
import { getRoundRodCoefficients, IDEAL_HYPERBOLIC_COEFFICIENTS } from "./multipole.js";
import {
    RF_ONLY_CUTOFF_Q,
    APEX_DC_RF_RATIO,
    STABILITY_APEX,
    getScanLineAcceptance
} from "./stability.js";

const HIGHEST_ORDER = MULTIPOLE_ORDERS[MULTIPOLE_ORDERS.length - 1];
// Ions that stray this far past the rods are treated as gone even if the
// truncated rod cross-section would not have caught them.
const ESCAPE_RADIUS_FACTOR = 4;

export function massPerCharge(mz) {
    return mz * ATOMIC_MASS_UNIT;
}

export function axialVelocity(mz, ionEnergyEv) {
    return Math.sqrt((2 * ELEMENTARY_CHARGE * ionEnergyEv) / massPerCharge(mz));
}

// Builds the immutable per-configuration data the integrator needs.
export function buildRuntime(config) {
    const r0 = config.r0mm * METRES_PER_MM;
    const length = config.rodLengthMm * METRES_PER_MM;
    const omega = 2 * Math.PI * config.rfFrequencyMHz * 1e6;
    const coefficients = config.geometry === "round"
        ? getRoundRodCoefficients(config.rodRadiusRatio)
        : IDEAL_HYPERBOLIC_COEFFICIENTS;

    const coefficientByOrder = new Float64Array(HIGHEST_ORDER + 1);
    MULTIPOLE_ORDERS.forEach((order, index) => {
        coefficientByOrder[order] = coefficients[index];
    });

    const dcRfRatio = config.mode === "rf-only"
        ? 0
        : (config.dcRfPercent / 100) * APEX_DC_RF_RATIO;

    // The RF amplitude is chosen so the target m/z sits at the midpoint of the q
    // interval the operating line cuts out of the stability region. Centring the
    // transmitted *mass* band instead would be ill-posed at low DC, where the
    // upper mass edge runs to infinity and would drive the amplitude to zero.
    // In RF-only mode there is no upper mass limit at all, so the amplitude is
    // anchored to the low-mass cutoff.
    const acceptance = getScanLineAcceptance(dcRfRatio);
    const scanConstant = config.mode === "rf-only"
        ? RF_ONLY_CUTOFF_Q * config.lowMassCutoffMz
        : (acceptance.empty
            ? STABILITY_APEX.q * config.targetMz
            : 0.5 * (acceptance.qLow + acceptance.qHigh) * config.targetMz);

    const mathieuScale = massPerCharge(1) * omega * omega * r0 * r0;
    const rfAmplitude = (scanConstant * mathieuScale) / (MATHIEU_Q_FACTOR * ELEMENTARY_CHARGE);
    const dcVoltage = dcRfRatio * rfAmplitude;

    return {
        r0,
        length,
        omega,
        rfPeriod: (2 * Math.PI) / omega,
        coefficientByOrder,
        coefficients,
        geometry: config.geometry,
        rodRadius: config.rodRadiusRatio * r0,
        rodCentre: (1 + config.rodRadiusRatio) * r0,
        fringeLength: config.fringeEnabled ? config.fringeLengthMm * METRES_PER_MM : 0,
        rfAmplitude,
        dcVoltage,
        dcRfRatio,
        acceptance,
        scanConstant,
        escapeRadius: ESCAPE_RADIUS_FACTOR * r0
    };
}

// Mathieu parameters depend on m/z alone: the charge state cancels between the
// force and the mass, which is why a quadrupole separates by m/z and not mass.
export function mathieuQ(mz, runtime) {
    return (MATHIEU_Q_FACTOR * ELEMENTARY_CHARGE * runtime.rfAmplitude) /
        (massPerCharge(mz) * runtime.omega * runtime.omega * runtime.r0 * runtime.r0);
}

export function mathieuA(mz, runtime) {
    return (MATHIEU_A_FACTOR * ELEMENTARY_CHARGE * runtime.dcVoltage) /
        (massPerCharge(mz) * runtime.omega * runtime.omega * runtime.r0 * runtime.r0);
}

export function mzForQ(q, runtime) {
    return runtime.scanConstant / q;
}

// Normalised potential and its gradient for a unit rod potential. The quadrupole
// symmetry only admits harmonics of order 2, 6, 10, 14 ..., which is why the
// series is written directly in powers of the complex coordinate (x + iy)/r0.
function evaluateNormalisedField(x, y, runtime, out) {
    const coefficientByOrder = runtime.coefficientByOrder;
    const inverseR0 = 1 / runtime.r0;
    const ur = x * inverseR0;
    const ui = y * inverseR0;

    let realPart = 1;
    let imagPart = 0;
    let potential = 0;
    let gradientX = 0;
    let gradientY = 0;

    for (let order = 1; order <= HIGHEST_ORDER; order++) {
        const coefficient = coefficientByOrder[order];
        if (coefficient !== 0) {
            gradientX += order * coefficient * realPart;
            gradientY -= order * coefficient * imagPart;
        }
        const nextReal = realPart * ur - imagPart * ui;
        const nextImag = realPart * ui + imagPart * ur;
        realPart = nextReal;
        imagPart = nextImag;
        if (coefficient !== 0) potential += coefficient * realPart;
    }

    out.potential = potential;
    out.gradientX = gradientX * inverseR0;
    out.gradientY = gradientY * inverseR0;
    return out;
}

// First-order fringe model: the transverse field is ramped in and out, and the
// accompanying axial component follows from the same scaling function.
function fringeProfile(z, runtime, out) {
    const rampLength = runtime.fringeLength;
    if (rampLength <= 0) {
        out.scale = z >= 0 && z <= runtime.length ? 1 : 0;
        out.slope = 0;
        return out;
    }
    if (z < rampLength) {
        const t = Math.max(0, z / rampLength);
        out.scale = t * t * (3 - 2 * t);
        out.slope = (6 * t * (1 - t)) / rampLength;
        return out;
    }
    if (z > runtime.length - rampLength) {
        const t = Math.max(0, (runtime.length - z) / rampLength);
        out.scale = t * t * (3 - 2 * t);
        out.slope = -(6 * t * (1 - t)) / rampLength;
        return out;
    }
    out.scale = 1;
    out.slope = 0;
    return out;
}

const fieldScratch = { potential: 0, gradientX: 0, gradientY: 0 };
const fringeScratch = { scale: 0, slope: 0 };

export function electrodePotential(runtime, rfPhase) {
    return runtime.dcVoltage - runtime.rfAmplitude * Math.cos(rfPhase);
}

// Electric field in V/m at a point, for the current RF phase.
export function electricFieldAt(x, y, z, rfPhase, runtime) {
    evaluateNormalisedField(x, y, runtime, fieldScratch);
    fringeProfile(z, runtime, fringeScratch);
    const phi0 = electrodePotential(runtime, rfPhase);
    return {
        x: -phi0 * fringeScratch.scale * fieldScratch.gradientX,
        y: -phi0 * fringeScratch.scale * fieldScratch.gradientY,
        z: -phi0 * fringeScratch.slope * fieldScratch.potential
    };
}

function accelerate(ion, runtime, out) {
    evaluateNormalisedField(ion.x, ion.y, runtime, fieldScratch);
    fringeProfile(ion.z, runtime, fringeScratch);
    const drive = electrodePotential(runtime, ion.rfPhase) * ion.chargeToMass;
    out.x = -drive * fringeScratch.scale * fieldScratch.gradientX;
    out.y = -drive * fringeScratch.scale * fieldScratch.gradientY;
    out.z = -drive * fringeScratch.slope * fieldScratch.potential;
    return out;
}

function hitsRod(x, y, runtime) {
    if (runtime.geometry === "round") {
        const rodRadiusSquared = runtime.rodRadius * runtime.rodRadius;
        const offsetX = Math.abs(x) - runtime.rodCentre;
        if (offsetX * offsetX + y * y <= rodRadiusSquared) return true;
        const offsetY = Math.abs(y) - runtime.rodCentre;
        return x * x + offsetY * offsetY <= rodRadiusSquared;
    }
    return Math.abs(x * x - y * y) >= runtime.r0 * runtime.r0;
}

const accelerationNow = { x: 0, y: 0, z: 0 };
const accelerationNext = { x: 0, y: 0, z: 0 };

// Velocity Verlet. The RF phase advances with the position update so the second
// force evaluation already sees the new phase.
export function stepIon(ion, runtime, dt) {
    if (ion.status !== "flying") return ion.status;

    accelerate(ion, runtime, accelerationNow);
    const halfDtSquared = 0.5 * dt * dt;
    ion.x += ion.vx * dt + accelerationNow.x * halfDtSquared;
    ion.y += ion.vy * dt + accelerationNow.y * halfDtSquared;
    ion.z += ion.vz * dt + accelerationNow.z * halfDtSquared;
    ion.rfPhase += runtime.omega * dt;

    accelerate(ion, runtime, accelerationNext);
    ion.vx += 0.5 * (accelerationNow.x + accelerationNext.x) * dt;
    ion.vy += 0.5 * (accelerationNow.y + accelerationNext.y) * dt;
    ion.vz += 0.5 * (accelerationNow.z + accelerationNext.z) * dt;
    ion.timeOfFlight += dt;

    if (hitsRod(ion.x, ion.y, runtime) ||
        ion.x * ion.x + ion.y * ion.y > runtime.escapeRadius * runtime.escapeRadius) {
        ion.status = "struck";
    } else if (ion.z < 0 && ion.vz <= 0) {
        // A strong fringe field can turn an ion around before it ever enters.
        ion.status = "struck";
    } else if (ion.z >= runtime.length) {
        ion.status = "transmitted";
    }
    return ion.status;
}

export function createIonState(mz, runtime, entry) {
    return {
        mz,
        chargeToMass: ELEMENTARY_CHARGE / massPerCharge(mz),
        x: entry.x,
        y: entry.y,
        z: 0,
        vx: entry.vx,
        vy: entry.vy,
        vz: entry.vz,
        rfPhase: entry.rfPhase,
        timeOfFlight: 0,
        status: "flying"
    };
}

// Five-dimensional low-discrepancy sequence used to sample the ion source. Pure
// random sampling would leave shot noise on every scan point; spreading the
// entry conditions evenly gives a smooth spectrum from far fewer flights.
const SOURCE_DIMENSIONS = 5;
const R_SEQUENCE_ALPHAS = (() => {
    let root = 1.5;
    for (let iteration = 0; iteration < 60; iteration++) {
        const power = Math.pow(root, SOURCE_DIMENSIONS + 1);
        root -= (power - root - 1) / ((SOURCE_DIMENSIONS + 1) * power / root - 1);
    }
    return Array.from({ length: SOURCE_DIMENSIONS }, (_, k) => 1 / Math.pow(root, k + 1));
})();

function quasiRandom(sampleIndex, dimension) {
    return (0.5 + (sampleIndex + 1) * R_SEQUENCE_ALPHAS[dimension]) % 1;
}

// Samples an entry condition from the configured source: a round beam spot with
// an isotropic transverse energy spread and, optionally, a random RF phase.
// Passing a sample index switches from random to low-discrepancy sampling.
export function sampleEntryConditions(mz, config, runtime, sampleIndex = null) {
    const draw = sampleIndex === null
        ? () => Math.random()
        : (dimension) => quasiRandom(sampleIndex, dimension);

    const spotRadius = config.beamRadiusMm * METRES_PER_MM * Math.sqrt(draw(0));
    const spotAngle = 2 * Math.PI * draw(1);
    const transverseSpeed = Math.sqrt(
        (2 * ELEMENTARY_CHARGE * config.transverseEnergyEv * draw(2)) / massPerCharge(mz)
    );
    const transverseAngle = 2 * Math.PI * draw(3);
    return {
        x: spotRadius * Math.cos(spotAngle),
        y: spotRadius * Math.sin(spotAngle),
        vx: transverseSpeed * Math.cos(transverseAngle),
        vy: transverseSpeed * Math.sin(transverseAngle),
        vz: axialVelocity(mz, config.ionEnergyEv),
        rfPhase: config.randomEntryPhase ? 2 * Math.PI * draw(4) : 0
    };
}

// Flies one ion from the entrance to the exit and reports whether it made it.
export function flyIon(mz, config, runtime, maxCycles, sampleIndex = null) {
    const ion = createIonState(
        mz, runtime, sampleEntryConditions(mz, config, runtime, sampleIndex)
    );
    const dt = runtime.rfPeriod / STEPS_PER_RF_CYCLE;
    const stepLimit = maxCycles * STEPS_PER_RF_CYCLE;
    for (let step = 0; step < stepLimit; step++) {
        if (stepIon(ion, runtime, dt) !== "flying") break;
    }
    return ion;
}

export function expectedFlightCycles(mz, config, runtime) {
    return (runtime.length / axialVelocity(mz, config.ionEnergyEv)) / runtime.rfPeriod;
}
