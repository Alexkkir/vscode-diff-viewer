import { AppConfig } from "../../../extension/configuration";
import { SkeletonElementIds } from "../../../shared/css/elements";
import { Diff2HtmlCssClasses } from "../../css/classes";
import { Diff2HtmlCssClassElements } from "../../css/elements";
import { FileDomBinding } from "./types";
import { setProgrammaticScroll, userScrollAxes } from "./scroll-synchronization";

interface HorizontalScrollbarMetrics {
  maxClientWidth: number;
  maxScrollWidth: number;
  scrollLeft: number;
}

export class HorizontalScrollbarController {
  private horizontalScrollTargets: HTMLElement[] = [];
  private resizeHandlerRegistered = false;
  private pendingRefreshFrame: number | undefined = undefined;
  private horizontalScrollbarHandlersRegistered = false;
  private metrics: HorizontalScrollbarMetrics | undefined = undefined;
  private dragPointerId: number | undefined = undefined;
  private dragOffset = 0;

  public constructor(
    private readonly args: {
      getConfig: () => AppConfig | undefined;
      getFileBindings: () => FileDomBinding[];
    },
  ) {}

  public refresh(): void {
    const scrollbar = this.getScrollbarContainer();
    const thumb = this.getScrollbarThumb();
    if (!scrollbar || !thumb) {
      return;
    }

    this.registerScrollbarHandlers();

    if (!this.args.getConfig()?.globalScrollbar) {
      this.updateHorizontalScrollListeners([]);
      scrollbar.style.display = "none";
      thumb.style.width = "0";
      thumb.style.transform = "translateX(0)";
      scrollbar.scrollLeft = 0;
      this.metrics = undefined;
      return;
    }

    const nextTargets = this.getActiveHorizontalScrollTargets();
    this.updateHorizontalScrollListeners(nextTargets);

    if (nextTargets.length === 0) {
      scrollbar.style.display = "none";
      thumb.style.width = "0";
      thumb.style.transform = "translateX(0)";
      scrollbar.scrollLeft = 0;
      this.metrics = undefined;
      return;
    }

    const maxClientWidth = Math.max(...nextTargets.map((target) => target.clientWidth), 0);
    const maxScrollWidth = Math.max(...nextTargets.map((target) => target.scrollWidth), 0);
    const hasOverflow = maxScrollWidth > maxClientWidth;

    scrollbar.style.display = hasOverflow ? "block" : "none";
    if (!hasOverflow) {
      thumb.style.width = "0";
      thumb.style.transform = "translateX(0)";
      scrollbar.scrollLeft = 0;
      this.metrics = undefined;
      return;
    }

    // A narrower first pane may have clamped the global offset. Preserve the
    // largest actual pane position when refreshing instead of moving it back.
    const scrollLeft = Math.max(...nextTargets.map((target) => target.scrollLeft), 0);
    this.metrics = {
      maxClientWidth,
      maxScrollWidth,
      scrollLeft,
    };
    this.updateVisual(this.metrics.scrollLeft);
  }

  public scheduleRefresh(): void {
    if (this.pendingRefreshFrame !== undefined) {
      globalThis.cancelAnimationFrame(this.pendingRefreshFrame);
    }

    this.pendingRefreshFrame = globalThis.requestAnimationFrame(() => {
      this.pendingRefreshFrame = undefined;
      this.refresh();
    });
  }

  public ensureWindowHandlersRegistered(): void {
    if (this.resizeHandlerRegistered) {
      return;
    }

    globalThis.addEventListener("resize", this.onWindowResized);
    this.resizeHandlerRegistered = true;
  }

  private readonly onWindowResized = (): void => {
    this.refresh();
  };

  private readonly onHorizontalScrollTarget = (event: Event): void => {
    const scrollTarget = event.target;
    const scrollbar = this.getScrollbarContainer();
    if (
      !(scrollTarget instanceof HTMLElement) ||
      !scrollbar ||
      !userScrollAxes(event, scrollTarget).includes("scrollLeft")
    ) {
      return;
    }

    this.applyScrollLeft(scrollTarget.scrollLeft);
  };

