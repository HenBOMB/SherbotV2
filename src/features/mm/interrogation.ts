import {
    Client,
    Message,
    TextChannel,
    GuildMember
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
                // Ignore bots
                if (message.author.bot) return;

                // SECURITY: Only participants can trigger interrogation responses
                if (!this.context.isParticipant(message.author.id)) return;

                // Check if active game
                const activeGame = this.context.getActiveGame();
                if (!activeGame?.isActive()) return;

                const content = message.content.trim();
                if (!content) return;

                // Detect Location using the new robust method
                const channel = message.channel instanceof TextChannel ? message.channel : null;
                if (!channel) return;

                const currentLocation = this.context.getLocationFromChannel(channel);
                if (!currentLocation) return;

                // Check if there is an active buffer for this channel
                const existingBuffer = this.interrogationBuffers.get(message.channelId);

                // Check if this message mentions a suspect
                const mentionedSuspect = this.findMentionedSuspect(content);

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
                        }, 2000);
                        return;
                    }
                }

                if (!mentionedSuspect) return;

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
                    }, 2000)
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
                const regex = new RegExp(`\\b${escapeName(name)}\\b`, 'i');
                const match = regex.exec(content);
                if (match) {
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

            const response = await suspect.respond(
                member,
                combinedContent,
                channel,
                activeGame.config.id,
                discoveredEvidence
            );

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
            }
        } catch (error) {
            logger.error(`Error processing buffer for ${suspect.data.name}:`, error);
        }
    }
}
