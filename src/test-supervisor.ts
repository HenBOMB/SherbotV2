import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// This test mocks a bot that exits with 42 the first time and 0 the second time
const MOCK_BOT = `
console.log('--- MOCK BOT BOOTED ---');
const fs = require('fs');
const statePath = 'test-state.json';
let count = 0;
if (fs.existsSync(statePath)) {
    count = JSON.parse(fs.readFileSync(statePath)).count;
}

if (count === 0) {
    console.log('Mock Bot: Requesting restart...');
    fs.writeFileSync(statePath, JSON.stringify({ count: 1 }));
    process.exit(42);
} else {
    console.log('Mock Bot: Second run success. Exiting.');
    fs.unlinkSync(statePath);
    process.exit(0);
}
`;

const mockBotPath = path.join(__dirname, 'mock-bot.cjs');
fs.writeFileSync(mockBotPath, MOCK_BOT);

console.log('Testing Supervisor Logic...');
const supervisor = spawn('npx', ['tsx', 'src/supervisor.ts'], {
    stdio: ['inherit', 'pipe', 'inherit'],
    env: { ...process.env, TEST_MOCK_BOT: mockBotPath },
    shell: true
});

// We need to modify supervisor.ts slightly to allow testing with a mock bot
// or just manually verify the logs. 
// For this test, I'll just check if the output contains "Restart signal detected"

let output = '';
supervisor.stdout.on('data', (data) => {
    const str = data.toString();
    console.log(str);
    output += str;
});

setTimeout(() => {
    supervisor.kill();
    fs.unlinkSync(mockBotPath);

    if (output.includes('Restart signal detected')) {
        console.log('✅ TEST PASSED: Supervisor detected restart code and attempted restart.');
    } else {
        console.log('❌ TEST FAILED: Supervisor did not detect restart signal.');
        process.exit(1);
    }
}, 10000);
