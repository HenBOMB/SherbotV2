import json
import os
import sys
import argparse
import yaml
import re
from typing import List, Dict, Set, Any, Optional

# ─────────────────────────────────────────────
#  Result collectors
# ─────────────────────────────────────────────

class Result:
    def __init__(self):
        self.errors: List[str] = []
        self.warnings: List[str] = []

    def err(self, msg: str):
        self.errors.append(msg)

    def warn(self, msg: str):
        self.warnings.append(msg)


# ─────────────────────────────────────────────
#  Check helpers
# ─────────────────────────────────────────────

def _dfs_reachable(start: str, graph: Dict[str, List[str]]) -> Set[str]:
    visited, stack = set(), [start]
    while stack:
        node = stack.pop()
        if node in visited:
            continue
        visited.add(node)
        for neighbor in graph.get(node, []):
            stack.append(neighbor)
    return visited


# ─────────────────────────────────────────────
#  Section validators
# ─────────────────────────────────────────────

def check_schema(data: dict, r: Result):
    """1. Required top-level keys and basic types."""
    required = ['id', 'name', 'description', 'victim', 'murderTime',
                'murderLocation', 'evidence', 'solution', 'suspects', 'settings']
    for field in required:
        if field not in data:
            r.err(f"Schema: Missing required top-level field '{field}'")

    if 'victim' in data:
        for vf in ['name', 'id', 'avatar']:
            if vf not in data['victim']:
                r.warn(f"Schema: Victim missing recommended field '{vf}'")

    if 'point_system' in data:
        for pf in ['question_cost', 'search_cost', 'correct_deduction_reward', 'key_evidence_reward']:
            if pf not in data['point_system']:
                r.warn(f"Schema: point_system missing field '{pf}'")

    # NEW: Detect duplicate YAML keys by re-scanning raw text (already parsed, so warn about known-risky patterns)
    # This is handled by the pre-parse scan in validate_case()


def check_duplicate_keys_raw(text: str, r: Result):
    """NEW #1: Scan raw YAML text for duplicate sibling keys.

    Strategy: track a stack of (indent, seen_keys_dict). When we encounter a
    mapping key at a given indent, we look up the innermost scope that owns
    that indent level. List item markers (lines starting with '- ') open a
    fresh scope so that fields repeated across list items (id, text, etc.)
    are not falsely flagged.
    """
    # Stack entries: (indent_level, is_list_item_scope, seen: dict[key->lineno])
    scope_stack: List[tuple] = [(-1, False, {})]

    for lineno, raw_line in enumerate(text.splitlines(), 1):
        stripped = raw_line.lstrip()
        if not stripped or stripped.startswith('#'):
            continue

        indent = len(raw_line) - len(stripped)

        # List item: opens a fresh mapping scope at this indent
        is_list_item = stripped.startswith('- ')
        if is_list_item:
            # Pop scopes deeper than or equal to this indent
            while len(scope_stack) > 1 and scope_stack[-1][0] >= indent:
                scope_stack.pop()
            # Push a fresh scope for this list item's mapping
            scope_stack.append((indent, True, {}))
            # Treat remainder after '- ' as a potential inline key
            stripped = stripped[2:].lstrip()
            if not stripped or ':' not in stripped:
                continue
            indent = indent + 2  # the key lives two spaces deeper

        if ':' not in stripped:
            continue

        # Extract key: handle quoted keys like '10:28': or "foo:bar":
        key = None
        m_quoted = re.match(r"""^(['"])(.*?)\1\s*:""", stripped)
        if m_quoted:
            key = m_quoted.group(2)
        elif ':' in stripped:
            key = stripped.split(':')[0].strip().strip("'\"")
        if not key or key.startswith('{'):
            continue

        # Pop scopes that are strictly deeper than current indent
        while len(scope_stack) > 1 and scope_stack[-1][0] >= indent:
            scope_stack.pop()

        current_scope = scope_stack[-1][2]
        if key in current_scope:
            r.err(
                f"Duplicate Key (line ~{lineno}): '{key}' already seen at line "
                f"~{current_scope[key]} within the same mapping block — "
                f"one entry will be silently dropped by YAML parsers"
            )
        else:
            current_scope[key] = lineno

        # If this key introduces a new nested mapping (ends with ':'), push a scope
        if stripped.rstrip().endswith(':') or (': ' not in stripped and stripped.endswith(':')):
            scope_stack.append((indent + 1, False, {}))


