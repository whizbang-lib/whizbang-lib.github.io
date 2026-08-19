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
import { ButtonModule } from 'primeng/button';
import { ThemeService } from '../../services/theme.service';
import { EnhancedCodeBlockV2Component } from '../../components/enhanced-code-block-v2.component';
import { RocketField, createStarLayers } from '../../shared/rocket-field';

@Component({
  standalone: true,
  selector: 'wb-home-page',
  imports: [RouterModule, ButtonModule, EnhancedCodeBlockV2Component],
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
})
export class HomePage implements OnInit, OnDestroy, AfterViewInit {
  private themeService = inject(ThemeService);

  @ViewChild('progressBar') progressBar!: ElementRef<HTMLElement>;
  @ViewChild('heroWrapper') heroWrapper!: ElementRef<HTMLElement>;
  @ViewChild('diffWrapper') diffWrapper!: ElementRef<HTMLElement>;
  @ViewChild('codeWrapper') codeWrapper!: ElementRef<HTMLElement>;
  @ViewChild('slideWrapper') slideWrapper!: ElementRef<HTMLElement>;
  @ViewChild('crossfadeWrapper') crossfadeWrapper!: ElementRef<HTMLElement>;
  @ViewChild('starfield') starfield!: ElementRef<HTMLElement>;
  @ViewChild('scrollIndicator') scrollIndicator!: ElementRef<HTMLElement>;

  private scrollHandler: (() => void) | null = null;
  private observer!: IntersectionObserver;
  private ticking = false;
  private readonly STICKY_TOP = 70;
  private lastScrollY = 0;
  private scrollDirection = 1; // 1 = down, -1 = up
  private rocketField = new RocketField();

  // --- Code samples ---

  codePartCommands = `public record CreateOrder(OrderId Id, CustomerId Customer, Money Total);
public record OrderCreated(OrderId Id, CustomerId Customer, Money Total);
public record ShipOrder(OrderId Id);
public record OrderShipped(OrderId Id, DateTimeOffset ShippedAt);`;

  codePartReceptor = `public class OrderReceptor : Receptor<OrderId> {
    public Money Total { get; private set; }
    public OrderStatus Status { get; private set; }

    void Apply(OrderCreated e) {
        Id = e.Id;
        Total = e.Total;
        Status = OrderStatus.Created;
    }

    void Apply(OrderShipped e) =>
        Status = OrderStatus.Shipped;

    public static OrderReceptor Handle(CreateOrder cmd) =>
        new OrderReceptor().Emit(new OrderCreated(cmd.Id, cmd.Customer, cmd.Total));
}`;

  codePartPerspective = `public class OrderSummary : Perspective {
    public int TotalOrders { get; set; }
    public int ShippedOrders { get; set; }
    public Money Revenue { get; set; }

    void Apply(OrderCreated e) {
        TotalOrders++;
        Revenue += e.Total;
    }

    void Apply(OrderShipped e) => ShippedOrders++;
}`;

  cliCommands = `# Live diagnostics dashboard
dotnet whiz diag

# Rebuild a projection from events
dotnet whiz replay OrderSummary`;

  // --- Utilities ---

