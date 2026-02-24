import { CaseConfig, Evidence, SuspectData } from '../case.js';
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
        console.log("Generating Logic Structure...");
        const skeleton = this.structureGen.generate(config);

        console.log("Weaving Narrative...");
        const narrative = await this.storyteller.fleshOutSkeleton(skeleton);

        // Combine Skeleton + Narrative into CaseConfig

        // 1. Suspects
        this.avatarGen.resetHistory();
        const suspects: SuspectData[] = [];
        for (const id of skeleton.suspectIds) {
            const bio = narrative.suspects[id] || { name: `Unknown ${id}`, role: id, bio: "N/A", motive: "N/A", gender: "unknown", alibi: "I was somewhere else.", secrets: [] };

            const name = bio.name || `Suspect ${id}`;
            const bioText = bio.bio || "No description available.";
            const role = bio.role || "Unknown Suspect";
            const gender = bio.gender || "unknown";

            // Generate Avatar with retry
            const executeAvatarGen = () => this.avatarGen.generateAvatar(id, {
                role: role,
                gender: gender,
                description: bioText
            });

            const absoluteAvatarPath = await this.retryOperation(executeAvatarGen);

            // Convert to relative path for client consumption
            const avatarRelativePath = `avatars/${path.basename(absoluteAvatarPath)}`;

            suspects.push({
                id: id,
                name: name,
                alias: [id, name.split(' ')[0].toLowerCase()],
                avatar: avatarRelativePath,
                currentLocation: "unknown",
                isGuilty: id === skeleton.killerId,
                alibi: bio.alibi || "I was somewhere else.",
                motive: bio.motive || "Unknown motive.",
                secrets: bio.secrets || [],
                traits: ["Suspicious"]
            });
        }

        // 2. Evidence tracking
        const physicalEvidence: Record<string, string> = {};
        const keyEvidence: string[] = [];

        for (const [item, location] of Object.entries(skeleton.evidenceLocations)) {
            const isWeapon = item === skeleton.murderWeapon;
            physicalEvidence[item] = isWeapon
                ? `The murder weapon. Found in ${location}.`
                : `Suspicious item found in ${location}.`;

            keyEvidence.push(`${item} found in ${location}`);
        }

        // Populate Location tracking (Suspect -> { Time: Location })
        const locationHistory: Record<string, Record<string, string>> = {};
        skeleton.suspectIds.forEach(sid => locationHistory[sid] = {});

        skeleton.timeline.forEach(event => {
            if (locationHistory[event.actorId]) {
                locationHistory[event.actorId][event.formattedTime] = event.location;
            }
        });

        // Populate Digital Logs and Footage from Media Atmosphere
        const footage: Record<string, string> = {};
        const digitalLogs: Record<string, string> = {};

        const mediaEntries = Array.isArray(narrative.media_atmosphere)
            ? narrative.media_atmosphere
            : (narrative.media_atmosphere?.entries || []);

        mediaEntries.forEach((entry: any) => {
            const time = entry.time || entry.formattedTime; // Resilience
            if (time) {
                if (entry.footage) footage[time] = entry.footage;
                if (entry.digital_log) digitalLogs[time] = entry.digital_log;
            }
        });

        const evidence: Evidence = {
            dna: skeleton.dnaLocations,
            footage: footage,
            digital_logs: digitalLogs,
            locations: locationHistory,
            physical_evidence: physicalEvidence,
            physical_discovery: {
                "automatic": Object.keys(physicalEvidence)
            },
            all_locations: skeleton.rooms
        };

        // 3. Final Assembly
        const victimName = narrative.victim?.name || "John Doe";
        const victimBio = narrative.victim?.description || "A tragic loss.";

        const executeVictimAvatarGen = () => this.avatarGen.generateAvatar(`victim_${uuidv4()}`, {
            role: "Victim",
            gender: narrative.victim?.gender || "unknown",
            description: victimBio
        });

        const absoluteVictimAvatarPath = await this.retryOperation(executeVictimAvatarGen);

        const victimAvatarRelativePath = `avatars/${path.basename(absoluteVictimAvatarPath)}`;

        const caseTitle = narrative.title || `The Case of the ${skeleton.murderWeapon}`;
        const caseId = (narrative.title || `case_${Date.now()}`).toLowerCase().replace(/\s/g, '_');

        const caseConfig: CaseConfig = {
            id: caseId,
            name: caseTitle,
            description: narrative.intro || `Investigate the murder.`,
            victim: {
                name: victimName,
                cause: `Killed by ${skeleton.murderWeapon}`,
                description: victimBio,
                avatar: victimAvatarRelativePath
            },
            murderTime: skeleton.murderTime,
            murderLocation: skeleton.murderLocation,
            map: skeleton.map,
            evidence: evidence,
            solution: {
                killer: skeleton.killerId,
                method: `Used ${skeleton.murderWeapon} in the ${skeleton.murderLocation.replace(/_/g, ' ')} at ${skeleton.murderTime}.`,
                motive: narrative.suspects[skeleton.killerId]?.motive || "Unknown",
                timeline_summary: skeleton.timeline.reduce((acc, event) => {
                    acc[event.formattedTime] = event.description;
                    return acc;
                }, {} as any),
                key_evidence: keyEvidence
            },
            suspects: suspects,
            settings: {
                timeLimit: 1200,
                startingPoints: 50,
                difficulty: 'medium'
            },
            // Verification Metadata (Initially Unverified)
            meta: {
                generatedAt: Date.now(),
                verified: false,
                solvabilityScore: 0
            }
        };

        return caseConfig;
    }

    private async retryOperation<T>(operation: () => Promise<T>, maxRetries: number = 3, delay: number = 1000): Promise<T> {
        let lastError: any;

        for (let i = 0; i <= maxRetries; i++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                if (i < maxRetries) {
                    console.warn(`Operation failed (attempt ${i + 1}/${maxRetries + 1}). Retrying in ${delay}ms...`, error);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw lastError;
    }
}
