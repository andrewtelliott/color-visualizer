import React, { useEffect, useRef, useState, useMemo, useDeferredValue } from 'react';
import * as d3 from 'd3';
import { Download, Grid2X2, Activity, Filter, Loader2, AlertCircle, Palette, CheckCircle2, XCircle } from 'lucide-react';
import Color from 'colorjs.io';
import clustersDbscan from '@turf/clusters-dbscan';
import { featureCollection, point } from '@turf/helpers';

const SURFACES = {
  page: { label: 'Page', bg: '#FFFFFF' },
  dialog: { label: 'Dialog', bg: '#FFFFFF' },
  sidebar: { label: 'Sidebar', bg: '#F3F4F6' },
  highlight: { label: 'Highlight', bg: '#FEF3C7' },
  link: { label: 'Link area', bg: '#FFFFFF' },
  button: { label: 'Button / CTA', bg: '#FFFFFF' }
};

function extractFirstMatch(text, patterns) {
  for (const p of patterns) {
    if (p.re.test(text)) return { value: p.value, explicit: true };
  }
  return { value: null, explicit: false };
}

function deriveState(selector, context) {
  const hay = `${selector || ''} ${context || ''}`;
  const result = extractFirstMatch(hay, [
    { value: 'hover', re: /:hover\b|\bhover\b|\bis-hover\b|\bhovered\b/i },
    { value: 'active', re: /:active\b|\bactive\b|\bis-active\b|\bselected\b|\bopen\b|\bis-open\b/i },
    { value: 'focus', re: /:focus-visible\b|:focus\b|\bfocus\b|\bfocused\b/i },
    { value: 'disabled', re: /:disabled\b|\bdisabled\b|\bis-disabled\b|\[aria-disabled\s*=\s*"?true"?\]/i },
    { value: 'error', re: /\berror\b|\binvalid\b|\[aria-invalid\s*=\s*"?true"?\]/i },
    { value: 'visited', re: /:visited\b|\bvisited\b/i }
  ]);
  if (result.value) return result;
  return { value: 'default', explicit: false };
}

function deriveVariant(selector, context) {
  const hay = `${selector || ''} ${context || ''}`;
  const result = extractFirstMatch(hay, [
    { value: 'primary', re: /\bprimary\b|\bis-primary\b/i },
    { value: 'secondary', re: /\bsecondary\b|\bis-secondary\b/i },
    { value: 'danger', re: /\bdanger\b|\berror\b|\bdestructive\b|\bis-danger\b/i },
    { value: 'success', re: /\bsuccess\b|\bis-success\b/i },
    { value: 'warning', re: /\bwarning\b|\bis-warning\b/i },
    { value: 'info', re: /\binfo\b|\bis-info\b/i }
  ]);
  if (result.value) return result;
  return { value: 'default', explicit: false };
}

