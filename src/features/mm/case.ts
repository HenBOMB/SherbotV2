import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import HintEngine from './hints.js';
import { normalizeLocationId } from './discord-utils.js';
import { parseTimeToMinutes } from './utils.js';
import { CaseLogger } from './case-logger.js';

/**
 * Victim information
 */
export interface Victim {
    name: string;
    age?: number;
    cause: string;
    time_of_death?: string;
    description?: string;
    avatar?: string;
    autopsy_findings?: {
        cause: string;
        contact_point: string;
        time_of_death: string;
        instant_death: string;
        defensive_wounds: string;
        toxicology: string;
        other_findings: string;
    };
}

/**
 * A physical item that can be found in a room
 */
export interface PhysicalItem {
    description: string;
    /** A passcode required to "unlock" the full description */
    required?: string;
    /** Description shown after the item is unlocked */
    unlocked_description?: string;
    /** Evidence IDs that must be discovered before this item can be examined */
    requires_discovery?: string[];
}

/**
 * Evidence data structure
 */
export interface Evidence {
    /** DNA samples by location: { "study": ["suspect_a", "victim"], "garden": ["suspect_b"] } */
    dna: Record<string, string[]>;
    /** Camera footage by time: { "21:00": "suspect_c enters library" } */
    footage: Record<string, string>;
    /** Digital system logs by time: { "21:00": "Keycard access detected" } */
    digital_logs?: Record<string, string>;
    /** Phone locations by suspect and time: { "suspect_a": { "21:30": "garden" } } */
    locations: Record<string, Record<string, string>>;
    /** IDs and descriptions of physical items: { "safe": "A high-tech biometric safe." } */
    physical_evidence?: Record<string, string | PhysicalItem>;
    /** Physical items discovered at locations: { "master_bedroom": ["safe"] } */
    physical_discovery?: Record<string, string[]>;
    /** All valid locations in the case (optional, used for validation/autocomplete without hinting) */
    all_locations?: string[];
    /** Initial police statements by suspect */
    initial_police_statements?: Record<string, string>;
}

/**
 * Secret with trigger conditions for skill-based interrogation
 */
export interface SecretData {
    id: string;
    text: string;
    trigger: {
        /** Evidence IDs from tools that must be discovered first */
        requiresEvidence?: string[];
        /** Keywords that pressure this secret when mentioned */
        keywords?: string[];
        /** Minimum composure loss before this can be revealed */
        minPressure?: number;
    };
}

/**
 * Suspect definition for case files
 */
export interface SuspectData {
    id: string;
    name: string;
    alias: string[];
    avatar: string;
    currentLocation: string;
    age?: number;
    role?: string;
    gender?: string;
    isGuilty: boolean;
    isAccomplice?: boolean;
    isSilentWitness?: boolean;
    alibi: string;
    motive: string;
    secrets: SecretData[];
    traits: string[];
    resistance_level?: string;
    tells?: string;
}

/**
 * Difficulty settings
 */
export type DifficultyLevel = 'watson' | 'sherlock' | 'irene' | 'easy' | 'medium' | 'hard';

/**
 * Case configuration loaded from JSON
 */
/**
 * A single interactable object within a room
 */
export interface RoomInteractable {
    name: string;
    description: string;
    evidence_id?: string;
    requires_analysis?: boolean;
    required?: string;
    unlocked_description?: string;
    /** Keyed dialogue responses for NPC interactables. Use 'default' for the initial greeting, and 'on_ask_about_<topic>' for topic-specific responses. */
    dialogue?: Record<string, string>;
}

/**
 * Rich room definition with flavor text and interactables
 */
export interface RoomInfo {
    description: string;
    connects_to: string[];
    interactables?: RoomInteractable[];
}

export interface CaseConfig {
    id: string;
    name: string;
    description: string;
    context?: {
        setup: string;
        house_layout: string;
        biometric_secured_rooms?: string[];
        timeline_note?: string;
    };
    victim: Victim;
    murderTime: string;
    murderLocation: string;
    evidence: Evidence;
    solution: SolutionData; // suspect id or full solution object
    map?: Record<string, string[] | RoomInfo>; // adjacency list OR rich room objects
    suspects: SuspectData[];
    settings: {
        timeLimit: number; // minutes
        startingPoints: number;
        difficulty?: DifficultyLevel;
    };
    meta?: {
        generatedAt: number;
        verified: boolean;
        solvabilityScore: number;
        templateId?: string;
        seed?: string;
    };
}

/**
 * Detailed solution data
 */
