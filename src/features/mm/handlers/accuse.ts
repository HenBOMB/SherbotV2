import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    Colors
} from 'discord.js';
import { createAccusationEmbed } from '../commands.js';
import { logger } from '../../../utils/logger.js';
import GameManager from '../game.js';

/**
 * Handle /mm accuse command
 */
export async function handleAccuse(
    manager: GameManager,
    interaction: ChatInputCommandInteraction
): Promise<void> {
    const activeGame = manager.getActiveGame();
    if (!activeGame?.isActive()) {
        await interaction.reply({ content: 'No active game.', ephemeral: true });
        return;
    }

    // SECURITY: Only joined participants can make an accusation
    if (!manager.isParticipant(interaction.user.id)) {
        await interaction.reply({
            content: 'You must join the investigation with `/mm join` before you can make an accusation.',
            ephemeral: true
        });
        return;
    }

    const suspectQuery = interaction.options.getString('suspect', true);
    const matches = manager.getSuspectByFuzzyMatch(suspectQuery);

    if (matches.length === 0) {
        await interaction.reply({ content: `Suspect matching "${suspectQuery}" not found.`, ephemeral: true });
        return;
    } else if (matches.length > 1) {
        const names = matches.map(m => m.data.name).join(', ');
        await interaction.reply({ content: `Multiple suspects found matching "${suspectQuery}": **${names}**.\nPlease be more specific.`, ephemeral: true });
        return;
    }

    const suspect = matches[0].data;
    const suspectId = suspect.id;

    // Prevent double voting
    if (activeGame.state?.accusations[interaction.user.id]) {
        await interaction.reply({
            content: `You have already accused **${activeGame.getSuspect(activeGame.state.accusations[interaction.user.id] || '')?.name}**. You cannot change your vote.`,
            ephemeral: true
        });
        return;
    }

    try {
        const result = activeGame.accuse(interaction.user.id, suspectId);

        if (!result.finished) {
            // Feedback for partial threshold
            const embed = new EmbedBuilder()
                .setColor(Colors.Blue)
                .setTitle('⚖️ Accusation Recorded')
                .setDescription(`Your accusation of **${suspect.name}** has been registered.\n\n**Progress:** ${result.currentCount}/${result.totalNeeded} detectives have voted.\nNeed **${(result.totalNeeded || 0) - (result.currentCount || 0)}** more to conclude the investigation.`)
                .setFooter({ text: 'Everyone must contribute to the final verdict!' });

            await interaction.reply({ embeds: [embed] });

            manager.getDashboard().addEvent('tool_use', `${interaction.user.displayName} accused ${suspect.name} (Waiting for others...)`);
            manager.broadcastDashboardState();
            await manager.saveState();
            return;
        }

        const killer = activeGame.getSuspect(result.solution || '');

        const embed = createAccusationEmbed(
            !!result.correct,
            activeGame.getSuspect(activeGame.state?.accusation?.accusedId || '')?.name || 'Unknown',
            killer?.name || 'Unknown'
        );

        await interaction.reply({ embeds: [embed] });

        // Update dashboard
        manager.getDashboard().addEvent('accusation',
            `Collective Verdict reached: ${result.correct ? 'SOLVED' : 'FAILED'}`);
        manager.broadcastDashboardState();

        // Save state
        await manager.saveState();

        // Log result
        logger.info(`Final Accusation Result: ${result.correct ? 'CORRECT' : 'WRONG'}`);

    } catch (error) {
        logger.error('Error handling accusation:', error);
        await interaction.reply({ content: 'Failed to process accusation.', ephemeral: true });
    }
}
