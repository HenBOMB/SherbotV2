import { CaseConfig, DifficultyLevel, Evidence, SuspectData } from '../case.js';
import { StructureGenerator } from './logic/StructureGenerator.js';
import { Storyteller } from './story/Storyteller.js';
import { AvatarGenerator } from './AvatarGenerator.js';
import { GeneratorConfig } from './types.js';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

export class CaseBuilder {
    private structureGen: StructureGenerator;
    private storyteller: Storyteller;
    private avatarGen: AvatarGenerator;

    constructor() {
        this.structureGen = new StructureGenerator();
        this.storyteller = new Storyteller();
        this.avatarGen = new AvatarGenerator();
    }

    async build(config: GeneratorConfig): Promise<CaseConfig> {
        console.log("🏗️  Generating Logic Structure...");
        config.onProgress?.('logic', 'Building skeleton...');
        const skeleton = this.structureGen.generate(config);

        console.log(`📖 Template: ${skeleton.templateId} | Killer: ${skeleton.killerId} | Weapon: ${skeleton.murderWeapon}`);

        console.log("✍️  Weaving Narrative...");
        config.onProgress?.('narrative', 'Weaving story...');
        const narrative = await this.storyteller.fleshOutSkeleton(skeleton);

        // ── 1. Build Suspects ────────────────────────────────────────────────
        config.onProgress?.('suspects', 'Generating avatars & bios...');
        this.avatarGen.resetHistory();
        const suspects: SuspectData[] = [];

        for (const id of skeleton.suspectIds) {
            const bio = narrative.suspects[id] ?? {
                name: `Unknown ${id}`,
                role: id,
                bio: "No record available.",
                motive: "Unknown",
                gender: "unknown",
                alibi: "Claims to have been elsewhere.",
                secrets: [],
            };

            const name = bio.name || `Suspect ${id}`;
            const bioText = bio.bio || "No description available.";
            const role = bio.role || "Unknown";
            const gender = bio.gender || "unknown";

            const executeAvatarGen = () => this.avatarGen.generateAvatar(id, {
                role,
                gender,
                description: bioText,
                seed: skeleton.seed,
                guildId: config.guildId
            });

            const absoluteAvatarPath = await this.retryOperation(executeAvatarGen);
            const avatarRelativePath = `avatars/${path.basename(absoluteAvatarPath)}`;

            // Pull psychological data from skeleton archetypes for richer trait display
            const archetype = skeleton.suspectArchetypes?.[id];

            // Find initial location from timeline
            const firstEvent = skeleton.timeline.find(e => e.actorId === id && e.action === 'move');
            const initialLocation = firstEvent?.location || 'unknown';

            suspects.push({
                id,
                name,
                alias: [id, name.split(' ')[0].toLowerCase()],
                avatar: avatarRelativePath,
                currentLocation: initialLocation,
                isGuilty: id === skeleton.killerId,
                alibi: bio.alibi || "Claims to have been elsewhere.",
                motive: bio.motive || "Unknown motive.",
                secrets: bio.secrets || [],
                traits: archetype
                    ? [archetype.psychProfile, archetype.defaultBehavior]
                    : ['Suspicious'],
            });
        }

        // ── 2. Build Evidence ────────────────────────────────────────────────
        config.onProgress?.('evidence', 'Placing clues...');
        const physicalEvidence: Record<string, string> = {};
        const keyEvidence: string[] = [];

        for (const [item, location] of Object.entries(skeleton.evidenceLocations)) {
            const isWeapon = item === skeleton.murderWeapon;
            // Use the narrative reason from the structure generator if available,
            // otherwise fall back to a generic description.
            const reason = skeleton.evidenceReasons?.[item];
            const description = isWeapon
                ? `The murder weapon. ${reason ?? `Found in ${location}.`}`
                : reason ?? `Suspicious item found in ${location}.`;

            physicalEvidence[item] = description;
            keyEvidence.push(`${item} — ${location}`);
        }

        // ── 3. Build Location History ────────────────────────────────────────
        const locationHistory: Record<string, Record<string, string>> = {};
        skeleton.suspectIds.forEach(sid => (locationHistory[sid] = {}));

        skeleton.timeline.forEach(event => {
            if (locationHistory[event.actorId]) {
                locationHistory[event.actorId][event.formattedTime] = event.location;
            }
        });

        // ── 4. Build Footage & Digital Logs ─────────────────────────────────
        const footage: Record<string, string> = {};
        const digitalLogs: Record<string, string> = {};

        const mediaEntries = Array.isArray(narrative.media_atmosphere)
            ? narrative.media_atmosphere
            : (narrative.media_atmosphere?.entries ?? []);

        mediaEntries.forEach((entry: any) => {
            const time = entry.time || entry.formattedTime;
            if (time) {
                if (entry.footage) footage[time] = entry.footage;
                if (entry.digital_log) digitalLogs[time] = entry.digital_log;
            }
        });

        const evidence: Evidence = {
            dna: skeleton.dnaLocations,
            footage,
            digital_logs: digitalLogs,
            locations: locationHistory,
            physical_evidence: physicalEvidence,
            physical_discovery: {
                automatic: Object.keys(physicalEvidence),
            },
            all_locations: skeleton.rooms,
        };

        // ── 5. Final Assembly ────────────────────────────────────────────────
        config.onProgress?.('final', 'Assembling case file...');
        const victimName = narrative.victim?.name || 'John Doe';
        const victimBio = narrative.victim?.description || 'A tragic loss.';

        const executeVictimAvatarGen = () => this.avatarGen.generateAvatar(`victim_${uuidv4()}`, {
            role: 'Victim',
            gender: narrative.victim?.gender ?? 'unknown',
            description: victimBio,
            seed: skeleton.seed,
            guildId: config.guildId
        });

        const absoluteVictimAvatarPath = await this.retryOperation(executeVictimAvatarGen);
        const victimAvatarRelativePath = `avatars/${path.basename(absoluteVictimAvatarPath)}`;

        const caseTitle = narrative.title || `The Case of the ${skeleton.murderWeapon.replace(/_/g, ' ')}`;
        const caseId = caseTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 60);

