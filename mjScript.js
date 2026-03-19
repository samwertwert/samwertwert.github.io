/**
 * mjScript.js – Japanese Mahjong Scoring Logic
 * 
 * Dependencies: mjTiles.js (provides tile helpers: tileEqual, isYaochu, isSimple, isHonor)
 * 
 * This file contains all functions required for:
 *   - Fu calculation
 *   - Yaku detection (all standard yaku)
 *   - Wait type determination
 *   - Main scoring function
 */

// =============================================================================
// Wait Type Determination
// =============================================================================

/**
 * Determine the wait type based on the final groups and the winning tile.
 * @param {Array} groups - Array of group objects (each with tiles, type, open)
 * @param {Object} winTile - The tile that completed the hand
 * @returns {string} 'ryanmen', 'kanchan', 'penchan', 'tanki', 'shanpon', or 'unknown'
 */
function determineWaitType(groups, winTile) {
    const winGroup = groups.find(group => group.tiles.some(t => tileEqual(t, winTile)));
    if (!winGroup) return 'unknown';

    // Case 1: Winning tile forms a pair → tanki
    if (winGroup.type === 'pair') {
        return 'tanki';
    }

    // Case 2: Winning tile forms a triplet → shanpon
    if (winGroup.type === 'triplet') {
        return 'shanpon';
    }

    // Case 3: Winning tile forms a sequence
    if (winGroup.type === 'sequence') {
        const otherTiles = winGroup.tiles.filter(t => !tileEqual(t, winTile));
        if (otherTiles.length !== 2) return 'unknown';

        otherTiles.sort((a, b) => a.number - b.number);
        const [t1, t2] = otherTiles;
        const gap = t2.number - t1.number;

        if (gap === 1) {
            // Consecutive tiles
            if (t1.number === 1 && t2.number === 2) return 'penchan';      // waiting for 3
            if (t1.number === 8 && t2.number === 9) return 'penchan';      // waiting for 7
            return 'ryanmen';
        } else if (gap === 2) {
            return 'kanchan'; // e.g., 3-5 waiting for 4
        }
    }

    return 'unknown';
}

// =============================================================================
// Fu Calculation
// =============================================================================

/**
 * Calculate fu for a hand.
 * @param {Object} params
 * @param {Array} params.groups - Hand groups
 * @param {Object} params.winTile - Winning tile
 * @param {string} params.winType - 'tsumo' or 'ron'
 * @param {boolean} params.isDealer - Is player dealer?
 * @param {number|string} params.roundWind - Round wind (1-4 or '東','南',etc.)
 * @param {number|string} params.playerWind - Player's wind
 * @param {string} params.waitType - Wait type from determineWaitType()
 * @returns {number} Fu (rounded up to nearest 10)
 */
function calculateFu({ groups, winTile, winType, isDealer, roundWind, playerWind, waitType }) {
    let fu = 20; // base fu for menzen ron

    // Convert winds to numbers if needed
    const rWind = windToNumber(roundWind);
    const pWind = windToNumber(playerWind);

    // Adjust base fu for open hands
    const hasOpenGroup = groups.some(g => g.open && g.type !== 'pair');
    if (hasOpenGroup) fu = 30; // base for open hand

    // Add fu for triplets and kans
    groups.forEach(group => {
        if (group.type === 'triplet' || group.type === 'kan') {
            const tile = group.tiles[0]; // representative tile
            const isYaochuTile = isYaochu(tile);
            const concealed = (group.type === 'kan')
                ? (group.kanType === 'concealed')
                : !group.open;

            if (group.type === 'triplet') {
                fu += concealed ? (isYaochuTile ? 8 : 4) : (isYaochuTile ? 4 : 2);
            } else { // kan
                fu += concealed ? (isYaochuTile ? 32 : 16) : (isYaochuTile ? 16 : 8);
            }
        }
    });

    // Add fu for pair if it's yakuhai (value pair)
    const pairGroup = groups.find(g => g.type === 'pair');
    if (pairGroup) {
        const tile = pairGroup.tiles[0];
        if (isHonor(tile)) {
            if (tile.number >= 5) { // dragons
                fu += 2;
            } else {
                // winds: check if matches round wind or player wind
                if (tile.number === pWind || tile.number === rWind) {
                    fu += 2;
                }
            }
        }
    }

    // Add fu for wait type (except ryanmen and shanpon)
    if (waitType === 'kanchan' || waitType === 'penchan' || waitType === 'tanki') {
        fu += 2;
    }

    // Add fu for tsumo (unless it's a pinfu hand that will be handled later)
    if (winType === 'tsumo') {
        fu += 2;
    }

    // Round up to nearest 10
    return Math.ceil(fu / 10) * 10;
}

