import {
    Client,
    Message,
    TextChannel,
    GuildMember,
    EmbedBuilder,
    Colors
} from 'discord.js';
import Suspect from './suspect.js';
import Case from './case.js';
import { InterrogationBuffer } from './types.js';
import { getLocationFromChannel } from './discord-utils.js';
import { logger } from '../../utils/logger.js';
import DashboardServer from './dashboard.js';
import { PlayerStats } from './case.js';

export interface InterrogationContext {
    getActiveGame: () => Case | null;
    getSuspects: () => Map<string, Suspect>;
    getDiscoveredEvidence: () => Set<string>;
    getDashboard: () => DashboardServer;
    broadcastDashboardState: () => void;
    getOrCreateStats: (userId: string, username: string) => PlayerStats;
    getLocationFromChannel: (channel: TextChannel) => string | null;
    isParticipant: (userId: string) => boolean;
    checkInterrogationLimit: (member: GuildMember) => Promise<{ canProceed: boolean; count: number }>;
    getPendingPasscode: (channelId: string) => string | null;
    setPendingPasscode: (channelId: string, itemId: string | null) => void;
    unlockItem: (itemId: string) => void;
    saveState: () => Promise<void>;
}

export default class InterrogationManager {
    private client: Client;
    private context: InterrogationContext;
    private messageHandler: ((message: Message) => Promise<void>) | null = null;
    private interrogationBuffers: Map<string, InterrogationBuffer> = new Map();

    constructor(client: Client, context: InterrogationContext) {
        this.client = client;
        this.context = context;
    }

