# Interstellar Endurance

A private, 14 min 56 s real-time journey from Earth to Gargantua, synced to `public/audio/interstellar-music.mp3`.
Three.js + custom GLSL. Every scene is a pure function of the music's time, so seeking is exact.

## Run
```
npm install
npm run dev        # http://127.0.0.1:5173
```
Use Chrome, fullscreen (F), headphones. The main menu offers **Launch from Earth**, **Flight Operations** (the game), **Hangar**, **Pilot Record**, **The Journey** (the 15-minute film), **Settings** and **Controls**. Esc opens the menu at any time.
`?t=455` jumps straight into the journey at a given second.

## TARS, the copilot
The game is hard to fly by hand on purpose, so there is a copilot that can fly all of it.

- **Enter** hands the ship to TARS. In a contract it flies the current objective, then the next, to the end: rendezvous, docking, landing, two-burn orbit changes (it time-warps the coasts), the launch, the black-hole dives. In free roam it docks with, lands on, enters or approaches whatever is targeted. Enter again, or any flight key, takes the ship back.
- **TARS talks** (speech synthesis, with subtitles): alignment and range callouts while you or it are flying (“ten degrees… five… three… aligned”, “thrust sixty percent”, “five metres”), altitude and pitch during the ascent, warnings, time dilation near Gargantua. **Y** asks it what to do next, **I** gets a status report.
- **O** turns on voice commands (Chrome's speech recognition; it asks for the microphone). Say *autopilot*, *dock*, *land*, *approach*, *brake*, *prograde*, *retrograde*, *full throttle*, *throttle fifty*, *cut engines*, *target Hubble*, *scan*, *status*, *launch*, *stage*, *I have control*.
- *Settings → Gameplay → Pilot aids* (on by default) widens the docking and landing limits, halves damage and adds half again to the par times.

## Launch from Earth
A Saturn V on LC-39A, playable. **Space** starts the engines; the stack is held down until thrust exceeds weight. Each stage has its own thrust, specific impulse and propellant mass (the numbers the film's ascent uses), drag follows an exponential atmosphere, and flying sideways through max-Q breaks the vehicle. **Space** drops a spent stage and lights the next; once periapsis clears 150 km, **Space** releases the Ranger and the flight continues as a rendezvous with the Endurance. **T** runs the whole ascent at ×2, ×4 or ×8. TARS flies a closed-loop gravity turn to a 185 km orbit if you press Enter.

## The tesseract
Crossing Gargantua's event horizon no longer ends the flight, and neither does the end of the film: at 14:56 you fall into the tesseract and play on. Inside, in a suit, with no gravity and no up: collect five fragments of quantum data, find the one lit window, and key ten gravity pulses across in time with the bar (**Space**). Then the tesseract closes and lets you go near Saturn.

## Flight Operations (the game)
Pick a world, a contract and a spacecraft, then fly it with six-degree-of-freedom Newtonian physics. Click to capture the mouse, which works as a virtual stick for pitch and yaw. Progress (XP, rank, stars, achievements, codex) is saved in this browser.

**Worlds**
| World | What is there |
|---|---|
| Cape Canaveral | The launch (above). |
| Earth orbit | 400 km orbit (μ⊕ = 3.986 × 10¹⁴ m³/s²) with the Endurance, ISS and Hubble, each on its own Keplerian orbit. Atmosphere below 125 km heats and drags you. |
| The Moon | 100 km low lunar orbit, a dockable Gateway station, Earth in the sky. |
| Mars · Phobos | Co-orbiting Phobos at 9,376 km. Phobos has its own gravity (μ = 7.09 × 10⁵ m³/s²) and you can land on it under 4 m/s. |
| Jupiter | 14,000 km above the cloud tops with Juno. Radiation flux rises steeply as you descend and damages the hull. |
| Saturn | Inside the A ring among ice boulders, with Cassini and the wormhole. |
| Gargantua | Distances in Schwarzschild radii, Paczyński–Wiita gravity, a speed of light, ship and Earth clocks at dτ/dt = √(1 − r_s/r)·√(1 − v²/c²). Reached through the wormhole. |
| The Tesseract | Inside the horizon (above). Unlocked by crossing it, or by watching The Journey to the end. |

**Spacecraft** (Hangar): Ranger (all-rounder), Pilgrim (capsule: strong RCS and heat shield, docks nose-first), Lander (four engines, 20 km/s of Δv, tough), Kestrel (fast, agile, fragile). Each has its own thrust, turn rate, Δv budget, hull strength and heat tolerance.

**Career**: 22 contracts scored one to three stars against a par time, hull condition and restarts; XP and seven ranks unlock ships and worlds; 22 achievements; a codex filled by scanning objects; a logbook. *Settings → Gameplay* has unlimited propellant, an indestructible hull and a sandbox switch that unlocks everything.

**Systems**: propellant is a Δv budget (every m/s of thrust is a m/s spent), hull damage from collisions, hard landings, heating and radiation, resupply while docked, an orbit map with your conic and apsides, and a nav computer that quotes the real Hohmann transfer between worlds.

| Key | Action |
|---|---|
| Enter · Y · I · O | TARS flies it · ask TARS · status report · voice commands |
| Space | Launch: ignite, stage, separate · Tesseract: key a pulse |
| W / S · Shift | Main engines / retro · boost |
| A / D · R / F · Q / E | Lateral · vertical RCS · roll |
| [ / ] · Z · Backspace | Throttle hold ∓10 % · full · cut |
| X | Match velocity with the target |
| 1 / 2 · 3 / 4 · 5 · 6 · 0 | Autopilot hold: prograde / retrograde · toward / away from target · radial out · brake · off |
| Tab · B | Cycle target · scan it |
| M · N | Orbit map · nav computer (travel to another world) |
| T · , · . | Time warp ×1 / ×10 / ×100 / ×1000 (while coasting) |
| C · mouse wheel | Camera: chase · cockpit · orbit · cinematic · target · zoom |
| L · K · H | Floodlights · photograph (PNG) · HUD |
| J · P · U | Next contract · restart · undock |
| V | Flight assist on/off (pure Newtonian rotation when off) |

A standard gamepad also works: sticks for attitude and RCS, triggers for engines, bumpers for roll.

URL shortcuts: `?explore=launch|earth|moon|mars|jupiter|saturn|gargantua|tesseract`, plus optional `&mission=<id>` and `&ship=ranger|capsule|lander|scout`.

## Settings
Quality presets (Low / Medium / High / Ultra) plus individual controls: resolution scale, dynamic resolution, shadow map size, black-hole ray-tracing quality, bloom, lens flares, film grain, 8K Earth texture, FOV, camera shake, letterbox, HUD, radio dialogue, movie or physical Gargantua, mouse sensitivity, invert pitch, flight assist, music and engine volume. Settings are saved in this browser.

## Real spacecraft & imagery
- NASA 3D Resources (public domain): **Saturn V** (split into its real stages for the launch, with the Ranger in place of the Apollo CSM), **ISS**, **Hubble**, **Cassini**, **Juno**, an **astronaut** (as Mann). The models are Draco-compressed; the decoder is in `public/draco/`.
- 4K planetary maps (8K Earth on Ultra) from Solar System Scope (CC BY 4.0), built from NASA imagery.
- The Ranger and Endurance are procedural, with generated PBR textures: panel seams and rivets as normal maps, gold, silver and black insulation foil, ceramic heat tiles, solar cells, radiators and glass.

## Controls
| Key | Action |
|---|---|
| 1 / 2 / 3 / 4 (or C) | Cinematic · Chase · Cockpit · Free orbit (drag/scroll) |
| 5 | **Orbit Gargantua**: fly around the black hole in 3D (drag to orbit, scroll to zoom; it auto-rotates when idle). Works from 6:12 to the end |
| Space | Pause (during spin-docking it rolls the Ranger instead) |
| ← / → | Seek ±10 s · click the timeline to jump |
| W A S D, Q E | Steer during manual docking (2:42–3:12) |
| Space / E, Q | Roll faster / slower during the 68 rpm spin-match (13:10–13:38) |
| G | Gargantua look: **Movie** (spin a = 0.6, no beaming, as the film's VFX team rendered it) ↔ **Physical** (a = 0.999, full Doppler beaming + redshift) |
| H · M · F | HUD · mute · fullscreen |

The autopilot assists more and more as each deadline approaches, so the journey always stays in sync with the music.

## Timeline
| Time | Chapter |
|---|---|
| 0:00 | Prologue: cosmic web → Milky Way → Orion Arm → live Solar System → Earth |
| 1:08 | Ascent from LC-39A (2-D gravity-turn simulation, real max-Q) |
| 2:20 | Rendezvous & manual docking with the Endurance |
| 3:25 | Spin-up to 1 g (5.29 rpm), hypersleep, Mars, asteroid belt, Jupiter |
| 5:00 | Saturn & the wormhole |
| 5:52 | Transit |
| 6:12 | Another galaxy: Gargantua |
| 7:35 | Miller's planet: shallow ocean, the wave, 23 years |
| 9:42 | Gargantua pass, Mann's frozen world |
| 12:22 | Mann's docking, explosion, spin-match docking |
| 13:52 | Slingshot, detach, the horizon, spaghettification, the tesseract |
| 14:56 | The film ends; the tesseract level begins |

## Real data & physics
- **Planet positions:** live NASA/JPL Horizons state vectors (proxied by Vite at `/horizons`), with a fallback to JPL Keplerian mean elements offline.
- **Planet data:** NASA fact sheets; textures from three.js examples and Solar System Scope (CC BY 4.0).
- **Ascent:** point-mass integration with Saturn V-class stages, exponential atmosphere and drag.
- **Orbits:** v = √(μ/r). Hohmann Earth→Saturn transfer is computed. Spin gravity is a = ω²r.
- **Gargantua:** a spinning (Kerr) black hole, ray traced per pixel. Light paths are RK4-integrated in Boyer–Lindquist coordinates from a camera that co-rotates with space near the hole, so frame dragging, the flattened D-shaped shadow and the disk lensed over and under the hole all come out of the physics. The disk starts at the prograde innermost stable orbit (ISCO) and uses the exact Kerr redshift. Mass is 10⁸ M☉ (after K. Thorne).
- **Miller:** 1 h = 7 yr (×61,362). Tidal stretch at the horizon is computed as 2GML/r³.

Local and private: nothing is deployed.
