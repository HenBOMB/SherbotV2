import { aiService, RapidAPIService } from '../../ai-service.js';
import { CaseSkeleton } from '../types.js';

const MAX_RETRIES = 2;

export class Storyteller {
    private api: RapidAPIService;

    constructor() {
        this.api = aiService;
    }

    async fleshOutSkeleton(skeleton: CaseSkeleton): Promise<any> {
        console.log("🧩 Starting narrative generation...");

        try {
            // Build a shared "case bible" that all prompts will reference.
            // This is the key change — every character knows about every other character.
            const caseBible = this.buildCaseBible(skeleton);

            // Independent generations run in parallel
            const [basicInfo, victim, mediaAtmosphere] = await Promise.all([
                this.generateBasicInfo(skeleton, caseBible),
                this.generateVictim(skeleton, caseBible),
                this.generateLogsAndFootage(skeleton, caseBible),
            ]);
            console.log("✅ Basic info, victim, and atmosphere generated");

            // Suspects in parallel — each gets the full web of relationships
            const suspectEntries = await Promise.all(
                skeleton.suspectIds.map(async (suspectId) => {
                    const isKiller = suspectId === skeleton.killerId;
                    const data = await this.generateSuspect(skeleton, suspectId, isKiller, caseBible);
                    console.log(`✅ Suspect '${suspectId}' generated`);
                    return [suspectId, data] as const;
                })
            );
            const suspects = Object.fromEntries(suspectEntries);

            // Locations in parallel — each gets evidence context so descriptions feel purposeful
            const locationEntries = await Promise.all(
                skeleton.rooms.map(async (roomId) => {
                    const description = await this.generateLocation(skeleton, roomId, caseBible);
                    console.log(`✅ Location '${roomId}' generated`);
                    return [roomId, description] as const;
                })
            );
            const location_descriptions = Object.fromEntries(locationEntries);

            return {
                title: basicInfo.title,
                intro: basicInfo.intro,
                victim,
                suspects,
                location_descriptions,
                media_atmosphere: mediaAtmosphere,
            };

        } catch (e) {
            console.error("Storyteller failed:", e);
            throw new Error("Failed to generate narrative via AI.");
        }
    }

    // ── Case Bible ─────────────────────────────────────────────────────────
    // A compact structured summary passed into every prompt so the AI can
    // write characters that refer to each other, have consistent histories,
    // and create real contradictions in their alibis.
    private buildCaseBible(skeleton: CaseSkeleton): string {
        const relationships = skeleton.relationships ?? [];
        const archetypes = skeleton.suspectArchetypes ?? {};
        const evidenceReasons = skeleton.evidenceReasons ?? {};

        const relationshipSummary = relationships
            .map(r => `  • ${r.a} ↔ ${r.b}: ${r.dynamic} [tension: ${r.tensionLevel}]`)
            .join('\n');

        const suspectSummary = skeleton.suspectIds
            .map(id => {
                const arch = archetypes[id];
                if (!arch) return `  • ${id}`;
                const isKiller = id === skeleton.killerId ? ' ★ KILLER' : '';
                return `  • ${id}${isKiller}: ${arch.psychProfile}. Under pressure: ${arch.defaultBehavior}. Nervous tell: ${arch.nervousTell}. Secret category: ${arch.likelySecretCategory}.`;
            })
            .join('\n');

        const evidenceSummary = Object.entries(evidenceReasons)
            .map(([item, reason]) => {
                const location = skeleton.evidenceLocations[item] ?? 'unknown';
                return `  • ${item} (in ${location}): ${reason}`;
            })
            .join('\n');

        return `
=== CASE BIBLE ===
TEMPLATE: ${skeleton.templateId ?? 'unknown'}
THEME: ${skeleton.theme}
DIFFICULTY: ${skeleton.difficulty}
MOTIVE CATEGORY: ${skeleton.motiveCategory ?? 'unknown'}

VICTIM ROLE: ${skeleton.victimId}
KILLER ROLE: ${skeleton.killerId} (keep this secret — never state it directly)
MURDER: ${skeleton.murderWeapon} in the ${skeleton.murderLocation} at ${skeleton.murderTime}

SUSPECTS:
${suspectSummary}

RELATIONSHIP WEB:
${relationshipSummary}

EVIDENCE AND WHY IT EXISTS:
${evidenceSummary}

RULES FOR ALL AI OUTPUT:
- Every character must feel like a real person with history, not a role-playing archetype.
- Names should be culturally specific and memorable — avoid generic names like "John Smith".
- Alibis must be specific: times, places, people who can corroborate (or almost corroborate).
- Suspects must reference each other by name in their statements — they know each other.
- The killer's alibi should have exactly ONE subtle crack that sharp investigation can expose.
- Innocent suspects' secrets should be embarrassing or professionally damaging, but unrelated to the murder.
- Write in a literary, noir-adjacent tone — specific sensory details, not bland summaries.
===================
`;
    }

