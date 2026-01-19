import fs from 'fs';
import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import { Server } from '../database.js'; // Use .js extension for imports
import { logger } from '../utils/logger.js';
import path from 'path';
import { config } from '../config.js';

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

        await (channel as TextChannel).send({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xabefb3)
                    .setImage(TIPS[tipId])
            ]
        }).then(async message => {
            await message.react('👍');
            await message.react('👎');
        });
    } catch (error) {
        logger.error(`Failed to send tip to guild ${serverId}:`, error);
        throw error; // Let caller handle or log
    }
}

let cachedTips: string[] | null = null;
function getTips(): string[] {
    if (cachedTips) return cachedTips;
    try {
        const assetPath = path.resolve('src/assets/tips.no');
        cachedTips = fs.readFileSync(assetPath, 'utf8').split('\n').filter(t => t.trim().length > 0);
        return cachedTips;
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
            let { id: serverId, tip: tipId, tip_channel: channelId } = model.dataValues;
            // TS might complain about dataValues access depending on Model definition, 
            // but for Sequelize instances it's usually fine or we can access properties directly.
            // With the Server class accessors, we can use model.id, model.tip etc.

            // Re-assigning from model properties which are typed:
            serverId = model.id;
            tipId = model.tip ?? null;
            channelId = model.tip_channel ?? null;

            if (tipId === null || !channelId) continue;

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
    } catch (error) {
        logger.error('Error fetching servers for tips:', error);
    }
}

export default function (client: Client) {
    if (!config.features.dailyTipsEnabled) {
        logger.info('Daily tips feature disabled.');
        return;
    }

    const currentUTC = new Date();
    const timeUntil10UTC =
        (24 - currentUTC.getUTCHours() + 12) % 24 * 3600000 // 1000 GMT+3 = 1300 UTC ... wait, original code comment said 1300 UTC?
        - currentUTC.getUTCMinutes() * 60000
        - currentUTC.getUTCSeconds() * 1000
        - currentUTC.getUTCMilliseconds();

    // Original calculation seems designed for a specific timezone.
    // Preserving logic but logging the schedule time.

    logger.info(`Scheduled daily tips in ${timeUntil10UTC / 1000 / 60} minutes.`);

    setTimeout(() => {
        sendAllTips(client).catch(err => logger.error('Error in scheduled tips:', err));
        setInterval(() => sendAllTips(client).catch(err => logger.error('Error in interval tips:', err)), 86400000);
    }, timeUntil10UTC);
}