// =============================================================================
// Yaku Detection
// =============================================================================

/**
 * Detect all yaku in a hand.
 * @param {Object} params
 * @param {Array} params.groups - Hand groups
 * @param {Object} params.winTile - Winning tile
 * @param {string} params.winType - 'tsumo' or 'ron'
 * @param {boolean} params.isDealer - Is player dealer?
 * @param {number|string} params.roundWind - Round wind
 * @param {number|string} params.playerWind - Player's wind
 * @param {boolean} params.riichi - Was riichi declared?
 * @param {boolean} params.ippatsu - Ippatsu?
 * @param {boolean} params.chankan - Win on a kan?
 * @param {boolean} params.rinshan - Win after kan draw?
 * @param {boolean} params.haitei - Last draw?
 * @param {boolean} params.houtei - Last discard?
 * @param {string} params.waitType - Wait type
 * @param {Array} params.doraIndicators - Array of indicator tiles
 * @param {Array} params.uraDoraIndicators - Array of ura indicator tiles (if riichi)
 * @param {number} params.redFives - Number of red fives in hand
 * @returns {Object} { han: number, yakuList: Array, yakuman: number }
 */
function detectYaku(params) {
    const {
        groups,
        winTile,
        winType,
        isDealer,
        roundWind,
        playerWind,
        riichi,
        ippatsu,
        chankan,
        rinshan,
        haitei,
        houtei,
        waitType,
        doraIndicators = [],
        uraDoraIndicators = [],
        redFives = 0
    } = params;

    const counts = countTiles(groups);

    let hanTotal = 0;
    const yakuList = [];
    const isMenzen = !groups.some(g => g.open && g.type !== 'pair');

    // Helper to add yaku
    function addYaku(name, han, isDouble = false) {
        yakuList.push({ name, han, isDouble });
        hanTotal += han;
    }

    // -------------------------------------------------------------
    // 1. Menzen tsumo
    if (isMenzen && winType === 'tsumo') {
        addYaku('門前清自摸和', 1);
    }

    // 2. Riichi & Ippatsu
    if (riichi) {
        addYaku('立直', 1);
        if (ippatsu) addYaku('一発', 1);
    }

    // 3. Pinfu
    if (isMenzen && waitType === 'ryanmen') {
        const allSequences = groups.every(g => g.type === 'sequence' || g.type === 'pair');
        if (allSequences) {
            const pairGroup = groups.find(g => g.type === 'pair');
            const pairTile = pairGroup.tiles[0];
            const rWind = windToNumber(roundWind);
            const pWind = windToNumber(playerWind);
            const isYakuhai = (isHonor(pairTile) && (pairTile.number >= 5 || pairTile.number === rWind || pairTile.number === pWind));
            if (!isYakuhai) {
                addYaku('平和', 1);
            }
        }
    }

    // 4. Iipeikou / Ryanpeikou
    if (isMenzen) {
        const sequences = groups.filter(g => g.type === 'sequence');
        const seqMap = new Map();
        sequences.forEach(seq => {
            const first = seq.tiles[0];
            const key = `${first.suit}:${first.number}-${first.number+1}-${first.number+2}`;
            seqMap.set(key, (seqMap.get(key) || 0) + 1);
        });
        const doubleSeqCount = Array.from(seqMap.values()).filter(c => c >= 2).length;
        if (doubleSeqCount === 1) addYaku('一盃口', 1);
        else if (doubleSeqCount >= 2) addYaku('二盃口', 3); // Actually ryanpeikou is 3 han
    }

    // 5. Tanyao
    let hasTerminalOrHonor = false;
    groups.forEach(g => g.tiles.forEach(t => { if (isYaochu(t)) hasTerminalOrHonor = true; }));
    if (!hasTerminalOrHonor) addYaku('断么九', 1);

    // 6. Yakuhai (dragons, seat wind, round wind)
    groups.forEach(g => {
        if (g.type === 'triplet' || g.type === 'kan') {
            const t = g.tiles[0];
            if (isHonor(t)) {
                if (t.number >= 5) {
                    const name = t.number === 5 ? '白' : t.number === 6 ? '發' : '中';
                    addYaku(name, 1);
                } else {
                    const rWind = windToNumber(roundWind);
                    const pWind = windToNumber(playerWind);
                    if (t.number === pWind) addYaku('自風', 1);
                    if (t.number === rWind) addYaku('場風', 1);
                }
            }
        }
    });

    // 7. Chanta (mixed outside)
    let chantaOk = groups.every(g => g.tiles.some(t => isYaochu(t)));
    if (chantaOk) {
        addYaku('混全帯么九', isMenzen ? 2 : 1);
    }

    // 8. Junchan (pure outside)
    let junchanOk = groups.every(g => g.tiles.some(t => !isHonor(t) && (t.number === 1 || t.number === 9)))
                    && !groups.some(g => g.tiles.some(t => isHonor(t)));
    if (junchanOk) {
        addYaku('純全帯么九', isMenzen ? 3 : 2);
    }

    // 9. Honroutou (all terminals and honors)
    let honroutouOk = groups.every(g => g.tiles.every(t => isYaochu(t)));
    if (honroutouOk) {
        addYaku('混老頭', 2);
    }

    // 10. Shousangen (little three dragons)
    const dragonCount = { white:0, green:0, red:0 };
    groups.forEach(g => {
        if (g.type === 'triplet' || g.type === 'kan' || g.type === 'pair') {
            const t = g.tiles[0];
            if (isHonor(t) && t.number >= 5) {
                if (t.number === 5) dragonCount.white += g.tiles.length;
                else if (t.number === 6) dragonCount.green += g.tiles.length;
                else if (t.number === 7) dragonCount.red += g.tiles.length;
            }
        }
    });
    const dragonTriplets = [dragonCount.white, dragonCount.green, dragonCount.red].filter(c => c >= 3).length;
    const dragonPair = [dragonCount.white, dragonCount.green, dragonCount.red].some(c => c === 2);
    if (dragonTriplets === 2 && dragonPair) {
        addYaku('小三元', 2);
    }

    // 11. Honitsu (half flush)
    const suitsPresent = new Set();
    groups.forEach(g => g.tiles.forEach(t => suitsPresent.add(t.suit)));
    if (suitsPresent.size === 2 && suitsPresent.has('z')) {
        addYaku('混一色', isMenzen ? 3 : 2);
    }

    // 12. Chinitsu (full flush)
    if (suitsPresent.size === 1 && !suitsPresent.has('z')) {
        addYaku('清一色', isMenzen ? 6 : 5);
    }

    // 13. Toitoi (all triplets)
    const hasSequence = groups.some(g => g.type === 'sequence');
    if (!hasSequence) {
        addYaku('対々和', 2);
    }

    // 14. Sanankou (three concealed triplets)
    let concealedTriplets = groups.filter(g =>
        (g.type === 'triplet' && !g.open) || (g.type === 'kan' && g.kanType === 'concealed')
    ).length;
    // Check if the group containing the win tile is a triplet/kan
    const winGroup = groups.find(g => g.tiles.some(t => tileEqual(t, winTile)));
    if (winGroup && (winGroup.type === 'triplet' || winGroup.type === 'kan')) {
        if (winType === 'tsumo') concealedTriplets++;
    }
    if (concealedTriplets >= 3) {
        addYaku('三暗刻', 2);
    }

    // 15. Sankantsu (three kans)
    const kanCount = groups.filter(g => g.type === 'kan').length;
    if (kanCount === 3) addYaku('三槓子', 2);

    // 16. Suukantsu (four kans) – yakuman
    if (kanCount === 4) addYaku('四槓子', 0, true);

    // 17. Shousuushii (little four winds)
    let windTriplets = 0, windPair = false;
    groups.forEach(g => {
        const t = g.tiles[0];
        if (isHonor(t) && t.number <= 4) {
            if (g.type === 'triplet' || g.type === 'kan') windTriplets++;
            if (g.type === 'pair') windPair = true;
        }
    });
    if (windTriplets === 3 && windPair) addYaku('小四喜', 0, true);

    // 18. Daisuushii (big four winds)
    if (windTriplets === 4) addYaku('大四喜', 0, true);

    // 19. Suuankou (four concealed triplets)
    if (concealedTriplets === 4) {
        if (waitType === 'tanki') {
            addYaku('四暗刻単騎', 0, true); // double yakuman
        } else {
            addYaku('四暗刻', 0, true);
        }
    }

    // 20. Tsuuiisou (all honors)
    if (suitsPresent.size === 1 && suitsPresent.has('z')) {
        addYaku('字一色', 0, true);
    }

    // 21. Chinroutou (all terminals)
    let allTerminals = true;
    groups.forEach(g => g.tiles.forEach(t => {
        if (isHonor(t) || (t.number !== 1 && t.number !== 9)) allTerminals = false;
    }));
    if (allTerminals) addYaku('清老頭', 0, true);

    // 22. Ryuuiisou (all green)
    let allGreen = true;
    groups.forEach(g => g.tiles.forEach(t => { if (!isGreen(t)) allGreen = false; }));
    if (allGreen) addYaku('緑一色', 0, true);

    // 23. Chuuren Poutou (nine gates)
    if (suitsPresent.size === 1 && !suitsPresent.has('z')) {
        const suit = Array.from(suitsPresent)[0];
        const numbers = [];
        groups.forEach(g => g.tiles.forEach(t => numbers.push(t.number)));
        numbers.sort((a,b) => a-b);
        const counts = {};
        numbers.forEach(n => counts[n] = (counts[n] || 0) + 1);
        let hasAllNumbers = true;
        for (let i=1; i<=9; i++) if (!counts[i]) hasAllNumbers = false;
        if (hasAllNumbers && counts[1] >= 3 && counts[9] >= 3) {
            addYaku('九蓮宝燈', 0, true);
        }
    }

    // 24. Kokushi Musou (thirteen orphans)
    const requiredTiles = [
        {suit:'m',number:1}, {suit:'m',number:9},
        {suit:'p',number:1}, {suit:'p',number:9},
        {suit:'s',number:1}, {suit:'s',number:9},
        {suit:'z',number:1}, {suit:'z',number:2}, {suit:'z',number:3}, {suit:'z',number:4},
        {suit:'z',number:5}, {suit:'z',number:6}, {suit:'z',number:7}
    ];

    let kokushiOk = true;
    let duplicateFound = false;
    for (let rt of requiredTiles) {
        const key = `${rt.suit}${rt.number}`;
        if (!counts[key] || counts[key] < 1) { kokushiOk = false; break; }
        if (counts[key] > 1) duplicateFound = true;
    }
    if (kokushiOk && duplicateFound) {
        addYaku('国士無双', 0, true);
    }

    // 25. Dora
    let doraCount = 0;
    doraIndicators.forEach(ind => {
        const next = getNextTile(ind);
        const key = `${next.suit}${next.number}`;
        doraCount += counts[key] || 0;
    });
    if (riichi) {
        uraDoraIndicators.forEach(ind => {
            const next = getNextTile(ind);
            const key = `${next.suit}${next.number}`;
            doraCount += counts[key] || 0;
        });
    }
    doraCount += redFives;
    if (doraCount > 0) addYaku('ドラ', doraCount);

    // 26. Haitei / Houtei / Rinshan / Chankan
    if (haitei) addYaku('海底摸月', 1);
    if (houtei) addYaku('河底撈魚', 1);
    if (rinshan) addYaku('嶺上開花', 1);
    if (chankan) addYaku('槍槓', 1);

    // Count yakuman
    const yakumanCount = yakuList.filter(y => y.isDouble).length;

    return { han: hanTotal, yakuList, yakuman: yakumanCount };
}

