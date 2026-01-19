import { Injectable, inject, effect, ApplicationRef, createComponent, EnvironmentInjector, ComponentRef } from '@angular/core';
import mermaid from 'mermaid';
import { ThemeService } from './theme.service';
import { MermaidFullscreenModalComponent } from '../components/mermaid-fullscreen-modal.component';

  @Injectable({ providedIn: 'root' })
export class MermaidService {
  private initialized = false;
  private themeService = inject(ThemeService);
  private currentTheme: 'light' | 'dark' = 'light';
  private appRef = inject(ApplicationRef);
  private injector = inject(EnvironmentInjector);
  private modalComponentRef: ComponentRef<MermaidFullscreenModalComponent> | null = null;

  constructor() {
    this.initializeMermaid();

    // Listen for theme changes and reinitialize Mermaid
    effect(() => {
      const isDark = this.themeService.isDarkTheme();
      const newTheme = isDark ? 'dark' : 'light';

      if (newTheme !== this.currentTheme) {
        this.currentTheme = newTheme;
        this.initialized = false; // Force reinit on theme change
        this.initializeMermaid();
      }
    });
  }

  private initializeMermaid() {
    if (!this.initialized) {
      const isDark = this.themeService.isDarkTheme();

      // Remove default fontSize override that breaks flowchart font sizing
      mermaid.mermaidAPI.updateSiteConfig({fontSize: undefined});
      
      mermaid.initialize({
        startOnLoad: false,
        theme: 'base',  // Use 'base' theme for full control over themeVariables
        securityLevel: 'loose',
        deterministicIds: true,  // Consistent IDs for repeatability
        maxTextSize: 90000,  // Increase text limit
        themeCSS: `
          /* Default sizing for non-timeline diagrams */
          svg {
            width: 1200px !important;
            height: 600px !important;
            min-width: 1200px !important;
            min-height: 600px !important;
          }
          
          /* Default container sizing for non-timeline diagrams */
          .mermaid,
          .mermaid-diagram {
            width: 1200px !important;
            min-width: 1200px !important;
            max-width: none !important;
            overflow-x: auto !important;
          }
          
          /* Global spacing and layout overrides - remove scaling */
          .cluster-label foreignObject {
            overflow: visible !important;
            width: 100% !important;
            max-width: none !important;
            min-width: 1200px !important;
          }
          /* Fix text wrapping issue - force horizontal layout */
          .cluster-label text {
            writing-mode: horizontal-tb !important;
            text-orientation: mixed !important;
            white-space: nowrap !important;
            dominant-baseline: middle !important;
          }
          .cluster-label tspan {
            writing-mode: horizontal-tb !important;
            text-orientation: mixed !important;
            white-space: nowrap !important;
            x: 0 !important;
            dy: 0 !important;
          }
          g[id*="cluster"] {
            width: 100% !important;
            max-width: none !important;
          }
          g[id*="ORM"],
          g[id*="Messaging"], 
          g[id*="Dev"],
          g[id*="Core"],
          g[id*="Observability"] {
            width: 100% !important;
            max-width: none !important;
            min-width: 800px !important;
          }
          /* Specific fix for subgraph header text to expand naturally */
          .cluster-label text,
          .subgraph-label text,
          .cluster text,
          .subgraph text {
            white-space: nowrap !important;
            text-overflow: unset !important;
            overflow: visible !important;
          }
          /* Allow cluster label containers to expand with text */
          .cluster-label {
            width: auto !important;
            max-width: none !important;
            overflow: visible !important;
          }
          .cluster-label div {
            width: auto !important;
            max-width: none !important;
            min-width: auto !important;
            text-align: center !important;
            white-space: nowrap !important;
            margin-bottom: 150px !important;
            padding: 5px 5px !important;
            margin-top: 10px !important;
            display: inline-block !important;
          }
          /* Remove font CSS from here */
          .edgeLabel rect {
            fill: transparent !important;
            stroke: none !important;
            opacity: 0 !important;
          }
          .edgeLabel foreignObject {
            background: transparent !important;
          }
          .edgeLabel .label {
            background: transparent !important;
            background-color: transparent !important;
            text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3) !important;
            filter: drop-shadow(1px 1px 2px rgba(0, 0, 0, 0.5)) !important;
          }
          .edgeLabel text {
            text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3) !important;
            filter: drop-shadow(1px 1px 2px rgba(0, 0, 0, 0.5)) !important;
          }
          .edgeLabel span, .edgeLabel p, .edgeLabel div {
            text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3) !important;
          }
          .flowchart-link {
            stroke-width: 16px !important;
          }
          path[id^="L-"] {
            stroke-width: 16px !important;
          }
          path.edge {
            stroke-width: 16px !important;
          }
          
          .cluster-label {
            margin-top: 40px !important;
            padding-top: 30px !important;
            margin-bottom: 20px !important;
          }
          .cluster rect {
            padding-top: 60px !important;
          }
          g.cluster text {
            margin-top: 40px !important;
            padding-top: 30px !important;
            transform: translateY(25px) !important;
          }
          .cluster {
            padding-top: 60px !important;
            padding-bottom: 40px !important;
            margin-left: 120px !important;
            margin-right: 120px !important;
          }
          /* Horizontal spacing between subgraphs */
          g[id*="cluster"] {
            margin-left: 80px !important;
          }
          g[id*="cluster"]:not(:first-child) {
            margin-left: 200px !important;
          }
          defs marker {
            width: 8px !important;
            height: 8px !important;
            refX: 10 !important;
            refY: 6 !important;
            markerWidth: 8px !important;
            markerHeight: 8px !important;
          }
          defs marker path {
            fill: ${isDark ? '#94a3b8' : '#64748b'} !important;
            stroke: ${isDark ? '#94a3b8' : '#64748b'} !important;
            stroke-width: 1px !important;
          }
          
          /* Subgraph/cluster background colors for better visibility */
          .cluster rect {
            fill: ${isDark ? '#1e293b' : '#f8fafc'} !important;
            stroke: ${isDark ? '#475569' : '#cbd5e1'} !important;
            stroke-width: 2px !important;
            rx: 8px !important;
            ry: 8px !important;
          }
          
          /* Target large background rectangles that are subgraph containers */
          g[id*="cluster"] > rect:first-child {
            fill: ${isDark ? '#1e293b' : '#f8fafc'} !important;
            stroke: ${isDark ? '#475569' : '#cbd5e1'} !important;
            stroke-width: 2px !important;
            stroke-dasharray: none !important;
            rx: 8px !important;
            ry: 8px !important;
            opacity: 0.8 !important;
          }
          
          /* Target rectangles with specific patterns indicating subgraph boundaries */
          rect[style*="stroke-dasharray"] {
            fill: ${isDark ? '#1e293b' : '#f8fafc'} !important;
            stroke: ${isDark ? '#475569' : '#cbd5e1'} !important;
            stroke-width: 2px !important;
            rx: 8px !important;
            ry: 8px !important;
            opacity: 0.8 !important;
          }
          /* Timeline-specific styling - applied via JavaScript class */
          .timeline-diagram g[class*="section"] text {
            font-size: 14px !important;
            line-height: 1.4 !important;
          }
          
          .timeline-diagram .lineWrapper line {
            stroke-width: 3px !important;
            stroke-dasharray: none !important;
          }
          
          .timeline-diagram .timeline-line {
            stroke-width: 3px !important;
          }
          
          .timeline-diagram g:first-of-type line {
            stroke-width: 3px !important;
          }
          
          .timeline-diagram line[stroke="#CCCCCC"],
          .timeline-diagram line[stroke="#ccc"],
          .timeline-diagram line[stroke="gray"],
          .timeline-diagram line[stroke="#999"] {
            /* Timeline lines extend full width */
          }
          
          .timeline-diagram g {
            max-width: none !important;
            width: 100% !important;
          }
          
          .timeline-diagram g[class*="section"] {
            max-width: none !important;
            flex: 1 !important;
          }
          
          .timeline-diagram g[class*="section"] rect {
            padding: 8px !important;
          }
          
          .timeline-diagram g[class*="section"] text {
            padding: 4px !important;
            margin: 2px !important;
          }
          
        `,  // Style cluster/subgraph labels and arrowheads - centered with larger headers and HUGE arrows
        flowchart: {
          htmlLabels: true,  // Enable HTML labels for proper text rendering
          useMaxWidth: false,  // Disable auto-scaling
          padding: 10,  // Reduced from 80
          diagramPadding: 10,  // Reduced from 80
          nodeSpacing: 100,  // Horizontal spacing between nodes in LR graphs (default - can be overridden per-diagram)
          rankSpacing: 300,  // Spacing between ranks/levels within the flowchart
          curve: 'basis',  // Use basis curve for smoother routing around obstacles
          subGraphTitleMargin: {
            bottom: 20  // Space between subgraph title and content
          }
        },
        timeline: {
          disableMulticolor: false,
          useMaxWidth: true,  // Enable responsive scaling to container width
          padding: 20,
          width: 0, // Let it expand naturally
        },
        arrowMarkerAbsolute: true,
        themeVariables: {
          fontFamily: 'inherit',
          fontSize: '32px',  // Base theme font size
          // Text color variables that control different text elements
          primaryTextColor: isDark ? '#ffffff' : '#000000',
          labelTextColor: isDark ? '#ffffff' : '#000000', 
          nodeTextColor: isDark ? '#ffffff' : '#000000',
          secondaryTextColor: isDark ? '#ffffff' : '#000000',
          // Dark mode specific overrides - use base theme for full control
          ...(isDark && {
            // Dark mode - force dark backgrounds everywhere
            darkMode: true,

            // Primary colors (main nodes) - darker backgrounds for better contrast
            primaryColor: '#1e3a5f',
            primaryTextColor: '#ffffff',
            primaryBorderColor: '#60a5fa',

            // Secondary colors - make sure it's dark enough
            secondaryColor: '#1e293b',
            secondaryTextColor: '#ffffff',
            secondaryBorderColor: '#64748b',

            // Tertiary colors - darker backgrounds
            tertiaryColor: '#0f172a',
            tertiaryTextColor: '#ffffff',
            tertiaryBorderColor: '#475569',

            // Background and text
            background: '#0f172a',
            mainBkg: '#1e3a5f',
            secondBkg: '#1e293b',
            tertiaryBkg: '#334155',
            textColor: '#ffffff',

            // All text should be white/light
            labelTextColor: '#ffffff',
            nodeTextColor: '#ffffff',

            // Lines and borders
            lineColor: '#94a3b8',
            border1: '#60a5fa',
            border2: '#64748b',

            // Cluster/subgraph - FORCE dark backgrounds
            clusterBkg: '#0f172a',
            clusterBorder: '#475569',
            
            // Cluster label width constraints
            clusterLabelWidth: '100%',

            // Default fill colors for nodes
            defaultLinkColor: '#94a3b8',

            // Arrow/marker colors - CRITICAL for arrow visibility
            arrowheadColor: '#94a3b8',

            // Title colors - controls subgraph headers
            titleColor: '#ffffff',
            compositeTitleBackground: 'transparent',

            // Edge labels - transparent background, text styled via CSS based on semantic layers
            edgeLabelBackground: 'transparent',
            // edgeLabelText removed - we style this via CSS based on semantic layers

            // Specific colors to override any light backgrounds - ALL DARK for proper contrast
            c0: '#1e3a5f',  // Used for first color in color scheme - dark blue
            c1: '#1e293b',  // Used for second color - dark slate
            c2: '#0f172a',  // Used for third color - very dark
            c3: '#1a2332',  // Used for fourth color - dark
            c4: '#2d3748',  // Used for fifth color - dark gray
            c5: '#1e3a5f',  // Additional colors
            c6: '#1e293b',
            c7: '#0f172a',
            c8: '#1a2332',
            c9: '#2d3748',
            c10: '#1e3a5f',
            c11: '#1e293b',

            // Pie chart colors (if used)
            pie1: '#1e3a5f',
            pie2: '#1e293b',
            pie3: '#334155',
            pie4: '#475569',

            // Sequence diagram colors
            actorBkg: '#1e3a5f',
            actorBorder: '#60a5fa',
            actorTextColor: '#ffffff',
            actorLineColor: '#94a3b8',
            signalColor: '#ffffff',
            signalTextColor: '#ffffff',
            labelBoxBkgColor: '#1e293b',
            labelBoxBorderColor: '#64748b',
            loopTextColor: '#ffffff',
            noteBorderColor: '#64748b',
            noteBkgColor: '#334155',
            noteTextColor: '#ffffff',
            activationBorderColor: '#60a5fa',
            activationBkgColor: '#1e293b',
            sequenceNumberColor: '#ffffff',

            // Flowchart specific
            nodeBorder: '#60a5fa',

            // Git graph
            git0: '#1e3a5f',
            git1: '#1e293b',
            git2: '#334155',
            git3: '#475569',

            // Requirement diagram
            requirementBackground: '#1e293b',
            requirementBorderColor: '#64748b',
            requirementBorderSize: '1',
            requirementTextColor: '#ffffff',
            relationColor: '#94a3b8',
            relationLabelBackground: '#1e293b',
            relationLabelColor: '#ffffff'
          })
        }
      });
      this.initialized = true;
    }
  }

