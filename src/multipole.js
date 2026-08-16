// Field harmonics of a quadrupole built from round rods.
//
// Round rods cannot produce a pure quadrupole field. Rather than assuming
// tabulated coefficients, the two-dimensional Laplace problem is solved with the
// charge simulation method: line charges hidden inside each rod are fitted so
// that the rod surfaces sit at the applied potential, and the resulting
// potential is Fourier analysed on a circle to read off the harmonics.

import { MULTIPOLE_ORDERS } from "./constants.js";

const CHARGES_PER_ROD = 48;
const CHARGE_DEPTH_FRACTION = 0.5;
const ANALYSIS_RADIUS = 0.7;      // in units of r0
const ANALYSIS_SAMPLES = 128;

export const IDEAL_HYPERBOLIC_COEFFICIENTS = MULTIPOLE_ORDERS.map(
    (order) => (order === 2 ? 1 : 0)
);

function solveLinearSystem(matrix, rhs) {
    const size = rhs.length;
    const augmented = matrix.map((row, i) => [...row, rhs[i]]);

    for (let column = 0; column < size; column++) {
        let pivotRow = column;
        for (let row = column + 1; row < size; row++) {
            if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivotRow][column])) {
                pivotRow = row;
            }
        }
        [augmented[column], augmented[pivotRow]] = [augmented[pivotRow], augmented[column]];

        const pivot = augmented[column][column];
        for (let row = column + 1; row < size; row++) {
            const factor = augmented[row][column] / pivot;
            if (factor === 0) continue;
            for (let k = column; k <= size; k++) {
                augmented[row][k] -= factor * augmented[column][k];
            }
        }
    }

    const solution = new Float64Array(size);
    for (let row = size - 1; row >= 0; row--) {
        let accumulator = augmented[row][size];
        for (let column = row + 1; column < size; column++) {
            accumulator -= augmented[row][column] * solution[column];
        }
        solution[row] = accumulator / augmented[row][row];
    }
    return solution;
}

const coefficientCache = new Map();

export function getRoundRodCoefficients(rodRadiusRatio) {
    const key = rodRadiusRatio.toFixed(4);
    const cached = coefficientCache.get(key);
    if (cached) return cached;

    const rodRadius = rodRadiusRatio;
    const centreDistance = 1 + rodRadius;
    const chargeRadius = CHARGE_DEPTH_FRACTION * rodRadius;

    const chargePositions = [];
    const matchPositions = [];
    const boundaryPotentials = [];

    for (let rod = 0; rod < 4; rod++) {
        const rodAngle = (rod * Math.PI) / 2;
        const centreX = centreDistance * Math.cos(rodAngle);
        const centreY = centreDistance * Math.sin(rodAngle);
        const rodPotential = rod % 2 === 0 ? 1 : -1;

        for (let j = 0; j < CHARGES_PER_ROD; j++) {
            const chargeAngle = (2 * Math.PI * j) / CHARGES_PER_ROD;
            chargePositions.push({
                x: centreX + chargeRadius * Math.cos(chargeAngle),
                y: centreY + chargeRadius * Math.sin(chargeAngle)
            });

            // Offsetting the match points by half a step keeps the influence
            // matrix well conditioned.
            const matchAngle = chargeAngle + Math.PI / CHARGES_PER_ROD;
            matchPositions.push({
                x: centreX + rodRadius * Math.cos(matchAngle),
                y: centreY + rodRadius * Math.sin(matchAngle)
            });
            boundaryPotentials.push(rodPotential);
        }
    }

    const size = chargePositions.length;
    const influence = [];
    for (let i = 0; i < size; i++) {
        const row = new Array(size);
        for (let j = 0; j < size; j++) {
            const dx = matchPositions[i].x - chargePositions[j].x;
            const dy = matchPositions[i].y - chargePositions[j].y;
            row[j] = -0.5 * Math.log(dx * dx + dy * dy);
        }
        influence.push(row);
    }

    const charges = solveLinearSystem(influence, boundaryPotentials);

    const potentialAt = (x, y) => {
        let potential = 0;
        for (let j = 0; j < size; j++) {
            const dx = x - chargePositions[j].x;
            const dy = y - chargePositions[j].y;
            potential += charges[j] * -0.5 * Math.log(dx * dx + dy * dy);
        }
        return potential;
    };

    const coefficients = MULTIPOLE_ORDERS.map(() => 0);
    for (let k = 0; k < ANALYSIS_SAMPLES; k++) {
        const angle = (2 * Math.PI * k) / ANALYSIS_SAMPLES;
        const potential = potentialAt(
            ANALYSIS_RADIUS * Math.cos(angle),
            ANALYSIS_RADIUS * Math.sin(angle)
        );
        MULTIPOLE_ORDERS.forEach((order, index) => {
            coefficients[index] += potential * Math.cos(order * angle);
        });
    }
    MULTIPOLE_ORDERS.forEach((order, index) => {
        coefficients[index] *= 2 / (ANALYSIS_SAMPLES * Math.pow(ANALYSIS_RADIUS, order));
    });

    coefficientCache.set(key, coefficients);
    return coefficients;
}
