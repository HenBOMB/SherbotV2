import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    Colors,
    ButtonBuilder,
    ActionRowBuilder,
    ButtonStyle
} from 'discord.js';
import { hasPermission, denyPermission } from '../commands.js';
import { logger } from '../../../utils/logger.js';
import ToolsManager from '../tools.js';
import Suspect from '../suspect.js';
import GameManager from '../game.js';
import { createCaseBriefingEmbeds } from '../commands.js';

/**
 * Handle /mma start command
 */
export async function handleStart(
    manager: GameManager,
    interaction: ChatInputCommandInteraction,
    caseId: string,
    timeOverride?: number
): Promise<void> {
    if (!hasPermission(interaction)) {
        await denyPermission(interaction);
        return;
    }

    const detectiveRoleId = await manager.getDetectiveRoleId(interaction.guild || undefined);
    if (!detectiveRoleId) {
        const setupEmbed = new EmbedBuilder()
            .setColor(Colors.Red)
            .setTitle('🚨 Missing Investigator Credentials')
            .setDescription("A formal investigation requires a 'Detective' or 'Inspector' role. Shall I issue new credentials (create role), or is there an existing division I should assign (select role)?");

        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('mma-setup-create-role')
                    .setLabel('Create \'Detective\' Role')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🔨'),
                new ButtonBuilder()
                    .setCustomId('mma-setup-select-role')
                    .setLabel('Select Existing Role')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('📋')
            );

        await interaction.reply({
            embeds: [setupEmbed],
            components: [row],
            ephemeral: true,
        });
        return;
    }

    const activeGame = manager.getActiveGame();
    if (activeGame?.isActive()) {
        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(Colors.Orange)
                    .setTitle('⚠️ Game in Progress')
                    .setDescription('A game is already running. End it first with `/mma end`.')
            ],
            ephemeral: true,
        });
        return;
    }

    try {
        await interaction.deferReply();

        // Auto-cleanup old channels before starting
        await manager.cleanupAllGameChannels();
        manager.purgeEphemeralState();

        // Load the case
        const newCase = manager.loadCase(caseId);

        // Override time if specified
        if (timeOverride && timeOverride > 0) {
            newCase.config.settings.timeLimit = timeOverride;
        }

        const difficulty = newCase.config.settings.difficulty || 'sherlock';

        // Start the game with the command user as first participant
        const userId = interaction.user.id;
        newCase.start([userId], difficulty);

        manager.setActiveGame(newCase);
        manager.setTools(new ToolsManager(newCase));

        // Initialize stats for the starter
        manager.getOrCreateStats(userId, interaction.user.username);

        // Ensure the starter user gets the MM role
        try {
            const member = await interaction.guild?.members.fetch(userId);
            const detectiveRoleId = await manager.getDetectiveRoleId(interaction.guild || undefined);
            if (member && detectiveRoleId) await member.roles.add(detectiveRoleId);
        } catch (e) {
            logger.warn(`Failed to add role to starter ${userId}`, e);
        }

        // Initialize suspects from case data
        const suspectsMap = manager.getSuspectsMap();
        suspectsMap.clear();
        for (const suspectData of newCase.config.suspects) {
            const suspect = new Suspect(suspectData);
            suspectsMap.set(suspectData.id, suspect);
            // Also map by aliases for easier lookup
            for (const alias of suspectData.alias) {
                suspectsMap.set(alias.toLowerCase(), suspect);
            }
        }

        // Create game channels
        await manager.setupChannels(newCase.config);

        // Save initial state to database
        await manager.saveState();

        // Start interrogation listener
        manager.startInterrogationListener();

        // Start timer
        manager.startTimer();

        // Send start message to Case Briefing channel
        const channels = manager.getChannelsMap();
        const briefingChannel = channels.get('case-briefing');

        const { embeds, files } = createCaseBriefingEmbeds(newCase.config, {
            timeLimit: newCase.config.settings.timeLimit,
            points: newCase.config.settings.startingPoints,
            players: [userId],
            roomChannels: manager.getChannelsMap()
        });

        const joinButton = new ButtonBuilder()
            .setCustomId('mm-join')
            .setLabel('Join Investigation')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🔍');

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(joinButton);

        if (briefingChannel) {
            try {
                // Clear previous messages
                await briefingChannel.bulkDelete(20, true).catch(() => { });

                // 1. Send the dossier dossier
                await briefingChannel.send({ embeds, files });

                // 2. Send the JOIN Call-to-Action
                const joinEmbed = new EmbedBuilder()
                    .setColor(Colors.Green)
                    .setTitle('🕵🏻 Join the Investigation')
                    .setDescription('Click the button below to join the detective team. Only joined members can participate in interrogations and use detective tools.')
                    .setFooter({ text: 'Detective Role required to send messages in case channels' });

                await briefingChannel.send({
                    embeds: [joinEmbed],
                    components: [row]
                });

                // Also ping the players
                await briefingChannel.send(`📢 **DETECTIVES NEEDED!** <@${interaction.user.id}> has initiated a Crime Scene Investigation. Review the dossier above and report to the scene.`);
            } catch (e) {
                logger.error('Failed to send briefing', e);
            }
        }

        await interaction.editReply({
            content: `🕵️ **The game is afoot!**\nA scene awaits your inspection in <#${briefingChannel?.id}>. Review the dossier and begin your investigation.`
        });

        // Update dashboard
        manager.broadcastDashboardState();
        manager.getDashboard().addEvent('game_start', `Game started: ${newCase.config.name}`);

        logger.info(`The game is afoot: "${caseId}" has been initiated in guild ${interaction.guildId} by ${interaction.user.tag}.`);
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
