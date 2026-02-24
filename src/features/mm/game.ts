import fs from 'fs';
import path from 'path';
import {
    Client,
    CategoryChannel,
    ChannelType,
    Colors,
    EmbedBuilder,
    Guild,
    Role,
    TextChannel,
    ChatInputCommandInteraction,
    AutocompleteInteraction,
    Message,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} from 'discord.js';
import Case, { CaseConfig, PlayerStats, SuspectState } from './case.js';
import ToolsManager from './tools.js';
import Suspect from './suspect.js';
import DashboardServer from './dashboard.js';
import {
    createStatusEmbed,
    createToolEmbed,
    createAccusationEmbed,
    createHelpEmbed,
    hasPermission,
    denyPermission,
} from './commands.js';
import { logger } from '../../utils/logger.js';
import { MMGame } from '../../database.js';

// New imports
import { InterrogationBuffer } from './types.js';
import {
    getRoomEmoji,
    setChannelVisibility,
    getLocationFromChannel,
    getOrCreateCategory
} from './discord-utils.js';
import InterrogationManager from './interrogation.js';
import { handleStart } from './handlers/start.js';
import { handleStatus } from './handlers/status.js';
import { handleJoin } from './handlers/join.js';
import { handleDNA, handleFootage, handleLogs, handleSearch, handleExamine, handlePresent, handleEvidence } from './handlers/tools.js';
import { handleAccuse } from './handlers/accuse.js';

/**
 * Game Manager - orchestrates the entire murder mystery game
 */
export default class GameManager {
    private static instances: Map<string, GameManager> = new Map();
    private client: Client;
    private dataDir: string;
    private guildId: string;
    private roleId: string = '1061067650651926669';
    private activeGame: Case | null = null;
    private tools: ToolsManager | null = null;
    private suspects: Map<string, Suspect> = new Map();
    private category: CategoryChannel | null = null;
    private channels: Map<string, TextChannel> = new Map();
    private timerInterval: NodeJS.Timeout | null = null;
    private dashboard: DashboardServer;
    private interrogationManager: InterrogationManager;
    private activeExplorations: Set<string> = new Set(); // Track channel IDs being explored

    public static DEBUG_VISIBILITY = true;

    constructor(client: Client, guildId: string, dataDir: string = 'data') {
        this.client = client;
        this.guildId = guildId;
        this.dataDir = dataDir;

        // Start dashboard server
        this.dashboard = new DashboardServer(this.client, 3001);
        this.dashboard.start();

        // Initialize interrogation manager
        this.interrogationManager = new InterrogationManager(this.client, {
            getActiveGame: () => this.activeGame,
            getSuspects: () => this.suspects,
            getDiscoveredEvidence: () => this.getDiscoveredEvidence(),
            getDashboard: () => this.dashboard,
            broadcastDashboardState: () => this.broadcastDashboardState(),
            getOrCreateStats: (userId, username) => this.getOrCreateStats(userId, username),
            getLocationFromChannel: (channel) => this.getLocationFromChannel(channel),
            isParticipant: (userId) => this.isParticipant(userId)
        });

        GameManager.instances.set(guildId, this);
    }

    public static getInstance(guildId?: string): GameManager | null {
        if (!guildId) return null;
        return GameManager.instances.get(guildId) || null;
    }

    /**
     * Purge all ephemeral state (locks, buffers, etc)
     */
    public purgeEphemeralState(): void {
        this.activeExplorations.clear();
        this.interrogationManager.clearBuffers();
        logger.debug(`Ephemeral state purged for guild ${this.guildId}`);
    }

    /**
     * Check if a user is joined in the current investigation
     */
    public isParticipant(userId: string): boolean {
        return !!this.activeGame?.state?.participants.has(userId);
    }

    // --- GETTERS & SETTERS FOR HANDLERS ---
    public getActiveGame() { return this.activeGame; }
    public setActiveGame(game: Case | null) { this.activeGame = game; }
    public getTools() { return this.tools; }
    public setTools(tools: ToolsManager | null) { this.tools = tools; }
    public getSuspectsMap() { return this.suspects; }