def check_map(data: dict, r: Result) -> tuple:
    """2. Map room integrity + bidirectionality + connectivity."""
    rooms = set()
    adj: Dict[str, List[str]] = {}

    if 'map' not in data:
        r.err("Map: No 'map' key defined")
        return rooms, adj

    for room_id, room_info in data['map'].items():
        rooms.add(room_id)

    for room_id, room_info in data['map'].items():
        connects = []
        if isinstance(room_info, dict):
            connects = room_info.get('connects_to', [])

            # NEW #2: Interactable evidence_id cross-reference
            for item in room_info.get('interactables', []):
                eid = item.get('evidence_id')
                if eid:
                    # Will be validated against physical_evidence later; store for cross-check
                    pass  # deferred to check_evidence_ids()

        elif isinstance(room_info, list):
            connects = room_info

        adj[room_id] = []
        for target in connects:
            if target not in rooms:
                r.err(f"Map: Room '{room_id}' connects_to non-existent room '{target}'")
            else:
                adj[room_id].append(target)

    # Bidirectional check
    for room_id, neighbors in adj.items():
        for target in neighbors:
            if room_id not in adj.get(target, []):
                r.warn(f"Map: '{room_id}' → '{target}' is one-way (no return connection)")

    # NEW #3: Connectivity — every room must be reachable from the first room
    if rooms:
        start = next(iter(data['map'].keys()))
        reachable = _dfs_reachable(start, adj)
        isolated = rooms - reachable
        for room_id in isolated:
            r.warn(f"Map: Room '{room_id}' is unreachable from '{start}' — players may be stranded")

    # NEW #4: Murder location must appear in map
    murder_loc = data.get('murderLocation')
    if murder_loc and murder_loc not in rooms:
        r.err(f"Map: murderLocation '{murder_loc}' not found in map rooms")

    return rooms, adj


def check_suspects_and_solution(data: dict, rooms: Set[str], r: Result) -> tuple:
    """3. Suspect flags, solution coherence, currentLocation."""
    suspects = data.get('suspects', [])
    suspect_ids = {s['id'] for s in suspects}
    solution = data.get('solution', {})

    killer_id = solution.get('killer') if isinstance(solution, dict) else solution
    accomplice_id = solution.get('accomplice', 'none') if isinstance(solution, dict) else 'none'
    silent_witness_id = solution.get('silent_witness', 'none') if isinstance(solution, dict) else 'none'

    if killer_id not in suspect_ids:
        r.err(f"Solution: Killer '{killer_id}' not found in suspects list")
    if accomplice_id != 'none' and accomplice_id not in suspect_ids:
        r.err(f"Solution: Accomplice '{accomplice_id}' not found in suspects list")
    if silent_witness_id != 'none' and silent_witness_id not in suspect_ids:
        r.err(f"Solution: Silent witness '{silent_witness_id}' not found in suspects list")

    # NEW #5: solution.key_evidence tracked separately — validated in check_evidence_ids()

    for suspect in suspects:
        sid = suspect['id']

        # currentLocation
        cl = suspect.get('currentLocation')
        if cl and cl not in rooms:
            r.err(f"Suspect '{sid}': currentLocation '{cl}' not in map")

        # isGuilty / isAccomplice / isSilentWitness consistency
        if sid == killer_id:
            if not suspect.get('isGuilty'):
                r.err(f"Suspect '{sid}': is solution killer but isGuilty is not true")
        else:
            if suspect.get('isGuilty'):
                r.err(f"Suspect '{sid}': isGuilty is true but is not the solution killer")

        if sid == accomplice_id:
            if not suspect.get('isAccomplice'):
                r.err(f"Suspect '{sid}': is solution accomplice but isAccomplice is not true")
        elif suspect.get('isAccomplice'):
            r.err(f"Suspect '{sid}': isAccomplice is true but is not the solution accomplice")

        if sid == silent_witness_id:
            if not suspect.get('isSilentWitness'):
                r.err(f"Suspect '{sid}': is solution silent_witness but isSilentWitness is not true")
        elif suspect.get('isSilentWitness'):
            r.err(f"Suspect '{sid}': isSilentWitness is true but is not the solution silent_witness")

        # NEW #6: Alibi coherence — killer should not be physically impossible to have committed the crime
        # (basic: warn if killer has no alibi field, since a missing alibi is a design gap)
        if not suspect.get('alibi'):
            r.warn(f"Suspect '{sid}': Missing alibi field")

        # NEW #7: Every suspect should have at least one secret
        if not suspect.get('secrets'):
            r.warn(f"Suspect '{sid}': Has no secrets defined — may be a dead end for players")

        # NEW #8: resistance_level should be a known value
        rl = suspect.get('resistance_level')
        if rl and rl not in ('low', 'moderate', 'high', 'expert'):
            r.warn(f"Suspect '{sid}': Unrecognised resistance_level '{rl}' (expected: low/moderate/high/expert)")

    return suspect_ids, killer_id, accomplice_id, silent_witness_id


