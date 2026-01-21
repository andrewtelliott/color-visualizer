import fs from 'fs';
import Papa from 'papaparse';
import Color from 'colorjs.io';
import clustersDbscan from '@turf/clusters-dbscan';
import { featureCollection, point } from '@turf/helpers';

const INPUT_FILE = './public/color-usage-report.csv';
const OUTPUT_FILE = './public/data.json';

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

        console.log(`Writing ${processed.length} valid colors to ${OUTPUT_FILE}...`);
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(processed, null, 2));
        console.log("Done.");
    }
});