    /**
     * Helper to find a suspect by their exact ID, alias, or fuzzy matched name/ID
     * Returns an array of matches. If there is an exact match, it returns an array of length 1.
     */
    public getSuspectByFuzzyMatch(query: string): Suspect[] {
        // Try exact match first
        const idQuery = query.toLowerCase().replace(/[^a-z0-9]/g, '');
        let exactMatch = this.suspects.get(query) || this.suspects.get(idQuery);
        if (exactMatch) return [exactMatch];

        // Try fuzzy match
        const matches = new Set<Suspect>();
        for (const [id, suspect] of this.suspects.entries()) {
            const rawId = id.replace(/[^a-z0-9]/g, '');
            const rawName = suspect.data.name.toLowerCase().replace(/[^a-z0-9]/g, '');

            if (rawId === idQuery || rawName === idQuery) {
                matches.add(suspect); // Strong match
            } else if (rawId.includes(idQuery) || rawName.includes(idQuery) || idQuery.includes(rawName)) {
                matches.add(suspect); // Weak match
            }
        }
        return Array.from(matches);
    }

    public getChannelsMap() { return this.channels; }
    public getDashboard() { return this.dashboard; }
    public getClient() { return this.client; }

    /**
     * Exploration state management
     */
    public isExploring(channelId: string): boolean {
        return this.activeExplorations.has(channelId);
    }

    public setExploring(channelId: string, active: boolean) {
        if (active) this.activeExplorations.add(channelId);
        else this.activeExplorations.delete(channelId);
    }

    /**
     * Get the guild
     */
    public async getGuild(): Promise<Guild> {
        const guild = await this.client.guilds.fetch(this.guildId);
        if (!guild) throw new Error(`Guild ${this.guildId} not found`);
        return guild;
    }

    /**
     * List available cases
     */
    public listCases(): string[] {
        const casesDir = path.join(this.dataDir, 'cases');
        if (!fs.existsSync(casesDir)) return [];

        return fs.readdirSync(casesDir)
            .filter(f => {
                const casePath = path.join(casesDir, f, 'case.json');
                return fs.existsSync(casePath);
            });
    }

    public getDiscoveredEvidence() {
        return this.activeGame?.state?.discoveredEvidence || new Set<string>();
    }
    public addDiscoveredEvidence(evidenceId: string) {
        if (this.activeGame?.state) {
            this.activeGame.state.discoveredEvidence.add(evidenceId.toLowerCase());
        }
    }

    /**
     * Load a case by ID
     */
    public loadCase(caseId: string): Case {
        const caseDir = path.join(this.dataDir, 'cases', caseId);
        return Case.load(caseDir);
    }

    // --- DELEGATED HANDLERS ---
    async startGame(interaction: ChatInputCommandInteraction, caseId: string, timeOverride?: number) {
        logger.info(`Starting new game: ${caseId} (Guild: ${this.guildId}, Initiator: ${interaction.user.tag})`);
        return handleStart(this, interaction, caseId, timeOverride);
    }

    async handleStatus(interaction: ChatInputCommandInteraction) {
        return handleStatus(this, interaction);
    }

    async handleJoin(interaction: ChatInputCommandInteraction) {
        logger.info(`Player joining investigation: ${interaction.user.tag} (Guild: ${this.guildId})`);
        return handleJoin(this, interaction);
    }

    async handleDNA(interaction: ChatInputCommandInteraction) {
        return handleDNA(this, interaction);
    }

    async handleFootage(interaction: ChatInputCommandInteraction) {
        return handleFootage(this, interaction);
    }

    async handleLogs(interaction: ChatInputCommandInteraction) {
        return handleLogs(this, interaction);
    }

    async handleSearch(interaction: ChatInputCommandInteraction) {
        return handleSearch(this, interaction);
    }

    async handleEvidence(interaction: ChatInputCommandInteraction) {
        return handleEvidence(this, interaction);
    }