export interface SolutionData {
    killer: string;
    accomplice?: string;
    accomplice_knowledge?: string;
    silent_witness?: string;
    silent_witness_knowledge?: string;
    method: string;
    motive: string;
    twist?: string;
    timeline_summary?: Record<string, string>;
    key_evidence: string[];
}

/**
 * Player statistics for MVP tracking
 */
export interface PlayerStats {
    userId: string;
    username: string;
    evidenceFound: number; // DNA, Footage, conversational location reveals
    secretsRevealed: number; // Suspect secrets
    messagesSent: number;
    toolsUsed: number;
    teamworkBonuses: number;
}

/**
 * Serializable state for a suspect
 */
export interface SuspectState {
    id: string;
    revealedSecrets: string[];
    composure: number;
    defensiveness: number;
    memory?: Record<string, string[]>;
    presentedEvidence?: string[];
}

/**
 * Active game state
 */
export interface GameState {
    caseId: string;
    hostId: string;
    difficulty: DifficultyLevel;
    startedAt: Date;
    endsAt: Date;
    points: number;
    participants: Set<string>; // user IDs
    playerStats: Record<string, PlayerStats>; // Stats per user
    suspectState: Record<string, SuspectState>; // State per suspect
    usedTools: { tool: string; cost: number; result: string }[];
    phase: 'investigating' | 'accused' | 'ended';
    discoveredEvidence: Set<string>;
    unlockedItems: Set<string>;
    accusations: Record<string, string>; // userId -> suspectId
    accusation?: {
        accusedId: string; // The suspect who met the threshold
        correct: boolean;
        votes: Record<string, string>; // Final snapshot of votes
    };
}

/**
 * Case class - manages case data and game state
 */
export default class Case {
    config: CaseConfig;
    state: GameState | null = null;
    hints: HintEngine;
    logger: CaseLogger | null = null;

    constructor(config: CaseConfig, caseDir?: string) {
        this.config = config;
        this.hints = new HintEngine(caseDir || '');
    }

    /**
     * Load a case from a directory
     */
    static load(caseDir: string): Case {
        let configPath = path.join(caseDir, 'case.yaml');
        if (!fs.existsSync(configPath)) {
            configPath = path.join(caseDir, 'case.json');
        }
        if (!fs.existsSync(configPath)) {
            throw new Error(`Case config not found in: ${caseDir}`);
        }

        const fileContent = fs.readFileSync(configPath, 'utf8');
        const config: CaseConfig = configPath.endsWith('.yaml')
            ? yaml.load(fileContent) as CaseConfig
            : JSON.parse(fileContent);
        return new Case(config, caseDir);
    }

    /**
     * Start a new game with this case
     */
    start(hostId: string, participants: string[], difficulty: DifficultyLevel = 'sherlock', guildId: string = 'unknown'): GameState {
        const now = new Date();

        // Difficulty multipliers
        let multiplier = 1;
        if (difficulty === 'watson') multiplier = 1.5;
        if (difficulty === 'irene') multiplier = 0.75;

        const endsAt = new Date(now.getTime() + Math.floor(this.config.settings.timeLimit * multiplier) * 60 * 1000);

        this.state = {
            caseId: this.config.id,
            hostId,
            difficulty,
            startedAt: now,
            endsAt,
            points: Math.floor(this.config.settings.startingPoints * multiplier),
            participants: new Set(participants),
            playerStats: {},
            suspectState: {},
            usedTools: [],
            phase: 'investigating',
            discoveredEvidence: new Set(),
            unlockedItems: new Set(),
            accusations: {},
        };

        this.logger = new CaseLogger(this.config.id, guildId);
        this.logger.logStatus('Game started', {
            hostId,
            participants: Array.from(participants),
            difficulty,
            endsAt: this.state.endsAt
        });

        return this.state;
    }

    /**
     * Check if game is still active (not timed out)
     */
    isActive(): boolean {
        if (!this.state) return false;
        if (this.state.phase !== 'investigating') return false;
        return new Date() < this.state.endsAt;
    }

    /**
     * Get remaining time in seconds
     */
    getRemainingTime(): number {
        if (!this.state) return 0;
        const remaining = this.state.endsAt.getTime() - Date.now();
        return Math.max(0, Math.floor(remaining / 1000));
    }

    /**
     * Use investigation points
     */
    usePoints(amount: number): boolean {
        if (!this.state || this.state.points < amount) return false;
        this.state.points -= amount;
        return true;
    }

    /**
     * Get DNA evidence at a location
     */
    getDNA(location: string): string[] | null {
        const loc = normalizeLocationId(location);
        return this.config.evidence.dna[loc] || null;
    }

