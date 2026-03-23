import { useEffect, useState } from "react";
import type { MacBackgroundEffect, Space } from "@/types";
import { computeGlassTintColor } from "@/lib/color-utils";
import { isMac } from "@/lib/utils";

const TINT_VARS = [
  "--space-hue", "--space-chroma",
  "--background", "--accent", "--border",
  "--muted", "--secondary", "--card", "--input",
  "--sidebar", "--sidebar-accent", "--sidebar-border",
  "--island-overlay-bg", "--island-fill",
];

const DARK_SURFACE_BRIGHTNESS_MULTIPLIER = 1.3;
const LIGHT_SURFACE_WHITE_MIX = 0.3;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getTintStrength(chroma: number): number {
  const normalized = clamp01(chroma / 0.3);
  return Math.pow(normalized, 0.8);
}

function brightenDarkLightness(value: number): number {
  return clamp01(value * DARK_SURFACE_BRIGHTNESS_MULTIPLIER);
}

function brightenLightLightness(value: number): number {
  return clamp01(value + (1 - value) * LIGHT_SURFACE_WHITE_MIX);
}

/**
 * Applies the active space's color tint to CSS custom properties on the document root.
 * Handles dark/light mode branching and glass/non-glass transparency.
 *
 * On macOS with native glass, sends tintColor to the main process via IPC so
 * the glass material is tinted natively (higher quality than CSS overlay).
 * Falls back to CSS overlay on non-macOS platforms (Windows Mica, etc.).
 *
 * Returns the glass overlay style object (or null) for the tint overlay div.
 */