    // ── Media Atmosphere ───────────────────────────────────────────────────
    private async generateLogsAndFootage(skeleton: CaseSkeleton, caseBible: string) {
        const timelineStr = skeleton.timeline
            .map(e => `${e.formattedTime} | ${e.actorId} | ${e.action} | ${e.location}`)
            .join('\n');

        const prompt = `
${caseBible}

TASK: Write atmospheric security footage descriptions and digital log entries for each timeline event.

TIMELINE:
${timelineStr}

GUIDELINES:
- Footage descriptions: grainy, imperfect, atmospheric. Note what the camera CANNOT see as much as what it can. 
  Include body language, partial obstructions, lighting conditions.
- Digital logs: be specific — keycard IDs, motion sensor zones, elevator call buttons, system anomalies.
  Where logs are missing, give a plausible technical reason (sensor fault, deliberate disabling, blind spot).
- The gap around the murder time (${skeleton.murderTime}) should feel ominous — a camera that cuts out, 
  a sensor that malfunctions, a log entry that gets overwritten.
- Character names should match names you'd assign in the case (use role names if no names yet).

OUTPUT JSON:
{
    "entries": [
        {
            "time": "HH:MM",
            "footage": "Specific atmospheric camera description (2-3 sentences)",
            "digital_log": "Precise system log entry or reason for absence"
        }
    ]
}
`;
        return this.fetchJson(prompt, skeleton.seed, skeleton.guildId);
    }

    // ── Basic Info ─────────────────────────────────────────────────────────
    private async generateBasicInfo(skeleton: CaseSkeleton, caseBible: string) {
        const prompt = `
${caseBible}

TASK: Generate the case title and opening monologue for a murder mystery.

GUIDELINES:
- Title: Specific, evocative, noir-influenced. Not generic ("Death in the Dark" is bad; 
  "The Weight of the ${skeleton.murderWeapon.replace(/_/g, ' ')}" is better). 
  Should hint at the setting or relationship dynamic without spoiling the killer.
- Intro: First-person, detective's voice. Arrive at the scene cold. 
  Describe one specific sensory detail (smell, sound, texture). 
  Reference the victim's role and the space without melodrama. 
  End on an observation that makes the reader lean forward. 3-4 sentences.

OUTPUT JSON:
{
    "title": "The case title",
    "intro": "Detective's opening monologue, 3-4 sentences"
}
`;
        return this.fetchJson(prompt, skeleton.seed, skeleton.guildId);
    }

    // ── Victim ─────────────────────────────────────────────────────────────
    private async generateVictim(skeleton: CaseSkeleton, caseBible: string) {
        const prompt = `
${caseBible}

TASK: Create the murder victim's profile.

VICTIM ROLE: ${skeleton.victimId}

GUIDELINES:
- Name: Culturally specific and memorable. Should feel like a real person in this world.
- Gender: Choose what fits the setting.
- Description: Who were they really — not just professionally, but personally? 
  What did people say about them when they weren't in the room? 
  Include at least one quality that made them genuinely difficult to deal with, 
  and one that made people genuinely mourn them. 2-3 sentences.
- The relationships in the case bible should feel like they emerged naturally from this person's personality.

OUTPUT JSON:
{
    "name": "Full Name",
    "gender": "male | female | nonbinary",
    "description": "Rich character description (2-3 sentences)"
}
`;
        return this.fetchJson(prompt, skeleton.seed, skeleton.guildId);
    }

    // ── Suspect ────────────────────────────────────────────────────────────
    private async generateSuspect(
        skeleton: CaseSkeleton,
        suspectId: string,
        isKiller: boolean,
        caseBible: string
    ) {
        const archetype = skeleton.suspectArchetypes?.[suspectId];
        const relevantRelationships = (skeleton.relationships ?? [])
            .filter(r => r.a === suspectId || r.b === suspectId)
            .map(r => {
                const other = r.a === suspectId ? r.b : r.a;
                return `  - With ${other}: ${r.dynamic}`;
            })
            .join('\n');

        const killerGuidance = isKiller
            ? `THIS SUSPECT IS THE KILLER. Their alibi must sound plausible but contain exactly one specific, 
               subtle inconsistency — a time that doesn't quite add up, a witness who can only half-confirm, 
               or a detail they shouldn't know unless they were there. 
               Their motive must be deeply personal — rooted in the relationship history above.
               Their secrets, when uncovered, should form a logical chain leading to guilt.`
            : `THIS SUSPECT IS INNOCENT but has reasons to appear guilty.
               Their secrets are embarrassing or professionally damaging but completely unrelated to the murder.
               Their alibi is true but they have reasons to be cagey about it (embarrassment, illegal but harmless activity, etc.).
               They may reference the killer by name in a way that seems incriminating but is actually innocent.`;

        const prompt = `
${caseBible}

TASK: Write a full suspect profile for: ${suspectId}

ARCHETYPE:
- Psychological profile: ${archetype?.psychProfile ?? 'determined'}
- Under pressure they: ${archetype?.defaultBehavior ?? 'become defensive'}
- Nervous tell: ${archetype?.nervousTell ?? 'fidgets'}
- Secret category: ${archetype?.likelySecretCategory ?? 'personal'}

THEIR RELATIONSHIPS:
${relevantRelationships || '  (none specified)'}

MURDER CONTEXT: ${skeleton.murderWeapon} in ${skeleton.murderLocation} at ${skeleton.murderTime}

${killerGuidance}

SECRETS GUIDANCE:
- Secret 1 (surface): Something that makes them look suspicious but is innocent — 
  triggered when player mentions ${archetype?.likelySecretCategory?.split('_')[0] ?? 'money'} or related keywords.
- Secret 2 (deep): Something more damning that requires real pressure — 
  for the killer: this directly implicates them. For innocents: deeply embarrassing but exculpatory.

OUTPUT JSON:
{
    "name": "Full culturally specific name",
    "gender": "male | female | nonbinary",
    "role": "Their actual job/relationship to the victim (specific, not just the role ID)",
    "bio": "2-sentence backstory. Specific history, not generic. Reference the setting and relationships.",
    "motive": "The specific, personal reason they might have done it — rooted in the relationship history",
    "alibi": "Precise account: exact time, exact location, exactly who else was present or why they were alone. For the killer: one subtle crack built in.",
    "secrets": [
        {
            "id": "${suspectId}_surface_secret",
            "text": "The surface secret — embarrassing or suspicious but ultimately innocent or revealing",
            "trigger": {
                "keywords": ["keyword1", "keyword2", "keyword3"],
                "minPressure": 20
            }
        },
        {
            "id": "${suspectId}_deep_secret",
            "text": "The deep secret — for killers this implicates them directly; for innocents this is their most vulnerable truth",
            "trigger": {
                "keywords": ["keyword1", "keyword2", "keyword3", "keyword4"],
                "minPressure": 45
            }
        }
    ]
}
`;
        return this.fetchJson(prompt, skeleton.seed, skeleton.guildId);
    }