    async handleExamine(interaction: ChatInputCommandInteraction) {
        return handleExamine(this, interaction);
    }

    async handlePresent(interaction: ChatInputCommandInteraction) {
        return handlePresent(this, interaction);
    }

    async handleAccuse(interaction: ChatInputCommandInteraction) {
        return handleAccuse(this, interaction);
    }

    // --- SHARED UTILITIES ---
    public getOrCreateStats(userId: string, username: string): PlayerStats {
        if (!this.activeGame?.state) throw new Error('No active game state');

        if (!this.activeGame.state.playerStats[userId]) {
            this.activeGame.state.playerStats[userId] = {
                userId, username,
                roomsDiscovered: 0, evidenceFound: 0,
                secretsRevealed: 0, messagesSent: 0, toolsUsed: 0,
                teamworkBonuses: 0
            };
        }
        return this.activeGame.state.playerStats[userId];
    }

    public getLocationFromChannel(channel: TextChannel): string | null {
        // 1. Primary: Use the internal map for 100% reliability
        for (const [locId, ch] of this.channels.entries()) {
            if (ch.id === channel.id) return locId;
        }

        // 2. Fallback: Parse topic (useful during restoration or manual edits)
        return getLocationFromChannel(channel);
    }

    public async setupChannels(config: CaseConfig, existingCategoryId?: string): Promise<void> {
        const guild = await this.getGuild();
        const categoryName = `🔍 ${config.name}`;

        this.category = await getOrCreateCategory(guild, categoryName, existingCategoryId);

        this.channels.clear();

        // 2. Briefing Channel
        const briefingDef = { name: '📋┃case-briefing', topic: 'Case information and victim details' };
        let briefingChannel = this.category.children.cache.find(c =>
            c.name === briefingDef.name || (c.type === ChannelType.GuildText && c.topic?.includes(briefingDef.topic))
        ) as TextChannel | undefined;

        if (!briefingChannel) {
            briefingChannel = await this.category.children.create({
                name: briefingDef.name,
                type: ChannelType.GuildText,
                topic: briefingDef.topic,
            });
        } else {
            // Update topic if needed
            if (briefingChannel.topic !== briefingDef.topic) await briefingChannel.setTopic(briefingDef.topic);
        }
        this.channels.set('case-briefing', briefingChannel);

        // 3. Location Channels
        const locations = this.activeGame?.getValidLocations() || [];
        for (const loc of locations) {
            const suspectsHere = config.suspects.filter(s => s.currentLocation === loc);
            const suspectNames = suspectsHere.map(s => s.name).join(', ');

            let topic = `Location: ${loc.replace(/_/g, ' ')}`;
            let icon = getRoomEmoji(loc);
            let name = `${icon}┃${loc.replace(/_/g, '-')}`;

            if (suspectNames) {
                topic += ` | 👥 Present: ${suspectNames} | Say "Hey [Name]" to interrogate`;
                const suspectSuffix = suspectsHere.map(s => s.name.toLowerCase()).join('-');
                name = `${icon}┃${loc.replace(/_/g, '-')}-${suspectSuffix.split(' ')[0]}┃👥`;
            } else {
                topic += ` | Area is clear`;
            }
            // topic += ` | /mm explore to search`;

            const locTag = `Location: ${loc.replace(/_/g, ' ')}`;
            let channel = this.category.children.cache.find(c => {
                if (c.type !== ChannelType.GuildText) return false;
                const txt = c as TextChannel;
                return txt.topic?.includes(locTag) || txt.name === name;
            }) as TextChannel | undefined;

            // const isDiscovered = !!(this.activeGame?.state?.discoveredLocations.has(loc));
            const isDiscovered = true; // All rooms visible by default
            const isMurderLoc = this.activeGame?.config.murderLocation === loc;

            if (!channel) {
                // Creation: Set EVERYTHING at once to avoid rate limit race conditions
                let fullTopic = topic;
                if (GameManager.DEBUG_VISIBILITY) {
                    fullTopic = `[${isDiscovered ? '🔓 OPEN' : '🔒 LOCKED'}] ${topic}`;
                }

                channel = await this.category.children.create({
                    name: name,
                    type: ChannelType.GuildText,
                    topic: fullTopic,
                    permissionOverwrites: [
                        {
                            id: guild.id,
                            deny: (isDiscovered || isMurderLoc) ? [] : ['ViewChannel'],
                            allow: (isDiscovered || isMurderLoc) ? ['ViewChannel'] : [],
                            // For murder loc if undiscovered, we also need to deny send
                        }
                    ]
                });

                // If murder loc and undiscovered, we need to explicitly sync perms after creation if creation simple logic wasn't enough
                if (isMurderLoc && !isDiscovered) {
                    await setChannelVisibility(channel, isDiscovered, topic, GameManager.DEBUG_VISIBILITY, isMurderLoc);
                }

            } else {
                // Optimization: Apply updates only if they changed
                if (channel.name !== name) {
                    await channel.setName(name);
                    channel.name = name;
                }

                // Sync topic and permissions
                await setChannelVisibility(channel, isDiscovered, topic, GameManager.DEBUG_VISIBILITY, isMurderLoc);
            }

            this.channels.set(loc, channel);
        }
    }

