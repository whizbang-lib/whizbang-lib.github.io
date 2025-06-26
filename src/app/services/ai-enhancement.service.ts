import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of, from } from 'rxjs';
import { map, catchError, tap } from 'rxjs/operators';

// Browser-side AI enhancement states
export enum AIEnhancementState {
  NOT_STARTED = 'not_started',
  CHECKING_CAPABILITY = 'checking_capability',
  LOADING = 'loading',
  READY = 'ready',
  FAILED = 'failed',
  DISABLED = 'disabled'
}

export interface DeviceCapability {
  hasWebAssembly: boolean;
  estimatedMemory: number; // GB
  connectionSpeed: 'slow' | 'fast' | 'unknown';
  isSupported: boolean;
  reason?: string;
}

export interface AIEnhancementProgress {
  state: AIEnhancementState;
  progress: number; // 0-100
  message: string;
  canDismiss: boolean;
}

export interface SemanticSearchResult {
  chunkId: string;
  similarity: number;
  boost: number;
}

@Injectable({
  providedIn: 'root'
})
export class AIEnhancementService {
  private enhancementState$ = new BehaviorSubject<AIEnhancementState>(AIEnhancementState.NOT_STARTED);
  private progress$ = new BehaviorSubject<AIEnhancementProgress>({
    state: AIEnhancementState.NOT_STARTED,
    progress: 0,
    message: 'AI enhancement not started',
    canDismiss: false
  });

  private deviceCapability: DeviceCapability | null = null;
  private embeddingPipeline: any = null;
  private loadingTimeout: any = null;
  private isUserDismissed = false;

  // Configuration
  private readonly MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
  private readonly MIN_MEMORY_GB = 2;
  private readonly LOAD_DELAY_MS = 3000; // Wait 3 seconds after page load
  private readonly SIMILARITY_THRESHOLD = 0.3;

  constructor() {
    // Start the enhancement process after a delay
    setTimeout(() => {
      if (!this.isUserDismissed) {
        this.initializeAIEnhancement();
      }
    }, this.LOAD_DELAY_MS);
  }

  // Public observables
  getEnhancementState(): Observable<AIEnhancementState> {
    return this.enhancementState$.asObservable();
  }

  getProgress(): Observable<AIEnhancementProgress> {
    return this.progress$.asObservable();
  }

  // User can dismiss the enhancement
  dismissEnhancement(): void {
    this.isUserDismissed = true;
    this.updateState(AIEnhancementState.DISABLED, 'AI enhancement dismissed by user', 0, false);
    
    // Cancel any ongoing loading
    if (this.loadingTimeout) {
      clearTimeout(this.loadingTimeout);
    }
  }

  // Check if AI enhancement is ready for use
  isAIReady(): boolean {
    return this.enhancementState$.value === AIEnhancementState.READY && this.embeddingPipeline !== null;
  }

  // Get device capability information
  getDeviceCapability(): DeviceCapability | null {
    return this.deviceCapability;
  }

  // Main initialization method
  private async initializeAIEnhancement(): Promise<void> {
    try {
      // Step 1: Check device capability
      this.updateState(AIEnhancementState.CHECKING_CAPABILITY, 'Checking device capabilities...', 10, false);
      
      const capability = await this.checkDeviceCapability();
      this.deviceCapability = capability;

      if (!capability.isSupported) {
        this.updateState(AIEnhancementState.FAILED, capability.reason || 'Device not supported', 0, true);
        return;
      }

      // Step 2: Load AI model
      this.updateState(AIEnhancementState.LOADING, 'Loading AI model for enhanced search...', 20, true);
      
      await this.loadAIModel();

      // Step 3: Ready
      this.updateState(AIEnhancementState.READY, 'Smart search is now available!', 100, true);
      
      // Auto-dismiss success message after 3 seconds
      setTimeout(() => {
        if (this.enhancementState$.value === AIEnhancementState.READY) {
          this.updateState(AIEnhancementState.READY, '', 100, false);
        }
      }, 3000);

    } catch (error) {
      console.warn('AI enhancement failed:', error);
      this.updateState(AIEnhancementState.FAILED, 'AI enhancement failed - using standard search', 0, true);
    }
  }

  // Device capability detection
  private async checkDeviceCapability(): Promise<DeviceCapability> {
    const capability: DeviceCapability = {
      hasWebAssembly: false,
      estimatedMemory: 0,
      connectionSpeed: 'unknown',
      isSupported: false,
      reason: undefined
    };

    // Check WebAssembly support
    capability.hasWebAssembly = typeof WebAssembly === 'object' && 
                                typeof WebAssembly.instantiate === 'function';

    if (!capability.hasWebAssembly) {
      capability.reason = 'WebAssembly not supported';
      return capability;
    }

    // Estimate available memory
    if ('deviceMemory' in navigator) {
      capability.estimatedMemory = (navigator as any).deviceMemory;
    } else {
      // Fallback estimation based on other indicators
      capability.estimatedMemory = this.estimateMemory();
    }

    if (capability.estimatedMemory < this.MIN_MEMORY_GB) {
      capability.reason = `Insufficient memory (${capability.estimatedMemory}GB < ${this.MIN_MEMORY_GB}GB required)`;
      return capability;
    }

    // Check connection speed
    capability.connectionSpeed = this.estimateConnectionSpeed();
    
    if (capability.connectionSpeed === 'slow') {
      capability.reason = 'Slow connection detected - skipping AI enhancement';
      return capability;
    }

    // All checks passed
    capability.isSupported = true;
    return capability;
  }

