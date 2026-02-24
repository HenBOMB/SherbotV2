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
            // Run independent generations in parallel
            const [basicInfo, victim, mediaAtmosphere] = await Promise.all([
                this.generateBasicInfo(skeleton),
                this.generateVictim(skeleton),
                this.generateLogsAndFootage(skeleton),
            ]);
            console.log("✅ Basic info, victim, and atmosphere generated");

            // Suspects in parallel
            const suspectEntries = await Promise.all(
                skeleton.suspectIds.map(async (suspectId) => {
                    const isKiller = suspectId === skeleton.killerId;
                    const data = await this.generateSuspect(skeleton, suspectId, isKiller);
                    console.log(`✅ Suspect '${suspectId}' generated`);
                    return [suspectId, data] as const;
                })
            );
            const suspects = Object.fromEntries(suspectEntries);

            // Locations in parallel
            const locationEntries = await Promise.all(
                skeleton.rooms.map(async (roomId) => {
                    const description = await this.generateLocation(skeleton, roomId);
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

    private async generateLogsAndFootage(skeleton: CaseSkeleton) {
        const prompt = `
        TASK: Create atmospheric descriptions for security footage and digital logs based on the case timeline.
        CONTEXT:
        - Theme: ${skeleton.theme}
        - Timeline: ${JSON.stringify(skeleton.timeline.map(e => ({ time: e.formattedTime, actor: e.actorId, action: e.action, loc: e.location })))}

        For each event in the timeline, create:
        1. A "footage" entry: Description of what a grainy security camera would see.
        2. A "digital_log" entry: A system log (e.g. keycard access, motion sensor) or a reason why there ISN'T a log (e.g. "Sensor malfunction").

        OUTPUT JSON:
        {
            "entries": [
                {
                    "time": "HH:MM",
                    "footage": "Atmospheric camera description",
                    "digital_log": "Technical system log"
                }
            ]
        }
        `;
        return this.fetchJson(prompt);
    }

    private async generateBasicInfo(skeleton: CaseSkeleton) {
        const prompt = `
        TASK: Generate a Title and Intro for a murder mystery.
        CONTEXT:
        - Theme: ${skeleton.theme}
        - Murder Weapon: ${skeleton.murderWeapon}
        - Location: ${skeleton.rooms[0]}

        OUTPUT JSON:
        {
            "title": "catchy title",
            "intro": "short atmospheric paragraph in first person, from the detective's perspective"
        }
        `;
        return this.fetchJson(prompt);
    }

    private async generateVictim(skeleton: CaseSkeleton) {
        const prompt = `
        TASK: Describe the murder victim.
        CONTEXT:
        - Theme: ${skeleton.theme}
        - ID: ${skeleton.victimId}

        OUTPUT JSON:
        {
            "name": "Full Name",
            "description": "Personality and background"
        }
        `;
        return this.fetchJson(prompt);
    }

    private async generateSuspect(skeleton: CaseSkeleton, suspectId: string, isKiller: boolean) {
        // Behavioral framing instead of explicit "KILLER" label
        const killerGuidance = isKiller
            ? `- This suspect has a strong concealed motive and their alibi contains subtle inconsistencies.
               - Their secrets, if uncovered, directly implicate them in the crime.`
            : `- This suspect has a motive and suspicious behavior but is ultimately innocent.
               - Their secrets are embarrassing or incriminating on the surface, but unrelated to the murder.`;

        const prompt = `
        TASK: Create a suspect profile for a murder mystery game.
        CONTEXT:
        - Theme: ${skeleton.theme}
        - Suspect ID: ${suspectId}
        - Victim: ${skeleton.victimId}
        - Location of murder: ${skeleton.murderLocation}
        - Time of murder: ${skeleton.murderTime}
        - Murder Weapon: ${skeleton.murderWeapon}
        ${killerGuidance}

        OUTPUT JSON:
        {
            "name": "Full Name",
            "gender": "male | female | nonbinary",
            "role": "Connection to victim (e.g. gardener, rival)",
            "bio": "Short backstory",
            "motive": "Deep reason they might have done it",
            "alibi": "Their account of where they were at ${skeleton.murderTime}",
            "secrets": [
                {
                    "id": "short_id",
                    "text": "A hidden truth about this suspect",
                    "trigger": {
                        "keywords": ["keyword1", "keyword2"],
                        "minPressure": 25
                    }
                },
                {
                    "id": "deep_secret",
                    "text": "A more damaging secret requiring deeper investigation",
                    "trigger": {
                        "keywords": ["keyword1", "keyword2", "keyword3"],
                        "minPressure": 40
                    }
                }
            ]
        }
        `;
        return this.fetchJson(prompt);
    }

    private async generateLocation(skeleton: CaseSkeleton, roomId: string): Promise<string> {
        const prompt = `
        TASK: Describe a room in a murder mystery.
        CONTEXT:
        - Theme: ${skeleton.theme}
        - Room: ${roomId}
        - Mood: Suspicious/Dark

        OUTPUT JSON:
        {
            "description": "Atmospheric visual description of the room"
        }
        `;
        const res = await this.fetchJson(prompt);
        return res?.description ?? "A dimly lit room shrouded in silence.";
    }

    private async fetchJson(prompt: string, attempt = 0): Promise<any> {
        try {
            const raw = await this.api.generateText(
                "You are a backend JSON API. Output ONLY valid JSON with no markdown, no explanation, no code fences.",
                prompt
            );

            // Strip markdown fences if present
            const cleaned = raw
                .replace(/^```(?:json)?\s*/i, '')
                .replace(/\s*```$/, '')
                .trim();

            // Fast path: direct parse
            try {
                return JSON.parse(cleaned);
            } catch (_) { }

            // Extract first valid JSON object or array
            const extracted = this.extractFirstJson(cleaned);
            if (extracted !== null) return extracted;

            throw new Error("No valid JSON found in LLM response");

        } catch (e) {
            if (attempt < MAX_RETRIES) {
                console.warn(`⚠️  JSON parse failed (attempt ${attempt + 1}/${MAX_RETRIES}), retrying...`);
                return this.fetchJson(prompt, attempt + 1);
            }
            console.error("❌ fetchJson exhausted retries:", e);
            return {};
        }
    }

    private extractFirstJson(text: string): any | null {
        // Try objects first, then arrays
        for (const [open, close] of [['{', '}'], ['[', ']']]) {
            const start = text.indexOf(open);
            if (start === -1) continue;

            let depth = 0;
            for (let i = start; i < text.length; i++) {
                if (text[i] === open) depth++;
                else if (text[i] === close) depth--;

                if (depth === 0) {
                    try {
                        return JSON.parse(text.substring(start, i + 1));
                    } catch (_) {
                        break; // Malformed — stop trying this bracket type
                    }
                }
            }
        }
        return null;
    }
}