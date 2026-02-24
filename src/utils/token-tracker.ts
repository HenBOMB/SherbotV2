import fs from 'fs';
import path from 'path';
import { TokenUsageLog } from '../database.js';

interface TokenUsage {
    timestamp: number;
    suspectId: string;
    caseId?: string | null;
    guildId?: string | null;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    model: string;
}

export class TokenTracker {
    private reportPath: string;

    constructor(dataDir: string = 'data') {
        const logsDir = path.join(dataDir, 'logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }
        this.reportPath = path.join(logsDir, 'token_usage.csv');

        // Create header if file doesn't exist
        if (!fs.existsSync(this.reportPath)) {
            fs.writeFileSync(this.reportPath, 'timestamp,suspect_id,model,prompt_tokens,completion_tokens,total_tokens\n');
        }
    }

    public async track(suspectId: string, model: string, usage: any, caseId: string | null = null, guildId: string | null = null) {
        if (!usage) return;

        const entry: TokenUsage = {
            timestamp: Date.now(),
            suspectId,
            caseId,
            guildId,
            model,
            promptTokens: usage.prompt_tokens || 0,
            completionTokens: usage.completion_tokens || 0,
            totalTokens: usage.total_tokens || 0
        };

        const line = `${new Date(entry.timestamp).toISOString()},${entry.suspectId},${entry.model},${entry.promptTokens},${entry.completionTokens},${entry.totalTokens}\n`;

        fs.appendFile(this.reportPath, line, (err) => {
            if (err) console.error('Failed to log token usage:', err);
        });

        try {
            await TokenUsageLog.create({
                suspectId: entry.suspectId !== '-1' ? entry.suspectId : null,
                caseId: entry.caseId,
                guildId: entry.guildId,
                model: entry.model,
                promptTokens: entry.promptTokens,
                completionTokens: entry.completionTokens,
                totalTokens: entry.totalTokens
            });
        } catch (dbErr) {
            console.error('Failed to log token usage to DB:', dbErr);
        }
    }
}

export const tokenTracker = new TokenTracker();