  // Memory estimation fallback
  private estimateMemory(): number {
    // Conservative estimates based on browser capabilities
    if ('hardwareConcurrency' in navigator && navigator.hardwareConcurrency >= 4) {
      return 4; // Assume 4GB+ for quad-core devices
    } else if ('hardwareConcurrency' in navigator && navigator.hardwareConcurrency >= 2) {
      return 2; // Assume 2GB for dual-core devices
    } else {
      return 1; // Conservative estimate for older devices
    }
  }

  // Connection speed estimation
  private estimateConnectionSpeed(): 'slow' | 'fast' | 'unknown' {
    if ('connection' in navigator) {
      const connection = (navigator as any).connection;
      
      if (connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g') {
        return 'slow';
      } else if (connection.effectiveType === '3g' && connection.downlink < 1.5) {
        return 'slow';
      } else {
        return 'fast';
      }
    }
    
    return 'unknown'; // Assume fast if we can't detect
  }

  // Load AI model with progress updates
  private async loadAIModel(): Promise<void> {
    try {
      // Dynamic import to avoid loading at startup
      const { pipeline } = await import('@xenova/transformers');
      
      this.updateState(AIEnhancementState.LOADING, 'Downloading AI model...', 30, true);

      this.embeddingPipeline = await pipeline('feature-extraction', this.MODEL_NAME, {
        quantized: true,
        progress_callback: (data: any) => {
          if (data.status === 'progress' && data.progress) {
            const progress = Math.min(90, 30 + (data.progress * 60)); // 30-90% range
            this.updateState(AIEnhancementState.LOADING, `Loading: ${data.file} (${Math.round(data.progress * 100)}%)`, progress, true);
          }
        }
      });

      this.updateState(AIEnhancementState.LOADING, 'AI model ready, initializing...', 95, true);

    } catch (error) {
      console.error('Failed to load AI model:', error);
      throw new Error('AI model loading failed');
    }
  }

  // Generate embeddings for search queries
  async generateQueryEmbedding(query: string): Promise<number[] | null> {
    if (!this.isAIReady() || !query.trim()) {
      return null;
    }

    try {
      const embeddings = await this.embeddingPipeline(query, {
        pooling: 'mean',
        normalize: true
      });

      return Array.from(embeddings.data);
    } catch (error) {
      console.warn('Failed to generate query embedding:', error);
      return null;
    }
  }

  // Calculate semantic similarity between query and document chunks
  calculateSemanticSimilarity(queryEmbedding: number[], chunkEmbeddings: { [chunkId: string]: number[] }): SemanticSearchResult[] {
    if (!queryEmbedding || !chunkEmbeddings) {
      return [];
    }

    const results: SemanticSearchResult[] = [];

    for (const [chunkId, embedding] of Object.entries(chunkEmbeddings)) {
      if (!embedding || embedding.length !== queryEmbedding.length) {
        continue;
      }

      const similarity = this.cosineSimilarity(queryEmbedding, embedding);
      
      if (similarity >= this.SIMILARITY_THRESHOLD) {
        results.push({
          chunkId,
          similarity,
          boost: this.calculateSemanticBoost(similarity)
        });
      }
    }

    // Sort by similarity (highest first)
    return results.sort((a, b) => b.similarity - a.similarity);
  }

  // Calculate cosine similarity between two vectors
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  // Convert similarity score to search boost factor
  private calculateSemanticBoost(similarity: number): number {
    // Map similarity (0.3-1.0) to boost factor (1.2-3.0)
    const minSimilarity = this.SIMILARITY_THRESHOLD;
    const maxSimilarity = 1.0;
    const minBoost = 1.2;
    const maxBoost = 3.0;

    const normalizedSimilarity = (similarity - minSimilarity) / (maxSimilarity - minSimilarity);
    return minBoost + (normalizedSimilarity * (maxBoost - minBoost));
  }

  // Update state and progress
  private updateState(state: AIEnhancementState, message: string, progress: number, canDismiss: boolean): void {
    this.enhancementState$.next(state);
    this.progress$.next({
      state,
      progress,
      message,
      canDismiss
    });
  }

  // Clean up resources
  ngOnDestroy(): void {
    if (this.loadingTimeout) {
      clearTimeout(this.loadingTimeout);
    }
    this.embeddingPipeline = null;
  }
}