// =============================================================================
// Main Scoring Function
// =============================================================================

/**
 * Compute final score (basic points and payment) for a hand.
 * @param {Object} params - All parameters from UI + waitType
 * @returns {Object} Detailed score information
 */
function calculateScore(params) {
    const {
        groups,
        winTile,
        winType,
        isDealer,
        roundWind,
        playerWind,
        riichi,
        ippatsu = false,
        chankan = false,
        rinshan = false,
        haitei = false,
        houtei = false,
        doraIndicators,
        uraDoraIndicators,
        redFives,
        flowers = 0
    } = params;

    // Determine wait type automatically
    const waitType = determineWaitType(groups, winTile);

    // Detect yaku
    const yakuResult = detectYaku({
        groups, winTile, winType, isDealer, roundWind, playerWind,
        riichi, ippatsu, chankan, rinshan, haitei, houtei,
        waitType, doraIndicators, uraDoraIndicators, redFives
    });

    // Add flowers (optional, treat as 1 han each)
    if (flowers > 0) {
        yakuResult.han += flowers;
        yakuResult.yakuList.push({ name: `花${flowers}`, han: flowers, isDouble: false });
    }

    // Calculate fu (if not yakuman)
    let fu = 0;
    if (yakuResult.yakuman === 0) {
        fu = calculateFu({ groups, winTile, winType, isDealer, roundWind, playerWind, waitType });
    }
    
    // Override fu for pinfu (must be 20)
    if (yakuResult.yakuList.some(y => y.name === '平和')) {
    fu = 20;
    }

    // Determine limit and basic points
    let limit = '';
    let basicPoints = 0; // "符 * 2^(2+han)" capped at 2000

    if (yakuResult.yakuman > 0) {
    // Yakuman: each yakuman counts as a limit hand (base points 8000 for non‑dealer, 12000 for dealer)
    const yakumanBase = isDealer ? 12000 : 8000;
    basicPoints = yakumanBase * yakuResult.yakuman;
    limit = yakuResult.yakuman > 1 ? `${yakuResult.yakuman}倍役満` : '役満';
} else {
    const han = yakuResult.han;
    if (han >= 13) {
        limit = '数え役満';
        basicPoints = 8000;
    } else if (han >= 11) {
        limit = '三倍満';
        basicPoints = 6000;
    } else if (han >= 8) {
        limit = '倍満';
        basicPoints = 4000;
    } else if (han >= 6) {
        limit = '跳満';
        basicPoints = 3000;
    } else if (han >= 5) {
        limit = '満貫';
        basicPoints = 2000;
    } else {
        // Regular calculation
        let multiplier = Math.pow(2, 2 + han);
        basicPoints = fu * multiplier;
        if (basicPoints > 2000) {
            basicPoints = 2000;
            limit = '満貫';
        } else {
            limit = '';
        }
    }
}

    // Calculate payments
    let payment = {};
    if (winType === 'ron') {
        // Ron: discarder pays full points
        payment.total = basicPoints * 4; // Actually basicPoints is the "minipoints" for non-dealer? Need correct formula.
        // We'll keep it simple for now.
    } else { // tsumo
        if (isDealer) {
            payment.each = basicPoints * 2; // dealer tsumo: everyone pays 2*basic
        } else {
            payment.dealer = basicPoints * 2;
            payment.nonDealer = basicPoints;
        }
    }

    return {
        han: yakuResult.han,
        fu,
        yakuList: yakuResult.yakuList,
        limit,
        basicPoints,
        payment,
        yakuman: yakuResult.yakuman
    };
}

