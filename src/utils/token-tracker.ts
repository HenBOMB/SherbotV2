import fs from 'fs';
import path from 'path';

interface TokenUsage {
    timestamp: number;
    suspectId: string;
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

    public track(suspectId: string, model: string, usage: any) {
        if (!usage) return;

        const entry: TokenUsage = {
            timestamp: Date.now(),
            suspectId,
            model,
            promptTokens: usage.prompt_tokens || 0,
            completionTokens: usage.completion_tokens || 0,
            totalTokens: usage.total_tokens || 0
        };

        const line = `${new Date(entry.timestamp).toISOString()},${entry.suspectId},${entry.model},${entry.promptTokens},${entry.completionTokens},${entry.totalTokens}\n`;

        fs.appendFile(this.reportPath, line, (err) => {
            if (err) console.error('Failed to log token usage:', err);
        });
    }
}

export const tokenTracker = new TokenTracker();