    // ── Location ───────────────────────────────────────────────────────────
    private async generateLocation(skeleton: CaseSkeleton, roomId: string, caseBible: string): Promise<string> {
        // Gather which evidence exists here and which suspects were here
        const evidenceHere = Object.entries(skeleton.evidenceLocations)
            .filter(([, loc]) => loc === roomId)
            .map(([item]) => item);

        const dnaHere = skeleton.dnaLocations?.[roomId] ?? [];
        const isMurderScene = roomId === skeleton.murderLocation;

        const prompt = `
${caseBible}

TASK: Write an atmospheric description of: ${roomId.replace(/_/g, ' ')}

CONTEXT:
- Is this the murder scene? ${isMurderScene ? 'YES' : 'No'}
- Evidence found here: ${evidenceHere.length > 0 ? evidenceHere.join(', ') : 'none specific'}
- People whose presence has been detected here: ${dnaHere.join(', ') || 'unknown'}

GUIDELINES:
- Write in second person ("You step into...") for immersion.
- 2-3 sentences. Lead with one specific sensory detail (what you smell, hear, or feel — not just see).
- If this is the murder scene, let the violence be implied through the state of the room, not stated.
- If evidence is present here, describe the room in a way that makes those items feel like they belong — 
  don't name them directly, but make the room feel like their natural habitat.
- The room should feel like it holds secrets without saying so.

OUTPUT JSON:
{
    "description": "Immersive room description (2-3 sentences, second person)"
}
`;
        const res = await this.fetchJson(prompt, skeleton.seed, skeleton.guildId);
        return res?.description ?? "You step into a room that feels wrong in ways you can't immediately name.";
    }

    // ── JSON Fetching ──────────────────────────────────────────────────────
    private async fetchJson(prompt: string, seed: string, guildId?: string, attempt = 0): Promise<any> {
        try {
            const raw = await this.api.generateText(
                "You are a backend JSON API for a noir murder mystery game. Output ONLY valid JSON. No markdown, no explanation, no code fences. Be creative, specific, and literary within the JSON values.",
                prompt,
                { caseId: seed, suspectId: 'system_storyteller', guildId }
            );

            const cleaned = raw
                .replace(/^```(?:json)?\s*/i, '')
                .replace(/\s*```$/, '')
                .trim();

            try {
                return JSON.parse(cleaned);
            } catch (_) { }

            const extracted = this.extractFirstJson(cleaned);
            if (extracted !== null) return extracted;

            throw new Error("No valid JSON found in LLM response");

        } catch (e) {
            if (attempt < MAX_RETRIES) {
                console.warn(`⚠️  JSON parse failed (attempt ${attempt + 1}/${MAX_RETRIES}), retrying...`);
                return this.fetchJson(prompt, seed, guildId, attempt + 1);
            }
            console.error("❌ fetchJson exhausted retries:", e);
            return {};
        }
    }

    private extractFirstJson(text: string): any | null {
        for (const [open, close] of [['{', '}'], ['[', ']']]) {
            const start = text.indexOf(open);
            if (start === -1) continue;

            let depth = 0;
            for (let i = start; i < text.length; i++) {
                if (text[i] === open) depth++;
                if (text[i] === close) depth--;
                if (depth === 0) {
                    try {
                        return JSON.parse(text.substring(start, i + 1));
                    } catch (_) {
                        break;
                    }
                }
            }
        }
        return null;
    }
}