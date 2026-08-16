// Mathieu stability from Floquet theory.
//
// Nothing here is tabulated: the stability region, its apex and the RF-only
// cutoff are all found by integrating Hill's equation, so the familiar
// (q = 0.706, a = 0.23699) apex is a result the simulation derives rather than
// a number it is told.

const FLOQUET_STEPS = 256;
const BISECTION_ITERATIONS = 40;

// u'' + (a - 2q cos 2tau) u = 0 has period pi in tau. Two independent solutions
// integrated over one period give the monodromy matrix; its determinant is one,
// so |trace| < 2 is exactly the bounded-motion condition.
function monodromyTrace(a, q, stepCount) {
    const h = Math.PI / stepCount;
    const curvature = (tau) => 2 * q * Math.cos(2 * tau) - a;

    let uA = 1, vA = 0;
    let uB = 0, vB = 1;

    for (let step = 0; step < stepCount; step++) {
        const tau = step * h;
        const kStart = curvature(tau);
        const kMid = curvature(tau + h / 2);
        const kEnd = curvature(tau + h);

        for (const solution of [0, 1]) {
            const u = solution === 0 ? uA : uB;
            const v = solution === 0 ? vA : vB;

            const k1u = v;
            const k1v = kStart * u;
            const k2u = v + (h / 2) * k1v;
            const k2v = kMid * (u + (h / 2) * k1u);
            const k3u = v + (h / 2) * k2v;
            const k3v = kMid * (u + (h / 2) * k2u);
            const k4u = v + h * k3v;
            const k4v = kEnd * (u + h * k3u);

            const nextU = u + (h / 6) * (k1u + 2 * k2u + 2 * k3u + k4u);
            const nextV = v + (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);

            if (solution === 0) { uA = nextU; vA = nextV; }
            else { uB = nextU; vB = nextV; }
        }
    }

    return uA + vB;
}

export function isAxisStable(a, q) {
    return Math.abs(monodromyTrace(a, q, FLOQUET_STEPS)) < 2;
}

// Same test at reduced accuracy, for filling the stability diagram raster where
// a pixel of error is invisible.
export function isAxisStableCoarse(a, q) {
    return Math.abs(monodromyTrace(a, q, 48)) < 2;
}

// The y axis sees (-a, -q); Mathieu stability is even in q, so testing (-a, q)
// is equivalent and avoids a second sign convention.
export function isBothAxesStable(a, q) {
    return isAxisStable(a, q) && isAxisStable(-a, q);
}

// The region is symmetric about a = 0, so one boundary describes it completely.
export function stabilityCeiling(q) {
    if (!isBothAxesStable(0, q)) return null;

    let low = 0;
    let high = 0.05;
    while (isBothAxesStable(high, q)) {
        high *= 2;
        if (high > 4) return null;
    }
    for (let i = 0; i < BISECTION_ITERATIONS; i++) {
        const middle = 0.5 * (low + high);
        if (isBothAxesStable(middle, q)) low = middle;
        else high = middle;
    }
    return 0.5 * (low + high);
}

function findRfOnlyCutoff() {
    let low = 0.5;
    let high = 1.5;
    for (let i = 0; i < BISECTION_ITERATIONS; i++) {
        const middle = 0.5 * (low + high);
        if (isBothAxesStable(0, middle)) low = middle;
        else high = middle;
    }
    return 0.5 * (low + high);
}

function findApex() {
    let low = 0.4;
    let high = 0.9;
    for (let i = 0; i < 80; i++) {
        const leftProbe = low + (high - low) / 3;
        const rightProbe = high - (high - low) / 3;
        const leftValue = stabilityCeiling(leftProbe) ?? -1;
        const rightValue = stabilityCeiling(rightProbe) ?? -1;
        if (leftValue < rightValue) low = leftProbe;
        else high = rightProbe;
    }
    const q = 0.5 * (low + high);
    return { q, a: stabilityCeiling(q) ?? 0 };
}

export const RF_ONLY_CUTOFF_Q = findRfOnlyCutoff();
export const STABILITY_APEX = findApex();
// U/V at the apex. Operating lines are expressed as a percentage of this so the
// resolution control means the same thing regardless of geometry or frequency.
export const APEX_DC_RF_RATIO = STABILITY_APEX.a / (2 * STABILITY_APEX.q);

// Boundary polyline for the stability diagram, cached because it never changes.
export const STABILITY_BOUNDARY = (() => {
    const points = [];
    const sampleCount = 220;
    for (let i = 0; i <= sampleCount; i++) {
        const q = (RF_ONLY_CUTOFF_Q * i) / sampleCount;
        const a = q === 0 ? 0 : stabilityCeiling(q);
        if (a === null) continue;
        points.push({ q, a });
    }
    return points;
})();

// The q interval a scan line a = 2*ratio*q cuts out of the stability region.
// Because a and q both scale as 1/(m/z), this interval fixes the transmitted
// mass window at every scan setpoint and is worth caching per operating line.
const acceptanceCache = new Map();

export function getScanLineAcceptance(dcRfRatio) {
    const key = dcRfRatio.toFixed(6);
    const cached = acceptanceCache.get(key);
    if (cached) return cached;

    const slope = 2 * dcRfRatio;
    const sampleCount = 400;
    let qLow = null;
    let qHigh = null;
    for (let i = 1; i <= sampleCount; i++) {
        const q = (RF_ONLY_CUTOFF_Q * i) / sampleCount;
        if (!isBothAxesStable(slope * q, q)) continue;
        if (qLow === null) qLow = q;
        qHigh = q;
    }

    // With no DC the line is stable all the way down to q = 0, so the sampled
    // lower edge is only the grid floor: the transmitted mass band has no upper
    // limit and any width derived from it would be meaningless.
    const unbounded = qLow !== null && qLow <= RF_ONLY_CUTOFF_Q / sampleCount;
    const acceptance = qLow === null
        ? { qLow: 0, qHigh: 0, empty: true, unbounded: false }
        : { qLow, qHigh, empty: false, unbounded };
    acceptanceCache.set(key, acceptance);
    return acceptance;
}
