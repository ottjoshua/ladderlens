# LadderLens

**An OT workspace in the browser: P&ID, controllers, and live logic**

Draw a plant on a P&ID canvas, put a controller on it, open the
controller and write its IEC 61131-3 logic as Structured Text or
Ladder Diagram — two live projections of the same program, running on
a real simulated scan cycle against a plant that physically responds.
Watch rungs energize, seal-in circuits latch, timers count, and tanks
fill because your logic told a valve to open.

**[Open the live tool →](https://ladderlens.com/)** ·
[standalone logic editor](https://ladderlens.com/logic.html)

---

## The vision: a Packet Tracer for OT

Networking students have Packet Tracer — free, faithful-enough
simulation that made real gear optional for learning. OT has nothing
like it: training happens on expensive vendor benches, expensive
operator-training simulators, or not at all.

LadderLens is being built toward that gap, one working release at a
time. The workspace opens on the **P&ID view** — the plant is the
home screen, and everything on it is a device in one project model:
tanks, valves, pumps, transmitters, and **controllers**. Open a
controller (double-click it) and the **Logic view** shows the program
that controller runs, as IEC 61131-3 Structured Text and Ladder
Diagram — two live, editable projections of the same program on a
real scan cycle. The whole workspace saves in the browser and travels
as a single **`.llp` project file** — build a plant with a broken
controller, export it, and hand it to a class to fix.

On the roadmap: Function Block Diagram as a third lens on the same
program, vendor dialect detection and translation for the text side
(IEC / Siemens SCL / Rockwell), device catalogs (vendor/model), a
richer ISA-5.1 symbol library, a Purdue Model view that places these
same devices in their network levels with firewalls on the conduits,
and simulated industrial protocols (Modbus, DNP3, EtherNet/IP) with
visible traffic between devices.

## What it does

**Text → Ladder.** Type Structured Text on the left, get rungs on the
right, evaluated in real time. Change an input value and watch power flow
through the energized rungs.

- Assignments, `IF` / `ELSIF` / `ELSE`, `CASE`
- Arithmetic rendered as function blocks (`ADD`, `SUB`, `MUL`, `DIV`)
- `LIMIT`, `MIN`, `MAX`, `ABS`, `SQRT`, `SEL`
- Normally-open `[ ]` and normally-closed `[/]` contacts; `AND` draws as
  series contacts, `OR` as **parallel branches** with connection bars
- Boolean assignments draw as **contact networks driving a coil** —
  `bMotor := (bStart OR bMotor) AND NOT bStop;` renders as the textbook
  motor seal-in circuit, and the wires light where power actually flows
- A scan-return path showing the cyclic execution model (`T#100ms`)

**A real scan cycle.** The program executes every 100 ms and state
persists between scans — a seal-in rung actually latches. Stateful
function blocks work the way the standard says they do:

- `TON` / `TOF` / `TP` timers, `CTU` / `CTD` counters,
  `R_TRIG` / `F_TRIG` edge detection
- Declare instances in `VAR … END_VAR`, call them
  (`tmr(IN := bRun, PT := T#5s);`), read the outputs (`tmr.Q`, `tmr.ET`)
- `TIME` literals (`T#500ms`, `T#1m30s`)
- **run / stop / step / reset** controls — single-step the scan and watch
  a timer accumulate 100 ms at a time; reset is a cold restart
- A timer called inside an `IF` freezes when the condition drops — the
  tool warns about it, because that's the classic gated-timer bug

**Ladder → Text.** The diagram is editable in place, and the Structured
Text regenerates as you work:

- Click any contact tag, block pin, or coil to rename or retype it —
  pins accept full expressions
- Click a contact symbol to flip `[ ]` ⇄ `[/]`
- Drag `⋮⋮` to reorder rungs; drag contacts to reorder them in a rung
- `×` deletes contacts and rungs; `+ rung` and `+[ ]` add them

Diagram edits rewrite the text in flat rung form (comments are dropped).
Complementary contacts (`[ ]X` and `[/]X` writing the same tag) collapse
back into a single `IF / ELSE`. A tag written by only one gated rung
raises a warning — the output would hold a stale value when the contact
opens, the classic mistake when converting ladder to text by hand.

**A plant to control.** The **P&ID** view is the home screen — a
canvas wired to the same tags the logic uses: drag out tanks, control
valves, pumps, level transmitters, supply and drain; bind them to
tags; and the process runs on the same scan — transmitters publish
levels before each scan, the logic computes, actuators move flow,
tanks integrate it. Load the **level control plant** and watch the
controller settle the tank at its setpoint; then load the **sign
error** logic against the same plant and watch positive feedback run
the tank into visible **OVERFLOW**. Pipes animate where liquid
actually flows.

**Controllers are devices.** Add a controller from the palette, select
it and press **open logic** (or double-click it) — the Logic view
edits the program that controller runs. Target chips in the Logic view
switch between any controller's program and a free-standing
**sandbox**, each keeping its own program and input values.

**Files.** The whole workspace — devices, controller programs, input
values — exports as one readable **`.llp` project file** (versioned
JSON) and imports back, so plants can be shared, versioned in git, or
handed out as lab exercises. Individual programs still open from and
export to plain **`.st`** files. Nothing leaves the browser either
way.

**Loops.** `FOR` and `WHILE` cannot be drawn as rungs (a rung is one
power path evaluated once per scan). The tool explains why and renders
the real ladder equivalent: a counter that advances one iteration per
scan, with a note on how the timing differs from the Structured Text.

## Why

Most PLC programs reviewed in the field were never written in Structured
Text — ladder is the field default, and older programs are almost
entirely ladder. Reading ladder as ladder is a skill that doesn't
automate away. This tool exists to make the relationship between the two
concrete and interactive.

## Running it

No build step, no dependencies — plain HTML, CSS, and native ES
modules. Either:

- Open the hosted link above, or
- Clone the repo and serve it with any static file server
  (`python -m http.server`), then open `index.html`. Browsers block
  ES modules over `file://`, so a local server is needed.

Everything runs client-side. Nothing is uploaded.

## Scope and limits

This is a teaching aid, not a compiler or a controller. It covers the
common control-logic subset with untyped tags. It does **not** model
real-time determinism — the scan pauses while the tab is hidden, and
pulses shorter than one scan period are missed (as on a real PLC).
`FOR` / `WHILE` are explained rather than drawn, by design.

## Contributing

Forks, issues, and pull requests are welcome — this is a teaching tool
and it gets better with more eyes from people who live in OT. By
submitting a contribution you agree that it is provided under this
project's license, and you grant the project author the right to
include it in commercially licensed versions of the software.

## License

Copyright © 2026 Joshua Ott. Licensed under the
**PolyForm Noncommercial License 1.0.0** — see [LICENSE](LICENSE).

In plain words: use it, fork it, modify it, share it, learn from it —
freely, for any noncommercial purpose — and keep the copyright notice
with it. **Any commercial use requires a separate commercial license**:
if this code ends up in something that makes money, its author gets
paid. Ask via [GitHub](https://github.com/ottjoshua).

