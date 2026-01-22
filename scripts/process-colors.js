import fs from 'fs';
import path from 'path';
import process from 'node:process';
import Papa from 'papaparse';
import Color from 'colorjs.io';
import postcss from 'postcss';

const INPUT_FILE = './public/color-usage-report.csv';
const OUTPUT_FILE = './public/data.json';

const DEFAULT_CSS_DIR = './css';
const argv = process.argv.slice(2);
const cssDirFlag = getArgValue(argv, '--cssDir');
const cssDir = cssDirFlag || (fs.existsSync(DEFAULT_CSS_DIR) ? DEFAULT_CSS_DIR : null);

const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'dist']);

console.log(`Reading ${INPUT_FILE}...`);
const csvContent = fs.readFileSync(INPUT_FILE, 'utf8');

Papa.parse(csvContent, {
    header: true,
    complete: (results) => {
        if (results.errors.length > 0) {
            console.warn("CSV Errors:", results.errors);
        }

        console.log(`Processing ${results.data.length} records...`);

        const processed = results.data
            .filter(d => d.Color && d.Count)
            .map((d, index) => {
                try {
                    const c = new Color(d.Color);
                    const hsl = c.to('hsl');
                    
                    // Pre-calculate contrast
                    const onWhite = Math.abs(c.contrast('white', 'WCAG21'));
                    const onBlack = Math.abs(c.contrast('black', 'WCAG21'));

                    return {
                        hex: d.Color,
                        count: parseInt(d.Count, 10),
                        weightedCount: parseFloat(d.WeightedCount || d.Count),
                        rank: parseInt(d.Rank || 0, 10),
                        // D3 in frontend expects s/l as 0-1, colorjs gives 0-100
                        hsl: { h: hsl.coords[0] || 0, s: (hsl.coords[1] || 0) / 100, l: (hsl.coords[2] || 0) / 100 },
                        accessibility: {
                            white: {
                                ratio: onWhite.toFixed(2),
                                aa: onWhite >= 4.5,
                                aaa: onWhite >= 7,
                                aaLarge: onWhite >= 3
                            },
                            black: {
                                ratio: onBlack.toFixed(2),
                                aa: onBlack >= 4.5,
                                aaa: onBlack >= 7,
                                aaLarge: onBlack >= 3
                            }
                        },
                        id: index
                    };
                } catch (e) {
                    console.error(`Error processing color ${d.Color}:`, e.message);
                    return null;
                }
            })
            .filter(d => d !== null)
            .sort((a, b) => b.weightedCount - a.weightedCount);

        const cssUsageByHex = cssDir ? collectCssUsage(cssDir) : new Map();
        const enriched = processed.map((c) => {
            const key = normalizeHexKey(c.hex);
            const cssUsage = key ? (cssUsageByHex.get(key) || []) : [];
            return { ...c, cssUsage };
        });

        console.log(`Writing ${enriched.length} valid colors to ${OUTPUT_FILE}...`);
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(enriched, null, 2));
        console.log("Done.");
    }
});

function getArgValue(args, name) {
    const eqPrefix = `${name}=`;
    const eqArg = args.find((a) => a.startsWith(eqPrefix));
    if (eqArg) return eqArg.slice(eqPrefix.length);

    const idx = args.indexOf(name);
    if (idx !== -1 && args[idx + 1]) return args[idx + 1];

    return null;
}

function listCssFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIR_NAMES.has(entry.name)) continue;
            files.push(...listCssFiles(entryPath));
        } else if (entry.isFile() && entryPath.toLowerCase().endsWith('.css')) {
            files.push(entryPath);
        }
    }

    return files;
}

function getSelector(node) {
    let cur = node.parent;
    while (cur) {
        if (cur.type === 'rule' && cur.selector) return cur.selector;
        cur = cur.parent;
    }
    return null;
}

function getContext(node) {
    const parts = [];
    let cur = node.parent;

    while (cur) {
        if (cur.type === 'rule' && cur.selector) {
            parts.unshift(cur.selector);
        }
        if (cur.type === 'atrule' && cur.name) {
            const at = `@${cur.name}${cur.params ? ` ${cur.params}` : ''}`;
            parts.unshift(at.trim());
        }
        cur = cur.parent;
    }

    return parts.join(' | ');
}

function extractColorTokens(value) {
    const tokens = [];
    const re = /#(?:[0-9a-fA-F]{3,8})\b|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)/g;
    let match;

    while ((match = re.exec(value)) !== null) {
        tokens.push(match[0]);
    }

    return tokens;
}

function extractVarRefs(value) {
    const vars = [];
    const re = /var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,|\))/g;
    let match;

    while ((match = re.exec(value)) !== null) {
        vars.push(match[1]);
    }

    return vars;
}

function normalizeHexKey(input) {
    try {
        const c = new Color(input);
        const hex = c.to('srgb').toString({ format: 'hex' });
        const six = hex.length >= 7 ? hex.slice(0, 7) : hex;
        return six.toUpperCase();
    } catch {
        return null;
    }
}

function pushUsage(map, hex, usage) {
    if (!map.has(hex)) map.set(hex, []);
    map.get(hex).push(usage);
}

function collectCssUsage(cssDirPath) {
    const absDir = path.resolve(cssDirPath);
    if (!fs.existsSync(absDir)) return new Map();

    const cssFiles = listCssFiles(absDir);
    const varToHex = new Map();

    for (const filePath of cssFiles) {
        let cssText;
        try {
            cssText = fs.readFileSync(filePath, 'utf8');
        } catch {
            continue;
        }

        let root;
        try {
            root = postcss.parse(cssText, { from: filePath });
        } catch {
            continue;
        }

        root.walkDecls((decl) => {
            if (!decl.prop || !decl.prop.startsWith('--')) return;

            const tokens = extractColorTokens(decl.value || '');
            if (tokens.length !== 1) return;
            const hex = normalizeHexKey(tokens[0]);
            if (!hex) return;
            varToHex.set(decl.prop, hex);
        });
    }

    const usageByHex = new Map();
    for (const filePath of cssFiles) {
        let cssText;
        try {
            cssText = fs.readFileSync(filePath, 'utf8');
        } catch {
            continue;
        }

        let root;
        try {
            root = postcss.parse(cssText, { from: filePath });
        } catch {
            continue;
        }

        const relFile = path.relative(process.cwd(), filePath);
        root.walkDecls((decl) => {
            const pos = decl.source && decl.source.start ? decl.source.start : null;
            const selector = getSelector(decl);
            const context = getContext(decl);
            const property = decl.prop;
            const value = decl.value;

            const tokens = extractColorTokens(value || '');
            const isVarDef = typeof property === 'string' && property.startsWith('--');

            for (const token of tokens) {
                const hex = normalizeHexKey(token);
                if (!hex) continue;
                pushUsage(usageByHex, hex, {
                    file: relFile,
                    line: pos ? pos.line : null,
                    column: pos ? pos.column : null,
                    selector,
                    context,
                    property,
                    value,
                    kind: isVarDef ? 'var_definition' : 'literal',
                    token,
                    variable: isVarDef ? property : null
                });
            }

            const varRefs = extractVarRefs(value || '');
            for (const variable of varRefs) {
                const hex = varToHex.get(variable);
                if (!hex) continue;
                pushUsage(usageByHex, hex, {
                    file: relFile,
                    line: pos ? pos.line : null,
                    column: pos ? pos.column : null,
                    selector,
                    context,
                    property,
                    value,
                    kind: 'var_reference',
                    token: null,
                    variable
                });
            }
        });
    }

    return usageByHex;
}
