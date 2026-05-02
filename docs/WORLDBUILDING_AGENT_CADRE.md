# Worldbuilding Agent Cadre

Status: living idea document / foundation-building charter
Created: 2026-04-29
Updated: 2026-04-30
Owner: Loreum contributors / creative agent experiments

## Purpose

This document tracks an emerging idea for using Hermes-style AI profiles as _actual creative contributors_ to Loreum worldbuilding projects. The central premise is that a fictional world can be synthesized more richly if a cadre of specialist agents collaborates from different disciplinary perspectives: linguistics, geology, ecology, sociodynamics, economics, cartography, religion, military history, material culture, and related fields.

The goal is not to replace authorial intent with opaque generation. The goal is to give worldbuilders a bench of expert contributors who can:

- pressure-test narrative ideas for plausibility;
- fill gaps between author-defined keystones;
- propose realistic consequences of geography, language, migration, climate, economics, and culture;
- maintain disciplinary continuity across a large fictional setting;
- produce structured artifacts that Loreum can store as entities, relationships, timeline events, lore articles, maps, and reviewable AI proposals.

## Core Vision

Loreum already aims to make AI useful by giving assistants structured access to canon: entities, relationships, timeline, lore, style guide, and storyboard. This idea extends that model from a single general assistant toward a _contributor ecology_:

1. The author defines high-level creative fixtures: map sketches, eras, peoples, languages, factions, gods, wars, migrations, narrative themes, or story constraints.
2. Specialist agents analyze those fixtures through their domain lens.
3. Where useful, agents invoke lightweight external tools or simulations to explore plausible consequences.
4. The agents propose structured updates, alternatives, contradictions, and open questions.
5. Loreum stores the accepted output as canon, rejects or archives the rest, and preserves provenance so future agents understand where claims came from.

The long-term aspiration is a workflow where the world gradually becomes a coherent, queryable, historically layered system rather than a pile of isolated lore notes.

## Foundational Development Philosophy

The contributor cadre must be developed as a capability-building program, not as a collection of impressive-sounding prompts. A profile is not a domain expert merely because its prompt says it is one. The project should assume that early contributors are **junior research assistants with structured notebooks, humility protocols, and gradually improving tool literacy**.

Core principle:

> Build contributors as slowly improving, tool-using, self-documenting collaborators; do not pretend a prompt alone creates expertise.

Implications:

- **Demonstrated capability beats aspirational prompting.** A contributor profile should gain responsibilities because it has produced useful, reviewable work in smaller exercises, not because the role description sounds sophisticated.
- **Start from acknowledged ignorance.** Each profile should explicitly track what it does not yet know, which domains require study, and which claims would be overreach.
- **Prefer primitives before orchestration.** Before asking multiple contributors to synthesize geography, migration, language, and politics together, teach each contributor to produce narrow artifacts such as checklists, assumption ledgers, glossaries, critique notes, map-layer requirements, and small domain memos.
- **Evolve profiles through retrospectives.** After every exercise, update the relevant profile with lessons learned, failure modes, missing tools, improved rubrics, and examples of good or bad output.
- **Separate authorial fixtures, canon, proposals, speculation, and exercises.** Contributor outputs should never silently become authoritative lore.
- **Treat tools as part of the profile.** A mature profile includes not just persona text, but references, candidate tools, operating procedures, verification habits, and review relationships.
- **Let self-directed learning happen inside rails.** Contributors may research, inspect examples, and propose tools, but they should record sources, assumptions, limitations, and concrete next experiments.

The early design question is therefore not “What grand worldbuilding task can this agent perform?” but:

> What small, inspectable contribution can this profile make today, and what would it need to learn before being trusted with a larger one?

## Contributor Maturity Model

Profiles should have explicit maturity levels so that tasks can be matched to demonstrated competence.

### Stage 0 — Orientation

Define the contributor's purpose, domain boundaries, non-goals, known ignorance, dangerous overreach zones, and first learning questions. At this stage the contributor should mostly ask clarifying questions, build glossaries, and identify prerequisites.

### Stage 1 — Domain Literacy