def collect_all_secret_ids(data: dict) -> Dict[str, Set[str]]:
    result = {}
    for suspect in data.get('suspects', []):
        result[suspect['id']] = {s['id'] for s in suspect.get('secrets', [])}
    return result


def check_evidence_ids(data: dict, rooms: Set[str], suspect_ids: Set[str],
                       killer_id: str, r: Result):
    """4 & 5. Evidence cross-references, discovery rooms, DNA, requiresEvidence."""
    evidence = data.get('evidence', {})
    phys_ev = evidence.get('physical_evidence', {})
    phys_ev_ids = set(phys_ev.keys())
    solution = data.get('solution', {})

    # physical_discovery rooms and IDs
    for room_id, ev_list in evidence.get('physical_discovery', {}).items():
        if room_id not in rooms:
            r.err(f"Evidence: physical_discovery references non-existent room '{room_id}'")
        if not isinstance(ev_list, list):
            r.err(f"Evidence: physical_discovery['{room_id}'] must be a list, got {type(ev_list).__name__}")
            continue
        for ev_id in ev_list:
            if ev_id not in phys_ev_ids:
                r.err(f"Evidence: physical_discovery room '{room_id}' references undeclared evidence '{ev_id}'")

    # NEW #9: Interactable evidence_id must exist in physical_evidence
    for room_id, room_info in data.get('map', {}).items():
        if not isinstance(room_info, dict):
            continue
        for item in room_info.get('interactables', []):
            eid = item.get('evidence_id')
            if eid and eid not in phys_ev_ids:
                r.err(f"Map: Interactable '{item.get('name')}' in '{room_id}' has evidence_id '{eid}' not in physical_evidence")

    # NEW #10: Every physical_evidence item must be discoverable somewhere
    discoverable = set()
    for ev_list in evidence.get('physical_discovery', {}).values():
        if isinstance(ev_list, list):
            discoverable.update(ev_list)
    for ev_id in phys_ev_ids:
        if ev_id not in discoverable:
            r.warn(f"Evidence: '{ev_id}' is declared in physical_evidence but not listed in any physical_discovery room — players can never find it")

    # key_evidence vs physical_evidence
    if isinstance(solution, dict):
        for ev_id in solution.get('key_evidence', []):
            if ev_id not in phys_ev_ids:
                r.err(f"Solution: key_evidence '{ev_id}' not declared in physical_evidence")

    # all_locations vs map
    for loc in evidence.get('all_locations', []):
        if loc not in rooms:
            r.err(f"Evidence: all_locations contains non-existent room '{loc}'")

    # DNA
    victim_data = data.get('victim', {})
    victim_id = victim_data.get('id', '').lower()
    victim_name = victim_data.get('name', '').split()[0].lower()
    known_profiles = suspect_ids | {'victim', victim_id, victim_name} - {''}

    for room_id, names in evidence.get('dna', {}).items():
        if room_id not in rooms:
            r.err(f"DNA: References non-existent room '{room_id}'")
        if not isinstance(names, list):
            r.err(f"DNA: Entry for room '{room_id}' must be a list (got {type(names).__name__}) — did you add a '_note' key inside the dna block by mistake?")
            continue
        for name in names:
            if name not in known_profiles:
                r.warn(f"DNA: Unknown profile '{name}' in room '{room_id}'")

    # NEW #11: Killer should leave DNA at murder location
    murder_loc = data.get('murderLocation')
    if murder_loc and killer_id:
        killer_dna_rooms = [room for room, names in evidence.get('dna', {}).items()
                            if isinstance(names, list) and killer_id in names]
        if murder_loc not in killer_dna_rooms:
            r.warn(f"Evidence: Killer '{killer_id}' has no DNA at murder location '{murder_loc}' — may be intentional (gloves etc.) but worth confirming")


