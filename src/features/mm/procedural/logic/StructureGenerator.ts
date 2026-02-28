import { CaseSkeleton, GeneratorConfig, TimelineEvent } from '../types.js';

interface SuspectArchetype {
    role: string;
    psychProfile: string;
    defaultBehavior: string;
    likelySecretCategory: string;
    nervousTell: string;
}

interface EvidenceChain {
    item: string;
    location: string;
    implicates: string;   // suspectRole or 'victim'
    reason: string;       // narrative justification passed to Storyteller
}

interface Relationship {
    a: string;
    b: string;
    dynamic: string;      // e.g. 'exploited_employee', 'secret_affair'
    tensionLevel: 'low' | 'medium' | 'high';
}

interface CaseTemplate {
    id: string;
    victimRole: string;
    killerRole: string;
    suspectRoles: string[];
    suspectArchetypes: Record<string, SuspectArchetype>;
    locations: string[];
    mapConnections: Record<string, string[]>;
    weaponType: string;
    motiveCategory: string;
    relationships: Relationship[];
    evidenceChains: EvidenceChain[];
    redHerrings: EvidenceChain[];   // plausible but misleading
}

export class StructureGenerator {
    private templates: CaseTemplate[] = [
        // ── 1. THE ANTIQUE SHOP ─────────────────────────────────────────────
        {
            id: 'antique_shop',
            victimRole: 'shopkeeper',
            killerRole: 'apprentice',
            suspectRoles: ['apprentice', 'collector', 'rival_dealer', 'landlord'],
            suspectArchetypes: {
                apprentice: { role: 'apprentice', psychProfile: 'impulsive, resentful of being underestimated', defaultBehavior: 'deflects blame onto others immediately', likelySecretCategory: 'financial_fraud', nervousTell: 'picks at fingernails' },
                collector: { role: 'collector', psychProfile: 'obsessive, believes ownership justifies anything', defaultBehavior: 'changes subject to objects and value', likelySecretCategory: 'stolen_property', nervousTell: 'straightens nearby objects compulsively' },
                rival_dealer: { role: 'rival_dealer', psychProfile: 'cold, calculating, long-term thinker', defaultBehavior: 'stays unnervingly calm', likelySecretCategory: 'forgery', nervousTell: 'smiles at wrong moments' },
                landlord: { role: 'landlord', psychProfile: 'greedy, dismissive of emotional pleas', defaultBehavior: 'steers every topic back to money', likelySecretCategory: 'illegal_eviction', nervousTell: 'checks watch repeatedly' },
            },
            locations: ['shop_floor', 'apprentices_workbench', 'curators_desk', 'side_alley'],
            mapConnections: {
                shop_floor: ['apprentices_workbench', 'curators_desk'],
                apprentices_workbench: ['shop_floor', 'side_alley'],
                curators_desk: ['shop_floor', 'side_alley'],
                side_alley: ['apprentices_workbench', 'curators_desk'],
            },
            weaponType: 'blunt_object',
            motiveCategory: 'greed',
            relationships: [
                { a: 'apprentice', b: 'shopkeeper', dynamic: 'exploited_employee — victim promised ownership stake, never delivered', tensionLevel: 'high' },
                { a: 'rival_dealer', b: 'shopkeeper', dynamic: 'business_feud — victim exposed rival for selling forgeries', tensionLevel: 'high' },
                { a: 'landlord', b: 'shopkeeper', dynamic: 'debt_dispute — victim three months behind on rent', tensionLevel: 'medium' },
                { a: 'collector', b: 'shopkeeper', dynamic: 'obsessive_patron — victim refused to sell a specific piece', tensionLevel: 'medium' },
                { a: 'apprentice', b: 'rival_dealer', dynamic: 'secret_alliance — apprentice was feeding rival inside information', tensionLevel: 'high' },
            ],
            evidenceChains: [
                { item: 'falsified_stock_ledger', location: 'back_room', implicates: 'apprentice', reason: 'Apprentice had been skimming profits for months; ledger proves it' },
                { item: 'monogrammed_cufflink', location: 'alley', implicates: 'apprentice', reason: 'Lost during the struggle before fleeing through the alley' },
                { item: 'unsigned_eviction_notice', location: 'shop_floor', implicates: 'landlord', reason: 'Landlord visited that evening with a final ultimatum' },
            ],
            redHerrings: [
                { item: 'collectors_business_card', location: 'back_room', implicates: 'collector', reason: 'Collector was there earlier in the week, card fell behind a shelf' },
                { item: 'rival_catalog_with_notes', location: 'street', implicates: 'rival_dealer', reason: 'Victim had been researching the rival — looks incriminating but is defensive research' },
            ],
        },

        // ── 2. THE UNIVERSITY ───────────────────────────────────────────────
        {
            id: 'university',
            victimRole: 'professor',
            killerRole: 'colleague',
            suspectRoles: ['colleague', 'graduate_student', 'janitor', 'department_head'],
            suspectArchetypes: {
                colleague: { role: 'colleague', psychProfile: 'academically jealous, meticulously rational', defaultBehavior: 'questions every assumption in the investigation', likelySecretCategory: 'plagiarism', nervousTell: 'over-uses technical language to sound authoritative' },
                graduate_student: { role: 'graduate_student', psychProfile: 'exhausted, exploited, secretly furious', defaultBehavior: 'defers too quickly, then contradicts themselves', likelySecretCategory: 'forged_credentials', nervousTell: 'bites lip when mentioned certain names' },
                janitor: { role: 'janitor', psychProfile: 'observant, underestimated, harbors old grudges', defaultBehavior: 'volunteers information but always slightly late', likelySecretCategory: 'past_identity', nervousTell: 'lingers near exits' },
                department_head: { role: 'department_head', psychProfile: 'institutional, reputation-obsessed', defaultBehavior: 'tries to minimize scandal above all else', likelySecretCategory: 'corruption', nervousTell: 'refers to victim in present tense by mistake' },
            },
            locations: ['lecture_hall', 'professors_office', 'research_lab', 'main_hallway', 'campus_lot'],
            mapConnections: {
                lecture_hall: ['main_hallway'],
                professors_office: ['main_hallway', 'research_lab'],
                research_lab: ['professors_office', 'main_hallway'],
                main_hallway: ['lecture_hall', 'professors_office', 'research_lab', 'campus_lot'],
                campus_lot: ['main_hallway'],
            },
            weaponType: 'poison',
            motiveCategory: 'jealousy',
            relationships: [
                { a: 'colleague', b: 'professor', dynamic: 'stolen_credit — colleague co-authored paper the professor presented alone', tensionLevel: 'high' },
                { a: 'graduate_student', b: 'professor', dynamic: 'academic_exploitation — student did most of the research, never named', tensionLevel: 'high' },
                { a: 'department_head', b: 'professor', dynamic: 'pending_review — victim had filed misconduct complaint against the head', tensionLevel: 'high' },
                { a: 'janitor', b: 'professor', dynamic: 'old_grudge — victim got the janitor\'s brother fired years ago', tensionLevel: 'medium' },
                { a: 'colleague', b: 'graduate_student', dynamic: 'unlikely_allies — both were being exploited; met secretly', tensionLevel: 'medium' },
            ],
            evidenceChains: [
                { item: 'lab_access_log', location: 'laboratory', implicates: 'colleague', reason: 'Colleague accessed the lab after hours and handled the victim\'s coffee equipment' },
                { item: 'printed_email_thread', location: 'office', implicates: 'colleague', reason: 'Heated argument about authorship rights, printed by the victim as evidence' },
                { item: 'resignation_draft', location: 'office', implicates: 'graduate_student', reason: 'Student was about to quit; had motive to act before losing access' },
            ],
            redHerrings: [
                { item: 'janitors_master_key', location: 'hallway', implicates: 'janitor', reason: 'Key was left behind during cleaning, not related to the crime' },
                { item: 'department_memo', location: 'lecture_hall', implicates: 'department_head', reason: 'References the victim negatively but predates the murder by weeks' },
            ],
        },

        // ── 3. THE MANOR HOUSE ──────────────────────────────────────────────
        {
            id: 'manor_house',
            victimRole: 'heir',
            killerRole: 'butler',
            suspectRoles: ['butler', 'sibling', 'family_lawyer', 'spouse'],
            suspectArchetypes: {
                butler: { role: 'butler', psychProfile: 'loyal facade concealing deep bitterness', defaultBehavior: 'answers every question with a question', likelySecretCategory: 'hidden_identity', nervousTell: 'straightens tie when lying' },
                sibling: { role: 'sibling', psychProfile: 'entitled, reckless, desperate', defaultBehavior: 'plays the grief card aggressively', likelySecretCategory: 'gambling_debt', nervousTell: 'laughs at inappropriate moments' },
                family_lawyer: { role: 'family_lawyer', psychProfile: 'evasive, professionally cold', defaultBehavior: 'cites confidentiality for everything', likelySecretCategory: 'will_tampering', nervousTell: 'avoids direct eye contact' },
                spouse: { role: 'spouse', psychProfile: 'performatively grief-stricken, secretly calculating', defaultBehavior: 'brings conversation back to the victim\'s flaws', likelySecretCategory: 'secret_affair', nervousTell: 'touches jewelry when nervous' },
            },
            locations: ['grand_dining_room', 'manor_library', 'heirs_study', 'rose_garden', 'butlers_pantry'],
            mapConnections: {
                grand_dining_room: ['butlers_pantry', 'manor_library'],
                manor_library: ['grand_dining_room', 'heirs_study'],
                heirs_study: ['manor_library', 'rose_garden'],
                rose_garden: ['heirs_study', 'butlers_pantry'],
                butlers_pantry: ['grand_dining_room', 'rose_garden'],
            },
            weaponType: 'sharp_object',
            motiveCategory: 'revenge',
            relationships: [
                { a: 'butler', b: 'heir', dynamic: 'secret_parentage — butler believes he is the victim\'s true father, denied inheritance', tensionLevel: 'high' },
                { a: 'sibling', b: 'heir', dynamic: 'will_dispute — victim was about to change will, cutting sibling out entirely', tensionLevel: 'high' },
                { a: 'family_lawyer', b: 'heir', dynamic: 'blackmail — victim discovered lawyer had been embezzling from the estate', tensionLevel: 'high' },
                { a: 'spouse', b: 'heir', dynamic: 'loveless_marriage — spouse was planning divorce but feared prenuptial terms', tensionLevel: 'medium' },
                { a: 'butler', b: 'family_lawyer', dynamic: 'known_secret — lawyer knew about butler\'s identity claim and held it over him', tensionLevel: 'high' },
            ],
            evidenceChains: [
                { item: 'blood_stained_glove', location: 'kitchen', implicates: 'butler', reason: 'Butler prepared dinner and had access; glove was hidden behind pantry shelves' },
                { item: 'torn_will_document', location: 'study', implicates: 'family_lawyer', reason: 'Victim had drafted the revised will; pages were torn out and partially burned' },
                { item: 'coded_letter', location: 'library', implicates: 'butler', reason: 'Letter to a private investigator confirming butler\'s parentage claim' },
            ],
            redHerrings: [
                { item: 'siblings_pawn_receipt', location: 'dining_room', implicates: 'sibling', reason: 'Proves financial desperation but the transaction happened two weeks prior' },
                { item: 'foreign_currency', location: 'garden', implicates: 'spouse', reason: 'Spouse\'s affair partner is foreign; this is from a birthday gift, not flight money' },
            ],
        },

        // ── 4. THE CORPORATE TOWER ──────────────────────────────────────────
        {
            id: 'corporate_tower',
            victimRole: 'ceo',
            killerRole: 'assistant',
            suspectRoles: ['assistant', 'business_partner', 'whistleblower', 'investor'],
            suspectArchetypes: {
                assistant: { role: 'assistant', psychProfile: 'methodical, invisible by design, deeply wronged', defaultBehavior: 'provides alibi details almost too neatly', likelySecretCategory: 'identity_theft', nervousTell: 'over-organizes objects when anxious' },
                business_partner: { role: 'business_partner', psychProfile: 'charming, aggressive, addicted to control', defaultBehavior: 'frames everything as business decision', likelySecretCategory: 'offshore_accounts', nervousTell: 'answers questions with sales pitch energy' },
                whistleblower: { role: 'whistleblower', psychProfile: 'righteous, paranoid, running out of time', defaultBehavior: 'implies they know more than they say', likelySecretCategory: 'protected_witness', nervousTell: 'scans room before answering' },
                investor: { role: 'investor', psychProfile: 'mercenary, transactional, no personal loyalty', defaultBehavior: 'reduces everything to numbers and loss', likelySecretCategory: 'insider_trading', nervousTell: 'very still — practiced composure' },
            },
            locations: ['ceos_private_office', 'board_room', 'executive_elevator', 'parking_garage', 'main_lobby'],
            mapConnections: {
                ceos_private_office: ['board_room', 'executive_elevator'],
                board_room: ['ceos_private_office', 'main_lobby'],
                executive_elevator: ['ceos_private_office', 'main_lobby', 'parking_garage'],
                main_lobby: ['board_room', 'executive_elevator'],
                parking_garage: ['executive_elevator'],
            },
            weaponType: 'firearm',
            motiveCategory: 'blackmail',
            relationships: [
                { a: 'assistant', b: 'ceo', dynamic: 'stolen_work — CEO published the assistant\'s strategic report as their own, got the promotion that should have been theirs', tensionLevel: 'high' },
                { a: 'business_partner', b: 'ceo', dynamic: 'hostile_split — CEO was engineering a boardroom coup to push partner out', tensionLevel: 'high' },
                { a: 'whistleblower', b: 'ceo', dynamic: 'exposure_threat — CEO was about to be exposed for SEC violations', tensionLevel: 'high' },
                { a: 'investor', b: 'ceo', dynamic: 'bad_deal — investor lost millions on CEO\'s advice and suspects fraud', tensionLevel: 'medium' },
                { a: 'assistant', b: 'whistleblower', dynamic: 'secret_contact — assistant had been leaking documents to the whistleblower', tensionLevel: 'high' },
            ],
            evidenceChains: [
                { item: 'burner_phone', location: 'parking_garage', implicates: 'assistant', reason: 'Used to coordinate the night\'s plan; found behind a support column' },
                { item: 'shredded_report_pieces', location: 'executive_office', implicates: 'assistant', reason: 'Original report with assistant\'s name — CEO had been shredding copies' },
                { item: 'wire_transfer_receipt', location: 'conference_room', implicates: 'business_partner', reason: 'Payment to a fixer the night before — circumstantially damning' },
            ],
            redHerrings: [
                { item: 'anonymous_tip_printout', location: 'lobby', implicates: 'whistleblower', reason: 'Tipped off press that night, but from across town — alibi is solid' },
                { item: 'margin_call_notice', location: 'elevator', implicates: 'investor', reason: 'Financial ruin motive is real but investor was at a dinner with witnesses' },
            ],
        },

        // ── 5. THE ART GALLERY ──────────────────────────────────────────────
        {
            id: 'art_gallery',
            victimRole: 'gallery_owner',
            killerRole: 'restorer',
            suspectRoles: ['restorer', 'emerging_artist', 'collector', 'critic'],
            suspectArchetypes: {
                restorer: { role: 'restorer', psychProfile: 'perfectionist, invisible labor, silent rage', defaultBehavior: 'fixates on details of the crime scene\'s physical state', likelySecretCategory: 'forgery_ring', nervousTell: 'rubs hands together as if cleaning them' },
                emerging_artist: { role: 'emerging_artist', psychProfile: 'volatile, romantic about suffering, self-destructive', defaultBehavior: 'makes everything about their art', likelySecretCategory: 'stolen_concept', nervousTell: 'cries too easily, recovers too fast' },
                collector: { role: 'collector', psychProfile: 'predatory, treats people like acquisitions', defaultBehavior: 'offers to buy things during the investigation', likelySecretCategory: 'money_laundering', nervousTell: 'very interested in what others noticed' },
                critic: { role: 'critic', psychProfile: 'scorned, vicious, convinced of own righteousness', defaultBehavior: 'narrates everything as if writing a review', likelySecretCategory: 'bribery', nervousTell: 'quotes themselves' },
            },
            locations: ['grand_gallery', 'restoration_studio', 'vault_archives', 'narrow_street', 'curators_office'],
            mapConnections: {
                grand_gallery: ['restoration_studio', 'narrow_street', 'curators_office'],
                restoration_studio: ['grand_gallery', 'vault_archives'],
                vault_archives: ['restoration_studio', 'curators_office'],
                narrow_street: ['grand_gallery'],
                curators_office: ['grand_gallery', 'vault_archives'],
            },
            weaponType: 'blunt_object',
            motiveCategory: 'envy',
            relationships: [
                { a: 'restorer', b: 'gallery_owner', dynamic: 'forgery_partnership — owner was cutting restorer out of the forgery profits and threatening to expose them alone', tensionLevel: 'high' },
                { a: 'emerging_artist', b: 'gallery_owner', dynamic: 'stolen_exhibition — owner gave the artist\'s slot to a wealthy friend', tensionLevel: 'high' },
                { a: 'collector', b: 'gallery_owner', dynamic: 'laundering_deal — owner threatened to go to authorities over suspicious purchases', tensionLevel: 'high' },
                { a: 'critic', b: 'gallery_owner', dynamic: 'suppressed_review — owner killed a scathing review via advertiser pressure', tensionLevel: 'medium' },
                { a: 'restorer', b: 'collector', dynamic: 'mutual_client — restorer was authenticating fakes for the collector', tensionLevel: 'high' },
            ],
            evidenceChains: [
                { item: 'chemical_solvent_cloth', location: 'restoration_studio', implicates: 'restorer', reason: 'Same solvent found on victim\'s clothes — used to incapacitate before the blow' },
                { item: 'private_sale_contract', location: 'private_office', implicates: 'restorer', reason: 'Contract showing restorer\'s cut was unilaterally reduced by owner' },
                { item: 'authentication_letter', location: 'storage_vault', implicates: 'collector', reason: 'Fraudulent letter restorer wrote for collector — both were exposed if found' },
            ],
            redHerrings: [
                { item: 'rejection_letter', location: 'main_gallery', implicates: 'emerging_artist', reason: 'Painful but the artist has a public breakdown as alibi — everyone saw them' },
                { item: 'bribe_envelope', location: 'street', implicates: 'critic', reason: 'Critic was paid to kill a review, but by a third party — not the victim' },
            ],
        },

        // ── 6. THE LUXURY HOTEL ─────────────────────────────────────────────
        {
            id: 'luxury_hotel',
            victimRole: 'hotel_manager',
            killerRole: 'concierge',
            suspectRoles: ['concierge', 'guest', 'housekeeper', 'chef'],
            suspectArchetypes: {
                concierge: { role: 'concierge', psychProfile: 'charming sociopath, decade of suppressed humiliation', defaultBehavior: 'solicitous to the point of unease', likelySecretCategory: 'embezzlement', nervousTell: 'formal address slips into informal briefly' },
                guest: { role: 'guest', psychProfile: 'powerful, used to problems disappearing', defaultBehavior: 'seems unconcerned, hints at influence', likelySecretCategory: 'criminal_connections', nervousTell: 'name-drops constantly' },
                housekeeper: { role: 'housekeeper', psychProfile: 'protective, quietly furious at injustice', defaultBehavior: 'speaks in short sentences, watches hands', likelySecretCategory: 'undocumented_status', nervousTell: 'flinches at raised voices' },
                chef: { role: 'chef', psychProfile: 'obsessive about craft, volatile ego', defaultBehavior: 'redirects to food and timing constantly', likelySecretCategory: 'health_code_violation', nervousTell: 'describes events using cooking metaphors' },
            },
            locations: ['hotel_grand_lobby', 'managers_penthouse', 'gourmet_kitchen', 'service_corridor', 'rooftop_lounge'],
            mapConnections: {
                hotel_grand_lobby: ['managers_penthouse', 'gourmet_kitchen', 'service_corridor'],
                managers_penthouse: ['hotel_grand_lobby', 'rooftop_lounge'],
                gourmet_kitchen: ['hotel_grand_lobby', 'service_corridor'],
                service_corridor: ['hotel_grand_lobby', 'gourmet_kitchen', 'rooftop_lounge'],
                rooftop_lounge: ['managers_penthouse', 'service_corridor'],
            },
            weaponType: 'poison',
            motiveCategory: 'revenge',
            relationships: [
                { a: 'concierge', b: 'hotel_manager', dynamic: 'stolen_promotion — concierge trained the manager who leapfrogged them; years of resentment', tensionLevel: 'high' },
                { a: 'guest', b: 'hotel_manager', dynamic: 'blackmail — guest was being extorted by manager over an incident years ago', tensionLevel: 'high' },
                { a: 'housekeeper', b: 'hotel_manager', dynamic: 'wrongful_termination — manager fired housekeeper\'s sister falsely; now she\'s back', tensionLevel: 'medium' },
                { a: 'chef', b: 'hotel_manager', dynamic: 'sabotage — manager had been sending anonymous complaints to the health board', tensionLevel: 'high' },
                { a: 'concierge', b: 'guest', dynamic: 'service_relationship — concierge had been running errands of questionable legality for guest', tensionLevel: 'medium' },
            ],
            evidenceChains: [
                { item: 'tainted_wine_glass', location: 'penthouse_suite', implicates: 'concierge', reason: 'Concierge personally delivered and poured the wine that evening' },
                { item: 'pharmacy_receipt', location: 'service_corridor', implicates: 'concierge', reason: 'Purchase of compound matching the toxicology report, two days prior' },
                { item: 'blackmail_envelope', location: 'lobby', implicates: 'guest', reason: 'Manager had prepared fresh blackmail demand; found in a lobby planter' },
            ],
            redHerrings: [
                { item: 'chefs_scratch_notes', location: 'kitchen', implicates: 'chef', reason: 'Menu experiments that look like poison dosages — they\'re spice ratios' },
                { item: 'service_complaint_form', location: 'rooftop', implicates: 'housekeeper', reason: 'Housekeeper filed complaint; manager threw it off the roof in anger. Found but legally harmless' },
            ],
        },

        // ── 7. THE THEATRE ──────────────────────────────────────────────────
        {
            id: 'theatre',
            victimRole: 'director',
            killerRole: 'leading_actor',
            suspectRoles: ['leading_actor', 'understudy', 'playwright', 'stage_manager'],
            suspectArchetypes: {
                leading_actor: { role: 'leading_actor', psychProfile: 'narcissistic, believes the world is their stage — including interrogations', defaultBehavior: 'performs grief rather than feeling it', likelySecretCategory: 'career_sabotage', nervousTell: 'pauses for dramatic effect at wrong moments' },
                understudy: { role: 'understudy', psychProfile: 'invisibility complex, burning ambition', defaultBehavior: 'keeps saying "I would never..."', likelySecretCategory: 'stalking', nervousTell: 'knows too many details about others\' schedules' },
                playwright: { role: 'playwright', psychProfile: 'wounded idealist, everything is a betrayal narrative', defaultBehavior: 'speaks only in metaphors', likelySecretCategory: 'plagiarism', nervousTell: 'writes things down mid-conversation' },
                stage_manager: { role: 'stage_manager', psychProfile: 'hyper-competent, used to being ignored, quietly terrifying', defaultBehavior: 'corrects everyone\'s timeline details', likelySecretCategory: 'witness_to_prior_crime', nervousTell: 'goes very quiet when certain names come up' },
            },
            locations: ['main_stage', 'actors_dressing_room', 'prop_storage_vault', 'fly_gallery', 'stage_side_door'],
            mapConnections: {
                main_stage: ['actors_dressing_room', 'prop_storage_vault', 'fly_gallery'],
                actors_dressing_room: ['main_stage', 'stage_side_door'],
                prop_storage_vault: ['main_stage', 'fly_gallery'],
                fly_gallery: ['main_stage', 'prop_storage_vault'],
                stage_side_door: ['actors_dressing_room'],
            },
            weaponType: 'sharp_object',
            motiveCategory: 'jealousy',
            relationships: [
                { a: 'leading_actor', b: 'director', dynamic: 'casting_threat — director was replacing actor with a younger star mid-run', tensionLevel: 'high' },
                { a: 'playwright', b: 'director', dynamic: 'creative_betrayal — director rewrote the script without credit, ruining playwright\'s reputation', tensionLevel: 'high' },
                { a: 'understudy', b: 'leading_actor', dynamic: 'obsessive_shadow — understudy had been sabotaging actor\'s performances subtly', tensionLevel: 'high' },
                { a: 'stage_manager', b: 'director', dynamic: 'witnessed_crime — director had covered up an on-set accident; stage manager knew', tensionLevel: 'high' },
                { a: 'leading_actor', b: 'playwright', dynamic: 'unlikely_alliance — both hated the director; had spoken about it openly', tensionLevel: 'medium' },
            ],
            evidenceChains: [
                { item: 'prop_knife_sharpened', location: 'prop_storage', implicates: 'leading_actor', reason: 'Prop knife was swapped for a real one, sharpened recently — actor handled props obsessively' },
                { item: 'call_sheet_with_notes', location: 'dressing_room', implicates: 'leading_actor', reason: 'Actor\'s own call sheet with the director\'s schedule circled and annotated' },
                { item: 'threatening_script_note', location: 'fly_gallery', implicates: 'playwright', reason: 'Handwritten note in playwright\'s style, but left at the scene of actor\'s exit route' },
            ],
            redHerrings: [
                { item: 'understudys_diary', location: 'stage_door', implicates: 'understudy', reason: 'Deeply disturbing reading but describes obsession with the actor, not the director' },
                { item: 'accident_report_copy', location: 'main_stage', implicates: 'stage_manager', reason: 'Stage manager kept a copy of the covered-up report — as self-protection, not evidence of guilt' },
            ],
        },

        // ── 8. THE PRIVATE CLINIC ────────────────────────────────────────────
        {
            id: 'private_clinic',
            victimRole: 'surgeon',
            killerRole: 'anesthesiologist',
            suspectRoles: ['anesthesiologist', 'head_nurse', 'patient_relative', 'administrator'],
            suspectArchetypes: {
                anesthesiologist: { role: 'anesthesiologist', psychProfile: 'precise, controlled, believes they are always the smartest person present', defaultBehavior: 'corrects medical details pedantically to establish authority', likelySecretCategory: 'malpractice_cover_up', nervousTell: 'measures pauses before answering' },
                head_nurse: { role: 'head_nurse', psychProfile: 'fiercely protective of patients, morally uncompromising', defaultBehavior: 'pivots to patient welfare constantly', likelySecretCategory: 'unreported_incident', nervousTell: 'hands never stop moving' },
                patient_relative: { role: 'patient_relative', psychProfile: 'grief-powered, reckless, nothing left to lose', defaultBehavior: 'oscillates between rage and collapse', likelySecretCategory: 'prior_confrontation', nervousTell: 'mentions the surgeon\'s name like a curse' },
                administrator: { role: 'administrator', psychProfile: 'liability-focused, institutional loyalty above all', defaultBehavior: 'speaks only in hypotheticals and policy', likelySecretCategory: 'records_falsification', nervousTell: 'fidgets with lanyard badge' },
            },
            locations: ['sterile_operating_theatre', 'patient_recovery_room', 'doctors_lounge', 'secure_pharmacy', 'doctors_car_park'],
            mapConnections: {
                sterile_operating_theatre: ['patient_recovery_room', 'doctors_lounge'],
                patient_recovery_room: ['sterile_operating_theatre', 'secure_pharmacy'],
                doctors_lounge: ['sterile_operating_theatre', 'doctors_car_park'],
                secure_pharmacy: ['patient_recovery_room', 'doctors_car_park'],
                doctors_car_park: ['doctors_lounge', 'secure_pharmacy'],
            },
            weaponType: 'poison',
            motiveCategory: 'revenge',
            relationships: [
                { a: 'anesthesiologist', b: 'surgeon', dynamic: 'botched_cover_up — anesthesiologist made an error during a joint surgery; surgeon was about to report it', tensionLevel: 'high' },
                { a: 'patient_relative', b: 'surgeon', dynamic: 'wrongful_death — surgeon operated on relative\'s spouse while impaired; they died', tensionLevel: 'high' },
                { a: 'head_nurse', b: 'surgeon', dynamic: 'unreported_complaint — nurse filed a formal complaint months ago that was buried by administrator', tensionLevel: 'high' },
                { a: 'administrator', b: 'surgeon', dynamic: 'mutual_protection — administrator had been shielding surgeon from litigation for kickbacks', tensionLevel: 'medium' },
                { a: 'anesthesiologist', b: 'administrator', dynamic: 'shared_culpability — both signed off on falsified records from the botched surgery', tensionLevel: 'high' },
            ],
            evidenceChains: [
                { item: 'drug_dispensary_log', location: 'pharmacy', implicates: 'anesthesiologist', reason: 'Unusual withdrawal of paralytic agent not linked to any scheduled procedure' },
                { item: 'erased_whiteboard', location: 'operating_theatre', implicates: 'anesthesiologist', reason: 'Scheduling was erased to remove evidence of who was on duty during the victim\'s final hour' },
                { item: 'falsified_chart', location: 'recovery_room', implicates: 'administrator', reason: 'Patient record altered retroactively — administrator\'s login metadata intact' },
            ],
            redHerrings: [
                { item: 'grievance_letter', location: 'staff_lounge', implicates: 'head_nurse', reason: 'Formal and damning but filed through proper channels — not the act of someone planning murder' },
                { item: 'visitor_badge', location: 'car_park', implicates: 'patient_relative', reason: 'Relative was at the clinic but left two hours before time of death — confirmed by footage' },
            ],
        },

        // ── 9. THE POLITICAL CAMPAIGN ────────────────────────────────────────
        {
            id: 'political_campaign',
            victimRole: 'candidate',
            killerRole: 'campaign_manager',
            suspectRoles: ['campaign_manager', 'opposition_spy', 'donor', 'journalist'],
            suspectArchetypes: {
                campaign_manager: { role: 'campaign_manager', psychProfile: 'true believer turned cynic, ten years of sacrifice curdled into entitlement', defaultBehavior: 'spins every question into a campaign narrative', likelySecretCategory: 'financial_misconduct', nervousTell: 'uses "we" instead of "I" to diffuse responsibility' },
                opposition_spy: { role: 'opposition_spy', psychProfile: 'professional liar, finds honesty genuinely difficult', defaultBehavior: 'gives perfect answers — suspiciously perfect', likelySecretCategory: 'double_agent', nervousTell: 'slight delay before pronouns — constructing identity' },
                donor: { role: 'donor', psychProfile: 'transactional, views people as investments', defaultBehavior: 'talks about what they\'re owed', likelySecretCategory: 'illegal_contributions', nervousTell: 'mentions specific dollar amounts unprompted' },
                journalist: { role: 'journalist', psychProfile: 'principled but ruthless, story above all', defaultBehavior: 'asks questions during the investigation', likelySecretCategory: 'source_protection', nervousTell: 'takes notes even when told not to' },
            },
            locations: ['campaign_hq_floor', 'press_briefing_room', 'candidates_private_office', 'parking_garage_structure', 'presidential_hotel_suite'],
            mapConnections: {
                campaign_hq_floor: ['press_briefing_room', 'candidates_private_office'],
                press_briefing_room: ['campaign_hq_floor', 'presidential_hotel_suite'],
                candidates_private_office: ['campaign_hq_floor', 'parking_garage_structure'],
                parking_garage_structure: ['candidates_private_office', 'presidential_hotel_suite'],
                presidential_hotel_suite: ['press_briefing_room', 'parking_garage_structure'],
            },
            weaponType: 'other',
            motiveCategory: 'blackmail',
            relationships: [
                { a: 'campaign_manager', b: 'candidate', dynamic: 'betrayal — candidate was planning to fire manager after the election; manager intercepted the memo', tensionLevel: 'high' },
                { a: 'donor', b: 'candidate', dynamic: 'corrupt_deal — candidate had accepted illegal funds and was about to cooperate with prosecutors', tensionLevel: 'high' },
                { a: 'opposition_spy', b: 'candidate', dynamic: 'active_operation — spy had been embedded in the campaign for six months', tensionLevel: 'high' },
                { a: 'journalist', b: 'candidate', dynamic: 'imminent_expose — journalist had the story ready to publish; candidate was one source away from being destroyed', tensionLevel: 'high' },
                { a: 'campaign_manager', b: 'donor', dynamic: 'co_conspirators — manager helped launder the donor\'s contribution through PAC structures', tensionLevel: 'high' },
            ],
            evidenceChains: [
                { item: 'shredded_memo_tape', location: 'private_office', implicates: 'campaign_manager', reason: 'Reconstruction reveals termination notice — manager\'s motive in plain text' },
                { item: 'burner_phone_records', location: 'parking_structure', implicates: 'campaign_manager', reason: 'Calls to donor and an unregistered number the night of the murder' },
                { item: 'pac_transfer_document', location: 'campaign_hq', implicates: 'donor', reason: 'Shows the illegal contribution routing; both donor and manager implicated' },
            ],
            redHerrings: [
                { item: 'opposition_briefing', location: 'hotel_suite', implicates: 'opposition_spy', reason: 'Damning document but spy\'s mission was intelligence, not assassination — different chain of command' },
                { item: 'journalists_notes', location: 'press_room', implicates: 'journalist', reason: 'Notes show motive but journalist was filing copy remotely at time of death — digital timestamp' },
            ],
        },

        // ── 10. THE RESEARCH VESSEL ─────────────────────────────────────────
        {
            id: 'research_vessel',
            victimRole: 'expedition_leader',
            killerRole: 'marine_biologist',
            suspectRoles: ['marine_biologist', 'first_mate', 'documentary_crew', 'funder'],
            suspectArchetypes: {
                marine_biologist: { role: 'marine_biologist', psychProfile: 'obsessive, puritanical about science, will sacrifice anything for the discovery', defaultBehavior: 'treats the investigation as a contaminated experiment', likelySecretCategory: 'data_fabrication', nervousTell: 'clasps hands tightly when asked direct questions' },
                first_mate: { role: 'first_mate', psychProfile: 'pragmatic, loyal to the ship over people, old-fashioned code of silence', defaultBehavior: 'defers to hierarchy even when hierarchy is dead', likelySecretCategory: 'maritime_violation', nervousTell: 'uses nautical metaphors to avoid directness' },
                documentary_crew: { role: 'documentary_crew', psychProfile: 'exploitation disguised as admiration, always filming mentally', defaultBehavior: 'seems genuinely excited by the drama', likelySecretCategory: 'unauthorized_footage', nervousTell: 'frames things as "great for the story"' },
                funder: { role: 'funder', psychProfile: 'ruthless, discovery means money — no discovery means motive for someone to disappear', defaultBehavior: 'speaks exclusively about the expedition\'s commercial value', likelySecretCategory: 'patent_theft', nervousTell: 'asks about the research data immediately' },
            },
            locations: ['officers_bridge', 'marine_biology_lab', 'tight_crew_quarters', 'echoing_cargo_hold', 'upper_deck'],
            mapConnections: {
                officers_bridge: ['upper_deck', 'tight_crew_quarters'],
                marine_biology_lab: ['tight_crew_quarters', 'echoing_cargo_hold'],
                tight_crew_quarters: ['officers_bridge', 'marine_biology_lab'],
                echoing_cargo_hold: ['marine_biology_lab', 'upper_deck'],
                upper_deck: ['officers_bridge', 'echoing_cargo_hold'],
            },
            weaponType: 'other',
            motiveCategory: 'greed',
            relationships: [
                { a: 'marine_biologist', b: 'expedition_leader', dynamic: 'credit_theft — leader had submitted the biologist\'s discovery under their own name to a journal', tensionLevel: 'high' },
                { a: 'funder', b: 'expedition_leader', dynamic: 'failed_delivery — expedition was supposed to locate a commercially valuable site; leader had given up and was hiding it', tensionLevel: 'high' },
                { a: 'first_mate', b: 'expedition_leader', dynamic: 'reported_violation — leader had ordered illegal dumping; first mate had filed a confidential report', tensionLevel: 'medium' },
                { a: 'documentary_crew', b: 'expedition_leader', dynamic: 'footage_dispute — leader demanded final cut approval; crew had filmed something leader wanted buried', tensionLevel: 'high' },
                { a: 'marine_biologist', b: 'funder', dynamic: 'secret_deal — biologist had been negotiating directly with funder to cut out the leader', tensionLevel: 'high' },
            ],
            evidenceChains: [
                { item: 'journal_submission_draft', location: 'research_lab', implicates: 'marine_biologist', reason: 'Draft with biologist\'s name crossed out and leader\'s name written in — biologist\'s handwriting on corrections' },
                { item: 'encrypted_data_drive', location: 'cargo_hold', implicates: 'marine_biologist', reason: 'Drive contains the real discovery data biologist was secretly preserving to publish alone' },
                { item: 'deleted_footage_recovery', location: 'crew_quarters', implicates: 'documentary_crew', reason: 'Recovered clip shows biologist confronting leader violently the night before' },
            ],
            redHerrings: [
                { item: 'dumping_log', location: 'bridge', implicates: 'first_mate', reason: 'First mate kept the illegal dumping log as evidence against the leader — protective, not murderous' },
                { item: 'funder_contract_clause', location: 'deck', implicates: 'funder', reason: 'Clause allows funder to seize data on leader\'s death — suspicious but funder was onshore that night' },
            ],
        },
    ];

