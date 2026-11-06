# Interstellar Endurance

A private, 14 min 56 s real-time journey from Earth to Gargantua, synced to `public/audio/interstellar-music.mp3`.
Three.js + custom GLSL. Every scene is a pure function of the music's time, so seeking is exact.

## Run
```
npm install
npm run dev        # http://127.0.0.1:5173
```
Use Chrome, fullscreen (F), headphones. The main menu offers **The Journey** (the 15-minute film), **Free Flight** (fly the Ranger yourself), **Settings** and **Controls**. Esc opens the menu at any time.
`?t=455` jumps straight into the journey at a given second; `?explore=earth|saturn|gargantua` starts free flight.

## Free flight
Pilot a Ranger with six-degree-of-freedom Newtonian physics. Click to capture the mouse, which works as a virtual stick for pitch and yaw.

| Key | Action |
|---|---|
| W / S | Main engines / retro · **Shift** boost |
| A / D · R / F | Lateral · vertical RCS |
| Q / E | Roll |
| X | Match velocity with the target |
| Tab | Cycle target |
| C | Camera: chase · cockpit · orbit · cinematic · target |
| V | Flight assist on/off (pure Newtonian rotation when off) |
| T | Time warp ×1 / ×10 / ×100 (only while coasting) |
| U · P | Undock · respawn |

Locations and missions:
- **Earth orbit:** a real 400 km orbit (μ⊕ = 3.986 × 10¹⁴ m³/s²). The Endurance, the ISS and Hubble each follow their own Keplerian orbit, so relative drift is real orbital mechanics. Missions: reach the ISS, inspect Hubble, then dock with the Endurance (collar to port, under 0.5 m/s, within 12°). The HUD shows live apoapsis and periapsis.
- **Saturn:** inside the A ring, among co-orbiting ice boulders (they collide), with Cassini and the wormhole. Flying into the wormhole takes you to Gargantua.
- **Gargantua:** distances in Schwarzschild radii, pseudo-Newtonian gravity (Paczyński–Wiita: it has an ISCO and captures you), a speed of light, and ship and Earth clocks running at dτ/dt = √(1 − r_s/r)·√(1 − v²/c²). Missions: dive inside 10 r_s, survive below 3 r_s, reach Miller's planet, cross the horizon. The wormhole takes you back to Saturn.

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

## Real data & physics
- **Planet positions:** live NASA/JPL Horizons state vectors (proxied by Vite at `/horizons`), with a fallback to JPL Keplerian mean elements offline.
- **Planet data:** NASA fact sheets; textures from three.js examples and Solar System Scope (CC BY 4.0).
- **Ascent:** point-mass integration with Saturn V-class stages, exponential atmosphere and drag.
- **Orbits:** v = √(μ/r). Hohmann Earth→Saturn transfer is computed. Spin gravity is a = ω²r.
- **Gargantua:** a spinning (Kerr) black hole, ray traced per pixel. Light paths are RK4-integrated in Boyer–Lindquist coordinates from a camera that co-rotates with space near the hole, so frame dragging, the flattened D-shaped shadow and the disk lensed over and under the hole all come out of the physics. The disk starts at the prograde innermost stable orbit (ISCO) and uses the exact Kerr redshift. Mass is 10⁸ M☉ (after K. Thorne).
- **Miller:** 1 h = 7 yr (×61,362). Tidal stretch at the horizon is computed as 2GML/r³.

Local and private: nothing is deployed.
