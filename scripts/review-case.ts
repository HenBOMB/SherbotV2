import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { Verifier } from '../src/features/mm/procedural/logic/Verifier.js';
import { CaseConfig } from '../src/features/mm/case.js';

const casesDir = path.join(process.cwd(), 'data', 'cases');

async function main() {
    console.log("🕵️  Case Review System");
    console.log("----------------------");

    // Find unverified procedural cases
    const cases = fs.readdirSync(casesDir).filter(dir => dir.startsWith('proc_'));

    if (cases.length === 0) {
        console.log("No procedural cases found to review.");
        return;
    }

    const verifier = new Verifier();
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    for (const caseId of cases) {
        const casePath = path.join(casesDir, caseId, 'case.json');
        if (!fs.existsSync(casePath)) continue;

        try {
            const caseData: CaseConfig = JSON.parse(fs.readFileSync(casePath, 'utf-8'));

            // Skip if already verified
            if ((caseData as any).meta?.verified) continue;

            console.log(`\n\n🔎 REVIEWING CASE: ${caseData.name} (${caseId})`);
            console.log("==========================================");
            console.log(`VICTIM: ${caseData.victim.name} (${caseData.victim.cause})`);
            console.log(`KILLER: ${(caseData.solution as any).killer}`);
            console.log(`MOTIVE: ${(caseData.solution as any).motive}`);
            console.log(`INTRO:  ${caseData.description.substring(0, 100)}...`);

            // Run Automated Verification
            const result = verifier.verify(caseData);
            console.log("\n🤖 AUTOMATED CHECKS:");
            console.log(`Score: ${result.score}/100`);
            if (result.issues.length > 0) {
                result.issues.forEach(issue => console.log(` - ${issue}`));
            } else {
                console.log(" - No mechanical issues found.");
            }

            // Human Decision
            await new Promise<void>(resolve => {
                rl.question('\nAction? [A]pprove / [D]elete / [S]kip: ', (answer) => {
                    const action = answer.trim().toUpperCase();

                    if (action === 'A') {
                        // Mark as verified
                        (caseData as any).meta = {
                            generatedAt: Date.now(),
                            verified: true,
                            solvabilityScore: result.score
                        };
                        fs.writeFileSync(casePath, JSON.stringify(caseData, null, 4));
                        console.log("✅ Case APPROVED.");
                    } else if (action === 'D') {
                        // Delete directory
                        fs.rmSync(path.join(casesDir, caseId), { recursive: true, force: true });
                        console.log("🗑️  Case DELETED.");
                    } else {
                        console.log("⏭️  Skipped.");
                    }
                    resolve();
                });
            });

        } catch (e) {
            console.error(`Error reading ${caseId}:`, e);
        }
    }

    rl.close();
    console.log("\nReview session complete.");
}

main();
