/* Required Notice: Copyright (c) 2026 Joshua Ott — LadderLens (https://ladderlens.com)
   PolyForm Noncommercial 1.0.0 — commercial use requires a separate license. */

/* ---------- examples ---------- */
const EX = {
ex1:`(* Proportional level controller *)
rLC_Error := rLC_SP - rLevel_PV;

IF bLC_ManMode THEN
    rValve_OP := rLC_ManOP;
ELSE
    rValve_OP := rLC_Bias + (rLC_Kp * rLC_Error);
END_IF

rValve_OP := LIMIT(0.0, rValve_OP, 100.0);`,

ex2:`(* Same controller, one operand pair swapped.
   Compare rung 1 against the correct version. *)
rLC_Error := rLevel_PV - rLC_SP;

IF bLC_ManMode THEN
    rValve_OP := rLC_ManOP;
ELSE
    rValve_OP := rLC_Bias + (rLC_Kp * rLC_Error);
END_IF

rValve_OP := LIMIT(0.0, rValve_OP, 100.0);`,

ex4:`(* CASE — each branch becomes its own rung,
   gated by an equality comparison on the selector *)
CASE iMode OF
  0: rValveCmd := 0.0;
  1: rValveCmd := rManualCmd;
  2: rValveCmd := rAutoCmd * rTrim;
ELSE
  rValveCmd := rSafeCmd;
END_CASE

rValveCmd := LIMIT(0.0, rValveCmd, 100.0);`,

ex5:`(* FOR — this one has no rung equivalent.
   Ladder would need a counter across scans instead. *)
rTotal := 0.0;

FOR iIndex := 1 TO 4 DO
    rTotal := rTotal + rSample;
END_FOR

rAverage := rTotal / 4.0;`,

ex6:`(* Motor seal-in with a star-delta timer.
   Toggle bStart: the motor latches in through its
   own contact, and tmrStar times toward T#5s —
   watch ET climb, then Q fires the delta contactor.
   bStop drops everything out. Try STEP with the
   scan stopped to single-step the timer. *)
VAR
    tmrStar : TON;
END_VAR

bMotor := (bStart OR bMotor) AND NOT bStop;

tmrStar(IN := bMotor, PT := T#5s);

bDelta := tmrStar.Q;`,

ex3:`(* Pump permissive with a low-level interlock *)
rMargin := rLevel - rTripPoint;

IF bLowLevelTrip THEN
    rPumpSpeed := 0.0;
ELSE
    rPumpSpeed := rSpeedRef * rEnableScale;
END_IF

rPumpSpeed := LIMIT(0.0, rPumpSpeed, 100.0);`
};


/* per-example input presets — loaded alongside the program */
const EX_DEFAULTS={
  ex1:{rLC_SP:60,rLevel_PV:50,rLC_Kp:1.5,rLC_Bias:50,rLC_ManOP:0,bLC_ManMode:false},
  ex2:{rLC_SP:60,rLevel_PV:40,rLC_Kp:1.5,rLC_Bias:50,rLC_ManOP:0,bLC_ManMode:false},
  ex3:{rLevel:20,rTripPoint:15,rSpeedRef:80,rEnableScale:1,bLowLevelTrip:false},
  ex4:{iMode:1,rManualCmd:40,rAutoCmd:55,rTrim:1,rSafeCmd:0},
  ex5:{rSample:25},
  ex6:{bStart:false,bStop:false}
};

export {EX, EX_DEFAULTS};
