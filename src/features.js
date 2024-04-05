import fs from 'fs';
import { Client, Events } from 'discord.js';

/**
 * @typedef {import('discord.js').Events} Events
 */

export default class Features {
    static run(client) {
        fs.readdirSync('src/features/').forEach(async file => {
            const module = (await import(`./features/${file}`)).default;
            
            // try {
            //     await new Promise(resolve => {
            //         module(client);
            //     }).catch(err => {
            //         // ? Just in case
            //         console.log('Feature crashed:');
            //         console.error(err);
            //     });
            //     console.log('✓', file.slice(0,-3));
            // } catch (error) {
            //     console.log('✗', file.slice(0,-3));
            // }
            try {
                module(client);
                console.log('✓', file.slice(0,-3));
            } catch (error) {
                console.log('✗', file.slice(0,-3));
            }
        });
    }
}