'use client';

/* Design-system primitives for the demo, ported from the platform UI kit
 * (init-resources/skc-design-system/ui_kits/app/lib.jsx). Icons are Lucide
 * (lucide-react), imported by name so only the icons used ship. */

import {
  Activity,
  Archive,
  Armchair,
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  ArrowUp,
  BadgeCheck,
  Ban,
  BellOff,
  BookOpenCheck,
  Bot,
  Building2,
  Cable,
  CalendarClock,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleHelp,
  CircleMinus,
  CirclePause,
  CircleX,
  ClipboardList,
  Clock,
  Columns3,
  Crown,
  DatabaseZap,
  Dessert,
  Download,
  Eye,
  Fence,
  FileCheck,
  FileOutput,
  FileSpreadsheet,
  Filter,
  Fish,
  Flag,
  FlaskConical,
  Gauge,
  Gavel,
  GitCompareArrows,
  Hourglass,
  Info,
  Landmark,
  Layers,
  Lightbulb,
  ListChecks,
  Lock,
  Mail,
  MapPin,
  Menu,
  MessageCircle,
  MessageSquareWarning,
  Moon,
  PauseCircle,
  PenLine,
  Pencil,
  Play,
  Plug,
  PlugZap,
  Presentation,
  Receipt,
  RefreshCw,
  Route,
  Scale,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Shuffle,
  Sigma,
  Siren,
  Smartphone,
  Sprout,
  Store,
  Sun,
  Timer,
  TrendingUp,
  TriangleAlert,
  Truck,
  Undo2,
  UserMinus,
  Users,
  UtensilsCrossed,
  Verified,
  Wrench,
  Zap,
} from 'lucide-react';

const ICONS = {
  Activity,
  Archive,
  Armchair,
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  ArrowUp,
  BadgeCheck,
  Ban,
  BellOff,
  BookOpenCheck,
  Bot,
  Building2,
  Cable,
  CalendarClock,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleHelp,
  CircleMinus,
  CirclePause,
  CircleX,
  ClipboardList,
  Clock,
  Columns3,
  Crown,
  DatabaseZap,
  Dessert,
  Download,
  Eye,
  Fence,
  FileCheck,
  FileOutput,
  FileSpreadsheet,
  Filter,
  Fish,
  Flag,
  FlaskConical,
  Gauge,
  Gavel,
  GitCompareArrows,
  Hourglass,
  Info,
  Landmark,
  Layers,
  Lightbulb,
  ListChecks,
  Lock,
  Mail,
  MapPin,
  Menu,
  MessageCircle,
  MessageSquareWarning,
  Moon,
  PauseCircle,
  PenLine,
  Pencil,
  Play,
  Plug,
  PlugZap,
  Presentation,
  Receipt,
  RefreshCw,
  Route,
  Scale,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Shuffle,
  Sigma,
  Siren,
  Smartphone,
  Sprout,
  Store,
  Sun,
  Timer,
  TrendingUp,
  TriangleAlert,
  Truck,
  Undo2,
  UserMinus,
  Users,
  UtensilsCrossed,
  Verified,
  Wrench,
  Zap,
};

/** Every icon name the screens use. A unit test keeps this list complete. */
export const ICON_NAMES = Object.keys(ICONS);

export function Icon({ name, size = 18, stroke = 2, color, style, className }) {
  const Glyph = ICONS[name];
  if (!Glyph) {
    if (process.env.NODE_ENV !== 'production') console.warn(`Icon "${name}" is not registered in components/kit.jsx`);
    return null;
  }
  return <Glyph size={size} strokeWidth={stroke} color={color} style={style} className={className} aria-hidden="true" />;
}

export function Button({ variant = 'primary', size, icon, iconRight, children, className = '', ...props }) {
  const cls = ['btn', `btn-${variant}`, size && `btn-${size}`, !children && 'btn-icon', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} {...props}>
      {icon && <Icon name={icon} size={size === 'sm' ? 15 : 17} />}
      {children}
      {iconRight && <Icon name={iconRight} size={16} />}
    </button>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} type="button" role="tab" aria-selected={t.value === value} className={`tab ${t.value === value ? "active" : ""}`} onClick={() => onChange(t.value)}>
          {t.label}
          {t.count !== undefined && <span className="tcount">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
