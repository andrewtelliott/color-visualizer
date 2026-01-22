import React, { useEffect, useRef, useState, useMemo, useDeferredValue } from 'react';
import * as d3 from 'd3';
import { Download, Grid2X2, Activity, Filter, Loader2, AlertCircle, Palette, CheckCircle2, XCircle } from 'lucide-react';
import clustersDbscan from '@turf/clusters-dbscan';
import { featureCollection, point } from '@turf/helpers';

const ColorVisualizer = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [topX, setTopX] = useState(100);
  const [coalesceThreshold, setCoalesceThreshold] = useState(0); 
  const [preservePopularStrength, setPreservePopularStrength] = useState(0.5);
  const [hoveredColor, setHoveredColor] = useState(null);
  const [hoverPosition, setHoverPosition] = useState(null);
  const [viewMode, setViewMode] = useState('voronoi'); // 'scatter' or 'voronoi'
  const [useAdvancedClustering, setUseAdvancedClustering] = useState(false);
  const [selectedColors, setSelectedColors] = useState(new Set());
  const [wheelSize, setWheelSize] = useState(600);
  const vizContainerRef = useRef(null);

  useEffect(() => {
    if (!vizContainerRef.current) return;

    const el = vizContainerRef.current;
    const compute = () => {
      const w = el.clientWidth || 0;
      const next = Math.max(320, Math.min(900, Math.floor(w - 48)));
      setWheelSize((prev) => (prev === next ? prev : next));
    };

    compute();

    const ro = new ResizeObserver(() => compute());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('/data.json');
        if (!response.ok) throw new Error("Failed to fetch pre-computed data");
        const jsonData = await response.json();
        
        setData(jsonData);
        setLoading(false);
      } catch (error) {
        console.error("Error loading data", error);
        setError(error.message);
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Defer the values that trigger expensive re-calculations
  const deferredTopX = useDeferredValue(topX);
  const deferredCoalesceThreshold = useDeferredValue(coalesceThreshold);
  const deferredPreservePopularStrength = useDeferredValue(preservePopularStrength);

  // Filter and Coalesce Data
  const filteredData = useMemo(() => {
    let currentData = data.slice(0, deferredTopX);
    const maxWeight = d3.max(currentData, (d) => d.weightedCount) || 1;

    if (deferredCoalesceThreshold > 0) {
        if (useAdvancedClustering) {
            // Advanced Clustering using DBSCAN on HSL space
            // H is 0-360, S and L are 0-1. Normalize H for distance calculation.
            const points = currentData.map((d, i) => {
                const h = isNaN(d.hsl.h) ? 0 : d.hsl.h / 360;
                return point([h, d.hsl.s, d.hsl.l], { index: i });
            });

            const collection = featureCollection(points);
            // eps is threshold, minPoints is 1 to ensure every point is in a cluster
            const clustered = clustersDbscan(collection, deferredCoalesceThreshold, { units: 'degrees', minPoints: 1 });

            const clusterMembers = new Map();
            clustered.features.forEach((f) => {
                const clusterId = f.properties.cluster;
                const originalIndex = f.properties.index;
                const member = currentData[originalIndex];

                if (!clusterMembers.has(clusterId)) {
                    clusterMembers.set(clusterId, [member]);
                } else {
                    clusterMembers.get(clusterId).push(member);
                }
            });

            const clusters = [];
            clusterMembers.forEach((members) => {
                if (members.length === 1) {
                    const only = members[0];
                    clusters.push({ ...only, members: [only], totalCount: only.weightedCount });
                    return;
                }

                const sorted = members.slice().sort((a, b) => (b.weightedCount || 0) - (a.weightedCount || 0));

                // Optional "weight-aware" splitting of DBSCAN clusters.
                // High-usage colors become "anchors" that only merge if extremely close.
                const subClusters = [];
                for (const candidate of sorted) {
                    let merged = false;
                    for (const sc of subClusters) {
                        const dist = colorDistance(sc.hsl, candidate.hsl);
                        const scale = mergeScale(sc, candidate, maxWeight, deferredPreservePopularStrength);
                        if (dist < deferredCoalesceThreshold * scale) {
                            sc.members.push(candidate);
                            sc.totalCount += candidate.weightedCount || 0;
                            merged = true;
                            break;
                        }
                    }
                    if (!merged) {
                        subClusters.push({ ...candidate, members: [candidate], totalCount: candidate.weightedCount || 0 });
                    }
                }

                // Ensure each cluster representative is the highest-weight member
                for (const sc of subClusters) {
                    const rep = sc.members.reduce((best, m) => ((m.weightedCount || 0) > (best.weightedCount || 0) ? m : best), sc.members[0]);
                    clusters.push({ ...rep, members: sc.members, totalCount: sc.totalCount });
                }
            });

            return clusters.sort((a, b) => (b.totalCount || 0) - (a.totalCount || 0));
        } else {
            // Simple clustering: Greedily merge colors close in HSL space
            const clusters = [];
            const used = new Set();

            for (let i = 0; i < currentData.length; i++) {
                if (used.has(i)) continue;
                
                const base = currentData[i];
                const cluster = { ...base, members: [base], totalCount: base.weightedCount };
                used.add(i);

                for (let j = i + 1; j < currentData.length; j++) {
                    if (used.has(j)) continue;
                    
                    const candidate = currentData[j];
                    const dist = colorDistance(base.hsl, candidate.hsl);
                    const scale = mergeScale(base, candidate, maxWeight, deferredPreservePopularStrength);
                    
                    if (dist < deferredCoalesceThreshold * scale) {
                        cluster.members.push(candidate);
                        cluster.totalCount += candidate.weightedCount;
                        used.add(j);
                    }
                }
                clusters.push(cluster);
            }
            return clusters.sort((a, b) => b.totalCount - a.totalCount);
        }
    }

    return currentData;
  }, [data, deferredTopX, deferredCoalesceThreshold, deferredPreservePopularStrength, useAdvancedClustering]);

  const handleHover = (color, evt) => {
    if (!color) {
      setHoveredColor(null);
      setHoverPosition(null);
      return;
    }

    setHoveredColor(color);

    if (!evt || !vizContainerRef.current) return;
    const rect = vizContainerRef.current.getBoundingClientRect();
    setHoverPosition({
      x: evt.clientX - rect.left,
      y: evt.clientY - rect.top
    });
  };

  const toggleColorSelection = (hex) => {
    setSelectedColors(prev => {
      const next = new Set(prev);
      if (next.has(hex)) next.delete(hex);
      else next.add(hex);
      return next;
    });
  };

  const exportTokens = () => {
    const tokens = Array.from(selectedColors).map(hex => {
      const colorData = data.find(d => d.hex === hex) || filteredData.find(d => d.hex === hex);
      return {
        hex,
        name: `color-${hex.replace('#', '')}`,
        usageCount: colorData?.count || 0,
        accessibility: colorData?.accessibility
      };
    });

    const blob = new Blob([JSON.stringify(tokens, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'design-tokens.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return (
    <div className="h-screen flex flex-col items-center justify-center text-gray-500 gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
        <p>Loading color data...</p>
    </div>
  );

  if (error) return (
    <div className="h-screen flex flex-col items-center justify-center text-red-500 gap-4">
        <AlertCircle className="w-10 h-10" />
        <p>Error: {error}</p>
    </div>
  );

  // D3 Visualization logic would go here or in a sub-component
  // For now, let's just prepare the container
  return (
    <div className="p-6 max-w-6xl mx-auto font-sans pb-28">
      <header className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Color Usage Visualizer</h1>
        <p className="text-gray-600">Visualizing {data.length} unique colors from the report.</p>
      </header>

      {/* Controls */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100 mb-6">
        <div className="flex flex-wrap gap-6 items-end">
            <div>
                <label className="flex items-center gap-2 cursor-pointer">
                    <input 
                        type="checkbox"
                        checked={useAdvancedClustering}
                        onChange={(e) => setUseAdvancedClustering(e.target.checked)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-gray-700 text-pretty">Use DBSCAN Clustering</span>
                </label>
                <p className="text-xs text-gray-500 mt-1">Better spatial grouping of colors</p>
            </div>

            <div className="min-w-[220px]">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                    Show Top {topX} Colors
                </label>
                <input 
                    type="range" 
                    min="10" 
                    max={Math.min(500, data.length)} 
                    value={topX} 
                    onChange={(e) => setTopX(Number(e.target.value))}
                    className="w-full"
                />
            </div>

            <div className="min-w-[220px]">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                    Coalesce Threshold: {coalesceThreshold}
                </label>
                <p className="text-xs text-gray-500 mb-2">Group similar colors together</p>
                <input 
                    type="range" 
                    min="0" 
                    max="0.5" 
                    step="0.01"
                    value={coalesceThreshold} 
                    onChange={(e) => setCoalesceThreshold(Number(e.target.value))}
                    className="w-full"
                />
            </div>

            <div className="min-w-[220px]">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                    Preserve Popular Strength: {preservePopularStrength}
                </label>
                <p className="text-xs text-gray-500 mb-2">High-usage colors resist being merged away</p>
                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={preservePopularStrength}
                    onChange={(e) => setPreservePopularStrength(Number(e.target.value))}
                    className="w-full"
                />
            </div>
        </div>
      </div>

      {/* Visualization Area */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-end">
            <div className="flex gap-2 p-1 bg-gray-100 rounded-lg">
                <button 
                    onClick={() => setViewMode('voronoi')}
                    className={`py-2 px-3 text-sm rounded-md font-medium transition-all ${
                        viewMode === 'voronoi' 
                            ? 'bg-white text-blue-600 shadow-sm' 
                            : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                    Stained Glass
                </button>
                <button 
                    onClick={() => setViewMode('scatter')}
                    className={`py-2 px-3 text-sm rounded-md font-medium transition-all ${
                        viewMode === 'scatter' 
                            ? 'bg-white text-blue-600 shadow-sm' 
                            : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                    Scatter Plot
                </button>
            </div>
        </div>

        <div ref={vizContainerRef} className="relative p-6 min-h-[600px] flex items-center justify-center">
             <ColorWheel 
                data={filteredData} 
                size={wheelSize}
                viewMode={viewMode} 
                onHover={handleHover} 
                selectedColors={selectedColors}
                onSelect={toggleColorSelection}
             />

            {hoveredColor && hoverPosition && (
                (() => {
                    const popoverWidth = 288;
                    const popoverHeight = 260;

                    const containerWidth = vizContainerRef.current?.clientWidth || 0;
                    const containerHeight = vizContainerRef.current?.clientHeight || 0;

                    const desiredLeft = hoverPosition.x + 12;
                    const desiredTop = hoverPosition.y + 12;

                    const clampedLeft = containerWidth
                        ? Math.max(12, Math.min(desiredLeft, containerWidth - popoverWidth - 12))
                        : desiredLeft;
                    const clampedTop = containerHeight
                        ? Math.max(12, Math.min(desiredTop, containerHeight - popoverHeight - 12))
                        : desiredTop;

                    return (
                <div
                    className="absolute z-10 w-72 bg-white rounded-lg shadow-lg border border-gray-200 p-4 pointer-events-none"
                    style={{ left: clampedLeft, top: clampedTop }}
                >
                    <div className="w-12 h-12 rounded mb-2 border border-gray-300 shadow-sm" style={{ backgroundColor: hoveredColor.hex }}></div>
                    <div className="font-mono text-lg font-bold">{hoveredColor.hex}</div>
                    <div className="text-sm text-gray-600">Rank: {hoveredColor.rank ?? hoveredColor.Rank}</div>
                    <div className="text-sm text-gray-600">Count: {hoveredColor.count}</div>
                    
                    {/* Accessibility Info */}
                    <div className="mt-4 pt-4 border-t border-gray-200">
                        <h3 className="text-xs font-semibold uppercase text-gray-400 mb-2 tracking-wider">WCAG Accessibility</h3>
                        {(() => {
                            const acc = hoveredColor.accessibility;
                            if (!acc) return null;
                            return (
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-gray-500">vs White</span>
                                        <div className="flex items-center gap-2">
                                            <span className="font-mono text-xs font-bold">{acc.white.ratio}:1</span>
                                            {acc.white.aa ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-gray-500">vs Black</span>
                                        <div className="flex items-center gap-2">
                                            <span className="font-mono text-xs font-bold">{acc.black.ratio}:1</span>
                                            {acc.black.aa ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                    {hoveredColor.members && (
                        <div className="mt-2 text-xs text-gray-500">
                            Merged with {hoveredColor.members.length - 1} other colors
                        </div>
                    )}
                </div>
                    );
                })()
            )}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200">
        <div className="max-w-6xl mx-auto p-4 flex items-center justify-between gap-4">
            <div className="text-sm text-gray-600">{selectedColors.size} selected</div>
            <div className="flex items-center gap-2">
                {selectedColors.size > 0 && (
                    <button 
                        onClick={() => setSelectedColors(new Set())}
                        className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2"
                    >
                        Clear Selection
                    </button>
                )}
                <button 
                    onClick={exportTokens}
                    disabled={selectedColors.size === 0}
                    className="flex items-center justify-center gap-2 py-2 px-4 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                    <Download className="w-4 h-4" />
                    Export {selectedColors.size} Tokens
                </button>
            </div>
        </div>
      </div>
    </div>
  );
};

// Euclidean distance in HSL space (approximate)
function colorDistance(c1, c2) {
    let hDiff = Math.abs(c1.h - c2.h);
    if (isNaN(hDiff)) hDiff = 0; 
    if (hDiff > 180) hDiff = 360 - hDiff;
    hDiff = hDiff / 180; 

    let sDiff = Math.abs(c1.s - c2.s);
    let lDiff = Math.abs(c1.l - c2.l);

    return Math.sqrt(hDiff*hDiff + sDiff*sDiff + lDiff*lDiff); 
}

function mergeScale(base, candidate, maxWeight, preservePopularStrength) {
    if (!preservePopularStrength || preservePopularStrength <= 0) return 1;

    const baseW = base?.weightedCount || 0;
    const candW = candidate?.weightedCount || 0;

    const maxW = maxWeight || 1;
    const candNorm = Math.log1p(candW) / Math.log1p(maxW);
    const relative = baseW > 0 ? candW / baseW : 0;

    // Candidate is more "protected" if it's both absolutely frequent and relatively close to the base in frequency.
    const importance = Math.min(1, candNorm * Math.min(1, relative * 2));
    const scale = 1 - preservePopularStrength * importance;

    return Math.max(0.05, scale);
}

const ColorWheel = React.memo(({ data, viewMode, onHover, selectedColors, onSelect }) => {
    const width = 600;
    const height = 600;
    const radius = Math.min(width, height) / 2;
    const innerRadius = radius - 20;

    // Memoize scales so they don't trigger re-computations
    const xScale = useMemo(() => d3.scaleLinear().domain([0, 1]).range([0, innerRadius]), [innerRadius]);
    
    const sizeScale = useMemo(() => d3.scaleSqrt()
        .domain([0, d3.max(data, d => d.totalCount || d.weightedCount) || 100])
        .range([2, 15]), [data]);

    // Pre-calculate positions with jitter to avoid coincident points (which break Voronoi)
    const points = useMemo(() => {
        return data.map((d, i) => {
            const c = d.hsl;
            const h = isNaN(c.h) ? 0 : c.h; 
            const s = c.s;
            const angle = (h - 90) * (Math.PI / 180);
            const r = xScale(s);
            
            // Add tiny jitter (1e-4) to x and y to ensure uniqueness for Delaunay
            // Use index-based jitter for determinism across renders
            const jitterX = (Math.sin(i) * 1e-4);
            const jitterY = (Math.cos(i) * 1e-4);

            return {
                ...d,
                x: (r * Math.cos(angle)) + jitterX,
                y: (r * Math.sin(angle)) + jitterY
            };
        });
    }, [data, xScale]);

    // Voronoi
    const voronoiPath = useMemo(() => {
        if (viewMode !== 'voronoi' || points.length === 0) return [];
        
        try {
            const delaunay = d3.Delaunay.from(points.map(p => [p.x, p.y]));
            const voronoi = delaunay.voronoi([-innerRadius, -innerRadius, innerRadius, innerRadius]);
            return points.map((p, i) => voronoi.renderCell(i));
        } catch (e) {
            console.error("Voronoi generation failed", e);
            return [];
        }
    }, [points, viewMode, innerRadius]);

    return (
        <svg 
            width={width} 
            height={height} 
            viewBox={`0 0 ${width} ${height}`}
            onMouseLeave={() => onHover(null)}
        >
            <g transform={`translate(${width/2}, ${height/2})`}>
                
                {/* Defs for gradients */}
                <defs>
                    <radialGradient id="wheelGradient">
                         <stop offset="0%" stopColor="#888" stopOpacity="0.1" />
                         <stop offset="100%" stopColor="#888" stopOpacity="0" />
                    </radialGradient>
                </defs>

                {/* Base Circle */}
                {viewMode === 'scatter' && (
                    <>
                         {/* Simple Color Wheel Background for context */}
                        {Array.from({ length: 36 }).map((_, i) => (
                            <path
                                key={i}
                                d={d3.arc()({
                                    innerRadius: 0,
                                    outerRadius: innerRadius,
                                    startAngle: (i * 10) * (Math.PI / 180),
                                    endAngle: ((i + 1) * 10) * (Math.PI / 180)
                                })}
                                fill={`hsl(${i * 10}, 100%, 50%)`}
                                opacity="0.05"
                            />
                        ))}
                        <circle r={innerRadius} fill="none" stroke="#e5e7eb" />
                        {[0.25, 0.5, 0.75].map(tick => (
                            <circle key={tick} r={xScale(tick)} fill="none" stroke="#e5e7eb" strokeDasharray="4 4" />
                        ))}
                    </>
                )}

                {/* Voronoi Layer */}
                {viewMode === 'voronoi' && (
                    <g>
                        {/* Clip to circle */}
                        <clipPath id="circle-clip">
                            <circle r={innerRadius} />
                        </clipPath>
                        <g clipPath="url(#circle-clip)">
                            {points.map((p, i) => (
                                <path
                                    key={i}
                                    d={voronoiPath[i]}
                                    fill={p.hex}
                                    stroke={selectedColors.has(p.hex) ? "#000" : "rgba(0,0,0,0.1)"}
                                    strokeWidth={selectedColors.has(p.hex) ? 3 : 1}
                                    onMouseEnter={(e) => onHover(p, e)}
                                    onClick={() => onSelect(p.hex)}
                                    className="hover:opacity-90 transition-opacity cursor-pointer"
                                />
                            ))}
                        </g>
                    </g>
                )}

                {/* Scatter Points (Render on top of Voronoi for clarity? Or just hiding in Voronoi mode) */}
                {/* In Voronoi mode, we might want to show the center dots slightly? */}
                {points.map((p, i) => (
                    <circle 
                        key={i}
                        cx={p.x}
                        cy={p.y}
                        r={viewMode === 'voronoi' ? 2 : sizeScale(p.totalCount || p.weightedCount)}
                        fill={viewMode === 'voronoi' ? "rgba(0,0,0,0.2)" : p.hex}
                        stroke={selectedColors.has(p.hex) ? "#000" : (viewMode === 'voronoi' ? "none" : "#fff")}
                        strokeWidth={selectedColors.has(p.hex) ? 2 : 1}
                        className={`transition-all duration-200 cursor-pointer ${viewMode === 'scatter' ? 'hover:stroke-gray-800 hover:stroke-2' : ''} ${selectedColors.has(p.hex) ? 'ring-2 ring-black' : ''}`}
                        onMouseEnter={(e) => onHover(p, e)}
                        onClick={() => onSelect(p.hex)}
                        pointerEvents={viewMode === 'voronoi' ? 'none' : 'all'} // Let Voronoi handle hover in that mode
                    />
                ))}

            </g>
        </svg>
    );
});

export default ColorVisualizer;