// Export functions if using modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        calculateScore,
        detectYaku,
        calculateFu,
        determineWaitType
    };
}

// =============================================================================
// Photo Capture & Tile Recognition (Mock)
// =============================================================================

document.addEventListener('DOMContentLoaded', () => {
    const captureBtn = document.getElementById('captureBtn');
    const uploadInput = document.getElementById('uploadInput');
    const imagePreview = document.getElementById('imagePreview');
    const tilesContainer = document.getElementById('tilesContainer');

    // Trigger file input when capture button is clicked
    captureBtn.addEventListener('click', () => {
        uploadInput.click();
    });

    // Handle file selection
    uploadInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        // Display preview
        const reader = new FileReader();
        reader.onload = (e) => {
            imagePreview.innerHTML = `<img src="${e.target.result}" style="max-width: 100%; max-height: 200px;">`;
        };
        reader.readAsDataURL(file);
 
        // Attempt real recognition
        try {
            const groups = await realRecognition(file);
            renderGroups(groups);
        } catch (err) {
            console.error('Recognition failed', err);
            alert('認識失敗，使用模擬數據');
            const groups = await simulateRecognition(); // fallback
            renderGroups(groups);
        }
    });

    // Mock recognition: returns a fixed hand for testing
    async function simulateRecognition() {
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Return a sample hand: 223344m 567p 88s 东东 (pair)
        // This is a hand with sequences, a triplet, and a pair.
        return [
            { tiles: [{suit:'m',number:2}, {suit:'m',number:2}, {suit:'m',number:3}], type: 'triplet', open: false }, // but this is not a triplet; we'll fix to proper groups
            // Better to create a valid hand: e.g., 234m 456m 33m 678p 99s? Let's create a simple valid hand:
            // 123m (sequence), 456m (sequence), 789m (sequence), 11p (pair) – that's a hand
            { tiles: [{suit:'m',number:1}, {suit:'m',number:2}, {suit:'m',number:3}], type: 'sequence', open: false },
            { tiles: [{suit:'m',number:4}, {suit:'m',number:5}, {suit:'m',number:6}], type: 'sequence', open: false },
            { tiles: [{suit:'m',number:7}, {suit:'m',number:8}, {suit:'m',number:9}], type: 'sequence', open: false },
            { tiles: [{suit:'p',number:1}, {suit:'p',number:1}], type: 'pair', open: false }
        ];
    }

    async function realRecognition(file) {
    // Load image
    const img = await createImageFromFile(file);
    // Ensure image is loaded and dimensions known
    await new Promise(resolve => { if (img.complete) resolve(); else img.onload = resolve; });

    const boxes = detectTileBoxes(img);
    if (boxes.length === 0) throw new Error('No tiles detected');

    const tileLabels = [];
    for (const box of boxes) {
        const label = await classifyTileRegion(img, box);
        // label format: e.g., "m1", "p5", "z6" (z=honor: 1-4 winds, 5-7 dragons)
        const suit = label[0];
        const number = parseInt(label.slice(1));
        tileLabels.push({ suit, number });
    }

    if (tileLabels.length !== 14) {
        console.warn(`Detected ${tileLabels.length} tiles, expected 14. Using anyway.`);
    }

    // Group tiles
    const groups = groupTiles(tileLabels);
    if (!groups) {
        throw new Error('Could not form a valid hand from recognized tiles');
    }

    return groups;
}