export function useSpaceTheme(
  activeSpace: Space | undefined,
  resolvedTheme: string,
  isGlassActive: boolean,
  macBackgroundEffect: MacBackgroundEffect,
): React.CSSProperties | null {
  const [glassOverlayStyle, setGlassOverlayStyle] = useState<React.CSSProperties | null>(null);

  useEffect(() => {
    const space = activeSpace;
    const root = document.documentElement;
    const isGlass = isGlassActive;
    const isDark = resolvedTheme === "dark";
    // Native macOS glass supports tintColor via addView()
    const isNativeGlass = isGlass && isMac && macBackgroundEffect === "liquid-glass";

    if (!space || space.color.chroma === 0) {
      // Clear all tinted vars so the CSS base values take over
      for (const v of TINT_VARS) root.style.removeProperty(v);
      setGlassOverlayStyle(null);
      // Clear native glass tint when space has no color
      if (isNativeGlass) window.claude.glass?.setTintColor(null);

      // Still apply opacity even for colorless (default) space
      const opacity = space?.color.opacity;
      if (opacity !== undefined && opacity < 1) {
        const darkBase = brightenDarkLightness(0.107);
        const bg = isDark ? `oklch(${darkBase} 0 0 / ${opacity})` : `oklch(1 0 0 / ${opacity})`;
        root.style.setProperty("--island-fill", bg);
      } else {
        root.style.removeProperty("--island-fill");
      }
      return;
    }

    const { hue, chroma } = space.color;
    const opacity = space.color.opacity ?? 1;
    const tintStrength = getTintStrength(chroma);
    const bgChroma = (isDark ? 0.028 : 0.04) * tintStrength;
    const surfaceChroma = (isDark ? 0.04 : 0.055) * tintStrength;
    const borderChroma = (isDark ? 0.026 : 0.034) * tintStrength;
    const sidebarChroma = (isDark ? 0.024 : 0.03) * tintStrength;
    const lightBgLightness = brightenLightLightness(0.985 - 0.012 * tintStrength);
    const lightSurfaceLightness = brightenLightLightness(0.955 - 0.02 * tintStrength);
    const lightBorderLightness = brightenLightLightness(0.91);
    const lightCardLightness = brightenLightLightness(0.98);
    const lightSidebarLightness = brightenLightLightness(0.968);
    const lightSidebarAccentLightness = brightenLightLightness(0.947);
    const darkBgLightness = brightenDarkLightness(0.12 - 0.013 * tintStrength);
    const darkSurfaceLightness = brightenDarkLightness(0.355 - 0.04 * tintStrength);
    const darkBorderLightness = brightenDarkLightness(0.39);
    const darkCardLightness = brightenDarkLightness(0.25);
    const darkSidebarLightness = brightenDarkLightness(0.2);
    const darkSidebarAccentLightness = brightenDarkLightness(0.31);
    const darkSidebarBorderLightness = brightenDarkLightness(0.4);

    root.style.setProperty("--space-hue", String(hue));
    root.style.setProperty("--space-chroma", String(chroma));

    if (isDark) {
      root.style.setProperty("--background", `oklch(${darkBgLightness} ${bgChroma} ${hue})`);
      root.style.setProperty("--accent", `oklch(${darkSurfaceLightness} ${surfaceChroma} ${hue})`);
      root.style.setProperty("--border", `oklch(${darkBorderLightness} ${borderChroma} ${hue})`);
      root.style.setProperty("--muted", `oklch(${darkSurfaceLightness} ${surfaceChroma} ${hue})`);
      root.style.setProperty("--secondary", `oklch(${darkSurfaceLightness} ${surfaceChroma} ${hue})`);
      root.style.setProperty("--card", `oklch(${darkCardLightness} ${bgChroma} ${hue})`);
      root.style.setProperty("--input", `oklch(${darkBorderLightness} ${borderChroma} ${hue})`);
      // Island fill with alpha for per-space opacity (--background stays opaque for gradient fades)
      if (opacity < 1) {
        root.style.setProperty("--island-fill", `oklch(${darkBgLightness} ${bgChroma} ${hue} / ${opacity})`);
      } else {
        root.style.removeProperty("--island-fill");
      }
      if (!isGlass) {
        root.style.setProperty("--sidebar", `oklch(${darkSidebarLightness} ${sidebarChroma} ${hue})`);
        root.style.setProperty("--sidebar-accent", `oklch(${darkSidebarAccentLightness} ${surfaceChroma} ${hue})`);
        root.style.setProperty("--sidebar-border", `oklch(${darkSidebarBorderLightness} ${borderChroma} ${hue})`);
      }
    } else {
      root.style.setProperty("--background", `oklch(${lightBgLightness} ${bgChroma} ${hue})`);
      root.style.setProperty("--accent", `oklch(${lightSurfaceLightness} ${surfaceChroma} ${hue})`);
      root.style.setProperty("--border", `oklch(${lightBorderLightness} ${borderChroma} ${hue})`);
      root.style.setProperty("--muted", `oklch(${lightSurfaceLightness} ${surfaceChroma} ${hue})`);
      root.style.setProperty("--secondary", `oklch(${lightSurfaceLightness} ${surfaceChroma} ${hue})`);
      root.style.setProperty("--card", `oklch(${lightCardLightness} ${bgChroma} ${hue})`);
      root.style.setProperty("--input", `oklch(${lightBorderLightness} ${borderChroma} ${hue})`);
      // Island fill with alpha for per-space opacity
      if (opacity < 1) {
        root.style.setProperty("--island-fill", `oklch(${lightBgLightness} ${bgChroma} ${hue} / ${opacity})`);
      } else {
        root.style.removeProperty("--island-fill");
      }
      if (!isGlass) {
        root.style.setProperty("--sidebar", `oklch(${lightSidebarLightness} ${sidebarChroma} ${hue})`);
        root.style.setProperty("--sidebar-accent", `oklch(${lightSidebarAccentLightness} ${surfaceChroma} ${hue})`);
        root.style.setProperty("--sidebar-border", `oklch(${lightBorderLightness} ${borderChroma} ${hue})`);
      } else {
        // Glass + light: show more native glass while keeping a subtle space tint.
        root.style.setProperty("--sidebar", `oklch(1 ${sidebarChroma} ${hue} / ${0.22 + 0.12 * tintStrength})`);
        root.style.setProperty("--sidebar-accent", `oklch(${brightenLightLightness(0.965)} ${surfaceChroma} ${hue} / ${0.22 + 0.14 * tintStrength})`);
        root.style.setProperty("--sidebar-border", `oklch(0 ${borderChroma} ${hue} / ${0.08 + 0.08 * tintStrength})`);
      }
    }

    const gradientHue = space.color.gradientHue;
    const overlayChroma = Math.min(0.18, 0.04 + 0.12 * tintStrength);

    // ── Glass tinting ──
    if (isNativeGlass) {
      // Native macOS glass tinting via addView({ tintColor }).
      // The main process also re-applies tint on window focus (macOS drops it when inactive).
      const hexTint = computeGlassTintColor(space.color);
      window.claude.glass?.setTintColor(hexTint);
      // Native tint handles the glass material — no CSS overlay needed
      setGlassOverlayStyle(null);
    } else if (isGlass) {
      // Non-macOS glass (Windows Mica, etc.) — CSS overlay for tinting
      const a = 0.04 + 0.12 * tintStrength;
      const bg = gradientHue !== undefined
        ? `linear-gradient(135deg, oklch(0.5 ${overlayChroma} ${hue} / ${a}), oklch(0.5 ${overlayChroma} ${gradientHue} / ${a}))`
        : `oklch(0.5 ${overlayChroma} ${hue} / ${a})`;
      setGlassOverlayStyle({ background: bg });
    } else {
      setGlassOverlayStyle(null);
    }

    if (gradientHue !== undefined) {
      const a = 0.035 + 0.115 * tintStrength;
      // Set CSS custom prop so .island::before picks up the gradient on ALL islands
      root.style.setProperty(
        "--island-overlay-bg",
        `linear-gradient(135deg, oklch(0.5 ${overlayChroma} ${hue} / ${a}), oklch(0.5 ${overlayChroma} ${gradientHue} / ${a}))`,
      );
    } else {
      root.style.removeProperty("--island-overlay-bg");
    }

    return () => {
      for (const v of TINT_VARS) root.style.removeProperty(v);
      setGlassOverlayStyle(null);
      if (isNativeGlass) window.claude.glass?.setTintColor(null);
    };
  }, [activeSpace, resolvedTheme, isGlassActive, macBackgroundEffect]);

  return glassOverlayStyle;
}
