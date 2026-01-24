import fs from 'fs';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder, TextChannel } from 'discord.js';
import { Server, BotState, TipTranslation } from '../database.js'; // Use .js extension for imports
import { translateTip } from '../utils/ai.js';
import { logger } from '../utils/logger.js';
import path from 'path';
import { config } from '../config.js';

const TIPS_INTERVAL = 86400000; // 24 hours

export async function sendTip(client: Client, tipId: number, channelId: string, serverId: string) {
    try {
        const guild = client.guilds.cache.get(serverId) || await client.guilds.fetch(serverId);
        if (!guild) {
            logger.warn(`Guild ${serverId} not found for tip.`);
            return;
        }

        const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) {
            logger.warn(`Channel ${channelId} not found or not text-based in guild ${serverId}.`);
            return;
        }

        const TIPS = getTips();
        if (tipId >= TIPS.length) {
            logger.info(`Tips exhausted for guild ${serverId}. Resetting.`);
            tipId = 0;
        }

        // Check if tip exists
        if (!TIPS[tipId]) {
            logger.error(`Tip ID ${tipId} out of bounds.`);
            return;
        }

        const serverRecord = await Server.findByPk(serverId);
        const targetLanguage = serverRecord?.language;
        const imageUrl = TIPS[tipId];

        const row = new ActionRowBuilder<ButtonBuilder>();

        if (targetLanguage && targetLanguage.toLowerCase() !== 'english') {
            const translateBtn = new ButtonBuilder()
                .setCustomId(`translate_tip_${tipId}`)
                .setLabel(`Translate (${targetLanguage})`)
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🌍');
            row.addComponents(translateBtn);

            // Pre-generate/cache translation in background
            TipTranslation.findOne({ where: { tipUrl: imageUrl, language: targetLanguage } })
                .then(async found => {
                    if (!found) {
                        logger.info(`Pre-generating translation for tip ${tipId} in ${targetLanguage}...`);
                        const text = await translateTip(imageUrl, targetLanguage);
                        await TipTranslation.create({ tipUrl: imageUrl, language: targetLanguage, text });
                    }
                }).catch(err => logger.error("Background translation failed:", err));
        }

        const messageOptions: any = {
            embeds: [
                new EmbedBuilder()
                    .setColor(0xabefb3)
                    .setImage(imageUrl)
            ]
        };

        if (row.components.length > 0) {
            messageOptions.components = [row];
        }

        await (channel as TextChannel).send(messageOptions).then(async message => {
            await message.react('👍');
            await message.react('👎');
        });
    } catch (error) {
        logger.error(`Failed to send tip to guild ${serverId}:`, error);
        throw error; // Let caller handle or log
    }
}

let cachedTips: string[] | null = null;
export function getTips(): string[] {
    if (cachedTips) return cachedTips;
    try {
        const assetPath = path.resolve('src/assets/tips.txt');
        const content = fs.readFileSync(assetPath, 'utf8');
        cachedTips = content.split('\n').filter((t: string) => t.trim().length > 0);
        return cachedTips || [];
    } catch (e) {
        logger.error('Failed to load tips:', e);
        return [];
    }
}

async function sendAllTips(client: Client) {
    logger.info('Sending daily tips...');
    const TIPS = getTips();
    if (TIPS.length === 0) {
        logger.warn('No tips to send.');
        return;
    }

    try {
        const servers = await Server.findAll();
        for (const model of servers) {
            let serverId = model.id;
            let tipId = model.tip ?? null;
            let channelId = model.tip_channel ?? null;
            let enabled = model.tips_enabled;

            if (tipId === null || !channelId || !enabled) continue;

            try {
                await sendTip(client, tipId, channelId, serverId);

                tipId++;
                model.tip = tipId >= TIPS.length ? 0 : tipId;
                await model.save();
            } catch (err) {
                // Individual failures shouldn't stop the loop
                logger.error(`Error processing tips for server ${serverId}:`, err);
            }
        }

        // Update last tips sent time
        const now = Date.now().toString();
        await BotState.upsert({ key: 'last_tips_sent', value: now });

    } catch (error) {
        logger.error('Error fetching servers for tips:', error);
    }
}

