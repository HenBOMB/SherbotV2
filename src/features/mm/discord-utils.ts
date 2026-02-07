import {
    CategoryChannel,
    ChannelType,
    Guild,
    TextChannel,
    Colors
} from 'discord.js';
import { CaseConfig } from './case.js';
import Case from './case.js';

/**
 * Returns an emoji representation for a given room name.
 * The function matches keywords in the room name to a predefined list of emojis.
 *
 * @param roomName - The name of the room (e.g., "Master Bedroom", "Kitchen").
 * @returns A string containing the corresponding emoji, or a default '📍' emoji if no match is found.
 */
export function getRoomEmoji(roomName: string | null | undefined): string {
    // Return a default emoji immediately if the roomName is null, undefined, or empty.
    if (!roomName) {
        return '📍';
    }

    const name = roomName.toLowerCase();

    // The mapping of keywords to emojis.
    // The order is important, as the first match will be returned.
    // Place more specific keywords (like 'home office') before more generic ones (like 'office').
    const roomMappings: { keywords: string[]; emoji: string }[] = [
        { keywords: ['kitchen'], emoji: '🍳' },
        { keywords: ['living room', 'lounge', 'salon'], emoji: '🛋️' },
        { keywords: ['bedroom', 'guest', 'master bedroom'], emoji: '🛏️' },
        { keywords: ['bathroom', 'shower'], emoji: '🚿' },
        { keywords: ['garden', 'patio', 'yard', 'outdoor'], emoji: '🌳' },
        { keywords: ['home office', 'office', 'study', 'library'], emoji: '📚' },
        { keywords: ['garage'], emoji: '🚗' },
        { keywords: ['dining room', 'diner'], emoji: '🍽️' },
        { keywords: ['wine cellar', 'cellar'], emoji: '🍷' },
        { keywords: ['server', 'tech'], emoji: '💻' },
        { keywords: ['lab'], emoji: '🧪' },
        { keywords: ['laundry', 'utility'], emoji: '🧺' },
        { keywords: ['gym', 'fitness', 'workout'], emoji: '🏋️' },
        { keywords: ['pool', 'swimming'], emoji: '🏊' },
        { keywords: ['home theater', 'cinema', 'movie room'], emoji: '🎬' },
        { keywords: ['basement'], emoji: '📦' },
        { keywords: ['attic'], emoji: '🧗' },
        { keywords: ['pantry', 'closet', 'storage'], emoji: '🗄️' },
        { keywords: ['balcony', 'terrace', 'deck'], emoji: '🌿' },
        { keywords: ['stairs', 'stairway'], emoji: '🪜' },
        { keywords: ['elevator'], emoji: '🛗' },
        { keywords: ['kids room', 'playroom', 'nursery'], emoji: '🧸' },
        { keywords: ['music room', 'studio'], emoji: '🎵' },
        { keywords: ['workshop'], emoji: '🛠️' },
        { keywords: ['foyer', 'hall', 'entrance', 'corridor', 'room'], emoji: '🚪' },
    ];

    // Find the first mapping where a keyword is included in the room name.
    const mapping = roomMappings.find(m =>
        m.keywords.some(keyword => name.replace(/-/g, ' ').includes(keyword))
    );

    // If a mapping is found, return its emoji. Otherwise, return the default emoji.
    return mapping ? mapping.emoji : '📍';
}

/**
 * Helper to set channel visibility and visual indicator
 */
export async function setChannelVisibility(
    channel: TextChannel,
    isVisible: boolean,
    baseTopic: string,
    debugMode: boolean = true,
    isDiscoveryExempt: boolean = false
): Promise<void> {
    const guild = channel.guild;

    // Always clean the topic first to ensure we don't double stack or leave stale tags
    const cleanTopic = baseTopic.replace(/\[(🔓|🔒) (OPEN|LOCKED)\]\s*/g, '').trim();
    let newTopic = cleanTopic;

    // Only add prefix if debug mode is enabled
    if (debugMode) {
        const statusIcon = isVisible ? '🔓 OPEN' : '🔒 LOCKED';
        newTopic = `[${statusIcon}] ${cleanTopic}`;
    }

    // Only update if changed to save API calls
    if (channel.topic !== newTopic) {
        await channel.setTopic(newTopic);
    }

    // Only update permissions if they differ to save API calls
    const everyoneId = guild.id;
    const current = channel.permissionOverwrites.cache.get(everyoneId);

    // Mode logic:
    // If exempt (murder room): Always visible in sidebar, but history/chat depends on discovery.
    // If normal: Hidden until discovered.
    const canView = isDiscoveryExempt || isVisible;
    const canInteract = isVisible;

    // Check if we need to update
    const needsUpdate = !current ||
        current.allow.has('ViewChannel') !== canView ||
        current.allow.has('SendMessages') !== canInteract ||
        current.allow.has('ReadMessageHistory') !== canInteract ||
        (canView === false && !current.deny.has('ViewChannel'));

    if (needsUpdate) {
        await channel.permissionOverwrites.edit(everyoneId, {
            ViewChannel: canView,
            SendMessages: canInteract,
            ReadMessageHistory: canInteract
        });
    }
}

/**
 * Get location ID from channel topic
 */
export function getLocationFromChannel(channel: TextChannel): string | null {
    if (!channel.topic) return null;

    // Extract from "Location: [Name] | ..."
    const match = channel.topic.match(/Location:\s+([^|]+)/i);
    if (match) {
        return match[1].trim().toLowerCase().replace(/\s+/g, '_');
    }
    return null;
}

/**
 * Find or create a category channel
 */
export async function getOrCreateCategory(
    guild: Guild,
    categoryName: string,
    existingId?: string
): Promise<CategoryChannel> {
    // 1. Try finding by existing ID first (most reliable)
    if (existingId) {
        try {
            const channel = await guild.channels.fetch(existingId);
            if (channel && channel.type === ChannelType.GuildCategory) {
                return channel as CategoryChannel;
            }
        } catch (e) {
            // Category might have been deleted, fall back to name search
        }
    }

    // 2. Fallback: Search by name
    let category = guild.channels.cache.find(
        c => c.name === categoryName && c.type === ChannelType.GuildCategory
    ) as CategoryChannel | undefined;

    // 3. Last chance: Fetch all channels to ensure cache is warm
    if (!category) {
        const allChannels = await guild.channels.fetch();
        category = allChannels.find(
            c => c && c.name === categoryName && c.type === ChannelType.GuildCategory
        ) as CategoryChannel | undefined;
    }

    // 4. Create if still not found
    if (!category) {
        category = await guild.channels.create({
            name: categoryName,
            type: ChannelType.GuildCategory,
            position: 0,
        });
    }

    return category;
}
