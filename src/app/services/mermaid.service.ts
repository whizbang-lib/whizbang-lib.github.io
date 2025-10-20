import { Injectable, inject, effect } from '@angular/core';
import mermaid from 'mermaid';
import { ThemeService } from './theme.service';

@Injectable({ providedIn: 'root' })
export class MermaidService {
  private initialized = false;
  private themeService = inject(ThemeService);
  private currentTheme: 'light' | 'dark' = 'light';

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
          /* Force consistent sizing regardless of content */
          svg {
            width: 1200px !important;
            height: 800px !important;
            min-width: 1200px !important;
            min-height: 800px !important;
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
            padding: 60px 80px !important;
            margin-top: 50px !important;
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
            width: 500px !important;
            height: 500px !important;
          }
          defs marker path {
            fill: ${isDark ? '#94a3b8' : '#64748b'} !important;
            stroke: ${isDark ? '#94a3b8' : '#64748b'} !important;
            stroke-width: 20px !important;
            transform: scale(50) !important;
          }
        `,  // Style cluster/subgraph labels and arrowheads - centered with larger headers and HUGE arrows
        flowchart: {
          htmlLabels: true,  // Enable HTML labels for proper text rendering
          useMaxWidth: false,  // Disable auto-scaling
          padding: 80,
          diagramPadding: 80,
          nodeSpacing: 300,  // Horizontal spacing between nodes in LR graphs (default - can be overridden per-diagram)
          rankSpacing: 300,  // Spacing between ranks/levels within the flowchart
          curve: 'basis',  // Use basis curve for smoother routing around obstacles
          subGraphTitleMargin: {
            bottom: 300  // Space between subgraph title and content
          }
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

            // Primary colors (main nodes)
            primaryColor: '#1e3a5f',
            primaryTextColor: '#ffffff',
            primaryBorderColor: '#60a5fa',

            // Secondary colors
            secondaryColor: '#1e293b',
            secondaryTextColor: '#ffffff',
            secondaryBorderColor: '#64748b',

            // Tertiary colors
            tertiaryColor: '#334155',
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

            // Specific colors to override any light backgrounds
            c0: '#1e3a5f',  // Used for first color in color scheme
            c1: '#1e293b',  // Used for second color
            c2: '#334155',  // Used for third color
            c3: '#475569',  // Used for fourth color
            c4: '#64748b',  // Used for fifth color

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

  async renderDiagram(id: string, code: string, fontSize?: string): Promise<{ svg: string }> {
    if (!this.initialized) {
      this.initializeMermaid();
    }
    
    // If custom fontSize is provided, calculate proportional sizes and update configuration
    if (fontSize) {
      const baseFontSize = parseInt(fontSize.replace('px', ''));
      const isDark = this.themeService.isDarkTheme();
      
      // Calculate proportional spacing - 3x font size for header spacing
      const headerSpacing = Math.round(baseFontSize * 3);
      
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
      `;
      
      // Update configuration with proportional spacing and HTML labels
      mermaid.mermaidAPI.updateSiteConfig({
        themeCSS: scaledThemeCSS,
        flowchart: {
          htmlLabels: true,  // Enable HTML labels for proper text rendering
          useMaxWidth: false,
          padding: 80,
          diagramPadding: 80,
          nodeSpacing: 600,  // Increased horizontal spacing between subgraphs
          rankSpacing: 300,
          curve: 'basis',
          subGraphTitleMargin: {
            bottom: headerSpacing  // Proportional header spacing (3x font size)
          }
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
    
    // Then add colored arrows based on semantic classes
    this.addArrowMarkers(svgElement);
    
    // If we used custom fontSize, restore the original configuration
    if (fontSize) {
      this.initialized = false; // Force re-initialization with original settings
      this.initializeMermaid();
    }
    
    return { svg: new XMLSerializer().serializeToString(svgElement) };
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
    
    // Semantic layer colors for arrows and lines
    const layerColors: { [key: string]: string } = {
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
      marker.setAttribute('viewBox', '0 0 10 10');
      marker.setAttribute('refX', '8');
      marker.setAttribute('refY', '3');
      marker.setAttribute('markerWidth', '8');
      marker.setAttribute('markerHeight', '8');
      marker.setAttribute('orient', 'auto');
      
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('points', '0,0 0,6 9,3');
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
        // Fallback to default arrow if no semantic class found
        const defaultColor = '#64748b';
        path.setAttribute('stroke', defaultColor);
        path.setAttribute('stroke-width', '16');
        path.setAttribute('style', `stroke: ${defaultColor} !important; stroke-width: 16px !important;`);
        
        // Create default arrow if not exists
        if (!defs.querySelector('#arrow-default')) {
          const defaultMarker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
          defaultMarker.setAttribute('id', 'arrow-default');
          defaultMarker.setAttribute('viewBox', '0 0 10 10');
          defaultMarker.setAttribute('refX', '8');
          defaultMarker.setAttribute('refY', '3');
          defaultMarker.setAttribute('markerWidth', '8');
          defaultMarker.setAttribute('markerHeight', '8');
          defaultMarker.setAttribute('orient', 'auto');
          
          const defaultPolygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          defaultPolygon.setAttribute('points', '0,0 0,6 9,3');
          defaultPolygon.setAttribute('fill', defaultColor);
          
          defaultMarker.appendChild(defaultPolygon);
          defs.appendChild(defaultMarker);
        }
        
        path.setAttribute('marker-end', 'url(#arrow-default)');
        console.log(`Applied default arrow and stroke to path ${index + 1}`);
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

      return undefined;
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
}