Collect primers, terminology, common models, representative examples, failure modes, and useful references. Outputs should be reading notes, checklists, glossaries, and “what to watch for” memos.

### Stage 2 — Tool and Method Discovery

Identify and test lightweight tools, data formats, workflows, and analytic methods. Outputs should include tool inventories, setup notes, smoke tests, and “what this tool can/cannot responsibly tell us.”

### Stage 3 — Output Primitives

Produce small, narrow, reviewable artifacts: assumption ledgers, plausibility checklists, constraint lists, map-layer specs, naming-rule fragments, tiny timeline proposals, critique memos, or contradiction notes.

### Stage 4 — Internal Review

Review other contributors' narrow outputs using explicit rubrics. The goal is not grand synthesis; it is detecting mismatches, hidden assumptions, overclaims, and cross-domain dependencies.

### Stage 5 — Constrained Scenario Exercises

Run deliberately small exercises that test one or two linked capabilities. Example: “Given this river valley and two settlements, identify water, transport, floodplain, and naming implications.” Avoid multi-century synthetic world histories at this stage.

### Stage 6 — Composite Workflows

Only after primitives and review habits are trustworthy should multiple contributors attempt broader synthesis across geography, migration, linguistics, economics, politics, and narrative.

### Stage 7 — Retrospective Learning

After every exercise, update the profile dossier: what worked, what failed, which sources/tools helped, what needs review, and which future tasks are now safe or still premature.

## Profile Dossier Model

Each contributor should be tracked as an evolving dossier, not just a prompt. A dossier should include:

- stable identity and role summary;
- domain scope and non-goals;
- current maturity level;
- known ignorance and danger zones;
- epistemic contract and confidence labels;
- preferred sources, references, and reading queue;
- tools, data formats, and methods it can use or wants to test;
- standard questions it asks before contributing;
- standard output primitives it can produce;
- review rubric and peer-review relationships;
- examples of good, bad, and overreaching work;
- changelog / retrospective notes;
- promotion criteria for taking on more complex tasks.

## Methodologist / Contributor Steward

The cadre likely needs a meta-contributor whose job is not to worldbuild directly, but to keep the contributor system intellectually honest.

Candidate name: **Contributor Steward / Methodologist**.

Responsibilities:

- ask whether a contributor is being asked to do something beyond its maturity level;
- maintain the profile dossier schema and maturity model;
- ensure exercises produce retrospective updates;
- distinguish canon, proposal, speculation, research notes, and training exercises;
- flag overclaiming, pseudo-rigor, missing assumptions, or tool misuse;
- propose the next smallest useful exercise for a contributor;
- keep learning, tooling, and review processes visible rather than implicit.

## Simulation and Tooling Philosophy

Simulation should be used judiciously, not fetishized. The target is _plausibility support_, not high-fidelity scientific modeling.

Good uses:

- generating candidate migration paths constrained by terrain and resource access;
- estimating how mountain ranges, rainfall shadows, rivers, and coastlines influence settlement;
- exploring likely contact zones between cultures;
- modeling language divergence, borrowing, semantic drift, or phonological change at a toy-but-disciplined level;
- deriving trade routes from geography, technology level, and political boundaries;
- finding consequences the author may not have noticed.

Bad uses:

- pretending toy models are scientific ground truth;
- letting the model overrule narrative fixtures;
- adding complexity that cannot be represented in Loreum or explained to collaborators;
- producing pseudo-rigorous numbers without assumptions, limitations, and provenance.

Every simulation-backed contribution should record:

- input assumptions;
- tool/model used;
- confidence and limitations;
- which outputs are canonical, speculative, or rejected;
- links to Loreum entities/timeline events/articles affected.

## Candidate External Tool Domains

This is intentionally broad and provisional.

