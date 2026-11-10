/**
 * @erp/ui — public API (the ONLY import surface for apps; DESIGN_SYSTEM §2).
 * Deep imports and raw Radix imports in app code are lint-banned
 * (erp/import-path, erp/no-raw-radix).
 */
export { cn } from "./utils/cn";
export { Icon, DIRECTIONAL, ICON_REGISTRY, type IconName, type IconProps } from "./utils/icons";
export {
  DirectionProvider,
  DensityProvider,
  useDirection,
  useDensity,
  controlCx,
  rowCx,
  type Direction,
  type Density,
} from "./utils/direction";
export { LRI, RLI, FSI, PDI, bidi, isolateLTR, isolateAuto, bidiIsolateStyle, type BidiSegment } from "./utils/bidi";
export {
  formatMoneyDisplay,
  moneyColorClass,
  moneySign,
  currencyChipLabel,
  sanitizeMoneyInput,
  stripMoneyGrouping,
  renderMoneyCell,
  isCanonicalMoneyString,
} from "./utils/money";
export {
  isoFromYMD,
  ymdFromIso,
  gregorianMonthName,
  hijriCaption,
  monthCaption,
  monthGrid,
  presetRange,
  addMonths,
  daysInMonth,
  dateToYmd,
  ymdToDate,
  weekdayHeaders,
  type CalendarSystem,
  type DateRangePresetId,
  type GregorianYMD,
} from "./utils/dates";
export {
  DOCUMENT_STATUS_STYLE,
  DOCUMENT_STATUSES,
  DOCUMENT_TRANSITIONS,
  statusMessageKey,
  actionMessageKey,
  type DocumentStatus,
  type DocumentActionId,
  type StatusTone,
} from "./utils/status";

export { Button, IconButton, type ButtonProps, type ButtonVariant } from "./components/button";
export { Input, Textarea, NumberInput, SearchInput, useDebouncedCallback, useDebouncedValue, type InputProps } from "./components/input";
export { MoneyInput, type MoneyInputProps } from "./components/money-input";
export {
  Select,
  Combobox,
  Checkbox,
  RadioGroup,
  Switch,
  type SelectProps,
  type SelectOption,
  type ComboboxProps,
  type CheckboxProps,
  type RadioGroupProps,
  type SwitchProps,
} from "./components/controls";
export { DatePicker, DateRangePicker, type DatePickerProps, type DateRangePickerProps } from "./components/date-picker";
export {
  Badge,
  DocumentStatusBadge,
  DocumentActions,
  type BadgeProps,
  type DocumentStatusBadgeProps,
  type DocumentActionsProps,
} from "./components/badge";
export {
  ToastProvider,
  useToast,
  type ToastApi,
  type ToastItem,
  type ToastTone,
} from "./components/toast";
export { Dialog, Drawer, Tooltip, Popover, Tabs, type TabItem } from "./components/overlays";
export {
  EmptyState,
  LoadingState,
  ErrorState,
  Breadcrumbs,
  Pagination,
  type Crumb,
} from "./components/states";
export {
  DataTable,
  type DataTableColumn,
  type DataTableProps,
  type DataTableSort,
} from "./components/data-table/data-table";
export {
  AppShell,
  NavigationSidebar,
  CommandMenu,
  encodeListState,
  decodeListState,
  type AppShellProps,
  type NavigationSidebarProps,
  type CommandMenuProps,
  type CommandMenuRemoteItem,
  type CommandMenuRemoteGroup,
} from "./components/shell";
// P6-T11a — PHASE-006 master-data picker patterns (catalog §3) + headless
// data hooks (catalog §9). Patterns never fetch: screens inject the fetchers.
export { PartnerPicker, type PartnerPickerProps, type PickerOption } from "./patterns/partner-picker";
export { ItemPicker, type ItemPickerProps } from "./patterns/item-picker";
export {
  usePartnerBalance,
  type PartnerBalanceSnapshot,
  type PartnerBalanceState,
} from "./hooks/use-partner-balance";
export {
  useItemPricing,
  type ItemPriceRequest,
  type ItemPriceResolution,
  type ItemPricingState,
} from "./hooks/use-item-pricing";
// PHASE-007 accounting patterns (COMPONENT_CATALOG §6.3) — the manual
// journal workspace's grid + live balance bar and the approvals queue.
export {
  JournalEntryGrid,
  emptyLine,
  type JournalLineDraft,
  type JournalEntryGridLabels,
  type JournalEntryGridProps,
} from "./patterns/journal-entry-grid";
export { MoneySummaryBar, type MoneySummaryBarProps } from "./patterns/money-summary-bar";
export {
  ApprovalsQueue,
  type ApprovalsQueueRow,
  type ApprovalsQueueLabels,
  type ApprovalsQueueProps,
} from "./patterns/approvals-queue";
// PHASE-008 treasury pattern (COMPONENT_CATALOG §6.3 ShiftPanel row) — the
// cashier-shift console; exact string math via the shared decimal helper.
export {
  ShiftPanel,
  type ShiftPanelData,
  type ShiftPanelLabels,
  type ShiftPanelProps,
  type ShiftClosePayload,
  type ShiftCloseDraft,
  type ShiftPanelStatus,
} from "./patterns/shift-panel";
// PHASE-027 pattern (COMPONENT_CATALOG §3 TimelinePanel row) — the
// append-only event-log reader (custody/audit trails; RTL-aware markers).
export {
  TimelinePanel,
  type TimelineItem,
  type TimelinePanelProps,
  type TimelineTone,
} from "./patterns/timeline-panel";
// PHASE-028 pattern (COMPONENT_CATALOG §6.3 PeriodGrid row) — the
// period-column spreadsheet grid (budget workspace variant; sticky
// dimension column, keyboard cell navigation, live totals, RTL mirror).
export {
  PeriodGrid,
  type PeriodGridColumn,
  type PeriodGridRowData,
  type PeriodGridTotals,
  type PeriodGridLabels,
  type PeriodGridProps,
} from "./patterns/period-grid";
export { useStockAvailability, type StockAvailabilityState } from "./hooks/use-stock-availability";
