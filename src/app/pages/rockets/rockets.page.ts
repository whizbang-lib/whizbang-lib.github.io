import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ElementRef,
  ViewChild,
  inject,
} from '@angular/core';
import { RouterModule } from '@angular/router';
import { Title, Meta } from '@angular/platform-browser';
import { ThemeService } from '../../services/theme.service';
import { RocketField, createStarLayers } from '../../shared/rocket-field';

/**
 * 🚀 The launch pad — github.com/whizbang-lib/whizbang-lib.github.io/issues/55
 *
 * A dedicated page for scrolling the rockets, with the home page's other
 * content stripped away so nothing competes with them. Deliberately unlisted:
 * it is absent from the nav and from the generated sitemap (which enumerates
 * only the home page and docs), and carries a `noindex` robots tag, so it is
 * reachable only by someone who knows the URL.
 */
@Component({
  standalone: true,
  selector: 'wb-rockets-page',
  imports: [RouterModule],
  template: `
    <div class="launch-pad" #pad>
      <div class="starfield-container" #starfield></div>

      <section class="pad-panel">
        <h1>🚀 Launch Pad</h1>
        <p class="lede">
          Scroll to fly them. Scroll back up and they turn around and fly with you.
        </p>
        @if (reducedMotion) {
          <p class="hint hint--motion">
            Your system is set to reduced motion, so the fleet is parked.
          </p>
        } @else {
          <p class="hint">
            Nothing here moves on its own — every pixel of travel is paid for
            with a pixel of scroll.
          </p>
        }
      </section>

      <section class="pad-panel pad-panel--mid">
        <p class="milestone">Still climbing…</p>
      </section>

      <section class="pad-panel pad-panel--mid">
        <p class="milestone">Try reversing. 🔄</p>
      </section>

      <section class="pad-panel pad-panel--end">
        <p class="milestone">Orbit achieved. 🛰️</p>
        <a routerLink="/" class="back-link">← back to solid ground</a>
      </section>
    </div>
  `,
  styles: [`
    /* Own the full viewport so the field reads as sky, not as a page section. */
    .launch-pad {
      position: relative;
      background:
        radial-gradient(ellipse at 50% 0%, rgba(123, 63, 248, 0.16), transparent 60%),
        var(--wb-surface-ground, #0b1020);
      color: var(--wb-text-primary, #f3f4f6);
    }

    .starfield-container {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 2;
      overflow: visible;
    }

    .pad-panel {
      position: relative;
      z-index: 3;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      text-align: center;
      padding: 2rem 1.5rem;
    }

    h1 {
      margin: 0;
      font-size: clamp(2rem, 6vw, 3.5rem);
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .lede {
      margin: 0;
      max-width: 34rem;
      font-size: clamp(1rem, 2.2vw, 1.25rem);
      line-height: 1.6;
      opacity: 0.9;
    }

    .hint {
      margin: 0;
      max-width: 30rem;
      font-size: 0.9375rem;
      line-height: 1.6;
      opacity: 0.6;
    }

    .hint--hidden { display: none; }
    .hint--motion { opacity: 0.75; }

    .milestone {
      margin: 0;
      font-size: clamp(1.125rem, 3vw, 1.75rem);
      font-weight: 600;
      opacity: 0.75;
    }

    .back-link {
      margin-top: 0.5rem;
      color: var(--wb-text-primary, #f3f4f6);
      opacity: 0.7;
      text-decoration: none;
      border-bottom: 1px solid currentColor;
      padding-bottom: 2px;
      font-size: 0.9375rem;
    }

    .back-link:hover { opacity: 1; }
  `],
})
export class RocketsPage implements OnInit, AfterViewInit, OnDestroy {
  private themeService = inject(ThemeService);
  private title = inject(Title);
  private meta = inject(Meta);

  @ViewChild('starfield') starfield!: ElementRef<HTMLElement>;
  @ViewChild('pad') pad!: ElementRef<HTMLElement>;

  /** Honours the OS "reduce motion" setting by parking the fleet entirely. */
  reducedMotion = false;

  private field = new RocketField();
  private starLayers: HTMLElement[] = [];
  private scrollHandler: (() => void) | null = null;
  private ticking = false;
  private lastScrollY = 0;
  private direction = 1;

  ngOnInit(): void {
    this.title.setTitle('Launch Pad 🚀 · Whizbang');
    // Unlisted, and we would rather it stayed that way.
    this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
    this.reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  }

  ngAfterViewInit(): void {
    if (this.reducedMotion) return;
    this.field.init(this.starfield.nativeElement, {
      isDark: this.themeService.isDarkTheme(),
      // A dedicated page can afford a bigger fleet than the home page's cameo.
      meteors: 14,
      rockets: 10,
    });
    this.starLayers = createStarLayers(
      this.pad.nativeElement.querySelectorAll('.pad-panel'),
      this.themeService.isDarkTheme(),
    );

    this.lastScrollY = window.scrollY;
    this.scrollHandler = () => {
      if (this.ticking) return;
      this.ticking = true;
      requestAnimationFrame(() => {
        this.update();
        this.ticking = false;
      });
    };
    window.addEventListener('scroll', this.scrollHandler, { passive: true });
  }

  ngOnDestroy(): void {
    if (this.scrollHandler) {
      window.removeEventListener('scroll', this.scrollHandler);
      this.scrollHandler = null;
    }
    this.field.destroy();
    for (const l of this.starLayers) l.remove();
    this.starLayers = [];
    this.meta.removeTag('name="robots"');
  }

  private update(): void {
    const scrollY = window.scrollY;
    const raw = scrollY - this.lastScrollY;
    if (raw !== 0) this.direction = raw > 0 ? 1 : -1;
    this.lastScrollY = scrollY;

    const speeds = [0.03, 0.08, 0.15];
    this.starLayers.forEach((layer, i) => {
      layer.style.transform = `translateY(${-scrollY * speeds[i % 3]}px)`;
    });

    this.field.update(Math.abs(raw), this.direction);
  }
}
