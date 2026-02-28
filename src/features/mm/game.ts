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
    ButtonInteraction,
    Message,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    GuildMember,
} from 'discord.js';
import Case, { CaseConfig, PlayerStats, SuspectState } from './case.js';
import ToolsManager from './tools.js';
import Suspect from './suspect.js';
import DashboardServer from './dashboard.js';
import { parseTimeToMinutes as parseTimeUtil } from './utils.js';
import {
    createStatusEmbed,
    createToolEmbed,
    createAccusationEmbed,
    createHelpEmbed,
    hasPermission,
    denyPermission,
} from './commands.js';
import { logger } from '../../utils/logger.js';
import { Server, MMGame, InterrogationLog } from '../../database.js';
import { Op } from 'sequelize';
import { config } from '../../config.js';
import { PermissionFlagsBits } from 'discord.js';

// New imports
import { InterrogationBuffer } from './types.js';
import {
    getRoomEmoji,
    setChannelVisibility,
    getLocationFromChannel,
    getOrCreateCategory,
    normalizeLocationId
} from './discord-utils.js';
import InterrogationManager from './interrogation.js';
import { handleStart } from './handlers/start.js';
import { handleStatus } from './handlers/status.js';
import { handleJoin } from './handlers/join.js';
import { handleDNA, handleFootage, handleLogs, handleSearch, handleExamine, handlePresent, handleEvidence, handleLook } from './handlers/tools.js';
import { handleAccuse } from './handlers/accuse.js';
import { handleGenerate } from './handlers/generate.js';
import { handleLeave } from './handlers/leave.js';
import { handleFinalize } from './handlers/finalize.js';

/**
 * Game Manager - orchestrates the entire murder mystery game
 */
export default class GameManager {
    private static instances: Map<string, GameManager> = new Map();
    private client: Client;
    private dataDir: string;
    private guildId: string;
    private activeGame: Case | null = null;
    private tools: ToolsManager | null = null;
    private suspects: Map<string, Suspect> = new Map();
    private category: CategoryChannel | null = null;
    private channels: Map<string, TextChannel> = new Map();
    private timerInterval: NodeJS.Timeout | null = null;
    private dashboard: DashboardServer;
    private interrogationManager: InterrogationManager;
    private activeExplorations: Set<string> = new Set(); // Track channel IDs being explored
    private pendingPasscodes: Map<string, string> = new Map(); // Track channel IDs waiting for a passcode: channelId -> itemId
    private isInitializing: boolean = false;

    public static DEBUG_VISIBILITY = false;

