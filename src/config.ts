import dotenv from 'dotenv';
dotenv.config();

export const config = {
    bot: {
        token: process.env.BOT_TOKEN!,
        clientId: process.env.CLIENT_ID,
        color: 0xBE0000,
    },
    database: {
        dialect: 'sqlite' as const,
        storage: process.env.DB_PATH || './database.sqlite',
        logging: process.env.DB_LOGGING === 'true',
    },
    guilds: {
        main: process.env.MAIN_GUILD_ID || '670107546480017409',
        dev: process.env.DEV_GUILD_ID || '1462571184787947674',
    },
    channels: {
        welcome: process.env.WELCOME_CHANNEL_ID || '670108784307470337',
        verification: process.env.VERIFICATION_CHANNEL_ID || '906149558801813605',
        modLog: process.env.MOD_LOG_CHANNEL_ID || '1026319776630456421',
        tips: process.env.TIPS_CHANNEL_ID || '1174494459812134983',
        introductions: '670108903224377354', // From mod.js
    },
    roles: {
        defaultMember: process.env.DEFAULT_MEMBER_ROLE_ID || '670108333834764288',
        verified: process.env.VERIFIED_ROLE_ID || '906128248193306635',
        kickMembers: 'KickMembers', // Permission string
    },
    users: {
        owners: (process.env.OWNER_IDS?.split(',') || ['348547981253017610', '406942946445885443']),
    },
    features: {
        dailyTipsEnabled: process.env.DAILY_TIPS_ENABLED !== 'false',
        autoModEnabled: process.env.AUTO_MOD_ENABLED !== 'false',
        profiler: {
            enabled: true,
            ignoredKeywords: ['welcome', 'rules', 'announcement', 'info', 'bot', 'server', 'role', 'roles', 'channel', 'channels', 'member', 'members', 'user', 'users', 'moderation', 'moderator', 'moderators', 'admin', 'admins', 'owner', 'owners'],
            // Add guild IDs here to restrict scanning, or leave empty to scan all guilds the bot is in
            targetGuilds: [process.env.MAIN_GUILD_ID || '670107546480017409'],
        },
        n8n: {
            webhookUrl: process.env.N8N_WEBHOOK_URL || '',
            apiApiKey: process.env.N8N_API_KEY || '', // In case we need it
        }
    }
};

const requiredKeys: (keyof typeof config.bot)[] = ['token'];
for (const key of requiredKeys) {
    if (!config.bot[key]) {
        throw new Error(`Missing required configuration: bot.${key}`);
    }
}
