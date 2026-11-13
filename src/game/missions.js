// Static catalogue: locations, missions (contracts) and the scan codex.
// Mission checks receive (ship, X) where X is the running Explore session:
//   X.dist(id)  distance to an object      X.orb()  { altPe, altAp, alt, e } around the central body
//   X.loc       the live location          X.flags  one-shot events raised during the flight
// `auto` is the plan TARS flies for that objective: (c) => [tasks], built from the copilot's primitives.
// `hint` is what TARS tells you when you ask (Y).
export const LOCATION_INFO = [
  { id: 'launch', name: 'Cape Canaveral', tag: 'LAUNCH', rank: 0, nav: false, sub: 'LC-39A · Saturn V · pad to orbit',
    desc: 'Start where every journey starts. Light five F-1 engines, fly the gravity turn, stage twice and reach orbit.' },
  { id: 'earth', name: 'Earth Orbit', tag: 'ORBITAL MECHANICS', rank: 0, sub: '400 km · ISS · Hubble · the Endurance',
    desc: 'Real orbital mechanics around a real Earth. Rendezvous, dock, and try not to re-enter.' },
  { id: 'moon', name: 'The Moon', tag: 'LOW LUNAR ORBIT', rank: 0, sub: '100 km · Gateway station · Earthrise',
    desc: 'Airless and slow: 1.6 km/s orbits where tens of m/s reshape your path. Dock with the Gateway.' },
  { id: 'mars', name: 'Mars · Phobos', tag: 'LANDING', rank: 1, sub: '6,000 km above Mars · a 22 km moon',
    desc: 'Co-orbit a captured asteroid. Gravity here is a thousandth of a g — land on it gently.' },
  { id: 'jupiter', name: 'Jupiter', tag: 'DEEP GRAVITY WELL', rank: 2, sub: 'Juno · 39 km/s orbits · radiation belts',
    desc: 'The biggest well in the system. Visit Juno, skim the cloud tops, and mind the radiation.' },
  { id: 'saturn', name: 'Saturn', tag: 'RINGS & WORMHOLE', rank: 2, sub: 'the rings · Cassini · the wormhole',
    desc: 'Skim the A ring between ice boulders, visit Cassini, then dive into the wormhole.' },
  { id: 'gargantua', name: 'Gargantua', tag: 'RELATIVITY', rank: 3, sub: 'Kerr black hole · Miller · Mann · Edmunds',
    desc: 'Fly anywhere around a spinning supermassive black hole. Watch your clock run slow.' },
  { id: 'tesseract', name: 'The Tesseract', tag: 'THE FIFTH DIMENSION', rank: 99, nav: false, sub: 'inside Gargantua · the bulk',
    lock: 'cross Gargantua’s event horizon, or watch The Journey to its end',
    desc: 'What is inside the horizon. Gather the quantum data, find the one moment you can reach, and send it home in gravity.' },
];
export const locInfo = (id) => LOCATION_INFO.find((l) => l.id === id);

const within = (x, a, b) => x >= a && x <= b;

