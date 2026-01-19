import fs from 'fs';
import path from 'path';
import {
    Client,
    CategoryChannel,
    ChannelType,
    Colors,
    EmbedBuilder,
    Guild,
    OverwriteType,
    PermissionFlagsBits,
    Role,
    TextChannel,
    ChatInputCommandInteraction,
    AutocompleteInteraction,
    Message,
    GuildMember,
} from 'discord.js';
import Case, { CaseConfig, SuspectData } from './case.js';
import ToolsManager from './tools.js';
import Suspect from './suspect.js';
import DashboardServer from './dashboard.js';
import {
    hasPermission,
    denyPermission,
    createStatusEmbed,
    createToolEmbed,
    createAccusationEmbed,
    createHelpEmbed,
    formatTime,
} from './commands.js';
import { logger } from '../../utils/logger.js';
import { MMGame } from '../../database.js';

/**
 * Game Manager - orchestrates the entire murder mystery game
 */
export default class GameManager {
    private client: Client;
    private dataDir: string;
    private guildId: string;
    private roleId: string;
    private activeGame: Case | null = null;
    private tools: ToolsManager | null = null;
    private suspects: Map<string, Suspect> = new Map();
    private category: CategoryChannel | null = null;
    private channels: Map<string, TextChannel> = new Map();
    private timerInterval: NodeJS.Timeout | null = null;
    private messageHandler: ((message: Message) => Promise<void>) | null = null;
    private interrogationBuffers: Map<string, {
        suspect: Suspect,
        messages: string[],
        timer: NodeJS.Timeout,
        member: GuildMember,
        channel: TextChannel
    }> = new Map();
    private discoveredEvidence: Set<string> = new Set();
    private dashboard: DashboardServer;

    constructor(client: Client, guildId: string, dataDir: string = 'data') {
        this.client = client;
        this.guildId = guildId;
        this.dataDir = dataDir;
        this.roleId = '1061067650651926669';

        // Start dashboard server
        this.dashboard = new DashboardServer(3001);
        this.dashboard.start();
    }

    /**
     * Get the guild
     */
    private async getGuild(): Promise<Guild> {
        const guild = await this.client.guilds.fetch(this.guildId);
        if (!guild) throw new Error(`Guild ${this.guildId} not found`);
        return guild;
    }

    /**
     * List available cases
     */
    listCases(): string[] {
        const casesDir = path.join(this.dataDir, 'cases');
        if (!fs.existsSync(casesDir)) return [];

        return fs.readdirSync(casesDir)
            .filter(f => {
                const casePath = path.join(casesDir, f, 'case.json');
                return fs.existsSync(casePath);
            });
    }

    /**
     * Load a case by ID
     */
    loadCase(caseId: string): Case {
        const caseDir = path.join(this.dataDir, 'cases', caseId);
        return Case.load(caseDir);
    }

