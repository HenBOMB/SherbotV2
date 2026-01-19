import Case from './case.js';

/**
 * Tool costs for investigation
 */
export const TOOL_COSTS = {
    dna: 3,
    footage: 2,
    locate: 2,
} as const;

export type ToolType = keyof typeof TOOL_COSTS;

/**
 * Result from using a tool
 */
export interface ToolResult {
    success: boolean;
    tool: ToolType;
    cost: number;
    query: string;
    result: string | string[] | null;
    error?: string;
}

/**
 * Manages detective tools and point consumption
 */
export default class ToolsManager {
    private case: Case;

    constructor(activeCase: Case) {
        this.case = activeCase;
    }

    /**
     * Use the DNA analysis tool
     */
    analyzeDNA(location: string): ToolResult {
        const cost = TOOL_COSTS.dna;

        if (!this.case.state) {
            return { success: false, tool: 'dna', cost: 0, query: location, result: null, error: 'No active game' };
        }

        if (!this.case.isActive()) {
            return { success: false, tool: 'dna', cost: 0, query: location, result: null, error: 'Game has ended' };
        }

        if (!this.case.usePoints(cost)) {
            return { success: false, tool: 'dna', cost, query: location, result: null, error: `Not enough points (need ${cost})` };
        }

        const dna = this.case.getDNA(location);
        const result: ToolResult = {
            success: true,
            tool: 'dna',
            cost,
            query: location,
            result: dna,
        };

        if (!dna) {
            result.result = [];
            result.error = `No DNA samples found at "${location}"`;
        }

        this.case.state.usedTools.push({ tool: 'dna', cost, result: JSON.stringify(dna) });
        return result;
    }

    /**
     * Use the camera footage tool
     */
    viewFootage(time: string): ToolResult {
        const cost = TOOL_COSTS.footage;

        if (!this.case.state) {
            return { success: false, tool: 'footage', cost: 0, query: time, result: null, error: 'No active game' };
        }

        if (!this.case.isActive()) {
            return { success: false, tool: 'footage', cost: 0, query: time, result: null, error: 'Game has ended' };
        }

        if (!this.case.usePoints(cost)) {
            return { success: false, tool: 'footage', cost, query: time, result: null, error: `Not enough points (need ${cost})` };
        }

        const footage = this.case.getFootage(time);
        const result: ToolResult = {
            success: true,
            tool: 'footage',
            cost,
            query: time,
            result: footage,
        };

        if (!footage) {
            result.error = `No footage available for time "${time}"`;
        }

        this.case.state.usedTools.push({ tool: 'footage', cost, result: footage || 'none' });
        return result;
    }

    /**
     * Use the phone location tool
     */
    trackLocation(suspectId: string, time: string): ToolResult {
        const cost = TOOL_COSTS.locate;
        const query = `${suspectId} @ ${time}`;

        if (!this.case.state) {
            return { success: false, tool: 'locate', cost: 0, query, result: null, error: 'No active game' };
        }

        if (!this.case.isActive()) {
            return { success: false, tool: 'locate', cost: 0, query, result: null, error: 'Game has ended' };
        }

        if (!this.case.usePoints(cost)) {
            return { success: false, tool: 'locate', cost, query, result: null, error: `Not enough points (need ${cost})` };
        }

        const location = this.case.getLocation(suspectId, time);
        const result: ToolResult = {
            success: true,
            tool: 'locate',
            cost,
            query,
            result: location,
        };

        if (!location) {
            result.error = `No location data for "${suspectId}" at "${time}"`;
        }

        this.case.state.usedTools.push({ tool: 'locate', cost, result: location || 'unknown' });
        return result;
    }

    /**
     * Get remaining points
     */
    getPoints(): number {
        return this.case.state?.points ?? 0;
    }

    /**
     * Get tool usage history
     */
    getHistory(): { tool: string; cost: number; result: string }[] {
        return this.case.state?.usedTools ?? [];
    }
}