  async renderDiagram(id: string, code: string, fontSize?: string): Promise<{ svg: string; altText?: string; isTimeline?: boolean }> {
    if (!this.initialized) {
      this.initializeMermaid();
    }
    
    // If custom fontSize is provided, calculate proportional sizes and update configuration
    if (fontSize) {
      const baseFontSize = parseInt(fontSize.replace('px', ''));
      const isDark = this.themeService.isDarkTheme();
      
      // Calculate proportional spacing - 3x font size for header spacing
      const headerSpacing = Math.round(baseFontSize * 1);
      
      // Create proportional themeCSS with scaled font sizes
      const scaledThemeCSS = `
        /* Force consistent sizing regardless of content */
        svg {
          width: 1200px !important;
          height: 800px !important;
          min-width: 1200px !important;
          min-height: 800px !important;
        }
        /* Proportionally scaled text sizes */
        text {
          font-size: ${Math.round(baseFontSize * 0.75)}px;
        }
        .cluster-label text, .cluster text, .subgraph-label text {
          font-size: ${Math.round(baseFontSize * 3.5)}px !important;
          font-weight: 950 !important;
        }
        /* Override nodeLabel styling when inside cluster-label */
        .cluster-label .nodeLabel text, .cluster-label .node text {
          font-size: ${Math.round(baseFontSize * 3.5)}px !important;
          font-weight: 950 !important;
        }
        .nodeLabel text, .node text {
          font-size: ${baseFontSize}px !important;
          font-weight: 600 !important;
        }
        .edgeLabel text {
          font-size: ${Math.round(baseFontSize * 0.6)}px !important;
          font-weight: 500 !important;
        }
        /* Subgraph spacing - force adequate horizontal separation */
        .cluster {
          margin-left: ${Math.round(baseFontSize * 2)}px !important;
          margin-right: ${Math.round(baseFontSize * 2)}px !important;
        }
        g[id*="cluster"] {
          transform: translateX(${Math.round(baseFontSize * 1.5)}px) !important;
        }
        g[id*="cluster"]:not(:first-child) {
          margin-left: ${Math.round(baseFontSize * 3)}px !important;
        }
        ${isDark ? `
        /* Force much darker backgrounds on ALL nodes in dark mode */
        .node rect, .node polygon, .node circle, .node ellipse, .node path {
          fill: #0f172a !important;
          stroke: #475569 !important;
        }
        
        /* More specific selectors to override mermaid's inline styles */
        g.node rect, g.node polygon, g.node circle, g.node ellipse, g.node path {
          fill: #0f172a !important;
          stroke: #475569 !important;
        }
        
        /* Target nodes by their role/class names */
        .node.default rect, .node.default polygon, .node.default path {
          fill: #1e293b !important;
          stroke: #475569 !important;
        }
        
        /* Specific colors for numbered nodes */
        .node.c0 rect, .node.c0 polygon { 
          fill: #1e293b !important;
          stroke: #475569 !important;
        }
        .node.c1 rect, .node.c1 polygon { 
          fill: #0f172a !important;
          stroke: #475569 !important;
        }
        .node.c2 rect, .node.c2 polygon { 
          fill: #1a1f2e !important;
          stroke: #475569 !important;
        }
        .node.c3 rect, .node.c3 polygon { 
          fill: #111827 !important;
          stroke: #475569 !important;
        }
        .node.c4 rect, .node.c4 polygon { 
          fill: #0c1118 !important;
          stroke: #475569 !important;
        }
        
        /* Target flowchart nodes specifically */
        .flowchart-node rect {
          fill: #0f172a !important;
          stroke: #475569 !important;
        }
        
        /* Force white text on all nodes with higher specificity */
        .node text, .nodeLabel, .nodeLabel text, g.node text, .node .nodeLabel {
          fill: #ffffff !important;
          color: #ffffff !important;
        }
        /* Ensure cluster/subgraph backgrounds are also dark */
        .cluster rect {
          fill: #1e293b !important;
          stroke: #475569 !important;
          stroke-width: 2px !important;
          rx: 8px !important;
          ry: 8px !important;
        }
        ` : ''}
      `;
      
      // Update configuration with proportional spacing and HTML labels
      mermaid.mermaidAPI.updateSiteConfig({
        themeCSS: scaledThemeCSS,
        flowchart: {
          htmlLabels: true,  // Enable HTML labels for proper text rendering
          useMaxWidth: false,
          padding: 20,
          diagramPadding: 20,
          nodeSpacing: 100,  // Increased horizontal spacing between subgraphs
          rankSpacing: 100,
          curve: 'basis',
          subGraphTitleMargin: {
            top: 0,
            bottom: headerSpacing  // Proportional header spacing (3x font size)
          },
          titleTopMargin: 10,
        },
        themeVariables: {
          fontSize: fontSize,
          fontFamily: 'inherit',
          primaryTextColor: isDark ? '#ffffff' : '#000000',
          labelTextColor: isDark ? '#ffffff' : '#000000', 
          nodeTextColor: isDark ? '#ffffff' : '#000000',
          secondaryTextColor: isDark ? '#ffffff' : '#000000',
        }
      });
    }
    
    const result = await mermaid.render(id, code);
    
    // Parse SVG for post-processing
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(result.svg, 'image/svg+xml');
    const svgElement = svgDoc.documentElement as unknown as SVGElement;
    
    
    // First apply semantic classes to edges and labels
    this.applyNodeClassesToEdges(svgElement);
    
    // Add colored arrows based on semantic classes, preserving Mermaid's cluster boundary arrows
    this.addArrowMarkers(svgElement);
    
    // Force darker backgrounds in dark mode and add cluster backgrounds
    const isDark = this.themeService.isDarkTheme();
    if (isDark) {
      this.forceDarkNodeBackgrounds(svgElement);
    }
    this.addClusterBackgrounds(svgElement);
    
    // If we used custom fontSize, restore the original configuration
    if (fontSize) {
      this.initialized = false; // Force re-initialization with original settings
      this.initializeMermaid();
    }
    
    // Generate alt text for accessibility
    const altText = this.generateAltText(code);
    
    return { 
      svg: new XMLSerializer().serializeToString(svgElement),
      altText,
      isTimeline: false
    };
  }