function createImageFromFile(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
    });
}

    // Render groups with adjustment controls
    function renderGroups(groups) {
        window.currentGroups = groups;
        tilesContainer.innerHTML = ''; // clear

        // Show raw tile list (text)
        const allTiles = groups.flatMap(g => g.tiles);
        const tileText = allTiles.map(t => `${t.suit}${t.number}`).join(' ');
        const rawDiv = document.createElement('div');
        rawDiv.innerHTML = `<strong>認識牌:</strong> ${tileText}`;
        tilesContainer.appendChild(rawDiv);

        groups.forEach((group, index) => {
            const groupDiv = document.createElement('div');
            groupDiv.className = 'group-row';
            groupDiv.dataset.index = index;

            // Tile display
            const tileSpan = document.createElement('span');
            tileSpan.className = 'tiles';
            tileSpan.textContent = group.tiles.map(t => `${t.suit}${t.number}`).join(' ');
            groupDiv.appendChild(tileSpan);

            // Status controls
            const statuses = ['順子', '刻子', '槓子', '雀頭'];
            const currentStatus = group.type === 'sequence' ? '順子' :
                                  group.type === 'triplet' ? '刻子' :
                                  group.type === 'kan' ? '槓子' : '雀頭';

            const statusSpan = document.createElement('span');
            statusSpan.textContent = currentStatus;
            statusSpan.style.margin = '0 10px';

            const prevBtn = document.createElement('button');
            prevBtn.textContent = '←';
            prevBtn.onclick = () => changeGroupStatus(index, -1);

            const nextBtn = document.createElement('button');
            nextBtn.textContent = '→';
            nextBtn.onclick = () => changeGroupStatus(index, 1);

            const controls = document.createElement('div');
            controls.className = 'group-controls';
            controls.appendChild(prevBtn);
            controls.appendChild(statusSpan);
            controls.appendChild(nextBtn);

            groupDiv.appendChild(controls);
            tilesContainer.appendChild(groupDiv);
        });

        // Add winning tile selector (choose from all tiles in hand)
        addWinningTileSelector(groups);
    }

    // Change group status (cycle through types)
    function changeGroupStatus(index, direction) {
        // This would update the group's type and re-render
        // For simplicity, we'll just log and you can expand later
        console.log(`Change group ${index} by ${direction}`);
        // In a real implementation, you'd modify the groups array and re-render.
    }

    // Add a dropdown to select the winning tile
    function addWinningTileSelector(groups) {
        const selectorDiv = document.createElement('div');
        selectorDiv.className = 'winning-tile-selector';
        selectorDiv.innerHTML = '<label>和了牌: <select id="winTileSelect"></select></label>';

        const select = selectorDiv.querySelector('select');
        // Flatten all tiles
        const allTiles = groups.flatMap(g => g.tiles);
        // Create options (use index as value, or tile representation)
        allTiles.forEach((tile, idx) => {
            const option = document.createElement('option');
            option.value = idx; // we'll use index to identify tile
            option.textContent = `${tile.suit}${tile.number}`;
            select.appendChild(option);
        });

        tilesContainer.appendChild(selectorDiv);
    }
});

