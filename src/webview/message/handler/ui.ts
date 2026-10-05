import { CssPropertiesBasedOnTheme, SkeletonElementIds } from "../../../shared/css/elements";
import { AppTheme } from "../../../shared/types";
import { FileDomBinding } from "./types";

export function setupTheme(theme: AppTheme): void {
  const root = document.documentElement;

  CssPropertiesBasedOnTheme.forEach((property) => {
    const value = getComputedStyle(root).getPropertyValue(`${property}--${theme}`);
    root.style.setProperty(property, value);
  });
}

export function updateHighlightTheme(theme: AppTheme): void {
  const lightStylesheet = document.getElementById(SkeletonElementIds.HighlightLightStylesheet);
  const darkStylesheet = document.getElementById(SkeletonElementIds.HighlightDarkStylesheet);
  if (!(lightStylesheet instanceof HTMLLinkElement) || !(darkStylesheet instanceof HTMLLinkElement)) {
    return;
  }

  lightStylesheet.disabled = theme === "dark";
  darkStylesheet.disabled = theme !== "dark";
}

export function updateLargeDiffNotice(warning?: string): void {
  const notice = document.getElementById(SkeletonElementIds.LargeDiffNoticeContainer);
  const message = document.getElementById(SkeletonElementIds.LargeDiffNoticeMessage);
  const dismissButton = document.getElementById(SkeletonElementIds.LargeDiffNoticeDismiss);
  if (
    !(notice instanceof HTMLDivElement) ||
    !(message instanceof HTMLSpanElement) ||
    !(dismissButton instanceof HTMLButtonElement)
  ) {
    return;
  }

  if (!dismissButton.dataset.bound) {
    dismissButton.addEventListener("click", () => {
      notice.dataset.dismissed = "true";
      notice.style.display = "none";
    });
    dismissButton.dataset.bound = "true";
  }

  message.textContent = warning ?? "";
  if (!warning) {
    delete notice.dataset.warning;
    delete notice.dataset.dismissed;
  } else if (notice.dataset.warning !== warning) {
    notice.dataset.warning = warning;
    delete notice.dataset.dismissed;
  }

  notice.style.display = warning && notice.dataset.dismissed !== "true" ? "flex" : "none";
}

export function showLoading(isLoading: boolean): void {
  const loadingContainer = document.getElementById(SkeletonElementIds.LoadingContainer);
  if (!loadingContainer) {
    return;
  }

  loadingContainer.style.display = isLoading ? "block" : "none";
}

export function showEmpty(isEmpty: boolean): void {
  const emptyMessageContainer = document.getElementById(SkeletonElementIds.EmptyMessageContainer);
  if (!emptyMessageContainer) {
    return;
  }

  emptyMessageContainer.style.display = isEmpty ? "block" : "none";
}

export function updateFooter(fileBindings: FileDomBinding[]): void {
  const allCount = fileBindings.length;
  const viewedCount = fileBindings.reduce((count, { viewedToggle }) => count + (viewedToggle?.checked ? 1 : 0), 0);
  const expandAllToggle = document.getElementById(SkeletonElementIds.ExpandAllToggle);
  if (expandAllToggle instanceof HTMLInputElement) {
    expandAllToggle.disabled = allCount === 0;
    expandAllToggle.checked = allCount > 0 && viewedCount === 0;
    expandAllToggle.indeterminate = viewedCount > 0 && viewedCount < allCount;
  }
  const indicator = document.getElementById(SkeletonElementIds.ViewedIndicator);
  if (!indicator) {
    return;
  }

  indicator.textContent = `${viewedCount} / ${allCount} files viewed`;

  const viewedProgressContainer = document.getElementById(SkeletonElementIds.ViewedProgressContainer);
  if (viewedProgressContainer instanceof HTMLProgressElement) {
    viewedProgressContainer.value = allCount ? Math.round((viewedCount / allCount) * 100) : 0;
  }
}