    /**
     * Start a new game
     */
    async startGame(
        interaction: ChatInputCommandInteraction,
        caseId: string,
        timeOverride?: number
    ): Promise<void> {
        if (!hasPermission(interaction)) {
            await denyPermission(interaction);
            return;
        }

        if (this.activeGame?.isActive()) {
            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(Colors.Orange)
                        .setTitle('⚠️ Game in Progress')
                        .setDescription('A game is already running. End it first with `/mm end`.')
                ],
                ephemeral: true,
            });
            return;
        }

        try {
            await interaction.deferReply();

            // Load the case
            const newCase = this.loadCase(caseId);

            // Override time if specified
            if (timeOverride && timeOverride > 0) {
                newCase.config.settings.timeLimit = timeOverride;
            }

            // Start the game with the command user as first participant
            const userId = interaction.user.id;
            newCase.start([userId]);

            this.activeGame = newCase;
            this.tools = new ToolsManager(newCase);

            // Initialize suspects from case data
            this.suspects.clear();
            for (const suspectData of newCase.config.suspects) {
                const suspect = new Suspect(suspectData);
                this.suspects.set(suspectData.id, suspect);
                // Also map by aliases for easier lookup
                for (const alias of suspectData.alias) {
                    this.suspects.set(alias.toLowerCase(), suspect);
                }
            }

            // Create game channels
            await this.setupChannels(newCase.config);

            // Save initial state to database
            await this.saveState();

            // Start interrogation listener
            this.startInterrogationListener();

            // Start timer
            this.startTimer();

            // Send start message
            const embed = new EmbedBuilder()
                .setColor(Colors.Gold)
                .setTitle(`🔪 ${newCase.config.name}`)
                .setDescription(newCase.config.description)
                .addFields(
                    { name: '💀 Victim', value: `${newCase.config.victim.name} (${newCase.config.victim.cause})`, inline: true },
                    { name: '🕐 Murder Time', value: newCase.config.murderTime, inline: true },
                    { name: '📍 Location', value: newCase.config.murderLocation, inline: true },
                )
                .addFields(
                    { name: '⏱️ Time Limit', value: `${newCase.config.settings.timeLimit} minutes`, inline: true },
                    { name: '💎 Points', value: newCase.config.settings.startingPoints.toString(), inline: true },
                )
                .addFields({
                    name: '👥 Suspects',
                    value: newCase.config.suspects.map(s => `• **${s.name}**`).join('\n'),
                })
                .setFooter({ text: 'Use /mm status to check progress • /mm accuse to solve the case' })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

            // Update dashboard
            this.broadcastDashboardState();
            this.dashboard.addEvent('game_start', `Game started: ${newCase.config.name}`);

            logger.info(`Murder Mystery game started: ${caseId} by ${interaction.user.tag}`);
        } catch (error) {
            logger.error('Failed to start game:', error);
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(Colors.Red)
                        .setTitle('❌ Failed to Start Game')
                        .setDescription(`Could not load case "${caseId}". Check if it exists.`)
                ],
            });
        }
    }

    /**
     * Setup game channels in a category
     */
    private async setupChannels(config: CaseConfig): Promise<void> {
        const guild = await this.getGuild();
        const categoryName = `🔍 ${config.name}`;

        // Find or create category
        let category = guild.channels.cache.find(
            c => c.name === categoryName && c.type === ChannelType.GuildCategory
        ) as CategoryChannel | undefined;

        if (!category) {
            category = await guild.channels.create({
                name: categoryName,
                type: ChannelType.GuildCategory,
                position: 0,
            });
        }

        this.category = category;

        // Create channels
        const channelDefs = [
            { name: '📋┃case-briefing', topic: 'Case information and victim details' },
            { name: '🔍┃investigation', topic: 'Use detective tools here' },
            { name: '💬┃interrogation', topic: 'Talk to suspects' },
        ];

        for (const def of channelDefs) {
            let channel = category.children.cache.find(c => c.name === def.name) as TextChannel | undefined;

            if (!channel) {
                channel = await category.children.create({
                    name: def.name,
                    type: ChannelType.GuildText,
                    topic: def.topic,
                });
            }

            this.channels.set(def.name, channel);
        }
    }

    /**
     * Start the game timer
     */
    private startTimer(): void {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
        }

        this.timerInterval = setInterval(async () => {
            if (!this.activeGame || !this.activeGame.isActive()) {
                this.stopTimer();
                await this.handleTimeout();
            }
        }, 10000); // Check every 10 seconds
    }

    /**
     * Stop the timer
     */
    private stopTimer(): void {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    /**
     * Start listening for interrogation messages
     */
    private startInterrogationListener(): void {
        this.stopInterrogationListener();

        const interrogationChannel = this.channels.get('💬┃interrogation');
        if (!interrogationChannel) return;

        this.messageHandler = async (message: Message) => {
            try {
                // Ignore bots and messages outside interrogation channel
                if (message.author.bot) return;
                if (message.channelId !== interrogationChannel.id) return;
                if (!this.activeGame?.isActive()) return;

                const content = message.content.trim();
                if (!content) return;

                // Check if there is an active buffer for this channel
                const existingBuffer = this.interrogationBuffers.get(message.channelId);

                // Check if this message mentions a suspect
                const mentionedSuspect = this.findMentionedSuspect(content);

                if (existingBuffer) {
                    // If a DIFFERENT suspect is mentioned, process the old buffer first
                    if (mentionedSuspect && mentionedSuspect.data.id !== existingBuffer.suspect.data.id) {
                        // Clear the timer and process immediately
                        clearTimeout(existingBuffer.timer);
                        await this.processBuffer(message.channelId);
                        // Continue below to start a new buffer for the new suspect
                    } else {
                        // Same suspect or no suspect mentioned - add to existing buffer
                        existingBuffer.messages.push(content);

                        // Reset the timer to extend the collection window
                        clearTimeout(existingBuffer.timer);
                        existingBuffer.timer = setTimeout(async () => {
                            await this.processBuffer(message.channelId);
                        }, 3000);
                        return;
                    }
                }

                // Need a suspect to start a new buffer
                if (!mentionedSuspect) return;

                if (mentionedSuspect.isBusy) {
                    await message.reply({
                        content: `*${mentionedSuspect.data.name} is busy responding to someone else...*`,
                    });
                    return;
                }

                // Get member
                const member = message.member;
                if (!member) return;

                // Create buffer for collecting messages
                const buffer = {
                    suspect: mentionedSuspect,
                    messages: [content],
                    member,
                    channel: interrogationChannel,
                    timer: setTimeout(async () => {
                        await this.processBuffer(message.channelId);
                    }, 3000)
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
     * Find a suspect mentioned anywhere in the message content
     * Uses word boundary matching to prevent partial matches
     * Prioritizes the suspect whose name appears EARLIEST in the message
     */
    private findMentionedSuspect(content: string): Suspect | null {
        const processedIds = new Set<string>();
        const contentLower = content.toLowerCase();

        // Escape special regex characters in name
        const escapeName = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Track the earliest match
        let earliestMatch: { suspect: Suspect; position: number } | null = null;

        for (const [key, suspect] of this.suspects) {
            // Skip if we've already checked this suspect (aliases create duplicates)
            if (processedIds.has(suspect.data.id)) continue;
            processedIds.add(suspect.data.id);

            // Check suspect's name with word boundaries
            const nameRegex = new RegExp(`\\b${escapeName(suspect.data.name)}\\b`, 'i');
            const nameMatch = nameRegex.exec(content);
            if (nameMatch) {
                if (!earliestMatch || nameMatch.index < earliestMatch.position) {
                    earliestMatch = { suspect, position: nameMatch.index };
                }
            }

            // Check all aliases with word boundaries
            for (const alias of suspect.data.alias) {
                const aliasRegex = new RegExp(`\\b${escapeName(alias)}\\b`, 'i');
                const aliasMatch = aliasRegex.exec(content);
                if (aliasMatch) {
                    if (!earliestMatch || aliasMatch.index < earliestMatch.position) {
                        earliestMatch = { suspect, position: aliasMatch.index };
                    }
                }
            }
        }

        return earliestMatch?.suspect || null;
    }

    /**
     * Process a message buffer and send to suspect
     */
    private async processBuffer(channelId: string): Promise<void> {
        const buffer = this.interrogationBuffers.get(channelId);
        if (!buffer) return;

        // Clear buffer from map immediately
        this.interrogationBuffers.delete(channelId);

        const { suspect, messages, member, channel } = buffer;
        const combinedContent = messages.join('\n');

        try {
            // Respond via suspect, passing discovered evidence
            const response = await suspect.respond(
                member,
                combinedContent,
                channel,
                this.discoveredEvidence
            );

            if (response) {
                logger.info(`${suspect.data.name} responded to ${member.displayName}: ${response.action || 'continue'}`);

                // Dashboard events
                this.dashboard.addEvent('interrogation',
                    `${member.displayName} questioned ${suspect.data.name}`);
                this.broadcastDashboardState();

                if (response.revealedSecret) {
                    logger.info(`${suspect.data.name} revealed secret "${response.revealedSecret.id}" under pressure!`);
                    this.dashboard.addEvent('secret_revealed',
                        `${suspect.data.name} revealed: "${response.revealedSecret.text}"`);
                }
            }
        } catch (error) {
            logger.error(`Error processing buffer for ${suspect.data.name}:`, error);
        }
    }

    /**
     * Stop listening for interrogation messages
     */
    private stopInterrogationListener(): void {
        if (this.messageHandler) {
            this.client.removeListener('messageCreate', this.messageHandler);
            this.messageHandler = null;
        }
    }

    /**
     * Handle game timeout
     */
    private async handleTimeout(): Promise<void> {
        if (!this.activeGame?.state || this.activeGame.state.phase !== 'investigating') return;

        this.activeGame.end();

        const killer = this.activeGame.getSuspect(this.activeGame.config.solution);
        const embed = new EmbedBuilder()
            .setColor(Colors.DarkRed)
            .setTitle('⏰ TIME\'S UP!')
            .setDescription(`The investigation ran out of time.\n\nThe killer was **${killer?.name || 'unknown'}** and they got away!`)
            .setTimestamp();

        const investigationChannel = this.channels.get('🔍┃investigation');
        if (investigationChannel) {
            await investigationChannel.send({ embeds: [embed] });
        }

        // Update database
        await this.saveState();
    }

    /**
     * Handle /mm status command
     */
    async handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!this.activeGame?.state) {
            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(Colors.Grey)
                        .setTitle('No Active Game')
                        .setDescription('Start a game with `/mm start <case>`')
                ],
                ephemeral: true,
            });
            return;
        }

        const state = this.activeGame.state;
        const embed = createStatusEmbed(
            this.activeGame.config.name,
            this.activeGame.getRemainingTime(),
            state.points,
            state.participants.size,
            state.phase
        );

        await interaction.reply({ embeds: [embed] });
    }

    /**
     * Handle /mm join command
     */
    async handleJoin(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!this.activeGame?.state) {
            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(Colors.Grey)
                        .setTitle('No Active Game')
                        .setDescription('No game is currently running.')
                ],
                ephemeral: true,
            });
            return;
        }

        const userId = interaction.user.id;
        if (this.activeGame.state.participants.has(userId)) {
            await interaction.reply({
                content: 'You are already part of the investigation!',
                ephemeral: true,
            });
            return;
        }

        this.activeGame.state.participants.add(userId);
        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(Colors.Green)
                    .setTitle('🔍 Joined Investigation')
                    .setDescription(`Welcome to the team, ${interaction.user.displayName}!`)
            ],
        });

        // Save state to database
        await this.saveState();
    }

    /**
     * Handle /mm dna command
     */
    async handleDNA(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!hasPermission(interaction)) {
            await denyPermission(interaction);
            return;
        }

        if (!this.tools || !this.activeGame?.isActive()) {
            await interaction.reply({ content: 'No active game.', ephemeral: true });
            return;
        }

        const location = interaction.options.getString('location', true);
        const result = this.tools.analyzeDNA(location);

        const embed = createToolEmbed(
            'dna',
            location,
            result.result,
            result.cost,
            result.success,
            result.error
        );

        // Track discovered evidence for interrogation
        if (result.success) {
            this.discoveredEvidence.add(`dna_${location.toLowerCase()}`);
            this.dashboard.addEvent('tool_use', `DNA analyzed at ${location}: ${result.result}`);
            this.broadcastDashboardState();
        }

        await interaction.reply({ embeds: [embed] });
    }

    /**
     * Handle /mm footage command
     */
    async handleFootage(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!hasPermission(interaction)) {
            await denyPermission(interaction);
            return;
        }

        if (!this.tools || !this.activeGame?.isActive()) {
            await interaction.reply({ content: 'No active game.', ephemeral: true });
            return;
        }

        const time = interaction.options.getString('time', true);
        const result = this.tools.viewFootage(time);

        const embed = createToolEmbed(
            'footage',
            time,
            result.result,
            result.cost,
            result.success,
            result.error
        );

        // Track discovered evidence for interrogation
        if (result.success) {
            this.discoveredEvidence.add(`footage_${time}`);
            this.dashboard.addEvent('tool_use', `Footage viewed at ${time}: ${result.result}`);
            this.broadcastDashboardState();
        }

        await interaction.reply({ embeds: [embed] });
    }

    /**
     * Handle /mm locate command
     */
    async handleLocate(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!hasPermission(interaction)) {
            await denyPermission(interaction);
            return;
        }

        if (!this.tools || !this.activeGame?.isActive()) {
            await interaction.reply({ content: 'No active game.', ephemeral: true });
            return;
        }

        const suspect = interaction.options.getString('suspect', true);
        const time = interaction.options.getString('time', true);
        const result = this.tools.trackLocation(suspect, time);

        const embed = createToolEmbed(
            'locate',
            `${suspect} @ ${time}`,
            result.result,
            result.cost,
            result.success,
            result.error
        );

        // Track discovered evidence for interrogation
        if (result.success) {
            this.discoveredEvidence.add(`location_${suspect.toLowerCase()}_${time}`);
            this.dashboard.addEvent('tool_use', `Located ${suspect} at ${time}: ${result.result}`);
            this.broadcastDashboardState();
        }

        await interaction.reply({ embeds: [embed] });
    }

    /**
     * Handle /mm accuse command
     */
    async handleAccuse(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!hasPermission(interaction)) {
            await denyPermission(interaction);
            return;
        }

        if (!this.activeGame?.isActive()) {
            await interaction.reply({ content: 'No active game.', ephemeral: true });
            return;
        }

        const suspectId = interaction.options.getString('suspect', true);
        const suspect = this.activeGame.getSuspect(suspectId);

        if (!suspect) {
            await interaction.reply({
                content: `Unknown suspect: "${suspectId}"`,
                ephemeral: true,
            });
            return;
        }

        await interaction.deferReply();

        const result = this.activeGame.accuse(suspectId);
        this.stopTimer();

        const killer = this.activeGame.getSuspect(result.solution);
        const embed = createAccusationEmbed(
            result.correct,
            suspect.name,
            killer?.name || 'Unknown'
        );

        await interaction.editReply({ embeds: [embed] });

        // Save state (phase 'accused')
        await this.saveState();

        // Reveal all secrets on game end
        await this.revealSecrets(interaction);
    }

    /**
     * Reveal all suspect secrets after game ends
     */
    private async revealSecrets(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!this.activeGame) return;

        const secretsEmbed = new EmbedBuilder()
            .setColor(Colors.Purple)
            .setTitle('📜 Case Secrets Revealed')
            .setDescription('Here\'s what everyone was hiding:');

        for (const suspect of this.activeGame.config.suspects) {
            const role = suspect.isGuilty ? '🔪 KILLER' : '👤 Innocent';
            secretsEmbed.addFields({
                name: `${role} - ${suspect.name}`,
                value: [
                    `**Alibi:** ${suspect.alibi}`,
                    `**Motive:** ${suspect.motive}`,
                    `**Secrets:** ${suspect.secrets.join(', ') || 'None'}`,
                ].join('\n'),
            });
        }

        await interaction.followUp({ embeds: [secretsEmbed] });
    }

    /**
     * Handle /mm end command
     */
    async handleEnd(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!hasPermission(interaction)) {
            await denyPermission(interaction);
            return;
        }

        if (!this.activeGame) {
            await interaction.reply({ content: 'No active game to end.', ephemeral: true });
            return;
        }

        this.activeGame.end();
        this.stopTimer();
        this.stopInterrogationListener();

        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(Colors.Grey)
                    .setTitle('🛑 Game Ended')
                    .setDescription('The investigation has been terminated.')
            ],
        });

        // Remove from database
        try {
            await MMGame.destroy({ where: { guildId: this.guildId } });
        } catch (error) {
            logger.error('Failed to remove game from database:', error);
        }

        // Clean up
        this.activeGame = null;
        this.tools = null;
        this.suspects.clear();
        this.discoveredEvidence.clear();
        this.dashboard.clearState();
        this.dashboard.addEvent('game_end', 'Game ended');
    }

    /**
     * Handle /mm suspects command
     */
    async handleSuspects(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!this.activeGame) {
            await interaction.reply({ content: 'No active game.', ephemeral: true });
            return;
        }

        const suspects = this.activeGame.getSuspectsPublic();
        const embed = new EmbedBuilder()
            .setColor(Colors.Blurple)
            .setTitle('👥 Suspects')
            .setDescription(
                suspects.map(s =>
                    `**${s.name}** (ID: \`${s.id}\`)\n• Aliases: ${s.alias.join(', ')}`
                ).join('\n\n')
            );

        await interaction.reply({ embeds: [embed] });
    }

    /**
     * Handle /mm help command
     */
    async handleHelp(interaction: ChatInputCommandInteraction): Promise<void> {
        const embed = createHelpEmbed();
        await interaction.reply({ embeds: [embed] });
    }

    /**
     * Handle autocomplete interactions
     */
    async handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
        const subcommand = interaction.options.getSubcommand();
        const focusedOption = interaction.options.getFocused(true);

        if (subcommand === 'start' && focusedOption.name === 'case') {
            const cases = this.listCases();
            const filtered = cases
                .filter(c => c.toLowerCase().includes(focusedOption.value.toLowerCase()))
                .slice(0, 25);

            await interaction.respond(
                filtered.map(c => ({ name: c, value: c }))
            );
        } else if ((subcommand === 'locate' || subcommand === 'accuse') && focusedOption.name === 'suspect') {
            if (!this.activeGame) {
                await interaction.respond([]);
                return;
            }

            const suspects = this.activeGame.config.suspects;
            const filtered = suspects
                .filter(s =>
                    s.name.toLowerCase().includes(focusedOption.value.toLowerCase()) ||
                    s.id.toLowerCase().includes(focusedOption.value.toLowerCase())
                )
                .slice(0, 25);

            await interaction.respond(
                filtered.map(s => ({ name: s.name, value: s.id }))
            );
        } else {
            await interaction.respond([]);
        }
    }

    /**
     * Get active game
     */
    getActiveGame(): Case | null {
        return this.activeGame;
    }

    /**
     * Save current game state to database
     */
    async saveState(): Promise<void> {
        if (!this.activeGame?.state || !this.category) return;

        try {
            const state = this.activeGame.state;
            await MMGame.upsert({
                guildId: this.guildId,
                caseId: this.activeGame.config.id,
                categoryId: this.category.id,
                roleId: this.roleId,
                points: state.points,
                phase: state.phase,
                endsAt: state.endsAt,
                participants: JSON.stringify(Array.from(state.participants)),
                usedTools: JSON.stringify(state.usedTools),
            });
        } catch (error) {
            logger.error('Failed to save game state to database:', error);
        }
    }

    /**
     * Restore game from database
     */
    async restoreGames(): Promise<void> {
        try {
            const gameData = await MMGame.findOne({ where: { guildId: this.guildId } });
            if (!gameData) return;

            // Check if game is archived/ended
            if (gameData.phase === 'ended') return;

            logger.info(`Restoring Murder Mystery game for guild ${this.guildId}...`);

            // Load case
            const restoredCase = this.loadCase(gameData.caseId);

            // Set state
            restoredCase.state = {
                caseId: gameData.caseId,
                startedAt: new Date(gameData.createdAt as unknown as string), // Cast to unknown first to fix type error
                endsAt: gameData.endsAt,
                points: gameData.points,
                phase: gameData.phase as any,
                participants: new Set(JSON.parse(gameData.participants || '[]')),
                usedTools: JSON.parse(gameData.usedTools || '[]'),
            };

            this.activeGame = restoredCase;
            this.tools = new ToolsManager(restoredCase);

            // Fetch guild components
            const guild = await this.getGuild();
            this.category = await guild.channels.fetch(gameData.categoryId) as CategoryChannel;

            if (this.category) {
                // Restore channels map
                for (const channel of this.category.children.cache.values()) {
                    if (channel.type === ChannelType.GuildText) {
                        this.channels.set(channel.name, channel as TextChannel);
                    }
                }
            }

            // Restore suspects
            this.suspects.clear();
            for (const suspectData of restoredCase.config.suspects) {
                const suspect = new Suspect(suspectData);
                this.suspects.set(suspectData.id, suspect);
                for (const alias of suspectData.alias) {
                    this.suspects.set(alias.toLowerCase(), suspect);
                }
            }

            // Re-start listeners if still investigating
            if (restoredCase.isActive()) {
                this.startInterrogationListener();
                this.startTimer();
            }

            logger.info(`Successfully restored game: ${restoredCase.config.name}`);

            // Update dashboard
            this.broadcastDashboardState();
        } catch (error) {
            logger.error('Failed to restore game from database:', error);
        }
    }

    /**
     * Build and broadcast current game state to dashboard
     */
    private broadcastDashboardState(): void {
        if (!this.activeGame?.state) return;

        // Get unique suspects (not aliases)
        const uniqueSuspects = new Map<string, Suspect>();
        for (const [id, suspect] of this.suspects) {
            if (id === suspect.data.id) {
                uniqueSuspects.set(id, suspect);
            }
        }

        const state = {
            caseName: this.activeGame.config.name,
            caseId: this.activeGame.config.id,
            phase: this.activeGame.state.phase,
            timeRemaining: this.activeGame.getRemainingTime(),
            points: this.activeGame.state.points,
            participantCount: this.activeGame.state.participants.size,
            suspects: Array.from(uniqueSuspects.values()).map(s => s.getDashboardState()),
            discoveredEvidence: Array.from(this.discoveredEvidence),
        };

        this.dashboard.updateState(state);
    }

    /**
     * Get dashboard server (for external access if needed)
     */
    getDashboard(): DashboardServer {
        return this.dashboard;
    }
}