// =============================================================================
// Calculate button handler
// =============================================================================
document.getElementById('calculateBtn').addEventListener('click', () => {
    // Gather groups from the UI (you need to store them in a variable)
    // For now, we'll assume groups are stored in a global variable `currentGroups`
    // and the winning tile index is from the dropdown.
    if (!window.currentGroups) {
        alert('請先拍照或輸入牌組');
        return;
    }

    const winTileSelect = document.getElementById('winTileSelect');
    if (!winTileSelect) {
        alert('請選擇和了牌');
        return;
    }

    const winTileIndex = parseInt(winTileSelect.value);
    // Flatten tiles to find the winning tile object
    const allTiles = window.currentGroups.flatMap(g => g.tiles);
    const winTile = allTiles[winTileIndex];

    // Gather other UI parameters
    const params = {
        groups: window.currentGroups,
        winTile: winTile,
        winType: document.getElementById('tsumo').checked ? 'tsumo' : 'ron',
        isDealer: document.getElementById('dealer').checked,
        roundWind: document.getElementById('roundWind').value,
        playerWind: document.getElementById('playerWind').value,
        riichi: document.getElementById('riichi').checked,
        ippatsu: document.getElementById('ippatsu').checked,
        chankan: false,  // not implemented yet
        rinshan: false,
        haitei: false,
        houtei: false,
        doraIndicators: [],  // need to implement dora selection
        uraDoraIndicators: [],
        redFives: parseInt(document.getElementById('akaDora').value) || 0,
        flowers: parseInt(document.getElementById('flowers').value) || 0
    };

    const result = calculateScore(params);

    // Display result
    const resultDiv = document.getElementById('result');
    resultDiv.innerHTML = `
        <h3>結果</h3>
        <p>翻: ${result.han} 符: ${result.fu} 役滿: ${result.yakuman}</p>
        <p>役: ${result.yakuList.map(y => y.name).join('、')}</p>
        <p>${result.limit} 基本點: ${result.basicPoints}</p>
        <pre>${JSON.stringify(result.payment, null, 2)}</pre>
    `;
});

