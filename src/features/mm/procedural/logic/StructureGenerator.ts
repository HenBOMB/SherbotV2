import { CaseSkeleton, GeneratorConfig, TimelineEvent } from '../types.js';

interface CaseTemplate {
    victimRole: string;
    killerRole: string;
    suspectRoles: string[];
    locations: string[];
    mapConnections: Record<string, string[]>;
    weaponType: string;
    motiveCategory: string;
}

export class StructureGenerator {
    private templates: CaseTemplate[] = [
        {
            victimRole: 'shopkeeper',
            killerRole: 'apprentice',
            suspectRoles: ['apprentice', 'customer', 'rival', 'landlord'],
            locations: ['shop', 'back_room', 'street', 'alley'],
            mapConnections: {
                "shop": ["back_room", "street"],
                "back_room": ["shop", "alley"],
                "street": ["shop", "alley"],
                "alley": ["back_room", "street"]
            },
            weaponType: 'blunt_object',
            motiveCategory: 'greed'
        },
        {
            victimRole: 'professor',
            killerRole: 'colleague',
            suspectRoles: ['colleague', 'student', 'janitor', 'dean'],
            locations: ['lecture_hall', 'office', 'laboratory', 'hallway', 'parking_lot'],
            mapConnections: {
                "lecture_hall": ["hallway"],
                "office": ["hallway", "laboratory"],
                "laboratory": ["office", "hallway"],
                "hallway": ["lecture_hall", "office", "laboratory", "parking_lot"],
                "parking_lot": ["hallway"]
            },
            weaponType: 'poison',
            motiveCategory: 'jealousy'
        },
        {
            victimRole: 'heir',
            killerRole: 'butler',
            suspectRoles: ['butler', 'sibling', 'lawyer', 'spouse'],
            locations: ['dining_room', 'library', 'study', 'garden', 'kitchen'],
            mapConnections: {
                "dining_room": ["kitchen", "library"],
                "library": ["dining_room", "study"],
                "study": ["library", "garden"],
                "garden": ["study", "kitchen"],
                "kitchen": ["dining_room", "garden"]
            },
            weaponType: 'sharp_object',
            motiveCategory: 'revenge'
        },
        {
            victimRole: 'ceo',
            killerRole: 'assistant',
            suspectRoles: ['assistant', 'partner', 'competitor', 'investor'],
            locations: ['office', 'conference_room', 'elevator', 'parking_garage', 'lobby'],
            mapConnections: {
                "office": ["conference_room", "elevator"],
                "conference_room": ["office", "lobby"],
                "elevator": ["office", "lobby", "parking_garage"],
                "lobby": ["conference_room", "elevator"],
                "parking_garage": ["elevator"]
            },
            weaponType: 'firearm',
            motiveCategory: 'blackmail'
        },
        {
            victimRole: 'artist',
            killerRole: 'patron',
            suspectRoles: ['patron', 'rival_artist', 'gallery_owner', 'critic'],
            locations: ['gallery', 'studio', 'storage', 'street', 'cafe'],
            mapConnections: {
                "gallery": ["studio", "street"],
                "studio": ["gallery", "storage"],
                "storage": ["studio", "street"],
                "street": ["gallery", "storage", "cafe"],
                "cafe": ["street"]
            },
            weaponType: 'blunt_object',
            motiveCategory: 'envy'
        }
    ];

    private weapons = {
        blunt_object: ['heavy_statue', 'candlestick', 'wrench', 'trophy', 'paperweight'],
        sharp_object: ['letter_opener', 'knife', 'scissors', 'glass_shard', 'sword'],
        poison: ['arsenic', 'cyanide', 'poisoned_drink', 'toxic_injection', 'contaminated_food'],
        firearm: ['pistol', 'revolver'],
        other: ['rope', 'pillow', 'electric_shock']
    };

    private seededRandom(seed: string, min: number, max: number): number {
        // Simple deterministic pseudo-random using seed
        let hash = 0;
        for (let i = 0; i < seed.length; i++) {
            hash = ((hash << 5) - hash) + seed.charCodeAt(i);
            hash = hash & hash;
        }
        const normalized = Math.abs(Math.sin(hash)) * 10000;
        return Math.floor((normalized % (max - min + 1)) + min);
    }

