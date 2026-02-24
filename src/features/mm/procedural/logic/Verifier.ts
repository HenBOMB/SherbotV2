import { CaseConfig } from '../../case.js';

export interface VerificationResult {
    isSolvable: boolean;
    score: number;
    issues: string[];
}

export class Verifier {
    verify(caseConfig: CaseConfig): VerificationResult {
        const issues: string[] = [];
        let score = 100;

        // 1. Check for Killer
        const killerId = typeof caseConfig.solution === 'string' ? caseConfig.solution : caseConfig.solution.killer;

        if (!killerId) {
            issues.push("CRITICAL: No killer assigned.");
            score = 0;
            return { isSolvable: false, score, issues };
        }

        // 2. Check for Murder Weapon
        const weapon = caseConfig.evidence.physical_evidence ? Object.keys(caseConfig.evidence.physical_evidence)[0] : null;
        if (!weapon) {
            issues.push("CRITICAL: No physical evidence (weapon) defined.");
            score -= 50;
        }

        // 3. Check for DNA/Evidence Reachability
        // (Simple check: is the location of the DNA in the map?)
        const mapRooms = Object.keys(caseConfig.map || {});

        // Check DNA locations
        for (const [room, profiles] of Object.entries(caseConfig.evidence.dna || {})) {
            if (!mapRooms.includes(room)) {
                issues.push(`WARNING: DNA found in '${room}' but room is not in map.`);
                score -= 10;
            }
        }

        // Check Physical Evidence locations
        // This requires parsing the description string in V1 ("Found in back_room")
        // In a real system we'd have a structured location field

        // 4. Narrative Consistency (Basic)
        // Does the killer have a motive?
        // killerId is already defined above
        const killer = caseConfig.suspects.find(s => s.id === killerId);

        if (!killer) {
            issues.push(`CRITICAL: Killer '${killerId}' not found in suspects list.`);
            score = 0;
        } else if (!killer.motive || killer.motive === "N/A") {
            issues.push(`WARNING: Killer '${killer.name}' has no motive.`);
            score -= 20;
        }

        return {
            isSolvable: score > 0,
            score: Math.max(0, score),
            issues
        };
    }
}