  private readonly onScrollbarScrolled = (event: Event): void => {
    const scrollbar = event.target;
    if (!(scrollbar instanceof HTMLElement) || !userScrollAxes(event, scrollbar).includes("scrollLeft")) {
      return;
    }

    this.applyScrollLeft(scrollbar.scrollLeft);
  };

  private readonly onScrollbarPointerDown = (event: PointerEvent): void => {
    const scrollbar = this.getScrollbarContainer();
    const thumb = this.getScrollbarThumb();
    if (!scrollbar || !thumb || !this.metrics) {
      return;
    }

    if (event.target === thumb) {
      this.dragPointerId = event.pointerId;
      this.dragOffset = event.clientX - thumb.getBoundingClientRect().left;
      thumb.setPointerCapture(event.pointerId);
      return;
    }

    const trackRect = scrollbar.getBoundingClientRect();
    const thumbRect = thumb.getBoundingClientRect();
    const desiredThumbLeft = event.clientX - trackRect.left - thumbRect.width / 2;
    this.applyThumbLeft(desiredThumbLeft);
  };

  private readonly onScrollbarPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.dragPointerId) {
      return;
    }

    const scrollbar = this.getScrollbarContainer();
    if (!scrollbar) {
      return;
    }

    const trackRect = scrollbar.getBoundingClientRect();
    const desiredThumbLeft = event.clientX - trackRect.left - this.dragOffset;
    this.applyThumbLeft(desiredThumbLeft);
  };

  private readonly onScrollbarPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.dragPointerId) {
      return;
    }

    this.getScrollbarThumb()?.releasePointerCapture(event.pointerId);
    this.dragPointerId = undefined;
  };

  private readonly onScrollbarWheel = (event: WheelEvent): void => {
    if (!this.metrics) return;
    const delta = event.deltaX || (event.shiftKey ? event.deltaY : 0);
    if (!delta) return;
    const scale =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? this.metrics.maxClientWidth
          : 1;
    const maximum = Math.max(0, this.metrics.maxScrollWidth - this.metrics.maxClientWidth);
    event.preventDefault();
    this.applyScrollLeft(Math.max(0, Math.min(maximum, this.metrics.scrollLeft + delta * scale)));
  };

  private registerScrollbarHandlers(): void {
    if (this.horizontalScrollbarHandlersRegistered) {
      return;
    }

    const scrollbar = this.getScrollbarContainer();
    const thumb = this.getScrollbarThumb();
    if (!scrollbar || !thumb) {
      return;
    }

    scrollbar.addEventListener("scroll", this.onScrollbarScrolled, { passive: true });
    scrollbar.addEventListener("pointerdown", this.onScrollbarPointerDown);
    scrollbar.addEventListener("wheel", this.onScrollbarWheel, { passive: false });
    thumb.addEventListener("pointermove", this.onScrollbarPointerMove);
    thumb.addEventListener("pointerup", this.onScrollbarPointerUp);
    thumb.addEventListener("pointercancel", this.onScrollbarPointerUp);
    this.horizontalScrollbarHandlersRegistered = true;
  }

  private updateHorizontalScrollListeners(nextTargets: HTMLElement[]): void {
    this.horizontalScrollTargets.forEach((target) => {
      if (!nextTargets.includes(target)) {
        target.removeEventListener("scroll", this.onHorizontalScrollTarget);
      }
    });

    nextTargets.forEach((target) => {
      if (!this.horizontalScrollTargets.includes(target)) {
        target.addEventListener("scroll", this.onHorizontalScrollTarget, { passive: true });
      }
    });

    this.horizontalScrollTargets = nextTargets;
  }

  private getActiveHorizontalScrollTargets(): HTMLElement[] {
    const allFileTargets = this.args
      .getFileBindings()
      .flatMap((binding) => this.getHorizontalScrollTargetsForFile(binding.fileContainer));
    if (allFileTargets.length > 0) {
      return allFileTargets;
    }

    return this.getRootHorizontalScrollTargets();
  }

  private getHorizontalScrollTargetsForFile(fileContainer: HTMLElement): HTMLElement[] {
    const fileContents = fileContainer.querySelectorAll<HTMLElement>(Diff2HtmlCssClassElements.Div__DiffFileContent);
    return Array.from(fileContents).flatMap((content) => {
      if (content.classList.contains(Diff2HtmlCssClasses.Div__DiffFileContent__Collapsed)) {
        return [];
      }

      const sideDiffs = Array.from(content.querySelectorAll<HTMLElement>(".d2h-file-side-diff")).filter((element) =>
        this.isHorizontallyScrollable(element),
      );
      if (sideDiffs.length > 0) {
        return sideDiffs;
      }

      return this.isHorizontallyScrollable(content) ? [content] : [];
    });
  }

  private isHorizontallyScrollable(element: HTMLElement): boolean {
    return element.scrollWidth > element.clientWidth;
  }

  private getRootHorizontalScrollTargets(): HTMLElement[] {
    const root = document.scrollingElement;
    return root instanceof HTMLElement && this.isHorizontallyScrollable(root) ? [root] : [];
  }

  private updateVisual(scrollLeft: number): void {
    const scrollbar = this.getScrollbarContainer();
    const thumb = this.getScrollbarThumb();
    if (!scrollbar || !thumb || !this.metrics) {
      return;
    }

    const trackWidth = scrollbar.clientWidth;
    const maxScrollLeft = Math.max(this.metrics.maxScrollWidth - this.metrics.maxClientWidth, 0);
    const thumbWidth =
      maxScrollLeft > 0
        ? Math.max((this.metrics.maxClientWidth / this.metrics.maxScrollWidth) * trackWidth, 24)
        : trackWidth;
    const maxThumbLeft = Math.max(trackWidth - thumbWidth, 0);
    const thumbLeft = maxScrollLeft > 0 ? (scrollLeft / maxScrollLeft) * maxThumbLeft : 0;

    this.metrics.scrollLeft = scrollLeft;
    thumb.style.width = `${thumbWidth}px`;
    thumb.style.transform = `translateX(${thumbLeft}px)`;
    setProgrammaticScroll(scrollbar, "scrollLeft", scrollLeft);
  }

  private applyScrollLeft(scrollLeft: number): void {
    this.horizontalScrollTargets.forEach((target) => {
      setProgrammaticScroll(target, "scrollLeft", scrollLeft);
    });
    this.updateVisual(scrollLeft);
  }

  private applyThumbLeft(desiredThumbLeft: number): void {
    const scrollbar = this.getScrollbarContainer();
    const thumb = this.getScrollbarThumb();
    if (!scrollbar || !thumb || !this.metrics) {
      return;
    }

    const trackWidth = scrollbar.clientWidth;
    const thumbWidth = thumb.getBoundingClientRect().width;
    const maxThumbLeft = Math.max(trackWidth - thumbWidth, 0);
    const clampedThumbLeft = Math.min(Math.max(desiredThumbLeft, 0), maxThumbLeft);
    const maxScrollLeft = Math.max(this.metrics.maxScrollWidth - this.metrics.maxClientWidth, 0);
    const scrollLeft = maxThumbLeft > 0 ? (clampedThumbLeft / maxThumbLeft) * maxScrollLeft : 0;

    this.applyScrollLeft(scrollLeft);
  }

  private getScrollbarContainer(): HTMLDivElement | null {
    const scrollbar = document.getElementById(SkeletonElementIds.HorizontalScrollbarContainer);
    return scrollbar instanceof HTMLDivElement ? scrollbar : null;
  }

  private getScrollbarThumb(): HTMLDivElement | null {
    const thumb = document.getElementById(SkeletonElementIds.HorizontalScrollbarContent);
    return thumb instanceof HTMLDivElement ? thumb : null;
  }
}