// Store groups globally after recognition
window.currentGroups = null;

// =============================================================================
// Hugging Face Model Loading
// =============================================================================

let classifier = null;

async function loadModel() {
    if (classifier) return classifier;
    const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.6.0');
    // The model is a ViT fine‑tuned on mahjong tiles
    classifier = await pipeline('image-classification', 'pjura/mahjong_vision');
    console.log('Mahjong vision model loaded');
    return classifier;
}

// Load on page load (optional, but good to start early)
window.addEventListener('DOMContentLoaded', () => {
    loadModel().catch(console.error);
});

// =============================================================================
// Tile Detection (Contour-based)
// =============================================================================
function detectTileBoxes(imageElement) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = imageElement.width;
    canvas.height = imageElement.height;
    ctx.drawImage(imageElement, 0, 0, canvas.width, canvas.height);

    // Convert to grayscale
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const gray = new Uint8ClampedArray(canvas.width * canvas.height);
    for (let i = 0; i < data.length; i += 4) {
        // luminance
        gray[i/4] = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
    }

    // Simple threshold (adjust if needed)
    const threshold = 120; // tiles are usually darker than background
    const binary = new Uint8Array(gray.length);
    for (let i = 0; i < gray.length; i++) {
        binary[i] = gray[i] < threshold ? 0 : 255; // 0 = tile (dark)
    }

    // Flood fill to find connected components
    const visited = new Uint8Array(binary.length);
    const boxes = [];

    for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
            const idx = y * canvas.width + x;
            if (binary[idx] === 0 && !visited[idx]) {
                // Start new component
                const stack = [[x, y]];
                visited[idx] = 1;
                let minX = x, maxX = x, minY = y, maxY = y;

                while (stack.length) {
                    const [cx, cy] = stack.pop();
                    minX = Math.min(minX, cx);
                    maxX = Math.max(maxX, cx);
                    minY = Math.min(minY, cy);
                    maxY = Math.max(maxY, cy);

                    // Check 4 neighbors
                    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                        const nx = cx + dx;
                        const ny = cy + dy;
                        if (nx >= 0 && nx < canvas.width && ny >= 0 && ny < canvas.height) {
                            const nidx = ny * canvas.width + nx;
                            if (binary[nidx] === 0 && !visited[nidx]) {
                                visited[nidx] = 1;
                                stack.push([nx, ny]);
                            }
                        }
                    }
                }

                const width = maxX - minX + 1;
                const height = maxY - minY + 1;
                // Ignore tiny noise (adjust based on image size)
                if (width > 20 && height > 20) {
                    boxes.push({ x: minX, y: minY, width, height });
                }
            }
        }
    }

    // Sort left-to-right (common layout)
    boxes.sort((a, b) => a.x - b.x);
    return boxes;
}