export const MISSIONS = {
  launch: [
    { id: 'orbit', name: 'Go for Launch', xp: 800, par: 420, award: 'orbit', brief: 'Fly a Saturn V from the pad to a 185 km orbit. Ignite, climb vertically, ease east into a gravity turn, stage twice, and cut off at orbital speed. Time warp (T) runs the whole ascent faster.',
      objectives: [
        { text: 'Ignition and liftoff (Space)', check: (s, X) => !!X.flags.liftoff, auto: (c) => [c.ascent()], hint: 'Press space. The engines take three seconds to come up to thrust' },
        { text: 'Climb through 10 km: begin the gravity turn (ease the nose east)', check: (s, X) => X.flags.h > 10e3, auto: (c) => [c.ascent()], hint: 'Go straight up for a few seconds, then push the nose a couple of degrees east and press 1 to follow prograde' },
        { text: 'Stage: drop the S-IC and light the second stage (Space)', check: (s) => s.stage >= 1, auto: (c) => [c.ascent()], hint: 'When the first stage reads zero percent, press space' },
        { text: 'Reach space: 100 km', check: (s, X) => X.flags.h > 100e3, auto: (c) => [c.ascent()], hint: 'Keep the nose a little above the horizon. You want to level off near 185 kilometres' },
        { text: 'Orbit: raise periapsis above 150 km', check: (s, X) => X.orb().altPe > 150e3, auto: (c) => [c.ascent()], hint: 'Now it is all sideways speed. Hold the nose on the horizon and burn until periapsis climbs out of the ground. Stage again when the second stage is spent' },
        { text: 'Separate the Ranger (Space)', check: (s, X) => !!X.flags.sep, auto: (c) => [c.ascent()], hint: 'Cut the engine and press space to let the Ranger go' },
      ] },
  ],
  tesseract: [
    { id: 'data', name: 'The Quantum Data', xp: 1500, par: 300, brief: 'You are inside Gargantua, in a place built from every moment of one room. Gather the five fragments of quantum data, find the moment you can reach, and key it across in gravity: ten pulses.',
      objectives: [
        { text: 'Collect the five quantum data fragments (fly through them)', check: (s, X) => (X.flags.collected || 0) >= 5, auto: (c) => [c.fragments()], hint: 'Tab cycles the fragments. Press 3 to face one, W to push toward it, X to stop' },
        { text: 'Find the moment: reach the lit window', check: (s, X) => !!X.flags.atWindow, auto: (c) => [c.moment()], hint: 'The window is the warm rectangle at the far end of the lattice. Tab until it is selected' },
        { text: 'Transmit: key ten gravity pulses (Space, in time with the bar)', check: (s, X) => (X.flags.sent || 0) >= 10, auto: (c) => [c.transmit()], hint: 'Hold X to stop drifting. Press space each time the bar is nearly full and turns green' },
      ] },
  ],
  earth: [
    { id: 'tour', name: 'Station Tour', xp: 300, par: 420, brief: 'A shakedown flight past the two most famous spacecraft in low Earth orbit, ending with a hard dock.',
      objectives: [
        { text: 'Fly within 200 m of the International Space Station', check: (s, X) => X.dist('iss') < 200, auto: (c) => [c.goto('iss', 150)], hint: 'Tab to the I S S, press 3 to point at it and burn. Press X to stop when you arrive' },
        { text: 'Inspect the Hubble Space Telescope (within 120 m)', check: (s, X) => X.dist('hubble') < 120, auto: (c) => [c.goto('hubble', 80)] },
        { text: 'Dock with the Endurance (< 0.5 m/s, within 12°)', check: (s) => !!s.docked, auto: (c) => [c.dock('endurance')], hint: 'Line up in front of the hub port, hold X to kill your drift, then creep in under half a metre per second' },
      ] },
    { id: 'dock', name: 'Precision Docking', xp: 250, par: 150, brief: 'Straight to the Endurance hub port. Speed is scored: three stars need a clean, quick capture.',
      objectives: [{ text: 'Dock with the Endurance', check: (s) => !!s.docked, auto: (c) => [c.dock('endurance')], hint: 'The Endurance is 380 metres ahead. Approach slowly, hold X to match velocity, and bring your docking collar onto the hub port' }] },
    { id: 'raise', name: 'Orbit Raise', xp: 350, par: 360, brief: 'A two-burn Hohmann transfer. Burn prograde, coast half an orbit (use time warp), then circularise.',
      objectives: [
        { text: 'Raise apoapsis above 800 km', check: (s, X) => X.orb().altAp > 800e3, auto: (c) => [c.burn('now', 830e3)], hint: 'Press 1 to hold prograde, then burn until apoapsis reads 800 kilometres' },
        { text: 'Circularise: periapsis and apoapsis both between 750 and 900 km', check: (s, X) => { const o = X.orb(); return within(o.altPe, 750e3, 900e3) && within(o.altAp, 750e3, 900e3); }, auto: (c) => [c.burn('ap', 800e3)], hint: 'Time warp to apoapsis, then burn prograde again until periapsis rises above 750 kilometres' },
      ] },
    { id: 'survey', name: 'Orbital Survey', xp: 300, par: 480, brief: 'Mission Control wants fresh telemetry on everything up here. Get in range and scan (B).',
      objectives: [
        { text: 'Scan the Endurance', check: (s, X) => X.scanned('endurance'), auto: (c) => [c.scan('endurance')] },
        { text: 'Scan the ISS', check: (s, X) => X.scanned('iss'), auto: (c) => [c.scan('iss')] },
        { text: 'Scan Hubble', check: (s, X) => X.scanned('hubble'), auto: (c) => [c.scan('hubble')] },
      ] },
  ],
  moon: [
    { id: 'gateway', name: 'Gateway Rendezvous', xp: 320, par: 240, brief: 'The Gateway is 1.5 km ahead. Close the distance, null your relative velocity (X) and dock nose-first.',
      objectives: [
        { text: 'Approach the Gateway (within 150 m)', check: (s, X) => X.dist('gateway') < 150, auto: (c) => [c.goto('gateway', 110)] },
        { text: 'Dock with the Gateway', check: (s) => !!s.docked, auto: (c) => [c.dock('gateway')] },
      ] },
    { id: 'lowpass', name: 'Low Pass', xp: 380, par: 420, brief: 'Drop your periapsis and skim the lunar surface, then climb back out. There is no air to slow you — only your engines.',
      objectives: [
        { text: 'Descend below 15 km altitude', check: (s, X) => X.orb().alt < 15e3, auto: (c) => [c.burn('now', 12e3), c.coast('pe')], hint: 'Press 2 for retrograde and burn until periapsis reads 12 kilometres, then warp down to it' },
        { text: 'Climb back above 80 km with a safe periapsis (> 20 km)', check: (s, X) => { const o = X.orb(); return o.alt > 80e3 && o.altPe > 20e3; }, auto: (c) => [c.burn('ap', 60e3), c.coast('ap')], hint: 'Coast up to apoapsis and burn prograde there: that lifts the low point of the orbit' },
      ] },
    { id: 'high', name: 'High Lunar Orbit', xp: 340, par: 480, brief: 'Raise and circularise at 300 km. About 40 m/s per burn — precision matters more than power.',
      objectives: [
        { text: 'Raise apoapsis above 280 km', check: (s, X) => X.orb().altAp > 280e3, auto: (c) => [c.burn('now', 300e3)] },
        { text: 'Circularise between 260 and 340 km', check: (s, X) => { const o = X.orb(); return within(o.altPe, 260e3, 340e3) && within(o.altAp, 260e3, 340e3); }, auto: (c) => [c.burn('ap', 295e3)] },
      ] },
  ],
  mars: [
    { id: 'land', name: 'Phobos Landing', xp: 450, par: 420, brief: 'Phobos pulls at 0.006 m/s². Approach slowly and touch down under 4 m/s — anything faster bounces or breaks.',
      objectives: [
        { text: 'Descend to within 2 km of the surface', check: (s, X) => X.surfaceAlt('phobos') < 2000, auto: (c) => [c.land('phobos')], hint: 'Point at Phobos, burn toward it, and start braking early. It is thirty kilometres away' },
        { text: 'Land on Phobos (touchdown < 4 m/s)', check: (s) => !!s.landed, auto: (c) => [c.land('phobos')], hint: 'Hold X to stop over the surface, then sink at one or two metres per second' },
      ] },
    { id: 'hop', name: 'Surface Hop', xp: 400, par: 600, brief: 'Land, lift off, and set down again at least 3 km away. Suborbital hops on a world you could jump off.',
      objectives: [
        { text: 'Land on Phobos', check: (s, X) => { if (s.landed) X.flags.hop0 = s.landed.local.clone(); return !!s.landed; }, auto: (c) => [c.land('phobos')] },
        { text: 'Lift off and climb above 500 m', check: (s, X) => !s.landed && X.surfaceAlt('phobos') > 500, auto: (c) => [c.liftoff('phobos', 700)] },
        { text: 'Land again at least 3 km from the first site', check: (s, X) => !!s.landed && X.flags.hop0 && s.landed.local.distanceTo(X.flags.hop0) > 3000, auto: (c) => [c.hop('phobos', 4300), c.land('phobos')] },
      ] },
    { id: 'recon', name: 'Moon Recon', xp: 280, par: 300, brief: 'Scan Phobos, then fly a full inspection: pass over its far side.',
      objectives: [
        { text: 'Scan Phobos', check: (s, X) => X.scanned('phobos'), auto: (c) => [c.scan('phobos')] },
        { text: 'Fly to the far side (Phobos between you and your start)', check: (s, X) => X.flags.farSide, auto: (c) => [c.around('phobos', 1, 26000), c.around('phobos', -1, 24000)] },
      ] },
  ],
  jupiter: [
    { id: 'juno', name: 'Juno Flyby', xp: 320, par: 240, brief: 'NASA’s solar-powered orbiter is 3 km ahead. Fly a close inspection and scan it.',
      objectives: [
        { text: 'Fly within 80 m of Juno', check: (s, X) => X.dist('juno') < 80, auto: (c) => [c.goto('juno', 55)] },
        { text: 'Scan Juno', check: (s, X) => X.scanned('juno'), auto: (c) => [c.scan('juno')] },
      ] },
    { id: 'skim', name: 'Cloud Skimmer', xp: 500, par: 480, brief: 'Dive to the cloud tops and come back. Radiation and heating both get worse the deeper you go.',
      objectives: [
        { text: 'Descend below 3,000 km above the cloud tops', check: (s, X) => X.orb().alt < 3000e3, auto: (c) => [c.burn('now', 2700e3), c.coast('pe')], hint: 'Burn retrograde until periapsis is under 3,000 kilometres and coast down. Do not linger: radiation eats the hull' },
        { text: 'Climb back above 12,000 km', check: (s, X) => X.orb().alt > 12000e3, auto: (c) => [c.coast('ap')] },
      ] },
    { id: 'climb', name: 'Out of the Well', xp: 450, par: 300, brief: 'Raise your apoapsis above 50,000 km. That costs nearly 4 km/s here — check your Δv before you commit.',
      objectives: [{ text: 'Raise apoapsis above 50,000 km', check: (s, X) => X.orb().altAp > 50000e3, auto: (c) => [c.burn('now', 51500e3)], hint: 'Hold prograde and burn with boost. It takes about three and a half kilometres per second' }] },
  ],
  saturn: [
    { id: 'rings', name: 'Ring Runner', xp: 400, par: 600, brief: 'Thread the A ring’s ice boulders, visit Cassini, then make for the wormhole.',
      objectives: [
        { text: 'Descend into the A ring (within 60 m of the ring plane)', check: (s) => Math.abs(s.pos.y) < 60, auto: (c) => [c.ringAlt(52, 5)], hint: 'Press F to sink toward the ring plane. Watch for boulders' },
        { text: 'Fly within 60 m of Cassini', check: (s, X) => X.dist('cassini') < 60, auto: (c) => [c.ringAlt(175, 20), c.goto('cassini', 42)] },
        { text: 'Enter the wormhole', check: (s, X) => X.dist('wormhole') < 1000 || X.flags.portal, auto: (c) => [c.ringAlt(260, 60), c.portal('wormhole')], hint: 'Tab to the wormhole, press 3 and burn. Fly straight into the sphere' },
      ] },
    { id: 'cassini', name: 'Grand Finale', xp: 300, par: 300, brief: 'Find Cassini among the ring particles and scan it before it is lost.',
      objectives: [
        { text: 'Scan Cassini', check: (s, X) => X.scanned('cassini'), auto: (c) => [c.ringAlt(175, 20), c.scan('cassini')] },
        { text: 'Climb 1 km above the ring plane', check: (s) => Math.abs(s.pos.y) > 1000, auto: (c) => [c.ringAlt(1150, 100)] },
      ] },
  ],
  gargantua: [
    { id: 'dive', name: 'Gentle Giant', xp: 600, par: 600, brief: 'Fall toward the hole, pass inside the innermost stable orbit, and climb back out. Every second down there costs hours at home.',
      objectives: [
        { text: 'Fall to within 10 r_s of Gargantua', check: (s) => s.pos.length() < 10, auto: (c) => [c.bh(8, { done: (r) => r < 9.5 })], hint: 'Point at Gargantua and burn, then coast under time warp. Keep some sideways speed: you will need it to orbit' },
        { text: 'Survive a pass below 3 r_s (inside the ISCO)', check: (s, X) => X.loc.clock.minR < 3 && s.pos.length() > 4, auto: (c) => [c.bh(2.9, { done: (r) => r < 2.96 }), c.bh(4.8, { done: (r) => r > 4.3 })], hint: 'Go in fast and sideways, never straight down. Below three radii you need boost pointed outward to climb again' },
      ] },
    { id: 'miller', name: 'Seven Years an Hour', xp: 500, par: 600, brief: 'Reach Miller’s planet, deep in the gravity well, and scan it.',
      objectives: [
        { text: 'Reach Miller’s planet', check: (s, X) => X.dist('miller') < 0.03, auto: (c) => [c.goto('miller', 0.012, { tol: 0.012 })], hint: 'Miller sits seven radii out. Gravity there is as strong as your engines, so arrive slowly and use boost to hover' },
        { text: 'Scan Miller', check: (s, X) => X.scanned('miller'), auto: (c) => [c.scan('miller')] },
      ] },
    { id: 'sling', name: 'Slingshot', xp: 650, par: 600, brief: 'Use Gargantua the way the Endurance did: dive to within four radii, whip round, and climb back out to thirty.',
      objectives: [
        { text: 'Pass within 4 r_s of Gargantua', check: (s, X) => X.loc.clock.minR < 4, auto: (c) => [c.bh(3.7, { done: (r) => r < 3.95 })] },
        { text: 'Climb back out beyond 30 r_s', check: (s) => s.pos.length() > 30, auto: (c) => [c.bh(34, { rdot: 0.4, done: (r) => r > 30.5 })] },
      ] },
    { id: 'edmunds', name: 'Plan B', xp: 700, par: 900, brief: 'Three worlds were surveyed. Only one can hold a colony. Cross the system to Edmunds’ planet and confirm it.',
      objectives: [
        { text: 'Reach Edmunds’ planet', check: (s, X) => X.dist('edmunds') < 0.05, auto: (c) => [c.goto('edmunds', 0.02, { tol: 0.02 })], hint: 'Tab to Edmunds, press 3, burn, then time warp the coast. Start braking early: press 6 and burn' },
        { text: 'Scan Edmunds', check: (s, X) => X.scanned('edmunds'), auto: (c) => [c.scan('edmunds')] },
      ] },
    { id: 'horizon', name: 'The Horizon', xp: 400, par: 600, brief: 'A one-way trip. Cross the event horizon — and find out what someone built inside.',
      objectives: [{ text: 'Cross the event horizon', check: (s, X) => X.loc.clock.horizon, auto: (c) => [c.plunge()], hint: 'Point at the black disc and burn. There is no coming back the way you came' }] },
  ],
};
export const missionKey = (loc, id) => `${loc}.${id}`;
export const ALL_MISSION_KEYS = Object.entries(MISSIONS).flatMap(([l, ms]) => ms.map((m) => missionKey(l, m.id)));

