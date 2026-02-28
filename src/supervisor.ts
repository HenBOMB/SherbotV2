import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RESTART_CODE = 42;
const BOT_SCRIPT = process.env.TEST_MOCK_BOT || path.join(__dirname, 'index.ts');

function startBot() {
    console.log('\n[SUPERVISOR] Starting Sherbot instance...');

    // Using tsx to run the TypeScript source directly, matching 'npm run dev' behavior
    const bot = spawn('npx', ['tsx', BOT_SCRIPT], {
        stdio: 'inherit',
        shell: true
    });

    bot.on('exit', (code) => {
        console.log(`\n[SUPERVISOR] Sherbot exited with code ${code}`);

        if (code === RESTART_CODE) {
            console.log('[SUPERVISOR] Restart signal detected. Booting new instance in 2 seconds...');
            setTimeout(startBot, 2000);
        } else {
            console.log('[SUPERVISOR] Regular exit or crash. Supervisor shutting down.');
            process.exit(code || 0);
        }
    });

    bot.on('error', (err) => {
        console.error('[SUPERVISOR] Failed to start bot:', err);
        process.exit(1);
    });
}

console.log('--- SHERBOT SUPERVISOR LOADED ---');
startBot();