  /**
   * Manually add arrow markers to SVG since Mermaid 10.6.1 isn't generating them properly
   */
  private addArrowMarkers(svgElement: SVGElement): void {
    // Create defs element if it doesn't exist
    let defs = svgElement.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      svgElement.insertBefore(defs, svgElement.firstChild);
    }
    
    // Clear only our semantic layer markers to avoid conflicts, preserve Mermaid's original markers
    const existingCustomMarkers = defs.querySelectorAll('marker[id^="arrow-layer-"]');
    existingCustomMarkers.forEach(marker => marker.remove());
    
    // Semantic layer colors for arrows and lines
    const layerColors: { [key: string]: string } = {
      'layer-default': '#393939',
      'layer-core': '#28a745',        // Green - Core Business Logic
      'layer-event': '#dc3545',       // Red - Event Sourcing & Persistence  
      'layer-read': '#004085',        // Blue - Read Models & Queries
      'layer-command': '#ffc107',     // Yellow - Commands & Messaging
      'layer-observability': '#14b8a6', // Teal - Observability & Monitoring
      'layer-infrastructure': '#8b5cf6'  // Purple - Developer Tools
    };
    
    // Create arrow markers for each semantic layer
    Object.entries(layerColors).forEach(([layerClass, color]) => {
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      marker.setAttribute('id', `arrow-${layerClass}`);
      marker.setAttribute('viewBox', '0 0 12 12');
      marker.setAttribute('refX', '10');
      marker.setAttribute('refY', '6');
      marker.setAttribute('markerWidth', '4');
      marker.setAttribute('markerHeight', '4');
      marker.setAttribute('orient', 'auto');
      
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('points', '0,0 0,12 12,6');
      polygon.setAttribute('fill', color);
      
      marker.appendChild(polygon);
      defs.appendChild(marker);
    });
    
    // Find and update ALL edge paths to use semantic colored arrows and lines
    // Check both .flowchart-link and paths with IDs starting with L_
    const flowchartPaths = svgElement.querySelectorAll('path.flowchart-link');
    const edgePaths = svgElement.querySelectorAll('path[id^="L_"]');
    const allPaths = new Set([...Array.from(flowchartPaths), ...Array.from(edgePaths)]);
    
    console.log(`Found ${flowchartPaths.length} flowchart-link paths and ${edgePaths.length} L_ paths, total unique: ${allPaths.size}`);
    
    Array.from(allPaths).forEach((path, index) => {
      // Determine which semantic layer this path belongs to
      const pathClasses = path.getAttribute('class') || '';
      let semanticClass = '';
      
      console.log(`Path ${index + 1} (${path.id}) has classes: "${pathClasses}"`);
      
      // Find the layer class
      Object.keys(layerColors).forEach(layerClass => {
        if (pathClasses.includes(layerClass)) {
          semanticClass = layerClass;
        }
      });
      
      if (semanticClass && layerColors[semanticClass]) {
        const color = layerColors[semanticClass];
        // Apply semantic color to line stroke with inline style to override Mermaid
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', '16');
        path.setAttribute('style', `stroke: ${color} !important; stroke-width: 16px !important;`);
        // Apply semantic colored arrow
        path.setAttribute('marker-end', `url(#arrow-${semanticClass})`);
        console.log(`Applied ${semanticClass} arrow and stroke to path ${index + 1} (${path.id})`);
      } else {
        // Skip paths without semantic classes - these are likely cluster boundary crossings
        // Let Mermaid handle these completely to preserve proper arrow positioning
        console.log(`Skipping path ${index + 1} (${path.id}) - no semantic class, likely cluster boundary`);
      }
    });
    
    // Now color the edge labels to match their associated edges
    this.colorEdgeLabels(svgElement, layerColors);
    
