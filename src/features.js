import fs from 'fs';
import { Events } from 'discord.js';

/**
 * @typedef {import('discord.js').Events} Events
 */

export default class Features {
    static async run(client) {
        const features = fs.readdirSync('src/features/').filter(file => file.endsWith('.js'));

        for (let i = 0; i < features.length; i++) 
        {
            const file = features[i];
            const module = (await import(`./features/${file}`)).default;

            try {
                console.log('✓', file.slice(0,-3));
                await module(client);
                // process.stdout.write('✓')
            } catch (error) {
                console.log('✗', file.slice(0,-3));
                // process.stdout.write('✗')
                console.log(error);
            }
        }
    }
}