- **GIS / geospatial:** QGIS, GDAL/OGR, GeoJSON, PostGIS, raster/vector workflows, spatial indexing, generated elevation/biome/river layers.
- **Procedural terrain and climate:** terrain generation, erosion approximations, hydrology, biome classification, prevailing winds, rainfall shadows.
- **Population dynamics and migration:** cellular automata, agent-based models, network diffusion, gravity models, carrying capacity approximations.
- **Linguistics:** sound change appliers, lexicon generators, phonotactics, historical linguistics tooling, semantic network/drift models, conlang documentation formats.
- **Economics/trade:** graph routing, transport cost models, resource distribution, market-center emergence, political chokepoints.
- **Sociodynamics:** faction influence networks, institutional stability, kinship/clan structures, prestige diffusion, identity formation.
- **Warfare/logistics:** route constraints, supply lines, campaign seasons, fortification placement, manpower ceilings.
- **Calendars/astronomy:** custom calendars, lunar/solar cycles, tides, eclipses, ritual calendars.
- **Knowledge representation:** provenance graphs, confidence labels, contradiction tracking, review queues, canonical/speculative status.

## Initial AI Profile Roster

These are not final prompt texts yet. They are proposed contributor archetypes to eventually turn into Hermes profiles/personas.

### 1. World Systems Architect

**Role:** Coordinates the specialist cadre and keeps the whole fictional world coherent.
**Focus:** systems thinking, dependency mapping, contradiction detection, scope control.
**Outputs:** synthesis memos, integration plans, open-question registers, canon-impact summaries.
**Useful when:** many specialists have contributed and someone needs to merge their work into a coherent whole.

### 2. Geologist / Tectonics Specialist

**Role:** Builds plausible landforms from plate history, volcanism, erosion, and geological timescales.
**Focus:** mountain ranges, basins, islands, mineral resources, earthquakes, soil parent material.
**Outputs:** geologic history sketches, resource maps, terrain plausibility notes.
**Tool prospects:** procedural plate sketches, erosion tools, GIS rasters, elevation models.

### 3. Physical Geographer / Hydrologist

**Role:** Turns terrain into rivers, watersheds, coasts, wetlands, deserts, and settlement affordances.
**Focus:** drainage basins, floodplains, navigability, rainfall shadows, coastlines, deltas.
**Outputs:** river networks, water-resource constraints, settlement suitability notes.
**Tool prospects:** DEM processing, flow accumulation, QGIS/GDAL, hydrology approximations.

### 4. Climatologist / Biome Ecologist

**Role:** Determines climate zones, seasonal patterns, biomes, crops, hazards, and ecological pressures.
**Focus:** latitude, altitude, ocean currents, monsoons, growing seasons, disease ecology.
**Outputs:** climate/biome maps, agricultural constraints, ecological consequence reports.
**Tool prospects:** simplified climate models, Koppen-like classification, raster overlays.

### 5. Historical Linguist / Conlang Evolution Specialist

**Role:** Designs language families and models divergence over time.
**Focus:** phonology, sound change, morphology, borrowing, substrate/superstrate effects, scripts.
**Outputs:** proto-language sketches, daughter language evolution notes, naming rules, etymologies.
**Tool prospects:** sound-change appliers, phonotactic generators, lexicon drift scripts.

### 6. Sociolinguist / Naming and Register Specialist

**Role:** Connects language to class, region, identity, religion, institutions, and power.
**Focus:** dialect continua, diglossia, honorifics, taboo, official vs vernacular names.
**Outputs:** naming conventions, dialect maps, register guides, cultural language notes.
**Tool prospects:** contact-zone mapping, social network diffusion approximations.

### 7. Population Dynamics / Migration Modeler

**Role:** Explores plausible movement, mixing, frontier formation, diaspora, and demographic pressure.
**Focus:** carrying capacity, routes, bottlenecks, disease, conquest, assimilation, refugee flows.
**Outputs:** migration scenarios, population mixture notes, demographic timelines.
**Tool prospects:** grid/graph simulations, agent-based models, diffusion models.

### 8. Political Anthropologist / Institution Designer

**Role:** Designs governance, legitimacy, kinship systems, law, bureaucracy, and social order.
**Focus:** chiefdoms, empires, city-states, clans, castes, councils, succession, taxation.
**Outputs:** institution profiles, succession crises, governance constraints, social contracts.
**Tool prospects:** influence networks, stability heuristics, faction graphs.

### 9. Economic Geographer / Trade Systems Analyst

