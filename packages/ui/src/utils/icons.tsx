/**
 * Icon direction registry (RTL_DESIGN_RULES §4) — THE single place where icon
 * direction is decided. Screens never mirror icons and never apply
 * scaleX(-1) themselves; they pick semantic names ('arrow-start' = go
 * start-ward) and the registry decides.
 *
 * DIRECTIONAL is the verbatim set from the doc: these mirror in RTL; every
 * other icon never mirrors. Non-directional icons (barcodes, QR, logos)
 * must NOT be added to this set. New icons get a one-line registry review
 * entry: directional or not — decided once, tested AR+EN.
 */
import type { JSX, SVGProps } from "react";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Banknote,
  Barcode,
  Boxes,
  Building2,
  Calendar,
  CalendarClock,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronUp,
  Circle,
  CircleAlert,
  CircleCheck,
  Clock,
  CornerDownLeft,
  CornerUpLeft,
  BookCheck,
  CloudOff,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileCheck,
  FileText,
  Filter,
  Home,
  Hourglass,
  Inbox,
  IndentDecrease,
  IndentIncrease,
  Info,
  Keyboard,
  Landmark,
  Languages,
  ListOrdered,
  LoaderCircle,
  Lock,
  LogIn,
  LogOut,
  Mail,
  Minus,
  MoreHorizontal,
  MoreVertical,
  MoveLeft,
  MoveRight,
  PanelLeft,
  PanelRight,
  Pencil,
  Plus,
  QrCode,
  Receipt,
  ReceiptText,
  Redo2,
  Reply,
  Search,
  Send,
  Settings,
  Share,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Truck,
  Undo2,
  UserPlus,
  Users,
  UsersRound,
  WalletCards,
  X,
  Layers,
} from "lucide-react";

import { cn } from "./cn";
import { useDirection } from "./direction";

/** Verbatim from RTL_DESIGN_RULES §4 — mirrored in RTL, never otherwise. */
export const DIRECTIONAL: ReadonlySet<string> = new Set([
  "arrow-left",
  "arrow-right",
  "arrow-start",
  "arrow-end",
  "chevron-left",
  "chevron-right",
  "undo-2",
  "redo-2",
  "indent-increase",
  "indent-decrease",
  "list-ordered",
  "corner-down-left",
  "corner-up-left",
  "log-in",
  "log-out",
  "send",
  "message-reply",
  "reply",
  "share",
  "move-left",
  "move-right",
  "panel-left",
  "panel-right",
  // semantic aliases following the doc's own arrow-start/arrow-end precedent
  "chevron-start",
  "chevron-end",
  "chevrons-start",
  "chevrons-end",
]);

/**
 * Registry name → Lucide component. Doc names are kept (NAVIGATION_MODEL /
 * COMPONENT_CATALOG reference these); lucide reconciliations:
 *   'ledger'      → Landmark   (no ledger icon in lucide)
 *   'bar-chart'   → ChartColumn (lucide canonical name)
 *   'ledger-check'→ BookCheck  (DocumentStatusBadge POSTED)
 *   'undo-arrow'  → 'undo-2'   (same family; RTL doc lists undo-2)
 *   'check-circle'→ 'circle-check' (lucide canonical)
 */
export const ICON_REGISTRY = {
  // directional set
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  "arrow-start": ArrowLeft,
  "arrow-end": ArrowRight,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "chevron-down": ChevronDown,
  "chevron-up": ChevronUp,
  "chevrons-left": ChevronsLeft,
  "chevrons-right": ChevronsRight,
  "undo-2": Undo2,
  "redo-2": Redo2,
  "indent-increase": IndentIncrease,
  "indent-decrease": IndentDecrease,
  "list-ordered": ListOrdered,
  "corner-down-left": CornerDownLeft,
  "corner-up-left": CornerUpLeft,
  "log-in": LogIn,
  "log-out": LogOut,
  "send": Send,
  "message-reply": Reply,
  "reply": Reply,
  "share": Share,
  "move-left": MoveLeft,
  "move-right": MoveRight,
  "panel-left": PanelLeft,
  "panel-right": PanelRight,
  "chevron-start": ChevronLeft,
  "chevron-end": ChevronRight,
  "chevrons-start": ChevronsLeft,
  "chevrons-end": ChevronsRight,
  // nav groups + non-directional
  "home": Home,
  "receipt": Receipt,
  // PHASE-027 nav icons (non-directional — documents/calendars/wallets
  // never mirror; the one-line registry review entry): cheques & notes,
  // maturity calendar, installment plans.
  "receipt-text": ReceiptText,
  "calendar-clock": CalendarClock,
  "wallet-cards": WalletCards,
  "layers": Layers,
  "truck": Truck,
  "boxes": Boxes,
  "ledger": Landmark,
  "landmark": Landmark,
  "banknote": Banknote,
  "arrow-left-right": ArrowLeftRight,
  "clock": Clock,
  "bar-chart": ChartColumn,
  "users": Users,
  "settings": Settings,
  "users-round": UsersRound,
  "search": Search,
  "x": X,
  "check": Check,
  "minus": Minus,
  "kebab": MoreHorizontal,
  "kebab-vertical": MoreVertical,
  "calendar": Calendar,
  "alert": CircleAlert,
  "warning": TriangleAlert,
  "circle-check": CircleCheck,
  "book-check": BookCheck,
  "hourglass": Hourglass,
  "cloud-off": CloudOff,
  "pencil": Pencil,
  "inbox": Inbox,
  "loading": LoaderCircle,
  "info": Info,
  "filter": Filter,
  "circle": Circle,
  "eye": Eye,
  "eye-off": EyeOff,
  "plus": Plus,
  "trash": Trash2,
  "copy": Copy,
  "external": ExternalLink,
  "keyboard": Keyboard,
  "building": Building2,
  "file-text": FileText,
  "file-check": FileCheck,
  "shield": ShieldCheck,
  "user-plus": UserPlus,
  "lock": Lock,
  "mail": Mail,
  "link": ExternalLink,
  "qr-code": QrCode,
  "barcode": Barcode,
  "languages": Languages,
} as const;

export type IconName = keyof typeof ICON_REGISTRY;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  /** Registry name (doc vocabulary) — never a raw component. */
  name: IconName;
  /** §14: 16 in tables/badges (12/14 inside dense badges), 20 toolbars, 24 POS-only. */
  size?: 12 | 14 | 16 | 20 | 24;
  /** Override the registry's direction decision ONLY via sanctioned exception. */
  mirrored?: never;
}

/** Lucide icons render stroke 1.5 (§14) — lucide default is 2, we clamp. */
export function Icon({ name, size = 16, className, ...rest }: IconProps): JSX.Element {
  const dir = useDirection();
  const Component = ICON_REGISTRY[name];
  const mirrored = DIRECTIONAL.has(name) && dir === "rtl";
  return (
    <Component
      aria-hidden="true"
      strokeWidth={1.5}
      width={size}
      height={size}
      className={cn("shrink-0", mirrored && "erp-icon-mirrored", className)}
      style={mirrored ? { transform: "scaleX(-1)" } : undefined}
      {...rest}
    />
  );
}
