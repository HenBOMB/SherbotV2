import winston from 'winston';

const sherlockFormat = winston.format.printf(({ level, message, timestamp }) => {
    const ts = timestamp ? `\x1b[90m${timestamp}\x1b[0m ` : '';
    let colorizedLevel = level;
    let prefix = '🕵️ ';

    // Sherlock Theme Colors & Prefixes
    switch (level.toLowerCase()) {
        case 'info':
            colorizedLevel = `\x1b[36mSHERBOT\x1b[0m`; // Cyan
            prefix = '🔍 ';
            break;
        case 'warn':
            colorizedLevel = `\x1b[33mCAUTION\x1b[0m`;    // Yellow/Gold
            prefix = '🧐 ';
            break;
        case 'error':
            colorizedLevel = `\x1b[31mCRITICAL\x1b[0m`;   // Red
            prefix = '🚨 ';
            break;
        default:
            colorizedLevel = level.toUpperCase();
    }

    return `${ts}${prefix}[${colorizedLevel}] ${message}`;
});

export const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' }),
    ],
});

if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.timestamp({ format: 'HH:mm:ss' }),
            sherlockFormat
        ),
    }));
}
