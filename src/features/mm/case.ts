import fs from 'fs';
import path from 'path';

/**
 * Victim information
 */
export interface Victim {
    name: string;
    cause: string;
    description?: string;
}

/**
 * Evidence data structure
 */
export interface Evidence {
    /** DNA samples by location: { "study": ["suspect_a", "victim"], "garden": ["suspect_b"] } */
    dna: Record<string, string[]>;
    /** Camera footage by time: { "21:00": "suspect_c enters library" } */
    footage: Record<string, string>;
    /** Phone locations by suspect and time: { "suspect_a": { "21:30": "garden" } } */
    locations: Record<string, Record<string, string>>;
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
    gender?: string;
    isGuilty: boolean;
    alibi: string;
    motive: string;
    secrets: SecretData[];
    traits: string[];
}

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
    solution: string; // suspect id
    suspects: SuspectData[];
    settings: {
        timeLimit: number; // minutes
        startingPoints: number;
    };
}

/**
 * Active game state
 */
export interface GameState {
    caseId: string;
    startedAt: Date;
    endsAt: Date;
    points: number;
    participants: Set<string>; // user IDs
    usedTools: { tool: string; cost: number; result: string }[];
    phase: 'investigating' | 'accused' | 'ended';
    accusation?: {
        accusedId: string;
        correct: boolean;
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
    start(participants: string[]): GameState {
        const now = new Date();
        const endsAt = new Date(now.getTime() + this.config.settings.timeLimit * 60 * 1000);

        this.state = {
            caseId: this.config.id,
            startedAt: now,
            endsAt,
            points: this.config.settings.startingPoints,
            participants: new Set(participants),
            usedTools: [],
            phase: 'investigating',
        };

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
        const loc = location.toLowerCase();
        return this.config.evidence.dna[loc] || null;
    }

    /**
     * Get camera footage at a time
     */
    getFootage(time: string): string | null {
        return this.config.evidence.footage[time] || null;
    }

    /**
     * Get suspect location at a time
     */
    getLocation(suspectId: string, time: string): string | null {
        const suspectLocs = this.config.evidence.locations[suspectId];
        if (!suspectLocs) return null;
        return suspectLocs[time] || null;
    }

    /**
     * Make an accusation
     */
    accuse(suspectId: string): { correct: boolean; solution: string } {
        if (!this.state) throw new Error('No active game');

        const correct = suspectId === this.config.solution;
        this.state.phase = 'accused';
        this.state.accusation = { accusedId: suspectId, correct };

        return { correct, solution: this.config.solution };
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
}
