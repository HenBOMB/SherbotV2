import {
    ChatInputCommandInteraction,
    TextChannel,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    Colors
} from 'discord.js';
import { createToolEmbed } from '../../commands.js';
import GameManager from '../../game.js';

/**
 * Helper to find the best matching evidence ID given a query
 */
function findBestMatch(query: string, discovered: Iterable<string>): string | null {
    // First try exact match (Set/Iterable check)
    if (discovered instanceof Set && discovered.has(query)) return query;
    if (Array.isArray(discovered) && discovered.includes(query)) return query;

    const q = query.toLowerCase().replace(/[^a-z0-9]/g, '');
    let bestMatch: string | null = null;
    let fallbackMatch: string | null = null;

    for (const item of discovered) {
        // Full exact check inside loop for cases where discovered is just an Iterable
        if (item === query) return item;

        // Strip the prefix for matching (e.g., physical_, secret_, logs_)
        const rawName = item.includes('_') ? item.substring(item.indexOf('_') + 1) : item;
        const normalizedItem = rawName.toLowerCase().replace(/[^a-z0-9]/g, '');

        if (normalizedItem === q) {
            return item; // Exact match on name
        }
        if (normalizedItem.includes(q) || q.includes(normalizedItem)) {
            fallbackMatch = item; // Partial match
        }
    }
    return bestMatch || fallbackMatch;
}

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

    // --- NPC INTERACTABLE CHECK ---
    // Before checking discovered evidence, check if the query matches an interactable with dialogue
    if (item && channel instanceof TextChannel) {
        const locationId = manager.getLocationFromChannel(channel);
        if (locationId) {
            const match = activeGame.findInteractable(item, locationId);
            if (match?.interactable.dialogue) {
                const npc = match.interactable;
                const dialogue = npc.dialogue!;

                // Build the NPC response embed
                const defaultDialogue = dialogue.default || '*They don\'t seem to have anything to say.*';
                const embed = new EmbedBuilder()
                    .setColor(Colors.Gold)
                    .setTitle(`👤 ${npc.name}`)
                    .setDescription(`*${npc.description}*\n\n💬 ${defaultDialogue}`)
                    .setFooter({ text: 'Select a topic to ask about.' });

                // Generate topic buttons from dialogue keys
                const topicKeys = Object.keys(dialogue).filter(k => k !== 'default');

                const rows: ActionRowBuilder<ButtonBuilder>[] = [];
                let currentRow = new ActionRowBuilder<ButtonBuilder>();
                let btnCount = 0;

                for (const key of topicKeys) {
                    // Convert key like 'on_ask_about_podium' to label 'Podium'
                    const label = key
                        .replace(/^on_ask_about_/, '')
                        .replace(/_/g, ' ')
                        .replace(/\b\w/g, c => c.toUpperCase());

                    currentRow.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`mm_npc_${match.locationId}_${npc.name}_${key}`)
                            .setLabel(`Ask about ${label}`)
                            .setStyle(ButtonStyle.Primary)
                            .setEmoji('💬')
                    );
                    btnCount++;

                    if (btnCount % 5 === 0) {
                        rows.push(currentRow);
                        currentRow = new ActionRowBuilder<ButtonBuilder>();
                    }
                }
                if (btnCount % 5 !== 0) rows.push(currentRow);

                const response = await interaction.reply({
                    embeds: [embed],
                    components: rows,
                    fetchReply: true
                });

                // Handle button interactions
                const collector = response.createMessageComponentCollector({
                    filter: i => i.user.id === interaction.user.id && i.customId.startsWith('mm_npc_'),
                    time: 120000
                });

                collector.on('collect', async i => {
                    try {
                        const parts = i.customId.split('_');
                        // mm_npc_{locationId}_{npcName}_{dialogueKey}
                        // The dialogue key is everything after the npc name portion
                        const dialogueKey = i.customId.substring(
                            i.customId.indexOf(npc.name) + npc.name.length + 1
                        );

                        const response = dialogue[dialogueKey];
                        if (!response) {
                            await i.reply({ content: '*They look at you blankly.*', ephemeral: true });
                            return;
                        }

                        const topicLabel = dialogueKey
                            .replace(/^on_ask_about_/, '')
                            .replace(/_/g, ' ')
                            .replace(/\b\w/g, c => c.toUpperCase());

                        const topicEmbed = new EmbedBuilder()
                            .setColor(Colors.Gold)
                            .setTitle(`👤 ${npc.name}`)
                            .setDescription(`*You ask about **${topicLabel}**...*\n\n💬 ${response}`)
                            .setFooter({ text: 'Select another topic or dismiss.' });

                        await i.update({
                            embeds: [topicEmbed],
                            components: rows
                        });
                    } catch (e) {
                        // Ignore interaction errors
                    }
                });

                return; // NPC handled, don't fall through to evidence examine
            }
        }
    }

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
                content: 'No discovered evidence to examine in this location to cycle through.',
                ephemeral: true
            });
            return;
        }
        targetItem = evidenceList[0];
    } else {
        // Fuzzy match specific item validation
        const discovered = manager.getDiscoveredEvidence();
        const matchedItem = findBestMatch(targetItem, discovered);

        if (!matchedItem) {
            await interaction.reply({
                content: `You haven't discovered any item matching "${targetItem}" yet.`,
                ephemeral: true
            });
            return;
        }

        targetItem = matchedItem;
        // If they provided a specific item, we still might want to let them cycle if they are in the correct room
        const roomList = getRoomEvidence();
        if (roomList.includes(targetItem) || roomList.map(i => `physical_${i}`).includes(targetItem)) {
            evidenceList = roomList.map(i => `physical_${i}`);
        } else {
            evidenceList = [targetItem]; // fallback if not in room
        }

        // Let's make targetItem the pure name without prefix for the tool manager
        if (targetItem.startsWith('physical_')) targetItem = targetItem.replace('physical_', '');
    }

    const processExamine = (itemId: string) => {
        const res = tools.examine(itemId);
        // Only charge cost if it's the first time viewing? 
        // Actually, examine is free currently.
        return res;
    };

    // --- PREREQUISITE CHECK ---
    const missing = manager.getMissingRequirements(targetItem);
    if (missing.length > 0) {
        const hintsEnabled = manager.getActiveGame()!.hints.hasHints();
        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(Colors.DarkGrey)
                    .setTitle('🔐 NOT ENOUGH TO GO ON')
                    .setDescription(`The forensic team reviewed your request but doesn't have enough corroborating evidence to prioritize **${targetItem.replace(/_/g, ' ')}** right now.\n\n*"Come back when you've found something more concrete, detective."*`)
                    .setFooter(hintsEnabled ? { text: 'Tip: Keep searching other locations for related evidence.' } : null)
            ]
        });
        return;
    }

    // --- LOCK CHECK ---
    if (manager.isItemLocked(targetItem) && channel) {
        manager.setPendingPasscode(channel.id, targetItem);
        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(Colors.Red)
                    .setTitle('🔒 SECURITY LOCK ACTIVE')
                    .setDescription(`\`\`\`ansi\n\u001b[1;31m[ ACCESS DENIED: ${targetItem.toUpperCase()} ]\u001b[0m\n\u001b[0;37mThis device is protected by a numeric passcode.\u001b[0m\n\`\`\`\nPlease type the 4-digit code in this channel to proceed.`)
                    .setFooter({ text: 'The investigation continues once the correct code is entered.' })
            ]
        });
        return;
    }

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
        result.error,
        { hintEngine: activeGame.hints }
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
                    newRes.error,
                    { hintEngine: activeGame.hints }
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