**Role:** Derives trade routes, resource dependencies, market towns, monetary systems, and wealth flows.
**Focus:** transport costs, terrain, ports, caravan routes, staple goods, strategic resources.
**Outputs:** trade-route maps, resource dependency charts, economic conflict hooks.
**Tool prospects:** graph routing, least-cost path analysis, network centrality.

### 10. Military Historian / Logistics Specialist

**Role:** Evaluates warfare under the world's geography, technology, demography, and institutions.
**Focus:** supply, campaign seasons, forts, naval constraints, manpower, doctrine, war aims.
**Outputs:** plausible battle/campaign outlines, fortification maps, logistics constraints.
**Tool prospects:** route and supply models, chokepoint analysis, campaign timeline checks.

### 11. Religion / Myth / Ritual Systems Scholar

**Role:** Develops belief systems as historically embedded institutions rather than decorative pantheons.
**Focus:** ritual calendars, priesthoods, heresies, sacred geography, cosmology, mythic memory.
**Outputs:** religious histories, ritual cycles, sacred-site maps, theological conflict hooks.
**Tool prospects:** calendar tools, influence networks, pilgrimage route mapping.

### 12. Material Culture / Technology Historian

**Role:** Keeps technology, crafts, infrastructure, architecture, and daily life consistent.
**Focus:** metallurgy, textiles, foodways, roads, ships, writing media, urban form.
**Outputs:** technology trees, craft traditions, infrastructure notes, anachronism checks.
**Tool prospects:** resource/technology dependency graphs.

### 13. Archivist / Canon Curator

**Role:** Maintains provenance, canon status, contradictions, and review hygiene.
**Focus:** what is accepted canon vs draft/speculation, where ideas came from, what changed.
**Outputs:** canon diffs, contradiction reports, provenance summaries, review queue bundles.
**Useful when:** multiple agents are producing overlapping or conflicting contributions.

### 14. Narrative Integrator / Dramaturg

**Role:** Converts systemic worldbuilding consequences into story-useful material.
**Focus:** character stakes, plot pressure, themes, dramatic irony, factions as narrative engines.
**Outputs:** story hooks, scene implications, faction agendas, character conflict prompts.
**Caution:** should not erase systemic realism; should translate it into usable narrative form.

### 15. Cartographer / GIS Data Steward

**Role:** Maintains map layers and makes world geography usable in real mapping tools.
**Focus:** coordinate systems, GeoJSON layers, labels, scale, map projections, layer metadata.
**Outputs:** map layer specs, GIS export/import plans, cartographic conventions.
**Tool prospects:** QGIS, GDAL/OGR, GeoJSON, PostGIS, MBTiles/vector tiles.

### 16. Cultural Contact / Borderlands Specialist

**Role:** Studies what happens where peoples, languages, economies, and polities meet.
**Focus:** syncretism, creoles, bilingualism, intermarriage, frontier violence, trade pidgins, hybrid identities.
**Outputs:** borderland profiles, contact-zone consequences, mixed-culture entities and timelines.
**Tool prospects:** overlay of migration, trade, language, and political-boundary layers.

## Collaboration Pattern Sketch

A possible specialist workflow:

1. **Fixture intake:** Author provides non-negotiable creative constraints and desired tone.
2. **Domain passes:** Relevant specialists analyze the fixtures independently.
3. **Simulation/tool pass:** Only where useful, agents run lightweight models with explicit assumptions.
4. **Cross-review:** Specialists review each other's consequences; e.g., linguist checks migration model, economist checks terrain and roads.
5. **Synthesis:** World Systems Architect and Narrative Integrator merge findings into options.
6. **Canon review:** Archivist packages proposals for Loreum's review queue.
7. **Storage:** Accepted outputs become entities, relationships, lore articles, timeline events, maps, tags, and style-guide constraints.

## Near-Term Questions

- Should these profiles live as Hermes profiles, Loreum project contributors, MCP-facing agents, or some hybrid?
- What is the smallest useful proof-of-concept? Candidate: a map + 3 peoples + 2 migration waves + language contact consequences.
- How should Loreum represent generated geospatial layers: uploaded files, first-class map layers, entity coordinates, or external GIS exports?
- What metadata is required for simulation-backed lore so that assumptions and limitations are never lost?
- How opinionated should profiles be? Should they push back aggressively, or offer softer options?
- How do we keep the author in control while still letting specialists produce surprising consequences?
- Which simulation/tool domain should be tackled first: GIS terrain/hydrology, migration/population, or historical linguistics?

