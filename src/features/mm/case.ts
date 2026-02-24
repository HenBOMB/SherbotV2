import fs from 'fs';
import path from 'path';

/**
 * Victim information
 */
export interface Victim {
    name: string;
    cause: string;
    description?: string;
    avatar?: string;
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
    physical_evidence?: Record<string, string>;
    /** Physical items discovered at locations: { "master_bedroom": ["safe"] } */
    physical_discovery?: Record<string, string[]>;
    /** All valid locations in the case (optional, used for validation/autocomplete without hinting) */
    all_locations?: string[];
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
    gender?: string;
    isGuilty: boolean;
    alibi: string;
    motive: string;
    secrets: SecretData[];
    traits: string[];
}

/**
 * Difficulty settings
 */
export type DifficultyLevel = 'watson' | 'sherlock' | 'irene' | 'easy' | 'medium' | 'hard';

/**
 * Case configuration loaded from JSON
 */
export interface CaseConfig {
    id: string;
    name: string;
    description: string;
    victim: Victim;
    murderTime: string;
    murderLocation: string;
    evidence: Evidence;
    solution: SolutionData; // suspect id or full solution object
    map?: Record<string, string[]>; // adjacency list: "kitchen": ["hallway", "dining"]
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
    method: string;
    motive: string;
    timeline_summary?: Record<string, string>;
    key_evidence: string[];
}

/**
 * Player statistics for MVP tracking
 */
export interface PlayerStats {
    userId: string;
    username: string;
    roomsDiscovered: number;
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
}

/**
 * Active game state
 */
export interface GameState {
    caseId: string;
    difficulty: DifficultyLevel;
    startedAt: Date;
    endsAt: Date;
    points: number;
    participants: Set<string>; // user IDs
    playerStats: Record<string, PlayerStats>; // Stats per user
    suspectState: Record<string, SuspectState>; // State per suspect
    usedTools: { tool: string; cost: number; result: string }[];
    phase: 'investigating' | 'accused' | 'ended';
    discoveredLocations: Set<string>;
    discoveredEvidence: Set<string>;
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

    constructor(config: CaseConfig) {
        this.config = config;
    }

    /**
     * Load a case from a directory
     */
    static load(caseDir: string): Case {
        const configPath = path.join(caseDir, 'case.json');
        if (!fs.existsSync(configPath)) {
            throw new Error(`Case config not found: ${configPath}`);
        }

        const config: CaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return new Case(config);
    }

    /**
     * Start a new game with this case
     */
    start(participants: string[], difficulty: DifficultyLevel = 'sherlock'): GameState {
        const now = new Date();

        // Difficulty multipliers
        let multiplier = 1;
        if (difficulty === 'watson') multiplier = 1.5;
        if (difficulty === 'irene') multiplier = 0.75;

        const endsAt = new Date(now.getTime() + Math.floor(this.config.settings.timeLimit * multiplier) * 60 * 1000);

        this.state = {
            caseId: this.config.id,
            difficulty,
            startedAt: now,
            endsAt,
            points: Math.floor(this.config.settings.startingPoints * multiplier),
            participants: new Set(participants),
            playerStats: {},
            suspectState: {},
            usedTools: [],
            phase: 'investigating',
            discoveredLocations: new Set(),
            discoveredEvidence: new Set(),
            accusations: {},
        };

        // Initial discovery: Public Rooms or Entry points
        // If no map is defined, discover all (legacy support)
        if (!this.config.map) {
            const all = this.getValidLocations();
            all.forEach(l => this.state?.discoveredLocations.add(l));
        } else {
            // Always reveal the murder location if no explicit entry
            const entry = Object.keys(this.config.map)[0]; // First key as entry
            if (entry) this.state.discoveredLocations.add(entry.toLowerCase());
            // if (this.config.murderLocation) this.state.discoveredLocations.add(this.config.murderLocation.toLowerCase());

            // In Watson mode, reveal all immediately
            if (difficulty === 'watson') {
                const all = this.getValidLocations();
                all.forEach(l => this.state?.discoveredLocations.add(l));
            }
        }

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
        const loc = location.toLowerCase().replace(/\s+/g, '_');
        return this.config.evidence.dna[loc] || null;
    }

    /**
     * Get camera footage at a time
     */
    getFootage(time: string): string | null {
        const t = this._normalizeTime(time);
        return this.config.evidence.footage?.[t] || null;
    }

    /**
     * Get digital logs at a time
     */
    getLogs(time: string): string | null {
        const t = this._normalizeTime(time);
        return this.config.evidence.digital_logs?.[t] || null;
    }

    /**
     * Get suspect location at a time
     */
    getLocation(suspectId: string, time: string): string | null {
        const id = suspectId.toLowerCase();
        const t = this._normalizeTime(time);
        const suspectLocs = this.config.evidence.locations[id];
        if (!suspectLocs) return null;
        return suspectLocs[t] || null;
    }

    /**
     * Get description for a specific physical item
     */
    getPhysicalEvidence(evidenceId: string): string | null {
        return this.config.evidence.physical_evidence?.[evidenceId] || null;
    }

    /**
     * Get IDs of physical items at a location
     */
    getPhysicalDiscovery(location: string): string[] {
        const loc = location.toLowerCase().replace(/\s+/g, '_');
        return this.config.evidence.physical_discovery?.[loc] || [];
    }

    /**
     * Check if a location is valid for investigation
     */
    isValidLocation(location: string): boolean {
        const loc = location.toLowerCase().replace(/\s+/g, '_');

        // Use the explicit locations list if provided
        if (this.config.evidence.all_locations) {
            return this.config.evidence.all_locations.some(l => l.toLowerCase().replace(/\s+/g, '_') === loc);
        }

        // Fallback to checking existing evidence
        const inDna = this.config.evidence.dna ? (loc in this.config.evidence.dna) : false;
        const inSuspectLocs = this.config.evidence.locations ? Object.values(this.config.evidence.locations).some(locs =>
            Object.values(locs).some(l => l.toLowerCase().replace(/\s+/g, '_') === loc)
        ) : false;
        return inDna || inSuspectLocs;
    }

    /**
     * Check if a time is valid for investigation
     */
    isValidTime(time: string): boolean {
        const t = this._normalizeTime(time);
        const inFootage = this.config.evidence.footage ? (t in this.config.evidence.footage) : false;
        const inLogs = this.config.evidence.digital_logs ? (t in this.config.evidence.digital_logs) : false;
        const inSuspectLocs = this.config.evidence.locations ? Object.values(this.config.evidence.locations).some(locs =>
            t in locs
        ) : false;
        return inFootage || inLogs || inSuspectLocs;
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
                locations.add(loc.toLowerCase().replace(/\s+/g, '_'))
            );
        });
        return Array.from(locations);
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
