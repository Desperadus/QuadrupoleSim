// Guided tour: a stepped lesson that drives the controls while it explains.

export const TOUR_STEPS = [
    {
        title: "Four rods and a saddle",
        body: `<p>A quadrupole is four parallel rods around an axis. One opposing pair is driven to <strong>+&Phi;&#8320;</strong>, the other to <strong>&minus;&Phi;&#8320;</strong>. That makes a saddle-shaped potential: whatever focuses ions in x defocuses them in y at the same instant.</p>
               <p>The RF field is switched on for you. Watch the rods change colour as the drive swings, and watch the arrows flip direction every half cycle. A static saddle could never trap anything &mdash; the trick is that it reverses faster than an ion can fall out of it.</p>`,
        apply: (api) => {
            api.setMode("rf-only");
            api.setConfig({ showField: true, playbackCyclesPerSecond: 4, lowMassCutoffMz: 100 });
            api.setSample("broad");
            api.setTab("tab-stability");
        }
    },
    {
        title: "RF-only: a guide, not a filter",
        body: `<p>With no DC at all, the operating line lies flat along the q axis. Every ion is stable right up to the cutoff where the stability triangle closes, so the device transmits everything above a certain m/z and throws away everything below.</p>
               <p>This is an <strong>ion guide</strong>, and it is what collision cells and pre-filters actually are. Drag the low-mass cutoff in Setup and watch the light ions disappear from the beam.</p>`,
        apply: (api) => {
            api.setMode("rf-only");
            api.setConfig({ showField: false, playbackCyclesPerSecond: 40, lowMassCutoffMz: 300 });
            api.setSample("broad");
            api.setTab("tab-stability");
        }
    },
    {
        title: "a and q: the only things that matter",
        body: `<p>Rewriting the equations of motion turns them into the Mathieu equation with two dimensionless numbers:</p>
               <ul>
                 <li><strong>q</strong> &mdash; how hard the RF drives the ion</li>
                 <li><strong>a</strong> &mdash; how much steady DC is layered on top</li>
               </ul>
               <p>Both scale as 1/(m/z), so at fixed voltages every ion in the sample sits at its own point along one ray through the origin, ordered by mass. The coloured dots in the diagram are the ions in your sample.</p>`,
        apply: (api) => {
            api.setMode("rf-only");
            api.setConfig({ lowMassCutoffMz: 100 });
            api.setSample("triplet");
            api.setTab("tab-stability");
        }
    },
    {
        title: "Adding DC closes the window",
        body: `<p>Now switch on the DC. The operating line tilts upwards and only a short segment of it stays inside the triangle &mdash; a narrow band of m/z.</p>
               <p>The DC/RF slider is set to 90% of the apex ratio. Push it towards 100% and the transmitted band shrinks towards a single mass. Push it to 100% exactly and nothing gets through at all.</p>`,
        apply: (api) => {
            api.setMode("mass-selective");
            api.setConfig({ dcRfPercent: 90, targetMz: 400, playbackCyclesPerSecond: 40 });
            api.setSample("triplet");
            api.setTab("tab-stability");
        }
    },
    {
        title: "Resolution costs you transmission",
        body: `<p>Set to 99.4% of the apex ratio, the filter is now sharp &mdash; and the beam has thinned dramatically. Most ions of the right mass still strike a rod, because the accepted region of phase space shrank along with the mass window.</p>
               <p>This trade-off is not a limitation of the simulation; it is the defining compromise of every quadrupole ever built. Widen the beam radius or the transverse energy in Setup to make it worse.</p>`,
        apply: (api) => {
            api.setMode("mass-selective");
            api.setConfig({ dcRfPercent: 99.4, targetMz: 400 });
            api.setSample("triplet");
            api.setTab("tab-plots");
        }
    },
    {
        title: "Scanning the mass range",
        body: `<p>Ramp U and V together and the whole mass scale sweeps past the fixed operating line. Recording what arrives at the detector gives a mass spectrum.</p>
               <p>A scan is running now. Every point on that trace is a real packet of ions flown through the rods at that setpoint &mdash; the peak shape and width are measured, not drawn.</p>`,
        apply: (api) => {
            api.setMode("mass-selective");
            api.setConfig({ dcRfPercent: 98 });
            api.setSample("triplet");
            api.setTab("tab-spectrum");
            api.runScan({ mzMin: 250, mzMax: 550 });
        }
    },
    {
        title: "Can you separate m/z 500 from 501?",
        body: `<p>The sample is now a pair of ions one mass unit apart, and the scan is running at the same DC/RF ratio as before. They come out as one blob.</p>
               <p>Raise the DC/RF ratio and re-acquire until the two peaks separate. Watch the measured resolution in the peak table climb &mdash; and watch the peak heights fall as you do it.</p>`,
        apply: (api) => {
            api.setMode("mass-selective");
            api.setConfig({ dcRfPercent: 98 });
            api.setSample("doublet");
            api.setTab("tab-spectrum");
            api.runScan({ mzMin: 495, mzMax: 506 });
        }
    },
    {
        title: "Real rods are round",
        body: `<p>Hyperbolic rods are expensive, so most instruments use round ones. A round-rod set cannot make a pure quadrupole field &mdash; it adds a 12-pole term A&#8326;, a 20-pole term A<sub>10</sub>, and so on.</p>
               <p>The geometry has switched to round rods. Sweep the r/r&#8320; slider in Setup and watch A&#8326; pass through zero: that null is exactly why a particular rod radius gets chosen. These harmonics are solved from the real rod boundary, so the ion trajectories change with them.</p>`,
        apply: (api) => {
            api.setMode("mass-selective");
            api.setConfig({ geometry: "round", dcRfPercent: 98, targetMz: 500 });
            api.setSample("triplet");
            api.setTab("tab-setup");
        }
    },
    {
        title: "Fringing fields at the entrance",
        body: `<p>The field cannot appear instantly at the rod ends. In the fringe region an ion feels a rising transverse field plus an axial component, and if it arrives at an unlucky RF phase it gets kicked out even though its (a, q) is comfortably inside the triangle.</p>
               <p>Toggle the fringe model in Setup and compare the transmitted count. Turning it off gives a hard-edged field, which is worse, not better &mdash; that is why real analysers sit behind an RF-only pre-filter.</p>`,
        apply: (api) => {
            api.setMode("mass-selective");
            api.setConfig({ dcRfPercent: 98, geometry: "hyperbolic", fringeEnabled: true });
            api.setTab("tab-setup");
        }
    },
    {
        title: "Over to you",
        body: `<p>Everything is unlocked. A few things worth trying:</p>
               <ul>
                 <li>Drop the axial ion energy and watch resolution improve &mdash; slower ions see more RF cycles.</li>
                 <li>Shorten the rods and watch it get worse for the same reason.</li>
                 <li>Click anywhere inside the stability diagram to jump the operating point there.</li>
                 <li>Build your own mixture in Setup and scan it.</li>
               </ul>`,
        apply: (api) => {
            api.setTab("tab-setup");
        }
    }
];

