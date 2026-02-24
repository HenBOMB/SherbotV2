import { aiService, RapidAPIService } from '../../ai-service.js';
import { CaseSkeleton } from '../types.js';

export class Storyteller {
    private api: RapidAPIService;

    constructor() {
        this.api = aiService;
    }

    async fleshOutSkeleton(skeleton: CaseSkeleton): Promise<any> {
        console.log("🧩 Starting sequential narrative generation...");

        try {
            // 1. Generate Title & Intro
            const basicInfo = await this.generateBasicInfo(skeleton);
            console.log("✅ Title & Intro generated");

            // 2. Generate Victim Details
            const victim = await this.generateVictim(skeleton);
            console.log("✅ Victim details generated");

            // 3. Generate Suspects (One by one)
            const suspects: Record<string, any> = {};
            for (const suspectId of skeleton.suspectIds) {
                const role = suspectId === skeleton.killerId ? 'Killer' : 'Suspect'; // Internal hint used for prompting
                suspects[suspectId] = await this.generateSuspect(skeleton, suspectId, role);
                console.log(`✅ Suspect '${suspectId}' generated`);
            }

            // 4. Generate Locations (One by one or batched if small)
            const locationDescriptions: Record<string, string> = {};
            for (const roomId of skeleton.rooms) {
                locationDescriptions[roomId] = await this.generateLocation(skeleton, roomId);
                console.log(`✅ Location '${roomId}' generated`);
            }

            // 5. Generate Atmospheric Logs & Footage
            console.log("🧩 Generating atmosphere for logs and footage...");
            const mediaAtmosphere = await this.generateLogsAndFootage(skeleton);
            console.log("✅ Media atmosphere generated");

            return {
                title: basicInfo.title,
                intro: basicInfo.intro,
                victim: victim,
                suspects: suspects,
                location_descriptions: locationDescriptions,
                media_atmosphere: mediaAtmosphere
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
            "intro": "short atmospheric (simple language) paragraph first person, from the perspective of the detective"
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

    private async generateSuspect(skeleton: CaseSkeleton, suspectId: string, roleHint: string) {
        const prompt = `
        TASK: Create a suspect profile for a murder mystery game.
        CONTEXT:
        - Theme: ${skeleton.theme}
        - Suspect ID: ${suspectId}
        - Victim: ${skeleton.victimId}
        - Location of murder: ${skeleton.murderLocation}
        - Time of murder: ${skeleton.murderTime}
        - Murder Weapon: ${skeleton.murderWeapon}
        ${roleHint === 'Killer' ? '- NOTE: This person is the KILLER. Ensure their motive and secrets reflect this.' : ''}

        OUTPUT JSON:
        {
            "name": "Full Name",
            "gender": "male | female | nonbinary",
            "role": "Connection to victim (e.g. gardener, rival)",
            "bio": "Short backstory",
            "motive": "Deep reason they might have done it",
            "alibi": "Their story of where they were at ${skeleton.murderTime}. If killer, they should have a plausible lie.",
            "secrets": [
                {
                    "id": "short_id",
                    "text": "The hidden truth about this suspect (e.g. a secret affair, an old debt, a stolen item).",
                    "trigger": {
                        "keywords": ["keyword1", "keyword2"],
                        "minPressure": 25
                    }
                },
                {
                    "id": "deep_secret",
                    "text": "A more damaging secret that requires more investigation.",
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

    private async generateLocation(skeleton: CaseSkeleton, roomId: string) {
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
        return res?.description || "A dark room.";
    }

    private async fetchJson(prompt: string): Promise<any> {
        const jsonStr = await this.api.generateText(
            "You are a backend JSON API. Output ONLY valid JSON. Do not include markdown formatting.",
            prompt
        );

        // Clean up potentially dirty JSON (e.g. markdown blocks)
        let cleanJson = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();

        // Find all JSON-like objects in the string
        const objects: any[] = [];
        let braceCount = 0;
        let startIdx = -1;

        for (let i = 0; i < cleanJson.length; i++) {
            if (cleanJson[i] === '{') {
                if (braceCount === 0) startIdx = i;
                braceCount++;
            } else if (cleanJson[i] === '}') {
                braceCount--;
                if (braceCount === 0 && startIdx !== -1) {
                    const objStr = cleanJson.substring(startIdx, i + 1);
                    try {
                        objects.push(JSON.parse(objStr));
                    } catch (e) {
                        // Attempt a simple repair for common small errors
                        try {
                            objects.push(JSON.parse(objStr + '}'));
                        } catch (e2) { }
                    }
                }
            }
        }

        if (objects.length === 0) {
            // Fallback for array-wrapped JSON if not caught by manual brace matching
            if (cleanJson.startsWith('[') && cleanJson.endsWith(']')) {
                try {
                    return JSON.parse(cleanJson);
                } catch (e) { }
            }
            return {};
        }

        // If multiple objects found, merge them (first one wins for top-level keys)
        if (objects.length > 1) {
            console.log(`⚠️  Merged ${objects.length} JSON fragments from LLM response.`);
            const merged = {};
            for (const obj of objects) {
                Object.assign(merged, obj);
                // Special case for secrets array - append them instead of overwrite
                if (obj.secrets && Array.isArray(obj.secrets)) {
                    if (!(merged as any).secrets) (merged as any).secrets = [];
                    (merged as any).secrets = [...(merged as any).secrets, ...obj.secrets];
                }
            }
            return merged;
        }

        return objects[0];
    }
}