        // Build a human-readable timeline summary keyed by formatted time
        const timelineSummary = skeleton.timeline.reduce((acc, event) => {
            acc[event.formattedTime] = event.description;
            return acc;
        }, {} as Record<string, string>);

        const caseConfig: CaseConfig = {
            id: caseId,
            name: caseTitle,
            description: narrative.intro || 'Investigate the murder.',
            victim: {
                name: victimName,
                cause: `Killed by ${skeleton.murderWeapon.replace(/_/g, ' ')}`,
                description: victimBio,
                avatar: victimAvatarRelativePath,
            },
            murderTime: skeleton.murderTime,
            murderLocation: skeleton.murderLocation,
            map: skeleton.map,
            evidence,
            solution: {
                killer: skeleton.killerId,
                method: `Used ${skeleton.murderWeapon.replace(/_/g, ' ')} in the ${skeleton.murderLocation.replace(/_/g, ' ')} at ${skeleton.murderTime}.`,
                motive: narrative.suspects[skeleton.killerId]?.motive ?? 'Unknown',
                timeline_summary: timelineSummary,
                key_evidence: keyEvidence,
            },
            suspects,
            settings: {
                timeLimit: 1200,
                startingPoints: 50,
                difficulty: skeleton.difficulty ?? 'medium',
            },
            meta: {
                generatedAt: Date.now(),
                verified: false,
                solvabilityScore: 0,
                templateId: skeleton.templateId,
                seed: skeleton.seed,
            },
        };

        return caseConfig;
    }

    private async retryOperation<T>(
        operation: () => Promise<T>,
        maxRetries = 3,
        delay = 1000
    ): Promise<T> {
        let lastError: any;

        for (let i = 0; i <= maxRetries; i++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                if (i < maxRetries) {
                    console.warn(`⚠️  Operation failed (attempt ${i + 1}/${maxRetries + 1}). Retrying in ${delay}ms...`, error);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw lastError;
    }
}