// Scan results: real data (NASA fact sheets / mission pages); film objects after K. Thorne.
export const CODEX = {
  endurance: ['ENDURANCE', 'Ring ship · 64 m diameter · 12 modules · spins at 5.3 rpm for 1 g at the rim'],
  iss: ['INTERNATIONAL SPACE STATION', '109 m truss · ~420 t · 7.66 km/s · continuously crewed since November 2000'],
  hubble: ['HUBBLE SPACE TELESCOPE', '2.4 m mirror · 13.2 m long · launched 1990 · serviced five times by Shuttle crews'],
  gateway: ['LUNAR GATEWAY', 'Small modular outpost for lunar operations · solar-electric propulsion · docking hub'],
  phobos: ['PHOBOS', '27 × 22 × 18 km · orbits Mars every 7 h 39 min · surface gravity 0.0057 m/s² · spiralling inward 1.8 cm/yr'],
  juno: ['JUNO', 'Solar-powered Jupiter orbiter · three 9 m arrays · arrived July 2016 · spins at 2 rpm'],
  cassini: ['CASSINI', 'Saturn orbiter 2004–2017 · 6.8 m tall · plutonium RTG power · ended in Saturn’s atmosphere'],
  wormhole: ['WORMHOLE', 'Spherical mouth ~2 km across · a three-dimensional hole in space, lensing another galaxy'],
  gargantua: ['GARGANTUA', '10⁸ solar masses · horizon radius ≈ 1 AU · spin within one part in 10¹⁴ of maximal'],
  miller: ['MILLER’S PLANET', 'Water world just outside the horizon · 1 hour = 7 years · 1.3 g · kilometre-high tidal waves'],
  mann: ['MANN’S PLANET', 'Frozen clouds over ammonia ice · 0.8 g · no surface — or none that helps'],
  edmunds: ['EDMUNDS’ PLANET', 'Arid, rocky, temperate · the only world of the three that can hold a colony'],
};
