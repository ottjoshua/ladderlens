# LadderLens

**Structured Text ⇄ Ladder Diagram**

A single-file, offline browser tool that converts between IEC 61131-3
Structured Text and Ladder Diagram, and evaluates the logic live so you
can watch rungs energize as inputs change.

**[Open the live tool →](https://ottjoshua.github.io/ladderlens/)**

---

## What it does

**Text → Ladder.** Type Structured Text on the left, get rungs on the
right, evaluated in real time. Change an input value and watch power flow
through the energized rungs.

- Assignments, `IF` / `ELSIF` / `ELSE`, `CASE`
- Arithmetic rendered as function blocks (`ADD`, `SUB`, `MUL`, `DIV`)
- `LIMIT`, `MIN`, `MAX`, `ABS`, `SQRT`, `SEL`
- Normally-open `[ ]` and normally-closed `[/]` contact gating; `AND`
  conditions draw as series contacts
- A scan-return path showing the cyclic execution model (`T#100ms`)

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

This is a teaching aid, not a compiler. It covers the common
control-logic subset. It does **not** render parallel (OR) contact
branches as vertical rungs, boolean-logic-to-coil, timers, or function
blocks with internal state. `FOR` / `WHILE` are explained rather than
drawn, by design.

## License

Copyright © 2026 Joshua Ott. All rights reserved. See [LICENSE](LICENSE).

Anyone is welcome to **use** the tool — at the hosted link above or from
a downloaded copy. The source code may not be copied, modified,
redistributed, or reused in other projects without written permission.

