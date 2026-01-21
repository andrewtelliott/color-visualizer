# Color Usage Visualizer - Project Plan

## Objective
Create a web-based visualization tool to map colors from a CSV report onto a color wheel. The goal is to identify color clusters, analyze usage distribution, and generate design tokens for the Slate design system.

## Current Status
**Active Development** - Core visualization and performance optimization complete.

## Key Features
- **Dual Visualization Modes**:
  - **Scatter Plot**: Shows individual color points on a wheel, sized by usage frequency.
  - **Mosaic (Voronoi)**: Creates a "stained glass" effect to visualize color territory and density.
- **Dynamic Filtering**:
  - **Top X Colors**: Filter to show only the most frequently used colors.
  - **Coalesce Threshold**: Group similar colors within a specific HSL distance to identify redundancy.
- **Performance Optimized**:
  - **Pre-computation**: Moved CSV parsing, color space conversion, and accessibility analysis to a build-time script (`scripts/process-colors.js`).
  - Uses `useDeferredValue` for responsive UI sliders during heavy calculations.
  - Memoized D3 scales and Voronoi generation to prevent render lag.
- **Design System Tooling**:
  - **Export Tokens**: Generates a JSON file of the filtered palette with metadata, ready for design system consumption.

## Completed Tasks
- [x] **Project Setup**: Initialize React + Vite + Tailwind CSS.
- [x] **Data Pipeline**: 
  - **Pre-processing**: Node.js script uses `colorjs.io` to generate `public/data.json` with pre-calculated metadata.
  - Parse `color-usage-report.csv`.
  - Convert Hex to HSL for analysis.
  - Calculate weighted counts and accessibility ratings.
- [x] **Visualization**:
  - Implement D3 Radial Scale for Saturation.
  - Map Hue to Angle.
  - Build Voronoi tessellation for "Mosaic" mode.
- [x] **Interactivity**:
  - Add Hover states with detailed metadata (Hex, Count, Rank).
  - Implement "Top X" and "Coalesce" sliders.
  - Add View Mode toggle.
- [x] **Performance**:
  - Fix "ground to a halt" issues with `React.memo` and `useMemo`.
  - Implement `useDeferredValue` for smooth slider interaction.
- [x] **UI Polish**:
  - Integrate `lucide-react` icons.
  - Add professional Loading and Error states.
- [x] **Features**:
  - Implement JSON Export for design tokens.

## Future Roadmap / Backlog
- [x] **Accessibility Analysis**: 
  - Calculate and visualize contrast ratios between adjacent colors.
  - Flag colors that fail WCAG guidelines.
- [x] **Advanced Clustering**:
  - Implement DBSCAN for more intelligent color grouping.
- [x] **Palette Generation**:
  - Allow manual selection of "Keep" colors to build a new palette interactively.
- [ ] **Direct Integration**:
  - Explore methods to consume live data from Slate instances.

## Technical Stack
- **Frontend**: React 19, Vite
- **Styling**: Tailwind CSS
- **Visualization**: D3.js (Scales, Shape, Delaunay)
- **Data**: Pre-computed JSON (Build-time processing via `colorjs.io` + `PapaParse`)
- **Icons**: Lucide React
