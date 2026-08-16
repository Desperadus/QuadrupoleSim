// Physical constants (SI) and simulation-wide defaults.

export const ELEMENTARY_CHARGE = 1.602176634e-19;   // C
export const ATOMIC_MASS_UNIT = 1.66053906660e-27;  // kg
export const METRES_PER_MM = 1e-3;

// The quadrupole is driven with +Phi0 on the x rod pair and -Phi0 on the y pair,
// where Phi0 = U - V*cos(Omega*t). With that convention the Mathieu parameters
// are a = 8*Q*U/(m*Omega^2*r0^2) and q = 4*Q*V/(m*Omega^2*r0^2).
export const MATHIEU_A_FACTOR = 8;
export const MATHIEU_Q_FACTOR = 4;

// Transverse motion is integrated on a fixed fraction of the RF period so the
// integration error stays constant no matter which RF frequency the user picks.
export const STEPS_PER_RF_CYCLE = 64;

// A flight is abandoned rather than integrated forever if an ion is somehow
// still inside the rods after this many RF cycles.
export const MAX_RF_CYCLES_PER_FLIGHT = 20000;

// Only multipoles of order n = 2 (mod 4) survive the four-fold rod symmetry.
export const MULTIPOLE_ORDERS = [2, 6, 10, 14];

// Round rods are commonly specified through the ratio of rod radius to the
// inscribed field radius r0.
export const DEFAULT_ROD_RADIUS_RATIO = 1.1268;

export const ION_PALETTE = [
    "#1769aa", "#9a6700", "#a23b72", "#287a45",
    "#b45309", "#655281", "#0f766e", "#b42318"
];

export const PLOT_BACKGROUND = "#ffffff";
export const PLOT_AXIS = "#52606d";
export const PLOT_GRID = "rgba(100, 116, 139, 0.16)";
export const PLOT_TEXT_DIM = "#6b7785";
export const COLOR_X_PAIR = "#b42318";
export const COLOR_Y_PAIR = "#1769aa";
export const COLOR_STABLE_BOTH = "rgba(40, 122, 69, 0.28)";
export const COLOR_STABLE_X = "rgba(180, 35, 24, 0.14)";
export const COLOR_STABLE_Y = "rgba(23, 105, 170, 0.14)";