    private shuffleArray<T>(array: T[], seed: string): T[] {
        const arr = [...array];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = this.seededRandom(seed + i, 0, i);
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    private generateTimeline(
        template: CaseTemplate,
        killerId: string,
        victimId: string,
        murderLocation: string,
        murderWeapon: string,
        difficulty: string,
        seed: string
    ) {
        const timeline: TimelineEvent[] = [];
        const suspects = template.suspectRoles;
        const locations = template.locations;

        // Base time offset (randomized start time)
        const startHour = this.seededRandom(seed + 'start', 20, 23);
        const murderMinute = this.seededRandom(seed + 'murder', 20, 50);

        const formatTime = (minutes: number) => {
            const totalMinutes = startHour * 60 + minutes;
            const h = Math.floor(totalMinutes / 60) % 24;
            const m = totalMinutes % 60;
            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        };

        let currentTime = 0;

        // Initial positions for all actors
        suspects.forEach((sid, idx) => {
            timeline.push({
                time: currentTime,
                formattedTime: formatTime(currentTime),
                actorId: sid,
                action: "move",
                location: locations[idx % locations.length],
                description: `${sid} is in the ${locations[idx % locations.length]}.`
            });
        });

        timeline.push({
            time: currentTime,
            formattedTime: formatTime(currentTime),
            actorId: victimId,
            action: "move",
            location: locations[0],
            description: `${victimId} arrives at the ${locations[0]}.`
        });

        // Add suspect movements before murder
        const preMurderEvents = difficulty === 'hard' ? 8 : difficulty === 'medium' ? 5 : 3;

        for (let i = 0; i < preMurderEvents; i++) {
            currentTime += this.seededRandom(seed + 'interval' + i, 3, 10);
            const suspect = suspects[this.seededRandom(seed + 'suspect' + i, 0, suspects.length - 1)];
            const location = locations[this.seededRandom(seed + 'loc' + i, 0, locations.length - 1)];

            timeline.push({
                time: currentTime,
                formattedTime: formatTime(currentTime),
                actorId: suspect,
                action: "move",
                location: location,
                description: `${suspect} enters the ${location}.`
            });
        }

        // Victim moves to murder location
        currentTime = murderMinute - 5;
        timeline.push({
            time: currentTime,
            formattedTime: formatTime(currentTime),
            actorId: victimId,
            action: "move",
            location: murderLocation,
            description: `${victimId} goes to the ${murderLocation}.`
        });

        // THE MURDER
        currentTime = murderMinute;
        timeline.push({
            time: currentTime,
            formattedTime: formatTime(currentTime),
            actorId: killerId,
            action: "kill",
            location: murderLocation,
            target: victimId,
            description: `${killerId} kills ${victimId} with ${murderWeapon}.`
        });

        // Killer's escape
        const escapeLocation = this.selectEscapeRoute(template.mapConnections, murderLocation, seed);
        currentTime += this.seededRandom(seed + 'escape', 3, 7);
        timeline.push({
            time: currentTime,
            formattedTime: formatTime(currentTime),
            actorId: killerId,
            action: "leave",
            location: escapeLocation,
            description: `${killerId} flees to the ${escapeLocation}.`
        });

        // Sort by time
        timeline.sort((a, b) => a.time - b.time);

        return {
            timeline,
            murderTime: formatTime(murderMinute)
        };
    }

    private selectEscapeRoute(map: Record<string, string[]>, murderLocation: string, seed: string): string {
        const connectedRooms = map[murderLocation] || [];
        if (connectedRooms.length === 0) return murderLocation;
        return connectedRooms[this.seededRandom(seed + 'escape_route', 0, connectedRooms.length - 1)];
    }

    private generateEvidence(
        template: CaseTemplate,
        murderLocation: string,
        murderWeapon: string,
        killerId: string,
        victimId: string,
        difficulty: string,
        seed: string
    ) {
        const evidenceLocations: Record<string, string> = {
            [murderWeapon]: murderLocation
        };

        // Add difficulty-based red herrings
        const herringCount = difficulty === 'easy' ? 1 : difficulty === 'medium' ? 2 : 3;
        const herringTypes = ['torn_note', 'mysterious_photo', 'strange_receipt', 'unidentified_key', 'cryptic_message'];

        for (let i = 0; i < herringCount; i++) {
            const herring = herringTypes[this.seededRandom(seed + 'herring' + i, 0, herringTypes.length - 1)];
            const location = template.locations[this.seededRandom(seed + 'herring_loc' + i, 0, template.locations.length - 1)];
            evidenceLocations[herring + '_' + i] = location;
        }

        return evidenceLocations;
    }

    private generateDNA(
        template: CaseTemplate,
        murderLocation: string,
        killerId: string,
        victimId: string,
        timeline: any[],
        difficulty: string,
        seed: string
    ) {
        const dnaLocations: Record<string, string[]> = {};

        // Track who was where based on timeline
        timeline.forEach(event => {
            if (event.action === "move" || event.action === "kill") {
                if (!dnaLocations[event.location]) {
                    dnaLocations[event.location] = [];
                }
                if (!dnaLocations[event.location].includes(event.actorId)) {
                    dnaLocations[event.location].push(event.actorId);
                }
            }
        });

        // Always ensure murder location has both killer and victim
        if (!dnaLocations[murderLocation]) {
            dnaLocations[murderLocation] = [];
        }
        if (!dnaLocations[murderLocation].includes(killerId)) {
            dnaLocations[murderLocation].push(killerId);
        }
        if (!dnaLocations[murderLocation].includes(victimId)) {
            dnaLocations[murderLocation].push(victimId);
        }

        // Add some contamination for harder difficulties
        if (difficulty === 'hard') {
            template.locations.forEach(loc => {
                if (dnaLocations[loc] && this.seededRandom(seed + loc, 0, 100) > 70) {
                    const randomSuspect = template.suspectRoles[
                        this.seededRandom(seed + loc + 'dna', 0, template.suspectRoles.length - 1)
                    ];
                    if (!dnaLocations[loc].includes(randomSuspect)) {
                        dnaLocations[loc].push(randomSuspect);
                    }
                }
            });
        }

        return dnaLocations;
    }

    generate(config: GeneratorConfig): CaseSkeleton {
        const seed = config.seed || Date.now().toString();
        const difficulty = config.difficulty || 'medium';
        const theme = config.theme || 'modern';

        // Select template based on seed
        const templateIndex = this.seededRandom(seed, 0, this.templates.length - 1);
        const template = this.templates[templateIndex];

        // Select weapon from category
        const weaponCategory = template.weaponType as keyof typeof this.weapons;
        const weaponOptions = this.weapons[weaponCategory];
        const murderWeapon = weaponOptions[this.seededRandom(seed + 'weapon', 0, weaponOptions.length - 1)];

        // Optionally shuffle suspects to vary who the killer is
        const shuffledSuspects = difficulty === 'hard'
            ? this.shuffleArray(template.suspectRoles, seed)
            : template.suspectRoles;

        const killerId = shuffledSuspects[0]; // First in shuffled array
        const victimId = template.victimRole;

        // Select murder location (avoid first/obvious location for harder difficulties)
        const murderLocationIndex = difficulty === 'easy'
            ? 1
            : this.seededRandom(seed + 'murder_loc', 1, template.locations.length - 1);
        const murderLocation = template.locations[murderLocationIndex];

        // Generate timeline
        const { timeline, murderTime } = this.generateTimeline(
            template,
            killerId,
            victimId,
            murderLocation,
            murderWeapon,
            difficulty,
            seed
        );

        // Generate evidence
        const evidenceLocations = this.generateEvidence(
            template,
            murderLocation,
            murderWeapon,
            killerId,
            victimId,
            difficulty,
            seed
        );

        // Generate DNA
        const dnaLocations = this.generateDNA(
            template,
            murderLocation,
            killerId,
            victimId,
            timeline,
            difficulty,
            seed
        );

        const skeleton: CaseSkeleton = {
            seed,
            theme,
            difficulty,
            victimId,
            killerId,
            suspectIds: template.suspectRoles,
            map: template.mapConnections,
            rooms: template.locations,
            murderTime,
            murderLocation,
            murderWeapon,
            timeline,
            evidenceLocations,
            dnaLocations
        };

        return skeleton;
    }
}