    /**
     * Start listening for interrogation messages
     */
    public startListener(): void {
        this.stopListener();

        this.messageHandler = async (message: Message) => {
            try {
                // Ignore bots and secret commands
                if (message.author.bot) return;
                if (message.content.trim().toLowerCase().startsWith('$sb')) return;

                const activeGame = this.context.getActiveGame();

                // EARLY LOG: See every message the bot sees
                logger.debug(`[INTERROGATION] Message from ${message.author.tag} in channel ${message.channelId}: "${message.content}"`);

                if (!activeGame) {
                    logger.debug(`[INTERROGATION] Ignored: No active game found.`);
                    return;
                }

                if (!activeGame.isActive()) {
                    logger.debug(`[INTERROGATION] Ignored: Game is not active.`);
                    return;
                }

                const content = message.content.trim();
                if (!content) return;

                // MAX LENGTH CAP: Prevent abuse and token waste
                if (content.length > 400) {
                    await message.reply({
                        content: `⚠️ **Message too long!** (${content.length} > 400 characters)\n*Please keep your interrogation concise to avoid overwhelming the suspect.*`
                    });
                    return;
                }

                // Detect Location using the new robust method
                const channel = message.channel instanceof TextChannel ? message.channel : null;
                if (!channel) {
                    logger.debug(`[INTERROGATION] Ignored: Not a text channel.`);
                    return;
                }

                const currentLocation = this.context.getLocationFromChannel(channel);
                if (!currentLocation) {
                    logger.debug(`[INTERROGATION] Ignored: Could not determine location for channel ${channel.name} (${channel.id}).`);
                    return;
                }

                // SECURITY: Only participants can trigger interrogation responses
                if (!this.context.isParticipant(message.author.id)) {
                    logger.debug(`[INTERROGATION] Ignored: ${message.author.tag} (${message.author.id}) is not a participant.`);
                    return;
                }

                // --- PASSCODE CHECK ---
                const pendingItemId = this.context.getPendingPasscode(message.channelId);
                if (pendingItemId) {
                    const evidence = activeGame.getPhysicalEvidence(pendingItemId);
                    if (evidence && typeof evidence !== 'string' && evidence.required) {
                        const input = content.replace(/\s/g, ''); // Strip spaces
                        if (input === evidence.required) {
                            // SUCCESS
                            this.context.unlockItem(pendingItemId);
                            this.context.setPendingPasscode(message.channelId, null);

                            const unlockedDesc = evidence.unlocked_description || evidence.description;
                            await message.reply({
                                embeds: [
                                    new EmbedBuilder()
                                        .setColor(Colors.Green)
                                        .setTitle('🔓 ACCESS GRANTED')
                                        .setDescription(`\`\`\`ansi\n\u001b[1;32m[ SYSTEM UNLOCKED: ${pendingItemId.toUpperCase()} ]\u001b[0m\n\`\`\`\n${unlockedDesc}`)
                                        .setFooter({ text: 'The device is now permanently unlocked for all investigators.' })
                                ]
                            });

                            this.context.getDashboard().addEvent('tool_use', `Unlocked item: ${pendingItemId}`);
                            await this.context.saveState();
                            return;
                        } else {
                            // FAILURE
                            // To avoid spam, let's only reply if it looks like a 4-digit code or they are trying
                            if (/^\d{4}$/.test(input) || input.length < 10) {
                                await message.reply({
                                    content: '❌ **ACCESS DENIED** — Incorrect passcode. Please try again.'
                                });
                            }
                            return;
                        }
                    } else {
                        // Cleanup if item is weird
                        this.context.setPendingPasscode(message.channelId, null);
                    }
                }

                // Check if there is an active buffer for this channel
                const existingBuffer = this.interrogationBuffers.get(message.channelId);

                // Check if this message mentions a suspect
                const mentionedSuspect = this.findMentionedSuspect(content);

                // LIMIT CHECK: Limit to 100 interrogations per day for non-admins/non-owners
                if (mentionedSuspect || existingBuffer) {
                    if (message.member) {
                        const { canProceed } = await this.context.checkInterrogationLimit(message.member);
                        if (!canProceed) {
                            // Add a small check so we don't spam the warning if they send multiple messages
                            if (!existingBuffer) {
                                await message.reply({
                                    content: `⚠️ **Daily Interrogation Limit Reached!**\nYou've reached your daily limit of 100 interrogations. Ask an admin to reset your limit.`
                                });
                            }
                            return;
                        }
                    }
                }

                // ENFORCE PRESENCE:
                if (mentionedSuspect) {
                    const suspectLoc = mentionedSuspect.data.currentLocation;
                    if (suspectLoc !== currentLocation) {
                        // Only reply if the user is clearly trying to talk to them
                        const isDirectInterrogation = content.toLowerCase().startsWith('hey') ||
                            content.toLowerCase().includes(mentionedSuspect.data.name.toLowerCase());

                        if (isDirectInterrogation) {
                            await message.reply({
                                content: `*${mentionedSuspect.data.name} is not in this room.*`,
                            });
                        }
                        return;
                    }
                }

                // If continuing a conversation
                if (existingBuffer) {
                    if (mentionedSuspect && mentionedSuspect.data.id !== existingBuffer.suspect.data.id) {
                        logger.debug(`Suspect switch detected in ${message.channelId}. Processing old buffer...`);
                        clearTimeout(existingBuffer.timer);
                        await this.processBuffer(message.channelId);
                    } else {
                        existingBuffer.messages.push(content);
                        clearTimeout(existingBuffer.timer);
                        existingBuffer.timer = setTimeout(async () => {
                            await this.processBuffer(message.channelId);
                        }, 1000);
                        return;
                    }
                }

                if (!mentionedSuspect) {
                    logger.debug(`Interrogation ignored: no suspect mentioned in "${content}"`);
                    return;
                }

                logger.debug(`Starting interrogation buffer for ${mentionedSuspect.data.name} with ${message.author.tag}`);

                if (mentionedSuspect.isBusy) {
                    await message.reply({
                        content: `*${mentionedSuspect.data.name} is busy responding to someone else...*`,
                    });
                    return;
                }

                const member = message.member;
                if (!member) return;

                const buffer: InterrogationBuffer = {
                    suspect: mentionedSuspect,
                    messages: [content],
                    member,
                    channel: message.channel as TextChannel,
                    timer: setTimeout(async () => {
                        await this.processBuffer(message.channelId);
                    }, 1000)
                };

                this.interrogationBuffers.set(message.channelId, buffer);
            } catch (error) {
                logger.error('Error in interrogation handler:', error);
            }
        };

        this.client.on('messageCreate', this.messageHandler);
        logger.info('Interrogation listener started');
    }

    /**
     * Stop listening for interrogation messages and clear buffers
     */
    public stopListener(): void {
        this.clearBuffers();
        if (this.messageHandler) {
            this.client.removeListener('messageCreate', this.messageHandler);
            this.messageHandler = null;
        }
    }

    /**
     * Clear all pending interrogation buffers and cancel their timers
     */
    public clearBuffers(): void {
        for (const buffer of this.interrogationBuffers.values()) {
            clearTimeout(buffer.timer);
        }
        this.interrogationBuffers.clear();
        logger.debug('Interrogation buffers cleared.');
    }