    /**
     * Get camera footage at a time
     */
    public getFootage(time: string): string | null {
        const t = this._normalizeTime(time);
        const footageData = this.config.evidence.footage || {};

        // 1. Direct match
        if (footageData[t]) return footageData[t];

        // 2. Range match (e.g. "03:35-03:39")
        const targetMinutes = parseTimeToMinutes(t);
        for (const [key, value] of Object.entries(footageData)) {
            if (key.includes('-')) {
                const [startStr, endStr] = key.split('-');
                const start = parseTimeToMinutes(startStr.trim());
                const end = parseTimeToMinutes(endStr.trim());
                if (targetMinutes >= start && targetMinutes <= end) {
                    return value;
                }
            }
        }

        return null;
    }

    /**
     * Get digital logs at a time
     */
    public getLogs(time: string): string | null {
        const t = this._normalizeTime(time);
        const logsData = this.config.evidence.digital_logs || {};

        // 1. Direct match
        if (logsData[t]) return logsData[t];

        // 2. Range match
        const targetMinutes = parseTimeToMinutes(t);
        for (const [key, value] of Object.entries(logsData)) {
            if (key.includes('-')) {
                const [startStr, endStr] = key.split('-');
                const start = parseTimeToMinutes(startStr.trim());
                const end = parseTimeToMinutes(endStr.trim());
                if (targetMinutes >= start && targetMinutes <= end) {
                    return value;
                }
            }
        }

        return null;
    }

    /**
     * Get suspect location at a time
     */
    public getLocation(suspectId: string, time: string): string | null {
        const id = suspectId.toLowerCase();
        const t = this._normalizeTime(time);
        const suspectLocs = this.config.evidence.locations[id];
        if (!suspectLocs) return null;

        // 1. Direct match
        if (suspectLocs[t]) return suspectLocs[t];

        // 2. Range match
        const targetMinutes = parseTimeToMinutes(t);
        for (const [key, value] of Object.entries(suspectLocs)) {
            if (key.includes('-')) {
                const [startStr, endStr] = key.split('-');
                const start = parseTimeToMinutes(startStr.trim());
                const end = parseTimeToMinutes(endStr.trim());
                if (targetMinutes >= start && targetMinutes <= end) {
                    return value;
                }
            }
        }

        return null;
    }

    /**
     * Get description for a specific physical item
     */
    getPhysicalEvidence(evidenceId: string): string | PhysicalItem | null {
        return this.config.evidence.physical_evidence?.[evidenceId] || null;
    }

    /**
     * Get IDs of physical items at a location
     */
    getPhysicalDiscovery(location: string): string[] {
        const loc = normalizeLocationId(location);
        return this.config.evidence.physical_discovery?.[loc] || [];
    }

    /**
     * Check if a location is valid for investigation
     */
    isValidLocation(location: string): boolean {
        const loc = normalizeLocationId(location);

        // Use the explicit locations list if provided
        if (this.config.evidence.all_locations) {
            return this.config.evidence.all_locations.some(l => normalizeLocationId(l) === loc);
        }

        // Fallback to checking existing evidence
        const inDna = this.config.evidence.dna ? (loc in this.config.evidence.dna) : false;
        const inSuspectLocs = this.config.evidence.locations ? Object.values(this.config.evidence.locations).some(locs =>
            Object.values(locs).some(l => normalizeLocationId(l) === loc)
        ) : false;
        return inDna || inSuspectLocs;
    }

    /**
     * Check if a time is valid for investigation
     */
    public isValidTime(time: string): boolean {
        const t = this._normalizeTime(time);

        // Check footage (including ranges)
        if (this.getFootage(t)) return true;

        // Check logs (including ranges)
        if (this.getLogs(t)) return true;

        // Check suspect locations (exact match for now as they are usually point-in-time)
        const inSuspectLocs = this.config.evidence.locations ? Object.values(this.config.evidence.locations).some(locs =>
            t in locs
        ) : false;

        return inSuspectLocs;
    }

    /**
     * Normalize time to HH:MM format
     */
    private _normalizeTime(time: string): string {
        const t = time.trim();
        // If it's H:MM, convert to 0H:MM
        if (/^\d:\d{2}$/.test(t)) {
            return '0' + t;
        }
        return t;
    }

    /**
     * Check if a suspect ID is valid
     */
    isValidSuspect(suspectId: string): boolean {
        return this.config.suspects.some(s => s.id === suspectId.toLowerCase());
    }