    constructor(client: Client, guildId: string, dataDir: string = 'data') {
        this.client = client;
        this.guildId = guildId;
        this.dataDir = path.resolve(process.cwd(), dataDir);

        // Start dashboard server (now using global API)
        this.dashboard = new DashboardServer(this.client);
        // Dashboard start is now managed by apiServer.start()

        // Initialize interrogation manager
        this.interrogationManager = new InterrogationManager(this.client, {
            getActiveGame: () => this.activeGame,
            getSuspects: () => this.suspects,
            getDiscoveredEvidence: () => this.getDiscoveredEvidence(),
            getDashboard: () => this.dashboard,
            broadcastDashboardState: () => this.broadcastDashboardState(),
            getOrCreateStats: (userId, username) => this.getOrCreateStats(userId, username),
            getLocationFromChannel: (channel) => this.getLocationFromChannel(channel),
            isParticipant: (userId: string) => this.isParticipant(userId),
            checkInterrogationLimit: (member: GuildMember) => this.checkInterrogationLimit(member),
            getPendingPasscode: (channelId: string) => this.getPendingPasscode(channelId),
            setPendingPasscode: (channelId: string, itemId: string | null) => this.setPendingPasscode(channelId, itemId),
            unlockItem: (itemId: string) => this.unlockItem(itemId),
            saveState: () => this.saveState()
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
        this.pendingPasscodes.clear();
        this.interrogationManager.clearBuffers();
        logger.debug(`Ephemeral state purged for guild ${this.guildId}`);
    }

    /**
     * Check if a user is joined in the current investigation
     */
    public isParticipant(userId: string): boolean {
        return !!this.activeGame?.state?.participants.has(userId);
    }

    /**
     * Check if a game is currently active or being restored
     */
    public async isGameActive(): Promise<boolean> {
        if (this.isInitializing) return true;
        if (this.activeGame?.isActive()) return true;

        // Final check against database for any non-ended game for this guild
        try {
            const saved = await MMGame.findOne({ where: { guildId: this.guildId } });
            return !!(saved && saved.phase !== 'ended');
        } catch (e) {
            return false;
        }
    }

    /**
     * Get initialization status
     */
    public getInitializing(): boolean {
        return this.isInitializing;
    }

    public getGuildId(): string {
        return this.guildId;
    }

    // --- GETTERS & SETTERS FOR HANDLERS ---
    public getActiveGame() { return this.activeGame; }
    public setActiveGame(game: Case | null) { this.activeGame = game; }
    public getTools() { return this.tools; }
    public setTools(tools: ToolsManager | null) { this.tools = tools; }
    public getSuspectsMap() { return this.suspects; }

    /**
     * Check if a user has reached their daily interrogation limit
     * Admins and Owners are exempt.
     * Returns true if they can proceed, false if they hit the limit.
     */
    public async checkInterrogationLimit(member: GuildMember): Promise<{ canProceed: boolean; count: number }> {
        const isOwner = config.users.owners.includes(member.id);
        const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);

        if (isOwner || isAdmin) {
            return { canProceed: true, count: 0 };
        }

        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const count = await InterrogationLog.count({
                where: {
                    userId: member.id,
                    createdAt: {
                        [Op.gte]: today
                    }
                }
            });

            return {
                canProceed: count < 100,
                count
            };
        } catch (err) {
            logger.error('Error checking interrogation limit:', err);
            // Default to allowing if database check fails
            return { canProceed: true, count: 0 };
        }
    }

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

    public async getDetectiveRoleId(guildInput?: Guild): Promise<string | null> {
        let guild = guildInput;
        if (!guild) {
            guild = await this.client.guilds.fetch(this.guildId).catch(() => undefined);
        }
        if (!guild) return null;

        // 1. Check Database First
        try {
            const serverConfig = await Server.findByPk(this.guildId);
            if (serverConfig && serverConfig.detectiveRoleId) {
                // Verify the role still exists
                const existingRole = await guild.roles.fetch(serverConfig.detectiveRoleId).catch(() => null);
                if (existingRole) return existingRole.id;
            }
        } catch (e) {
            logger.error('Error fetching detective role from DB', e);
        }

        // 2. Fallback: Search by name
        await guild.roles.fetch();
        const role = guild.roles.cache.find(r => {
            const name = r.name.toLowerCase();
            return name === 'detective' || name === 'inspector'; // Add more aliases if needed
        });

        if (role) {
            // 3. Save to DB for future use
            try {
                await Server.upsert({ id: this.guildId, detectiveRoleId: role.id });
                logger.info(`Discovered and saved detective role: ${role.name} (${role.id}) for guild ${this.guildId}`);
            } catch (e) {
                logger.error('Error saving detective role to DB', e);
            }
            return role.id;
        }

        return null;
    }

