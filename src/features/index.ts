import { Client } from 'discord.js';
import { logger } from '../utils/logger.js';

export default class Features {
    static async run(client: Client) {
        // Defined order for deterministic loading
        const features = [
            'commands/index.js',
            'welcome.js',
            'mod.js',
            'dailytips.js',
            'secret.js',
            'profiler.js',
            'ai.js'
        ];

        for (const file of features) {
            try {
                // Dynamic import with .js extension for NodeNext compatibility
                const module = (await import(`./${file}`)).default;

                logger.info(`✓ ${file.slice(0, -3)}`);
                await module(client);
            } catch (error) {
                logger.error(`✗ ${file.slice(0, -3)}`, error);
            }
        }
    }
}
