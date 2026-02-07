import {
    ChatInputCommandInteraction,
    TextChannel,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import { createToolEmbed } from '../../commands.js';
import GameManager from '../../game.js';

/**
 * Handle /mm examine command
 */
export async function handleExamine(
    manager: GameManager,
    interaction: ChatInputCommandInteraction
): Promise<void> {
    if (!manager.isParticipant(interaction.user.id)) {
        await interaction.reply({
            content: 'You must join the investigation with `/mm join` before you can use detective tools.',
            ephemeral: true
        });
        return;
    }

    const tools = manager.getTools();
    const activeGame = manager.getActiveGame();

    if (!tools || !activeGame?.isActive()) {
        await interaction.reply({ content: 'No active game.', ephemeral: true });
        return;
    }

    const item = interaction.options.getString('item');
    const channel = interaction.channel;

    // Helper to get evidence in current room
    const getRoomEvidence = (): string[] => {
        if (!activeGame || !activeGame.isActive()) return [];

        let locationId: string | null = null;
        if (channel instanceof TextChannel) {
            locationId = manager.getLocationFromChannel(channel);
        }
        if (!locationId) return [];

        // Get all physical evidence possible in this room
        const roomItems = activeGame.getPhysicalDiscovery(locationId) || [];
        const discovered = manager.getDiscoveredEvidence();

        // Filter to only what we've discovered
        return roomItems.filter(id => discovered.has(`physical_${id.toLowerCase()}`));
    };

    let targetItem = item;
    let evidenceList: string[] = [];

    // If no item specified, try to find one in the current room
    if (!targetItem) {
        evidenceList = getRoomEvidence();
        if (evidenceList.length === 0) {
            await interaction.reply({
                content: 'No discovered evidence to examine in this location to cycle through. Try exploring first!',
                ephemeral: true
            });
            return;
        }
        targetItem = evidenceList[0];
    } else {
        // Fallback for specific item validation
        const discovered = manager.getDiscoveredEvidence();
        if (!discovered.has(`physical_${targetItem.toLowerCase()}`)) {
            await interaction.reply({
                content: `You haven't discovered any item named "${targetItem}" yet. Explore more to find clues!`,
                ephemeral: true
            });
            return;
        }
        // If they provided a specific item, we still might want to let them cycle if they are in the correct room
        const roomList = getRoomEvidence();
        if (roomList.includes(targetItem)) {
            evidenceList = roomList;
        }
    }

    const processExamine = (itemId: string) => {
        const res = tools.examine(itemId);
        // Only charge cost if it's the first time viewing? 
        // Actually, examine is free currently.
        return res;
    };

    const result = processExamine(targetItem);

    // Create buttons if we have a list to cycle
    const createButtons = (currentId: string, list: string[]) => {
        if (list.length <= 1) return null;
        const idx = list.indexOf(currentId);
        if (idx === -1) return null;

        const row = new ActionRowBuilder<ButtonBuilder>();

        const prevId = idx > 0 ? list[idx - 1] : list[list.length - 1]; // Cycle wrap or stop? Let's stop for consistency or wrap for convenience. Wraparound is nicer for mobile.
        const nextId = idx < list.length - 1 ? list[idx + 1] : list[0];

        // Let's use standard logic: disable prev if start, disable next if end? 
        // Or wrap? User asked for "cycles the evidence". Wrap is better for cycling.

        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`mm_examine_${prevId}`)
                .setLabel('⬅️ Previous')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`mm_examine_${nextId}`)
                .setLabel('Next ➡️')
                .setStyle(ButtonStyle.Secondary)
        );
        return row;
    };

    const embed = createToolEmbed(
        'examine' as any,
        targetItem,
        result.result,
        result.cost,
        result.success,
        result.error
    );

    const row = createButtons(targetItem, evidenceList);

    const response = await interaction.reply({
        embeds: [embed],
        components: row ? [row] : [],
        fetchReply: true
    });

    // If successful, maybe highlight it in the log (only once per session/item?)
    if (result.success && item) { // Only log if they specifically asked for it, or maybe just log implicit?
        // Let's keep log noise down, maybe not log cycles.
        // manager.getDashboard().addEvent('tool_use', `Examined item: ${targetItem}`);
    }

    if (row) {
        const collector = response.createMessageComponentCollector({
            filter: i => i.user.id === interaction.user.id,
            time: 120000
        });

        collector.on('collect', async i => {
            try {
                const newItemId = i.customId.replace('mm_examine_', '');

                // Security verify
                if (!evidenceList.includes(newItemId)) {
                    await i.reply({ content: 'Item no longer available.', ephemeral: true });
                    return;
                }

                const newRes = processExamine(newItemId);
                const newEmbed = createToolEmbed(
                    'examine' as any,
                    newItemId,
                    newRes.result,
                    newRes.cost,
                    newRes.success,
                    newRes.error
                );

                const newRow = createButtons(newItemId, evidenceList);

                await i.update({
                    embeds: [newEmbed],
                    components: newRow ? [newRow] : []
                });
            } catch (e) {
                // Ignore
            }
        });
    }
}
