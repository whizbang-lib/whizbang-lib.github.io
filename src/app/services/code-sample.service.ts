import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject, map, catchError, of } from 'rxjs';
import { CodeSampleMetadata, CodeFile } from '../components/advanced-code-sample.component';

export interface CodeSampleIndex {
  samples: CodeSampleMetadata[];
  categories: string[];
  frameworks: string[];
  difficulties: string[];
}

@Injectable({
  providedIn: 'root'
})
export class CodeSampleService {
  private samplesSubject = new BehaviorSubject<CodeSampleMetadata[]>([]);
  private indexSubject = new BehaviorSubject<CodeSampleIndex | null>(null);

  samples$ = this.samplesSubject.asObservable();
  index$ = this.indexSubject.asObservable();

  constructor(private http: HttpClient) {
    this.loadSamplesIndex();
  }

  /**
   * Load the main index of all available code samples
   */
  private loadSamplesIndex(): void {
    this.http.get<CodeSampleIndex>('assets/code-samples/index.json')
      .pipe(
        catchError(error => {
          console.error('Failed to load code samples index:', error);
          return of({
            samples: [],
            categories: [],
            frameworks: [],
            difficulties: []
          });
        })
      )
      .subscribe(index => {
        this.indexSubject.next(index);
        this.samplesSubject.next(index.samples);
      });
  }

  /**
   * Get all available code samples
   */
  getAllSamples(): Observable<CodeSampleMetadata[]> {
    return this.samples$;
  }

  /**
   * Get a specific code sample by ID
   */
  getSample(id: string): Observable<CodeSampleMetadata | null> {
    return this.samples$.pipe(
      map(samples => samples.find(sample => sample.id === id) || null)
    );
  }

  /**
   * Filter samples by various criteria
   */
  filterSamples(filters: {
    framework?: string;
    difficulty?: string;
    tags?: string[];
    search?: string;
  }): Observable<CodeSampleMetadata[]> {
    return this.samples$.pipe(
      map(samples => {
        return samples.filter(sample => {
          // Framework filter
          if (filters.framework && sample.framework !== filters.framework) {
            return false;
          }

          // Difficulty filter
          if (filters.difficulty && sample.difficulty !== filters.difficulty) {
            return false;
          }

          // Tags filter
          if (filters.tags && filters.tags.length > 0) {
            const hasMatchingTag = filters.tags.some(tag => 
              sample.tags?.includes(tag)
            );
            if (!hasMatchingTag) {
              return false;
            }
          }

          // Search filter
          if (filters.search) {
            const searchTerm = filters.search.toLowerCase();
            const searchableText = [
              sample.title,
              sample.description,
              ...(sample.tags || []),
              sample.framework
            ].join(' ').toLowerCase();
            
            if (!searchableText.includes(searchTerm)) {
              return false;
            }
          }

          return true;
        });
      })
    );
  }

  /**
   * Get samples by framework
   */
  getSamplesByFramework(framework: string): Observable<CodeSampleMetadata[]> {
    return this.filterSamples({ framework });
  }

  /**
   * Get samples by difficulty
   */
  getSamplesByDifficulty(difficulty: string): Observable<CodeSampleMetadata[]> {
    return this.filterSamples({ difficulty });
  }

  /**
   * Search samples by text
   */
  searchSamples(query: string): Observable<CodeSampleMetadata[]> {
    return this.filterSamples({ search: query });
  }

  /**
   * Get all available frameworks
   */
  getFrameworks(): Observable<string[]> {
    return this.index$.pipe(
      map(index => index?.frameworks || [])
    );
  }

  /**
   * Get all available categories
   */
  getCategories(): Observable<string[]> {
    return this.index$.pipe(
      map(index => index?.categories || [])
    );
  }

  /**
   * Get all available difficulties
   */
  getDifficulties(): Observable<string[]> {
    return this.index$.pipe(
      map(index => index?.difficulties || [])
    );
  }

  /**
   * Get trending/popular samples (based on some criteria)
   */
  getTrendingSamples(limit = 5): Observable<CodeSampleMetadata[]> {
    return this.samples$.pipe(
      map(samples => {
        // Simple trending logic - you could enhance this
        return samples
          .filter(sample => sample.tags?.includes('popular') || sample.tags?.includes('trending'))
          .slice(0, limit);
      })
    );
  }