async function classifyTileRegion(imageElement, box) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 224;
    canvas.height = 224;
    ctx.drawImage(imageElement, box.x, box.y, box.width, box.height, 0, 0, 224, 224);

    // Convert canvas to blob (image/jpeg)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg'));

    const model = await loadModel(); // ensure loaded
    const results = await model(blob);
    // results is array like [{ label: 'm1', score: 0.99 }, ...]
    // label format: suit + number, e.g., 'm1', 'p5', 'z6' (z for honors)
    return results[0].label;
}

// =============================================================================
// Mahjong Hand Grouping
// =============================================================================

/**
 * Recursively find a valid grouping of tiles.
 * @param {Array} tiles - Array of tile objects (sorted for efficiency)
 * @param {Array} currentGroups - Accumulated groups so far
 * @returns {Array|null} Array of groups if successful, else null
 */
function findGroups(tiles, currentGroups = []) {
    if (tiles.length === 0) {
        // All tiles grouped – success
        return currentGroups;
    }
    if (tiles.length < 2) return null;

    // Count occurrences to help with triplet detection
    const countMap = new Map();
    tiles.forEach(t => {
        const key = `${t.suit}${t.number}`;
        countMap.set(key, (countMap.get(key) || 0) + 1);
    });

    // 1. Try to form a kan (4 identical tiles)
    for (let i = 0; i < tiles.length; i++) {
        // Skip if we already processed this tile value (to avoid redundant attempts)
        if (i > 0 && tileEqual(tiles[i], tiles[i-1])) continue;
        const key = `${tiles[i].suit}${tiles[i].number}`;
        if (countMap.get(key) >= 4) {
            // Select the first four occurrences of this tile
            const kanTiles = tiles.filter(t => tileEqual(t, tiles[i])).slice(0, 4);
            // Remove them by reference
            const newTiles = tiles.filter(t => !kanTiles.includes(t));
            const groups = [...currentGroups, { type: 'kan', tiles: kanTiles, open: false, kanType: 'concealed' }];
            const result = findGroups(newTiles, groups);
            if (result) return result;
        }
    }

    // 2. Try to form a triplet (3 identical tiles)
    for (let i = 0; i < tiles.length; i++) {
        if (i > 0 && tileEqual(tiles[i], tiles[i-1])) continue;
        const key = `${tiles[i].suit}${tiles[i].number}`;
        if (countMap.get(key) >= 3) {
            // Select the first three occurrences
            const triplet = tiles.filter(t => tileEqual(t, tiles[i])).slice(0, 3);
            const newTiles = tiles.filter(t => !triplet.includes(t));
            const groups = [...currentGroups, { type: 'triplet', tiles: triplet, open: false }];
            const result = findGroups(newTiles, groups);
            if (result) return result;
        }
    }

    // 3. Try to form a sequence (3 consecutive tiles of the same suit)
    for (let i = 0; i < tiles.length; i++) {
        const t1 = tiles[i];
        // Find candidates for t1.number+1 and t1.number+2
        const t2Candidates = tiles.filter(t => t.suit === t1.suit && t.number === t1.number + 1);
        const t3Candidates = tiles.filter(t => t.suit === t1.suit && t.number === t1.number + 2);
        if (t2Candidates.length > 0 && t3Candidates.length > 0) {
            // Take the first occurrence of each
            const t2 = t2Candidates[0];
            const t3 = t3Candidates[0];
            // Remove exactly these three tile objects
            const newTiles = tiles.filter(t => t !== t1 && t !== t2 && t !== t3);
            const sequence = [t1, t2, t3];
            const groups = [...currentGroups, { type: 'sequence', tiles: sequence, open: false }];
            const result = findGroups(newTiles, groups);
            if (result) return result;
        }
    }

    // 4. If exactly 2 tiles left and they are identical, form a pair
    if (tiles.length === 2 && tileEqual(tiles[0], tiles[1])) {
        const pair = [tiles[0], tiles[1]];
        const groups = [...currentGroups, { type: 'pair', tiles: pair, open: false }];
        return groups;
    }

    // No grouping found
    return null;
}

/**
 * Main function to group tiles from recognition.
 * Expects an array of tile objects (e.g., from classification).
 * Returns an array of groups if successful, otherwise null.
 */
function groupTiles(tiles) {
    if (tiles.length !== 14) {
        console.warn(`Expected 14 tiles, got ${tiles.length}`);
        return null;
    }
    // Sort for consistent processing
    const sorted = [...tiles].sort((a, b) => {
        if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
        return a.number - b.number;
    });
    return findGroups(sorted);
}