def check_secret_triggers(data: dict, rooms: Set[str], r: Result):
    """5. requiresEvidence and requiresSecrets cross-references."""
    evidence = data.get('evidence', {})
    phys_ev_ids = set(evidence.get('physical_evidence', {}).keys())
    digital_log_ids = set(evidence.get('digital_logs', {}).keys())
    footage_ids = set(evidence.get('footage', {}).keys())

    # All valid "flat" evidence IDs the engine can know about
    valid_flat_ids = phys_ev_ids | digital_log_ids | footage_ids | rooms

    all_secret_ids = collect_all_secret_ids(data)
    # Flat set of all secret IDs across all suspects
    all_secret_ids_flat = {sid for ids in all_secret_ids.values() for sid in ids}

    for suspect in data.get('suspects', []):
        sid = suspect['id']
        own_secret_ids = all_secret_ids.get(sid, set())

        for secret in suspect.get('secrets', []):
            sec_id = secret['id']
            trigger = secret.get('trigger', {})

            # requiresEvidence
            for req in trigger.get('requiresEvidence', []):
                # NEW #12: Flag dot-notation — engine uses requiresSecrets for secret refs
                if '.' in req:
                    r.err(f"Suspect '{sid}' secret '{sec_id}': requiresEvidence uses dot-notation '{req}' — use requiresSecrets for secret cross-references")
                elif req not in valid_flat_ids:
                    r.err(f"Suspect '{sid}' secret '{sec_id}': requiresEvidence references undeclared ID '{req}'")

            # requiresSecrets
            for req in trigger.get('requiresSecrets', []):
                # NEW #13: requiresSecrets entries should be valid secret IDs
                if req not in all_secret_ids_flat:
                    r.err(f"Suspect '{sid}' secret '{sec_id}': requiresSecrets references unknown secret ID '{req}'")

            # NEW #14: Circular secret dependency check (secret requiring itself)
            if sec_id in trigger.get('requiresSecrets', []):
                r.err(f"Suspect '{sid}' secret '{sec_id}': requiresSecrets references itself — circular dependency")

            # NEW #15: minPressure should be a number
            mp = trigger.get('minPressure')
            if mp is not None and not isinstance(mp, (int, float)):
                r.err(f"Suspect '{sid}' secret '{sec_id}': minPressure must be a number, got '{mp}'")

            # NEW #16: Warn if minPressure > 80 — likely unreachable in expert mode
            if isinstance(mp, (int, float)) and mp > 80:
                r.warn(f"Suspect '{sid}' secret '{sec_id}': minPressure={mp} is very high — may be unreachable within point budget")

    # NEW #17: Secret ordering — warn if a secret has a lower minPressure than a secret it depends on
    for suspect in data.get('suspects', []):
        sid = suspect['id']
        secret_pressure: Dict[str, int] = {}
        for secret in suspect.get('secrets', []):
            mp = secret.get('trigger', {}).get('minPressure', 0)
            secret_pressure[secret['id']] = mp

        for secret in suspect.get('secrets', []):
            sec_id = secret['id']
            sec_mp = secret_pressure.get(sec_id, 0)
            for req in secret.get('trigger', {}).get('requiresSecrets', []):
                req_mp = secret_pressure.get(req)
                if req_mp is not None and sec_mp <= req_mp:
                    r.warn(f"Suspect '{sid}' secret '{sec_id}' (minPressure={sec_mp}) requires secret '{req}' (minPressure={req_mp}) but has equal or lower pressure — '{req}' may never unlock first")


def check_assets(data: dict, project_root: str, r: Result):
    """6. Avatar and room image file existence."""
    def check_asset(asset_path: Optional[str], context: str):
        if not asset_path:
            return
        relative_path = asset_path.lstrip('/')
        full_path = os.path.join(project_root, 'public', relative_path)
        if not os.path.exists(full_path):
            r.err(f"Resource: {context} '{asset_path}' not found at {full_path}")

    check_asset(data.get('victim', {}).get('avatar'), "Victim avatar")

    for suspect in data.get('suspects', []):
        check_asset(suspect.get('avatar'), f"Suspect '{suspect['id']}' avatar")

    for room_id, room_info in data.get('map', {}).items():
        if isinstance(room_info, dict) and 'image' in room_info:
            check_asset(room_info['image'], f"Room '{room_id}' image")