export default async function (client: Client) {
    if (!config.features.dailyTipsEnabled) {
        logger.info('Daily tips feature disabled.');
        return;
    }

    const lastTipsRecord = await BotState.findOne({ where: { key: 'last_tips_sent' } });
    const now = Date.now();
    let timeUntilNext = 0;

    if (lastTipsRecord) {
        const lastTipsTime = parseInt(lastTipsRecord.value);
        const timeSinceLast = now - lastTipsTime;

        if (timeSinceLast >= TIPS_INTERVAL) {
            logger.info(`Missed daily tips detected (last sent: ${new Date(lastTipsTime).toLocaleString()}). Sending now...`);
            sendAllTips(client).catch(err => logger.error('Error sending missed tips:', err));
            timeUntilNext = TIPS_INTERVAL;
        } else {
            timeUntilNext = TIPS_INTERVAL - timeSinceLast;
            logger.info(`Daily tips already sent recently. Next tips in ${Math.round(timeUntilNext / 1000 / 60)} minutes.`);
        }
    } else {
        // First time running with recording
        logger.info("No previous daily tips record found. Sending initial tips...");
        sendAllTips(client).catch(err => logger.error('Error sending initial tips:', err));
        timeUntilNext = TIPS_INTERVAL;
    }

    // Schedule next
    setTimeout(() => {
        sendAllTips(client).catch(err => logger.error('Error in scheduled tips:', err));
        setInterval(() => sendAllTips(client).catch(err => logger.error('Error in interval tips:', err)), TIPS_INTERVAL);
    }, timeUntilNext);

    // Interaction listener for translations
    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isButton()) return;
        if (!interaction.customId.startsWith('translate_tip_')) return;

        try {
            await interaction.deferReply({ ephemeral: true });

            const tipId = parseInt(interaction.customId.split('_').pop() || '0');
            const TIPS = getTips();
            const imageUrl = TIPS[tipId];

            const server = await Server.findByPk(interaction.guildId!);
            const targetLanguage = server?.language || 'Spanish';

            let translation = await TipTranslation.findOne({ where: { tipUrl: imageUrl, language: targetLanguage } });

            if (!translation) {
                // Should already be cached but just in case
                const text = await translateTip(imageUrl, targetLanguage);
                translation = await TipTranslation.create({ tipUrl: imageUrl, language: targetLanguage, text });
            }

            await interaction.editReply({
                content: `**Translation (${targetLanguage}):**\n\n${translation.text}`
            });
        } catch (err) {
            logger.error("Failed to handle translation interaction:", err);
            try {
                if (interaction.deferred) await interaction.editReply("Sorry, I couldn't generate the translation right now.");
                else await interaction.reply({ content: "Sorry, I couldn't generate the translation right now.", ephemeral: true });
            } catch (e) { /* ignore */ }
        }
    });
}

/**
 * Get tips status for dashboard
 */
export async function getTipsStatus(client: Client) {
    const TIPS = getTips();
    const servers = await Server.findAll();
    logger.info(`Dashboard fetching tips for ${servers.length} servers: ${servers.map(s => s.id).join(', ')}`);
    const lastScan = await BotState.findOne({ where: { key: 'last_tips_sent' } });

    const serverStatuses = (await Promise.all(servers.map(async s => {
        if (!s.id || !s.tip_channel) return null;

        let name = 'Unknown Server (Bot not in guild)';
        let channelName = '#' + s.tip_channel;
        try {
            const guild = client.guilds.cache.get(s.id) || await client.guilds.fetch(s.id).catch(() => null);
            if (guild) {
                name = guild.name;
                // Direct fetch from client for better reliability
                const channel = await client.channels.fetch(s.tip_channel).catch(() => null);
                if (channel && 'name' in channel) {
                    channelName = '#' + (channel as any).name;
                }
                logger.debug(`Resolved tip channel for ${name}: ${channelName}`);
            }
        } catch (err) {
            // Ignore fetch errors
        }

        return {
            id: s.id,
            name: name,
            currentTipIndex: s.tip,
            currentTipUrl: TIPS[s.tip || 0] || null,
            nextTipUrl: TIPS[(s.tip || 0) + 1] || TIPS[0] || null,
            channelId: s.tip_channel,
            channelName: channelName,
            enabled: s.tips_enabled,
            language: s.language || 'English'
        };
    }))).filter(s => s !== null) as any[];

    return {
        totalTips: TIPS.length,
        lastSent: lastScan ? new Date(parseInt(lastScan.value)) : null,
        servers: serverStatuses
    };
}

