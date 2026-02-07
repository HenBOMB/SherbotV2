import Case from './src/features/mm/case.js';
import path from 'path';

const caseId = 'silicon_shadows_easy';
const caseDir = path.join(process.cwd(), 'data', 'cases', caseId);

console.log(`Testing case: ${caseId}`);
console.log(`Case directory: ${caseDir}`);

try {
    const gameCase = Case.load(caseDir);
    console.log('✅ Case loaded successfully!');
    console.log(`Case Name: ${gameCase.config.name}`);
    console.log(`Suspects (${gameCase.config.suspects.length}): ${gameCase.config.suspects.map(s => s.name).join(', ')}`);
    console.log(`Valid Locations: ${gameCase.getValidLocations().length}`);

    // Validate some basic constraints
    if (!gameCase.config.solution) {
        console.error('❌ Error: No solution defined');
        process.exit(1);
    }

    // Check if solution points to a valid suspect
    const killer = gameCase.getSuspect(gameCase.config.solution);
    if (!killer) {
        console.error(`❌ Error: Solution points to unknown suspect ID: ${gameCase.config.solution}`);
        process.exit(1);
    }
    console.log(`Solution is valid (Killer: ${killer.name})`);

} catch (error) {
    console.error('❌ Error loading or validating case:', error);
    process.exit(1);
}
