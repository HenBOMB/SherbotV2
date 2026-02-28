import {
    ChatInputCommandInteraction,
    TextChannel
} from 'discord.js';
import GameManager from '../../game.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Handle /mm present command - Phoenix Wright style evidence presentation
 */
export async function handlePresent(
    manager: GameManager,
    interaction: ChatInputCommandInteraction
): Promise<void> {
    const member = interaction.member as any;
    if (member) {
        const { canProceed } = await manager.checkInterrogationLimit(member);
        if (!canProceed) {
            await interaction.reply({
                content: `⚠️ **Daily Interrogation Limit Reached!**\nYou've reached your daily limit of 100 interrogations. Ask an admin to reset your limit.`,
                ephemeral: true
            });
            return;
        }
    }

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

    const evidenceQuery = interaction.options.getString('evidence', true);
    const suspectQuery = interaction.options.getString('suspect', true);

    // Get the suspect
    const matches = manager.getSuspectByFuzzyMatch(suspectQuery);
    if (matches.length === 0) {
        await interaction.reply({
            content: `Unknown suspect matching "${suspectQuery}".`,
            ephemeral: true
        });
        return;
    } else if (matches.length > 1) {
        const names = matches.map(m => m.data.name).join(', ');
        await interaction.reply({
            content: `Multiple suspects found matching "${suspectQuery}": **${names}**.\nPlease be more specific.`,
            ephemeral: true
        });
        return;
    }
    const suspect = matches[0];
    const suspectId = suspect.data.id;

    // Check if evidence is discovered via fuzzy matching
    const discovered = manager.getDiscoveredEvidence();

    const q = evidenceQuery.toLowerCase().replace(/[^a-z0-9]/g, '');
    let evidenceId: string | null = null;
    let fallbackEvidenceId: string | null = null;

    // First try exact match (useful for autocomplete values)
    if (discovered.has(evidenceQuery)) {
        evidenceId = evidenceQuery;
    } else {
        for (const item of discovered) {
            const rawName = item.includes('_') ? item.substring(item.indexOf('_') + 1) : item;
            const normalizedItem = rawName.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (normalizedItem === q) {
                evidenceId = item;
                break;
            }
            if (normalizedItem.includes(q) || q.includes(normalizedItem)) {
                fallbackEvidenceId = item;
            }
        }
    }

    evidenceId = evidenceId || fallbackEvidenceId;

    if (!evidenceId) {
        await interaction.reply({
            content: `You haven't discovered any evidence matching "${evidenceQuery}" yet.`,
            ephemeral: true
        });
        return;
    }

    // ENFORCE PRESENCE: Suspect must be in the same room
    const channel = interaction.channel;
    let roomDescription = '';
    let roomInteractables: { name: string; description: string }[] = [];

    if (channel instanceof TextChannel) {
        const currentLocation = manager.getLocationFromChannel(channel);
        if (!currentLocation || suspect.data.currentLocation !== currentLocation) {
            await interaction.reply({
                content: `*${suspect.data.name} is not in this room.* You must go to **#📍┃${suspect.data.currentLocation.replace(/_/g, '-')}** to present this evidence to them.`,
                ephemeral: true
            });
            return;
        }

        const roomInfo = activeGame.getRoomInfo(currentLocation);
        if (roomInfo) {
            roomDescription = roomInfo.description;
            roomInteractables = roomInfo.interactables || [];
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
        activeGame.config.id,
        discovered,
        roomDescription,
        roomInteractables,
        activeGame.logger
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

        // Create a user-friendly display name for the evidence
        const displayName = evidenceId
            .replace(/^(physical|secret|dna|footage|logs|locations)_/i, '')
            .replace(/_/g, ' ');

        // The suspect will have responded via webhook, so we just acknowledge
        const impactText = result.wasRelevant ? ` (**Impact: -${result.composureLost}% Composure**)` : '';
        logger.info(impactText);

        await interaction.editReply({
            content: `📎 You present **${displayName}** to **${suspect.data.name}**`
        });
    } else {
        await interaction.editReply({
            content: `${suspect.data.name} is busy or something went wrong.`
        });
    }
}