    /**
     * Get all valid investigation locations for autocomplete
     */
    getValidLocations(): string[] {
        // Use map keys if available as the source of truth for locations
        if (this.config.map) {
            return Object.keys(this.config.map);
        }

        // Use explicit list if provided to avoid hinting
        if (this.config.evidence.all_locations) {
            return this.config.evidence.all_locations;
        }

        const locations = new Set<string>();
        // From DNA evidence
        Object.keys(this.config.evidence.dna).forEach(loc =>
            locations.add(loc.toLowerCase())
        );
        // From suspect locations
        Object.values(this.config.evidence.locations).forEach(locs => {
            Object.values(locs).forEach(loc =>
                locations.add(normalizeLocationId(loc))
            );
        });
        return Array.from(locations);
    }

    /**
     * Normalize map entry to a connections array (handles both string[] and RoomInfo)
     */
    getMapConnections(locationId: string): string[] {
        if (!this.config.map) return [];
        const entry = this.config.map[locationId];
        if (!entry) return [];
        if (Array.isArray(entry)) return entry;
        return entry.connects_to;
    }

    /**
     * Get rich room info if available, otherwise null
     */
    getRoomInfo(locationId: string): RoomInfo | null {
        if (!this.config.map) return null;
        const entry = this.config.map[locationId];
        if (!entry || Array.isArray(entry)) return null;
        return entry;
    }

    /**
     * Find an interactable by fuzzy name match in a specific room (or all rooms)
     */
    findInteractable(query: string, locationId?: string): { interactable: RoomInteractable; locationId: string } | null {
        if (!this.config.map) return null;
        const q = query.toLowerCase().replace(/[^a-z0-9]/g, '');

        const searchRooms = locationId ? [locationId] : Object.keys(this.config.map);

        for (const roomId of searchRooms) {
            const room = this.config.map[roomId];
            if (!room || Array.isArray(room) || !room.interactables) continue;

            for (const obj of room.interactables) {
                const normalizedName = obj.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (normalizedName === q || normalizedName.includes(q) || q.includes(normalizedName)) {
                    return { interactable: obj, locationId: roomId };
                }
            }
        }
        return null;
    }

    /**
     * Record a player's accusation
     * Returns true if the game should end (threshold reached)
     */
    accuse(userId: string, suspectId: string): { finished: boolean; correct?: boolean; solution?: string; totalNeeded?: number; currentCount?: number } {
        if (!this.state) throw new Error('No active game');

        // Record the vote
        this.state.accusations[userId] = suspectId;

        const totalPlayers = this.state.participants.size;
        const totalVotes = Object.keys(this.state.accusations).length;
        const votesNeeded = Math.ceil(totalPlayers / 2);

        if (totalVotes >= votesNeeded) {
            // Threshold reached! Determine the majority or final target.
            // For now, we'll take the majority of votes, or if tied, the first one to reach the threshold counts.
            const counts: Record<string, number> = {};
            for (const sId of Object.values(this.state.accusations)) {
                counts[sId] = (counts[sId] || 0) + 1;
            }

            // Find suspect with most votes
            let finalistId = suspectId;
            let maxVotes = 0;
            for (const [id, count] of Object.entries(counts)) {
                if (count > maxVotes) {
                    maxVotes = count;
                    finalistId = id;
                }
            }

            const correct = finalistId === this.getSolutionId();

            this.state.phase = 'accused';
            this.state.accusation = {
                accusedId: finalistId,
                correct,
                votes: { ...this.state.accusations }
            };

            this.logger?.logStatus('Final accusation reached', {
                accusedId: finalistId,
                correct,
                votes: this.state.accusations
            });

            return { finished: true, correct, solution: this.getSolutionId() };

        }

        return { finished: false, totalNeeded: votesNeeded, currentCount: totalVotes };
    }

    /**
     * End the game early
     */
    end(): void {
        if (this.state) {
            this.state.phase = 'ended';
            this.logger?.logStatus('Game ended');
        }
    }

    /**
     * Get suspect by ID
     */
    getSuspect(id: string): SuspectData | undefined {
        return this.config.suspects.find(s => s.id === id);
    }

    /**
     * Get all suspects (without revealing guilt)
     */
    getSuspectsPublic(): Omit<SuspectData, 'isGuilty' | 'secrets'>[] {
        return this.config.suspects.map(({ isGuilty, secrets, ...rest }) => rest);
    }

    /**
     * Get the solution suspect ID regardless of config format
     */
    getSolutionId(): string {
        if (typeof this.config.solution === 'string') {
            return this.config.solution;
        }
        return this.config.solution.killer;
    }
}
