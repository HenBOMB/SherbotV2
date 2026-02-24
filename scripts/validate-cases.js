import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// --- Manual Validation Helpers ---
function assertType(value, type, path) {
    if (typeof value !== type) {
        throw new Error(`Expected ${path} to be type '${type}', got '${typeof value}'`);
    }
}
function assertArray(value, path) {
    if (!Array.isArray(value)) {
        throw new Error(`Expected ${path} to be an array`);
    }
}
function assertObject(value, path) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`Expected ${path} to be an object`);
    }
}
function assertEnum(value, allowed, path) {
    if (!allowed.includes(value)) {
        throw new Error(`Expected ${path} to be one of [${allowed.join(', ')}], got '${value}'`);
    }
}
function assertRegex(value, regex, path) {
    if (typeof value !== 'string' || !regex.test(value)) {
        throw new Error(`Invalid format for ${path}: '${value}'`);
    }
}
// --- Validation Logic ---
function validateCase(caseData, folderName) {
    const errors = [];
    const addError = (msg) => errors.push(msg);
    try {
        // 1. Structural Validation
        assertObject(caseData, 'root');
        assertType(caseData.id, 'string', 'case.id');
        assertType(caseData.name, 'string', 'case.name');
        assertType(caseData.description, 'string', 'case.description');
        // Victim
        assertObject(caseData.victim, 'case.victim');
        assertType(caseData.victim.name, 'string', 'victim.name');
        assertType(caseData.victim.cause, 'string', 'victim.cause');
        assertType(caseData.victim.description, 'string', 'victim.description');
        // Time & Location
        assertRegex(caseData.murderTime, /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'case.murderTime');
        assertType(caseData.murderLocation, 'string', 'case.murderLocation');
        // Map
        assertObject(caseData.map, 'case.map');
        const mapKeys = Object.keys(caseData.map);
        for (const room of mapKeys) {
            assertArray(caseData.map[room], `map.${room}`);
            caseData.map[room].forEach(c => assertType(c, 'string', `map.${room} connection`));
        }
        // Suspects
        assertArray(caseData.suspects, 'case.suspects');
        caseData.suspects.forEach((s, i) => {
            const p = `suspects[${i}]`;
            assertType(s.id, 'string', `${p}.id`);
            assertType(s.name, 'string', `${p}.name`);
            assertArray(s.alias, `${p}.alias`);
            assertType(s.currentLocation, 'string', `${p}.currentLocation`);
            assertType(s.isGuilty, 'boolean', `${p}.isGuilty`);
            assertType(s.alibi, 'string', `${p}.alibi`);
            assertType(s.motive, 'string', `${p}.motive`);
            assertArray(s.secrets, `${p}.secrets`);
            s.secrets.forEach((sec, k) => {
                assertType(sec.id, 'string', `${p}.secrets[${k}].id`);
                assertObject(sec.trigger, `${p}.secrets[${k}].trigger`);
                assertArray(sec.trigger.keywords, `${p}.secrets[${k}].trigger.keywords`);
                if (sec.trigger.requiresEvidence)
                    assertArray(sec.trigger.requiresEvidence, `${p}.secrets[${k}].trigger.requiresEvidence`);
            });
        });
        // Evidence
        assertObject(caseData.evidence, 'case.evidence');
        // Check sections exist
        ['dna', 'digital_logs', 'footage', 'locations', 'physical_evidence', 'physical_discovery'].forEach(k => {
            assertObject(caseData.evidence[k], `evidence.${k}`);
        });
        // 2. Referential Integrity
        const suspectIds = caseData.suspects.map(s => s.id);
        const itemIds = Object.keys(caseData.evidence.physical_evidence);
        // Map Integrity
        if (!mapKeys.includes(caseData.murderLocation)) {
            addError(`murderLocation '${caseData.murderLocation}' is not in the map.`);
        }
        for (const [room, conns] of Object.entries(caseData.map)) {
            conns.forEach(conn => {
                if (!mapKeys.includes(conn))
                    addError(`Room '${room}' connects to '${conn}' (missing).`);
                else if (!caseData.map[conn].includes(room))
                    addError(`Map link mismatch: '${room}'->'${conn}' exists, but '${conn}'->'${room}' missing.`);
            });
        }
        // Map Reachability
        if (mapKeys.length > 0) {
            const visited = new Set([mapKeys[0]]);
            const queue = [mapKeys[0]];
            while (queue.length) {
                const curr = queue.shift();
                caseData.map[curr].forEach(n => {
                    if (!visited.has(n)) {
                        visited.add(n);
                        queue.push(n);
                    }
                });
            }
            if (visited.size !== mapKeys.length) {
                const unreached = mapKeys.filter(r => !visited.has(r));
                addError(`Unreachable rooms: ${unreached.join(', ')}`);
            }
        }
        // Suspects Integrity
        if (!suspectIds.includes(caseData.solution))
            addError(`Solution '${caseData.solution}' is not a valid suspect.`);
        const guilty = caseData.suspects.find(s => s.id === caseData.solution);
        if (guilty && !guilty.isGuilty)
            addError(`Solution suspect '${caseData.solution}' isGuilty is false.`);
        const seenSuspects = new Set();
        caseData.suspects.forEach(s => {
            if (seenSuspects.has(s.id))
                addError(`Duplicate suspect ID: ${s.id}`);
            seenSuspects.add(s.id);
            if (!mapKeys.includes(s.currentLocation))
                addError(`Suspect '${s.id}' at invalid location '${s.currentLocation}'.`);
            s.secrets.forEach(sec => {
                const triggers = sec.trigger.requiresEvidence || [];
                triggers.forEach(trig => validateTrigger(trig, caseData, suspectIds, mapKeys, itemIds, addError));
            });
        });
        // Evidence Integrity
        Object.entries(caseData.evidence.dna).forEach(([room, list]) => {
            if (!mapKeys.includes(room))
                addError(`DNA in invalid room '${room}'.`);
        });
        Object.entries(caseData.evidence.locations).forEach(([sid, locs]) => {
            if (!suspectIds.includes(sid))
                addError(`Location evidence for unknown suspect '${sid}'.`);
            Object.values(locs).forEach(room => {
                if (!mapKeys.includes(room) && room !== 'unknown')
                    addError(`Suspect '${sid}' invalid location evidence '${room}'.`);
            });
        });
        Object.entries(caseData.evidence.physical_discovery).forEach(([room, list]) => {
            if (!mapKeys.includes(room))
                addError(`Physical discovery in invalid room '${room}'.`);
            list.forEach(item => {
                if (!itemIds.includes(item))
                    addError(`Unknown item '${item}' discovered in '${room}'.`);
            });
        });
    }
    catch (e) {
        addError(`Structure Error: ${e.message}`);
    }
    return errors;
}
function validateTrigger(trig, caseData, suspectIds, mapKeys, itemIds, addError) {
    if (trig.startsWith('logs_')) {
        const t = trig.replace('logs_', '');
        if (!caseData.evidence.digital_logs[t])
            addError(`Missing log for trigger '${trig}'`);
    }
    else if (trig.startsWith('footage_')) {
        const t = trig.replace('footage_', '');
        if (!caseData.evidence.footage[t])
            addError(`Missing footage for trigger '${trig}'`);
    }
    else if (trig.startsWith('dna_')) {
        const r = trig.replace('dna_', '');
        if (!caseData.evidence.dna[r])
            addError(`Missing dna room for trigger '${trig}'`);
    }
    else if (trig.startsWith('physical_')) {
        const i = trig.replace('physical_', '');
        if (!itemIds.includes(i))
            addError(`Missing item for trigger '${trig}'`);
    }
    else if (trig.startsWith('locations_')) {
        // locations_SUSPECT_TIME
        let found = false;
        for (const s of suspectIds) {
            if (trig.startsWith(`locations_${s}_`)) {
                const t = trig.replace(`locations_${s}_`, '');
                if (caseData.evidence.locations[s] && caseData.evidence.locations[s][t])
                    found = true;
                break;
            }
        }
        if (!found)
            addError(`Missing location evidence for trigger '${trig}'`);
    }
    else if (trig.startsWith('secret_')) {
        // secret_SUSPECT_ID
        let found = false;
        for (const s of suspectIds) {
            if (trig.startsWith(`secret_${s}_`)) {
                const id = trig.replace(`secret_${s}_`, '');
                const susp = caseData.suspects.find(x => x.id === s);
                if (susp && susp.secrets.find(x => x.id === id))
                    found = true;
                break;
            }
        }
        if (!found)
            addError(`Missing secret for trigger '${trig}'`);
    }
    else {
        addError(`Unknown trigger format: '${trig}'`);
    }
}
// --- Main ---
async function main() {
    const casesDir = path.join(process.cwd(), 'data', 'cases');
    if (!fs.existsSync(casesDir)) {
        console.error('No cases dir');
        process.exit(1);
    }
    const folders = fs.readdirSync(casesDir);
    let failures = false;
    console.log(`Found ${folders.length} cases.`);
    for (const folder of folders) {
        const p = path.join(casesDir, folder, 'case.json');
        if (!fs.existsSync(p))
            continue;
        console.log(`Checking ${folder}...`);
        try {
            const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
            const errs = validateCase(data, folder);
            if (errs.length > 0) {
                console.error(`❌ Errors in ${folder}:`);
                errs.forEach(e => console.error(`  - ${e}`));
                failures = true;
            }
            else {
                console.log(`✅ ${folder} OK`);
            }
        }
        catch (e) {
            console.error(`❌ Failed to parse/read ${folder}: ${e.message}`);
            failures = true;
        }
    }
    if (failures)
        process.exit(1);
}
main();
