import { memo } from "react";
import { SunMoon, Layout, Blend, Wrench } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingRow, SettingsSelect } from "@/components/settings/shared";
import type { MacBackgroundEffect, ThemeOption } from "@/types";

// ── Props ──

interface AppearanceSettingsProps {
  theme: ThemeOption;
  onThemeChange: (t: ThemeOption) => void;
  islandLayout: boolean;
  onIslandLayoutChange: (enabled: boolean) => void;
  islandShine: boolean;
  onIslandShineChange: (enabled: boolean) => void;
  macBackgroundEffect: MacBackgroundEffect;
  onMacBackgroundEffectChange: (effect: MacBackgroundEffect) => void;
  autoGroupTools: boolean;
  onAutoGroupToolsChange: (enabled: boolean) => void;
  avoidGroupingEdits: boolean;
  onAvoidGroupingEditsChange: (enabled: boolean) => void;
  autoExpandTools: boolean;
  onAutoExpandToolsChange: (enabled: boolean) => void;
  expandEditToolCallsByDefault: boolean;
  onExpandEditToolCallsByDefaultChange: (enabled: boolean) => void;
  showToolIcons: boolean;
  onShowToolIconsChange: (enabled: boolean) => void;
  coloredToolIcons: boolean;
  onColoredToolIconsChange: (enabled: boolean) => void;
  transparentToolPicker: boolean;
  onTransparentToolPickerChange: (enabled: boolean) => void;
  coloredSidebarIcons: boolean;
  onColoredSidebarIconsChange: (enabled: boolean) => void;
  transparency: boolean;
  onTransparencyChange: (enabled: boolean) => void;
  /** Whether the platform supports transparency (glass/mica) */
  glassSupported: boolean;
  isMac: boolean;
  macLiquidGlassSupported: boolean;
}

// ── Component ──