    // Also try a direct approach to color all text elements with edge label content
    this.colorEdgeTextsDirect(svgElement, layerColors);
  }
  
  /**
   * Color edge labels to match their associated edge's semantic layer color
   */
  private colorEdgeLabels(svgElement: SVGElement, layerColors: { [key: string]: string }): void {
    // Find all edge labels
    const edgeLabels = svgElement.querySelectorAll('.edgeLabel');
    console.log(`Found ${edgeLabels.length} edge labels to color`);
    
    // Also find all paths to create a mapping of edge IDs to colors
    const edgeColorMap = new Map<string, string>();
    const paths = svgElement.querySelectorAll('path[id^="L-"]');
    
    paths.forEach(path => {
      const pathClasses = path.getAttribute('class') || '';
      const pathId = path.id;
      
      // Find semantic class in path
      Object.keys(layerColors).forEach(layerClass => {
        if (pathClasses.includes(layerClass)) {
          // Extract base edge ID (remove the -0 suffix)
          const baseId = pathId.replace(/-\d+$/, '');
          edgeColorMap.set(baseId, layerColors[layerClass]);
          edgeColorMap.set(pathId, layerColors[layerClass]); // Also store full ID
          console.log(`Mapped edge ${pathId} (${baseId}) to ${layerColors[layerClass]}`);
        }
      });
    });
    
    console.log(`Edge color map has ${edgeColorMap.size} entries`);
    
    edgeLabels.forEach((label, index) => {
      console.log(`Processing edge label ${index + 1}:`);
      
      // Check if label has semantic classes
      const labelClasses = label.getAttribute('class') || '';
      console.log(`  Label classes: "${labelClasses}"`);
      let color = '';
      
      // First try direct class matching
      Object.keys(layerColors).forEach(layerClass => {
        if (labelClasses.includes(layerClass)) {
          color = layerColors[layerClass];
          console.log(`  Found direct class match: ${layerClass} -> ${color}`);
        }
      });
      
      // If no direct class, try multiple ways to match by edge association
      if (!color) {
        // Method 1: Look for data-id in .label element
        const labelElement = label.querySelector('.label');
        if (labelElement) {
          const dataId = labelElement.getAttribute('data-id');
          console.log(`  Label data-id: ${dataId}`);
          if (dataId) {
            if (edgeColorMap.has(dataId)) {
              color = edgeColorMap.get(dataId)!;
              console.log(`  Found match by data-id: ${dataId} -> ${color}`);
            } else {
              const baseId = dataId.replace(/-\d+$/, '');
              if (edgeColorMap.has(baseId)) {
                color = edgeColorMap.get(baseId)!;
                console.log(`  Found match by base data-id: ${baseId} -> ${color}`);
              }
            }
          }
        }
        
        // Method 2: Try to find any edge ID references in the label's DOM
        if (!color) {
          const labelHTML = label.innerHTML;
          edgeColorMap.forEach((edgeColor, edgeId) => {
            if (labelHTML.includes(edgeId)) {
              color = edgeColor;
              console.log(`  Found match by innerHTML reference: ${edgeId} -> ${color}`);
            }
          });
        }
      }
      
      if (color) {
        // Apply color to ALL possible text elements within the label using aggressive selectors
        const textSelectors = [
          'span', 'text', 'tspan', 'p', 'div', 'foreignObject *', 
          '.label', '.label *', '.edgeLabel *', '*'
        ];
        
        textSelectors.forEach(selector => {
          try {
            const elements = label.querySelectorAll(selector);
            elements.forEach(textEl => {
              if (textEl instanceof HTMLElement) {
                textEl.style.setProperty('color', color, 'important');
                textEl.style.setProperty('fill', color, 'important');
                // Remove backgrounds for clean text appearance
                textEl.style.setProperty('background-color', 'transparent', 'important');
                textEl.style.setProperty('background', 'transparent', 'important');
                // Add drop shadow and glow for better readability
                textEl.style.setProperty('text-shadow', '2px 2px 4px rgba(0, 0, 0, 0.3)', 'important');
              } else if (textEl instanceof SVGElement) {
                textEl.setAttribute('fill', color);
                textEl.style.setProperty('fill', color, 'important');
                // Remove any background fills from SVG elements
                textEl.removeAttribute('fill-opacity');
                if (textEl.hasAttribute('stroke')) {
                  textEl.removeAttribute('stroke');
                }
                // Add drop shadow and glow filter for SVG text
                textEl.style.setProperty('filter', 'drop-shadow(1px 1px 2px rgba(0, 0, 0, 0.5))', 'important');
              }
            });
          } catch (e) {
            // Ignore selector errors
          }
        });
        
        // Also apply directly to the label element itself and remove backgrounds
        if (label instanceof HTMLElement) {
          label.style.setProperty('color', color, 'important');
          label.style.setProperty('background-color', 'transparent', 'important');
          label.style.setProperty('background', 'transparent', 'important');
          label.style.setProperty('text-shadow', '2px 2px 4px rgba(0, 0, 0, 0.3)', 'important');
        }
        
        console.log(`  ✅ Applied ${color} to edge label ${index + 1}`);
      } else {
        console.log(`  ❌ No color found for edge label ${index + 1}`);
      }
    });
  }
  
  /**
   * Systematic approach to color ALL edge text elements based on their source subgraph color
   * This automatically coordinates arrows, lines, and edge labels without hard-coding
   */
  private colorEdgeTextsDirect(svgElement: SVGElement, layerColors: { [key: string]: string }): void {
    // Map subgraph names to their semantic colors (source determines edge label color)
    // Use darker shades for text readability while staying within the color family
    const subgraphToColorMap = new Map<string, string>([
      ['ORM', '#a02a33'],           // Darker Red - Event layer (was #dc3545)
      ['Messaging', '#cc9a06'],     // Darker Yellow - Command layer (was #ffc107)
      ['Dev', '#6d28d9'],           // Darker Purple - Infrastructure layer (was #8b5cf6)
      ['Core', '#1e7e34'],          // Darker Green - Core layer (was #28a745)
      ['Observability', '#0f766e']  // Darker Teal - Observability layer (was #14b8a6)
    ]);
    
    // Build edge-to-source-color mapping based on source subgraph
    const edgeToColorMap = new Map<string, { color: string; source: string }>();
    const paths = svgElement.querySelectorAll('path[id^="L-"]');
    
    paths.forEach(path => {
      const pathId = path.id;
      
      // Parse edge ID to get source subgraph
      const edgeMatch = pathId.match(/^L-(.+?)-(.+?)-\d+$/);
      if (edgeMatch) {
        const [, source, target] = edgeMatch;
        const sourceColor = subgraphToColorMap.get(source);
        
        if (sourceColor) {
          edgeToColorMap.set(pathId, { 
            color: sourceColor, 
            source 
          });
          console.log(`Edge ${pathId} mapped to ${sourceColor} (source: ${source})`);
        }
      }
    });
    
    // Find all edge labels and establish edge-to-label relationships
    const edgeLabels = svgElement.querySelectorAll('.edgeLabel');
    const edgeLabelToEdgeMap = new Map<Element, string>();
    
    // Simple, direct label-to-edge mapping based on known structure
    console.log(`\n=== Direct Edge Label Association ===`);
    
    // Get all available edges in a predictable order
    const availableEdges = Array.from(edgeToColorMap.keys()).sort();
    console.log(`Available edges:`, availableEdges);
    
    // Map specific labels to specific edges based on content and logical order
    edgeLabels.forEach((label, index) => {
      const textContent = (label.textContent || '').trim();
      console.log(`\nLabel ${index + 1}: "${textContent}"`);
      
      if (!textContent) {
        console.log(`  ❌ Empty label, skipping`);
        return;
      }
      
      let targetEdge = '';
      
      if (textContent === 'Require') {
        // We have two "Require" labels - map them to the two edges that need "Require"
        // Since we see both ORM and Messaging edges, assign based on order
        const requireEdges = availableEdges.filter(edge => 
          edge.includes('ORM-WhizES') || edge.includes('Messaging-WhizMsg')
        );
        
        if (requireEdges.length >= 2) {
          // Count how many "Require" labels we've already mapped
          const alreadyMappedRequire = Array.from(edgeLabelToEdgeMap.values())
            .filter(edgeId => requireEdges.includes(edgeId));
          
          if (alreadyMappedRequire.length === 0) {
            // First "Require" goes to ORM (red)
            targetEdge = requireEdges.find(edge => edge.includes('ORM-WhizES')) || '';
            console.log(`  🔴 First "Require" → ORM edge: ${targetEdge}`);
          } else if (alreadyMappedRequire.length === 1) {
            // Second "Require" goes to Messaging (yellow)
            targetEdge = requireEdges.find(edge => edge.includes('Messaging-WhizMsg')) || '';
            console.log(`  🟡 Second "Require" → Messaging edge: ${targetEdge}`);
          }
        }
      } else if (textContent.includes('Validate') || textContent.includes('Test')) {
        // "Validate/Test" goes to Dev edge (purple)
        targetEdge = availableEdges.find(edge => edge.includes('Dev-Core')) || '';
        console.log(`  🟣 "Validate/Test" → Dev edge: ${targetEdge}`);
      } else if (textContent.includes('Monitor')) {
        // "Monitor" goes to Observability edge (teal)
        targetEdge = availableEdges.find(edge => edge.includes('Observability-Core')) || '';
        console.log(`  🟦 "Monitor" → Observability edge: ${targetEdge}`);
      }
      
      if (targetEdge && edgeToColorMap.has(targetEdge)) {
        edgeLabelToEdgeMap.set(label, targetEdge);
        const color = edgeToColorMap.get(targetEdge)?.color;
        console.log(`  ✅ Mapped "${textContent}" → ${targetEdge} (${color})`);
      } else {
        console.log(`  ❌ No mapping found for "${textContent}"`);
      }
    });
    
    // Apply colors to all text elements within mapped edge labels
    edgeLabelToEdgeMap.forEach((edgeId, label) => {
      const edgeInfo = edgeToColorMap.get(edgeId);
      if (edgeInfo) {
        const { color } = edgeInfo;
        
        // Apply color to ALL text elements within this label and remove backgrounds
        const textElements = label.querySelectorAll('text, tspan, span, div, p, foreignObject *, *');
        textElements.forEach(textEl => {
          if (textEl instanceof HTMLElement) {
            textEl.style.setProperty('color', color, 'important');
            textEl.style.setProperty('fill', color, 'important');
            // Remove any background/fill colors for clean text appearance
            textEl.style.setProperty('background-color', 'transparent', 'important');
            textEl.style.setProperty('background', 'transparent', 'important');
            // Add drop shadow for better readability
            textEl.style.setProperty('text-shadow', '2px 2px 4px rgba(0, 0, 0, 0.3)', 'important');
          } else if (textEl instanceof SVGElement) {
            textEl.setAttribute('fill', color);
            textEl.style.setProperty('fill', color, 'important');
            // Remove any background fills from SVG elements
            textEl.removeAttribute('fill-opacity');
            if (textEl.hasAttribute('stroke')) {
              textEl.removeAttribute('stroke');
            }
            // Add drop shadow filter for SVG text
            textEl.style.setProperty('filter', 'drop-shadow(1px 1px 2px rgba(0, 0, 0, 0.5))', 'important');
          }
        });
        
        // Also apply to the label itself and remove backgrounds
        if (label instanceof HTMLElement) {
          label.style.setProperty('color', color, 'important');
          label.style.setProperty('background-color', 'transparent', 'important');
          label.style.setProperty('background', 'transparent', 'important');
          label.style.setProperty('text-shadow', '2px 2px 4px rgba(0, 0, 0, 0.3)', 'important');
        }
        
        console.log(`  🎨 Applied ${color} to entire label for edge ${edgeId}`);
      }
    });
    
    console.log(`\n=== Edge Label Mapping Summary ===`);
    console.log(`Total edges: ${edgeToColorMap.size}`);
    console.log(`Total labels: ${edgeLabels.length}`);
    console.log(`Mapped labels: ${edgeLabelToEdgeMap.size}`);
  }


  /**
   * Apply node classes to nodes, edges, and edge labels based on subgraph membership.
   * This allows all diagram elements to inherit colors from their semantic layer classes.
   * Call this after the SVG has been inserted into the DOM.
   */
  applyNodeClassesToEdges(svgElement: SVGElement): void {
    // Map subgraph IDs to their semantic classes
    const subgraphClassMap = new Map<string, string[]>([
      ['Default', ['layer-default']],           // ORM Integrations - event/data layer
      ['ORM', ['layer-event']],           // ORM Integrations - event/data layer
      ['Messaging', ['layer-command']],   // Message Broker Adapters - command layer
      ['Dev', ['layer-infrastructure']],  // Developer Tools - infrastructure layer
      ['Core', ['layer-core']],           // Core Packages - core business logic layer
      ['Observability', ['layer-observability']] // Observability - telemetry layer
    ]);

    // Build map of node name -> subgraph classes
    // by checking which subgraph each node belongs to
    const nodeClassMap = new Map<string, string[]>();

    // For each subgraph, find all nodes within it and map them to the subgraph's classes
    subgraphClassMap.forEach((classes, subgraphId) => {
      const subgraph = svgElement.querySelector(`#${subgraphId}`);
      if (subgraph) {
        // Find all flowchart nodes that are visually within this subgraph
        // (they're not DOM children, but we can use the node IDs from the edges)
        // We'll collect them as we process edges below
      }
    });

    // Also get any nodes that have explicit layer/bucket classes from the diagram
    const nodesWithClasses = svgElement.querySelectorAll('[class*="layer-"], [class*="bucket-"]');
    nodesWithClasses.forEach(node => {
      const fullId = node.id;
      const classList = node.getAttribute('class')?.split(' ') || [];
      const semanticClasses = classList.filter(c => c.startsWith('layer-') || c.startsWith('bucket-'));

      if (fullId && semanticClasses.length > 0) {
        const match = fullId.match(/flowchart-(.+?)-\d+$/);
        const nodeName = match ? match[1] : fullId;
        nodeClassMap.set(nodeName, semanticClasses);
      }
    });

    // Helper to determine which subgraph a node belongs to based on naming convention
    const getSubgraphForNode = (nodeName: string): string[] | undefined => {
      // Check if node already has explicit classes
      if (nodeClassMap.has(nodeName)) {
        return nodeClassMap.get(nodeName);
      }

      // Check if it's a direct subgraph name
      if (subgraphClassMap.has(nodeName)) {
        return subgraphClassMap.get(nodeName);
      }

      // Determine subgraph based on node name patterns
      if (nodeName.startsWith('Whiz')) {
        // ORM integrations: WhizEF, WhizDapper, WhizNH
        if (nodeName === 'WhizEF' || nodeName === 'WhizDapper' || nodeName === 'WhizNH') {
          return subgraphClassMap.get('ORM');
        }
        // Message brokers: WhizKafka, WhizRabbit, WhizASB, WhizSQS
        if (nodeName === 'WhizKafka' || nodeName === 'WhizRabbit' || nodeName === 'WhizASB' || nodeName === 'WhizSQS') {
          return subgraphClassMap.get('Messaging');
        }
        // Developer tools: WhizAnalyzers, WhizTesting
        if (nodeName === 'WhizAnalyzers' || nodeName === 'WhizTesting') {
          return subgraphClassMap.get('Dev');
        }
        // Observability: WhizOTel, WhizDash
        if (nodeName === 'WhizOTel' || nodeName === 'WhizDash') {
          return subgraphClassMap.get('Observability');
        }
        // Core packages: WhizCore, WhizES, WhizProj, WhizMsg
        return subgraphClassMap.get('Core');
      }
      
      // Receptor pattern specific nodes
      if (nodeName.includes('Receptor') || nodeName === 'CommandReceptor' || nodeName === 'EventReceptor' || nodeName.includes('Mediator')) {
        return subgraphClassMap.get('Core');
      }
      
      // Architecture-related nodes are typically core business logic
      if (nodeName === 'Architecture' || nodeName.includes('Architecture')) {
        return subgraphClassMap.get('Core');
      }
      
      // Context-related nodes are typically core business logic  
      if (nodeName === 'Context' || nodeName.includes('Context')) {
        return subgraphClassMap.get('Core');
      }
      
      // Command and Event handling nodes
      if (nodeName.includes('Command') || nodeName.includes('Event') || nodeName.includes('Log')) {
        return subgraphClassMap.get('Core');
      }

      if (nodeName.includes('Query') || nodeName.includes('Cache') || nodeName.includes('Data Access')) {
        return subgraphClassMap.get('ORM');
      }

      return subgraphClassMap.get('Default');
    };

    // Apply classes to all nodes based on their subgraph membership
    const nodes = svgElement.querySelectorAll('[id^="flowchart-"]');
    nodes.forEach(node => {
      const fullId = node.id;
      const match = fullId.match(/flowchart-(.+?)-\d+$/);
      if (match) {
        const nodeName = match[1];
        const nodeClasses = getSubgraphForNode(nodeName);
        if (nodeClasses) {
          node.classList.add(...nodeClasses);
        }
      }
    });

    // Color map for semantic layers
    const layerColorMap: { [key: string]: string } = {
      'layer-default': '#393939',
      'layer-core': '#28a745',
      'layer-event': '#dc3545',
      'layer-read': '#004085',
      'layer-command': '#ffc107',
      'layer-observability': '#14b8a6',
      'layer-infrastructure': '#8b5cf6'
    };

    // Find all edges and apply classes based on source node's subgraph
    const hyphenEdges = svgElement.querySelectorAll('path[id^="L-"]');
    const underscoreEdges = svgElement.querySelectorAll('path[id^="L_"]');
    const flowchartLinks = svgElement.querySelectorAll('path.flowchart-link');
    const allEdges = new Set([...Array.from(hyphenEdges), ...Array.from(underscoreEdges), ...Array.from(flowchartLinks)]);
    const edgeLabels = svgElement.querySelectorAll('.edgeLabel');

    console.log(`Found ${hyphenEdges.length} L- edges, ${underscoreEdges.length} L_ edges, and ${flowchartLinks.length} flowchart-link edges, total unique: ${allEdges.size}`);

    Array.from(allEdges).forEach((edge, index) => {
      const edgeId = edge.id;
      let sourceId = '';
      let targetId = '';
      
      // Try L- pattern (with hyphens) first
      let match = edgeId.match(/^L-(.+?)-(.+?)-\d+$/);
      if (match) {
        [, sourceId, targetId] = match;
      } else {
        // Try L_ pattern (with underscores) as fallback
        match = edgeId.match(/^L_(.+?)_(.+?)_\d+$/);
        if (match) {
          [, sourceId, targetId] = match;
        } else {
          console.log(`No L- or L_ pattern found for edge ${edgeId}, skipping...`);
          return;
        }
      }

      if (sourceId) {
        const sourceClasses = getSubgraphForNode(sourceId);
        if (sourceClasses) {
          edge.classList.add(...sourceClasses);
          console.log(`Applied classes [${sourceClasses.join(', ')}] to edge ${edgeId} (${sourceId} -> ${targetId})`);

          // Apply classes to ALL edge labels (Mermaid creates multiple label elements per edge)
          // We need to apply to all labels, not just the one at the same index
          edgeLabels.forEach(label => {
            // Check if this label is associated with this edge by checking data-id or content
            const labelDataId = label.querySelector('.label')?.getAttribute('data-id');
            if (labelDataId === edgeId) {
              label.classList.add(...sourceClasses);

              // Apply inline color styles to text elements (Mermaid theme overrides CSS)
              const layerClass = sourceClasses.find(c => c.startsWith('layer-'));
              if (layerClass && layerColorMap[layerClass]) {
                const color = layerColorMap[layerClass];
                const spans = label.querySelectorAll('span');
                const ps = label.querySelectorAll('p');

                spans.forEach(span => {
                  (span as HTMLElement).style.color = color;
                });
                ps.forEach(p => {
                  (p as HTMLElement).style.color = color;
                });
              }
            }
          });
        }
      }
    });

    // Note: Subgraph spacing is controlled by the nodeSpacing configuration (800px)
    // which provides horizontal separation in LR (left-to-right) graphs
  }

  async renderDiagrams() {
    // This method is kept for backward compatibility but is no longer used
    // Mermaid diagrams are now rendered directly in markdown.page.ts
    console.warn('MermaidService.renderDiagrams() is deprecated - diagrams are now rendered in markdown.page.ts');
  }

  /**
   * Add a maximize button to a Mermaid diagram container
   */
  public addMaximizeButton(container: HTMLElement): void {
    // Check if button already exists
    if (container.querySelector('.mermaid-maximize-btn')) {
      return;
    }

    // Create maximize button
    const button = document.createElement('button');
    button.className = 'mermaid-maximize-btn';
    button.innerHTML = '<i class="pi pi-window-maximize"></i>';
    button.title = 'View fullscreen';
    button.setAttribute('aria-label', 'View diagram in fullscreen');
    
    // Style the button
    button.style.cssText = `
      position: absolute;
      top: 0.5rem;
      right: 0.5rem;
      background: var(--surface-hover);
      border: 1px solid var(--surface-border);
      color: var(--text-color);
      border-radius: 0.25rem;
      width: 2rem;
      height: 2rem;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s ease;
      opacity: 0.7;
      z-index: 10;
    `;

    // Add hover effect
    button.addEventListener('mouseenter', () => {
      button.style.opacity = '1';
      button.style.background = 'var(--primary-color)';
      button.style.color = 'var(--primary-color-text)';
      button.style.transform = 'scale(1.1)';
    });

    button.addEventListener('mouseleave', () => {
      button.style.opacity = '0.7';
      button.style.background = 'var(--surface-hover)';
      button.style.color = 'var(--text-color)';
      button.style.transform = 'scale(1)';
    });

    // Handle click
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Open fullscreen modal
      const svg = container.querySelector('svg');
      if (svg) {
        this.openFullscreenModal(svg as SVGElement);
      }
    });

    // Make container position relative if not already
    const computedStyle = window.getComputedStyle(container);
    if (computedStyle.position === 'static') {
      container.style.position = 'relative';
    }

    // Add button to container
    container.appendChild(button);

    // Show/hide button on container hover
    container.addEventListener('mouseenter', () => {
      button.style.opacity = '0.7';
    });

    container.addEventListener('mouseleave', () => {
      button.style.opacity = '0';
    });

    // Initially hide the button
    button.style.opacity = '0';
  }

  /**
   * Open the fullscreen modal with a diagram
   */
  private openFullscreenModal(svgElement: SVGElement): void {
    // Create modal component if it doesn't exist
    if (!this.modalComponentRef) {
      this.modalComponentRef = createComponent(MermaidFullscreenModalComponent, {
        environmentInjector: this.injector
      });
      
      // Attach to app
      this.appRef.attachView(this.modalComponentRef.hostView);
      
      // Add to DOM
      document.body.appendChild(this.modalComponentRef.location.nativeElement);
    }

    // Open the modal with the SVG
    this.modalComponentRef.instance.open(svgElement);
  }

  /**
   * Generate descriptive alt text for Mermaid diagrams based on their syntax
   */
  private generateAltText(mermaidCode: string): string {
    const code = mermaidCode.trim();
    
    // Detect diagram type
    if (code.startsWith('sequenceDiagram')) {
      return this.generateSequenceDiagramAltText(code);
    } else if (code.startsWith('graph')) {
      return this.generateGraphDiagramAltText(code);
    } else if (code.startsWith('flowchart')) {
      return this.generateFlowchartAltText(code);
    } else if (code.startsWith('classDiagram')) {
      return this.generateClassDiagramAltText(code);
    }
    
    // Fallback for unknown diagram types
    return 'Interactive diagram illustrating system architecture and component relationships.';
  }

  /**
   * Generate alt text for sequence diagrams
   */
  private generateSequenceDiagramAltText(code: string): string {
    const lines = code.split('\n').map(line => line.trim()).filter(line => line);
    
    // Extract participants
    const participants: string[] = [];
    const participantAliases = new Map<string, string>();
    
    for (const line of lines) {
      if (line.startsWith('participant ')) {
        const match = line.match(/participant\s+(.+?)(?:\s+as\s+(.+))?$/);
        if (match) {
          const [, id, alias] = match;
          participants.push(alias || id);
          if (alias) {
            participantAliases.set(id, alias);
          }
        }
      }
    }
    
    // Extract interactions (arrows between participants)
    const interactions: string[] = [];
    for (const line of lines) {
      if (line.includes('->') || line.includes('-->>')) {
        const match = line.match(/(.+?)(?:->|-->>)(.+?):\s*(.+)$/);
        if (match) {
          const [, from, to, action] = match;
          const fromName = participantAliases.get(from.trim()) || from.trim();
          const toName = participantAliases.get(to.trim()) || to.trim();
          interactions.push(`${fromName} sends ${action} to ${toName}`);
        }
      }
    }
    
    const participantCount = participants.length;
    const participantList = participants.length > 0 ? participants.join(', ') : 'system components';
    
    // Build workflow description
    let workflow = 'message flow';
    if (interactions.length > 0) {
      workflow = interactions.slice(0, 3).join(', then ').toLowerCase();
      if (interactions.length > 3) {
        workflow += ', and additional steps';
      }
    }
    
    return `Sequence diagram showing ${workflow} between ${participantCount} components: ${participantList}. Flow demonstrates the step-by-step interaction pattern for this process.`;
  }

  /**
   * Generate alt text for graph diagrams (dependency and architecture diagrams)
   */
  private generateGraphDiagramAltText(code: string): string {
    const lines = code.split('\n').map(line => line.trim()).filter(line => line);
    
    // Detect direction
    const firstLine = lines[0] || '';
    const direction = firstLine.includes('LR') ? 'left-to-right' : 
                     firstLine.includes('TB') ? 'top-to-bottom' : 
                     firstLine.includes('RL') ? 'right-to-left' : 'hierarchical';
    
    // Extract subgraphs
    const subgraphs: string[] = [];
    let inSubgraph = false;
    
    for (const line of lines) {
      if (line.startsWith('subgraph ')) {
        const match = line.match(/subgraph\s+(.+?)\["(.+?)"\]/);
        if (match) {
          subgraphs.push(match[2]);
        }
        inSubgraph = true;
      } else if (line === 'end' && inSubgraph) {
        inSubgraph = false;
      }
    }
    
    // Extract nodes (simplified)
    const nodeCount = (code.match(/\[.+?\]/g) || []).length;
    
    // Extract relationships (arrows)
    const relationships = (code.match(/-->\|.+?\|/g) || []).length + 
                         (code.match(/-->/g) || []).length;
    
    // Determine diagram purpose based on content
    let purpose = 'component relationships';
    if (code.includes('Core') || code.includes('Package')) {
      purpose = 'package dependencies and architectural layers';
    } else if (code.includes('Command') || code.includes('Event')) {
      purpose = 'CQRS workflow and data flow patterns';
    } else if (code.includes('Write') || code.includes('Read')) {
      purpose = 'read and write side separation in CQRS architecture';
    }
    
    const groupingText = subgraphs.length > 0 ? 
      ` organized in ${subgraphs.length} groups: ${subgraphs.join(', ')}.` : '.';
    
    return `${direction.charAt(0).toUpperCase() + direction.slice(1)} diagram showing ${purpose} between ${nodeCount} components${groupingText} Contains ${relationships} connections demonstrating system architecture and data flow.`;
  }

  /**
   * Generate alt text for flowchart diagrams
   */
  private generateFlowchartAltText(code: string): string {
    // Flowcharts are similar to graphs but often show process flows
    return this.generateGraphDiagramAltText(code.replace('flowchart', 'graph'));
  }

  /**
   * Generate alt text for class diagrams
   */
  private generateClassDiagramAltText(code: string): string {
    const lines = code.split('\n').map(line => line.trim()).filter(line => line);
    
    // Extract classes
    const classes = lines.filter(line => line.startsWith('class ')).length;
    
    // Extract relationships
    const relationships = lines.filter(line => 
      line.includes('--|>') || line.includes('--') || line.includes('..>')
    ).length;
    
    return `Class diagram showing ${classes} classes with ${relationships} relationships. Illustrates object-oriented design patterns and type hierarchies.`;
  }


  private forceDarkNodeBackgrounds(svgElement: SVGElement): void {
    // Map light colors to dark mode equivalents using RGB values 
    // (Mermaid often uses RGB instead of hex)
    const colorMap: { [key: string]: { fill: string; stroke: string } } = {
      // Light blue variations -> Dark blue
      'rgb(218, 232, 252)': { fill: '#1e3a5f', stroke: '#2563eb' },
      'rgb(204, 229, 255)': { fill: '#1e3a5f', stroke: '#2563eb' },
      '#dae8fc': { fill: '#1e3a5f', stroke: '#2563eb' },
      '#cce5ff': { fill: '#1e3a5f', stroke: '#2563eb' },
      
      // Light peach/orange variations -> Dark orange
      'rgb(255, 230, 204)': { fill: '#7c2d12', stroke: '#ea580c' },
      'rgb(255, 242, 204)': { fill: '#7c2d12', stroke: '#ea580c' },
      '#ffe6cc': { fill: '#7c2d12', stroke: '#ea580c' },
      '#fff2cc': { fill: '#7c2d12', stroke: '#ea580c' },
      
      // Light pink variations -> Dark pink
      'rgb(248, 206, 204)': { fill: '#831843', stroke: '#db2777' },
      'rgb(230, 204, 255)': { fill: '#581c87', stroke: '#9333ea' },
      '#f8cecc': { fill: '#831843', stroke: '#db2777' },
      '#e6ccff': { fill: '#581c87', stroke: '#9333ea' },
      
      // Light yellow variations -> Dark amber
      'rgb(255, 244, 230)': { fill: '#78350f', stroke: '#d97706' },
      '#fff4e6': { fill: '#78350f', stroke: '#d97706' },
      
      // Light purple variations -> Dark purple
      'rgb(225, 213, 231)': { fill: '#4c1d95', stroke: '#7c3aed' },
      '#e1d5e7': { fill: '#4c1d95', stroke: '#7c3aed' },
      
      // Light green variations -> Dark green
      'rgb(213, 232, 212)': { fill: '#14532d', stroke: '#16a34a' },
      '#d5e8d4': { fill: '#14532d', stroke: '#16a34a' },
      
      // Default fallback for unmapped colors
      'default': { fill: '#1e293b', stroke: '#475569' }
    };

    console.log('🎨 Processing nodes for color mapping...');

    // Process all node rectangles and polygons
    const nodes = svgElement.querySelectorAll('g.node');
    nodes.forEach((node: Element, index) => {
      const rect = node.querySelector('rect, polygon, path');
      const textElement = node.querySelector('text');
      const text = textElement?.textContent || '';
      
      console.log(`Node ${index + 1}: "${text}"`);
      
      if (rect instanceof SVGElement) {
        // Get the current fill color (try multiple sources)
        const currentFill = rect.getAttribute('fill') || 
                           rect.style.fill || 
                           window.getComputedStyle(rect).fill || '';
        
        console.log(`  Current fill: "${currentFill}"`);
        
        // Normalize the color string for comparison
        const normalizedFill = currentFill.toLowerCase().replace(/\s/g, '');
        
        // Find matching dark color by detecting color family
        let darkColors: { fill: string; stroke: string } | null = null;
        
        // Try exact RGB color matching first
        for (const [lightColor, darkColor] of Object.entries(colorMap)) {
          if (lightColor !== 'default' && normalizedFill === lightColor) {
            darkColors = darkColor;
            console.log(`  ✅ Exact RGB match: ${lightColor} -> ${darkColor.fill}`);
            break;
          }
        }
        
        // If no exact match, detect color family by RGB analysis  
        if (!darkColors && currentFill.startsWith('rgb(')) {
          // Parse RGB values from string like "rgb(227, 242, 253)"
          const rgbMatch = currentFill.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
          if (rgbMatch) {
            const [, r, g, b] = rgbMatch.map(Number);
            
            // Analyze color family based on dominant color channels
            const isBlueish = b > r && b > g && b > 200; // High blue channel
            const isGreenish = g > r && g > b && g > 200; // High green channel  
            const isPinkish = r > g && r > b && r > 200; // High red channel
            const isPurplish = r > 200 && b > 200 && g < r; // High red+blue, lower green
            const isYellowish = r > 200 && g > 200 && b < 200; // High red+green, lower blue
            const isTealish = g > 200 && b > 200 && r < g; // High green+blue, lower red
            
            if (isBlueish) {
              darkColors = { fill: '#1e3a5f', stroke: '#2563eb' }; // Dark blue
              console.log(`  🔵 RGB analysis: Blue family (${r},${g},${b}) -> Dark blue`);
            } else if (isGreenish) {
              darkColors = { fill: '#14532d', stroke: '#16a34a' }; // Dark green
              console.log(`  🟢 RGB analysis: Green family (${r},${g},${b}) -> Dark green`);
            } else if (isPinkish) {
              darkColors = { fill: '#831843', stroke: '#db2777' }; // Dark pink
              console.log(`  🩷 RGB analysis: Pink family (${r},${g},${b}) -> Dark pink`);
            } else if (isPurplish) {
              darkColors = { fill: '#4c1d95', stroke: '#7c3aed' }; // Dark purple
              console.log(`  🟣 RGB analysis: Purple family (${r},${g},${b}) -> Dark purple`);
            } else if (isYellowish) {
              darkColors = { fill: '#78350f', stroke: '#d97706' }; // Dark amber
              console.log(`  🟡 RGB analysis: Yellow family (${r},${g},${b}) -> Dark amber`);
            } else if (isTealish) {
              darkColors = { fill: '#134e4a', stroke: '#14b8a6' }; // Dark teal
              console.log(`  🔷 RGB analysis: Teal family (${r},${g},${b}) -> Dark teal`);
            } else {
              // Light colors with balanced RGB - determine by subtle differences
              if (r >= g && r >= b) {
                darkColors = { fill: '#7c2d12', stroke: '#ea580c' }; // Orange for warm tones
                console.log(`  🟠 RGB analysis: Warm tone (${r},${g},${b}) -> Dark orange`);
              } else {
                darkColors = { fill: '#1e293b', stroke: '#475569' }; // Default slate
                console.log(`  ⚫ RGB analysis: Neutral tone (${r},${g},${b}) -> Dark slate`);
              }
            }
          }
        }
        
        // Final fallback - use variations based on position 
        if (!darkColors) {
          const defaultVariations = [
            { fill: '#1e293b', stroke: '#475569' }, // Default dark slate
            { fill: '#1f2937', stroke: '#4b5563' }, // Dark gray
            { fill: '#374151', stroke: '#6b7280' }, // Lighter gray
            { fill: '#0f172a', stroke: '#334155' }  // Very dark
          ];
          darkColors = defaultVariations[index % defaultVariations.length];
          console.log(`  ⚫ Fallback variation ${index % defaultVariations.length}`);
        }
        
        // Apply the dark mode colors with high specificity
        rect.style.setProperty('fill', darkColors.fill, 'important');
        rect.style.setProperty('stroke', darkColors.stroke, 'important');
        rect.setAttribute('fill', darkColors.fill);
        rect.setAttribute('stroke', darkColors.stroke);
        
        console.log(`  Applied: fill=${darkColors.fill}, stroke=${darkColors.stroke}`);
      }
    });

    // Ensure text remains white for good contrast
    const nodeTexts = svgElement.querySelectorAll('g.node text, .nodeLabel');
    nodeTexts.forEach((text: Element) => {
      if (text instanceof SVGTextElement || text instanceof HTMLElement) {
        text.style.setProperty('fill', '#ffffff', 'important');
        text.style.setProperty('color', '#ffffff', 'important');
        text.setAttribute('fill', '#ffffff');
      }
    });
    
    console.log('🎨 Color mapping complete!');
  }

  /**
   * Add background colors to cluster/subgraph rectangles for better visibility
   */
  private addClusterBackgrounds(svgElement: SVGElement): void {
    const isDark = this.themeService.isDarkTheme();
    
    // Find cluster groups (subgraphs) by their structure
    const clusterGroups = svgElement.querySelectorAll('g.cluster, g[id*="cluster"]');
    
    console.log(`🎨 Found ${clusterGroups.length} cluster groups`);
    
    clusterGroups.forEach((clusterGroup: Element, index) => {
      // Look for the background rectangle within this cluster
      const clusterRect = clusterGroup.querySelector('rect');
      
      if (clusterRect instanceof SVGRectElement) {
        console.log(`  Processing cluster ${index + 1} background rectangle`);
        
        // Apply background colors specifically for cluster containers - darker for better visibility
        const fillColor = isDark ? '#1e293b' : '#cbd5e1';
        const strokeColor = isDark ? '#475569' : '#64748b';
        
        // Set styling with high specificity
        clusterRect.style.setProperty('fill', fillColor, 'important');
        clusterRect.style.setProperty('stroke', strokeColor, 'important');
        clusterRect.style.setProperty('stroke-width', '2px', 'important');
        clusterRect.style.setProperty('opacity', '0.9', 'important');
        clusterRect.style.setProperty('fill-opacity', '0.9', 'important');
        
        // Also set attributes
        clusterRect.setAttribute('fill', fillColor);
        clusterRect.setAttribute('stroke', strokeColor);
        clusterRect.setAttribute('stroke-width', '1');
        
        console.log(`    ✅ Applied cluster background: ${fillColor}`);
      }
    });
    
    // Alternative approach: Look for large rectangles that might be cluster backgrounds
    const allRects = svgElement.querySelectorAll('rect');
    let clusterCandidates = 0;
    
    allRects.forEach((rect: Element) => {
      if (rect instanceof SVGRectElement) {
        const width = parseFloat(rect.getAttribute('width') || '0');
        const height = parseFloat(rect.getAttribute('height') || '0');
        const currentFill = rect.getAttribute('fill') || '';
        
        // Look for large rectangles with transparent/white/light fills (typical cluster backgrounds)
        if (width > 300 && height > 150 && 
            (currentFill === 'none' || currentFill === 'transparent' || 
             currentFill.includes('#fff') || currentFill.includes('rgb(255'))) {
          
          clusterCandidates++;
          const fillColor = isDark ? '#1e293b' : '#cbd5e1';
          const strokeColor = isDark ? '#475569' : '#64748b';
          
          rect.style.setProperty('fill', fillColor, 'important');
          rect.style.setProperty('stroke', strokeColor, 'important');
          rect.style.setProperty('stroke-width', '2px', 'important');
          rect.style.setProperty('opacity', '0.9', 'important');
          rect.style.setProperty('fill-opacity', '0.9', 'important');
          
          rect.setAttribute('fill', fillColor);
          rect.setAttribute('stroke', strokeColor);
          
          console.log(`    ✅ Applied background to large rectangle: ${width}x${height}`);
        }
      }
    });
    
    console.log(`🎨 Processed ${clusterCandidates} cluster candidate rectangles`);
  }
}
