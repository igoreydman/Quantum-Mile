# Quantum Mile data sources and credits

Updated November 9, 2026. This register separates inputs used by the app from
traffic observations retrieved for research. Runtime 67 uses **nearby measured
hourly volumes for Miracle Mile arrival rates** in the two-crossing Regular and
Rush hour scenarios. Cross-street demand, starting occupancy, exact arrival spacing, motion
and light timings remain modeled. This is not a live traffic reconstruction.
The six-crossing model retains synthetic demand.

## Source register

| ID | Credit and primary source | Role in the current app | Dates and units |
| --- | --- | --- | --- |
| `osm-geometry` | Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). [Original bounding-box query](https://api.openstreetmap.org/api/0.6/map?bbox=-80.264,25.747,-80.254,25.753). | **Used:** saved street/building geometry. Lane tags were researched; the introductory model still illustrates one lane per direction. | Saved extract identified by its original SHA-256 in the geography JSON. Original retrieval time is not established by this audit; do not substitute this document's date. Coordinates are geographic, not vehicle observations. |
| `city-signal-locations` | City of Coral Gables, [Traffic Signal Control Boxes memorandum, April 6, 2026](https://www.coralgables.com/sites/default/files/2026-05/Miami-Dade-County-Traffic-Signal-Control-Boxes-CH.pdf). | **Location reference:** supports the original Miracle Mile/Salzedo and Miracle Mile/Ponce crossings. Does not supply signal timing or traffic demand. | Document dated April 6, 2026; earlier verification preserved in [signal-location-verification.json](signal-location-verification.json). |
| `fdot-hourly-872534` | FDOT Transportation Data and Analytics, [2025 station synopsis 872534](https://tdaappsprod.dot.state.fl.us/fto/reports/Concatenated_SynopsisReports_2025/872534.pdf). | **Used:** directional arrival-rate proxy for Miracle Mile in the two-crossing model. The counter is east of the map; it does not observe our junction queues. | Observed July 22–24, 2025; retrieved November 9, 2026. Vehicles/hour, from 15-minute count bins. |
| `fdot-aadt-2025` | Florida Department of Transportation (FDOT), Transportation Data and Analytics, [Annual Average Daily Traffic dataset](https://www.arcgis.com/home/item.html?id=ceb698fb86d446c08f0b8e54acab6293), [Traffic Information](https://www.fdot.gov/statistics/trafficinfo/default.shtm). ArcGIS hosts the service. | **Research only; not used to spawn cars.** Annual road-section volume estimates. | Traffic year **2025**; retrieved November 9, 2026. AADT = annual average vehicles per day. Dataset build date October 31, 2026 is not the traffic observation date. |
| `city-camera-counts-2026` | **City of Coral Gables**, vehicle-count analytics by **intuVision**, dashboard platform **Quantela**. [City Smart City Hub](https://www.coralgables.com/smartcity), [IntuVision Analytics dashboard](https://atlantis-us-dashboard.quantela.com/#/dashboards/7Z6sA3EB58Mxv7GtTnEB?embed=1&toolbar=0&t=coralgables.com). | **Research only; not used to spawn cars.** Detector-reported daily vehicle passages at named sensors. Vendor/platform credit is separate from the City's data role. | Retrieved November 9, 2026 using Last 6 Months. Returned dates **May 9–October 28, 2026**, 173 daily records per selected series. Dashboard reporting timezone and completeness are unverified. |
| `cgtwin-congestion-snapshot` | **City of Coral Gables CGTwin**; Google traffic/corridor travel-time estimates and separately labeled **Waze** incident reports. [CGTwin](https://cggisw.coralgables.com/cgtwin/), [provider/refresh explanation in the user guide](https://cggisw.coralgables.com/cgtwin/help.html). | **Research context only.** No Google traffic or Waze feed is integrated in Quantum Mile. Our road colors indicate signal permission, not provider congestion. | Retrieved November 9, 2026. Latest saved panel displayed **2:22 PM, America/New_York**. Travel time and added delay are minutes; that display time does not establish the underlying observation window. |
| `synthetic-model` | Quantum Mile implementation, developed with Codex assistance. | **Used:** authored starting cars, cross-street demand, exact arrival spacing, speed, spacing, signal cycle, simplified motion and model outputs. Miracle Mile hourly rates are separately credited to FDOT. | Simulation seconds/metres; parameters below. They are assumptions, not measurements. |

## Verified values and coverage

### FDOT hourly counts used in Regular / Rush hour

The [original three-page station synopsis](web-demo/research/traffic-profiles-2026-11-09/872534-synopsis-2025.pdf) identifies **872534**, SR 972 / Coral Way, 200 feet east of SW 37 Avenue, at 25.74983, -80.25401. This is a nearby corridor proxy east of the app map, not measured arrival counts at Salzedo or Ponce. The three count dates are July 22–24, 2025 (Tuesday–Thursday). These are historical summer weekdays, not an annual typical-hour profile or live observation.

| Preset | Chosen observation window | Eastbound vehicles/hour | Westbound vehicles/hour | Samples |
| --- | --- | ---: | ---: | ---: |
| Regular | 10:00–11:00 | 952.3333 | 932.6667 | 3 direction-hours each |
| Rush hour | 17:00–18:00 | 1,261 | 1,318.3333 | 3 direction-hours each |

These are our two scenario definitions, not FDOT-defined regular/rush categories. Each clock hour is averaged separately by direction across the three observed days. Regular uses the first hour of the former 10:00–16:00 window; Rush retains 17:00–18:00. The optional hourly selector exposes all24 hours without a demand multiplier. These remain selected-hour snapshots, not a clock that advances through a full day. The new presets have31.4167 versus42.9889 combined arrivals/minute, a36.8347% difference. Full precision is used in code; the UI rounds for readability. Do not multiply both values by two: each value already describes one direction. No annual-total-to-hour conversion, growth factor or inferred lane split was used. The underlying counter represents total directional volume; the app still illustrates one lane per direction.

Evidence: [normalized hourly CSV](web-demo/research/traffic-profiles-2026-11-09/hourly-counts.csv) and [72 parsed rows including original quarter-hour bins](web-demo/research/traffic-profiles-2026-11-09/parsed-counts.json). All quarter-hour sums, direction totals, and daily totals were checked against the report; the first table was also rendered and visually inspected. Original PDF SHA-256: `240db966a36ad660e5ff054958013f19142000a20905847697ee95cddeffd71b`.

Implementation: mean headway =3,600 / selected directional hourly rate. Exact timestamps are unavailable. Seeded gaps vary with a shifted exponential shape; each block of60 headways is normalized to mean1, preserving the selected mean rate. This is an authored arrival model, not a fitted headway distribution. Every condition uses the same underlying gap quantiles scaled by its rate. Each comparison policy receives identical seeded arrivals, including the arrival index carried through preparation and replay. First arrivals retain authored staggered offsets. Entry waits for space.

Switching hour starts a fresh run and rebuilds all four forecasts and the circuit. The visible scene is prepared with60 seconds of the same motion/arrival model, retaining all car speeds, queues, signal reaction decisions and arrival indices before rebasing time/counters to0:00. Starting occupancy is a model output, not measured occupancy. When receiving space is full, source requests wait outside the mapped road; the UI reports that backlog separately. A short mapped road can look similarly full under two rates even when the incoming backlog differs. The one-lane-per-direction illustration also simplifies the source's total directional volume; its congestion is not a calibrated estimate of these junctions.

Ponce station 878410 was located in Florida Traffic Online: 200 ft south of Miracle Mile, tagged 2011 off-system cycle, with **no synopsis report available**. Its 2025 annual estimate does not establish hourly counts. The current six-month hourly FeatureServer query returned zero records for both identified stations and no records in the map bounding box; these bounded negative results do not prove no other records exist. Salzedo/Ponce therefore retain **assumed 450 vehicles/hour per direction**, unchanged between presets. This source gap is disclosed beside the controls.

### FDOT annual estimates

| Road section | Source identifiers | 2025 AADT | Scope and qualification |
| --- | --- | ---: | --- |
| Miracle Mile / Coral Way: SR-953 / Le Jeune Road to SW 36 Avenue | `COSITE=872534`, `ROADWAY=87054000`, `FID=20578`, `AADTFLG=C` | 35,500 vehicles/day | Larger road section containing the two study crossings; not an individual approach or simultaneous car count. |
| Ponce de Leon: Catalonia Avenue to Alhambra Circle | `COSITE=878410`, `ROADWAY=87000125`, `FID=14215`, `AADTFLG=T` | 16,300 vehicles/day | Larger road section; not a fresh measured one-day count. Flag meanings have not been independently decoded in this audit. |

The saved query selected intersecting features in longitude/latitude bounds
`-80.264,25.747,-80.254,25.753`; the exact URL and original returned attributes and
geometries are in [fdot-nearby-aadt.json](../output/traffic-data-audit-2026-11-09/fdot-nearby-aadt.json).
No Salzedo record was returned in this bounded query; this does not establish
that no Salzedo counts exist. Annual averages and published K/D factors do not
provide an observed hourly arrival profile or turning shares.

### City camera records

Sensor labels are preserved verbatim. “East,” “West” and “N” have not been
independently confirmed as travel directions, lane coverage or counting lines.

| Exact source series | October 27, 2026 passages | Latest: October 28 | Zero-valued days in 173 records |
| --- | ---: | ---: | ---: |
| `Miracle_Mile-200BlockEast:MM200E_Block_Vehicles` | 5,231 | 2,914 | 57 |
| `Miracle_Mile-200BlockWest:MM200W_Block_Vehicles` | 1,097 | 985 | 57 |
| `MiracleMile-Ponce_Pedestrians-Vehicles:MM-Ponce_N_Vehicles` | 3,343 | 2,643 | 27 |

These are reported passages, not unique cars or all cars occupying a road.
Coverage may overlap, so the three series must not be summed into a unique road
or intersection total. Historical zeros and unusually low records have no
verified quality/completeness flag; neither real zero traffic nor an outage is
established. The default seven-day view had no usable values. No hourly arrival
profile or measured left/through/right split was retrieved.

Evidence and transformations:

- Ponce N: dashboard CSV export retained as [mm-ponce-n-daily.csv](../output/traffic-data-audit-2026-11-09/mm-ponce-n-daily.csv), including its original UTF-8 BOM.
- 200 Block East/West: all 18 visible report-table pages per series retained as `mm200e-table-pages.json` / `mm200w-table-pages.json`; normalized to `mm200e-daily-ui.csv` / `mm200w-daily-ui.csv`. These are **UI table transcriptions**, not provider CSV exports.
- All 173 reported rows per series were retained, including zeros. `*-summary.json` files contain row counts, ranges and simple arithmetic summaries. October means cover October 1–28; they are not quality-screened estimates of typical demand.
- The source display's calendar dates were preserved; no timezone conversion or interpolation was applied. The [snapshot manifest](../output/traffic-data-audit-2026-11-09/source-snapshot-manifest.json) records file hashes and capture types.

### Congestion context

At the latest saved **2:22 PM** panel, Coral Way (Red Road–Douglas Road) showed
14 minutes, +2 minutes / Slow; Ponce de Leon (US-1–SW 8th Street) showed
18 minutes, +2 minutes / Slow. These provider estimates cover corridors larger
than the two-crossing map. They do not identify queue lengths, turn counts or
the number of cars on a study segment.

The [panel screenshot](../output/traffic-data-audit-2026-11-09/congestion-panel.png)
and `latestCongestionPanel` in the [verified findings](../output/traffic-data-audit-2026-11-09/verified-traffic-findings.json)
belong together. Earlier saved 2:17 PM values remain a separate snapshot; do not
combine changing fields across them. The guide describes five-minute refreshes
and potential delays. Waze incident counts are incident reports, not car counts.
Outputs from CGTwin's separate traffic simulation are not independent field
measurements for calibrating this project.

## Where the current simulation numbers come from

The introductory two-crossing model uses [two-way-traffic-model.js](web-demo/source/product-mapping/two-way-traffic-model.js)
and the selected rates from `traffic-demand.js`, overriding the legacy
saved route `period` values in [two-way-geography.json](web-demo/source/product-mapping/two-way-geography.json):

| Parameter | Authored value | Interpretation |
| --- | --- | --- |
| Visible starting cars | Run the existing model for 60 seconds at the selected rates; retain positions, queues, signal state and arrival schedule, then reset the displayed clock/counters | Occupancy depends on the selected hour and model version; no fixed car count is claimed. No density multiplier or measured occupancy claim. The low-level engine still seeds three cars per Miracle Mile direction and one per cross-street direction before this preparation. |
| Arrival requests | Miracle Mile: 3,600 / selected FDOT directional vehicles/hour; Salzedo/Ponce: every 8 seconds per direction | First requests are staggered by authored offsets; subsequent gaps vary reproducibly and preserve their mean over60 gaps. Entry waits for space. Exact headways are modeled, not measured. The legacy geography still stores the original 4/8-second defaults. |
| Free-moving speed | 8 m/s (about 18 mph) | Desired free-flow speed; individual cars accelerate/brake below this. Not an observed or posted speed. |
| Minimum vehicle spacing | 8 m | Minimum reference spacing at rest. Moving following distances grow with speed; not measured spacing or icon size. |
| Time step | 0.1 seconds | Numerical update interval. |
| Signal settings | 15-second cycling green; 3-second yellow, then additional red only while the crossing is occupied | Authored control rules; not retrieved municipal timings. |

The two-crossing motion model stores speed for each car. Acceleration is bounded at1.5m/s²; normal braking at3.07m/s². A1-second modeled response and the stopping-distance relation d=v·t+v²/(2b) determine stop/go at yellow onset for the nearest upcoming light. Cars with room to stop react then brake toward the stop line; cars too close to stop may commit only if they can reach the line before yellow ends. Following/storage restrictions still override that permission. No new entry is allowed during red. Cars already inside continue; conflicting green waits for their exit. A safety position cap prevents numerical boundary violations or overlap if a road becomes blocked suddenly.

Research basis: [FHWA, Traffic Signal Change and Clearance Interval Pooled Fund Study: Synthesis Report, FHWA-HOP-23-037, March2023](https://ops.fhwa.dot.gov/publications/fhwahop23037/fhwahop23037.pdf), printed pages37–38, tables2–3, summarizes NCHRP Report731's observed mean brake-response1.0s and mean deceleration10.08ft/s² (3.072m/s²). Those population means inform the model; they are not local trajectories or a claim every driver responds identically. Gentler yellow braking is calculated to reach the stop line with a modeled minimum0.8m/s². Desired following time1s, standstill reference gap8m, acceleration1.5m/s², free speed8m/s, the arrival-gap distribution and signal timings are authored, uncalibrated assumptions. Cars retain a same-lane safety envelope and reserve downstream storage before entering. They can still form real signal queues/platoons; moving queues spread out rather than retaining the minimum standstill gap.

The existing six-crossing routed mode retains its simpler constant-speed dynamics and synthetic demand. It shares the yellow/occupied-clearance sequence, not the new per-car braking model. The street's four complete held-plan forecasts, exact-search comparator, quantum replay and cycling comparator all run the same updated street engine and identical input snapshot. Quantum arithmetic is unchanged; traffic costs, tuned settings and sampled outcomes are recalculated.

Ponce northbound now continues to the upper study boundary along the saved OSM polyline, rather than dropping the long segment crossing that boundary. Source hash and route gates are unchanged; the clipped path is 117.67 m long, beyond its 72.15 m clearance exit. See [repair provenance](research/traffic-signal-fix-2026-11-09/ponce-route-repair.json).

This opening model has no turns, lane changes, pedestrians or
right-on-red. The separate six-crossing routed model has additional movement
rules but also synthetic demand; do not transfer its routing assumptions or
results to the introductory model. No verified public instantaneous occupancy
measurement was found for the study sections. AADT, daily camera passages and
corridor travel times cannot by themselves supply that count.

## Attribution and reuse status

- **OSM:** retain visible “Map data © OpenStreetMap contributors · ODbL” linked to the copyright page. Preserve extract provenance and the applicable ODbL obligations when distributing map data.
- **FDOT:** credit the agency, dataset, traffic year, site/section and retrieval date beside reused values. [FDOT's GIS page](https://www.fdot.gov/statistics/gis/) supplies an as-is disclaimer. No additional blanket redistribution license is asserted here.
- **City camera analytics:** credit City of Coral Gables, intuVision and Quantela with their distinct roles. A reusable dataset license, detection coverage and accuracy guarantees have not been verified; public viewing alone is not recorded as permission to redistribute exports.
- **CGTwin:** credit the City and the indicated underlying providers when citing a snapshot; preserve timestamps and provider notices. Google/Waze redistribution and screenshot terms have not been fully audited. No provider endorsement or live integration is implied.
- **Methods/software:** QAOA, IBM learning references, Qiskit, D3, Floating UI and supplied export helpers retain their separate credits in [THIRD-PARTY-NOTICES.md](web-demo/THIRD-PARTY-NOTICES.md) and [the project credit ledger](../HACKATHON-RESOURCES.md#research-and-implementation-credit-ledger).

For any later data integration, record the selected source IDs, exact frozen
records, transformations, quality treatment and remaining assumptions with the
scenario. Both classical and quantum comparisons must use the same frozen
inputs and generated trips. Label generated traffic and what-if results as
simulation, even when measured data informs their starting conditions.

## Responsive junction illustration · runtime 66

The colored street bands are widened for screen readability. The renderer maps each model stop/exit gate to the corresponding visible crossing edges, including the complete car outline and a margin. The mapping remains continuous and ordered, preserves upstream/downstream queue headways by translation, and scales icons conservatively where the between-junction drawing is compressed. Short stop bars align with the front of waiting cars. Cars already crossing continue through the illustrated junction. This changes only the diagram: source geometry, arrival rates, model gates, queues, physics, signal transitions, forecasts and circuit remain unchanged. The rendered cars-shown count still counts centers within the viewport.