    private weapons = {
        blunt_object: ['antique_bookend', 'marble_paperweight', 'bronze_trophy', 'wrench', 'heavy_candlestick'],
        sharp_object: ['letter_opener', 'ceremonial_knife', 'glass_shard', 'surgical_scalpel', 'sharpened_letter_knife'],
        poison: ['arsenic_compound', 'cyanide_solution', 'paralytic_agent', 'contaminated_drink', 'toxic_injection'],
        firearm: ['silenced_pistol', 'revolver'],
        other: ['ligature_cord', 'pillow_smothering', 'staged_fall', 'electrocution'],
    };

    // ── Seeded RNG ─────────────────────────────────────────────────────────
    private seededRandom(seed: string, min: number, max: number): number {
        let hash = 0;
        for (let i = 0; i < seed.length; i++) {
            hash = ((hash << 5) - hash) + seed.charCodeAt(i);
            hash = hash & hash;
        }
        const normalized = Math.abs(Math.sin(hash)) * 10000;
        return Math.floor((normalized % (max - min + 1)) + min);
    }

    private shuffleArray<T>(array: T[], seed: string): T[] {
        const arr = [...array];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = this.seededRandom(seed + i, 0, i);
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    // ── Timeline Generation ────────────────────────────────────────────────
    private generateTimeline(
        template: CaseTemplate,
        killerId: string,
        victimId: string,
        murderLocation: string,
        murderWeapon: string,
        difficulty: string,
        seed: string
    ) {
        const timeline: TimelineEvent[] = [];
        const suspects = template.suspectRoles;
        const locations = template.locations;

        const startHour = this.seededRandom(seed + 'start', 20, 22);
        const murderMinute = this.seededRandom(seed + 'murder', 25, 55);

        const formatTime = (minutes: number) => {
            const totalMinutes = startHour * 60 + minutes;
            const h = Math.floor(totalMinutes / 60) % 24;
            const m = totalMinutes % 60;
            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        };

        let currentTime = 0;

        // Initial placement — suspects start where their relationships make sense
        suspects.forEach((sid, idx) => {
            const startLoc = locations[idx % locations.length];
            const archetype = template.suspectArchetypes[sid];
            timeline.push({
                time: currentTime,
                formattedTime: formatTime(currentTime),
                actorId: sid,
                action: 'move',
                location: startLoc,
                description: `${sid} (${archetype?.psychProfile ?? 'unknown disposition'}) is seen in the ${startLoc}.`,
            });
        });

        timeline.push({
            time: currentTime,
            formattedTime: formatTime(currentTime),
            actorId: victimId,
            action: 'move',
            location: locations[0],
            description: `${victimId} arrives at the ${locations[0]}.`,
        });

        // Pre-murder movements — suspects move with narrative purpose based on relationships
        const preMurderEvents = difficulty === 'hard' ? 10 : difficulty === 'medium' ? 6 : 3;

        for (let i = 0; i < preMurderEvents; i++) {
            currentTime += this.seededRandom(seed + 'interval' + i, 3, 8);
            const suspectIdx = this.seededRandom(seed + 'suspect' + i, 0, suspects.length - 1);
            const suspect = suspects[suspectIdx];
            const relationship = template.relationships.find(r => r.a === suspect || r.b === suspect);
            const location = locations[this.seededRandom(seed + 'loc' + i, 0, locations.length - 1)];

            const purposeNote = relationship
                ? ` (tension: ${relationship.dynamic})`
                : '';

            timeline.push({
                time: currentTime,
                formattedTime: formatTime(currentTime),
                actorId: suspect,
                action: 'move',
                location,
                description: `${suspect} moves to the ${location}${purposeNote}.`,
            });
        }

        // Killer moves toward victim
        currentTime = murderMinute - 6;
        const approachLocation = this.selectApproachLocation(template.mapConnections, murderLocation, seed);
        timeline.push({
            time: currentTime,
            formattedTime: formatTime(currentTime),
            actorId: killerId,
            action: 'move',
            location: approachLocation,
            description: `${killerId} is seen near the ${approachLocation}.`,
        });

        // Victim walks into murder location
        currentTime = murderMinute - 3;
        timeline.push({
            time: currentTime,
            formattedTime: formatTime(currentTime),
            actorId: victimId,
            action: 'move',
            location: murderLocation,
            description: `${victimId} enters the ${murderLocation}.`,
        });

        // THE MURDER
        currentTime = murderMinute;
        timeline.push({
            time: currentTime,
            formattedTime: formatTime(currentTime),
            actorId: killerId,
            action: 'kill',
            location: murderLocation,
            target: victimId,
            description: `${killerId} kills ${victimId} with ${murderWeapon} in the ${murderLocation}.`,
        });

        // Killer escapes via connected room
        const escapeLocation = this.selectEscapeRoute(template.mapConnections, murderLocation, seed);
        currentTime += this.seededRandom(seed + 'escape', 2, 5);
        timeline.push({
            time: currentTime,
            formattedTime: formatTime(currentTime),
            actorId: killerId,
            action: 'leave',
            location: escapeLocation,
            description: `${killerId} slips away to the ${escapeLocation}.`,
        });

        // Provide hard-mode suspects with contradicting movements near murder time
        if (difficulty === 'hard') {
            const decoys = suspects.filter(s => s !== killerId);
            decoys.forEach((decoy, idx) => {
                const nearTime = murderMinute + this.seededRandom(seed + 'decoy' + idx, 1, 8);
                const nearLoc = locations[this.seededRandom(seed + 'decoy_loc' + idx, 0, locations.length - 1)];
                timeline.push({
                    time: nearTime,
                    formattedTime: formatTime(nearTime),
                    actorId: decoy,
                    action: 'move',
                    location: nearLoc,
                    description: `${decoy} is spotted near the ${nearLoc} around the time of the murder.`,
                });
            });
        }

        timeline.sort((a, b) => a.time - b.time);

        return { timeline, murderTime: formatTime(murderMinute) };
    }

    private selectApproachLocation(map: Record<string, string[]>, murderLocation: string, seed: string): string {
        const connected = map[murderLocation] || [];
        if (connected.length === 0) return murderLocation;
        return connected[this.seededRandom(seed + 'approach', 0, connected.length - 1)];
    }

    private selectEscapeRoute(map: Record<string, string[]>, murderLocation: string, seed: string): string {
        const connected = map[murderLocation] || [];
        if (connected.length === 0) return murderLocation;
        return connected[this.seededRandom(seed + 'escape_route', 0, connected.length - 1)];
    }

    // ── Evidence Generation ────────────────────────────────────────────────
    private generateEvidence(
        template: CaseTemplate,
        murderLocation: string,
        murderWeapon: string,
        killerId: string,
        difficulty: string,
        seed: string
    ) {
        const evidenceLocations: Record<string, string> = {};
        const evidenceReasons: Record<string, string> = {};   // passed to Storyteller

        // Murder weapon always at scene
        evidenceLocations[murderWeapon] = murderLocation;
        evidenceReasons[murderWeapon] = `The murder weapon, used in the ${murderLocation}.`;

        // Logical evidence chains — always include at least the killer-implicating chain
        const killerChains = template.evidenceChains.filter(c => c.implicates === killerId);
        const otherChains = template.evidenceChains.filter(c => c.implicates !== killerId);

        killerChains.forEach(chain => {
            evidenceLocations[chain.item] = chain.location;
            evidenceReasons[chain.item] = chain.reason;
        });

        // On medium/hard, add one innocent-suspect chain to create confusion
        if (difficulty !== 'easy' && otherChains.length > 0) {
            const pick = otherChains[this.seededRandom(seed + 'other_chain', 0, otherChains.length - 1)];
            evidenceLocations[pick.item] = pick.location;
            evidenceReasons[pick.item] = pick.reason;
        }

        // Red herrings scaled to difficulty
        const herringCount = difficulty === 'easy' ? 1 : difficulty === 'medium' ? 2 : template.redHerrings.length;
        const shuffledHerrings = this.shuffleArray(template.redHerrings, seed + 'herrings');
        shuffledHerrings.slice(0, herringCount).forEach(h => {
            evidenceLocations[h.item] = h.location;
            evidenceReasons[h.item] = h.reason;
        });

        return { evidenceLocations, evidenceReasons };
    }

    // ── DNA Generation ─────────────────────────────────────────────────────
    private generateDNA(
        template: CaseTemplate,
        murderLocation: string,
        killerId: string,
        victimId: string,
        timeline: TimelineEvent[],
        difficulty: string,
        seed: string
    ) {
        const dnaLocations: Record<string, string[]> = {};

        timeline.forEach(event => {
            if (event.action === 'move' || event.action === 'kill') {
                if (!dnaLocations[event.location]) dnaLocations[event.location] = [];
                if (!dnaLocations[event.location].includes(event.actorId)) {
                    dnaLocations[event.location].push(event.actorId);
                }
            }
        });

        // Always guarantee killer + victim DNA at scene
        if (!dnaLocations[murderLocation]) dnaLocations[murderLocation] = [];
        if (!dnaLocations[murderLocation].includes(killerId)) dnaLocations[murderLocation].push(killerId);
        if (!dnaLocations[murderLocation].includes(victimId)) dnaLocations[murderLocation].push(victimId);

        // Hard mode: contamination from high-tension suspects near the murder location
        if (difficulty === 'hard') {
            const highTension = template.relationships
                .filter(r => r.tensionLevel === 'high')
                .flatMap(r => [r.a, r.b])
                .filter(id => id !== killerId && id !== victimId);

            template.locations.forEach(loc => {
                if (dnaLocations[loc] && this.seededRandom(seed + loc, 0, 100) > 65) {
                    const candidate = highTension[this.seededRandom(seed + loc + 'ht', 0, highTension.length - 1)];
                    if (candidate && !dnaLocations[loc].includes(candidate)) {
                        dnaLocations[loc].push(candidate);
                    }
                }
            });
        }

        return dnaLocations;
    }

    // ── Main Entry Point ───────────────────────────────────────────────────
    generate(config: GeneratorConfig): CaseSkeleton {
        const seed = config.seed || Date.now().toString();
        const difficulty = config.difficulty || 'medium';
        const theme = config.theme || 'modern';

        const templateIndex = this.seededRandom(seed, 0, this.templates.length - 1);
        const template = this.templates[templateIndex];

        // Weapon selection
        const weaponCategory = template.weaponType as keyof typeof this.weapons;
        const weaponOptions = this.weapons[weaponCategory];
        const murderWeapon = weaponOptions[this.seededRandom(seed + 'weapon', 0, weaponOptions.length - 1)];

        // On hard mode, shuffle who the killer is across suspect roles
        const killerRole = difficulty === 'hard'
            ? this.shuffleArray(template.suspectRoles, seed)[0]
            : template.killerRole;

        // Ensure killerRole is actually in suspectRoles
        const killerId = template.suspectRoles.includes(killerRole) ? killerRole : template.killerRole;
        const victimId = template.victimRole;

        // Murder location — avoid the most obvious (index 0) for non-easy
        const murderLocationIndex = difficulty === 'easy'
            ? 1
            : this.seededRandom(seed + 'murder_loc', 1, template.locations.length - 1);
        const murderLocation = template.locations[murderLocationIndex];

        const { timeline, murderTime } = this.generateTimeline(
            template, killerId, victimId, murderLocation, murderWeapon, difficulty, seed
        );

        const { evidenceLocations, evidenceReasons } = this.generateEvidence(
            template, murderLocation, murderWeapon, killerId, difficulty, seed
        );

        const dnaLocations = this.generateDNA(
            template, murderLocation, killerId, victimId, timeline, difficulty, seed
        );

        const skeleton: CaseSkeleton = {
            seed,
            theme,
            difficulty,
            victimId,
            killerId,
            suspectIds: template.suspectRoles,
            map: template.mapConnections,
            rooms: template.locations,
            murderTime,
            murderLocation,
            murderWeapon,
            timeline,
            evidenceLocations,
            dnaLocations,
            // Extended fields for Storyteller enrichment
            suspectArchetypes: template.suspectArchetypes,
            relationships: template.relationships,
            evidenceReasons,
            motiveCategory: template.motiveCategory,
            templateId: template.id,
            guildId: config.guildId,
        };

        return skeleton;
    }
}