export const AppearanceSettings = memo(function AppearanceSettings({
  theme,
  onThemeChange,
  islandLayout,
  onIslandLayoutChange,
  islandShine,
  onIslandShineChange,
  macBackgroundEffect,
  onMacBackgroundEffectChange,
  autoGroupTools,
  onAutoGroupToolsChange,
  avoidGroupingEdits,
  onAvoidGroupingEditsChange,
  autoExpandTools,
  onAutoExpandToolsChange,
  expandEditToolCallsByDefault,
  onExpandEditToolCallsByDefaultChange,
  showToolIcons,
  onShowToolIconsChange,
  coloredToolIcons,
  onColoredToolIconsChange,
  transparentToolPicker,
  onTransparentToolPickerChange,
  coloredSidebarIcons,
  onColoredSidebarIconsChange,
  transparency,
  onTransparencyChange,
  glassSupported,
  isMac,
  macLiquidGlassSupported,
}: AppearanceSettingsProps) {
  const effectiveMacBackgroundEffect = !macLiquidGlassSupported && macBackgroundEffect === "liquid-glass"
    ? "vibrancy"
    : macBackgroundEffect;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-foreground/[0.06] px-6 py-4">
        <h2 className="text-base font-semibold text-foreground">Appearance</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Customize the look and feel of the interface
        </p>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-2">
          {/* ── Theme section ── */}
          <div className="py-3">
            <div className="mb-1 flex items-center gap-2">
              <SunMoon className="h-4 w-4 text-muted-foreground" />
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Theme
              </span>
            </div>

            <SettingRow
              label="Color theme"
              description="Choose between light and dark appearance, or follow your system setting."
            >
              <SettingsSelect
                value={theme}
                onValueChange={(v) => onThemeChange(v as ThemeOption)}
                options={[
                  { value: "dark", label: "Dark" },
                  { value: "light", label: "Light" },
                  { value: "system", label: "System" },
                ]}
              />
            </SettingRow>
          </div>

          {/* ── Tools section ── */}
          <div className="border-t border-foreground/[0.04] py-3">
            <div className="mb-1 flex items-center gap-2">
              <Wrench className="h-4 w-4 text-muted-foreground" />
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Tools
              </span>
            </div>

            <SettingRow
              label="Auto-group tools"
              description="Collapse consecutive tool calls into a single group. Disable to keep every tool call and in-between thinking row visible on its own."
            >
              <Switch
                checked={autoGroupTools}
                onCheckedChange={onAutoGroupToolsChange}
              />
            </SettingRow>

            <SettingRow
              label="Avoid grouping edits"
              description="Treat Edit and Write tool calls as standalone rows, even when auto-grouping is enabled. Reads before and after an edit will form separate groups."
            >
              <Switch
                checked={avoidGroupingEdits}
                onCheckedChange={onAvoidGroupingEditsChange}
                disabled={!autoGroupTools}
              />
            </SettingRow>

            <SettingRow
              label="Auto-expand tool results"
              description="Temporarily expand completed tool calls, then collapse them again after a short delay. Disable to keep tool rows stable unless you open them yourself."
            >
              <Switch
                checked={autoExpandTools}
                onCheckedChange={onAutoExpandToolsChange}
              />
            </SettingRow>

            <SettingRow
              label="Expand Edit and Write tools by default"
              description="Start Edit and Write tool calls open when they appear. Disable to keep them collapsed until you open them."
            >
              <Switch
                checked={expandEditToolCallsByDefault}
                onCheckedChange={onExpandEditToolCallsByDefaultChange}
              />
            </SettingRow>

            <SettingRow
              label="Show tool icons"
              description="Display icons next to tool call labels. Disable for a text-only view."
            >
              <Switch
                checked={showToolIcons}
                onCheckedChange={onShowToolIconsChange}
              />
            </SettingRow>

            <SettingRow
              label="Colored tool icons"
              description="Tint tool call icons with per-tool colors. Disable for monochrome icons."
            >
              <Switch
                checked={coloredToolIcons}
                onCheckedChange={onColoredToolIconsChange}
                disabled={!showToolIcons}
              />
            </SettingRow>

          </div>

          {/* ── Layout section ── */}
          <div className="border-t border-foreground/[0.04] py-3">
            <div className="mb-1 flex items-center gap-2">
              <Layout className="h-4 w-4 text-muted-foreground" />
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Layout
              </span>
            </div>

            <div className="py-3">
              <p className="text-sm font-medium text-foreground">Window layout</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Choose how panels are arranged in the window.
              </p>
              <div className="mt-3 flex gap-3">
                {/* ── Island preview ── */}
                <button
                  type="button"
                  className={`group flex-1 rounded-lg border-2 p-2.5 transition-colors ${
                    islandLayout
                      ? "border-primary bg-primary/[0.04]"
                      : "border-transparent bg-foreground/[0.03] hover:bg-foreground/[0.05]"
                  }`}
                  onClick={() => onIslandLayoutChange(true)}
                >
                  {/* Mini app illustration — islands with gaps and rounded corners */}
                  <div className="flex h-[72px] gap-1 rounded-md bg-foreground/[0.04] p-1.5">
                    {/* Sidebar */}
                    <div className="w-[26%] rounded-[5px] bg-foreground/[0.07]" />
                    {/* Chat */}
                    <div className="flex flex-1 flex-col gap-1">
                      <div className="flex-1 rounded-[5px] bg-foreground/[0.07]" />
                      {/* Bottom bar hint */}
                      <div className="h-2.5 rounded-[4px] bg-foreground/[0.05]" />
                    </div>
                    {/* Tool column */}
                    <div className="flex w-[22%] flex-col gap-1">
                      <div className="flex-1 rounded-[5px] bg-foreground/[0.07]" />
                      <div className="h-[40%] rounded-[5px] bg-foreground/[0.07]" />
                    </div>
                    {/* Tool picker strip */}
                    <div className="flex w-2 flex-col items-center gap-1 pt-1.5">
                      <div className="h-1.5 w-1.5 rounded-full bg-foreground/10" />
                      <div className="h-1.5 w-1.5 rounded-full bg-foreground/10" />
                      <div className="h-1.5 w-1.5 rounded-full bg-foreground/10" />
                    </div>
                  </div>
                  <p className={`mt-2 text-center text-xs font-medium ${
                    islandLayout ? "text-primary" : "text-muted-foreground"
                  }`}>
                    Islands
                  </p>
                </button>

                {/* ── Flat preview ── */}
                <button
                  type="button"
                  className={`group flex-1 rounded-lg border-2 p-2.5 transition-colors ${
                    !islandLayout
                      ? "border-primary bg-primary/[0.04]"
                      : "border-transparent bg-foreground/[0.03] hover:bg-foreground/[0.05]"
                  }`}
                  onClick={() => onIslandLayoutChange(false)}
                >
                  {/* Mini app illustration — flat edge-to-edge with 1px dividers */}
                  <div className="flex h-[72px] overflow-hidden rounded-md bg-foreground/[0.04]">
                    {/* Sidebar */}
                    <div className="w-[26%] bg-foreground/[0.07]" />
                    {/* Divider */}
                    <div className="w-px bg-foreground/15" />
                    {/* Chat */}
                    <div className="flex flex-1 flex-col">
                      <div className="flex-1 bg-foreground/[0.07]" />
                      <div className="h-px bg-foreground/15" />
                      <div className="h-2.5 bg-foreground/[0.05]" />
                    </div>
                    {/* Divider */}
                    <div className="w-px bg-foreground/15" />
                    {/* Tool column */}
                    <div className="flex w-[22%] flex-col">
                      <div className="flex-1 bg-foreground/[0.07]" />
                      <div className="h-px bg-foreground/15" />
                      <div className="h-[40%] bg-foreground/[0.07]" />
                    </div>
                    {/* Divider */}
                    <div className="w-px bg-foreground/15" />
                    {/* Tool picker strip */}
                    <div className="flex w-2 flex-col items-center gap-1 bg-foreground/[0.04] pt-1.5">
                      <div className="h-1.5 w-1.5 rounded-full bg-foreground/10" />
                      <div className="h-1.5 w-1.5 rounded-full bg-foreground/10" />
                      <div className="h-1.5 w-1.5 rounded-full bg-foreground/10" />
                    </div>
                  </div>
                  <p className={`mt-2 text-center text-xs font-medium ${
                    !islandLayout ? "text-primary" : "text-muted-foreground"
                  }`}>
                    Flat
                  </p>
                </button>
              </div>
            </div>

            <SettingRow
              label="Colored sidebar icons"
              description="Tint tool picker and panel header icons with per-tool colors. Disable for neutral monochrome icons."
            >
              <Switch
                checked={coloredSidebarIcons}
                onCheckedChange={onColoredSidebarIconsChange}
              />
            </SettingRow>

            <SettingRow
              label="Island border shine"
              description="Show a subtle diagonal reflection on island panel borders. Only visible in island layout mode."
            >
              <Switch
                checked={islandShine}
                onCheckedChange={onIslandShineChange}
                disabled={!islandLayout}
              />
            </SettingRow>
          </div>

          {/* ── Transparency section ── */}
          <div className="border-t border-foreground/[0.04] py-3">
            <div className="mb-1 flex items-center gap-2">
              <Blend className="h-4 w-4 text-muted-foreground" />
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Transparency
              </span>
            </div>

            <SettingRow
              label={isMac ? "Window background effect" : "Window transparency"}
              description={
                isMac
                  ? (
                    macLiquidGlassSupported
                      ? "Choose the native macOS background material. Liquid Glass can be enabled immediately; switching away from it may need a quick reopen to fully clear the native view."
                      : "Choose the native macOS background material. Liquid Glass is unavailable on this Mac, so Vibrancy and Off are available."
                  )
                  : (
                    glassSupported
                      ? "Allow the desktop to show through the window background. Uses Mica on Windows when enabled."
                      : "Window transparency is not available on this platform."
                  )
              }
            >
              {isMac ? (
                <SettingsSelect
                  value={effectiveMacBackgroundEffect}
                  onValueChange={(value) => onMacBackgroundEffectChange(value as MacBackgroundEffect)}
                  options={[
                    ...(macLiquidGlassSupported
                      ? [{ value: "liquid-glass", label: "Liquid Glass" }]
                      : []),
                    { value: "vibrancy", label: "Vibrancy" },
                    { value: "off", label: "Blur Off" },
                  ]}
                  className="min-w-[9.5rem]"
                />
              ) : (
                <Switch
                  checked={transparency}
                  onCheckedChange={onTransparencyChange}
                  disabled={!glassSupported}
                />
              )}
            </SettingRow>

            <SettingRow
              label="Transparent tool picker"
              description="Remove the background from the right-side tool picker strip so icons float directly over the window."
            >
              <Switch
                checked={transparentToolPicker}
                onCheckedChange={onTransparentToolPickerChange}
              />
            </SettingRow>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
});