def check_narrative_consistency(data: dict, r: Result):
    """NEW #18–22: Higher-level narrative / design coherence checks."""
    solution = data.get('solution', {}) if isinstance(data.get('solution'), dict) else {}
    killer_id = solution.get('killer')
    suspects = {s['id']: s for s in data.get('suspects', [])}
    evidence = data.get('evidence', {})
    phys_ev_ids = set(evidence.get('physical_evidence', {}).keys())

    # NEW #18: Every key_evidence item should appear in at least one suspect's secret trigger
    all_required_evidence: Set[str] = set()
    for suspect in data.get('suspects', []):
        for secret in suspect.get('secrets', []):
            all_required_evidence.update(secret.get('trigger', {}).get('requiresEvidence', []))

    for ev_id in solution.get('key_evidence', []):
        if ev_id not in all_required_evidence:
            r.warn(f"Narrative: key_evidence '{ev_id}' is never required by any suspect secret trigger — it may have no mechanical effect")

    # NEW #19: Killer must have at least one secret that requires the murder location evidence
    murder_loc = data.get('murderLocation')
    if killer_id and murder_loc and killer_id in suspects:
        killer_secrets = suspects[killer_id].get('secrets', [])
        phys_discovery = evidence.get('physical_discovery', {})
        murder_evidence = set(phys_discovery.get(murder_loc, []))
        killer_requires_murder_ev = any(
            ev in murder_evidence
            for s in killer_secrets
            for ev in s.get('trigger', {}).get('requiresEvidence', [])
        )
        if not killer_requires_murder_ev and murder_evidence:
            r.warn(f"Narrative: Killer '{killer_id}' has no secret triggered by murder scene evidence — the smoking gun may not connect to them mechanically")

    # NEW #20: Warn if the case has no full_confession-style terminal secret for the killer
    if killer_id and killer_id in suspects:
        killer_secrets = suspects[killer_id].get('secrets', [])
        has_terminal = any('confession' in s['id'].lower() or 'confess' in s.get('text', '').lower()
                           for s in killer_secrets)
        if not has_terminal:
            r.warn(f"Narrative: Killer '{killer_id}' has no confession/terminal secret — player may have no satisfying climax moment")

    # NEW #21: Initial police statements should exist for all suspects
    statements = evidence.get('initial_police_statements', {})
    for suspect in data.get('suspects', []):
        sid = suspect['id']
        if sid not in statements:
            r.warn(f"Narrative: Suspect '{sid}' has no initial police statement")

    # NEW #22: Win conditions should reference the killer
    wc = data.get('win_conditions', {})
    if wc and killer_id:
        wc_text = json.dumps(wc).lower()
        killer_name = suspects.get(killer_id, {}).get('name', '').lower()
        if killer_id.lower() not in wc_text and killer_name not in wc_text:
            r.warn(f"Narrative: win_conditions text doesn't mention killer '{killer_id}' — may be vague")


# ─────────────────────────────────────────────
#  Main entry
# ─────────────────────────────────────────────

def validate_case(case_path: str):
    if not os.path.exists(case_path):
        print(f"Error: Case file '{case_path}' not found.")
        return

    is_yaml = case_path.lower().endswith(('.yaml', '.yml'))

    with open(case_path, 'r', encoding='utf-8') as f:
        raw_text = f.read()

    r = Result()

    # Pre-parse: raw duplicate key scan
    check_duplicate_keys_raw(raw_text, r)

    # Parse
    try:
        data = yaml.safe_load(raw_text) if is_yaml else json.loads(raw_text)
    except (json.JSONDecodeError, yaml.YAMLError) as e:
        print(f"FATAL: Failed to parse {'YAML' if is_yaml else 'JSON'}: {e}")
        return

    project_root = '/home/henry/Coding/Node/SherbotV2'

    # Run all checks
    check_schema(data, r)
    rooms, adj = check_map(data, r)
    suspect_ids, killer_id, accomplice_id, silent_witness_id = check_suspects_and_solution(data, rooms, r)
    check_evidence_ids(data, rooms, suspect_ids, killer_id, r)
    check_secret_triggers(data, rooms, r)
    check_assets(data, project_root, r)
    check_narrative_consistency(data, r)

    # Report
    case_id = data.get('id', 'unknown')
    print(f"\n{'='*55}")
    print(f"  Verification Report: {data.get('name', 'Unknown')} ({case_id})")
    print(f"{'='*55}")

    if r.errors:
        print(f"\n❌ FAILED — {len(r.errors)} error(s):\n")
        for e in r.errors:
            print(f"  [ERR] {e}")
    else:
        print(f"\n✅ PASSED — No critical errors.")

    if r.warnings:
        print(f"\n⚠️  {len(r.warnings)} warning(s):\n")
        for w in r.warnings:
            print(f"  [WRN] {w}")

    if not r.errors and not r.warnings:
        print("  Everything looks perfect!")

    print(f"\n{'='*55}\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Verify a Murder Mystery case YAML/JSON file.")
    parser.add_argument("--case", type=str, help="Path to the case file")
    args = parser.parse_args()

    default_case = '/home/henry/Coding/Node/SherbotV2/data/cases/silicon_shadows/case.yaml'
    if not os.path.exists(default_case):
        default_case = default_case.replace('.yaml', '.json')

    target_case = args.case if args.case else default_case
    validate_case(target_case)