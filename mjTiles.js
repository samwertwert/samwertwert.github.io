// Tile suits: 'm' (man), 'p' (pin), 's' (sou), 'z' (honor)
const SUITS = ['m', 'p', 's', 'z'];

// Honor tiles: 1-4 are winds (east, south, west, north), 5-7 are dragons (white, green, red)
const HONOR_NAMES = { 1: '東', 2: '南', 3: '西', 4: '北', 5: '白', 6: '發', 7: '中' };

/**
 * Compare two tiles for equality (ignoring red for grouping)
 * @param {Object} t1 - First tile {suit, number, red?}
 * @param {Object} t2 - Second tile
 * @returns {boolean}
 */
function tileEqual(t1, t2) {
    return t1.suit === t2.suit && t1.number === t2.number;
}

/**
 * Check if three tiles form a sequence (same suit, consecutive numbers)
 */
function isSequence(t1, t2, t3) {
    if (t1.suit !== t2.suit || t2.suit !== t3.suit) return false;
    // Sort by number
    const nums = [t1.number, t2.number, t3.number].sort((a,b) => a-b);
    return nums[1] === nums[0] + 1 && nums[2] === nums[1] + 1;
}

/**
 * Check if tile is terminal (1 or 9) or honor
 * @param {Object} t - Tile object
 * @returns {boolean}
 */
function isYaochu(t) {
    return t.suit === 'z' || t.number === 1 || t.number === 9;
}

/**
 * Check if tile is simple (2-8 in man/pin/sou)
 * @param {Object} t - Tile object
 * @returns {boolean}
 */
function isSimple(t) {
    return (t.suit === 'm' || t.suit === 'p' || t.suit === 's') && t.number >= 2 && t.number <= 8;
}

/**
 * Check if tile is honor
 * @param {Object} t - Tile object
 * @returns {boolean}
 */
function isHonor(t) {
    return t.suit === 'z';
}

/**
 * Convert wind character to number (1=東,2=南,3=西,4=北)
 * @param {string|number} wind - e.g., '東' or 'e' or number
 * @returns {number}
 */
function windToNumber(wind) {
    if (typeof wind === 'number') return wind;
    const map = { '東':1, '南':2, '西':3, '北':4, 'e':1, 's':2, 'w':3, 'n':4 };
    return map[wind] || 0;
}

/**
 * Get the next tile in dora order (cycle: 1→2...9→1 for numbers; winds 東→南→西→北→東; dragons 白→發→中→白)
 * @param {Object} tile - Indicator tile
 * @returns {Object} Next tile (same suit, next number)
 */
function getNextTile(tile) {
    const { suit, number } = tile;
    if (suit === 'z') {
        if (number <= 4) {
            // winds: 1→2,2→3,3→4,4→1
            return { suit, number: (number % 4) + 1 };
        } else {
            // dragons: 5→6,6→7,7→5
            return { suit, number: number === 5 ? 6 : (number === 6 ? 7 : 5) };
        }
    } else {
        // number tiles: 1→2 ... 9→1
        return { suit, number: (number % 9) + 1 };
    }
}

/**
 * Check if tile is green (for Ryuuiisou)
 * @param {Object} t - Tile object
 * @returns {boolean}
 */
function isGreen(t) {
    if (t.suit === 's' && [2,3,4,6,8].includes(t.number)) return true;
    if (t.suit === 'z' && t.number === 6) return true; // green dragon (發)
    return false;
}

/**
 * Count occurrences of each tile in the hand
 * @param {Array} groups - Array of group objects (each with .tiles)
 * @returns {Object} Map with keys like 'm1', 'p5', etc.
 */
function countTiles(groups) {
    const counts = {};
    groups.forEach(group => {
        group.tiles.forEach(t => {
            const key = `${t.suit}${t.number}`;
            counts[key] = (counts[key] || 0) + 1;
        });
    });
    return counts;
}
