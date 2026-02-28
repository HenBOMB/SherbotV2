
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Manual Validation Helpers ---

function assertType(value: any, type: string, path: string) {
    if (typeof value !== type) {
        throw new Error(`Expected ${path} to be type '${type}', got '${typeof value}'`);
    }
}

function assertArray(value: any, path: string) {
    if (!Array.isArray(value)) {
        throw new Error(`Expected ${path} to be an array`);
    }
}

function assertObject(value: any, path: string) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`Expected ${path} to be an object`);
    }
}

function assertEnum(value: any, allowed: any[], path: string) {
    if (!allowed.includes(value)) {
        throw new Error(`Expected ${path} to be one of [${allowed.join(', ')}], got '${value}'`);
    }
}

function assertRegex(value: any, regex: RegExp, path: string) {
    if (typeof value !== 'string' || !regex.test(value)) {
        throw new Error(`Invalid format for ${path}: '${value}'`);
    }
}

// --- Validation Logic ---

function validateCase(caseData: any, folderName: string) {
    const errors: string[] = [];
    const addError = (msg: string) => errors.push(msg);

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
            const entry = caseData.map[room];
            // Support both string[] (legacy) and RoomInfo { description, connects_to, interactables? }
            if (Array.isArray(entry)) {
                entry.forEach((c: any) => assertType(c, 'string', `map.${room} connection`));
            } else {
                assertObject(entry, `map.${room}`);
                assertType(entry.description, 'string', `map.${room}.description`);
                assertArray(entry.connects_to, `map.${room}.connects_to`);
                entry.connects_to.forEach((c: any) => assertType(c, 'string', `map.${room}.connects_to entry`));
                if (entry.interactables !== undefined) {
                    assertArray(entry.interactables, `map.${room}.interactables`);
                    entry.interactables.forEach((obj: any, i: number) => {
                        assertType(obj.name, 'string', `map.${room}.interactables[${i}].name`);
                        assertType(obj.description, 'string', `map.${room}.interactables[${i}].description`);
                    });
                }
            }
        }

        // Suspects
        assertArray(caseData.suspects, 'case.suspects');
        caseData.suspects.forEach((s: any, i: number) => {
            const p = `suspects[${i}]`;
            assertType(s.id, 'string', `${p}.id`);
            assertType(s.name, 'string', `${p}.name`);
            assertArray(s.alias, `${p}.alias`);
            assertType(s.currentLocation, 'string', `${p}.currentLocation`);
            assertType(s.isGuilty, 'boolean', `${p}.isGuilty`);
            assertType(s.alibi, 'string', `${p}.alibi`);
            assertType(s.motive, 'string', `${p}.motive`);
            assertArray(s.secrets, `${p}.secrets`);

            s.secrets.forEach((sec: any, k: number) => {
                assertType(sec.id, 'string', `${p}.secrets[${k}].id`);
                assertObject(sec.trigger, `${p}.secrets[${k}].trigger`);
                assertArray(sec.trigger.keywords, `${p}.secrets[${k}].trigger.keywords`);
                if (sec.trigger.requiresEvidence) assertArray(sec.trigger.requiresEvidence, `${p}.secrets[${k}].trigger.requiresEvidence`);
            });
        });

        // Evidence
        assertObject(caseData.evidence, 'case.evidence');
        // Check sections exist
        ['dna', 'digital_logs', 'footage', 'locations', 'physical_evidence', 'physical_discovery'].forEach(k => {
            assertObject(caseData.evidence[k], `evidence.${k}`);
        });


        // 2. Referential Integrity
        const suspectIds = caseData.suspects.map((s: any) => s.id);
        const itemIds = Object.keys(caseData.evidence.physical_evidence);

        // Map Integrity
        if (!mapKeys.includes(caseData.murderLocation)) {
            addError(`murderLocation '${caseData.murderLocation}' is not in the map.`);
        }
        const getConns = (room: string): string[] => {
            const entry = caseData.map[room];
            if (Array.isArray(entry)) return entry;
            return entry?.connects_to ?? [];
        };
        for (const room of mapKeys) {
            const conns = getConns(room);
            conns.forEach((conn: string) => {
                if (!mapKeys.includes(conn)) addError(`Room '${room}' connects to '${conn}' (missing).`);
                else if (!getConns(conn).includes(room)) addError(`Map link mismatch: '${room}'->'${conn}' exists, but '${conn}'->'${room}' missing.`);
            });
        }
        // Map Reachability
        if (mapKeys.length > 0) {
            const visited = new Set([mapKeys[0]]);
            const queue = [mapKeys[0]];
            while (queue.length) {
                const curr = queue.shift()!;
                getConns(curr).forEach((n: string) => {
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
        const solutionId = typeof caseData.solution === 'string' ? caseData.solution : caseData.solution.killer;
        if (!suspectIds.includes(solutionId)) addError(`Solution '${solutionId}' is not a valid suspect.`);
        const guilty = caseData.suspects.find((s: any) => s.id === solutionId);
        if (guilty && !guilty.isGuilty) addError(`Solution suspect '${solutionId}' isGuilty is false.`);

        const seenSuspects = new Set();
        caseData.suspects.forEach((s: any) => {
            if (seenSuspects.has(s.id)) addError(`Duplicate suspect ID: ${s.id}`);
            seenSuspects.add(s.id);
            if (!mapKeys.includes(s.currentLocation)) addError(`Suspect '${s.id}' at invalid location '${s.currentLocation}'.`);

            s.secrets.forEach((sec: any) => {
                const triggers = sec.trigger.requiresEvidence || [];
                triggers.forEach((trig: string) => validateTrigger(trig, caseData, suspectIds, mapKeys, itemIds, addError));
            });
        });

        // Evidence Integrity
        Object.entries(caseData.evidence.dna).forEach(([room, list]) => {
            if (!mapKeys.includes(room)) addError(`DNA in invalid room '${room}'.`);
        });
        Object.entries(caseData.evidence.locations as Record<string, Record<string, string>>).forEach(([sid, locs]) => {
            if (!suspectIds.includes(sid)) addError(`Location evidence for unknown suspect '${sid}'.`);
            Object.values(locs).forEach((room: string) => {
                if (!mapKeys.includes(room) && room !== 'unknown') addError(`Suspect '${sid}' invalid location evidence '${room}'.`);
            });
        });
        Object.entries(caseData.evidence.physical_discovery as Record<string, string[]>).forEach(([room, list]) => {
            if (!mapKeys.includes(room)) addError(`Physical discovery in invalid room '${room}'.`);
            list.forEach((item: string) => {
                if (!itemIds.includes(item)) addError(`Unknown item '${item}' discovered in '${room}'.`);
            });
        });

    } catch (e: any) {
        addError(`Structure Error: ${e.message}`);
    }

    return errors;
}

function validateTrigger(trig: string, caseData: any, suspectIds: string[], mapKeys: string[], itemIds: string[], addError: (msg: string) => void) {
    if (trig.startsWith('logs_')) {
        const t = trig.replace('logs_', '');
        if (!caseData.evidence.digital_logs[t]) addError(`Missing log for trigger '${trig}'`);
    } else if (trig.startsWith('footage_')) {
        const t = trig.replace('footage_', '');
        if (!caseData.evidence.footage[t]) addError(`Missing footage for trigger '${trig}'`);
    } else if (trig.startsWith('dna_')) {
        const r = trig.replace('dna_', '');
        if (!caseData.evidence.dna[r]) addError(`Missing dna room for trigger '${trig}'`);
    } else if (trig.startsWith('physical_')) {
        const i = trig.replace('physical_', '');
        if (!itemIds.includes(i)) addError(`Missing item for trigger '${trig}'`);
    } else if (trig.startsWith('locations_')) {
        // locations_SUSPECT_TIME
        let found = false;
        for (const s of suspectIds) {
            if (trig.startsWith(`locations_${s}_`)) {
                const t = trig.replace(`locations_${s}_`, '');
                if (caseData.evidence.locations[s] && caseData.evidence.locations[s][t]) found = true;
                break;
            }
        }
        if (!found) addError(`Missing location evidence for trigger '${trig}'`);
    } else if (trig.startsWith('secret_')) {
        // secret_SUSPECT_ID
        let found = false;
        for (const s of suspectIds) {
            if (trig.startsWith(`secret_${s}_`)) {
                const id = trig.replace(`secret_${s}_`, '');
                const susp = caseData.suspects.find((x: any) => x.id === s);
                if (susp && susp.secrets.find((x: any) => x.id === id)) found = true;
                break;
            }
        }
        if (!found) addError(`Missing secret for trigger '${trig}'`);
    } else if (itemIds.includes(trig)) {
        // Bare physical item ID (no prefix) — valid shorthand for physical_<id>
    } else {
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
        if (!fs.existsSync(p)) continue;

        console.log(`Checking ${folder}...`);
        try {
            const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
            const errs = validateCase(data, folder);
            if (errs.length > 0) {
                console.error(`❌ Errors in ${folder}:`);
                errs.forEach(e => console.error(`  - ${e}`));
                failures = true;
            } else {
                console.log(`✅ ${folder} OK`);
            }
        } catch (e: any) {
            console.error(`❌ Failed to parse/read ${folder}: ${e.message}`);
            failures = true;
        }
    }

    if (failures) process.exit(1);
}

main();
