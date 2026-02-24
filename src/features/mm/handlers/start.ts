import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    Colors
} from 'discord.js';
import { hasPermission, denyPermission } from '../commands.js';
import { logger } from '../../../utils/logger.js';
import ToolsManager from '../tools.js';
import Suspect from '../suspect.js';
import GameManager from '../game.js';
import { createCaseBriefingEmbeds } from '../commands.js';

/**
 * Handle /mm start command
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

    const activeGame = manager.getActiveGame();
    if (activeGame?.isActive()) {
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
            players: [userId]
        });

        if (briefingChannel) {
            try {
                // Clear previous messages
                await briefingChannel.bulkDelete(20, true).catch(() => { });
                await briefingChannel.send({ embeds, files });
                // Also ping the players
                await briefingChannel.send(`📢 **DETECTIVES NEEDED!** <@${interaction.user.id}> has initiated a Crime Scene Investigation. Review the dossier above and report to the scene.`);
            } catch (e) {
                logger.error('Failed to send briefing', e);
            }
        }

        await interaction.editReply({
            content: `🕵️ **Investigation Started!**\nHead over to <#${briefingChannel?.id}> to review the case details.`
        });

        // Update dashboard
        manager.broadcastDashboardState();
        manager.getDashboard().addEvent('game_start', `Game started: ${newCase.config.name}`);

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
