import { Component, inject, OnInit, OnDestroy, ElementRef, ViewChild } from '@angular/core';
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
export class HomePage implements OnInit, OnDestroy {
  private themeService = inject(ThemeService);
  @ViewChild('heroSection', { static: true }) heroSection!: ElementRef;
  
  private observer!: IntersectionObserver;
  private stickyState = false; // Track sticky state to prevent flickering
  private lastStickyCheck = 0; // Debounce sticky changes

  quickStartCode = `// Program.cs
builder.Services.AddWhizbang()
    .AddPostgres("Host=...")
    .AddKafkaTransport()
    .AddOpenTelemetry()
    .AddProjections(o => o.Scan<Program>())
    .AddCommandHandlers(o => o.Scan<Program>());

public record CreateInvoice(Guid Id, Money Amount);

public class Invoice : AggregateRoot<Guid>
{
    public Money Amount { get; private set; }

    void Apply(InvoiceCreated e)
    {
        Id = e.Id;
        Amount = e.Amount;
    }

    public static Invoice Handle(CreateInvoice cmd) =>
        new Invoice { Amount = cmd.Amount }
            .Emit(new InvoiceCreated(cmd.Id, cmd.Amount));
}`;

  cliCommands = `# open live diagnostics dashboard
dotnet whiz diag
# rebuild a projection
dotnet whiz replay InvoiceSummary`;

  ngOnInit() {
    this.setupScrollAnimations();
    setTimeout(() => {
      this.setupParallaxEffect();
    }, 1000); // Delay to ensure DOM is ready
  }

  ngOnDestroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  getMeetWhizbangPath(): string {
    const isDark = this.themeService.isDarkTheme();
    return isDark ? 'assets/branding/meet-whizbang-dark.svg' : 'assets/branding/meet-whizbang-light.svg';
  }

  private setupScrollAnimations() {
    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('animate-in');
        }
      });
    }, {
      threshold: 0.2,
      rootMargin: '0px 0px -100px 0px'
    });

    // Observe all animated elements after a short delay to ensure DOM is ready
    setTimeout(() => {
      const animatedElements = document.querySelectorAll('.animate-on-scroll');
      animatedElements.forEach(el => this.observer.observe(el));
    }, 100);
  }

  private setupParallaxEffect() {
    let ticking = false;
    
    const updateParallax = () => {
      const scrolled = window.pageYOffset;
      const windowHeight = window.innerHeight;
      
      // Get all major sections
      const useCasesSection = document.querySelector('.flying-use-cases');
      const roadmapSection = document.querySelector('.roadmap-section');
      const slideSpacerSection = document.querySelector('.horizontal-slide-spacer');
      const ctaSection = document.querySelector('section:last-of-type');
      
      
      // 1. Hero section parallax (always active)
      const parallaxElements = document.querySelectorAll('.parallax-element');
      parallaxElements.forEach((element, index) => {
        const speed = 0.2 + (index * 0.05);
        const yPos = -(scrolled * speed);
        (element as HTMLElement).style.transform = `translateY(${yPos}px)`;
      });
      
      // 2. Fast parallax headers (benefits section)
      const fastParallaxHeaders = document.querySelectorAll('.fast-parallax-header');
      fastParallaxHeaders.forEach((element) => {
        const moveSpeed = 0.15;
        const yPos = -(scrolled * moveSpeed);
        (element as HTMLElement).style.setProperty('transform', `translateY(${yPos}px)`, 'important');
      });
      
      // 3. Simple debug - no fade effects, just z-index layering
      const stickyCapabilities = document.querySelector('.capabilities-section');
      
      
      if (stickyCapabilities && useCasesSection) {
        const useCasesRect = useCasesSection.getBoundingClientRect();
        const capabilitiesRect = stickyCapabilities.getBoundingClientRect();
        
        // Remove any opacity manipulation - let z-index handle layering
        (stickyCapabilities as HTMLElement).style.opacity = '1';
        
      }
      
      // 4. Horizontal sliding animation - SMART APPROACH: container is sticky
      if (useCasesSection && roadmapSection && slideSpacerSection) {
        const spacerRect = slideSpacerSection.getBoundingClientRect();
        const containerSection = document.querySelector('.horizontal-slide-container');
        const containerRect = containerSection?.getBoundingClientRect();
        const ctaRect = ctaSection?.getBoundingClientRect();
        
        // Check if the container is pinned at 70px below header
        const isContainerPinned = containerRect && containerRect.top <= 70;
        // Check if we're scrolling through the spacer
        const isInSpacerArea = spacerRect.top <= windowHeight && spacerRect.bottom > 0;
        // Check if CTA section is pushing up (coming into view from bottom) - make this more restrictive
        const isCtaPushing = ctaRect && ctaRect.top <= windowHeight * 0.5;
        
        
        // CAREFULLY RE-ENABLE ANIMATION - only for spacer area
        if (isContainerPinned) {
          if (isInSpacerArea) {
            // ANIMATE: Scrolling through spacer - do the horizontal slide
            const spacerHeight = slideSpacerSection.scrollHeight;
            const scrolledIntoSpacer = Math.max(0, windowHeight - spacerRect.top);
            const slideProgress = Math.min(1, scrolledIntoSpacer / spacerHeight);
            
            // Use Cases slides to the right (0% -> 100%)
            const useCasesOffset = slideProgress * 100;
            (useCasesSection as HTMLElement).style.transform = `translateX(${useCasesOffset}%)`;
            
            // Roadmap slides in from the left (-100% -> 0%)
            const roadmapOffset = -100 + (slideProgress * 100);
            (roadmapSection as HTMLElement).style.transform = `translateX(${roadmapOffset}%)`;
            
          } else {
            // Container pinned but no animation - keep Use Cases visible
            (useCasesSection as HTMLElement).style.transform = 'translateX(0%)';
            (roadmapSection as HTMLElement).style.transform = 'translateX(-100%)';
          }
        } else {
          // Container not pinned yet - keep Use Cases visible
          (useCasesSection as HTMLElement).style.transform = 'translateX(0%)';
          (roadmapSection as HTMLElement).style.transform = 'translateX(-100%)';
        }
      }
      
      // 5. Floating animation for hero elements (always active)
      const heroElements = document.querySelectorAll('.float-animation');
      heroElements.forEach((element, index) => {
        const float = Math.sin(scrolled * 0.01 + index) * 10;
        (element as HTMLElement).style.transform = `translateY(${float}px)`;
      });
      
      ticking = false;
    };

    const requestTick = () => {
      if (!ticking) {
        requestAnimationFrame(updateParallax);
        ticking = true;
      }
    };

    window.addEventListener('scroll', requestTick, { passive: true });
  }
}