export function createTourController(api) {
    const overlay = document.getElementById("tour-overlay");
    const titleNode = document.getElementById("tour-title");
    const bodyNode = document.getElementById("tour-body");
    const countNode = document.getElementById("tour-step-count");
    const dotsNode = document.getElementById("tour-dots");
    const previousButton = document.getElementById("btn-tour-prev");
    const nextButton = document.getElementById("btn-tour-next");

    let currentStep = 0;

    function render() {
        const step = TOUR_STEPS[currentStep];
        countNode.innerText = `Step ${currentStep + 1} of ${TOUR_STEPS.length}`;
        titleNode.innerText = step.title;
        bodyNode.innerHTML = step.body;
        previousButton.disabled = currentStep === 0;
        nextButton.innerText = currentStep === TOUR_STEPS.length - 1 ? "Finish" : "Next";

        dotsNode.innerHTML = "";
        TOUR_STEPS.forEach((_, index) => {
            const dot = document.createElement("span");
            dot.className = index === currentStep ? "tour-dot active" : "tour-dot";
            dotsNode.appendChild(dot);
        });

        step.apply(api);
    }

    function open() {
        overlay.hidden = false;
        currentStep = 0;
        render();
    }

    function close() {
        overlay.hidden = true;
    }

    previousButton.addEventListener("click", () => {
        if (currentStep === 0) return;
        currentStep--;
        render();
    });
    nextButton.addEventListener("click", () => {
        if (currentStep === TOUR_STEPS.length - 1) {
            close();
            return;
        }
        currentStep++;
        render();
    });
    document.getElementById("btn-tour-close").addEventListener("click", close);

    return { open, close };
}