  /**
   * Get recently added samples
   */
  getRecentSamples(limit = 5): Observable<CodeSampleMetadata[]> {
    return this.samples$.pipe(
      map(samples => {
        // Assuming samples are ordered by creation date
        return samples.slice(0, limit);
      })
    );
  }

  /**
   * Get related samples based on tags and framework
   */
  getRelatedSamples(currentSample: CodeSampleMetadata, limit = 3): Observable<CodeSampleMetadata[]> {
    return this.samples$.pipe(
      map(samples => {
        const related = samples
          .filter(sample => sample.id !== currentSample.id)
          .map(sample => {
            let score = 0;
            
            // Same framework gets high score
            if (sample.framework === currentSample.framework) {
              score += 10;
            }
            
            // Shared tags get points
            const sharedTags = sample.tags?.filter(tag => 
              currentSample.tags?.includes(tag)
            ) || [];
            score += sharedTags.length * 5;
            
            // Same difficulty gets points
            if (sample.difficulty === currentSample.difficulty) {
              score += 3;
            }
            
            return { sample, score };
          })
          .filter(item => item.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
          .map(item => item.sample);
          
        return related;
      })
    );
  }

  /**
   * Create a new code sample (for admin/editor functionality)
   */
  createSample(sample: CodeSampleMetadata): Observable<boolean> {
    // In a real app, this would POST to an API
    console.log('Creating sample:', sample);
    
    // For now, just add to local state
    const currentSamples = this.samplesSubject.value;
    this.samplesSubject.next([...currentSamples, sample]);
    
    return of(true);
  }

  /**
   * Update an existing code sample
   */
  updateSample(sample: CodeSampleMetadata): Observable<boolean> {
    // In a real app, this would PUT to an API
    console.log('Updating sample:', sample);
    
    const currentSamples = this.samplesSubject.value;
    const index = currentSamples.findIndex(s => s.id === sample.id);
    
    if (index >= 0) {
      const updatedSamples = [...currentSamples];
      updatedSamples[index] = sample;
      this.samplesSubject.next(updatedSamples);
      return of(true);
    }
    
    return of(false);
  }

  /**
   * Delete a code sample
   */
  deleteSample(id: string): Observable<boolean> {
    // In a real app, this would DELETE to an API
    console.log('Deleting sample:', id);
    
    const currentSamples = this.samplesSubject.value;
    const filtered = currentSamples.filter(s => s.id !== id);
    this.samplesSubject.next(filtered);
    
    return of(true);
  }

  /**
   * Generate ZIP download for a code sample
   */
  generateZipDownload(sample: CodeSampleMetadata): void {
    // This would generate and trigger download of a ZIP file
    // For now, just log the action
    console.log('Generating ZIP for sample:', sample.id);
    
    // In a real implementation, you'd use a library like JSZip
    // to create the ZIP file with all the sample files
  }

  /**
   * Get sample statistics
   */
  getSampleStats(): Observable<{
    totalSamples: number;
    frameworkCounts: { [framework: string]: number };
    difficultyCounts: { [difficulty: string]: number };
    tagCounts: { [tag: string]: number };
  }> {
    return this.samples$.pipe(
      map(samples => {
        const frameworkCounts: { [framework: string]: number } = {};
        const difficultyCounts: { [difficulty: string]: number } = {};
        const tagCounts: { [tag: string]: number } = {};

        samples.forEach(sample => {
          // Count frameworks
          if (sample.framework) {
            frameworkCounts[sample.framework] = (frameworkCounts[sample.framework] || 0) + 1;
          }

          // Count difficulties
          if (sample.difficulty) {
            difficultyCounts[sample.difficulty] = (difficultyCounts[sample.difficulty] || 0) + 1;
          }

          // Count tags
          sample.tags?.forEach(tag => {
            tagCounts[tag] = (tagCounts[tag] || 0) + 1;
          });
        });

        return {
          totalSamples: samples.length,
          frameworkCounts,
          difficultyCounts,
          tagCounts
        };
      })
    );
  }
}
