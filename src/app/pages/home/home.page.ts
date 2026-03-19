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

  private scrollHandler: (() => void) | null = null;
  private observer!: IntersectionObserver;
  private ticking = false;
  private readonly STICKY_TOP = 70;
  private lastScrollY = 0;
  private scrollDirection = 1; // 1 = down, -1 = up
  private rockets: {
    el: HTMLElement;
    angle: number; // base travel angle (when scrolling down)
    speed: number;
    x: number; // current position
    y: number;
    displayAngle: number; // smoothly interpolated visual rotation
    isSvg: boolean;
  }[] = [];

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
  }

  ngOnDestroy() {
    if (this.scrollHandler) {
      window.removeEventListener('scroll', this.scrollHandler);
    }
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  // --- Starfield & Rockets ---

  private starLayers: HTMLElement[] = [];

  private setupStarfield() {
    // Inject star layers inside each pinned section (between bg and content)
    const sections = document.querySelectorAll('.pinned-section, .capabilities-section');
    const counts = [60, 30, 15];
    const sizes = [1, 1.5, 2.5];
    const colors = [
      'rgba(255,255,255,0.45)',
      'rgba(255,255,255,0.65)',
      'rgba(255,255,255,0.85)',
    ];

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    sections.forEach((section) => {
      for (let li = 0; li < 3; li++) {
        const layer = document.createElement('div');
        layer.style.position = 'absolute';
        layer.style.top = '0';
        layer.style.left = '0';
        layer.style.width = '1px';
        layer.style.height = '1px';
        layer.style.zIndex = '1';
        layer.style.pointerEvents = 'none';
        layer.style.willChange = 'transform';
        layer.style.overflow = 'visible';

        const shadows: string[] = [];
        for (let i = 0; i < counts[li]; i++) {
          const x = Math.round(Math.random() * vw);
          const y = Math.round(Math.random() * vh);
          shadows.push(`${x}px ${y}px 0 ${sizes[li]}px ${colors[li]}`);
        }
        layer.style.boxShadow = shadows.join(',');
        section.appendChild(layer);
        this.starLayers.push(layer);
      }
    });
  }

  private setupRockets() {
    if (!this.starfield?.nativeElement) return;
    const container = this.starfield.nativeElement;

    const trailColors = [
      'rgba(255,255,255,0.7)',
      'rgba(255,124,0,0.6)',
      'rgba(255,0,102,0.5)',
      'rgba(123,63,248,0.5)',
    ];

    // --- Meteors (6) ---
    for (let i = 0; i < 6; i++) {
      const el = document.createElement('div');
      el.style.position = 'absolute';
      el.style.width = '4px';
      el.style.height = '4px';
      el.style.borderRadius = '50%';
      el.style.background = '#fff';
      el.style.willChange = 'transform';
      el.style.opacity = '0';
      const tc = trailColors[i % trailColors.length];
      el.style.boxShadow = `0 0 6px 2px ${tc}, 0 0 12px 4px ${tc}`;

      const trail = document.createElement('div');
      trail.style.position = 'absolute';
      trail.style.top = '50%';
      trail.style.right = '100%';
      trail.style.width = `${50 + Math.random() * 40}px`; // 50-90px streak
      trail.style.height = '2px';
      trail.style.transform = 'translateY(-50%)';
      trail.style.background = `linear-gradient(to left, ${tc}, rgba(255,255,255,0.15), transparent)`;
      trail.style.borderRadius = '1px';
      el.appendChild(trail);

      container.appendChild(el);
      this.rockets.push(this.createRocketConfig(el));
    }

    // --- Rocket ships (4) ---
    const rocketSvg = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">
      <path d="M12 2C12 2 8 6 8 12C8 14.5 9 17 10 19L12 22L14 19C15 17 16 14.5 16 12C16 6 12 2 12 2Z" fill="white" opacity="0.9"/>
      <path d="M8 12C6 13 5 14 5 15L8 14V12Z" fill="white" opacity="0.6"/>
      <path d="M16 12C18 13 19 14 19 15L16 14V12Z" fill="white" opacity="0.6"/>
      <circle cx="12" cy="10" r="2" fill="rgba(255,124,0,0.8)"/>
      <path d="M10 19L12 22L14 19C13.5 19.5 12.8 20 12 20C11.2 20 10.5 19.5 10 19Z" fill="rgba(255,124,0,0.9)"/>
    </svg>`;

    for (let i = 0; i < 4; i++) {
      const el = document.createElement('div');
      el.style.position = 'absolute';
      el.style.width = '20px';
      el.style.height = '20px';
      el.style.willChange = 'transform';
      el.style.opacity = '0';
      el.style.filter = 'drop-shadow(0 0 3px rgba(255,124,0,0.5))';
      el.innerHTML = rocketSvg;

      // Exhaust trail
      const exhaust = document.createElement('div');
      exhaust.style.position = 'absolute';
      exhaust.style.top = '100%';
      exhaust.style.left = '50%';
      exhaust.style.width = '4px';
      exhaust.style.height = '22px';
      exhaust.style.transform = 'translateX(-50%)';
      exhaust.style.background = 'linear-gradient(to bottom, rgba(255,124,0,0.6), rgba(255,0,102,0.3), transparent)';
      exhaust.style.borderRadius = '2px';
      el.appendChild(exhaust);

      container.appendChild(el);
      this.rockets.push(this.createRocketConfig(el));
    }
  }

  private createRocketConfig(el: HTMLElement) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const diagonal = Math.sqrt(vw * vw + vh * vh);

    // Random angle between 10-80 degrees (mostly horizontal/diagonal)
    const angleBase = 15 + Math.random() * 50;
    // Randomly flip direction
    const angle = (Math.random() > 0.5 ? angleBase : 180 - angleBase) * (Math.PI / 180);
    const speed = 0.5 + Math.random() * 1.0;

    // Start from a random edge position
    const { x, y } = this.randomEdgePoint(vw, vh, angle);

    return {
      el,
      angle,
      speed,
      x,
      y,
      displayAngle: angle,
      isSvg: el.querySelector('svg') !== null,
    };
  }

  private randomEdgePoint(vw: number, vh: number, angle: number): { x: number; y: number } {
    const dx = Math.cos(angle);
    // Start from the edge the rocket is flying away from
    const x = dx > 0 ? -20 : vw + 20;
    const y = Math.random() * vh;
    return { x, y };
  }

  private resetRocket(r: typeof this.rockets[0]) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const angleBase = 15 + Math.random() * 50;
    r.angle = (Math.random() > 0.5 ? angleBase : 180 - angleBase) * (Math.PI / 180);
    r.speed = 0.5 + Math.random() * 1.0;
    // Use current scroll direction for initial angle
    const effectiveAngle = this.scrollDirection > 0 ? r.angle : r.angle + Math.PI;
    r.displayAngle = effectiveAngle;
    const { x, y } = this.randomEdgePoint(vw, vh, effectiveAngle);
    r.x = x;
    r.y = y;
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

    // Progress bar
    const overallProgress = this.clamp(scrollY / (docHeight - vh), 0, 1);
    if (this.progressBar?.nativeElement) {
      this.progressBar.nativeElement.style.transform = `scaleX(${overallProgress})`;
    }

    // Starfield parallax — inner star layers shift at different rates
    const speeds = [0.03, 0.08, 0.15];
    this.starLayers.forEach((layer, i) => {
      const speed = speeds[i % 3];
      layer.style.transform = `translateY(${-scrollY * speed}px)`;
    });

    // Rockets & meteors — move in current scroll direction, smooth rotation on reversal
    if (scrollDelta > 0) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      this.rockets.forEach((r) => {
        // Target angle flips based on scroll direction
        const targetAngle = this.scrollDirection > 0 ? r.angle : r.angle + Math.PI;

        // Smoothly rotate display angle toward target
        let diff = targetAngle - r.displayAngle;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        r.displayAngle += diff * 0.15;

        // Move position along the current display angle
        const dist = scrollDelta * r.speed;
        r.x += Math.cos(r.displayAngle) * dist;
        r.y += Math.sin(r.displayAngle) * dist;

        // Reset if off-screen
        const margin = 60;
        if (r.x < -margin || r.x > vw + margin || r.y < -margin || r.y > vh + margin) {
          this.resetRocket(r);
        }

        // SVG rockets point up, offset by -90deg so nose faces travel direction
        const displayDeg = r.displayAngle * (180 / Math.PI);
        const rotOffset = r.isSvg ? 90 : 0;
        r.el.style.transform = `translate(${r.x}px, ${r.y}px) rotate(${displayDeg + rotOffset}deg)`;
        r.el.style.opacity = '1';
      });
    }

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