    public startTimer(): void {
        this.stopTimer();
        this.timerInterval = setInterval(async () => {
            if (!this.activeGame || !this.activeGame.isActive()) {
                this.stopTimer();
                await this.handleTimeout();
            }
        }, 10000);
    }

    public stopTimer(): void {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    public startInterrogationListener(): void {
        this.interrogationManager.startListener();
    }

    public stopInterrogationListener(): void {
        this.interrogationManager.stopListener();
    }

    private async handleTimeout(): Promise<void> {
        if (!this.activeGame?.state || this.activeGame.state.phase !== 'investigating') return;

        this.activeGame.end();
        // const killer = this.activeGame.getSuspect(this.activeGame.config.solution);
        const embed = new EmbedBuilder()
            .setColor(Colors.DarkRed)
            .setTitle('⏰ OPERATION ABORTED: TIME EXPIRED')
            .setDescription(`\`\`\`ansi\n\u001b[1;31m[!] CRITICAL FAILURE: INVESTIGATION WINDOW CLOSED\u001b[0m\n\`\`\`\nThe trail has gone cold. The killer has vanished into the shadows, leaving no further trace.\n\nYour detective credentials have been temporarily suspended pending an internal review.`);

        const investigationChannel = this.channels.get('case-briefing');
        if (investigationChannel) await investigationChannel.send({ embeds: [embed] });
        this.purgeEphemeralState();
        await this.saveState();
    }

    public parseTimeToMinutes(time: string): number {
        if (!time.includes(':')) return 0;
        const [hours, minutes] = time.split(':').map(t => Number(t.trim()));
        return (hours || 0) * 60 + (minutes || 0);
    }

    public createFootageButtons(currentIndex: number, allTimes: string[]): ActionRowBuilder<ButtonBuilder> | null {
        if (allTimes.length <= 1) return null;
        const row = new ActionRowBuilder<ButtonBuilder>();
        if (currentIndex > 0) {
            row.addComponents(new ButtonBuilder()
                .setCustomId(`mm_footage_${allTimes[currentIndex - 1]}`)
                .setLabel('⬅️ Previous')
                .setStyle(ButtonStyle.Secondary));
        }
        if (currentIndex < allTimes.length - 1) {
            row.addComponents(new ButtonBuilder()
                .setCustomId(`mm_footage_${allTimes[currentIndex + 1]}`)
                .setLabel('Next ➡️')
                .setStyle(ButtonStyle.Secondary));
        }
        return row.components.length > 0 ? row : null;
    }

    public createLogsButtons(currentIndex: number, allTimes: string[]): ActionRowBuilder<ButtonBuilder> | null {
        if (allTimes.length <= 1) return null;
        const row = new ActionRowBuilder<ButtonBuilder>();
        if (currentIndex > 0) {
            row.addComponents(new ButtonBuilder()
                .setCustomId(`mm_logs_${allTimes[currentIndex - 1]}`)
                .setLabel('⬅️ Previous')
                .setStyle(ButtonStyle.Success)); // Green for logs
        }
        if (currentIndex < allTimes.length - 1) {
            row.addComponents(new ButtonBuilder()
                .setCustomId(`mm_logs_${allTimes[currentIndex + 1]}`)
                .setLabel('Next ➡️')
                .setStyle(ButtonStyle.Success));
        }
        return row.components.length > 0 ? row : null;
    }

    async handleEnd(interaction: ChatInputCommandInteraction) {
        logger.info(`Game manually ended by ${interaction.user.tag} (Guild: ${this.guildId})`);
        if (!hasPermission(interaction)) {
            await denyPermission(interaction);
            return;
        }

        if (!this.activeGame) {
            await interaction.reply({ content: 'No active game.', ephemeral: true });
            return;
        }
        this.activeGame.end();
        this.stopTimer();
        this.purgeEphemeralState();
        await interaction.reply('Investigation terminated.');
        await this.saveState();
        this.broadcastDashboardState();
    }

    /**
     * Delete all game-related categories and channels
     */
    public async cleanupAllGameChannels(): Promise<number> {
        const guild = await this.getGuild();
        let deletedCount = 0;

        // Find all categories starting with 🔍 or 🔎
        const categories = guild.channels.cache.filter(c =>
            c.type === ChannelType.GuildCategory &&
            (c.name.startsWith('🔍') || c.name.startsWith('🔎'))
        );

        for (const [id, category] of categories) {
            const cat = category as CategoryChannel;
            // Delete all children first
            for (const [childId, child] of cat.children.cache) {
                try {
                    await child.delete();
                    deletedCount++;
                } catch (e) {
                    logger.error(`Failed to delete channel ${child.name}`, e);
                }
            }
            // Delete category
            try {
                await cat.delete();
                deletedCount++;
            } catch (e) {
                logger.error(`Failed to delete category ${cat.name}`, e);
            }
        }

        this.channels.clear();
        this.category = null;
        return deletedCount;
    }

    /**
     * Handle /mm cleanup command
     */
    async handleCleanup(interaction: ChatInputCommandInteraction) {
        logger.info(`Cleanup requested by ${interaction.user.tag} (Guild: ${this.guildId})`);
        if (!hasPermission(interaction)) {
            await denyPermission(interaction);
            return;
        }

        await interaction.deferReply({ ephemeral: true });
        const count = await this.cleanupAllGameChannels();
        logger.info(`Cleanup completed. Removed ${count} items.`);
        await interaction.editReply(`🧹 Cleanup complete! Removed **${count}** items.`);
    }

    async handleHelp(interaction: ChatInputCommandInteraction) {
        await interaction.reply({ embeds: [createHelpEmbed()], ephemeral: true });
    }

    async handleSuspects(interaction: ChatInputCommandInteraction) {
        if (!this.activeGame) {
            await interaction.reply({ content: 'No active game.', ephemeral: true });
            return;
        }
        const suspects = this.activeGame.config.suspects;
        const embed = new EmbedBuilder()
            .setColor(Colors.Blurple)
            .setTitle('👥 Investigation Suspects')
            .setDescription(suspects.map(s => `• **${s.name}** - ${s.alibi}`).join('\n'));
        await interaction.reply({ embeds: [embed] });
    }

    async handleSecrets(interaction: ChatInputCommandInteraction) {
        if (!this.activeGame) {
            await interaction.reply({ content: 'No active game.', ephemeral: true });
            return;
        }

        const suspects = this.activeGame.config.suspects;
        let totalSecrets = 0;
        let discoveredCount = 0;

        const embed = new EmbedBuilder()
            .setColor(Colors.Purple)
            .setTitle('🤫 Confidential Dossier: Discovered Secrets')
            .setDescription('Intel extracted from suspects during interrogation will appear here.');

        let hasDiscovered = false;

        for (const sData of suspects) {
            // Count totals
            totalSecrets += sData.secrets.length;

            const suspect = this.suspects.get(sData.id);
            if (!suspect) continue;

            const state = suspect.getState();
            discoveredCount += state.revealedSecrets.length;

            if (state.revealedSecrets.length > 0) {
                hasDiscovered = true;
                const secretTexts = state.revealedSecrets.map(secretId => {
                    const secretDef = sData.secrets.find(s => s.id === secretId);
                    if (!secretDef) return null;

                    // Add emoji based on how critical it is? For now just bullet
                    return `🔓 **${secretDef.id.replace(/_/g, ' ')}**: ${secretDef.text}`;
                }).filter(Boolean).join('\n');

                if (secretTexts) {
                    embed.addFields({
                        name: `👤 ${sData.name} (${state.revealedSecrets.length}/${sData.secrets.length})`,
                        value: secretTexts,
                        inline: false
                    });
                }
            } else {
                // Check if we show empty suspects - maybe just show they are hiding things
                if (state.defensiveness > 70) {
                    embed.addFields({
                        name: `👤 ${sData.name}`,
                        value: '*Analysis: Suspect is withholding information (High Defensiveness)*',
                        inline: false
                    });
                }
            }
        }

        if (!hasDiscovered) {
            embed.setDescription('❌ No secrets have been revealed yet.\n\n*Tip: Cross-reference suspect alibis with evidence to apply pressure.*');
        }

        const progressPercent = Math.round((discoveredCount / totalSecrets) * 100);
        embed.setFooter({ text: `Investigation Progress: ${progressPercent}% of potential intelligence recovered` });

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    async handleAutocomplete(interaction: AutocompleteInteraction) {
        const focused = interaction.options.getFocused(true);
        if (focused.name === 'case') {
            const cases = this.listCases();
            await interaction.respond(cases.map(c => ({ name: c, value: c })));
        } else if (focused.name === 'location') {
            if (!this.activeGame) return;
            const locations = this.activeGame.getValidLocations();
            await interaction.respond(locations.map(l => ({ name: l.replace(/_/g, ' '), value: l })));
        } else if (focused.name === 'suspect') {
            if (!this.activeGame) return;
            const suspects = this.activeGame.config.suspects;
            await interaction.respond(suspects.map(s => ({ name: s.name, value: s.id })));
        } else if (focused.name === 'item') {
            if (!this.activeGame?.state) return;
            const items = Array.from(this.activeGame.state.discoveredEvidence)
                .filter(e => e.startsWith('physical_'))
                .map(e => e.replace('physical_', ''));

            await interaction.respond(items.map(i => ({ name: i.replace(/_/g, ' '), value: i } as { name: string, value: string })));
        } else if (focused.name === 'evidence') {
            // For /mm present - show ALL discovered evidence
            if (!this.activeGame?.state) return;
            const allEvidence = Array.from(this.activeGame.state.discoveredEvidence)
                .slice(0, 25) // Discord limit
                .map((e: string) => ({
                    name: e.replace(/_/g, ' ').substring(0, 100) as string,
                    value: e as string
                }));

            await interaction.respond(allEvidence);
        } else if (focused.name === 'time') {
            if (!this.activeGame?.state) return;
            const allDiscovered = Array.from(this.activeGame.state.discoveredEvidence);
            const logTimes = allDiscovered
                .filter(e => e.startsWith('logs_'))
                .map(e => e.replace('logs_', ''))
                .sort();

            // Autocomplete filtering happens client side mostly, but we can help
            const filtered = logTimes.filter(t => t.startsWith(focused.value));
            await interaction.respond(filtered.map(t => ({ name: t, value: t })));
        }
    }

    public async saveState(): Promise<void> {
        if (!this.activeGame?.state) return;
        const state = this.activeGame.state;

        // Collect suspect states
        const suspectStates: Record<string, SuspectState> = {};
        for (const [id, suspect] of this.suspects) {
            // Only store by ID once (skip aliases)
            if (!this.activeGame.config.suspects.some(s => s.id === id)) continue;
            suspectStates[id] = suspect.getState();
        }

        try {
            await MMGame.upsert({
                guildId: this.guildId,
                caseId: state.caseId,
                categoryId: this.category?.id || '',
                roleId: this.roleId,
                points: state.points,
                phase: state.phase,
                endsAt: state.endsAt,
                participants: JSON.stringify(Array.from(state.participants)),
                usedTools: JSON.stringify(state.usedTools),
                discoveredEvidence: JSON.stringify(Array.from(state.discoveredEvidence)),
                discoveredLocations: JSON.stringify(Array.from(state.discoveredLocations)),
                playerStats: JSON.stringify(state.playerStats),
                accusations: JSON.stringify(state.accusations),
                suspectState: JSON.stringify(suspectStates)
            });
            logger.debug(`Game state saved: ${state.caseId} (Guild: ${this.guildId})`);
        } catch (e) {
            logger.error('Failed to save game state', e);
        }
    }

    public async restoreGames(): Promise<void> {
        try {
            logger.info(`Checking for active Murder Mystery games for guild ${this.guildId}...`);
            const saved = await MMGame.findOne({ where: { guildId: this.guildId } });

            if (!saved) {
                logger.info(`No saved game found for guild ${this.guildId}.`);
                return;
            }

            if (saved.phase === 'ended') {
                logger.info(`Last game in ${this.guildId} was already ended.`);
                return;
            }

            logger.info(`Restoring investigation: ${saved.caseId}...`);

            const newCase = this.loadCase(saved.caseId);
            const now = new Date();

            newCase.state = {
                caseId: saved.caseId,
                difficulty: 'sherlock', // Default difficulty for restoration
                startedAt: saved.createdAt || now,
                endsAt: saved.endsAt,
                points: saved.points,
                participants: new Set(JSON.parse(saved.participants || '[]')),
                playerStats: JSON.parse(saved.playerStats || '{}'),
                suspectState: JSON.parse(saved.suspectState || '{}'),
                usedTools: JSON.parse(saved.usedTools || '[]'),
                phase: saved.phase as any,
                discoveredLocations: new Set(JSON.parse(saved.discoveredLocations || '[]')),
                discoveredEvidence: new Set(JSON.parse(saved.discoveredEvidence || '[]')),
                accusations: JSON.parse(saved.accusations || '{}')
            };

            this.activeGame = newCase;
            this.tools = new ToolsManager(newCase);
            this.suspects.clear();
            for (const suspectData of newCase.config.suspects) {
                const suspect = new Suspect(suspectData);

                // Restore suspect state
                const savedSState = newCase.state.suspectState[suspect.data.id];
                if (savedSState) {
                    suspect.loadState(savedSState);
                }

                // Sync known evidence
                if (newCase.state?.discoveredEvidence) {
                    for (const eId of newCase.state.discoveredEvidence) {
                        suspect.addDiscoveredEvidence(eId);
                    }
                }

                this.suspects.set(suspectData.id, suspect);
                for (const alias of suspectData.alias) this.suspects.set(alias.toLowerCase(), suspect);
            }

            // Sync with Discord
            logger.debug(`Fetching guild and channels for ${this.guildId}...`);
            const guild = this.client.guilds.cache.get(this.guildId) || await this.client.guilds.fetch(this.guildId);
            await guild.channels.fetch();

            await this.setupChannels(newCase.config, saved.categoryId);

            this.startInterrogationListener();
            this.startTimer();
            this.broadcastDashboardState();
            logger.info(`✅ Murder Mystery session fully restored for: ${saved.caseId}`);
        } catch (e) {
            logger.error('❌ Failed to restore MM session:', e);
        }
    }

    public broadcastDashboardState(): void {
        const state = this.dashboard.buildGameState(this.activeGame, this.suspects, this.getDiscoveredEvidence());
        this.dashboard.updateState(state);
    }
}