/**
 * Manually set the next tip index for a server
 */
export async function setTipIndex(serverId: string, index: number) {
    const TIPS = getTips();
    if (index < 0 || index >= TIPS.length) {
        throw new Error(`Tip index ${index} out of bounds (0-${TIPS.length - 1})`);
    }

    const server = await Server.findByPk(serverId);
    if (!server) throw new Error(`Server ${serverId} not found`);

    server.tip = index;
    await server.save();
    return server.tip;
}

/**
 * Manually trigger a tip for a specific server
 */
export async function triggerTipNow(client: Client, serverId: string) {
    const server = await Server.findByPk(serverId);
    if (!server) throw new Error(`Server ${serverId} not found`);

    const tipId = server.tip ?? 0;
    const channelId = server.tip_channel;

    if (!channelId) throw new Error(`Tip channel not configured for server ${serverId}`);

    await sendTip(client, tipId, channelId, serverId);

    // Increment index after manual trigger
    const TIPS = getTips();
    const nextIndex = (tipId + 1) >= TIPS.length ? 0 : tipId + 1;
    server.tip = nextIndex;
    await server.save();

    return { sent: true, nextIndex };
}

/**
 * Toggle tips for a server
 */
export async function toggleTips(serverId: string, enabled: boolean) {
    const server = await Server.findByPk(serverId);
    if (!server) throw new Error(`Server ${serverId} not found`);

    server.tips_enabled = enabled;
    await server.save();
    return server.tips_enabled;
}

/**
 * Update server configuration (channel ID)
 */
export async function updateServerConfig(serverId: string, channelId: string) {
    const server = await Server.findByPk(serverId);
    if (!server) throw new Error(`Server ${serverId} not found`);

    server.tip_channel = channelId;
    await server.save();
    return server;
}

/**
 * Register a new server for daily tips
 */
export async function registerServer(serverId: string, channelId: string) {
    const [server, created] = await Server.findOrCreate({
        where: { id: serverId },
        defaults: {
            id: serverId,
            tip: 0,
            tip_channel: channelId,
            tips_enabled: false
        }
    });

    if (!created) {
        server.tip_channel = channelId;
        await server.save();
    }

    return server;
}

/**
 * Update server language
 */
export async function setServerLanguage(serverId: string, language: string) {
    const server = await Server.findByPk(serverId);
    if (!server) throw new Error(`Server ${serverId} not found`);

    server.language = language;
    await server.save();
    return server.language;
}

/**
 * Remove a server from daily tips
 */
export async function removeServer(serverId: string) {
    const server = await Server.findByPk(serverId);
    if (!server) throw new Error(`Server ${serverId} not found`);

    await server.destroy();
    return true;
}

/**
 * Cleanup servers where bot is not present
 */
export async function cleanupServers(client: Client) {
    const servers = await Server.findAll();
    let removedCount = 0;

    for (const s of servers) {
        try {
            const guild = client.guilds.cache.get(s.id) || await client.guilds.fetch(s.id).catch(() => null);
            if (!guild) {
                await s.destroy();
                removedCount++;
            }
        } catch (err) {
            // Ignore fetch errors, but if we can't fetch it, we might want to keep it?
            // Usually, if fetch fails with 404, it's gone.
        }
    }

    return removedCount;
}
