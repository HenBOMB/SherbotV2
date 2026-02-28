import { Client, Message, TextChannel } from 'discord.js';
import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Sherbot AI Feature
 * Triggers on "Sherbot [question]" and delegates to n8n
 */
export default function (client: Client) {
    client.on('messageCreate', async (message: Message) => {
        // Ignore bots
        if (message.author.bot) return;

        const content = message.content.trim();
        const lowerContent = content.toLowerCase();

        // Trigger condition: Starts with "Sherbot" or mentions the bot
        const botMention = `<@${client.user?.id}>`;
        const botMentionNick = `<@!${client.user?.id}>`;

        const isTriggered =
            lowerContent.startsWith('sherbot') ||
            content.startsWith(botMention) ||
            content.startsWith(botMentionNick);

        if (!isTriggered) return;

        // Extract the actual question
        let question = '';
        if (lowerContent.startsWith('sherbot')) {
            question = content.slice(7).trim();
            // Remove optional comma or colon: "Sherbot, what..." -> "what..."
            if (question.startsWith(',') || question.startsWith(':')) {
                question = question.slice(1).trim();
            }
        } else {
            question = content.replace(botMention, '').replace(botMentionNick, '').trim();
        }

        if (!question || question.length < 2) {
            return;
        }

        if (!(message.channel instanceof TextChannel)) return;

        // Check for specific supervisor commands
        if (question.toLowerCase() === 'restart please') {
            const { halt } = await import('../index.js');
            await message.reply('🔄 Restarting Sherbot, please wait a moment...');
            logger.info(`Restart requested by ${message.author.tag}`);
            await halt(42); // 42 is our RESTART_CODE
            return;
        }

        try {
            // 1. Show typing status
            await message.channel.sendTyping();

            // 2. Fetch channel history for context
            const historyCount = 20; // Last 20 messages for context
            const messages = await message.channel.messages.fetch({ limit: historyCount });

            const history = messages
                .reverse() // Get them in chronological order
                .map(m => ({
                    author: m.author.displayName,
                    content: m.cleanContent,
                    timestamp: m.createdAt,
                    isBot: m.author.bot
                }));

            // 3. Send to n8n
            const webhookUrl = config.features.n8n.webhookUrl;
            if (!webhookUrl) {
                logger.warn('n8n webhook URL not configured. AI feature disabled.');
                return;
            }

            logger.info(`AI request from ${message.author.tag}: "${question}"`);

            const payload = {
                question,
                source: 'discord',
                user: {
                    id: message.author.id,
                    username: message.author.username,
                    displayName: message.author.displayName
                },
                channel: {
                    id: message.channel.id,
                    name: (message.channel as TextChannel).name || 'unknown'
                },
                guild: {
                    id: message.guild?.id,
                    name: message.guild?.name
                },
                history
            };

            const response = await axios.post(webhookUrl, payload, {
                timeout: 30000 // 30s timeout for AI response
            });

            // 4. Handle response from n8n
            const reply = response.data.output || response.data.text || response.data.message || response.data;

            if (typeof reply === 'string' && reply.length > 0) {
                await message.reply(reply);
            } else if (typeof reply === 'object' && reply.text) {
                await message.reply(reply.text);
            } else {
                logger.warn('Received empty or invalid response from n8n', response.data);
            }

        } catch (error: any) {
            logger.error('Error in AI feature:', error.message);
            // Optionally notify the user
            // await message.reply("Sorry, I'm having trouble connecting to my brain right now.").catch(() => {});
        }
    });
}
