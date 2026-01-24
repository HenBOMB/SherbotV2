import Case from './case.js';

/**
 * Tool costs for investigation
 */
export const TOOL_COSTS = {
    dna: 0.5,
    footage: 0.25,
    logs: 0.25,
    explore: 1.0,
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

        if (!this.case.isValidLocation(location)) {
            return { success: false, tool: 'dna', cost: 0, query: location, result: null, error: `Invalid location: "${location}"` };
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
    viewFootage(time: string, charge: boolean = true): ToolResult {
        const cost = charge ? TOOL_COSTS.footage : 0;

        if (!this.case.state) {
            return { success: false, tool: 'footage', cost: 0, query: time, result: null, error: 'No active game' };
        }

        if (!this.case.isActive()) {
            return { success: false, tool: 'footage', cost: 0, query: time, result: null, error: 'Game has ended' };
        }

        if (!this.case.isValidTime(time)) {
            return { success: false, tool: 'footage', cost: 0, query: time, result: null, error: `Invalid time: "${time}"` };
        }

        if (charge && !this.case.usePoints(cost)) {
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
     * Use the digital logs tool
     */
    viewLogs(time: string, charge: boolean = true): ToolResult {
        const cost = charge ? TOOL_COSTS.logs : 0;

        if (!this.case.state) {
            return { success: false, tool: 'logs', cost: 0, query: time, result: null, error: 'No active game' };
        }

        if (!this.case.isActive()) {
            return { success: false, tool: 'logs', cost: 0, query: time, result: null, error: 'Game has ended' };
        }

        if (!this.case.isValidTime(time)) {
            return { success: false, tool: 'logs', cost: 0, query: time, result: null, error: `Invalid time: "${time}"` };
        }

        if (charge && !this.case.usePoints(cost)) {
            return { success: false, tool: 'logs', cost, query: time, result: null, error: `Not enough points (need ${cost})` };
        }

        const logs = this.case.getLogs(time);
        const result: ToolResult = {
            success: true,
            tool: 'logs',
            cost,
            query: time,
            result: logs,
        };

        if (!logs) {
            result.error = `No logs available for time "${time}"`;
        }

        this.case.state.usedTools.push({ tool: 'logs', cost, result: logs || 'none' });
        return result;
    }

    /**
     * Use the explore tool to find connected rooms
     */
    explore(currentLocation: string): ToolResult {
        const cost = TOOL_COSTS.explore;

        if (!this.case.state) {
            return { success: false, tool: 'explore', cost: 0, query: currentLocation, result: null, error: 'No active game' };
        }

        if (!this.case.isActive()) {
            return { success: false, tool: 'explore', cost: 0, query: currentLocation, result: null, error: 'Game has ended' };
        }

        // Map check
        if (!this.case.config.map || !this.case.config.map[currentLocation]) {
            return { success: false, tool: 'explore', cost: 0, query: currentLocation, result: null, error: 'Cannot explore from here (invalid location or no map)' };
        }

        if (!this.case.usePoints(cost)) {
            return { success: false, tool: 'explore', cost, query: currentLocation, result: null, error: `Not enough points (need ${cost})` };
        }

        // Find adjacent rooms and items
        const adjacent = this.case.config.map[currentLocation] || [];
        const items = this.case.getPhysicalDiscovery(currentLocation);

        const newlyDiscovered: string[] = [];

        // 1. Rooms
        adjacent.forEach(loc => {
            if (!this.case.state?.discoveredLocations.has(loc.toLowerCase())) {
                this.case.state?.discoveredLocations.add(loc.toLowerCase());
                newlyDiscovered.push(`ROOM:${loc}`);
            }
        });

        // 2. Items
        items.forEach(itemId => {
            newlyDiscovered.push(`ITEM:${itemId}`);
        });

        const result: ToolResult = {
            success: true,
            tool: 'explore',
            cost,
            query: currentLocation,
            result: newlyDiscovered
        };

        this.case.state.usedTools.push({
            tool: 'explore',
            cost,
            result: `Found: ${newlyDiscovered.join(', ') || 'Nothing new'}`
        });
        return result;
    }

    /**
     * Examine a physical evidence item
     */
    examine(evidenceId: string): ToolResult {
        // Examination is free
        const cost = 0;

        if (!this.case.state) {
            return { success: false, tool: 'examine' as any, cost: 0, query: evidenceId, result: null, error: 'No active game' };
        }

        const description = this.case.getPhysicalEvidence(evidenceId);

        if (!description) {
            return {
                success: false,
                tool: 'examine' as any,
                cost: 0,
                query: evidenceId,
                result: null,
                error: `No information found for item: "${evidenceId}"`
            };
        }

        const result: ToolResult = {
            success: true,
            tool: 'examine' as any,
            cost,
            query: evidenceId,
            result: description,
        };

        this.case.state.usedTools.push({
            tool: 'examine',
            cost,
            result: `Examined ${evidenceId}: ${description}`
        });

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
