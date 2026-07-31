# LadderLens

**Structured Text ⇄ Ladder Diagram**

A single-file, offline browser tool that converts between IEC 61131-3
Structured Text and Ladder Diagram — and runs it on a real simulated
scan cycle, so you can watch rungs energize, seal-in circuits latch,
and timers count as inputs change.

**[Open the live tool →](https://ottjoshua.github.io/ladderlens/)**

---

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

**A plant to control.** The **Plant** view is a P&ID canvas wired to the
same tags the logic uses: drag out tanks, control valves, pumps, level
transmitters, supply and drain; bind them to tags; and the process runs
on the same scan — transmitters publish levels before each scan, the
logic computes, actuators move flow, tanks integrate it. Load the
**level control plant** and watch the controller settle the tank at its
setpoint; then load the **sign error** logic against the same plant and
watch positive feedback run the tank into visible **OVERFLOW**. Pipes
animate where liquid actually flows. The plant is saved in your browser;
the `.st` file carries only the logic.

**Files.** Open a `.st` file (or drop one onto the editor) and export
your program back to `.st` when you're done. Plain text either way —
nothing leaves the browser.

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

No build, no dependencies, no server. Either:

- Open the hosted link above, or
- Download `index.html` and open it in any modern browser.

Everything runs client-side. Nothing is uploaded.

## Scope and limits

This is a teaching aid, not a compiler or a controller. It covers the
common control-logic subset with untyped tags. It does **not** model
real-time determinism — the scan pauses while the tab is hidden, and
pulses shorter than one scan period are missed (as on a real PLC).
`FOR` / `WHILE` are explained rather than drawn, by design.

## License

Copyright © 2026 Joshua Ott. All rights reserved. See [LICENSE](LICENSE).

Anyone is welcome to **use** the tool — at the hosted link above or from
a downloaded copy. The source code may not be copied, modified,
redistributed, or reused in other projects without written permission.

