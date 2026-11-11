// Static catalogue: locations, missions (contracts) and the scan codex.
// Mission checks receive (ship, X) where X is the running Explore session:
//   X.dist(id)  distance to an object      X.orb()  { altPe, altAp, alt, e } around the central body
//   X.loc       the live location          X.flags  one-shot events raised during the flight
export const LOCATION_INFO = [
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
];
export const locInfo = (id) => LOCATION_INFO.find((l) => l.id === id);

const within = (x, a, b) => x >= a && x <= b;

export const MISSIONS = {
  earth: [
    { id: 'tour', name: 'Station Tour', xp: 300, par: 420, brief: 'A shakedown flight past the two most famous spacecraft in low Earth orbit, ending with a hard dock.',
      objectives: [
        { text: 'Fly within 200 m of the International Space Station', check: (s, X) => X.dist('iss') < 200 },
        { text: 'Inspect the Hubble Space Telescope (within 120 m)', check: (s, X) => X.dist('hubble') < 120 },
        { text: 'Dock with the Endurance (< 0.5 m/s, within 12°)', check: (s) => !!s.docked },
      ] },
    { id: 'dock', name: 'Precision Docking', xp: 250, par: 150, brief: 'Straight to the Endurance hub port. Speed is scored: three stars need a clean, quick capture.',
      objectives: [{ text: 'Dock with the Endurance', check: (s) => !!s.docked }] },
    { id: 'raise', name: 'Orbit Raise', xp: 350, par: 360, brief: 'A two-burn Hohmann transfer. Burn prograde, coast half an orbit (use time warp), then circularise.',
      objectives: [
        { text: 'Raise apoapsis above 800 km', check: (s, X) => X.orb().altAp > 800e3 },
        { text: 'Circularise: periapsis and apoapsis both between 750 and 900 km', check: (s, X) => { const o = X.orb(); return within(o.altPe, 750e3, 900e3) && within(o.altAp, 750e3, 900e3); } },
      ] },
    { id: 'survey', name: 'Orbital Survey', xp: 300, par: 480, brief: 'Mission Control wants fresh telemetry on everything up here. Get in range and scan (B).',
      objectives: [
        { text: 'Scan the Endurance', check: (s, X) => X.scanned('endurance') },
        { text: 'Scan the ISS', check: (s, X) => X.scanned('iss') },
        { text: 'Scan Hubble', check: (s, X) => X.scanned('hubble') },
      ] },
  ],
  moon: [
    { id: 'gateway', name: 'Gateway Rendezvous', xp: 320, par: 240, brief: 'The Gateway is 1.5 km ahead. Close the distance, null your relative velocity (X) and dock nose-first.',
      objectives: [
        { text: 'Approach the Gateway (within 150 m)', check: (s, X) => X.dist('gateway') < 150 },
        { text: 'Dock with the Gateway', check: (s) => !!s.docked },
      ] },
    { id: 'lowpass', name: 'Low Pass', xp: 380, par: 420, brief: 'Drop your periapsis and skim the lunar surface, then climb back out. There is no air to slow you — only your engines.',
      objectives: [
        { text: 'Descend below 15 km altitude', check: (s, X) => X.orb().alt < 15e3 },
        { text: 'Climb back above 80 km with a safe periapsis (> 20 km)', check: (s, X) => { const o = X.orb(); return o.alt > 80e3 && o.altPe > 20e3; } },
      ] },
    { id: 'high', name: 'High Lunar Orbit', xp: 340, par: 480, brief: 'Raise and circularise at 300 km. About 40 m/s per burn — precision matters more than power.',
      objectives: [
        { text: 'Raise apoapsis above 280 km', check: (s, X) => X.orb().altAp > 280e3 },
        { text: 'Circularise between 260 and 340 km', check: (s, X) => { const o = X.orb(); return within(o.altPe, 260e3, 340e3) && within(o.altAp, 260e3, 340e3); } },
      ] },
  ],
  mars: [
    { id: 'land', name: 'Phobos Landing', xp: 450, par: 420, brief: 'Phobos pulls at 0.006 m/s². Approach slowly and touch down under 4 m/s — anything faster bounces or breaks.',
      objectives: [
        { text: 'Descend to within 2 km of the surface', check: (s, X) => X.surfaceAlt('phobos') < 2000 },
        { text: 'Land on Phobos (touchdown < 4 m/s)', check: (s) => !!s.landed },
      ] },
    { id: 'hop', name: 'Surface Hop', xp: 400, par: 600, brief: 'Land, lift off, and set down again at least 3 km away. Suborbital hops on a world you could jump off.',
      objectives: [
        { text: 'Land on Phobos', check: (s, X) => { if (s.landed) X.flags.hop0 = s.landed.local.clone(); return !!s.landed; } },
        { text: 'Lift off and climb above 500 m', check: (s, X) => !s.landed && X.surfaceAlt('phobos') > 500 },
        { text: 'Land again at least 3 km from the first site', check: (s, X) => !!s.landed && X.flags.hop0 && s.landed.local.distanceTo(X.flags.hop0) > 3000 },
      ] },
    { id: 'recon', name: 'Moon Recon', xp: 280, par: 300, brief: 'Scan Phobos, then fly a full inspection: pass over its far side.',
      objectives: [
        { text: 'Scan Phobos', check: (s, X) => X.scanned('phobos') },
        { text: 'Fly to the far side (Phobos between you and your start)', check: (s, X) => X.flags.farSide },
      ] },
  ],
  jupiter: [
    { id: 'juno', name: 'Juno Flyby', xp: 320, par: 240, brief: 'NASA’s solar-powered orbiter is 3 km ahead. Fly a close inspection and scan it.',
      objectives: [
        { text: 'Fly within 80 m of Juno', check: (s, X) => X.dist('juno') < 80 },
        { text: 'Scan Juno', check: (s, X) => X.scanned('juno') },
      ] },
    { id: 'skim', name: 'Cloud Skimmer', xp: 500, par: 480, brief: 'Dive to the cloud tops and come back. Radiation and heating both get worse the deeper you go.',
      objectives: [
        { text: 'Descend below 3,000 km above the cloud tops', check: (s, X) => X.orb().alt < 3000e3 },
        { text: 'Climb back above 12,000 km', check: (s, X) => X.orb().alt > 12000e3 },
      ] },
    { id: 'climb', name: 'Out of the Well', xp: 450, par: 300, brief: 'Raise your apoapsis above 50,000 km. That costs nearly 4 km/s here — check your Δv before you commit.',
      objectives: [{ text: 'Raise apoapsis above 50,000 km', check: (s, X) => X.orb().altAp > 50000e3 }] },
  ],
  saturn: [
    { id: 'rings', name: 'Ring Runner', xp: 400, par: 600, brief: 'Thread the A ring’s ice boulders, visit Cassini, then make for the wormhole.',
      objectives: [
        { text: 'Descend into the A ring (within 60 m of the ring plane)', check: (s) => Math.abs(s.pos.y) < 60 },
        { text: 'Fly within 60 m of Cassini', check: (s, X) => X.dist('cassini') < 60 },
        { text: 'Enter the wormhole', check: (s, X) => X.dist('wormhole') < 1000 || X.flags.portal },
      ] },
    { id: 'cassini', name: 'Grand Finale', xp: 300, par: 300, brief: 'Find Cassini among the ring particles and scan it before it is lost.',
      objectives: [
        { text: 'Scan Cassini', check: (s, X) => X.scanned('cassini') },
        { text: 'Climb 1 km above the ring plane', check: (s) => Math.abs(s.pos.y) > 1000 },
      ] },
  ],
  gargantua: [
    { id: 'dive', name: 'Gentle Giant', xp: 600, par: 600, brief: 'Fall toward the hole, pass inside the innermost stable orbit, and climb back out. Every second down there costs hours at home.',
      objectives: [
        { text: 'Fall to within 10 r_s of Gargantua', check: (s) => s.pos.length() < 10 },
        { text: 'Survive a pass below 3 r_s (inside the ISCO)', check: (s, X) => X.loc.clock.minR < 3 && s.pos.length() > 4 },
      ] },
    { id: 'miller', name: 'Seven Years an Hour', xp: 500, par: 600, brief: 'Reach Miller’s planet, deep in the gravity well, and scan it.',
      objectives: [
        { text: 'Reach Miller’s planet', check: (s, X) => X.dist('miller') < 0.004 },
        { text: 'Scan Miller', check: (s, X) => X.scanned('miller') },
      ] },
    { id: 'horizon', name: 'The Horizon', xp: 400, par: 600, brief: 'A one-way trip. Cross the event horizon.',
      objectives: [{ text: 'Cross the event horizon', check: (s, X) => X.loc.clock.horizon }] },
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
