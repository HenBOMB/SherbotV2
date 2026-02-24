import 'dotenv/config';
import { CaseBuilder } from '../src/features/mm/procedural/CaseBuilder.js';
import fs from 'fs';
import path from 'path';

async function main() {
    const builder = new CaseBuilder();

    console.log("🕵️  Sherbot Procedural Case Generator");
    console.log("-------------------------------------");

    try {
        const caseConfig = await builder.build({
            theme: 'noir',
            difficulty: 'medium',
            seed: Date.now().toString(),
        });

        console.log("\n✅ Case Generated Successfully!");
        console.log(`Title: ${caseConfig.name}`);
        console.log(`ID: ${caseConfig.id}`);
        console.log(`Victim: ${caseConfig.victim.name}`);
        console.log(`Killer: ${caseConfig.solution.killer}`); // Debug info

        // Save to file
        const outputDir = path.join(process.cwd(), 'data', 'cases', caseConfig.id);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        fs.writeFileSync(
            path.join(outputDir, 'case.json'),
            JSON.stringify(caseConfig, null, 4)
        );

        console.log(`\n📁 Saved to: data/cases/${caseConfig.id}/case.json`);
        console.log(`👉 To play: /mm start case:${caseConfig.id}`);

    } catch (error) {
        console.error("❌ Generation Failed:", error);
    }
}

main();
