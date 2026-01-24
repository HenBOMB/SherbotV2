
import { MMGame } from './src/database.js';
import { logger } from './src/utils/logger.js';

async function check() {
    try {
        const games = await MMGame.findAll();
        console.log(`Found ${games.length} games in DB:`);
        for (const g of games) {
            console.log(`- Guild: ${g.guildId}, Case: ${g.caseId}, Phase: ${g.phase}`);
        }
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

check();