function deriveObject(selector, context, file) {
  const hay = `${selector || ''} ${context || ''} ${file || ''}`;
  const result = extractFirstMatch(hay, [
    { value: 'button', re: /\bbutton\b|\bbtn\b|\.btn\b|\.button\b|\bcta\b/i },
    { value: 'link', re: /\blink\b|\ba\b\[|\ba\b\.|\banchor\b|\bnav\b/i },
    { value: 'dialog', re: /\bdialog\b|\bmodal\b|\boverlay\b/i },
    { value: 'sidebar', re: /\bsidebar\b|\bdrawer\b/i },
    { value: 'highlight', re: /\bhighlight\b|\bcallout\b|\bbadge\b/i }
  ]);
  if (result.value) return result;
  return { value: null, explicit: false };
}

function deriveSlotFromProperty(prop) {
  const p = String(prop || '').toLowerCase();
  if (p === 'color') return { value: 'fg', explicit: true };
  if (p === 'background' || p === 'background-color') return { value: 'bg', explicit: true };
  if (p.includes('border') || p.includes('outline')) return { value: 'border', explicit: true };
  if (p === 'fill' || p === 'stroke') return { value: 'icon', explicit: true };
  if (p.includes('shadow')) return { value: 'shadow', explicit: true };
  return { value: null, explicit: false };
}

function safeContrastRatio(fgHex, bgHex) {
  try {
    const c = new Color(fgHex);
    const ratio = Math.abs(c.contrast(bgHex, 'WCAG21'));
    return ratio;
  } catch {
    return null;
  }
}

const ColorVisualizer = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [topX, setTopX] = useState(100);
  const [coalesceThreshold, setCoalesceThreshold] = useState(0); 
  const [preservePopularStrength, setPreservePopularStrength] = useState(0.5);
  const [hoveredColor, setHoveredColor] = useState(null);
  const [hoverPosition, setHoverPosition] = useState(null);
  const [viewMode, setViewMode] = useState('voronoi'); // 'scatter' | 'voronoi' | 'data'
  const [useAdvancedClustering, setUseAdvancedClustering] = useState(false);
  const [selectedColors, setSelectedColors] = useState(new Set());
  const [wheelSize, setWheelSize] = useState(600);
  const [dataView, setDataView] = useState('filtered');
  const [dataSubView, setDataSubView] = useState('table');
  const [radialMetric, setRadialMetric] = useState('saturation'); // 'saturation' | 'lightness'
  const [hueBandEnabled, setHueBandEnabled] = useState(false);
  const [hueBandCenter, setHueBandCenter] = useState(0);
  const [hueBandWidth, setHueBandWidth] = useState(10);
  const [showTour, setShowTour] = useState(false);
  const [showAdvancedToolbox, setShowAdvancedToolbox] = useState(false);
  const [collectMode, setCollectMode] = useState(true);
  const [oklchSlice, setOklchSlice] = useState('l-c'); // 'l-c' | 'h-l' | 'h-c'
  const [contextObject, setContextObject] = useState('button');
  const [contextSlot, setContextSlot] = useState('bg');
  const [contextVariant, setContextVariant] = useState('default');
  const [contextState, setContextState] = useState('default');
  const [contextSurface, setContextSurface] = useState('page');
  const [allowInferredContexts, setAllowInferredContexts] = useState(true);
  const [evidenceDetail, setEvidenceDetail] = useState('file+selector');
  const [manualHex, setManualHex] = useState('');
  const [manualCount, setManualCount] = useState(1);
  const [manualWeight, setManualWeight] = useState(1);
  const [manualContext, setManualContext] = useState('');
  const [manualError, setManualError] = useState(null);
  const [tokenExportFormat, setTokenExportFormat] = useState('simple'); // 'simple' | 'dtcg'
  const [jsonOutputMode, setJsonOutputMode] = useState('dataset'); // 'dataset' | 'tokens'
  const [editingManualHex, setEditingManualHex] = useState(null);
  const [editManualCount, setEditManualCount] = useState(1);
  const [editManualWeight, setEditManualWeight] = useState(1);
  const [editManualContext, setEditManualContext] = useState('');
  const vizContainerRef = useRef(null);

  const isEmbed = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).has('embed');
  }, []);

  const fullAppHref = useMemo(() => {
    if (typeof window === 'undefined') return '/';
    const params = new URLSearchParams(window.location.search);
    params.delete('embed');
    const qs = params.toString();
    return `${window.location.pathname}${qs ? `?${qs}` : ''}`;
  }, []);

  useEffect(() => {
    if (!isEmbed) return;
    if (viewMode === 'data') setViewMode('voronoi');
  }, [isEmbed, viewMode]);

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

  const normalizeHexKey = (input) => {
    try {
      const c = new Color(input);
      const hex = c.to('srgb').toString({ format: 'hex' });
      const six = hex.length >= 7 ? hex.slice(0, 7) : hex;
      return six.toUpperCase();
    } catch {
      return null;
    }
  };

  const computeHslAndAccessibility = (hex) => {
    const c = new Color(hex);
    const hsl = c.to('hsl');
    const onWhite = Math.abs(c.contrast('white', 'WCAG21'));
    const onBlack = Math.abs(c.contrast('black', 'WCAG21'));
    return {
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
      }
    };
  };

  const recomputeRanks = (items) => {
    const sorted = items.slice().sort((a, b) => {
      const aw = a?.weightedCount ?? a?.count ?? 0;
      const bw = b?.weightedCount ?? b?.count ?? 0;
      return bw - aw;
    });
    return sorted.map((d, idx) => ({ ...d, rank: idx + 1 }));
  };

  const addManualColor = () => {
    const hex = normalizeHexKey(manualHex);
    if (!hex) {
      setManualError('Enter a valid color (hex, rgb(), hsl(), etc.).');
      return;
    }

    const count = Math.max(0, Number.parseInt(String(manualCount || 0), 10) || 0);
    const weight = Number.isFinite(Number(manualWeight)) ? Number(manualWeight) : 1;
    const weightedCount = (Number.isFinite(count) ? count : 0) * (Number.isFinite(weight) ? weight : 1);

    let derived;
    try {
      derived = computeHslAndAccessibility(hex);
    } catch {
      setManualError('Failed to parse that color.');
      return;
    }

    const contexts = String(manualContext || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    const cssUsage = contexts.map((ctx) => ({
      file: '(manual)',
      line: null,
      column: null,
      selector: null,
      context: ctx,
      property: null,
      value: null,
      kind: 'manual',
      token: null,
      variable: null
    }));

    setData((prev) => {
      const idx = prev.findIndex((d) => normalizeHexKey(d.hex) === hex);
      if (idx === -1) {
        const next = prev.concat({
          hex,
          count,
          weightedCount,
          ...derived,
          id: `manual-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          cssUsage
        });
        return recomputeRanks(next);
      }

      const existing = prev[idx];
      const next = prev.slice();
      next[idx] = {
        ...existing,
        count: (existing.count || 0) + count,
        weightedCount: (existing.weightedCount || existing.count || 0) + weightedCount,
        cssUsage: (existing.cssUsage || []).concat(cssUsage)
      };
      return recomputeRanks(next);
    });

    setManualError(null);
    setManualHex('');
    setManualCount(1);
    setManualWeight(1);
    setManualContext('');
  };

  const isManualRow = (d) => typeof d?.id === 'string' && d.id.startsWith('manual-');

  const getManualContextText = (d) => {
    const usage = Array.isArray(d?.cssUsage) ? d.cssUsage : [];
    return usage
      .filter((u) => u && u.kind === 'manual' && u.file === '(manual)')
      .map((u) => u.context)
      .filter(Boolean)
      .join('\n');
  };

  const beginEditManual = (d) => {
    setEditingManualHex(d.hex);
    setEditManualCount(typeof d.count === 'number' ? d.count : 0);
    const baseCount = typeof d.count === 'number' ? d.count : 0;
    const baseWeighted = typeof d.weightedCount === 'number' ? d.weightedCount : baseCount;
    const weight = baseCount > 0 ? baseWeighted / baseCount : 1;
    setEditManualWeight(Number.isFinite(weight) ? Number(weight.toFixed(2)) : 1);
    setEditManualContext(getManualContextText(d));
  };

  const cancelEditManual = () => {
    setEditingManualHex(null);
  };

  const saveEditManual = () => {
    const hex = editingManualHex;
    if (!hex) return;

    const count = Math.max(0, Number.parseInt(String(editManualCount || 0), 10) || 0);
    const weight = Number.isFinite(Number(editManualWeight)) ? Number(editManualWeight) : 1;
    const weightedCount = (Number.isFinite(count) ? count : 0) * (Number.isFinite(weight) ? weight : 1);
    const contexts = String(editManualContext || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    setData((prev) => {
      const idx = prev.findIndex((d) => d && d.hex === hex);
      if (idx === -1) return prev;
      const existing = prev[idx];
      if (!isManualRow(existing)) return prev;

      const existingUsage = Array.isArray(existing.cssUsage) ? existing.cssUsage : [];
      const preserved = existingUsage.filter((u) => !(u && u.kind === 'manual' && u.file === '(manual)'));
      const manualUsage = contexts.map((ctx) => ({
        file: '(manual)',
        line: null,
        column: null,
        selector: null,
        context: ctx,
        property: null,
        value: null,
        kind: 'manual',
        token: null,
        variable: null
      }));

      const next = prev.slice();
      next[idx] = {
        ...existing,
        count,
        weightedCount,
        cssUsage: preserved.concat(manualUsage)
      };
      return recomputeRanks(next);
    });

    setEditingManualHex(null);
  };

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

    if (hueBandEnabled) {
      const center = ((hueBandCenter % 360) + 360) % 360;
      const half = Math.max(0, Number(hueBandWidth) || 0) / 2;
      currentData = currentData.filter((d) => {
        const h = Number.isFinite(d?.hsl?.h) ? d.hsl.h : 0;
        let diff = Math.abs(h - center);
        if (diff > 180) diff = 360 - diff;
        return diff <= half;
      });
    }

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
  }, [data, deferredTopX, deferredCoalesceThreshold, deferredPreservePopularStrength, useAdvancedClustering, hueBandEnabled, hueBandCenter, hueBandWidth]);

  const jsonForView = useMemo(() => {
    const MAX_ROWS = 200;
    if (dataView === 'raw') {
      return {
        meta: { total: data.length, showing: Math.min(data.length, MAX_ROWS) },
        colors: data.slice(0, MAX_ROWS)
      };
    }
    if (dataView === 'selected') {
      const selected = Array.from(selectedColors).map((hex) => {
        const colorData = data.find((d) => d.hex === hex) || filteredData.find((d) => d.hex === hex);
        return colorData || { hex };
      });
      return {
        meta: { total: selectedColors.size, showing: selected.length },
        colors: selected
      };
    }
    return {
      meta: { total: filteredData.length, showing: Math.min(filteredData.length, MAX_ROWS) },
      colors: filteredData.slice(0, MAX_ROWS)
    };
  }, [dataView, data, filteredData, selectedColors]);

  const contextUsage = useMemo(() => {
    const rows = [];
    for (const c of filteredData || []) {
      const cssUsage = Array.isArray(c?.cssUsage) ? c.cssUsage : [];
      for (const u of cssUsage) {
        if (!u) continue;
        const selector = u.selector || null;
        const file = u.file || '(unknown)';
        const ctx = u.context || null;
        const state = deriveState(selector, ctx);
        const variant = deriveVariant(selector, ctx);
        const object = deriveObject(selector, ctx, file);
        const slot = deriveSlotFromProperty(u.property);

        const inferred = !((object.value && object.explicit) || object.value === null) || (!slot.explicit && slot.value !== null);

        rows.push({
          hex: c.hex,
          weightedCount: c.weightedCount || 0,
          count: c.count || 0,
          file,
          selector,
          property: u.property || null,
          value: u.value || null,
          kind: u.kind || null,
          context: ctx,
          object,
          slot,
          variant,
          state,
          inferred
        });
      }
    }
    return rows;
  }, [filteredData]);

  const contextOptions = useMemo(() => {
    const objects = new Map();
    const variants = new Map();
    const states = new Map();
    for (const r of contextUsage) {
      if (r.object?.value) objects.set(r.object.value, true);
      if (r.variant?.value) variants.set(r.variant.value, true);
      if (r.state?.value) states.set(r.state.value, true);
    }
    const sortKeys = (m) => Array.from(m.keys()).sort((a, b) => a.localeCompare(b));
    const objectList = ['button', 'link', 'dialog', 'sidebar', 'highlight'].concat(sortKeys(objects).filter((k) => !['button', 'link', 'dialog', 'sidebar', 'highlight'].includes(k)));
    const variantList = ['default', 'primary', 'secondary', 'danger', 'success', 'warning', 'info'].concat(sortKeys(variants).filter((k) => !['default', 'primary', 'secondary', 'danger', 'success', 'warning', 'info'].includes(k)));
    const stateList = ['default', 'hover', 'active', 'focus', 'disabled', 'error', 'visited'].concat(sortKeys(states).filter((k) => !['default', 'hover', 'active', 'focus', 'disabled', 'error', 'visited'].includes(k)));
    return { objectList, variantList, stateList };
  }, [contextUsage]);

  const contextTokenPath = useMemo(() => {
    const o = contextObject || 'unknown';
    const s = contextSlot || 'unknown';
    const v = contextVariant || 'default';
    const st = contextState || 'default';
    return `${o}.${s}.${v}.${st}`;
  }, [contextObject, contextSlot, contextVariant, contextState]);

  const contextCandidates = useMemo(() => {
    const wantObject = contextObject;
    const wantSlot = contextSlot;
    const wantVariant = contextVariant;
    const wantState = contextState;

    const matches = contextUsage.filter((r) => {
      const objectOk = wantObject ? (r.object?.value === wantObject) : true;
      const slotOk = wantSlot ? (r.slot?.value === wantSlot) : true;
      const variantOk = wantVariant ? (r.variant?.value === wantVariant) : true;
      const stateOk = wantState ? (r.state?.value === wantState) : true;

      if (!(objectOk && slotOk && variantOk && stateOk)) return false;

      if (!allowInferredContexts) {
        const objectExplicitOk = wantObject ? (r.object?.explicit === true) : true;
        const slotExplicitOk = wantSlot ? (r.slot?.explicit === true) : true;
        const variantExplicitOk = wantVariant && wantVariant !== 'default' ? (r.variant?.explicit === true) : true;
        const stateExplicitOk = wantState && wantState !== 'default' ? (r.state?.explicit === true) : true;
        if (!(objectExplicitOk && slotExplicitOk && variantExplicitOk && stateExplicitOk)) return false;
      }

      return true;
    });

    const byHex = new Map();
    for (const m of matches) {
      const existing = byHex.get(m.hex);
      if (!existing) {
        byHex.set(m.hex, {
          hex: m.hex,
          matchCount: 1,
          weightedCount: m.weightedCount || 0,
          count: m.count || 0,
          files: new Map([[m.file, 1]]),
          selectors: new Map([[m.selector || '(no selector)', 1]]),
          samples: [m]
        });
      } else {
        existing.matchCount += 1;
        existing.files.set(m.file, (existing.files.get(m.file) || 0) + 1);
        const selKey = m.selector || '(no selector)';
        existing.selectors.set(selKey, (existing.selectors.get(selKey) || 0) + 1);
        if (existing.samples.length < 20) existing.samples.push(m);
      }
    }

    const surface = SURFACES[contextSurface] || SURFACES.page;
    const surfaceBg = surface?.bg || '#FFFFFF';

    const out = Array.from(byHex.values()).map((v) => {
      const ratio = safeContrastRatio(v.hex, surfaceBg);
      return {
        ...v,
        contrast: ratio,
        aa: typeof ratio === 'number' ? ratio >= 4.5 : null,
        surfaceBg
      };
    });

    const score = (v) => (v.matchCount * 1000) + (v.weightedCount || 0);
    out.sort((a, b) => score(b) - score(a));
    return out.slice(0, 30);
  }, [contextUsage, contextObject, contextSlot, contextVariant, contextState, allowInferredContexts, contextSurface]);

  const buildDtcgColorTokens = (colors) => {
    const out = { color: {} };
    for (const c of colors || []) {
      const key = `color-${String(c.hex || '').replace('#', '').toUpperCase()}`;
      out.color[key] = {
        $type: 'color',
        $value: c.hex,
        $extensions: {
          'color-visualizer': {
            rank: c.rank ?? c.Rank ?? null,
            usageCount: typeof c.count === 'number' ? c.count : null,
            weightedCount: typeof c.weightedCount === 'number' ? c.weightedCount : null,
            evidenceCount: Array.isArray(c.cssUsage) ? c.cssUsage.length : 0
          }
        }
      };
    }
    return out;
  };

  const jsonTokensForView = useMemo(() => {
    const colors = jsonForView?.colors || [];
    if (tokenExportFormat === 'dtcg') return buildDtcgColorTokens(colors);

    // Default token-ish export (legacy/simple)
    return (colors || []).map((c) => ({
      hex: c.hex,
      name: `color-${String(c.hex || '').replace('#', '')}`,
      usageCount: c?.count || 0,
      accessibility: c?.accessibility
    }));
  }, [jsonForView, tokenExportFormat]);

  const jsonText = useMemo(() => {
    if (jsonOutputMode === 'tokens') return JSON.stringify(jsonTokensForView, null, 2);
    return JSON.stringify(jsonForView, null, 2);
  }, [jsonForView, jsonTokensForView, jsonOutputMode]);

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(jsonText);
    } catch {
      return;
    }
  };

  const downloadJson = () => {
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    if (jsonOutputMode === 'tokens') {
      a.download = tokenExportFormat === 'dtcg' ? `tokens-dtcg-${dataView}.json` : `tokens-${dataView}.json`;
    } else {
      a.download = `colors-${dataView}.json`;
    }
    a.click();
    URL.revokeObjectURL(url);
  };

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

  const selectFromChart = (hex) => {
    if (!collectMode) return;
    toggleColorSelection(hex);
  };

  const exportTokens = () => {
    const selected = Array.from(selectedColors).map((hex) => {
      const colorData = data.find((d) => d.hex === hex) || filteredData.find((d) => d.hex === hex);
      return colorData || { hex };
    });

    const payload = tokenExportFormat === 'dtcg'
      ? buildDtcgColorTokens(selected)
      : selected.map((c) => ({
        hex: c.hex,
        name: `color-${String(c.hex || '').replace('#', '')}`,
        usageCount: c?.count || 0,
        accessibility: c?.accessibility
      }));

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = tokenExportFormat === 'dtcg' ? 'design-tokens-dtcg.json' : 'design-tokens.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearSelection = () => setSelectedColors(new Set());

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
    <div className={`${isEmbed ? 'p-2 max-w-none' : 'p-6 max-w-6xl'} mx-auto font-sans`}>
      {!isEmbed && (
        <header className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Color Usage</h1>
        </header>
      )}

      {/* Toolbox */}
      <div className={`mb-3 rounded-lg border border-gray-200 bg-white ${isEmbed ? 'p-2' : 'p-3'}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
                <button 
                    onClick={() => setViewMode('voronoi')}
                    className={`py-1.5 px-2.5 text-sm rounded-md font-medium transition-all ${
                        viewMode === 'voronoi' 
                            ? 'bg-white text-blue-600 shadow-sm' 
                            : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                    Stained Glass
                </button>
                <button 
                    onClick={() => setViewMode('scatter')}
                    className={`py-1.5 px-2.5 text-sm rounded-md font-medium transition-all ${
                        viewMode === 'scatter' 
                            ? 'bg-white text-blue-600 shadow-sm' 
                            : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                    Scatter
                </button>
                <button 
                    onClick={() => setViewMode('oklch')}
                    className={`py-1.5 px-2.5 text-sm rounded-md font-medium transition-all ${
                        viewMode === 'oklch' 
                            ? 'bg-white text-blue-600 shadow-sm' 
                            : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                    OKLCH
                </button>
                {!isEmbed && (
                  <button 
                      onClick={() => setViewMode('data')}
                      className={`py-1.5 px-2.5 text-sm rounded-md font-medium transition-all ${
                          viewMode === 'data' 
                              ? 'bg-white text-blue-600 shadow-sm' 
                              : 'text-gray-500 hover:text-gray-700'
                      }`}
                  >
                      Data
                  </button>
                )}
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Top</label>
              <select value={topX} onChange={(e) => setTopX(Number(e.target.value))} className="rounded-lg border border-gray-300 px-2 py-1 text-sm">
                {[25, 50, 100, 200, 300, 500].filter((n) => n >= 10 && n <= Math.min(500, data.length)).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
              <input type="checkbox" checked={showTour} onChange={(e) => setShowTour(e.target.checked)} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              <span className="font-medium">Guided tour</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
              <input type="checkbox" checked={showAdvancedToolbox} onChange={(e) => setShowAdvancedToolbox(e.target.checked)} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              <span className="font-medium">Advanced</span>
            </label>

            {viewMode === 'oklch' && (
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Slice</label>
                <select value={oklchSlice} onChange={(e) => setOklchSlice(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1 text-sm">
                  <option value="l-c">L vs C</option>
                  <option value="h-l">H vs L</option>
                  <option value="h-c">H vs C</option>
                </select>
              </div>
            )}
          </div>

          {isEmbed && (
            <a href={fullAppHref} className="text-sm text-blue-700 hover:text-blue-900 underline">Open full app</a>
          )}
        </div>

        {showAdvancedToolbox && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useAdvancedClustering}
                  onChange={(e) => setUseAdvancedClustering(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm font-semibold text-gray-800">DBSCAN clustering</span>
              </label>
              <div className="mt-1 text-xs text-gray-500">Better spatial grouping of colors</div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <label className="block text-sm font-semibold text-gray-800">Coalesce threshold: {coalesceThreshold}</label>
              <div className="mt-1 text-xs text-gray-500">Group nearby colors</div>
              <input
                type="range"
                min="0"
                max="0.5"
                step="0.01"
                value={coalesceThreshold}
                onChange={(e) => setCoalesceThreshold(Number(e.target.value))}
                className="w-full mt-2"
              />
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <label className="block text-sm font-semibold text-gray-800">Preserve popular: {preservePopularStrength}</label>
              <div className="mt-1 text-xs text-gray-500">High-usage colors resist merging</div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={preservePopularStrength}
                onChange={(e) => setPreservePopularStrength(Number(e.target.value))}
                className="w-full mt-2"
              />
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <label className="block text-sm font-semibold text-gray-800">Radial metric</label>
              <select value={radialMetric} onChange={(e) => setRadialMetric(e.target.value)} className="w-full mt-2 rounded-lg border border-gray-300 px-2 py-2 text-sm">
                <option value="saturation">Saturation</option>
                <option value="lightness">Lightness</option>
              </select>
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 sm:col-span-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={hueBandEnabled} onChange={(e) => setHueBandEnabled(e.target.checked)} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                <span className="text-sm font-semibold text-gray-800">Hue band filter</span>
              </label>
              <div className="mt-1 text-xs text-gray-500">Slice by hue (useful for lightness analysis)</div>
              {hueBandEnabled && (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Center: {Math.round(hueBandCenter)}°</label>
                    <input type="range" min="0" max="360" step="1" value={hueBandCenter} onChange={(e) => setHueBandCenter(Number(e.target.value))} className="w-full" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Width: {Math.round(hueBandWidth)}°</label>
                    <input type="range" min="1" max="60" step="1" value={hueBandWidth} onChange={(e) => setHueBandWidth(Number(e.target.value))} className="w-full" />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Visualization Area */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100">
        <div ref={vizContainerRef} className={`relative min-h-[600px] ${viewMode === 'data' ? 'p-4' : 'p-6'} flex items-center justify-center`}>
            {viewMode === 'data' ? (
                <div className="w-full">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                        <div className="flex gap-2 p-1 bg-gray-100 rounded-lg">
                            <button
                                type="button"
                                onClick={() => setDataView('filtered')}
                                className={`py-2 px-3 text-sm rounded-md font-medium transition-all ${
                                    dataView === 'filtered' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                                }`}
                            >
                                Filtered
                            </button>
                            <button
                                type="button"
                                onClick={() => setDataView('raw')}
                                className={`py-2 px-3 text-sm rounded-md font-medium transition-all ${
                                    dataView === 'raw' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                                }`}
                            >
                                Raw
                            </button>
                            <button
                                type="button"
                                onClick={() => setDataView('selected')}
                                className={`py-2 px-3 text-sm rounded-md font-medium transition-all ${
                                    dataView === 'selected' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                                }`}
                            >
                                Selected
                            </button>
                        </div>

                        <div className="flex gap-2 p-1 bg-gray-100 rounded-lg">
                            <button
                                type="button"
                                onClick={() => setDataSubView('table')}
                                className={`py-2 px-3 text-sm rounded-md font-medium transition-all ${
                                    dataSubView === 'table' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                                }`}
                            >
                                Table
                            </button>
                            <button
                                type="button"
                                onClick={() => setDataSubView('tree')}
                                className={`py-2 px-3 text-sm rounded-md font-medium transition-all ${
                                    dataSubView === 'tree' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                                }`}
                            >
                                Usage tree
                            </button>
                            <button
                                type="button"
                                onClick={() => setDataSubView('json')}
                                className={`py-2 px-3 text-sm rounded-md font-medium transition-all ${
                                    dataSubView === 'json' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                                }`}
                            >
                                JSON
                            </button>
                            <button
                                type="button"
                                onClick={() => setDataSubView('context')}
                                className={`py-2 px-3 text-sm rounded-md font-medium transition-all ${
                                    dataSubView === 'context' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                                }`}
                            >
                                Context
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
                        <div className="xl:col-span-2">
                            {dataSubView === 'table' && (
                                <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                                    <div className="px-3 py-2 border-b border-gray-200 text-xs font-semibold uppercase tracking-wider text-gray-500">
                                        Colors ({jsonForView.meta.showing} shown)
                                    </div>
                                    <div className="overflow-auto max-h-[620px]">
                                        <table className="w-full text-sm">
                                            <thead className="sticky top-0 bg-white border-b border-gray-200">
                                                <tr>
                                                    <th scope="col" className="text-left px-3 py-2">Color</th>
                                                    <th scope="col" className="text-left px-3 py-2">Hex</th>
                                                    <th scope="col" className="text-right px-3 py-2">Rank</th>
                                                    <th scope="col" className="text-right px-3 py-2">Count</th>
                                                    <th scope="col" className="text-right px-3 py-2">Weighted</th>
                                                    <th scope="col" className="text-right px-3 py-2">Evidence</th>
                                                    <th scope="col" className="text-right px-3 py-2">Select</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {jsonForView.colors.map((d) => {
                                                    const evidence = Array.isArray(d.cssUsage) ? d.cssUsage.length : 0;
                                                    const selected = selectedColors.has(d.hex);
                                                    return (
                                                        <tr key={d.hex} className="border-b border-gray-100">
                                                            <td className="px-3 py-2">
                                                                <div className="w-6 h-6 rounded border border-gray-300" style={{ backgroundColor: d.hex }} />
                                                            </td>
                                                            <td className="px-3 py-2 font-mono">{d.hex}</td>
                                                            <td className="px-3 py-2 text-right text-gray-600">{d.rank ?? ''}</td>
                                                            <td className="px-3 py-2 text-right text-gray-600">{typeof d.count === 'number' ? d.count : ''}</td>
                                                            <td className="px-3 py-2 text-right text-gray-600">{typeof d.weightedCount === 'number' ? d.weightedCount : ''}</td>
                                                            <td className="px-3 py-2 text-right text-gray-600">{evidence}</td>
                                                            <td className="px-3 py-2 text-right">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => toggleColorSelection(d.hex)}
                                                                    className={`px-2 py-1 rounded-md text-xs font-semibold ${selected ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                                                                >
                                                                    {selected ? 'Selected' : 'Select'}
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="px-3 py-3 border-t border-gray-200">
                                        <details>
                                            <summary className="cursor-pointer text-sm font-medium text-gray-700">Edit manual rows</summary>
                                            <div className="mt-3 space-y-3 text-sm text-gray-700">
                                                <div className="text-xs text-gray-500">
                                                    Manual rows are the ones you added in this session. Use the form on the right to add more.
                                                </div>
                                                {jsonForView.colors.filter(isManualRow).length === 0 ? (
                                                    <div className="text-sm text-gray-500">No manual rows in the current view.</div>
                                                ) : (
                                                    <div className="space-y-3">
                                                        {jsonForView.colors.filter(isManualRow).map((d) => (
                                                            <div key={d.hex} className="rounded-lg border border-gray-200 p-3">
                                                                <div className="flex items-center justify-between gap-3">
                                                                    <div className="flex items-center gap-3">
                                                                        <div className="w-6 h-6 rounded border border-gray-300" style={{ backgroundColor: d.hex }} />
                                                                        <div className="font-mono font-semibold">{d.hex}</div>
                                                                    </div>
                                                                    {editingManualHex === d.hex ? (
                                                                        <div className="flex gap-2">
                                                                            <button type="button" onClick={saveEditManual} className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">Save</button>
                                                                            <button type="button" onClick={cancelEditManual} className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200">Cancel</button>
                                                                        </div>
                                                                    ) : (
                                                                        <button type="button" onClick={() => beginEditManual(d)} className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200">Edit</button>
                                                                    )}
                                                                </div>

                                                                {editingManualHex === d.hex && (
                                                                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                                                                        <div>
                                                                            <label className="block text-sm font-medium text-gray-700 mb-1">Count</label>
                                                                            <input type="number" min="0" value={editManualCount} onChange={(e) => setEditManualCount(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                                                                        </div>
                                                                        <div>
                                                                            <label className="block text-sm font-medium text-gray-700 mb-1">Weight</label>
                                                                            <input type="number" min="0" step="0.1" value={editManualWeight} onChange={(e) => setEditManualWeight(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                                                                        </div>
                                                                        <div className="sm:col-span-3">
                                                                            <label className="block text-sm font-medium text-gray-700 mb-1">Context (one per line)</label>
                                                                            <textarea value={editManualContext} onChange={(e) => setEditManualContext(e.target.value)} rows={4} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </details>
                                    </div>
                                </div>
                            )}

                            {dataSubView === 'tree' && (
                                <UsageTree colors={jsonForView.colors} />
                            )}

                            {dataSubView === 'json' && (
                                <div className="rounded-lg border border-gray-200 bg-gray-50 overflow-hidden">
                                    <div className="px-3 py-2 border-b border-gray-200 text-xs font-semibold uppercase tracking-wider text-gray-500 flex flex-wrap items-center justify-between gap-2">
                                        <span>JSON preview</span>
                                        <div className="flex items-center gap-2">
                                            <div className="flex gap-1 p-1 bg-white rounded-md border border-gray-200">
                                                <button type="button" onClick={() => setJsonOutputMode('dataset')} className={`px-2 py-1 text-xs rounded ${jsonOutputMode === 'dataset' ? 'bg-gray-100 text-gray-800' : 'text-gray-600 hover:text-gray-800'}`}>Dataset</button>
                                                <button type="button" onClick={() => setJsonOutputMode('tokens')} className={`px-2 py-1 text-xs rounded ${jsonOutputMode === 'tokens' ? 'bg-gray-100 text-gray-800' : 'text-gray-600 hover:text-gray-800'}`}>Tokens</button>
                                            </div>
                                            {jsonOutputMode === 'tokens' && (
                                                <div className="flex gap-1 p-1 bg-white rounded-md border border-gray-200">
                                                    <button type="button" onClick={() => setTokenExportFormat('simple')} className={`px-2 py-1 text-xs rounded ${tokenExportFormat === 'simple' ? 'bg-gray-100 text-gray-800' : 'text-gray-600 hover:text-gray-800'}`}>Simple</button>
                                                    <button type="button" onClick={() => setTokenExportFormat('dtcg')} className={`px-2 py-1 text-xs rounded ${tokenExportFormat === 'dtcg' ? 'bg-gray-100 text-gray-800' : 'text-gray-600 hover:text-gray-800'}`}>Spec</button>
                                                </div>
                                            )}
                                            <div className="flex gap-2">
                                                <button type="button" onClick={copyJson} className="py-1 px-2 text-xs rounded-md bg-white border border-gray-200 text-gray-700 hover:bg-gray-50">Copy</button>
                                                <button type="button" onClick={downloadJson} className="py-1 px-2 text-xs rounded-md bg-white border border-gray-200 text-gray-700 hover:bg-gray-50">Download</button>
                                            </div>
                                        </div>
                                    </div>
                                    <pre className="p-3 text-xs overflow-auto max-h-[620px] whitespace-pre-wrap break-words">{jsonText}</pre>
                                </div>
                            )}

                            {dataSubView === 'context' && (
                                <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                                    <div className="px-3 py-2 border-b border-gray-200 text-xs font-semibold uppercase tracking-wider text-gray-500">
                                        Context Finder
                                    </div>
                                    <div className="p-3 space-y-4">
                                        <div className="text-sm text-gray-700">
                                            Pick a UI context. The tool ranks colors by evidence in CSS usage (default evidence is file + selector).
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 items-end">
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1">Object</label>
                                                <select value={contextObject} onChange={(e) => setContextObject(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                                                    {contextOptions.objectList.map((o) => (
                                                        <option key={o} value={o}>{o}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1">Slot</label>
                                                <select value={contextSlot} onChange={(e) => setContextSlot(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                                                    <option value="bg">bg</option>
                                                    <option value="fg">fg</option>
                                                    <option value="border">border</option>
                                                    <option value="icon">icon</option>
                                                    <option value="shadow">shadow</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1">Variant</label>
                                                <select value={contextVariant} onChange={(e) => setContextVariant(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                                                    {contextOptions.variantList.map((v) => (
                                                        <option key={v} value={v}>{v}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                                                <select value={contextState} onChange={(e) => setContextState(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                                                    {contextOptions.stateList.map((s) => (
                                                        <option key={s} value={s}>{s}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1">Surface</label>
                                                <select value={contextSurface} onChange={(e) => setContextSurface(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                                                    {Object.entries(SURFACES).map(([k, v]) => (
                                                        <option key={k} value={k}>{v.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <label className="flex items-center gap-2 text-sm text-gray-700">
                                                    <input type="checkbox" checked={allowInferredContexts} onChange={(e) => setAllowInferredContexts(e.target.checked)} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                                                    Allow inferred
                                                </label>
                                                <select value={evidenceDetail} onChange={(e) => setEvidenceDetail(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
                                                    <option value="file+selector">Evidence: file + selector</option>
                                                    <option value="full">Evidence: include property/value</option>
                                                </select>
                                            </div>
                                        </div>

                                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                                            <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Token path</div>
                                            <div className="mt-1 font-mono text-sm text-gray-900">{contextTokenPath}</div>
                                        </div>

                                        <div className="rounded-lg border border-gray-200 overflow-hidden">
                                            <div className="px-3 py-2 border-b border-gray-200 text-xs font-semibold uppercase tracking-wider text-gray-500">
                                                Recommended colors
                                            </div>
                                            {contextCandidates.length === 0 ? (
                                                <div className="p-3 text-sm text-gray-600">No matching evidence for that context in the current filtered dataset.</div>
                                            ) : (
                                                <div className="overflow-auto max-h-[520px]">
                                                    <table className="w-full text-sm">
                                                        <thead className="sticky top-0 bg-white border-b border-gray-200">
                                                            <tr>
                                                                <th scope="col" className="text-left px-3 py-2">Color</th>
                                                                <th scope="col" className="text-left px-3 py-2">Hex</th>
                                                                <th scope="col" className="text-right px-3 py-2">Matches</th>
                                                                <th scope="col" className="text-right px-3 py-2">Weighted</th>
                                                                <th scope="col" className="text-right px-3 py-2">Contrast</th>
                                                                <th scope="col" className="text-right px-3 py-2">Select</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {contextCandidates.map((c) => {
                                                                const selected = selectedColors.has(c.hex);
                                                                return (
                                                                    <tr key={c.hex} className="border-b border-gray-100">
                                                                        <td className="px-3 py-2">
                                                                            <div className="w-6 h-6 rounded border border-gray-300" style={{ backgroundColor: c.hex }} />
                                                                        </td>
                                                                        <td className="px-3 py-2 font-mono">{c.hex}</td>
                                                                        <td className="px-3 py-2 text-right text-gray-700">{c.matchCount}</td>
                                                                        <td className="px-3 py-2 text-right text-gray-600">{Math.round(c.weightedCount || 0)}</td>
                                                                        <td className="px-3 py-2 text-right text-gray-600">
                                                                            {typeof c.contrast === 'number' ? (
                                                                                <span className={c.aa ? 'text-green-700 font-semibold' : 'text-red-700 font-semibold'}>{c.contrast.toFixed(2)}</span>
                                                                            ) : (
                                                                                ''
                                                                            )}
                                                                        </td>
                                                                        <td className="px-3 py-2 text-right">
                                                                            <button type="button" onClick={() => toggleColorSelection(c.hex)} className={`px-2 py-1 rounded-md text-xs font-semibold ${selected ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>{selected ? 'Selected' : 'Select'}</button>
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            )}
                                        </div>

                                        <details className="rounded-lg border border-gray-200">
                                            <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-gray-800">Evidence (top)</summary>
                                            <div className="p-3 space-y-3">
                                                {contextCandidates.slice(0, 5).map((c) => {
                                                    const topFiles = Array.from(c.files.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
                                                    const topSelectors = Array.from(c.selectors.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
                                                    return (
                                                        <div key={`ev-${c.hex}`} className="rounded-md border border-gray-200 bg-gray-50 p-3">
                                                            <div className="flex items-center gap-3">
                                                                <div className="w-4 h-4 rounded border border-gray-300" style={{ backgroundColor: c.hex }} />
                                                                <div className="font-mono text-sm font-semibold">{c.hex}</div>
                                                                <div className="text-xs text-gray-500">{c.matchCount} matches</div>
                                                            </div>
                                                            <div className="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-3">
                                                                <div>
                                                                    <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Files</div>
                                                                    <div className="mt-1 space-y-1">
                                                                        {topFiles.map(([f, n]) => (
                                                                            <div key={f} className="text-xs text-gray-700 flex items-center justify-between gap-2">
                                                                                <span className="truncate">{f}</span>
                                                                                <span className="text-gray-500">{n}</span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                                <div>
                                                                    <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Selectors</div>
                                                                    <div className="mt-1 space-y-1">
                                                                        {topSelectors.map(([s, n]) => (
                                                                            <div key={s} className="text-xs text-gray-700 flex items-center justify-between gap-2">
                                                                                <span className="truncate">{s}</span>
                                                                                <span className="text-gray-500">{n}</span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            {evidenceDetail === 'full' && (
                                                                <div className="mt-3">
                                                                    <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Samples</div>
                                                                    <div className="mt-1 space-y-1">
                                                                        {c.samples.slice(0, 5).map((s, idx) => (
                                                                            <div key={`${c.hex}-s-${idx}`} className="text-xs text-gray-700">
                                                                                <span className="font-mono">{s.file}</span>{s.selector ? ` — ${s.selector}` : ''}{s.property ? ` — ${s.property}` : ''}{s.value ? `: ${s.value}` : ''}
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </details>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                            <div className="px-3 py-2 border-b border-gray-200 text-xs font-semibold uppercase tracking-wider text-gray-500">
                                Add color
                            </div>
                            <div className="p-3 space-y-3">
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
                                        <input type="text" value={manualHex} onChange={(e) => setManualHex(e.target.value)} placeholder="#3366CC" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Count</label>
                                        <input type="number" min="0" value={manualCount} onChange={(e) => setManualCount(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Weight</label>
                                        <input type="number" step="0.1" min="0" value={manualWeight} onChange={(e) => setManualWeight(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Context (one per line)</label>
                                    <textarea value={manualContext} onChange={(e) => setManualContext(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" rows={4} placeholder={"Button primary\nLink hover\nAlert background"} />
                                </div>

                                {manualError && (
                                    <div className="text-sm text-red-600">{manualError}</div>
                                )}

                                <div className="flex items-center justify-between gap-3">
                                    <div className="text-xs text-gray-500">Adds to dataset and updates ranks immediately.</div>
                                    <button type="button" onClick={addManualColor} className="py-2 px-4 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors">Add</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <>
                    {viewMode === 'oklch' ? (
                      <OklchSlices
                        data={filteredData}
                        size={wheelSize}
                        slice={oklchSlice}
                        onHover={handleHover}
                        selectedColors={selectedColors}
                        onSelect={selectFromChart}
                      />
                    ) : (
                      <ColorWheel 
                          data={filteredData} 
                          size={wheelSize}
                          viewMode={viewMode} 
                          radialMetric={radialMetric}
                          showTour={showTour}
                          onHover={handleHover} 
                          selectedColors={selectedColors}
                          onSelect={selectFromChart}
                      />
                    )}

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
                    {hoveredColor.hsl && (
                        <div className="text-xs text-gray-500 mt-1">
                            Hue {Math.round(hoveredColor.hsl.h)}° · Sat {Math.round((hoveredColor.hsl.s || 0) * 100)}% · Light {Math.round((hoveredColor.hsl.l || 0) * 100)}%
                        </div>
                    )}
                    {typeof hoveredColor.count === 'number' && (
                        <div className="text-sm text-gray-600">Count (raw): {hoveredColor.count}</div>
                    )}
                    {typeof hoveredColor.weightedCount === 'number' && (
                        <div className="text-sm text-gray-600">Usage (weighted): {hoveredColor.weightedCount}</div>
                    )}
                    {typeof hoveredColor.totalCount === 'number' && (
                        <div className="text-sm text-gray-600">Group total: {hoveredColor.totalCount}</div>
                    )}
                    {Array.isArray(hoveredColor.cssUsage) && (
                        <div className="text-xs text-gray-500 mt-1">Evidence: {hoveredColor.cssUsage.length} usage records</div>
                    )}
                    
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
                </>
            )}
        </div>

        {viewMode !== 'data' && (
          <div className="px-4 pb-4">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm font-semibold text-gray-800">Selected set</div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm text-gray-600">{selectedColors.size} selected</div>

                  <button
                    type="button"
                    onClick={() => setCollectMode((v) => !v)}
                    className={`px-3 py-2 rounded-lg border text-sm font-semibold transition-colors ${
                      collectMode
                        ? 'bg-blue-600 border-blue-600 text-white hover:bg-blue-700'
                        : 'bg-white border-gray-300 text-gray-800 hover:bg-gray-100'
                    }`}
                    aria-pressed={collectMode}
                  >
                    Collect: {collectMode ? 'On' : 'Off'}
                  </button>

                  <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setTokenExportFormat('simple')}
                      className={`py-1.5 px-2.5 text-sm rounded-md font-medium transition-all ${
                        tokenExportFormat === 'simple' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                      }`}
                      aria-pressed={tokenExportFormat === 'simple'}
                    >
                      Simple
                    </button>
                    <button
                      type="button"
                      onClick={() => setTokenExportFormat('dtcg')}
                      className={`py-1.5 px-2.5 text-sm rounded-md font-medium transition-all ${
                        tokenExportFormat === 'dtcg' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                      }`}
                      aria-pressed={tokenExportFormat === 'dtcg'}
                    >
                      Tokens spec
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={exportTokens}
                    disabled={selectedColors.size === 0}
                    className="flex items-center justify-center gap-2 py-2 px-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Export
                  </button>

                  {selectedColors.size > 0 && (
                    <button type="button" onClick={clearSelection} className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-100">
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {!collectMode && (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Collect is off. Turn it on to click colors into your set.
                </div>
              )}

              {selectedColors.size === 0 ? (
                <div className="mt-2 text-sm text-gray-600">Click a cell/dot to add it to your set.</div>
              ) : (
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                  {Array.from(selectedColors).map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => toggleColorSelection(hex)}
                      className="flex-shrink-0 rounded-lg border border-gray-200 bg-white px-2 py-2 hover:bg-gray-50"
                      aria-label={`Remove ${hex} from selected set`}
                      title="Remove from set"
                    >
                      <div className="flex items-center gap-2">
                        <span className="inline-block h-8 w-8 rounded border border-gray-300" style={{ backgroundColor: hex }} />
                        <span className="font-mono text-sm font-semibold text-gray-900">{hex}</span>
                        <span className="text-gray-500 text-sm">×</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

    </div>
  );
};

const UsageTree = React.memo(({ colors }) => {
  const usageRows = useMemo(() => {
    const rows = [];
    for (const c of colors || []) {
      const cssUsage = Array.isArray(c?.cssUsage) ? c.cssUsage : [];
      for (const u of cssUsage) {
        if (!u) continue;
        rows.push({
          hex: c.hex,
          file: u.file || '(unknown)',
          line: typeof u.line === 'number' ? u.line : null,
          column: typeof u.column === 'number' ? u.column : null,
          selector: u.selector || null,
          context: u.context || null,
          property: u.property || null,
          value: u.value || null,
          kind: u.kind || null,
          variable: u.variable || null
        });
      }
    }
    return rows;
  }, [colors]);

  const groups = useMemo(() => {
    const makeGroup = () => new Map();

    const add = (map, key, row) => {
      if (!key) return;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { key, count: 1, rows: [row] });
      } else {
        existing.count += 1;
        if (existing.rows.length < 50) existing.rows.push(row);
      }
    };

    const byFile = makeGroup();
    const bySelector = makeGroup();
    const byProperty = makeGroup();
    const byKind = makeGroup();
    const byContext = makeGroup();

    for (const row of usageRows) {
      add(byFile, row.file || '(unknown)', row);
      add(bySelector, row.selector || '(no selector)', row);
      add(byProperty, row.property || '(no property)', row);
      add(byKind, row.kind || '(unknown kind)', row);
      if (row.context) add(byContext, row.context, row);
    }

    const sort = (map) => Array.from(map.values()).sort((a, b) => b.count - a.count);

    return {
      byFile: sort(byFile),
      bySelector: sort(bySelector),
      byProperty: sort(byProperty),
      byKind: sort(byKind),
      byContext: sort(byContext)
    };
  }, [usageRows]);

  const renderRows = (rows) => {
    const limited = (rows || []).slice(0, 20);
    return (
      <div className="mt-2 space-y-2">
        {limited.map((r, idx) => (
          <div key={`${r.hex}-${idx}-${r.file}-${r.line ?? 'x'}`} className="flex items-start justify-between gap-3 rounded-md border border-gray-200 bg-white p-2">
            <div className="flex items-start gap-3">
              <div className="w-4 h-4 rounded border border-gray-300 mt-0.5" style={{ backgroundColor: r.hex }} />
              <div>
                <div className="font-mono text-xs font-semibold text-gray-900">{r.hex}</div>
                <div className="text-xs text-gray-600">
                  {r.file}{typeof r.line === 'number' ? `:${r.line}` : ''}
                </div>
                {r.selector && (
                  <div className="text-xs text-gray-600 break-words">{r.selector}</div>
                )}
                {r.property && (
                  <div className="text-xs text-gray-500 break-words">
                    {r.property}{r.value ? `: ${r.value}` : ''}
                  </div>
                )}
              </div>
            </div>
            <div className="text-[11px] text-gray-500 text-right">
              {r.kind || ''}
              {r.variable ? `\n${r.variable}` : ''}
            </div>
          </div>
        ))}
        {rows.length > limited.length && (
          <div className="text-xs text-gray-500">Showing {limited.length} of {rows.length} samples</div>
        )}
      </div>
    );
  };

  const renderGroupList = (title, items) => {
    const top = (items || []).slice(0, 25);
    return (
      <details className="rounded-lg border border-gray-200 bg-white">
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-gray-800">{title}</summary>
        <div className="px-3 pb-3">
          {top.length === 0 ? (
            <div className="text-sm text-gray-500">No records.</div>
          ) : (
            <div className="space-y-2">
              {top.map((g) => (
                <details key={g.key} className="rounded-md border border-gray-200 bg-gray-50">
                  <summary className="cursor-pointer select-none px-3 py-2 text-sm text-gray-700">
                    <span className="font-medium">{g.key}</span>
                    <span className="text-xs text-gray-500"> ({g.count})</span>
                  </summary>
                  <div className="px-3 pb-3">
                    {renderRows(g.rows)}
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      </details>
    );
  };

  if (usageRows.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
        No usage evidence is available for the current dataset.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
        This view groups individual usage records (from <span className="font-mono">cssUsage</span>) so you can see where colors come from.
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {renderGroupList('Files', groups.byFile)}
        {renderGroupList('Selectors', groups.bySelector)}
        {renderGroupList('Properties', groups.byProperty)}
        {renderGroupList('Kinds', groups.byKind)}
        {renderGroupList('Contexts', groups.byContext)}
      </div>
    </div>
  );
});

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

const ColorWheel = React.memo(({ data, viewMode, radialMetric, showTour, onHover, selectedColors, onSelect, size }) => {
    const width = Number.isFinite(size) ? size : 600;
    const height = Number.isFinite(size) ? size : 600;
    const radius = Math.min(width, height) / 2;
    const innerRadius = radius - 20;

    const handleFocus = (p, e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onHover(p, { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
    };

    const handleKeyDown = (p, e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(p.hex);
        }
    };

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
            const l = c.l;
            const radial = radialMetric === 'lightness' ? l : s;
            const angle = (h - 90) * (Math.PI / 180);
            const r = xScale(radial);
            
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
    }, [data, xScale, radialMetric]);

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
            preserveAspectRatio="xMidYMid meet"
            onMouseLeave={() => onHover(null)}
        >
            <g transform={`translate(${width/2}, ${height/2})`}>
                
                {/* Defs for gradients */}
                <defs>
                    <radialGradient id="wheelGradient">
                         <stop offset="0%" stopColor="#888" stopOpacity="0.1" />
                         <stop offset="100%" stopColor="#888" stopOpacity="0" />
                    </radialGradient>
                    <marker id="tourArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="#111827" />
                    </marker>
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

                {showTour && viewMode !== 'data' && (
                  <g pointerEvents="none">
                    <path
                      d={d3.arc()({
                        innerRadius: innerRadius + 6,
                        outerRadius: innerRadius + 6,
                        startAngle: (-90) * (Math.PI / 180),
                        endAngle: (-10) * (Math.PI / 180)
                      })}
                      fill="none"
                      stroke="#111827"
                      strokeWidth={3}
                      markerEnd="url(#tourArrow)"
                      opacity={0.9}
                    />
                    <text x={innerRadius * 0.6} y={-(innerRadius - 18)} textAnchor="middle" className="fill-gray-900" fontSize={12}>
                      Hue = angle around
                    </text>

                    <line x1={0} y1={0} x2={innerRadius * 0.82} y2={0} stroke="#111827" strokeWidth={2} markerEnd="url(#tourArrow)" />
                    <text x={innerRadius * 0.48} y={-10} textAnchor="middle" className="fill-gray-900" fontSize={12}>
                      Radius = {radialMetric === 'lightness' ? 'lightness' : 'saturation'}
                    </text>
                    <text x={0} y={16} textAnchor="middle" className="fill-gray-700" fontSize={11}>
                      Center = {radialMetric === 'lightness' ? 'dark' : 'low sat'}
                    </text>
                    <text x={innerRadius} y={16} textAnchor="end" className="fill-gray-700" fontSize={11}>
                      Edge = {radialMetric === 'lightness' ? 'light' : 'high sat'}
                    </text>
                    {radialMetric === 'saturation' && (
                      <text x={0} y={innerRadius - 18} textAnchor="middle" className="fill-gray-700" fontSize={11}>
                        Lightness = light/dark of the fill
                      </text>
                    )}
                  </g>
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
                                    stroke="rgba(0,0,0,0.1)"
                                    strokeWidth={1}
                                    onMouseEnter={(e) => onHover(p, e)}
                                    onFocus={(e) => handleFocus(p, e)}
                                    onBlur={() => onHover(null)}
                                    onClick={() => onSelect(p.hex)}
                                    onKeyDown={(e) => handleKeyDown(p, e)}
                                    tabIndex={0}
                                    role="button"
                                    aria-pressed={selectedColors.has(p.hex)}
                                    aria-label={`${p.hex}. Count ${p.totalCount || p.weightedCount || p.count || 0}. ${p.members ? `Merged group size ${p.members.length}.` : ''}`}
                                    className="hover:opacity-90 transition-opacity cursor-pointer"
                                />
                            ))}

                            {/* Selection overlay: draw after cells so borders are always visible */}
                            {points.map((p, i) => {
                              if (!selectedColors.has(p.hex)) return null;
                              return (
                                <path
                                  key={`sel-${i}`}
                                  d={voronoiPath[i]}
                                  fill="none"
                                  stroke="#000"
                                  strokeWidth={4}
                                  strokeLinejoin="round"
                                  pointerEvents="none"
                                />
                              );
                            })}
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
                        onFocus={(e) => handleFocus(p, e)}
                        onBlur={() => onHover(null)}
                        onClick={() => onSelect(p.hex)}
                        onKeyDown={(e) => handleKeyDown(p, e)}
                        tabIndex={viewMode === 'voronoi' ? -1 : 0}
                        role="button"
                        aria-pressed={selectedColors.has(p.hex)}
                        aria-label={`${p.hex}. Count ${p.totalCount || p.weightedCount || p.count || 0}. ${p.members ? `Merged group size ${p.members.length}.` : ''}`}
                        pointerEvents={viewMode === 'voronoi' ? 'none' : 'all'} // Let Voronoi handle hover in that mode
                    />
                ))}

            </g>
        </svg>
    );
});

const OklchSlices = React.memo(({ data, size, slice, onHover, selectedColors, onSelect }) => {
  const width = Number.isFinite(size) ? size : 600;
  const height = Number.isFinite(size) ? size : 600;
  const pad = 44;

  const points = useMemo(() => {
    return (data || []).map((d, i) => {
      let L = 0;
      let C = 0;
      let H = 0;
      try {
        const ok = new Color(d.hex).to('oklch');
        const coords = Array.isArray(ok?.coords) ? ok.coords : [0, 0, 0];
        L = Number.isFinite(coords[0]) ? coords[0] : 0;
        C = Number.isFinite(coords[1]) ? coords[1] : 0;
        H = Number.isFinite(coords[2]) ? coords[2] : 0;
      } catch {
        // ignore
      }

      return {
        ...d,
        _oklch: { l: L, c: C, h: H },
        _idx: i
      };
    });
  }, [data]);

  const maxC = useMemo(() => {
    return d3.max(points, (p) => p?._oklch?.c) || 0.4;
  }, [points]);

  const xScale = useMemo(() => {
    if (slice === 'l-c') return d3.scaleLinear().domain([0, Math.max(0.01, maxC)]).range([pad, width - pad]);
    return d3.scaleLinear().domain([0, 360]).range([pad, width - pad]);
  }, [slice, maxC, width]);

  const yScale = useMemo(() => {
    if (slice === 'h-c') return d3.scaleLinear().domain([0, Math.max(0.01, maxC)]).range([height - pad, pad]);
    return d3.scaleLinear().domain([0, 1]).range([height - pad, pad]);
  }, [slice, maxC, height]);

  const axisLabels = useMemo(() => {
    if (slice === 'l-c') return { x: 'C', y: 'L' };
    if (slice === 'h-l') return { x: 'H', y: 'L' };
    return { x: 'H', y: 'C' };
  }, [slice]);

  const handleKeyDown = (p, e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(p.hex);
    }
  };

  const mapped = useMemo(() => {
    return points.map((p) => {
      const ok = p._oklch;
      const xVal = slice === 'l-c' ? ok.c : ok.h;
      const yVal = slice === 'h-c' ? ok.c : ok.l;
      return {
        ...p,
        x: xScale(xVal),
        y: yScale(yVal)
      };
    });
  }, [points, slice, xScale, yScale]);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      onMouseLeave={() => onHover(null)}
    >
      <rect x={0} y={0} width={width} height={height} fill="#fff" />
      <g>
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="#e5e7eb" />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="#e5e7eb" />

        <text x={width - pad} y={height - pad + 28} textAnchor="end" className="fill-gray-500" fontSize={12}>
          {axisLabels.x}
        </text>
        <text x={pad - 28} y={pad} textAnchor="start" className="fill-gray-500" fontSize={12}>
          {axisLabels.y}
        </text>

        {mapped.map((p) => (
          <circle
            key={p._idx}
            cx={p.x}
            cy={p.y}
            r={selectedColors.has(p.hex) ? 6 : 4}
            fill={p.hex}
            stroke={selectedColors.has(p.hex) ? '#000' : '#fff'}
            strokeWidth={selectedColors.has(p.hex) ? 2 : 1}
            className="cursor-pointer"
            onMouseEnter={(e) => onHover(p, e)}
            onFocus={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onHover(p, { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
            }}
            onBlur={() => onHover(null)}
            onClick={() => onSelect(p.hex)}
            onKeyDown={(e) => handleKeyDown(p, e)}
            tabIndex={0}
            role="button"
            aria-pressed={selectedColors.has(p.hex)}
            aria-label={`${p.hex}. OKLCH L ${Math.round((p._oklch.l || 0) * 100)}. C ${Math.round((p._oklch.c || 0) * 1000) / 1000}. H ${Math.round(p._oklch.h || 0)}.`}
          />
        ))}
      </g>
    </svg>
  );
});

export default ColorVisualizer;