  private clamp(val: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, val));
  }

  private lerp(start: number, end: number, t: number): number {
    return start + (end - start) * t;
  }

  private easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  // --- Scroll-to-next ---

  scrollToNextSection() {
    const stopPoints: number[] = [];

    // Helper: get the scrollY where a pinned section reaches a specific progress
    const progressStop = (wrapper: ElementRef<HTMLElement> | undefined, progress: number) => {
      if (!wrapper?.nativeElement) return;
      const rect = wrapper.nativeElement.getBoundingClientRect();
      const scrollDist = rect.height - (window.innerHeight - this.STICKY_TOP);
      if (scrollDist <= 0) return;
      const sectionTop = rect.top + window.scrollY - this.STICKY_TOP;
      stopPoints.push(sectionTop + scrollDist * progress);
    };

    // Differentiators: each item at its peak (0.17, 0.5, 0.83)
    progressStop(this.diffWrapper, 0.17);
    progressStop(this.diffWrapper, 0.5);
    progressStop(this.diffWrapper, 0.83);

    // Code showcase: each code block fully revealed + scrolled into view
    progressStop(this.codeWrapper, 0.12);  // headline + Commands & Events
    progressStop(this.codeWrapper, 0.28);  // Receptor (Handler)
    progressStop(this.codeWrapper, 0.52);  // Perspective (Projection)
    progressStop(this.codeWrapper, 0.78);  // CLI Tools

    // Capabilities: cards fully in view
    const capSection = document.querySelector('.capabilities-section');
    if (capSection) {
      const capTop = capSection.getBoundingClientRect().top + window.scrollY - this.STICKY_TOP + 150;
      stopPoints.push(capTop);
    }

    // Use cases visible, then roadmap visible
    progressStop(this.slideWrapper, 0);
    progressStop(this.slideWrapper, 1.0);

    // IDE visible, then CTA visible
    progressStop(this.crossfadeWrapper, 0.15);
    progressStop(this.crossfadeWrapper, 0.7);

    // Sort and find next stop
    stopPoints.sort((a, b) => a - b);
    const currentScroll = window.scrollY;
    const nextStop = stopPoints.find((p) => p > currentScroll + 30);

    if (nextStop !== undefined) {
      window.scrollTo({ top: nextStop, behavior: 'smooth' });
    }
  }

  private getSectionProgress(wrapper: ElementRef<HTMLElement>): number {
    const rect = wrapper.nativeElement.getBoundingClientRect();
    const sectionHeight = window.innerHeight - this.STICKY_TOP;
    const scrollDistance = rect.height - sectionHeight;
    if (scrollDistance <= 0) return 0;
    return this.clamp((this.STICKY_TOP - rect.top) / scrollDistance, 0, 1);
  }

  // --- Lifecycle ---

  getMeetWhizbangPath(): string {
    const isDark = this.themeService.isDarkTheme();
    return isDark
      ? 'assets/branding/meet-whizbang-dark.svg'
      : 'assets/branding/meet-whizbang-light.svg';
  }

  ngOnInit() {}

  ngAfterViewInit() {
    this.setupStarfield();
    this.setupRockets();
    this.setupScrollHandler();
    this.setupIntersectionObserver();
    this.setupScrollIndicatorCentering();
  }

  ngOnDestroy() {
    if (this.scrollHandler) {
      window.removeEventListener('scroll', this.scrollHandler);
    }
    if (this.observer) {
      this.observer.disconnect();
    }
    if (this.contentResizeObserver) {
      this.contentResizeObserver.disconnect();
    }
    window.removeEventListener('resize', this.centeringRecenter);
    this.rocketField.destroy();
  }

  // Horizontally center the fixed "scroll to explore" indicator over the main
  // content area (which is offset by the sidebar). Extracted so it can run on a
  // ResizeObserver, not only during scroll.
  private centerScrollIndicator() {
    const el = this.scrollIndicator?.nativeElement;
    if (!el) return;
    const main = document.querySelector('.main-content') || document.body;
    const mainRect = main.getBoundingClientRect();
    el.style.left = `${mainRect.left + mainRect.width / 2}px`;
    el.style.transform = 'translateX(-50%)';
  }

  // The indicator's left offset used to be computed only during scroll, so on
  // first paint (before the sidebar/content layout settled) it centered on the
  // full viewport and only snapped into place once the user scrolled. Observe
  // the content area so it re-centers on layout settle, sidebar toggle, and resize.
  private contentResizeObserver?: ResizeObserver;
  private centeringRecenter = () => this.centerScrollIndicator();
  private setupScrollIndicatorCentering() {
    this.centerScrollIndicator();
    // Re-center over the next frames + shortly after, to catch the layout/sidebar
    // settling on first paint (a position-only shift a ResizeObserver won't see).
    requestAnimationFrame(() => {
      this.centerScrollIndicator();
      requestAnimationFrame(this.centeringRecenter);
    });
    setTimeout(this.centeringRecenter, 350);
    // Keep it correct on viewport resize.
    window.addEventListener('resize', this.centeringRecenter, { passive: true });
    // And on content-area size changes (sidebar toggle that resizes main-content).
    const main = document.querySelector('.main-content');
    if (main && typeof ResizeObserver !== 'undefined') {
      this.contentResizeObserver = new ResizeObserver(this.centeringRecenter);
      this.contentResizeObserver.observe(main);
    }
  }

  // --- Starfield & Rockets ---

  private starLayers: HTMLElement[] = [];

  private setupStarfield() {
    this.starLayers = createStarLayers(
      document.querySelectorAll('.pinned-section, .capabilities-section'),
      this.themeService.isDarkTheme(),
    );
  }

  private setupRockets() {
    if (!this.starfield?.nativeElement) return;
    this.rocketField.init(this.starfield.nativeElement, {
      isDark: this.themeService.isDarkTheme(),
    });
  }

  // --- Scroll system ---

  private setupScrollHandler() {
    this.scrollHandler = () => {
      if (!this.ticking) {
        this.ticking = true;
        requestAnimationFrame(() => {
          this.updateAnimations();
          this.ticking = false;
        });
      }
    };
    window.addEventListener('scroll', this.scrollHandler, { passive: true });
    // Initial call to set state
    requestAnimationFrame(() => this.updateAnimations());
  }

  private updateAnimations() {
    const vh = window.innerHeight;
    const scrollY = window.scrollY;
    const docHeight = document.documentElement.scrollHeight;
    const rawDelta = scrollY - this.lastScrollY;
    const scrollDelta = Math.abs(rawDelta);
    if (rawDelta !== 0) {
      this.scrollDirection = rawDelta > 0 ? 1 : -1;
    }
    this.lastScrollY = scrollY;

    // Progress bar + scroll indicator visibility + centering
    const overallProgress = this.clamp(scrollY / (docHeight - vh), 0, 1);
    if (this.scrollIndicator?.nativeElement) {
      this.scrollIndicator.nativeElement.style.opacity = overallProgress > 0.92 ? '0' : '1';
      this.centerScrollIndicator();
    }
    if (this.progressBar?.nativeElement) {
      this.progressBar.nativeElement.style.transform = `scaleX(${overallProgress})`;
    }

    // Starfield parallax — inner star layers shift at different rates
    const speeds = [0.03, 0.08, 0.15];
    this.starLayers.forEach((layer, i) => {
      const speed = speeds[i % 3];
      layer.style.transform = `translateY(${-scrollY * speed}px)`;
    });

    // Rockets & meteors — travel with the scroll; reversing direction turns
    // them around. Shared with the /to-the-moon page via RocketField.
    this.rocketField.update(scrollDelta, this.scrollDirection);

    // Hero
    if (this.heroWrapper?.nativeElement) {
      this.animateHero(this.getSectionProgress(this.heroWrapper));
    }

    // Differentiators
    if (this.diffWrapper?.nativeElement) {
      this.animateDiff(this.getSectionProgress(this.diffWrapper));
    }

    // Code showcase
    if (this.codeWrapper?.nativeElement) {
      this.animateCode(this.getSectionProgress(this.codeWrapper));
    }

    // Use cases / roadmap slide
    if (this.slideWrapper?.nativeElement) {
      this.animateSlide(this.getSectionProgress(this.slideWrapper));
    }

    // IDE ↔ CTA crossfade
    if (this.crossfadeWrapper?.nativeElement) {
      this.animateCrossfade(this.getSectionProgress(this.crossfadeWrapper));
    }
  }

  // --- Section animations ---

  private animateHero(progress: number) {
    const el = this.heroWrapper.nativeElement;
    const content = el.querySelector('.hero-content') as HTMLElement | null;
    const indicator = el.querySelector('.scroll-indicator') as HTMLElement | null;

    // Delay fade — content stays at full opacity for first 30%, then fades
    const fadeProgress = this.clamp((progress - 0.3) / 0.7, 0, 1);
    const eased = this.easeOutCubic(fadeProgress);

    if (content) {
      content.style.opacity = `${1 - eased}`;
      content.style.transform = `scale(${1 - eased * 0.08}) translateY(${-eased * 60}px)`;
    }
    if (indicator) {
      indicator.style.opacity = `${this.clamp(1 - progress * 3, 0, 1)}`;
    }
  }

  private animateDiff(progress: number) {
    const el = this.diffWrapper.nativeElement;
    const items = el.querySelectorAll('.diff-item');
    const bgGlow = el.querySelector('.diff-bg-glow') as HTMLElement | null;
    const count = items.length;

    items.forEach((item, i) => {
      const htmlItem = item as HTMLElement;
      const itemStart = i / count;
      const itemEnd = (i + 1) / count;
      const itemProgress = this.clamp(
        (progress - itemStart) / (itemEnd - itemStart),
        0,
        1
      );

      // Fade in 0-15%, hold 15-85%, fade out 85-100%
      let opacity: number;
      if (itemProgress < 0.15) {
        opacity = itemProgress / 0.15;
      } else if (itemProgress < 0.85) {
        opacity = 1;
      } else {
        opacity = (1 - itemProgress) / 0.15;
      }
      opacity = this.clamp(opacity, 0, 1);

      const scale = this.lerp(0.92, 1, opacity);
      const translateY = this.lerp(30, 0, opacity);

      htmlItem.style.opacity = `${opacity}`;
      htmlItem.style.transform = `translate(-50%, -50%) scale(${scale}) translateY(${translateY}px)`;
      htmlItem.style.pointerEvents = opacity > 0.5 ? 'auto' : 'none';
    });

    // Background glow color shift
    if (bgGlow) {
      const hue = this.lerp(20, 280, progress);
      bgGlow.style.background = `radial-gradient(ellipse at center, hsla(${hue}, 70%, 50%, 0.07) 0%, transparent 70%)`;
    }
  }

  private animateCode(progress: number) {
    const el = this.codeWrapper.nativeElement;
    const headline = el.querySelector('.code-headline') as HTMLElement | null;
    const showcase = el.querySelector('.code-showcase') as HTMLElement | null;
    const parts = el.querySelectorAll('.code-part');
    const cli = el.querySelector('.cli-section') as HTMLElement | null;

    // Headline: visible immediately, fully opaque by progress 0.05
    if (headline) {
      const p = this.easeOutCubic(this.clamp(progress / 0.05, 0, 1));
      headline.style.opacity = `${p}`;
    }

    // Auto-scroll: shift the showcase container up as content grows
    // beyond the viewport. Starts shifting after the first code block appears.
    if (showcase) {
      const scrollProgress = this.clamp((progress - 0.2) / 0.7, 0, 1);
      const maxShift = Math.max(0, showcase.scrollHeight - showcase.parentElement!.clientHeight + 80);
      const shift = this.easeOutCubic(scrollProgress) * maxShift;
      showcase.style.transform = `translateY(${-shift}px)`;
    }

    // Code parts: tighter stagger starting at 0.05
    parts.forEach((part, i) => {
      const htmlPart = part as HTMLElement;
      const start = 0.05 + i * 0.2;
      const p = this.easeOutCubic(this.clamp((progress - start) / 0.18, 0, 1));
      htmlPart.style.opacity = `${p}`;
    });

    // CLI: 0.65 → 0.85
    if (cli) {
      const p = this.easeOutCubic(this.clamp((progress - 0.65) / 0.2, 0, 1));
      cli.style.opacity = `${p}`;
    }
  }

  private animateCrossfade(progress: number) {
    const el = this.crossfadeWrapper.nativeElement;
    const idePanel = el.querySelector('.ide-panel') as HTMLElement | null;
    const ctaPanel = el.querySelector('.cta-panel') as HTMLElement | null;

    // 0–0.35: IDE fully visible
    // 0.35–0.65: crossfade (IDE fades out, CTA fades in + zooms up)
    // 0.65–1.0: CTA fully visible

    if (idePanel) {
      const fadeOut = this.easeOutCubic(this.clamp((progress - 0.35) / 0.3, 0, 1));
      idePanel.style.opacity = `${1 - fadeOut}`;
      idePanel.style.transform = `scale(${1 - fadeOut * 0.05})`;
    }

    if (ctaPanel) {
      const fadeIn = this.easeOutCubic(this.clamp((progress - 0.35) / 0.3, 0, 1));
      ctaPanel.style.opacity = `${fadeIn}`;
      ctaPanel.style.transform = `scale(${0.92 + fadeIn * 0.08})`;
    }
  }

  private animateSlide(progress: number) {
    const el = this.slideWrapper.nativeElement;
    const useCases = el.querySelector('.use-cases-panel') as HTMLElement | null;
    const roadmap = el.querySelector('.roadmap-slide') as HTMLElement | null;

    if (useCases) {
      const offset = progress * 100;
      useCases.style.transform = `translateX(${offset}%)`;
      useCases.style.opacity = `${1 - progress}`;
    }

    if (roadmap) {
      const offset = -100 + progress * 100;
      roadmap.style.transform = `translateX(${offset}%)`;
      roadmap.style.opacity = `${progress}`;
    }
  }

  // --- IntersectionObserver for non-pinned sections ---

  private setupIntersectionObserver() {
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -60px 0px' }
    );

    // Delay slightly to ensure DOM is ready
    setTimeout(() => {
      const elements = document.querySelectorAll('.reveal-on-scroll');
      elements.forEach((el) => this.observer.observe(el));
    }, 100);
  }
}