## Profile Fleshing-Out Process

The next phase should turn each archetype into a usable contributor profile. Do this in a structured way rather than writing colorful personas first. The persona matters, but only after the epistemic contract and contribution boundaries are clear.

Recommended order:

1. **Define the shared contributor contract** that every profile must obey.
2. **Create a profile specification template** so all contributors are comparable.
3. **Draft 2-3 seed profiles first**, not all 16, to validate the template.
4. **Run a small pilot scenario** and observe whether the profiles produce useful, distinct, reviewable contributions.
5. **Revise the template and shared contract** based on the pilot.
6. **Fill out the remaining roster** once the format has proven itself.
7. **Only then create concrete Hermes profiles/configs**, skills, or Loreum contributor-pack artifacts.

### Shared Contributor Contract

Every specialist profile should share these rules:

- **Authorial fixtures are sovereign.** The agent may challenge a fixture's consequences, but must not overwrite the author's premise.
- **Distinguish canon from proposal.** Outputs must label accepted canon, proposed additions, speculative alternatives, contradictions, and open questions.
- **State assumptions.** Any model, simulation, analogy, or inference must name its assumptions.
- **Prefer useful plausibility over fake precision.** Quantitative outputs are allowed, but only with clear caveats.
- **Expose tradeoffs.** When multiple plausible paths exist, the agent should explain what each path buys or costs narratively and systemically.
- **Stay in lane, but cross-reference dependencies.** A hydrologist should not invent a religion wholesale, but can flag religious implications of rivers, floods, springs, or sacred waters.
- **Produce Loreum-shaped artifacts.** Contributions should be easy to map into entities, relationships, timeline events, lore articles, maps, style guides, or review queue items.
- **Be willing to push back.** The profile should politely but firmly flag implausibilities, contradictions, or missed consequences.

### Profile Specification Template

Each profile should eventually include:

```yaml
id: short-stable-id
name: Human-readable contributor name
archetype: Domain / role label
one_line: Concise purpose statement
status: draft | active | deprecated
maturity_stage: 0-7
voice: Communication style and personality
stance: How opinionated/pushy the contributor should be
epistemic_temperament: cautious | empirical | speculative | adversarial | synthetic | archival
primary_domains:
  - Domain expertise area
secondary_domains:
  - Adjacent awareness areas
not_responsible_for:
  - Explicit boundaries
known_ignorance:
  - Domain gaps, prerequisites, missing references, or untested assumptions
danger_zones:
  - Areas where this profile is especially likely to overclaim or hallucinate
inputs_needed:
  - What the agent needs before contributing well
standard_questions:
  - Questions it should ask before attempting domain work
output_primitives:
  - Small artifacts it is currently trusted to produce
advanced_outputs:
  - Later-stage artifacts it may eventually produce
loreum_mappings:
  entities: []
  relationships: []
  timeline_events: []
  lore_articles: []
  maps: []
  style_guide: []
review_labels:
  - canon_candidate
  - contradiction
  - open_question
  - simulation_backed
  - exercise_only
confidence_labels:
  - known
  - plausible
  - speculative
  - unsupported
  - contradicted
methods:
  - Reasoning methods or analytic lenses
candidate_tools:
  - External tools or simulation classes
tool_notes:
  - Setup notes, limitations, smoke-test results, or data formats
red_lines:
  - Things this profile must not do
failure_modes:
  - Ways this profile could go wrong
reviewed_by:
  - Other contributors who should critique this profile's outputs
promotion_criteria:
  - Evidence required before this profile can take on more complex tasks
retrospective_log:
  - YYYY-MM-DD: What changed after an exercise or review
sample_prompts:
  - Example invocation appropriate to current maturity stage
sample_output_shape: Markdown/JSON/YAML outline
```

### Recommended Seed Profiles

Do not start by fleshing out all 16. Start with a triangulating trio:

1. **World Systems Architect** — establishes synthesis and coordination norms.
2. **Geologist / Physical Geographer hybrid** — validates whether geography-first contribution can be useful.
3. **Historical Linguist** — validates whether cultural/language evolution can remain disciplined and Loreum-shaped.

A strong alternate trio would be:

1. **Cartographer / GIS Data Steward**
2. **Population Dynamics / Migration Modeler**
3. **Sociolinguist / Naming and Register Specialist**

That alternate trio is better if the first pilot is explicitly map + migration + language contact.

### Profile Design Questions

For each role, answer these before writing the persona prose:

- What decisions is this contributor allowed to make?
- What decisions may it only recommend?
- What information must it ask for before proceeding?
- What assumptions may it make by default?
- What does a good contribution from this profile look like in Loreum?
- What would be overreach?
- What other profiles should review its work?
- What kinds of contradictions should it be especially alert for?
- What lightweight tools or simulations could eventually augment it?
- What should its personality feel like in conversation?

### Personality Guidance

The profiles should feel like collaborators, not RPG character gimmicks. Give them enough personality to be memorable and behaviorally distinct, but avoid turning them into caricatures.

Useful axes:

- **Epistemic temperament:** cautious, speculative, adversarial, synthetic, empirical, archival.
- **Communication style:** concise field memo, professorly explanation, design critique, Socratic questioning, annotated report.
- **Pushback level:** gentle warnings, firm objections, red-team mode.
- **Creative posture:** conservative realism, generative possibilities, narrative-first translation, systems-first consequences.

### Premature Composite Workflow Example

The following remains a useful **eventual** north-star scenario, but it should no longer be treated as an immediate pilot:

> Given a rough map, three peoples, two migration waves, and one later kingdom boundary, have the geography, migration, and linguistics contributors produce plausible consequences and review each other's outputs.

That is too high-level for the current maturity of the contributor system. It assumes we already know how to perform geography analysis, migration analysis, linguistic consequence modeling, cross-review, and synthesis. We do not yet know how to do those well enough.

Before attempting this composite workflow, the project should develop smaller prerequisites:

- a Stage 0/1 Geography or Physical Geography dossier;
- a Stage 0/1 Migration or Population Dynamics dossier;
- a Stage 0/1 Historical Linguistics dossier;
- a shared assumption ledger format;
- a confidence/canon-status labeling scheme;
- a tiny artifact format for “domain memo” and “peer critique”;
- at least one constrained exercise per contributor that can be reviewed independently.

Eventual expected artifacts from the composite workflow might include:

- a terrain/hydrology plausibility memo;
- likely migration corridors and contact zones;
- language-family divergence notes;
- naming conventions for 10-20 places;
- 5-10 proposed timeline events;
- 3-5 contradictions or open questions;
- a synthesis memo mapping everything into Loreum entities/articles/timeline events.

But these artifacts should be unlocked progressively, not demanded at the outset.

## Immediate Next Steps

- Treat this document as the living charter for the contributor-profile system.
- Draft a dedicated profile dossier template from the expanded schema above.
- Create the **Contributor Steward / Methodologist** as the first meta-profile, because it governs how all other profiles mature.
- Create Stage 0 dossiers for 2-3 seed contributors rather than fleshing out all 16.
- For each seed contributor, define known ignorance, first learning questions, output primitives, review relationships, and promotion criteria.
- Design the smallest possible constrained exercise for each seed contributor.
- After each exercise, append retrospective notes and revise the profile dossier.
- Only after several narrow exercises should the project attempt the composite map/migration/language-contact workflow.
- Define how contributor outputs map into Loreum's current data model and review queue.
- Identify candidate open-source tools for the first two tool domains, but evaluate them through smoke tests and limitations notes rather than assuming usefulness.
- Decide whether profile definitions belong in this repo, Hermes config, a separate contributor pack, or Loreum project templates.

## Change Log

- **2026-04-30:** Reframed the cadre as a gradual capability-building program. Added the foundational development philosophy, contributor maturity model, profile dossier model, Contributor Steward / Methodologist role, expanded profile schema, and warning that the map/migration/language-contact scenario is an eventual composite workflow rather than an immediate pilot.