    /**
     * Remove the detective role from all members who have it
     */
    public async removeDetectiveRoleFromAll(): Promise<void> {
        try {
            const guild = await this.getGuild();
            const roleId = await this.getDetectiveRoleId(guild);
            if (!roleId) return;

            const role = await guild.roles.fetch(roleId);
            if (!role) return;

            // Fetch members with the role to ensure we have an up-to-date list
            const members = await guild.members.fetch();
            const detectives = members.filter(m => m.roles.cache.has(roleId));

            let count = 0;
            for (const [id, member] of detectives) {
                try {
                    await member.roles.remove(roleId);
                    count++;
                } catch (e) {
                    logger.error(`Failed to remove role from ${member.user.tag}:`, e);
                }
            }

            logger.info(`🧹 Cleaned up ${count} detective roles.`);
        } catch (e) {
            logger.error('Error during detective role cleanup:', e);
        }
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
     * Passcode state management
     */
    public setPendingPasscode(channelId: string, itemId: string | null) {
        if (itemId) this.pendingPasscodes.set(channelId, itemId);
        else this.pendingPasscodes.delete(channelId);
    }

    public getPendingPasscode(channelId: string): string | null {
        return this.pendingPasscodes.get(channelId) || null;
    }

    /**
     * Check if an item is locked behind a passcode
     */
    public isItemLocked(itemId: string): boolean {
        if (!this.activeGame?.state) return false;

        // If it's already in unlockedItems, it's not locked anymore
        if (this.activeGame.state.unlockedItems.has(itemId.toLowerCase())) return false;

        const evidence = this.activeGame.getPhysicalEvidence(itemId);
        if (!evidence || typeof evidence === 'string') return false;

        // If it has a "required" field, it is locked
        return !!evidence.required;
    }

    /**
     * Get missing prerequisite evidence for an item.
     * Returns an empty array if all requirements are met or the item has none.
     */
    public getMissingRequirements(itemId: string): string[] {
        if (!this.activeGame) return [];

        const evidence = this.activeGame.getPhysicalEvidence(itemId);
        if (!evidence || typeof evidence === 'string') return [];
        if (!evidence.requires_discovery || evidence.requires_discovery.length === 0) return [];

        const discovered = this.getDiscoveredEvidence();
        return evidence.requires_discovery.filter(reqId => {
            // Check common prefixes: physical_, secret_, logs_
            const lower = reqId.toLowerCase();
            return !discovered.has(lower)
                && !discovered.has(`physical_${lower}`)
                && !discovered.has(`secret_${lower}`)
                && !discovered.has(`logs_${lower}`);
        });
    }

    /**
     * Mark an item as unlocked
     */
    public unlockItem(itemId: string) {
        if (this.activeGame?.state) {
            this.activeGame.state.unlockedItems.add(itemId.toLowerCase());
        }
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
        if (!fs.existsSync(casesDir)) {
            logger.warn(`Cases directory not found: ${casesDir}`);
            return [];
        }

        return fs.readdirSync(casesDir)
            .filter(f => {
                return fs.existsSync(path.join(casesDir, f, 'case.yaml')) ||
                    fs.existsSync(path.join(casesDir, f, 'case.json'));
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
        // SECURITY: Prevent path traversal by sanitizing caseId
        const sanitizedId = caseId.replace(/[^a-z0-9_-]/gi, '');

        // FUNNY: Catch them in the act
        if (caseId.includes('..') || caseId.includes('/') || caseId.includes('\\')) {
            throw new Error(`Nice try, Moriarty. Trying to path traverse into my folder structure? I expected a bit more effort from a 'criminal genius'. Let's stick to the case before you embarrass us both.`);
        }

        const caseDir = path.join(this.dataDir, 'cases', sanitizedId);

        if (!fs.existsSync(caseDir)) {
            throw new Error(`Case identification failed: Investigation file "${sanitizedId}" not found in archives.`);
        }

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

    async handleJoin(interaction: ChatInputCommandInteraction | ButtonInteraction) {
        logger.info(`Player joining investigation: ${interaction.user.tag} (Guild: ${this.guildId})`);
        return handleJoin(this, interaction);
    }

    async handleLeave(interaction: ChatInputCommandInteraction | ButtonInteraction) {
        logger.info(`Player leaving investigation: ${interaction.user.tag} (Guild: ${this.guildId})`);
        return handleLeave(this, interaction);
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

    async handleLook(interaction: ChatInputCommandInteraction) {
        return handleLook(this, interaction);
    }

    /** Delegate to active case — normalizes both map formats */
    public getMapConnections(locationId: string): string[] {
        return this.activeGame?.getMapConnections(locationId) ?? [];
    }

    async handlePresent(interaction: ChatInputCommandInteraction) {
        return handlePresent(this, interaction);
    }

    async handleAccuse(interaction: ChatInputCommandInteraction) {
        return handleAccuse(this, interaction);
    }

    async handleGenerate(interaction: ChatInputCommandInteraction) {
        return handleGenerate(this, interaction);
    }

    async handleFinalize(interaction: ChatInputCommandInteraction) {
        return handleFinalize(this, interaction);
    }

    async handleHints(interaction: ChatInputCommandInteraction) {
        if (!hasPermission(interaction)) {
            await denyPermission(interaction);
            return;
        }

        if (!this.activeGame) {
            await interaction.reply({ content: 'No active game.', ephemeral: true });
            return;
        }

        const nowEnabled = this.activeGame.hints.toggle();
        const embed = new EmbedBuilder()
            .setColor(nowEnabled ? Colors.Green : Colors.Orange)
            .setTitle(nowEnabled ? '💡 Hints Enabled' : '🔇 Hints Disabled')
            .setDescription(nowEnabled
                ? 'Detective hints will now appear as spoiler text when reviewing evidence and footage.'
                : 'Detective hints have been turned off. Investigators are on their own.')
            .setFooter({ text: `${this.activeGame.hints.hasHints() ? this.activeGame.hints.hasHints() : 0} hints loaded for this case` });

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    async handleSetPoints(interaction: ChatInputCommandInteraction, amount: number) {
        if (!hasPermission(interaction)) {
            await denyPermission(interaction);
            return;
        }

        if (!this.activeGame?.state) {
            await interaction.reply({ content: 'No active game.', ephemeral: true });
            return;
        }

        const oldPoints = this.activeGame.state.points;
        this.activeGame.state.points = amount;

        const embed = new EmbedBuilder()
            .setColor(Colors.Blue)
            .setTitle('💰 Investigation Funds Adjusted')
            .setDescription(`The current investigation's point balance has been manually adjusted.\n\n**Previous Balance:** \`${oldPoints.toFixed(2)}\`\n**New Balance:** \`${amount.toFixed(2)}\``)
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });

        // Update dashboard and save state
        this.broadcastDashboardState();
        await this.saveState();
    }

    async handleSync(interaction: ChatInputCommandInteraction) {
        if (!hasPermission(interaction)) {
            await denyPermission(interaction);
            return;
        }

        if (!this.activeGame) {
            await interaction.reply({ content: 'No active game.', ephemeral: true });
            return;
        }

        await interaction.deferReply({ ephemeral: true });
        try {
            const saved = await MMGame.findOne({ where: { guildId: this.guildId } });
            // Always fetch latest roles before syncing
            const guild = await this.getGuild();
            await guild.roles.fetch();

            await this.setupChannels(this.activeGame.config, saved?.categoryId || undefined, true);
            await interaction.editReply('✅ Investigation channels and permissions synced.');
        } catch (err) {
            logger.error('Failed to sync channels:', err);
            await interaction.editReply('❌ Failed to sync channels. Check logs for details.');
        }
    }

    /**
     * Clear all interrogation history (RAM memory and Database cache) for this guild
     */
    public async clearAllHistory(): Promise<void> {
        // 1. Clear RAM memory for all suspects
        for (const suspect of this.suspects.values()) {
            suspect.fullReset();
        }
        await this.saveState();
        this.broadcastDashboardState();

        // 2. Clear database cache for this guild's suspects
        try {
            const suspectIds = Array.from(new Set(this.activeGame?.config.suspects.map(s => s.id) || []));
            if (suspectIds.length > 0) {
                await (await import('../../database.js')).InterrogationCache.destroy({
                    where: {
                        suspectId: suspectIds
                    }
                });
            }
            logger.info(`Cleared all interrogation history for guild ${this.guildId}`);
        } catch (err) {
            logger.error(`Failed to clear database cache:`, err);
            throw err;
        }
    }
    /**
     * Clear interrogation history for a specific suspect
     */
    public async clearSuspectHistory(suspectId: string): Promise<void> {
        // 1. Clear RAM memory
        const suspect = this.suspects.get(suspectId);
        if (suspect) {
            suspect.fullReset();
            await this.saveState();
            this.broadcastDashboardState();
        }

        // 2. Clear database cache
        try {
            await (await import('../../database.js')).InterrogationCache.destroy({
                where: { suspectId }
            });
            logger.info(`Cleared interrogation history for suspect ${suspectId} in guild ${this.guildId}`);
        } catch (err) {
            logger.error(`Failed to clear suspect database cache:`, err);
            throw err;
        }
    }

    // --- SHARED UTILITIES ---
    public getOrCreateStats(userId: string, username: string): PlayerStats {
        if (!this.activeGame?.state) throw new Error('No active game state');

        if (!this.activeGame.state.playerStats[userId]) {
            this.activeGame.state.playerStats[userId] = {
                userId, username,
                evidenceFound: 0,
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

    public async setupChannels(config: CaseConfig, existingCategoryId?: string, syncPermissions: boolean = false): Promise<void> {
        const guild = await this.getGuild();
        if (!guild) return;

        const detectiveRoleId = await this.getDetectiveRoleId(guild);
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
                permissionOverwrites: [
                    {
                        id: guild.id,
                        allow: ['ViewChannel', 'ReadMessageHistory'],
                        deny: ['SendMessages', 'CreatePublicThreads', 'CreatePrivateThreads']
                    },
                    ...(detectiveRoleId ? [{
                        id: detectiveRoleId,
                        allow: ['ViewChannel', 'ReadMessageHistory', 'SendMessages']
                    } as any] : [])
                ]
            });
        } else if (syncPermissions) {
            // Update topic if needed
            if (briefingChannel.topic !== briefingDef.topic) await briefingChannel.setTopic(briefingDef.topic);

            // Sync permissions for existing channel
            try {
                const everyoneRole = guild.roles.everyone;
                const detectiveRole = (detectiveRoleId && detectiveRoleId.trim() !== '')
                    ? await guild.roles.fetch(detectiveRoleId).catch(() => null)
                    : null;

                logger.debug(`Syncing permissions for ${briefingChannel.name}. Using EveryoneRole: ${everyoneRole?.id}, DetectiveRole: ${detectiveRole?.id || 'None'}`);

                if (everyoneRole) {
                    await briefingChannel.permissionOverwrites.edit(everyoneRole, {
                        ViewChannel: true,
                        ReadMessageHistory: true,
                        SendMessages: false,
                        CreatePublicThreads: false,
                        CreatePrivateThreads: false
                    });
                }

                if (detectiveRole) {
                    await briefingChannel.permissionOverwrites.edit(detectiveRole, {
                        ViewChannel: true,
                        ReadMessageHistory: true,
                        SendMessages: true
                    });
                }
            } catch (err) {
                logger.error(`Failed to sync permissions for briefing channel ${briefingChannel.name}:`, err);
            }
        }
        this.channels.set('case-briefing', briefingChannel);

        // Pre-calculate name collisions to differentiate channels
        const nameGroups = new Map<string, number>();
        for (const s of config.suspects) {
            const firstName = s.name.split(' ')[0].toLowerCase();
            nameGroups.set(firstName, (nameGroups.get(firstName) || 0) + 1);
        }

        // 3. Location Channels
        const locations = this.activeGame?.getValidLocations() || [];
        for (const rawLoc of locations) {
            const loc = normalizeLocationId(rawLoc);
            const suspectsHere = config.suspects.filter(s => normalizeLocationId(s.currentLocation) === loc);
            const suspectNames = suspectsHere.map(s => s.name).join(', ');

            let topic = `Location: ${loc.replace(/_/g, ' ')}`;
            let icon = getRoomEmoji(loc);
            let name = `${icon}┃${loc.replace(/_/g, '-')}`;

            if (suspectNames) {
                topic += ` | 👥 Present: ${suspectNames} | You must mention their name to interrogate`;

                // Differentiate by last name if first name is shared
                const suffixes = suspectsHere.map(s => {
                    const parts = s.name.split(' ');
                    const first = parts[0];
                    const last = parts.length > 1 ? parts[parts.length - 1] : first;
                    return nameGroups.get(first.toLowerCase())! > 1 ? last.toLowerCase() : first.toLowerCase();
                });

                const suspectSuffix = suffixes.join('-');
                name = `${icon}┃${loc.replace(/_/g, '-')}∼🗨${suspectSuffix}`;
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

            const isMurderLoc = this.activeGame?.config.murderLocation === loc;

            if (!channel) {
                // Creation: Set EVERYTHING at once to avoid rate limit race conditions
                let fullTopic = topic;

                channel = await this.category.children.create({
                    name: name,
                    type: ChannelType.GuildText,
                    topic: fullTopic,
                    permissionOverwrites: [
                        {
                            id: guild.id, // @everyone
                            allow: ['ViewChannel'],
                            deny: ['SendMessages', 'ReadMessageHistory', 'CreatePublicThreads', 'CreatePrivateThreads']
                        },
                        ...(detectiveRoleId ? [{
                            id: detectiveRoleId,
                            allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory']
                        } as any] : [])
                    ]
                });

                // If murder loc and undiscovered, we need to explicitly sync perms after creation if creation simple logic wasn't enough
            } else if (syncPermissions) {
                // Optimization: Apply updates only if they changed
                if (channel.name !== name) {
                    await channel.setName(name);
                    channel.name = name;
                }
            }

            // Sync topic and permissions
            await setChannelVisibility(channel, true, topic, GameManager.DEBUG_VISIBILITY, isMurderLoc);

            // Always ensure role-based permissions are correct (Joiner vs Spectator)
            try {
                const everyoneRole = guild.roles.everyone;
                const detectiveRole = (detectiveRoleId && detectiveRoleId.trim() !== '')
                    ? await guild.roles.fetch(detectiveRoleId).catch(() => null)
                    : null;

                if (everyoneRole) {
                    await channel.permissionOverwrites.edit(everyoneRole, {
                        ViewChannel: true,
                        SendMessages: false,
                        ReadMessageHistory: true,
                        CreatePublicThreads: false,
                        CreatePrivateThreads: false
                    });
                }

                if (detectiveRole) {
                    await channel.permissionOverwrites.edit(detectiveRole, {
                        ViewChannel: true,
                        SendMessages: true,
                        ReadMessageHistory: true
                    });
                }
            } catch (err) {
                logger.error(`Failed to sync permissions for location channel ${loc}:`, err);
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
            .setTitle('⏰ THE CLOCK STRIKES MIDNIGHT: TIME EXPIRED')
            .setDescription(`\`\`\`ansi\n\u001b[1;31m[!] THE CASE HAS GONE COLD\u001b[0m\n\`\`\`\nThe trail has gone cold. The killer has vanished into the fog, leaving no further trace.\n\nScotland Yard has suspended your credentials pending further review.`);

        const investigationChannel = this.channels.get('case-briefing');
        if (investigationChannel) await investigationChannel.send({ embeds: [embed] });
        this.purgeEphemeralState();
        await this.saveState();
    }

    public parseTimeToMinutes(time: string): number {
        return parseTimeUtil(time);
    }

    public createFootageButtons(currentIndex: number, allTimes: string[]): ActionRowBuilder<ButtonBuilder> | null {
        if (currentIndex === -1 || allTimes.length <= 1) return null;
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
        if (currentIndex === -1 || allTimes.length <= 1) return null;
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

    async handleTerminate(interaction: ChatInputCommandInteraction) {
        logger.info(`Game forcefully terminated by ${interaction.user.tag}.`);
        if (!hasPermission(interaction)) {
            await denyPermission(interaction);
            return;
        }

        if (!this.activeGame) {
            await interaction.reply({ content: 'No active game.', ephemeral: true });
            return;
        }

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId('confirm_terminate')
                .setLabel('Confirm Terminate')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('cancel_terminate')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
        );

        const response = await interaction.reply({
            content: '⚠️ **WARNING**: Are you sure you want to FORCEFULLY terminate the game? This action is destructive and cannot be undone.',
            components: [row],
            ephemeral: true,
        });

        try {
            const confirmation = await response.awaitMessageComponent({
                filter: i => i.user.id === interaction.user.id,
                time: 30000
            });

            if (confirmation.customId === 'cancel_terminate') {
                await confirmation.update({ content: 'Termination cancelled.', components: [] });
                return;
            }

            // Proceed with terminate
            await confirmation.update({ content: 'Terminating investigation...', components: [] });

            // Remove roles first before terminating game state
            await this.removeDetectiveRoleFromAll();

            this.activeGame.end();
            this.stopTimer();
            this.purgeEphemeralState();
            await interaction.followUp({ content: 'Investigation terminated.', ephemeral: true });
            await this.saveState();
            this.broadcastDashboardState();
        } catch (e) {
            await interaction.editReply({ content: 'Termination confirmation timed out.', components: [] });
        }
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

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId('confirm_cleanup')
                .setLabel('Confirm Cleanup')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('cancel_cleanup')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
        );

        const response = await interaction.reply({
            content: '⚠️ **WARNING**: Are you sure you want to FORCEFULLY remove all murder mystery channels and categories? This cannot be undone.',
            components: [row],
            ephemeral: true,
        });

        try {
            const confirmation = await response.awaitMessageComponent({
                filter: i => i.user.id === interaction.user.id,
                time: 30000
            });

            if (confirmation.customId === 'cancel_cleanup') {
                await confirmation.update({ content: 'Cleanup cancelled.', components: [] });
                return;
            }

            await confirmation.update({ content: '🧹 Cleaning up channels... please wait.', components: [] });

            const count = await this.cleanupAllGameChannels();
            logger.info(`🧹 Cleanup completed. Removed ${count} channels.`);
            await interaction.followUp({ content: `🧹 Cleanup complete! Removed **${count}** channels.`, ephemeral: true });
        } catch (e) {
            await interaction.editReply({ content: 'Cleanup confirmation timed out.', components: [] });
        }
    }

    async handleHelp(interaction: ChatInputCommandInteraction) {
        const { embed, files } = createHelpEmbed();
        await interaction.reply({ embeds: [embed], files, ephemeral: true });
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
        await interaction.reply({ embeds: [embed], ephemeral: true });
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
        const query = focused.value.toLowerCase();

        if (focused.name === 'case') {
            const cases = this.listCases();
            const filtered = cases
                .filter(c => c.toLowerCase().includes(query))
                .slice(0, 25);
            await interaction.respond(filtered.map(c => ({
                name: c.replace(/_/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
                value: c
            })));
        } else if (focused.name === 'location') {
            if (!this.activeGame) return;
            const locations = this.activeGame.getValidLocations();
            const filtered = locations
                .filter(l => l.toLowerCase().replace(/_/g, ' ').includes(query))
                .slice(0, 25);
            await interaction.respond(filtered.map(l => ({ name: l.replace(/_/g, ' '), value: l })));
        } else if (focused.name === 'suspect') {
            if (!this.activeGame) return;
            const suspects = this.activeGame.config.suspects;
            const filtered = suspects
                .filter(s => s.name.toLowerCase().includes(query) || s.id.toLowerCase().includes(query))
                .slice(0, 25);
            await interaction.respond(filtered.map(s => ({ name: s.name, value: s.id })));
        } else if (focused.name === 'item') {
            if (!this.activeGame?.state) return;
            const items = Array.from(this.activeGame.state.discoveredEvidence)
                .filter(e => e.startsWith('physical_'))
                .map(e => e.replace('physical_', ''));

            const filtered = items
                .filter(i => i.toLowerCase().replace(/_/g, ' ').includes(query))
                .slice(0, 25);

            await interaction.respond(filtered.map(i => ({ name: i.replace(/_/g, ' '), value: i })));
        } else if (focused.name === 'evidence') {
            // For /mm present - show ALL discovered evidence
            if (!this.activeGame?.state) return;
            const allEvidence = Array.from(this.activeGame.state.discoveredEvidence);

            const filtered = allEvidence
                .filter(e => e.toLowerCase().replace(/_/g, ' ').includes(query))
                .slice(0, 25)
                .map((e: string) => {
                    const label = e.includes('_') ? e.substring(e.indexOf('_') + 1) : e;
                    return {
                        name: label.replace(/_/g, ' ').substring(0, 100),
                        value: e
                    };
                });

            await interaction.respond(filtered);
        } else if (focused.name === 'time') {
            if (!this.activeGame?.state) return;
            const subcommand = interaction.options.getSubcommand();
            const allDiscovered = Array.from(this.activeGame.state.discoveredEvidence);

            const prefix = subcommand === 'footage' ? 'footage_' : 'logs_';
            const logTimes = allDiscovered
                .filter(e => e.startsWith(prefix))
                .map(e => e.replace(prefix, ''))
                .sort();

            const filtered = logTimes
                .filter(t => t.startsWith(focused.value))
                .slice(0, 25);
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

        const detectiveRoleId = await this.getDetectiveRoleId();

        try {
            await MMGame.upsert({
                guildId: this.guildId,
                caseId: state.caseId,
                categoryId: this.category?.id || '',
                roleId: detectiveRoleId || '',
                points: state.points,
                phase: state.phase,
                endsAt: state.endsAt,
                participants: JSON.stringify(Array.from(state.participants)),
                usedTools: JSON.stringify(state.usedTools),
                discoveredEvidence: JSON.stringify(Array.from(state.discoveredEvidence)),
                unlockedItems: JSON.stringify(Array.from(state.unlockedItems)),
                playerStats: JSON.stringify(state.playerStats),
                accusations: JSON.stringify(state.accusations),
                suspectState: JSON.stringify(suspectStates),
                hostId: state.hostId
            });
            logger.debug(`Game state saved: ${state.caseId} (Guild: ${this.guildId})`);
        } catch (e) {
            logger.error('Failed to save game state', e);
        }
    }

    public async restoreGames(): Promise<void> {
        if (this.isInitializing) return;
        this.isInitializing = true;

        try {
            logger.info(`Checking for active Murder Mystery games for guild ${this.guildId}...`);
            const saved = await MMGame.findOne({ where: { guildId: this.guildId } });

            if (!saved) {
                logger.info(`No saved game found for guild ${this.guildId}.`);
                return;
            }

            if (saved.phase !== 'investigating') {
                logger.info(`Last game in ${this.guildId} was already completed (phase: ${saved.phase}).`);
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
                discoveredEvidence: new Set(JSON.parse(saved.discoveredEvidence || '[]')),
                unlockedItems: new Set(JSON.parse(saved.unlockedItems || '[]')),
                accusations: JSON.parse(saved.accusations || '{}'),
                hostId: saved.hostId || ''
            };

            this.activeGame = newCase;
            this.tools = new ToolsManager(newCase);
            this.suspects.clear();
            for (const suspectData of newCase.config.suspects) {
                const suspect = new Suspect(suspectData);

                // Restore suspect state
                const savedSState = newCase.state?.suspectState[suspect.data.id];
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
            logger.debug(`Fetching guild, roles and channels for ${this.guildId}...`);
            const guild = this.client.guilds.cache.get(this.guildId) || await this.client.guilds.fetch(this.guildId);
            await guild.roles.fetch();
            await guild.channels.fetch();

            // On boot restoration, we ONLY ensure the channels exist, we DO NOT sync permissions unless explicitly asked via /mma sync
            await this.setupChannels(newCase.config, saved.categoryId, false);

            this.startInterrogationListener();
            this.startTimer();
            this.broadcastDashboardState();
            logger.info(`✅ Murder Mystery session fully restored for: ${saved.caseId}`);
        } catch (e) {
            logger.error('❌ Failed to restore MM session:', e);
        } finally {
            this.isInitializing = false;
        }
    }

    public broadcastDashboardState(): void {
        const state = this.dashboard.buildGameState(this.activeGame, this.suspects, this.getDiscoveredEvidence());
        this.dashboard.updateState(state);
    }
}
