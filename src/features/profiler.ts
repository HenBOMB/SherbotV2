import { Client, TextChannel, Message, Collection, Guild } from "discord.js";
import { UserProfile, BotState } from "../database.js";
import { generateProfile, refineProfile } from "../utils/ai.js";
import { logger } from "../utils/logger.js";
import { config } from "../config.js";

const SCAN_INTERVAL = 12 * 60 * 60 * 1000; // 12 hours
const MAX_CHANNELS = 3;
const MESSAGES_PER_USER = 50;
const LOOKBACK_HOURS = 24;

export default async function (client: Client) {
    if (!config.features.profiler?.enabled) {
        logger.info("Profiler feature is disabled.");
        return;
    }

    logger.info("Profiler feature initialized.");

    // Check if we missed a scan
    try {
        const lastScanRecord = await BotState.findOne({ where: { key: 'last_profiler_scan' } });
        const now = Date.now();

        if (lastScanRecord) {
            const lastScanTime = parseInt(lastScanRecord.value);
            const timeSinceLastScan = now - lastScanTime;

            if (timeSinceLastScan >= SCAN_INTERVAL) {
                logger.info(`Missed scan detected (last scan: ${new Date(lastScanTime).toLocaleString()}). Running immediately...`);
                runScanner(client);
            } else {
                const nextScanIn = SCAN_INTERVAL - timeSinceLastScan;
                logger.info(`Next scan scheduled in ${Math.round(nextScanIn / 1000 / 60)} minutes.`);

                // Optional: schedule the first one exactly at the remaining interval
                // But for simplicity, we'll just keep the 12h interval starting from now
                // Or better yet, wait the remaining time then start the interval.
                setTimeout(() => {
                    runScanner(client);
                    setInterval(() => runScanner(client), SCAN_INTERVAL);
                }, nextScanIn);
                return; // Exit so we don't start the standard interval yet
            }
        } else {
            // No record found, run for the first time
            logger.info("No previous scan record found. Running initial scan...");
            runScanner(client);
        }
    } catch (err) {
        logger.error("Error checking missed scan status:", err);
    }

    // Start periodic scanning
    setInterval(() => runScanner(client), SCAN_INTERVAL);
}

/**
 * Main scanner logic
 */
async function runScanner(client: Client) {
    logger.info("--- Starting User Profiling Session ---");

    const targetGuildIds = config.features.profiler.targetGuilds;
    let guildsToScan: Guild[] = [];

    if (targetGuildIds && targetGuildIds.length > 0) {
        for (const id of targetGuildIds) {
            try {
                const guild = await client.guilds.fetch(id);
                if (guild) guildsToScan.push(guild);
            } catch (err) {
                logger.error(`Could not fetch guild ${id} for profiling:`, err);
            }
        }
    } else {
        // Default to all guilds if none specified
        guildsToScan = Array.from(client.guilds.cache.values());
    }

    if (guildsToScan.length === 0) {
        logger.warn("No guilds found to scan.");
        return;
    }

    for (const guild of guildsToScan) {
        await processGuild(guild);
    }

    // Update last scan time
    try {
        const now = Date.now().toString();
        await BotState.upsert({ key: 'last_profiler_scan', value: now });
    } catch (err) {
        logger.error("Failed to update last scan time:", err);
    }

    logger.info("--- User Profiling Session Completed ---");
}

/**
 * Process a single guild
 */
async function processGuild(guild: Guild) {
    logger.info(`Scanning Guild: ${guild.name} (${guild.id})`);

    try {
        // 1. Identify "most talked" channels
        const channels = await guild.channels.fetch();
        const textChannels = channels.filter(c =>
            c?.isTextBased() &&
            c instanceof TextChannel
        ) as Collection<string, TextChannel>;

        const channelActivity: { channel: TextChannel, count: number }[] = [];
        const ignoredKeywords = config.features.profiler.ignoredKeywords || [];

        for (const [id, channel] of textChannels) {
            // Check for ignored keywords
            const shouldIgnore = ignoredKeywords.some(kw => channel.name.toLowerCase().includes(kw.toLowerCase()));
            if (shouldIgnore) {
                logger.info(`  - Ignoring channel: #${channel.name} (matches ignored keyword)`);
                continue;
            }

            try {
                // Fetch messages from the last 24 hours to gauge activity
                const messages = await channel.messages.fetch({ limit: 100 });
                const now = Date.now();
                const activeMessages = messages.filter(m => (now - m.createdTimestamp) < (LOOKBACK_HOURS * 60 * 60 * 1000));

                channelActivity.push({ channel, count: activeMessages.size });
                logger.debug(`  - Evaluated #${channel.name}: ${activeMessages.size} messages found.`);
            } catch (err) {
                // Skip channels we can't access
                logger.warn(`  - Could not access channel #${channel.name} for activity check.`);
                continue;
            }
        }

        // Sort by activity and take top N
        const topChannels = channelActivity
            .sort((a, b) => b.count - a.count)
            .slice(0, MAX_CHANNELS)
            .map(a => a.channel);

        if (topChannels.length === 0) {
            logger.warn(`No active channels found in ${guild.name}.`);
            return;
        }

        logger.info(`Selected Channels: ${topChannels.map(c => `#${c.name}`).join(", ")}`);

        // 2. Aggregate messages per user
        const UserMessages = new Map<string, string[]>();

        for (const channel of topChannels) {
            const messages = await channel.messages.fetch({ limit: 100 });
            const now = Date.now();
            const recentMessages = messages.filter(m =>
                !m.author.bot &&
                (now - m.createdTimestamp) < (LOOKBACK_HOURS * 60 * 60 * 1000)
            );

            for (const [id, msg] of recentMessages) {
                if (!UserMessages.has(msg.author.id)) {
                    UserMessages.set(msg.author.id, []);
                }
                const userMsgs = UserMessages.get(msg.author.id)!;
                if (userMsgs.length < MESSAGES_PER_USER) {
                    userMsgs.push(msg.content);
                }
            }
        }

        logger.info(`Aggregated data for ${UserMessages.size} active users.`);

        // 3. Generate/Refine profiles
        for (const [userId, messages] of UserMessages) {
            // Only profile users with at least 5 messages for better quality
            if (messages.length < 5) {
                logger.debug(`  - Skipping user ${userId}: only ${messages.length} messages found (min 5).`);
                continue;
            }

            try {
                const existingModel = await UserProfile.findOne({ where: { userId, guildId: guild.id } });

                let finalProfile: string;
                if (existingModel) {
                    logger.info(`  - Updating profile for ${userId}...`);
                    finalProfile = await refineProfile(existingModel.profile, messages);

                    await existingModel.update({
                        profile: finalProfile,
                        messageCount: existingModel.messageCount + messages.length,
                        lastUpdated: new Date()
                    });
                } else {
                    logger.info(`  - Generating first profile for ${userId}...`);
                    finalProfile = await generateProfile(messages);

                    await UserProfile.create({
                        userId,
                        guildId: guild.id,
                        profile: finalProfile,
                        messageCount: messages.length,
                        lastUpdated: new Date()
                    });
                }
            } catch (err) {
                logger.error(`  - Failed to process profile for user ${userId}:`, err);
            }
        }

    } catch (error) {
        logger.error(`Critical error processing guild ${guild.name}:`, error);
    }
}
