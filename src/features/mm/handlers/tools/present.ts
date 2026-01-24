import {
    ChatInputCommandInteraction,
    TextChannel
} from 'discord.js';
import GameManager from '../../game.js';

/**
 * Handle /mm present command - Phoenix Wright style evidence presentation
 */
export async function handlePresent(
    manager: GameManager,
    interaction: ChatInputCommandInteraction
): Promise<void> {
    if (!manager.isParticipant(interaction.user.id)) {
        await interaction.reply({
            content: 'You must join the investigation with `/mm join` before you can present evidence.',
            ephemeral: true
        });
        return;
    }

    const activeGame = manager.getActiveGame();
    if (!activeGame?.isActive()) {
        await interaction.reply({ content: 'No active game.', ephemeral: true });
        return;
    }

    const evidenceId = interaction.options.getString('evidence', true);
    const suspectId = interaction.options.getString('suspect', true);

    // Get the suspect
    const suspect = manager.getSuspectsMap().get(suspectId);
    if (!suspect) {
        await interaction.reply({
            content: `Unknown suspect: "${suspectId}".`,
            ephemeral: true
        });
        return;
    }

    // Check if evidence is discovered
    const discovered = manager.getDiscoveredEvidence();
    if (!discovered.has(evidenceId.toLowerCase())) {
        await interaction.reply({
            content: `You haven't discovered evidence "${evidenceId}" yet.`,
            ephemeral: true
        });
        return;
    }

    // ENFORCE PRESENCE: Suspect must be in the same room
    const channel = interaction.channel;
    if (channel instanceof TextChannel) {
        const currentLocation = manager.getLocationFromChannel(channel);
        if (!currentLocation || suspect.data.currentLocation !== currentLocation) {
            await interaction.reply({
                content: `*${suspect.data.name} is not in this room.* You must go to **#📍┃${suspect.data.currentLocation.replace(/_/g, '-')}** to present this evidence to them.`,
                ephemeral: true
            });
            return;
        }
    }

    // Defer reply since this may take a moment
    await interaction.deferReply();

    // Present the evidence to the suspect
    if (!channel || !('send' in channel)) {
        await interaction.editReply({ content: 'Cannot present in this channel.' });
        return;
    }

    const result = await suspect.presentEvidence(
        interaction.member as any,
        evidenceId,
        channel as any,
        discovered
    );

    if (result) {
        // Log the event
        manager.getDashboard().addEvent('tool_use',
            `${interaction.user.username} presented "${evidenceId}" to ${suspect.data.name}`);

        if (result.wasRelevant) {
            manager.getDashboard().addEvent('secret_revealed',
                `${suspect.data.name} reacted strongly to evidence!`);
        }

        // Track stats
        const stats = manager.getOrCreateStats(interaction.user.id, interaction.user.username);
        stats.toolsUsed++;
        if (result.revealedSecret) {
            stats.secretsRevealed++;
            // Register secret as evidence
            const secretEvidenceId = `secret_${suspect.data.id}_${result.revealedSecret.id}`;
            discovered.add(secretEvidenceId);
        }

        manager.broadcastDashboardState();
        await manager.saveState();

        // The suspect will have responded via webhook, so we just acknowledge
        await interaction.editReply({
            content: `📎 You present **${evidenceId.replace(/_/g, ' ')}** to **${suspect.data.name}**...`
        });
    } else {
        await interaction.editReply({
            content: `${suspect.data.name} is busy or something went wrong.`
        });
    }
}
