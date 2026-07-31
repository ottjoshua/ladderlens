/* Required Notice: Copyright (c) 2026 Joshua Ott — LadderLens (https://ladderlens.com)
   PolyForm Noncommercial 1.0.0 — commercial use requires a separate license. */

/* ---------- device catalog ----------
   Vendors and models a device can be declared as. Today this is identity —
   the P&ID and project file carry it — and it is the anchor point for the
   roadmap's vendor dialects (write logic against a Siemens, re-declare the
   controller as a Rockwell, translate). Models here are common real-world
   lines; the simulated behavior is the same for all of them. */

export const CATALOG={
  plc:[
    {vendor:'Simulated', models:['SoftPLC']},
    {vendor:'Siemens', models:['S7-1200','S7-1500','ET 200SP CPU']},
    {vendor:'Rockwell', models:['Micro870','CompactLogix 5380','ControlLogix 5580']},
    {vendor:'Schneider', models:['Modicon M241','Modicon M580']},
    {vendor:'Honeywell', models:['ControlEdge 900','MasterLogic ML200']},
  ],
};

export function vendorsFor(type){ return (CATALOG[type]||[]).map(v=>v.vendor); }
export function modelsFor(type,vendor){
  const v=(CATALOG[type]||[]).find(x=>x.vendor===vendor);
  return v?v.models.slice():[];
}
