import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { logger } from '../../utils/logger.js';

/**
 * Condition types for hint matching
 */
export interface HintCondition {
    /** Exact match on query (e.g., specific times for footage/logs) */
    queryMatch?: string[];
    /** Partial match — query contains this substring */
    queryContains?: string;
    /** Location match for DNA/search tools */
    location?: string;
}

/**
 * A single hint definition from hints.json
 */
export interface HintDef {
    id: string;
    tool: 'footage' | 'examine' | 'dna' | 'logs' | 'search';
    condition: HintCondition;
    label: 'DEDUCTION' | 'ABDUCTION' | 'INDUCTION' | 'HINT' | 'OBSERVATION' | string;
    emoji: string;
    text: string;
    spoiler: boolean;
}

/**
 * HintEngine loads hints from a case directory and evaluates them
 * against tool usage context.
 */
export default class HintEngine {
    private hints: HintDef[] = [];
    private enabled: boolean = true;

    constructor(caseDir: string) {
        this.load(caseDir);
    }

    /**
     * Load hints from hints.json in the case directory.
     * Silently returns empty if no hints file exists.
     */
    private load(caseDir: string): void {
        let hintsPath = path.join(caseDir, 'hints.yaml');
        if (!fs.existsSync(hintsPath)) {
            hintsPath = path.join(caseDir, 'hints.json');
        }
        if (!fs.existsSync(hintsPath)) {
            return;
        }

        try {
            const raw = fs.readFileSync(hintsPath, 'utf8');
            this.hints = hintsPath.endsWith('.yaml')
                ? yaml.load(raw) as HintDef[]
                : JSON.parse(raw);
            logger.info(`Loaded ${this.hints.length} hints from ${hintsPath}`);
        } catch (e) {
            logger.error(`Failed to load hints from ${hintsPath}`, e);
        }
    }

    /**
     * Evaluate hints for a given tool invocation.
     * Returns the formatted hint string (with spoiler if configured), or empty string.
     */
    evaluate(tool: string, query: string): string {
        if (!this.enabled) return '';

        const matching = this.hints.filter(h => {
            if (h.tool !== tool) return false;
            return this.matchCondition(h.condition, query);
        });

        if (matching.length === 0) return '';

        // Return the first matching hint (most specific first in the file)
        const hint = matching[0];
        return this.format(hint);
    }

    /**
     * Check if a condition matches the given query
     */
    private matchCondition(condition: HintCondition, query: string): boolean {
        const q = query.toLowerCase().replace(/[^a-z0-9:_.-]/g, '');

        // queryMatch: exact match against any entry in the array
        if (condition.queryMatch) {
            if (condition.queryMatch.some(m => q.includes(m.toLowerCase()))) {
                return true;
            }
        }

        // queryContains: substring match
        if (condition.queryContains) {
            if (q.includes(condition.queryContains.toLowerCase())) {
                return true;
            }
        }

        // location: for dna/search — the query IS the location
        if (condition.location) {
            if (q === condition.location.toLowerCase().replace(/\s+/g, '_')) {
                return true;
            }
        }

        // If any condition field was set, we need at least one match
        // If NO condition field matched, return false
        return false;
    }

    /**
     * Format a hint into a Discord-ready string
     */
    private format(hint: HintDef): string {
        const text = hint.spoiler ? `||${hint.text}||` : hint.text;
        return `\n\n${hint.emoji} **${hint.label}:** ${text}`;
    }

    /**
     * Check if hints are loaded
     */
    hasHints(): boolean {
        return this.hints.length > 0;
    }

    /**
     * Toggle hints on/off
     */
    toggle(): boolean {
        this.enabled = !this.enabled;
        return this.enabled;
    }

    /**
     * Check if hints are currently enabled
     */
    isEnabled(): boolean {
        return this.enabled;
    }
}
