import fs from 'fs';
import path from 'path';

export type LogType = 'MESSAGE' | 'TRIGGER' | 'STATUS' | 'AI_RESPONSE';

export class CaseLogger {
    private caseId: string;
    private guildId: string;
    private logPath: string;

    constructor(caseId: string, guildId: string) {
        this.caseId = caseId;
        this.guildId = guildId;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logDir = path.join(process.cwd(), 'logs', 'cases', guildId);

        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        this.logPath = path.join(logDir, `${caseId}_${timestamp}.log`);

        this.log('STATUS', `Logger initialized for case: ${caseId}`);
    }

    private log(type: LogType, message: string, data?: any) {
        const timestamp = new Date().toISOString();
        const dataStr = data ? ` | DATA: ${JSON.stringify(data)}` : '';
        const logEntry = `[${timestamp}] [${type}] ${message}${dataStr}\n`;

        try {
            fs.appendFileSync(this.logPath, logEntry);
        } catch (error) {
            console.error(`Failed to write to case log: ${error}`);
        }
    }

    public logMessage(memberTag: string, content: string) {
        this.log('MESSAGE', `${memberTag}: ${content}`);
    }

    public logTrigger(suspectName: string, triggerId: string, details: any) {
        this.log('TRIGGER', `${suspectName} - ${triggerId}`, details);
    }

    public logStatus(message: string, data?: any) {
        this.log('STATUS', message, data);
    }

    public logAIResponse(suspectName: string, response: string) {
        this.log('AI_RESPONSE', `${suspectName}: ${response}`);
    }
}