    /**
     * Find a suspect mentioned in content
     */
    private findMentionedSuspect(content: string): Suspect | null {
        const suspects = this.context.getSuspects();
        const processedIds = new Set<string>();
        const escapeName = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let earliestMatch: { suspect: Suspect; position: number } | null = null;

        for (const [key, suspect] of suspects) {
            if (processedIds.has(suspect.data.id)) continue;
            processedIds.add(suspect.data.id);

            const namesToCheck = [suspect.data.name, ...suspect.data.alias];
            for (const name of namesToCheck) {
                if (!name) continue;
                const regex = new RegExp(`\\b${escapeName(name)}\\b`, 'i');
                const match = regex.exec(content);
                if (match) {
                    logger.debug(`Found suspect match: ${suspect.data.name} for keyword "${name}"`);
                    if (!earliestMatch || match.index < earliestMatch.position) {
                        earliestMatch = { suspect, position: match.index };
                    }
                }
            }
        }
        return earliestMatch?.suspect || null;
    }

    /**
     * Process message buffer
     */
    private async processBuffer(channelId: string): Promise<void> {
        const buffer = this.interrogationBuffers.get(channelId);
        if (!buffer) return;

        this.interrogationBuffers.delete(channelId);

        const { suspect, messages, member, channel } = buffer;
        const combinedContent = messages.join('\n');
        const discoveredEvidence = this.context.getDiscoveredEvidence();
        const dashboard = this.context.getDashboard();

        try {
            logger.debug(`Processing interrogation buffer for ${suspect.data.name} (Channel: ${channelId})`);
            const activeGame = this.context.getActiveGame();
            if (!activeGame) return;

            const currentLocation = this.context.getLocationFromChannel(channel);
            if (!currentLocation) {
                logger.warn(`[INTERROGATION] Could not determine location for channel ${channel.name} (${channel.id}) during buffer processing.`);
                return;
            }
            const roomInfo = activeGame.getRoomInfo(currentLocation);
            const roomDescription = roomInfo?.description || '';
            const roomInteractables = roomInfo?.interactables || [];

            const response = await suspect.respond(
                member,
                combinedContent,
                channel,
                activeGame.config.id,
                discoveredEvidence,
                roomDescription,
                roomInteractables,
                activeGame.logger
            );

            // Log the incoming interrogation messages
            messages.forEach(msg => {
                activeGame.logger?.logMessage(member.user.tag, msg);
            });

            if (response) {
                dashboard.addEvent('interrogation',
                    `${member.displayName} questioned ${suspect.data.name}`);

                const stats = this.context.getOrCreateStats(member.id, member.user.username);
                stats.messagesSent++;

                if (response.teamworkBonusActive) {
                    stats.teamworkBonuses++;
                    dashboard.addEvent('tool_use', `🚔 Teamwork bonus! ${member.displayName} and recent investigators are pressuring ${suspect.data.name}`);
                }

                let revealedAnything = false;

                if (response.revealedSecret) {
                    const secretEvidenceId = `secret_${suspect.data.id}_${response.revealedSecret.id}`;
                    discoveredEvidence.add(secretEvidenceId);

                    logger.info(`${suspect.data.name} revealed secret "${response.revealedSecret.id}" Registered as evidence: ${secretEvidenceId}`);
                    dashboard.addEvent('secret_revealed',
                        `${suspect.data.name} revealed: "${response.revealedSecret.text}"`);
                    stats.secretsRevealed++;
                    revealedAnything = true;
                }

                if (response.revealedEvidence && response.revealedEvidence.length > 0) {
                    response.revealedEvidence.forEach(evidenceId => {
                        if (!discoveredEvidence.has(evidenceId)) {
                            discoveredEvidence.add(evidenceId);
                            logger.info(`${suspect.data.name} revealed evidence: ${evidenceId}`);
                            dashboard.addEvent('tool_use', `Conversational evidence acquired: ${evidenceId}`);
                            stats.evidenceFound++;
                            revealedAnything = true;
                        }
                    });
                }

                // SECURITY: Sparkle reaction from Sherbot on evidence reveal
                if (revealedAnything && response.messages && response.messages.length > 0) {
                    try {
                        const lastMsg = response.messages[response.messages.length - 1];
                        if (lastMsg && typeof lastMsg.react === 'function') {
                            await lastMsg.react('✨');
                        }
                    } catch (e) {
                        logger.warn('Failed to react to suspect message:', e);
                    }
                }

                this.context.broadcastDashboardState();
                await this.context.saveState();
            }
        } catch (error) {
            logger.error(`Error processing buffer for ${suspect.data.name}:`, error);
        }
    }
}
